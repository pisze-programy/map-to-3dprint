#!/usr/bin/env python3
"""Universal Kinder-style Cycles Metal commercial video renderer.

Supports both 5-angle whip-match-cut cinema choreography (`kinder_multishot`,
default) and single-take continuous C2 spline (`kinder_continuous`), across any
city STL, any studio/persona environment (01..17), anti-flicker Cycles/OIDN
settings, gentle ffmpeg hqdn3d temporal polish, and optional white packshot CTA.
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
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

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
WHIP_OVERLAP_FRAMES = 2


def _parse_wh(res_str: Optional[str], aspect: str = "9:16") -> Tuple[int, int]:
    if not res_str:
        return ASPECT_VIDEO_RES.get(aspect, (540, 960))
    parts = res_str.lower().replace("x", " ").split()
    if len(parts) != 2:
        raise ValueError(f"Invalid --resolution '{res_str}', expected WxH.")
    return (int(parts[0]) & ~1, int(parts[1]) & ~1)


def _filter_kwargs(fn: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return kwargs
    return kwargs if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()) else {k: v for k, v in kwargs.items() if k in params}


def _iter_action_fcurves(action: Any) -> List[Any]:
    if hasattr(action, "fcurves"):
        try:
            return list(action.fcurves)
        except Exception:
            pass
    return [fc for lay in getattr(action, "layers", ()) for st in getattr(lay, "strips", ()) for bag in getattr(st, "channelbags", ()) for fc in getattr(bag, "fcurves", ())]


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


def _configure_antiflicker_cycles(scene: Any, samples: int, width: int, height: int, shutter: float) -> Dict[str, Any]:
    """Configure Metal Cycles + OIDN ACCURATE prefilter + animated seed + motion blur."""
    from studio_blender.worker_render import configure_cycles_metal

    info = configure_cycles_metal(scene, int(samples), width, height, motion_blur=True)
    scene.render.use_motion_blur, scene.render.motion_blur_shutter = True, float(shutter)
    for attr, val in (("motion_blur_position", "CENTER"), ("use_animated_seed", True), ("adaptive_threshold", 0.015), ("sample_clamp_direct", 12.0), ("sample_clamp_indirect", 4.0), ("denoising_input_passes", "RGB_ALBEDO_NORMAL"), ("denoising_prefilter", "ACCURATE")):
        if hasattr(scene.cycles, attr):
            setattr(scene.cycles, attr, val)
    scene.cycles.max_bounces, scene.cycles.diffuse_bounces, scene.cycles.glossy_bounces = 6, 3, 3
    scene.cycles.transmission_bounces, scene.cycles.transparent_max_bounces, scene.cycles.volume_bounces = 6, 6, 0
    if hasattr(scene.render, "use_persistent_data"):
        scene.render.use_persistent_data = True
    return info


def _keyframe_pose_sequence(
    scene: Any, eval_fn: Callable[[int], Dict[str, Any]], n_frames: int,
    fps: int, env_refs: Dict[str, Any], animate_key_light: bool,
    frame_offset: int = 0, clear_existing: bool = True,
) -> None:
    """Keyframe local 0..n_frames+1 onto global frame_offset+f with quaternion continuity."""
    from mathutils import Vector  # type: ignore

    from studio_blender import camera_rig, environments

    cam_obj, focus_obj = camera_rig.ensure_studio_camera(scene)
    key_light = env_refs.get("key_light") if animate_key_light else None
    if clear_existing:
        for db in (cam_obj, cam_obj.data, focus_obj, key_light):
            if db is not None and db.animation_data is not None:
                db.animation_data_clear()

    scene.render.fps = int(fps)
    scene.frame_start = min(scene.frame_start, frame_offset + 1) if not clear_existing else frame_offset + 1
    scene.frame_end = max(scene.frame_end, frame_offset + n_frames) if not clear_existing else frame_offset + n_frames
    prev_quat: Any = None
    for f in range(0, n_frames + 2):
        gf = frame_offset + f
        st = eval_fn(f)
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
            obj.keyframe_insert(data_path=dp, frame=gf)
        if key_light is not None:
            environments.update_key_light_azimuth(env_refs, st["sun_az"], elevation_deg=st["sun_el"])
            key_light.keyframe_insert(data_path="location", frame=gf)
            key_light.keyframe_insert(data_path="rotation_euler", frame=gf)

    for db in (cam_obj, cam_obj.data, focus_obj, key_light):
        if db is not None and db.animation_data is not None and db.animation_data.action is not None:
            for fc in _iter_action_fcurves(db.animation_data.action):
                for kp in fc.keyframe_points:
                    kf = int(round(kp.co.x))
                    if kf == frame_offset or kf == frame_offset + n_frames + 1:
                        kp.interpolation = "LINEAR"
                    elif frame_offset < kf <= frame_offset + n_frames:
                        kp.interpolation = "BEZIER"
                        kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"


def _setup_scene_for_env(
    env_name: str, job: Dict[str, Any], width: int, height: int, apply_overrides: bool
) -> Tuple[Any, Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any], str]:
    """Load city STL(s), matte-black Variant C frame, and environment with anti-flicker Cycles."""
    import bpy  # type: ignore

    from studio_blender import environments, materials, stl_loader
    from studio_blender.studio_presets import resolve_env_name
    from studio_blender.worker_render import build_product_assembly

    canonical = resolve_env_name(env_name)
    scene = bpy.context.scene
    _clear_blender_scene(scene)
    cycles_info = _configure_antiflicker_cycles(scene, int(job["samples"]), width, height, float(job["shutter"]))

    plaster_mat = materials.make_plaster_cement_material()
    if plaster_mat is not None and plaster_mat.node_tree is not None:
        for nd in plaster_mat.node_tree.nodes:
            if nd.type == "AMBIENT_OCCLUSION":
                nd.samples = 1
            elif nd.type == "BSDF_PRINCIPLED":
                for nm in ("Subsurface Weight", "Subsurface"):
                    if nm in nd.inputs:
                        nd.inputs[nm].default_value = 0.0
    asm_manifest = job.get("assembly_manifest")
    stls = list(job.get("stl_paths") or [])
    is_draft_req = bool(job.get("draft_unvalidated", False))
    stl_loader.validate_render_source(asm_manifest, stls, draft_unvalidated=is_draft_req)
    if asm_manifest:
        lr = stl_loader.load_from_manifest(asm_manifest, frame_style=job["frame"], material=plaster_mat, allow_draft=is_draft_req)
        m_doc = lr.get("manifest") or {}
        default_title = str(m_doc.get("source_params", {}).get("title") or m_doc.get("city_slug") or "CITY MAP")
    else:
        lr = stl_loader.load_city_stls(stls, job["frame"], float(job["frame_width_mm"]), job.get("frame_mm"), plaster_mat)
        lr["draft_unvalidated"] = True
        default_title = stl_loader.infer_city_title(stls)
    title = (job.get("title") or "").strip() or default_title
    fi, analysis = build_product_assembly(
        scene, lr, job["frame"], title, "desk_flat",
        float(job["frame_width_mm"]), float(job["frame_height_mm"]), job["backing_finish"], bool(job["show_nameplate"]),
    )
    mb: Dict[str, Any] = {
        "frame_width_m": lr["total_width_m"], "frame_height_m": lr["total_height_m"], "outer_width_m": fi["outer_width_m"],
        "outer_height_m": fi["outer_height_m"], "max_z_m": lr["max_z_m"], "max_z": lr["max_z_m"], "desk_z_m": fi["desk_z"],
        "desk_z": fi["desk_z"], "frame_bottom_z": fi["frame_bottom_z"], "frame_top_z": fi["frame_top_z"], "wall_y": fi["wall_y"],
        "cover_top_z": fi["cover_top_z"], "mount": "desk_flat", "water_side": analysis["water_side"],
        "hero_peak": analysis["hero_peak"], "skyline_centroid": analysis["skyline_centroid"],
    }
    env_kw: Dict[str, Any] = {"env_name": canonical, "model_bounds": mb, "mount": "desk_flat", "is_video": True}
    if apply_overrides:
        env_kw.update({k: job.get(src) for k, src in (("surface_override", "surface"), ("window_gobo_override", "window_gobo"), ("hdri_override", "hdri"), ("sun_azimuth_deg", "sun_azimuth"), ("light_temp", "light_temp"), ("add_props", "add_props"), ("remove_props", "remove_props"))})
        env_kw["clear_props"] = bool(job.get("clear_props", False))
    env_refs = environments.build_environment(**_filter_kwargs(environments.build_environment, env_kw))
    if bpy.data.objects.get("Env_VolumetricHazeBox") is not None:
        bpy.data.objects["Env_VolumetricHazeBox"].hide_render = True
    return scene, cycles_info, analysis, mb, env_refs, canonical


def _render_frame_list(
    scene: Any, frames: Sequence[int], out_dir: Path, tag: str, frame_offset: int = 0
) -> Tuple[List[str], float]:
    import bpy  # type: ignore

    out_dir.mkdir(parents=True, exist_ok=True)
    paths, t0 = [], time.time()
    for idx, f in enumerate(frames, start=1):
        scene.frame_set(int(frame_offset + f))
        fpath = out_dir / f"frame_{f:04d}.png"
        scene.render.filepath = str(fpath)
        bpy.ops.render.render(write_still=True)
        paths.append(str(fpath))
        if idx == 1 or idx % 24 == 0 or idx == len(frames):
            el = time.time() - t0
            print(f"[KINDER:{tag}] {idx}/{len(frames)} (f={f}) avg={el / idx:.2f}s/f total={el:.1f}s", flush=True)
    return paths, time.time() - t0


def _run_blender_worker(job_path: Path) -> int:
    from studio_blender.kinder_camera_curves import KinderCameraRig, RAW_STUDIO_ENVS, validate_kinder_trajectory
    from studio_blender.kinder_shots import (
        build_kinder_multishot_plan, compute_multishot_frame_budget,
        evaluate_kinder_shot, validate_multishot_plan,
    )
    from studio_blender.studio_presets import resolve_env_name

    job: Dict[str, Any] = json.loads(job_path.read_text(encoding="utf-8"))
    out_dir, width, height = Path(job["out_dir"]).resolve(), int(job["width"]), int(job["height"])
    froot, fps, dur = out_dir / "_frames", int(job["fps"]), float(job["duration_sec"])
    canonical = resolve_env_name(job["env"])
    room_safe = canonical not in RAW_STUDIO_ENVS
    pack_env = str(job["packshot_env"])
    use_packshot = pack_env.lower() not in ("", "none", "off")
    ov_pack = max(2, int(round(float(job["dissolve_dur"]) * fps))) if use_packshot else 0
    preview = bool(job.get("preview_only", False))
    t0 = time.time()

    scene, c_info, analysis, mb, env_refs, _ = _setup_scene_for_env(canonical, job, width, height, apply_overrides=True)
    base_az = float(job["sun_azimuth"] if job.get("sun_azimuth") is not None else env_refs.get("key_rig_meta", {}).get("azimuth_deg", 52.0))
    aspect_f = width / float(height)

    segments: List[Dict[str, Any]] = []
    white_info: Optional[Dict[str, Any]] = None

    def _run_white(eval_builder: Callable[[Dict[str, Any], Dict[str, Any]], Callable[[int], Dict[str, Any]]], nf_w: int, ws_w: int, ov_w: int, wlist_w: Sequence[int]) -> Dict[str, Any]:
        sc_w, _, an_w, mb_w, er_w, _ = _setup_scene_for_env(pack_env, job, width, height, apply_overrides=False)
        _keyframe_pose_sequence(sc_w, eval_builder(an_w, mb_w), nf_w, fps, er_w, False)
        wp, ws_sec = _render_frame_list(sc_w, wlist_w, froot / "white", pack_env)
        return {"env": pack_env, "dir": str(froot / "white"), "start_frame": ws_w, "frame_count": nf_w - ws_w + 1, "overlap_in": ov_w, "frames": wp, "render_sec": round(ws_sec, 2)}

    if job["camera_mode"] == "kinder_multishot":
        shots = build_kinder_multishot_plan(analysis, mb, aspect_f, base_az, dur, room_safe=room_safe)
        counts = compute_multishot_frame_budget(shots, fps=fps, whip_overlap_frames=WHIP_OVERLAP_FRAMES)
        validation = validate_multishot_plan(shots, analysis, mb, aspect_f, fps, room_safe=room_safe)
        n_total_stitched, nf5 = int(validation["stitched_frames"]), counts[-1]
        ws5 = max(8, nf5 - max(ov_pack + 14, int(round(1.25 * fps))) + 1)
        de5 = min(nf5, ws5 + ov_pack - 1) if use_packshot else nf5
        offsets = [10 + idx * 120 for idx in range(len(shots))]
        for idx, (shot, nf, off) in enumerate(zip(shots, counts, offsets)):
            _keyframe_pose_sequence(scene, lambda f, sh=shot, n=nf: evaluate_kinder_shot(sh, (f - 1) / float(n - 1), mb["desk_z"], room_safe), nf, fps, env_refs, True, frame_offset=off, clear_existing=(idx == 0))
        for idx, (shot, nf, off) in enumerate(zip(shots, counts, offsets)):
            is_last = idx == len(shots) - 1
            end_f = de5 if is_last else nf
            flist = [max(1, min(end_f, int(round(end_f * q)))) for q in ((0.2, 0.7) if not is_last else (0.25, 0.75))] if preview else list(range(1, end_f + 1))
            paths, rsec = _render_frame_list(scene, flist, froot / shot.shot_id, f"{canonical}:{shot.shot_id}", frame_offset=off)
            segments.append({"shot_id": shot.shot_id, "dir": str(froot / shot.shot_id), "start_frame": 1, "frame_count": end_f, "overlap_in": 0 if idx == 0 else WHIP_OVERLAP_FRAMES, "frames": paths, "render_sec": round(rsec, 2)})
        if use_packshot:
            wlist = [ws5 + ov_pack // 2, nf5] if preview else list(range(ws5, nf5 + 1))
            white_info = _run_white(lambda a, m: (lambda f, sh=build_kinder_multishot_plan(a, m, aspect_f, base_az, dur, room_safe)[-1]: evaluate_kinder_shot(sh, (f - 1) / float(nf5 - 1), m["desk_z"], room_safe)), nf5, ws5, de5 - ws5 + 1, wlist)
    else:
        n_total_stitched = max(2, int(round(dur * fps)))
        ds = float(job["dissolve_start"]) if job.get("dissolve_start") is not None else max(1.0, dur - 1.25)
        ws = max(2, min(n_total_stitched - 2, int(round(ds * fps)) + 1))
        de = min(n_total_stitched, ws + ov_pack - 1) if use_packshot else n_total_stitched
        rig = KinderCameraRig(analysis, mb, aspect_f, base_az, dur, room_safe=room_safe)
        validation = validate_kinder_trajectory(rig, fps=fps)
        _keyframe_pose_sequence(scene, lambda f: rig.evaluate((f - 1) / float(n_total_stitched - 1) * dur), n_total_stitched, fps, env_refs, True)
        sf = sorted({max(1, min(n_total_stitched, int(round(i * (n_total_stitched - 1) / 11.0)) + 1)) for i in range(12)})
        flist = [f for f in sf if (not use_packshot or f <= de)] if preview else list(range(1, de + 1))
        paths, rsec = _render_frame_list(scene, flist, froot / "dark", canonical)
        segments.append({"shot_id": "continuous", "dir": str(froot / "dark"), "start_frame": 1, "frame_count": de, "overlap_in": 0, "frames": paths, "render_sec": round(rsec, 2)})
        if use_packshot:
            wlist = [f for f in sf if f >= ws] if preview else list(range(ws, n_total_stitched + 1))
            white_info = _run_white(lambda a, m: (lambda f, r=KinderCameraRig(a, m, aspect_f, base_az, dur, room_safe=room_safe): r.evaluate((f - 1) / float(n_total_stitched - 1) * dur)), n_total_stitched, ws, de - ws + 1, wlist)

    manifest = {
        "status": "ok", "camera_mode": job["camera_mode"], "preview_only": preview,
        "env": canonical, "frame": job["frame"], "room_safe": room_safe,
        "assembly_manifest": job.get("assembly_manifest"), "draft_unvalidated": bool(job.get("draft_unvalidated", False)),
        "stl_paths": [str(Path(p).resolve()) for p in (job.get("stl_paths") or [])], "resolution": [width, height],
        "fps": fps, "duration_sec": dur, "n_frames": n_total_stitched,
        "shutter": float(job["shutter"]), "samples": int(job["samples"]), "use_packshot": use_packshot,
        "cycles": c_info, "validation": validation, "placed_props": env_refs.get("placed_props", []),
        "segments": segments, "white_pass": white_info, "total_render_sec": round(time.time() - t0, 2),
    }
    mp = Path(job["manifest_path"]).resolve()
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
    fps, out_mp4 = int(manifest["fps"]), out_dir / video_name
    segs = list(manifest["segments"]) + ([manifest["white_pass"]] if (manifest.get("use_packshot") and manifest.get("white_pass")) else [])
    ins = [x for s in segs for x in ("-framerate", str(fps), "-start_number", str(s["start_frame"]), "-i", str(Path(s["dir"]) / "frame_%04d.png"))]
    polish, enc = "hqdn3d=1.0:1.0:3.0:3.0,format=yuv420p", ["-r", str(fps), "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-movflags", "+faststart", str(out_mp4)]
    if len(segs) == 1:
        _run_ffmpeg([*ins, "-vf", polish, *enc], "MP4 encode")
    else:
        fparts, cur_lbl, cur_len = [], "[0:v]", int(segs[0]["frame_count"])
        for i in range(1, len(segs)):
            ov, nxt = max(1, int(segs[i]["overlap_in"])), f"[x{i}]"
            fparts.append(f"{cur_lbl}[{i}:v]xfade=transition=fade:duration={ov / fps:.6f}:offset={(cur_len - ov) / fps:.6f}{nxt}")
            cur_lbl, cur_len = nxt, cur_len + int(segs[i]["frame_count"]) - ov
        _run_ffmpeg([*ins, "-filter_complex", ";".join([*fparts, f"{cur_lbl}{polish}[vout]"]), "-map", "[vout]", *enc], "MP4 encode")
    return str(out_mp4)


def _build_filmstrip(mp4_path: Path, n_frames: int, out_png: Path, count: int = 15) -> str:
    cols, rows = (5, 3) if count == 15 else (6, 2)
    expr = "+".join(f"eq(n\\,{int(round(i * (n_frames - 1) / float(count - 1)))})" for i in range(count))
    _run_ffmpeg(["-i", str(mp4_path), "-vf", f"select='{expr}',scale=360:640,tile={cols}x{rows}:padding=6:margin=8:color=0x111111", "-vsync", "vfr", "-frames:v", "1", str(out_png)], "filmstrip")
    return str(out_png)


def _build_preview_strip(manifest: Dict[str, Any], out_png: Path) -> str:
    picked = ([fp for s in manifest.get("segments", []) for fp in s.get("frames", [])] + list((manifest.get("white_pass") or {}).get("frames", [])))[:12]
    ins = [x for fp in picked for x in ("-i", fp)]
    sc = "".join(f"[{i}:v]scale=360:640[v{i}];" for i in range(len(picked)))
    st = "".join(f"[v{i}]" for i in range(len(picked)))
    _run_ffmpeg([*ins, "-filter_complex", f"{sc}{st}concat=n={len(picked)}:v=1:a=0,tile=6x2:padding=6:margin=8:color=0x111111[out]", "-map", "[out]", "-frames:v", "1", str(out_png)], "preview strip")
    return str(out_png)


_DEFAULT_JOB_OPTS: Dict[str, Any] = {
    "env": "09_dark_cinematic", "frame": "single_13x18", "packshot_env": "11_packshot_white",
    "camera_mode": "kinder_multishot", "aspect": "9:16", "resolution": None, "fps": 24,
    "duration_sec": 10.5, "dissolve_start": None, "dissolve_dur": 0.45, "samples": 56,
    "shutter": 0.68, "frame_mm": None, "frame_width_mm": 4.0, "frame_height_mm": 7.5,
    "backing_finish": "matte_black", "show_nameplate": False, "title": None, "surface": None,
    "window_gobo": None, "hdri": None, "light_temp": None, "sun_azimuth": None,
    "add_props": None, "remove_props": None, "clear_props": False, "video_name": None,
    "filmstrip_name": None, "preview_only": False, "keep_frames": False, "blender_bin": None,
    "assembly_manifest": None, "draft_unvalidated": False, "verbose": True,
}


def run_kinder_video(stl_paths: Optional[Sequence[str]] = None, out_dir: str = "./studio_renders", **kwargs: Any) -> Dict[str, Any]:
    """Programmatic entry point used by both CLI and studio-blender MCP server."""
    from studio_blender.stl_loader import apply_draft_prefix, validate_render_source

    cfg: Dict[str, Any] = {**_DEFAULT_JOB_OPTS, **kwargs}
    asm_manifest = cfg.get("assembly_manifest") or cfg.get("manifest_path")
    _, is_draft = validate_render_source(asm_manifest, stl_paths, draft_unvalidated=bool(cfg.get("draft_unvalidated", False)))
    out_path = Path(out_dir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)
    vname = cfg["video_name"] or f"{cfg['env']}_kinder_9x16.mp4"
    vname = apply_draft_prefix(vname if vname.lower().endswith(".mp4") else f"{vname}.mp4", is_draft)
    fname = apply_draft_prefix(cfg["filmstrip_name"] or f"{Path(vname).stem}_filmstrip.png", is_draft)
    mpath, jpath = out_path / f"{Path(vname).stem}_manifest.json", out_path / f".{Path(vname).stem}_job.json"
    w, h = _parse_wh(cfg["resolution"], str(cfg["aspect"]))
    job = {
        **cfg,
        "assembly_manifest": str(Path(asm_manifest).resolve()) if asm_manifest else None,
        "draft_unvalidated": is_draft,
        "stl_paths": [str(Path(p).resolve()) for p in (stl_paths or [])],
        "out_dir": str(out_path), "manifest_path": str(mpath), "width": w, "height": h,
        "add_props": list(cfg["add_props"]) if cfg["add_props"] else None,
        "remove_props": list(cfg["remove_props"]) if cfg["remove_props"] else None,
    }
    jpath.write_text(json.dumps(job, indent=2), encoding="utf-8")
    cmd = [find_blender_binary(cfg["blender_bin"]), "--background", "--factory-startup", "--python-exit-code", "1", "--python", str(_THIS_FILE), "--", "--blender-worker", "--job", str(jpath)]
    t0, verbose = time.time(), bool(cfg["verbose"])
    try:
        proc = subprocess.run(cmd) if verbose else subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"Blender Kinder worker failed (rc={proc.returncode}){'' if verbose else chr(10) + (proc.stderr or '')[-1500:]}")
    finally:
        jpath.unlink(missing_ok=True)
    manifest: Dict[str, Any] = json.loads(mpath.read_text(encoding="utf-8"))
    manifest["draft_unvalidated"] = is_draft
    if cfg["preview_only"]:
        manifest["preview_strip_path"] = _build_preview_strip(manifest, out_path / apply_draft_prefix(f"{Path(vname).stem}_preview.png", is_draft))
    else:
        mp4 = _encode_kinder_mp4(manifest, out_path, vname)
        manifest["video_path"], manifest["filmstrip_path"] = mp4, _build_filmstrip(Path(mp4), int(manifest["n_frames"]), out_path / fname)
    if not cfg["keep_frames"]:
        shutil.rmtree(out_path / "_frames", ignore_errors=True)
    manifest["total_wall_sec"] = round(time.time() - t0, 2)
    mpath.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Universal Kinder-style Cycles Metal commercial renderer")
    for flg in ("--out", "--manifest", "--resolution", "--frame-mm", "--title", "--surface", "--window-gobo", "--hdri", "--filmstrip-name", "--blender-bin"):
        p.add_argument(flg)
    for flg in ("--stl", "--add-prop", "--remove-prop"):
        p.add_argument(flg, action="append")
    for flg in ("--draft-unvalidated", "--show-nameplate", "--clear-props", "--preview-only", "--keep-frames"):
        p.add_argument(flg, action="store_true")
    for flg, df in (("--env", "09_dark_cinematic"), ("--frame", "single_13x18"), ("--packshot-env", "11_packshot_white"), ("--aspect", "9:16"), ("--backing-finish", "matte_black"), ("--video-name", "nyc_wtc_kinder_commercial_9x16.mp4")):
        p.add_argument(flg, default=df)
    p.add_argument("--camera-mode", default="kinder_multishot", choices=("kinder_multishot", "kinder_continuous"))
    for flg, tp, df in (("--fps", int, 24), ("--samples", int, 56), ("--duration", float, 10.5), ("--dissolve-start", float, None), ("--dissolve-dur", float, 0.45), ("--shutter", float, 0.68), ("--frame-width-mm", float, 4.0), ("--frame-height-mm", float, 7.5), ("--light-temp", float, None), ("--sun-azimuth", float, None)):
        p.add_argument(flg, type=tp, default=df)
    p.add_argument("--job", help=argparse.SUPPRESS)
    p.add_argument("--blender-worker", action="store_true", help=argparse.SUPPRESS)
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    raw = list(argv) if argv is not None else (sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:])
    args = _build_parser().parse_args(raw)
    if args.blender_worker:
        return _run_blender_worker(Path(args.job))
    if not args.out:
        print("ERROR: --out is required.", file=sys.stderr)
        return 1
    kw = {k: v for k, v in vars(args).items() if k not in ("stl", "manifest", "out", "duration", "add_prop", "remove_prop", "job", "blender_worker")}
    try:
        manifest = run_kinder_video(
            args.stl, args.out, assembly_manifest=args.manifest, duration_sec=args.duration,
            add_props=args.add_prop, remove_props=args.remove_prop, verbose=True, **kw,
        )
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({k: manifest.get(k) for k in ("video_path", "filmstrip_path", "preview_strip_path", "draft_unvalidated", "total_wall_sec")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
