#!/usr/bin/env python3
"""Universal C2-smooth Kinder-style Cycles Metal commercial video renderer.

Works with any city STL (1-tile single_thin like Dubai or 2-tile single_13x18
like NYC), any studio or persona environment (01..17), composable props, DSLR
compositor finishing, and optional spatially-locked 11_packshot_white dissolve.
"""

from __future__ import annotations

import argparse
import inspect
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
ASPECT_VIDEO_RES: Dict[str, Tuple[int, int]] = {
    "9:16": (540, 960), "4:5": (640, 800), "1:1": (720, 720), "16:9": (960, 540),
}


def _parse_wh(res_str: Optional[str], aspect: str = "9:16") -> Tuple[int, int]:
    if not res_str:
        return ASPECT_VIDEO_RES.get(aspect, (540, 960))
    parts = res_str.lower().replace("x", " ").split()
    if len(parts) != 2:
        raise ValueError(f"Invalid --resolution '{res_str}', expected WxH.")
    w, h = int(parts[0]), int(parts[1])
    return (w - (w % 2), h - (h % 2))


def _filter_kwargs(fn: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return kwargs
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return kwargs
    return {k: v for k, v in kwargs.items() if k in params}


def _iter_action_fcurves(action: Any) -> List[Any]:
    if hasattr(action, "fcurves"):
        try:
            return list(action.fcurves)
        except Exception:
            pass
    curves: List[Any] = []
    for layer in getattr(action, "layers", ()):
        for strip in getattr(layer, "strips", ()):
            for bag in getattr(strip, "channelbags", ()):
                curves.extend(getattr(bag, "fcurves", ()))
    return curves


def _clear_blender_scene(scene: Any) -> None:
    import bpy  # type: ignore

    scene.render.use_compositing = False
    if hasattr(scene, "compositing_node_group"):
        scene.compositing_node_group = None
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    for grp in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras, bpy.data.materials, bpy.data.worlds):
        for blk in list(grp):
            if blk.users == 0:
                grp.remove(blk)
    scene.unit_settings.system, scene.unit_settings.scale_length = "METRIC", 1.0


def _optimize_video_shader(plaster_mat: Any) -> None:
    """Tune live plaster material instance for fast motion-blur Cycles video."""
    if plaster_mat is None or plaster_mat.node_tree is None:
        return
    for node in plaster_mat.node_tree.nodes:
        if node.type == "AMBIENT_OCCLUSION":
            node.samples = 1
        elif node.type == "BSDF_PRINCIPLED":
            for nm in ("Subsurface Weight", "Subsurface"):
                if nm in node.inputs:
                    node.inputs[nm].default_value = 0.0


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

    scene.render.fps, scene.frame_start, scene.frame_end = int(fps), 1, int(n_frames)
    prev_quat: Any = None
    for f in range(0, n_frames + 2):
        st = rig.evaluate((f - 1) / float(n_frames - 1) * rig.duration_sec)
        loc, rot_q, _ = camera_rig.look_at_matrix(st["eye"], st["target"]).decompose()
        if prev_quat is not None and prev_quat.dot(rot_q) < 0.0:
            rot_q = -rot_q
        prev_quat = rot_q.copy()

        cam_obj.rotation_mode = "QUATERNION"
        cam_obj.location, cam_obj.rotation_quaternion = loc, rot_q
        cam_obj.data.lens, cam_obj.data.shift_x, cam_obj.data.shift_y = float(st["lens_mm"]), float(st["shift_x"]), float(st["shift_y"])
        cam_obj.data.dof.use_dof, cam_obj.data.dof.aperture_fstop = True, float(st["fstop"])
        focus_obj.location = Vector(st["focus_point"])
        for obj, dp in ((cam_obj, "location"), (cam_obj, "rotation_quaternion"), (cam_obj.data, "lens"), (cam_obj.data, "shift_y"), (cam_obj.data.dof, "aperture_fstop"), (focus_obj, "location")):
            obj.keyframe_insert(data_path=dp, frame=f)
        if key_light is not None:
            environments.update_key_light_azimuth(env_refs, st["sun_az"], elevation_deg=st["sun_el"])
            key_light.keyframe_insert(data_path="location", frame=f)
            key_light.keyframe_insert(data_path="rotation_euler", frame=f)

    for db in (cam_obj, cam_obj.data, focus_obj, key_light):
        if db is not None and db.animation_data is not None and db.animation_data.action is not None:
            for fc in _iter_action_fcurves(db.animation_data.action):
                for kp in fc.keyframe_points:
                    kp.interpolation = "BEZIER"
                    kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"


def _render_env_pass(
    env_name: str, args: argparse.Namespace, frames_to_render: Sequence[int],
    n_frames: int, width: int, height: int, out_dir: Path,
    room_safe: bool, animate_key_light: bool,
    apply_overrides: bool = True, base_sun_az_override: Optional[float] = None,
) -> Dict[str, Any]:
    """Build clean Blender scene for one environment and render the requested frames."""
    import bpy  # type: ignore

    from studio_blender import environments, materials, stl_loader
    from studio_blender.kinder_camera_curves import KinderCameraRig, validate_kinder_trajectory
    from studio_blender.studio_presets import resolve_env_name
    from studio_blender.worker_render import build_product_assembly, configure_cycles_metal

    canonical_env, t_pass = resolve_env_name(env_name), time.time()
    scene = bpy.context.scene
    _clear_blender_scene(scene)

    cycles_info = configure_cycles_metal(scene, int(args.samples), width, height, motion_blur=True)
    scene.render.use_motion_blur, scene.render.motion_blur_shutter = True, float(args.shutter)
    for attr, val in (("motion_blur_position", "CENTER"), ("adaptive_threshold", 0.032)):
        if hasattr(scene.cycles, attr):
            setattr(scene.cycles, attr, val)
    scene.cycles.max_bounces, scene.cycles.diffuse_bounces, scene.cycles.glossy_bounces = 6, 3, 3
    scene.cycles.transmission_bounces, scene.cycles.transparent_max_bounces, scene.cycles.volume_bounces = 6, 6, 0
    if hasattr(scene.render, "use_persistent_data"):
        scene.render.use_persistent_data = True

    plaster_mat = materials.make_plaster_cement_material()
    _optimize_video_shader(plaster_mat)
    lr = stl_loader.load_city_stls(list(args.stl), args.frame, args.frame_width_mm, args.frame_mm, plaster_mat)
    title = args.title.strip() if args.title else stl_loader.infer_city_title(list(args.stl))
    fi, analysis = build_product_assembly(
        scene, lr, args.frame, title, "desk_flat",
        args.frame_width_mm, args.frame_height_mm, args.backing_finish, bool(args.show_nameplate),
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
    env_kw: Dict[str, Any] = {"env_name": canonical_env, "model_bounds": model_bounds, "mount": "desk_flat"}
    if apply_overrides:
        env_kw.update({
            "surface_override": args.surface, "window_gobo_override": args.window_gobo,
            "hdri_override": args.hdri, "sun_azimuth_deg": args.sun_azimuth,
            "light_temp": args.light_temp, "add_props": args.add_prop,
            "remove_props": args.remove_prop, "clear_props": bool(args.clear_props),
        })
    env_refs = environments.build_environment(**_filter_kwargs(environments.build_environment, env_kw))
    if bpy.data.objects.get("Env_VolumetricHazeBox") is not None:
        bpy.data.objects["Env_VolumetricHazeBox"].hide_render = True

    default_az = float(env_refs.get("key_rig_meta", {}).get("azimuth_deg", 54.0))
    base_az = float(base_sun_az_override if base_sun_az_override is not None else (args.sun_azimuth if (apply_overrides and args.sun_azimuth is not None) else default_az))
    rig = KinderCameraRig(analysis, model_bounds, width / float(height), base_az, float(args.duration), room_safe=room_safe)
    validation = validate_kinder_trajectory(rig, fps=int(args.fps))
    _keyframe_continuous_rig(scene, rig, n_frames, int(args.fps), env_refs, animate_key_light=animate_key_light)

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
            print(f"[KINDER:{canonical_env}] {idx}/{len(frames_to_render)} (f={f}) avg={el / idx:.2f}s/f total={el:.1f}s", flush=True)

    r_sec = time.time() - t_r0
    return {
        "env": canonical_env, "frames": rendered_paths, "frame_count": len(rendered_paths),
        "avg_sec_per_frame": round(r_sec / max(1, len(rendered_paths)), 3),
        "render_elapsed_sec": round(r_sec, 2), "pass_elapsed_sec": round(time.time() - t_pass, 2),
        "cycles": cycles_info, "validation": validation, "placed_props": env_refs.get("placed_props", []),
    }


def _run_blender_worker(args: argparse.Namespace) -> int:
    from studio_blender.kinder_camera_curves import RAW_STUDIO_ENVS
    from studio_blender.studio_presets import resolve_env_name

    out_dir, width, height = Path(args.out).resolve(), *_parse_wh(args.resolution, args.aspect)
    frames_root = out_dir / "_frames"
    fps, duration_sec = int(args.fps), float(args.duration)
    n_frames = max(2, int(round(duration_sec * fps)))
    canonical_env = resolve_env_name(args.env)
    room_safe = canonical_env not in RAW_STUDIO_ENVS
    use_packshot = args.packshot_env.lower() not in ("", "none", "off")
    dissolve_start = float(args.dissolve_start) if args.dissolve_start is not None else max(1.0, duration_sec - 1.25)
    white_start = max(2, min(n_frames - 2, int(round(dissolve_start * fps)) + 1))
    dark_end = min(n_frames, white_start + max(2, int(round(float(args.dissolve_dur) * fps))) - 1) if use_packshot else n_frames

    if args.preview_only:
        s_frames = sorted({max(1, min(n_frames, int(round(i * (n_frames - 1) / 11.0)) + 1)) for i in range(12)})
        dark_frames = [f for f in s_frames if (not use_packshot or f <= dark_end)]
        white_frames = [f for f in s_frames if (use_packshot and f >= white_start)]
    else:
        dark_frames = list(range(1, dark_end + 1))
        white_frames = list(range(white_start, n_frames + 1)) if use_packshot else []

    t0 = time.time()
    main_info = _render_env_pass(canonical_env, args, dark_frames, n_frames, width, height, frames_root / "dark", room_safe, True, True)
    white_info = (
        _render_env_pass(args.packshot_env, args, white_frames, n_frames, width, height, frames_root / "white", room_safe, False, False, 54.0)
        if white_frames else None
    )
    manifest = {
        "status": "ok", "mode": "kinder_continuous", "preview_only": bool(args.preview_only),
        "env": canonical_env, "frame": args.frame, "room_safe": room_safe,
        "stl_paths": [str(Path(p).resolve()) for p in args.stl], "resolution": [width, height],
        "fps": fps, "duration_sec": duration_sec, "n_frames": n_frames, "shutter": float(args.shutter),
        "samples": int(args.samples), "use_packshot": use_packshot, "white_start_frame": white_start,
        "dark_end_frame": dark_end, "overlap_frames": (dark_end - white_start + 1) if use_packshot else 0,
        "dark_pass": main_info, "white_pass": white_info, "total_render_sec": round(time.time() - t0, 2),
    }
    mp = Path(args.manifest).resolve() if args.manifest else (out_dir / "kinder_render_manifest.json")
    mp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[KINDER_MANIFEST] {mp}", flush=True)
    return 0


def _run_ffmpeg(args: Sequence[str], label: str) -> None:
    ffmpeg = find_ffmpeg_binary()
    if not ffmpeg:
        raise RuntimeError(f"ffmpeg binary not found; cannot run {label}.")
    proc = subprocess.run([ffmpeg, "-y", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg {label} failed (rc={proc.returncode}):\n{proc.stderr[-1200:]}")


def _encode_kinder_mp4(manifest: Dict[str, Any], out_dir: Path, video_name: str) -> str:
    fps, froot, out_mp4 = int(manifest["fps"]), out_dir / "_frames", out_dir / video_name
    d_in = ["-framerate", str(fps), "-start_number", "1", "-i", str(froot / "dark" / "frame_%04d.png")]
    enc = ["-r", str(fps), "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-movflags", "+faststart", str(out_mp4)]
    if manifest["use_packshot"] and manifest.get("white_pass"):
        ws, ov = int(manifest["white_start_frame"]), int(manifest["overlap_frames"])
        w_in = ["-framerate", str(fps), "-start_number", str(ws), "-i", str(froot / "white" / "frame_%04d.png")]
        flt = f"[0:v][1:v]xfade=transition=fade:duration={ov / fps:.6f}:offset={(ws - 1) / fps:.6f},format=yuv420p[v]"
        _run_ffmpeg([*d_in, *w_in, "-filter_complex", flt, "-map", "[v]", *enc], "MP4 encode")
    else:
        _run_ffmpeg([*d_in, "-vf", "format=yuv420p", *enc], "MP4 encode")
    return str(out_mp4)


def _build_filmstrip(mp4_path: Path, n_frames: int, out_png: Path) -> str:
    expr = "+".join(f"eq(n\\,{int(round(i * (n_frames - 1) / 11.0))})" for i in range(12))
    vf = f"select='{expr}',scale=360:640,tile=6x2:padding=6:margin=8:color=0x111111"
    _run_ffmpeg(["-i", str(mp4_path), "-vf", vf, "-vsync", "vfr", "-frames:v", "1", str(out_png)], "filmstrip")
    return str(out_png)


def _build_preview_strip(manifest: Dict[str, Any], out_png: Path) -> str:
    dl, wl = list(manifest.get("dark_pass", {}).get("frames", [])), list((manifest.get("white_pass") or {}).get("frames", []))
    picked = (dl[: max(0, 12 - len(wl))] + wl if wl else dl)[:12]
    ins = [x for fp in picked for x in ("-i", fp)]
    sc = "".join(f"[{i}:v]scale=360:640[v{i}];" for i in range(len(picked)))
    st = "".join(f"[v{i}]" for i in range(len(picked)))
    _run_ffmpeg([*ins, "-filter_complex", f"{sc}{st}concat=n={len(picked)}:v=1:a=0,tile=6x2:padding=6:margin=8:color=0x111111[out]", "-map", "[out]", "-frames:v", "1", str(out_png)], "preview strip")
    return str(out_png)


def run_kinder_video(
    stl_paths: Sequence[str], out_dir: str, env: str = "09_dark_cinematic",
    frame: str = "single_13x18", packshot_env: str = "11_packshot_white",
    aspect: str = "9:16", resolution: Optional[str] = None, fps: int = 24,
    duration_sec: float = 11.0, dissolve_start: Optional[float] = None,
    dissolve_dur: float = 0.45, samples: int = 32, shutter: float = 0.55,
    frame_mm: Optional[str] = None, frame_width_mm: float = 4.0, frame_height_mm: float = 7.5,
    backing_finish: str = "matte_black", show_nameplate: bool = False, title: Optional[str] = None,
    surface: Optional[str] = None, window_gobo: Optional[str] = None, hdri: Optional[str] = None,
    light_temp: Optional[float] = None, sun_azimuth: Optional[float] = None,
    add_props: Optional[Sequence[str]] = None, remove_props: Optional[Sequence[str]] = None,
    clear_props: bool = False, video_name: Optional[str] = None, filmstrip_name: Optional[str] = None,
    preview_only: bool = False, keep_frames: bool = False, blender_bin: Optional[str] = None,
    verbose: bool = True,
) -> Dict[str, Any]:
    """Programmatic entry point used by both CLI and studio-blender MCP server."""
    out_path = Path(out_dir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)
    vname = video_name or f"{env}_kinder_9x16.mp4"
    vname = vname if vname.lower().endswith(".mp4") else f"{vname}.mp4"
    fname = filmstrip_name or f"{Path(vname).stem}_filmstrip.png"
    mpath = out_path / f"{Path(vname).stem}_manifest.json"
    w, h = _parse_wh(resolution, aspect)

    cmd: List[str] = [
        find_blender_binary(blender_bin), "--background", "--factory-startup", "--python-exit-code", "1",
        "--python", str(_THIS_FILE), "--", "--blender-worker", "--out", str(out_path), "--manifest", str(mpath),
        "--env", env, "--frame", frame, "--packshot-env", packshot_env, "--aspect", aspect,
        "--resolution", f"{w}x{h}", "--fps", str(int(fps)), "--duration", str(float(duration_sec)),
        "--dissolve-dur", str(float(dissolve_dur)), "--samples", str(int(samples)), "--shutter", str(float(shutter)),
        "--frame-width-mm", str(float(frame_width_mm)), "--frame-height-mm", str(float(frame_height_mm)),
        "--backing-finish", backing_finish, "--video-name", vname,
    ]
    cmd.extend(x for p in stl_paths for x in ("--stl", str(Path(p).resolve())))
    opt_vals = (
        ("--dissolve-start", dissolve_start), ("--frame-mm", frame_mm), ("--title", title),
        ("--surface", surface), ("--window-gobo", window_gobo), ("--hdri", hdri),
        ("--light-temp", light_temp), ("--sun-azimuth", sun_azimuth),
    )
    cmd.extend(x for flg, val in opt_vals if val is not None for x in (flg, str(val)))
    cmd.extend(x for s in (add_props or ()) for x in ("--add-prop", s))
    cmd.extend(x for pid in (remove_props or ()) for x in ("--remove-prop", pid))
    cmd.extend(flg for flg, on in (("--clear-props", clear_props), ("--show-nameplate", show_nameplate), ("--preview-only", preview_only)) if on)

    t0 = time.time()
    proc = subprocess.run(cmd) if verbose else subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Blender Kinder worker failed (rc={proc.returncode}){'' if verbose else chr(10) + (proc.stderr or '')[-1500:]}")

    manifest: Dict[str, Any] = json.loads(mpath.read_text(encoding="utf-8"))
    if preview_only:
        manifest["preview_strip_path"] = _build_preview_strip(manifest, out_path / f"{Path(vname).stem}_preview.png")
    else:
        mp4 = _encode_kinder_mp4(manifest, out_path, vname)
        manifest["video_path"] = mp4
        manifest["filmstrip_path"] = _build_filmstrip(Path(mp4), int(manifest["n_frames"]), out_path / fname)
    if not keep_frames:
        shutil.rmtree(out_path / "_frames", ignore_errors=True)
    manifest["total_wall_sec"] = round(time.time() - t0, 2)
    mpath.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Universal Kinder-style Cycles Metal commercial renderer")
    specs: Tuple[Tuple[str, Dict[str, Any]], ...] = (
        ("--stl", {"action": "append", "default": None}), ("--out", {"required": True}),
        ("--env", {"default": "09_dark_cinematic"}), ("--frame", {"default": "single_13x18"}),
        ("--packshot-env", {"default": "11_packshot_white"}), ("--aspect", {"default": "9:16"}),
        ("--resolution", {"default": None}), ("--fps", {"type": int, "default": 24}),
        ("--duration", {"type": float, "default": 11.0}), ("--dissolve-start", {"type": float, "default": None}),
        ("--dissolve-dur", {"type": float, "default": 0.45}), ("--samples", {"type": int, "default": 32}),
        ("--shutter", {"type": float, "default": 0.55}), ("--frame-mm", {"default": None}),
        ("--frame-width-mm", {"type": float, "default": 4.0}), ("--frame-height-mm", {"type": float, "default": 7.5}),
        ("--backing-finish", {"default": "matte_black"}), ("--show-nameplate", {"action": "store_true", "default": False}),
        ("--title", {"default": None}), ("--surface", {"default": None}), ("--window-gobo", {"default": None}),
        ("--hdri", {"default": None}), ("--light-temp", {"type": float, "default": None}),
        ("--sun-azimuth", {"type": float, "default": None}), ("--add-prop", {"action": "append", "default": None}),
        ("--remove-prop", {"action": "append", "default": None}), ("--clear-props", {"action": "store_true", "default": False}),
        ("--video-name", {"default": "nyc_wtc_kinder_commercial_9x16.mp4"}), ("--filmstrip-name", {"default": None}),
        ("--preview-only", {"action": "store_true", "default": False}), ("--keep-frames", {"action": "store_true", "default": False}),
        ("--blender-bin", {"default": None}), ("--manifest", {"default": None}),
        ("--blender-worker", {"action": "store_true", "default": False, "help": argparse.SUPPRESS}),
    )
    for flg, kw in specs:
        p.add_argument(flg, **kw)
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    raw = list(argv) if argv is not None else (sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:])
    args = _build_parser().parse_args(raw)
    if not args.stl:
        args.stl = list(DEFAULT_NYC_STLS)
    if args.blender_worker:
        return _run_blender_worker(args)
    kw = {k: v for k, v in vars(args).items() if k not in ("stl", "out", "duration", "add_prop", "remove_prop", "manifest", "blender_worker")}
    manifest = run_kinder_video(
        stl_paths=args.stl, out_dir=args.out, duration_sec=args.duration,
        add_props=args.add_prop, remove_props=args.remove_prop, verbose=True, **kw,
    )
    print(json.dumps({k: manifest.get(k) for k in ("video_path", "filmstrip_path", "preview_strip_path", "total_wall_sec")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
