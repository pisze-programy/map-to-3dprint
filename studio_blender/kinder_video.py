#!/usr/bin/env python3
"""Continuous C2-smooth Kinder-style 9:16 Cycles Metal commercial video renderer.

Runs as a standalone host CLI (`python3 studio_blender/kinder_video.py ...`),
invokes headless Blender Cycles with Apple Metal GPU + optical motion blur,
optionally blends a spatially-locked dark-to-white packshot dissolve, encodes
an H.264 MP4, and builds a 12-frame high-res filmstrip contact sheet.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from studio_blender.render_studio import find_blender_binary, find_ffmpeg_binary

DEFAULT_NYC_STLS: Tuple[str, ...] = (
    str(_REPO_ROOT / "exports/nyc_wtc_145x79_1x1/Map3D_NYC_Triptych_01_Top_Tribeca_145x79mm.stl"),
    str(_REPO_ROOT / "exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl"),
)


def _parse_wh(res_str: str) -> Tuple[int, int]:
    parts = res_str.lower().replace("x", " ").split()
    if len(parts) != 2:
        raise ValueError(f"Invalid --resolution '{res_str}', expected WxH.")
    w, h = int(parts[0]), int(parts[1])
    return (w - (w % 2), h - (h % 2))


def _iter_action_fcurves(action: Any) -> List[Any]:
    if hasattr(action, "fcurves"):
        try:
            return list(action.fcurves)
        except Exception:
            pass
    curves: List[Any] = []
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in getattr(layer, "strips", ()):
                for bag in getattr(strip, "channelbags", ()):
                    curves.extend(getattr(bag, "fcurves", ()))
    return curves


def _clear_blender_scene(scene: Any) -> None:
    import bpy  # type: ignore

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    for group in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras, bpy.data.materials, bpy.data.worlds):
        for blk in list(group):
            if blk.users == 0:
                group.remove(blk)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def _optimize_video_shader(plaster_mat: Any) -> None:
    """Tune live plaster material instance for fast motion-blur Cycles video (no disk edits)."""
    if plaster_mat is None or plaster_mat.node_tree is None:
        return
    for node in plaster_mat.node_tree.nodes:
        if node.type == "AMBIENT_OCCLUSION":
            node.samples = 1
        elif node.type == "BSDF_PRINCIPLED":
            for inp_name in ("Subsurface Weight", "Subsurface"):
                if inp_name in node.inputs:
                    node.inputs[inp_name].default_value = 0.0


def _keyframe_continuous_rig(
    scene: Any, rig: Any, n_frames: int, fps: int, env_refs: Dict[str, Any], animate_key_light: bool
) -> None:
    """Keyframe continuous C2 camera, focus empty, and key light with quaternion continuity."""
    from mathutils import Vector  # type: ignore

    from studio_blender import camera_rig, environments

    cam_obj, focus_obj = camera_rig.ensure_studio_camera(scene)
    key_light = env_refs.get("key_light") if animate_key_light else None
    for db in (cam_obj, cam_obj.data, focus_obj, key_light):
        if db is not None and db.animation_data is not None:
            db.animation_data_clear()

    scene.render.fps = int(fps)
    scene.frame_start = 1
    scene.frame_end = int(n_frames)

    prev_quat: Any = None
    for f in range(0, n_frames + 2):
        t_sec = (f - 1) / float(n_frames - 1) * rig.duration_sec
        st = rig.evaluate(t_sec)
        loc, rot_quat, _ = camera_rig.look_at_matrix(st["eye"], st["target"]).decompose()
        if prev_quat is not None and prev_quat.dot(rot_quat) < 0.0:
            rot_quat = -rot_quat
        prev_quat = rot_quat.copy()

        cam_obj.rotation_mode = "QUATERNION"
        cam_obj.location = loc
        cam_obj.rotation_quaternion = rot_quat
        cam_obj.data.lens = float(st["lens_mm"])
        cam_obj.data.shift_x = float(st["shift_x"])
        cam_obj.data.shift_y = float(st["shift_y"])
        cam_obj.data.dof.use_dof = True
        cam_obj.data.dof.aperture_fstop = float(st["fstop"])
        focus_obj.location = Vector(st["focus_point"])

        cam_obj.keyframe_insert(data_path="location", frame=f)
        cam_obj.keyframe_insert(data_path="rotation_quaternion", frame=f)
        cam_obj.data.keyframe_insert(data_path="lens", frame=f)
        cam_obj.data.keyframe_insert(data_path="shift_y", frame=f)
        cam_obj.data.dof.keyframe_insert(data_path="aperture_fstop", frame=f)
        focus_obj.keyframe_insert(data_path="location", frame=f)

        if key_light is not None:
            environments.update_key_light_azimuth(env_refs, st["sun_az"], elevation_deg=st["sun_el"])
            key_light.keyframe_insert(data_path="location", frame=f)
            key_light.keyframe_insert(data_path="rotation_euler", frame=f)

    for db in (cam_obj, cam_obj.data, focus_obj, key_light):
        if db is None or db.animation_data is None or db.animation_data.action is None:
            continue
        for fc in _iter_action_fcurves(db.animation_data.action):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = "AUTO_CLAMPED"
                kp.handle_right_type = "AUTO_CLAMPED"


def _render_env_pass(
    env_name: str, stl_paths: Sequence[str], frames_to_render: Sequence[int],
    n_frames: int, fps: int, duration_sec: float, width: int, height: int,
    samples: int, shutter: float, out_dir: Path, animate_key_light: bool,
    base_sun_az_override: Optional[float] = None,
) -> Dict[str, Any]:
    """Build clean Blender scene for one environment and render the requested frame list."""
    import bpy  # type: ignore

    from studio_blender import environments, materials, stl_loader
    from studio_blender.kinder_camera_curves import KinderCameraRig, validate_kinder_trajectory
    from studio_blender.worker_render import build_product_assembly, configure_cycles_metal

    t_pass = time.time()
    scene = bpy.context.scene
    _clear_blender_scene(scene)

    cycles_info = configure_cycles_metal(scene=scene, samples=samples, width=width, height=height, motion_blur=True)
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = float(shutter)
    if hasattr(scene.cycles, "motion_blur_position"):
        scene.cycles.motion_blur_position = "CENTER"
    if hasattr(scene.cycles, "adaptive_threshold"):
        scene.cycles.adaptive_threshold = 0.032
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 2
    scene.cycles.volume_bounces = 0
    if hasattr(scene.render, "use_persistent_data"):
        scene.render.use_persistent_data = True

    plaster_mat = materials.make_plaster_cement_material()
    _optimize_video_shader(plaster_mat)
    lr = stl_loader.load_city_stls(list(stl_paths), "single_13x18", 4.0, None, plaster_mat)
    title = stl_loader.infer_city_title(list(stl_paths))
    fi, analysis = build_product_assembly(
        scene, lr, "single_13x18", title, "desk_flat", 4.0, 7.5, "matte_black", False
    )
    model_bounds: Dict[str, Any] = {
        "frame_width_m": lr["total_width_m"], "frame_height_m": lr["total_height_m"],
        "outer_width_m": fi["outer_width_m"], "outer_height_m": fi["outer_height_m"],
        "max_z_m": lr["max_z_m"], "max_z": lr["max_z_m"], "desk_z_m": fi["desk_z"],
        "desk_z": fi["desk_z"], "frame_bottom_z": fi["frame_bottom_z"],
        "frame_top_z": fi["frame_top_z"], "wall_y": fi["wall_y"], "cover_top_z": fi["cover_top_z"],
        "mount": "desk_flat", "water_side": analysis["water_side"],
        "hero_peak": analysis["hero_peak"], "skyline_centroid": analysis["skyline_centroid"],
    }
    env_refs = environments.build_environment(env_name=env_name, model_bounds=model_bounds, mount="desk_flat")
    haze_obj = bpy.data.objects.get("Env_VolumetricHazeBox")
    if haze_obj is not None:
        haze_obj.hide_render = True

    base_az = (
        float(base_sun_az_override)
        if base_sun_az_override is not None
        else float(env_refs.get("key_rig_meta", {}).get("azimuth_deg", 54.0))
    )
    rig = KinderCameraRig(analysis, model_bounds, float(width) / float(height), base_az, duration_sec)
    validation = validate_kinder_trajectory(rig, fps=fps)
    _keyframe_continuous_rig(scene, rig, n_frames, fps, env_refs, animate_key_light=animate_key_light)

    out_dir.mkdir(parents=True, exist_ok=True)
    rendered_paths: List[str] = []
    t_r0 = time.time()
    for idx, f in enumerate(frames_to_render, start=1):
        scene.frame_set(int(f))
        fpath = out_dir / f"frame_{f:04d}.png"
        scene.render.filepath = str(fpath)
        bpy.ops.render.render(write_still=True)
        rendered_paths.append(str(fpath))
        if idx == 1 or idx % 24 == 0 or idx == len(frames_to_render):
            el = time.time() - t_r0
            print(f"[KINDER:{env_name}] {idx}/{len(frames_to_render)} (f={f}) avg={el / idx:.2f}s/f total={el:.1f}s", flush=True)

    r_sec = time.time() - t_r0
    return {
        "env": env_name, "frames": rendered_paths, "frame_count": len(rendered_paths),
        "avg_sec_per_frame": round(r_sec / max(1, len(rendered_paths)), 3),
        "render_elapsed_sec": round(r_sec, 2), "pass_elapsed_sec": round(time.time() - t_pass, 2),
        "cycles": cycles_info, "validation": validation,
    }


def _run_blender_worker(args: argparse.Namespace) -> int:
    out_dir = Path(args.out).resolve()
    frames_root = out_dir / "_frames"
    width, height = _parse_wh(args.resolution)
    fps, duration_sec = int(args.fps), float(args.duration)
    n_frames = max(2, int(round(duration_sec * fps)))
    use_packshot = args.packshot_env.lower() not in ("", "none", "off")
    white_start = max(2, min(n_frames - 2, int(round(args.dissolve_start * fps)) + 1))
    overlap_frames = max(2, int(round(args.dissolve_dur * fps)))
    dark_end = min(n_frames, white_start + overlap_frames - 1) if use_packshot else n_frames

    if args.preview_only:
        sample_frames = sorted({max(1, min(n_frames, int(round(i * (n_frames - 1) / 11.0)) + 1)) for i in range(12)})
        dark_frames = [f for f in sample_frames if (not use_packshot or f <= dark_end)]
        white_frames = [f for f in sample_frames if (use_packshot and f >= white_start)]
    else:
        dark_frames = list(range(1, dark_end + 1))
        white_frames = list(range(white_start, n_frames + 1)) if use_packshot else []

    t0 = time.time()
    dark_info = _render_env_pass(
        args.env, args.stl, dark_frames, n_frames, fps, duration_sec, width, height,
        args.samples, args.shutter, frames_root / "dark", animate_key_light=True,
    )
    white_info: Optional[Dict[str, Any]] = None
    if white_frames:
        white_info = _render_env_pass(
            args.packshot_env, args.stl, white_frames, n_frames, fps, duration_sec, width, height,
            args.samples, args.shutter, frames_root / "white", animate_key_light=False, base_sun_az_override=54.0,
        )

    manifest = {
        "status": "ok", "preview_only": bool(args.preview_only),
        "stl_paths": [str(Path(p).resolve()) for p in args.stl],
        "resolution": [width, height], "fps": fps, "duration_sec": duration_sec, "n_frames": n_frames,
        "shutter": float(args.shutter), "samples": int(args.samples), "use_packshot": use_packshot,
        "white_start_frame": white_start, "dark_end_frame": dark_end,
        "overlap_frames": (dark_end - white_start + 1) if use_packshot else 0,
        "dark_pass": dark_info, "white_pass": white_info, "total_render_sec": round(time.time() - t0, 2),
    }
    manifest_path = out_dir / "kinder_render_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[KINDER_MANIFEST] {manifest_path}", flush=True)
    return 0


def _run_ffmpeg(args: Sequence[str], label: str) -> None:
    ffmpeg = find_ffmpeg_binary()
    if not ffmpeg:
        raise RuntimeError(f"ffmpeg binary not found; cannot run {label}.")
    proc = subprocess.run([ffmpeg, "-y", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg {label} failed (rc={proc.returncode}):\n{proc.stderr[-1200:]}")


def _encode_kinder_mp4(manifest: Dict[str, Any], out_dir: Path, video_name: str) -> str:
    fps = int(manifest["fps"])
    frames_root = out_dir / "_frames"
    out_mp4 = out_dir / video_name
    dark_in = ["-framerate", str(fps), "-start_number", "1", "-i", str(frames_root / "dark" / "frame_%04d.png")]
    enc = ["-r", str(fps), "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-movflags", "+faststart", str(out_mp4)]
    if manifest["use_packshot"] and manifest.get("white_pass"):
        ws, ov = int(manifest["white_start_frame"]), int(manifest["overlap_frames"])
        white_in = ["-framerate", str(fps), "-start_number", str(ws), "-i", str(frames_root / "white" / "frame_%04d.png")]
        flt = f"[0:v][1:v]xfade=transition=fade:duration={ov / fps:.6f}:offset={(ws - 1) / fps:.6f},format=yuv420p[v]"
        _run_ffmpeg([*dark_in, *white_in, "-filter_complex", flt, "-map", "[v]", *enc], "MP4 encode")
    else:
        _run_ffmpeg([*dark_in, "-vf", "format=yuv420p", *enc], "MP4 encode")
    return str(out_mp4)


def _build_filmstrip_from_mp4(mp4_path: Path, n_frames: int, out_png: Path) -> str:
    indices = [int(round(i * (n_frames - 1) / 11.0)) for i in range(12)]
    expr = "+".join(f"eq(n\\,{idx})" for idx in indices)
    vf = f"select='{expr}',scale=360:640,tile=6x2:padding=6:margin=8:color=0x111111"
    _run_ffmpeg(["-i", str(mp4_path), "-vf", vf, "-vsync", "vfr", "-frames:v", "1", str(out_png)], "filmstrip")
    return str(out_png)


def _build_preview_strip(manifest: Dict[str, Any], out_png: Path) -> str:
    dark_l = list(manifest.get("dark_pass", {}).get("frames", []))
    white_l = list((manifest.get("white_pass") or {}).get("frames", []))
    picked = (dark_l[: max(0, 12 - len(white_l))] + white_l if white_l else dark_l)[:12]
    ins: List[str] = []
    for fp in picked:
        ins.extend(["-i", fp])
    sc = "".join(f"[{i}:v]scale=360:640[v{i}];" for i in range(len(picked)))
    st = "".join(f"[v{i}]" for i in range(len(picked)))
    flt = f"{sc}{st}concat=n={len(picked)}:v=1:a=0,tile=6x2:padding=6:margin=8:color=0x111111[out]"
    _run_ffmpeg([*ins, "-filter_complex", flt, "-map", "[out]", "-frames:v", "1", str(out_png)], "preview strip")
    return str(out_png)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Kinder-style 9:16 continuous Cycles Metal commercial renderer")
    p.add_argument("--stl", action="append", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--env", default="09_dark_cinematic")
    p.add_argument("--packshot-env", default="11_packshot_white")
    p.add_argument("--resolution", default="540x960")
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--duration", type=float, default=11.0)
    p.add_argument("--dissolve-start", type=float, default=9.75)
    p.add_argument("--dissolve-dur", type=float, default=0.45)
    p.add_argument("--samples", type=int, default=32)
    p.add_argument("--shutter", type=float, default=0.55)
    p.add_argument("--video-name", default="nyc_wtc_kinder_commercial_9x16.mp4")
    p.add_argument("--preview-only", action="store_true", default=False)
    p.add_argument("--keep-frames", action="store_true", default=False)
    p.add_argument("--blender-bin", default=None)
    p.add_argument("--blender-worker", action="store_true", default=False, help=argparse.SUPPRESS)
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    raw_argv = list(argv) if argv is not None else (
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    )
    args = _build_parser().parse_args(raw_argv)
    if not args.stl:
        args.stl = list(DEFAULT_NYC_STLS)
    if args.blender_worker:
        return _run_blender_worker(args)

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    blender = find_blender_binary(args.blender_bin)
    cmd: List[str] = [
        blender, "--background", "--factory-startup", "--python-exit-code", "1",
        "--python", str(_THIS_FILE), "--", "--blender-worker",
        "--out", str(out_dir), "--env", args.env, "--packshot-env", args.packshot_env,
        "--resolution", args.resolution, "--fps", str(args.fps), "--duration", str(args.duration),
        "--dissolve-start", str(args.dissolve_start), "--dissolve-dur", str(args.dissolve_dur),
        "--samples", str(args.samples), "--shutter", str(args.shutter), "--video-name", args.video_name,
    ]
    for p in args.stl:
        cmd.extend(["--stl", str(Path(p).resolve())])
    if args.preview_only:
        cmd.append("--preview-only")

    t_wall0 = time.time()
    proc = subprocess.run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"Blender worker failed with exit code {proc.returncode}")

    manifest_path = out_dir / "kinder_render_manifest.json"
    manifest: Dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    if args.preview_only:
        manifest["preview_strip_path"] = _build_preview_strip(manifest, out_dir / "kinder_video_preview_strip.png")
    else:
        mp4 = _encode_kinder_mp4(manifest, out_dir, args.video_name)
        strip = _build_filmstrip_from_mp4(Path(mp4), int(manifest["n_frames"]), out_dir / "kinder_video_filmstrip.png")
        manifest["video_path"] = mp4
        manifest["filmstrip_path"] = strip

    if not args.keep_frames:
        shutil.rmtree(out_dir / "_frames", ignore_errors=True)
    manifest["total_wall_sec"] = round(time.time() - t_wall0, 2)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({k: manifest.get(k) for k in ("video_path", "filmstrip_path", "preview_strip_path", "total_wall_sec")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
