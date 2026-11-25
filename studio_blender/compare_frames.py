#!/usr/bin/env python3
"""True-scale side-by-side packshot: OLD 13x18 thin vs NEW A4 21x29.7x3cm white passe-partout.

Supports separate STL inputs for each product (--old-stl for LEFT 13x18 thin frame,
--a4-stl for RIGHT A4 120x170mm solid-base tunnel-free frame; --stl falls back for both).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="True-scale side-by-side packshot: 13x18 thin vs A4 white passe-partout")
    p.add_argument("--manifest", default=None, help="Shared fallback validated assembly_manifest.json")
    p.add_argument("--old-manifest", default=None, help="Validated assembly_manifest.json for LEFT 13x18 frame")
    p.add_argument("--a4-manifest", default=None, help="Validated assembly_manifest.json for RIGHT A4 frame")
    p.add_argument("--draft-unvalidated", action="store_true", default=False, help="Allow unvalidated/raw-STL draft renders with DRAFT_UNVALIDATED_ prefix")
    p.add_argument("--stl", action="append", default=None, help="Shared fallback STL path(s) (requires --draft-unvalidated)")
    p.add_argument("--old-stl", action="append", default=None, help="STL path(s) for LEFT OLD 13x18 thin frame")
    p.add_argument("--a4-stl", action="append", default=None, help="STL path(s) for RIGHT NEW A4 120x170 frame")
    p.add_argument("--samples", type=int, default=64, help="Cycles samples (default 64)")
    p.add_argument("--width", type=int, default=1600, help="Output image width in pixels (default 1600)")
    p.add_argument("--gap-mm", type=float, default=46.0, help="Horizontal gap between frames in mm")
    p.add_argument("--out", required=True, help="Output directory")
    p.add_argument("--filename", default="compare_13x18_vs_a4.png", help="Stacked comparison PNG filename")
    p.add_argument("--blender-bin", default=None, help="Optional Blender executable override")
    p.add_argument("--verbose", action="store_true")
    return p.parse_args(argv)


def _resolve_sides(
    args: argparse.Namespace,
) -> Tuple[Optional[str], List[str], Optional[str], List[str], bool]:
    """Validate both sides against assembly_manifest.json or explicit --draft-unvalidated."""
    from studio_blender.stl_loader import validate_render_source

    old_manifest = args.old_manifest or args.manifest
    a4_manifest = args.a4_manifest or args.manifest
    old_stls = list(args.old_stl or ([] if args.old_manifest else (args.stl or [])))
    a4_stls = list(args.a4_stl or ([] if args.a4_manifest else (args.stl or [])))
    draft_flag = bool(args.draft_unvalidated)
    _, draft_l = validate_render_source(old_manifest, old_stls, draft_unvalidated=draft_flag)
    _, draft_r = validate_render_source(a4_manifest, a4_stls, draft_unvalidated=draft_flag)
    return old_manifest, old_stls, a4_manifest, a4_stls, bool(draft_l or draft_r or draft_flag)


def _run_blender_worker(args: argparse.Namespace) -> int:
    """Execute dual-assembly true-scale Cycles render inside headless Blender."""
    import bpy  # type: ignore

    from studio_blender import camera_rig, environments, materials, stl_loader
    from studio_blender.blender_worker import _clear_scene
    from studio_blender.worker_render import build_product_assembly, configure_cycles_metal

    old_manifest, old_stls, a4_manifest, a4_stls, is_draft = _resolve_sides(args)
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    scene = bpy.context.scene
    _clear_scene(scene)
    width = int(args.width)
    h_35, h_14 = int(round(width * 0.50)), int(round(width * 0.42))
    cycles_info = configure_cycles_metal(scene, samples=args.samples, width=width, height=h_35, motion_blur=False)
    plaster_mat = materials.make_plaster_cement_material()

    # LEFT: OLD 13x18 cm thin matte-black frame (4mm rim, 7.5mm tall)
    col_l = bpy.data.collections.new("CityLeft_13x18")
    scene.collection.children.link(col_l)
    if old_manifest:
        load_l = stl_loader.load_from_manifest(
            old_manifest, frame_style="single_13x18", material=plaster_mat, allow_draft=is_draft, collection=col_l,
        )
    else:
        load_l = stl_loader.load_city_stls(
            old_stls, frame_style="single_13x18", rim_width_mm=4.0, material=plaster_mat, collection=col_l,
        )
    frame_l, _ = build_product_assembly(
        scene, load_l, frame_style="single_13x18", title="", mount="desk_flat",
        rim_width_mm=4.0, frame_height_mm=7.5, backing_finish="matte_black", show_nameplate=False,
    )
    frame_l["root"].name = "LeftAssembly_13x18"

    # RIGHT: NEW A4 210x297x30 mm heavy gallery white passe-partout frame (120x170mm opening)
    col_r = bpy.data.collections.new("CityRight_A4")
    scene.collection.children.link(col_r)
    if a4_manifest:
        load_r = stl_loader.load_from_manifest(
            a4_manifest, frame_style="a4_passepartout", material=plaster_mat, allow_draft=is_draft, collection=col_r,
        )
    else:
        load_r = stl_loader.load_city_stls(
            a4_stls, frame_style="a4_passepartout", rim_width_mm=15.0, material=plaster_mat, collection=col_r,
        )
    frame_r, _ = build_product_assembly(
        scene, load_r, frame_style="a4_passepartout", title="", mount="desk_flat",
        rim_width_mm=15.0, frame_height_mm=30.0, backing_finish="matte_black", show_nameplate=False,
    )
    frame_r["root"].name = "RightAssembly_A4"

    # Ground BOTH frames on the exact same studio floor (shared_desk_z) with shared front baseline
    shared_desk_z = min(float(frame_l["desk_z"]), float(frame_r["desk_z"]))
    w_l, h_l = float(frame_l["outer_width_m"]), float(frame_l["outer_height_m"])
    w_r, h_r = float(frame_r["outer_width_m"]), float(frame_r["outer_height_m"])
    gap_m = float(args.gap_mm) * 0.001
    total_w, total_h = w_l + gap_m + w_r, max(h_l, h_r)

    dz_l, dz_r = shared_desk_z - float(frame_l["desk_z"]), shared_desk_z - float(frame_r["desk_z"])
    frame_l["root"].location = (-0.5 * total_w + 0.5 * w_l, -0.5 * total_h + 0.5 * h_l, dz_l)
    frame_r["root"].location = (0.5 * total_w - 0.5 * w_r, -0.5 * total_h + 0.5 * h_r, dz_r)
    bpy.context.view_layer.update()

    max_z_all = max(float(load_l["max_z_m"]) + dz_l, float(load_r["max_z_m"]) + dz_r, float(frame_r["frame_top_z"]) + dz_r)
    model_bounds: Dict[str, Any] = {
        "frame_width_m": total_w, "frame_height_m": total_h,
        "outer_width_m": total_w, "outer_height_m": total_h,
        "max_z_m": max_z_all, "max_z": max_z_all, "desk_z_m": shared_desk_z, "desk_z": shared_desk_z,
        "frame_top_z": max(float(frame_l["frame_top_z"]) + dz_l, float(frame_r["frame_top_z"]) + dz_r),
        "mount": "desk_flat",
    }
    environments.build_environment(env_name="11_packshot_white", model_bounds=model_bounds)

    corners = camera_rig.bbox_corners(
        -0.5 * total_w, 0.5 * total_w, -0.5 * total_h, 0.5 * total_h, shared_desk_z, max_z_all
    )
    cam_obj, focus_obj = camera_rig.ensure_studio_camera(scene)

    views: List[Tuple[str, int, float, float, float, float, float, float]] = [
        ("compare_35deg.png", h_35, 68.0, 35.0, -14.0, 0.88, 0.84, 0.24),
        ("compare_14deg.png", h_14, 85.0, 14.0, -8.0, 0.88, 0.82, 0.36),
    ]
    rendered_paths: Dict[str, str] = {}
    for fname, vh, lens, elev, yaw, fx, fy, tz_frac in views:
        scene.render.resolution_x, scene.render.resolution_y = width, vh
        aspect = float(width) / float(vh)
        target = (0.0, 0.0, shared_desk_z + tz_frac * (max_z_all - shared_desk_z))
        dist = camera_rig.compute_fit_distance(yaw, elev, target, corners, lens, aspect, fx, fy)
        off = camera_rig.spherical_offset(yaw, elev, dist)
        eye = (target[0] + off[0], target[1] + off[1], max(shared_desk_z + 0.012, target[2] + off[2]))
        camera_rig.apply_camera_pose(cam_obj, focus_obj, eye, target, (0.0, 0.0, 0.015), lens, fstop=8.0)
        out_png = out_dir / stl_loader.apply_draft_prefix(fname, is_draft)
        scene.render.filepath = str(out_png)
        bpy.ops.render.render(write_still=True)
        rendered_paths[fname] = str(out_png)

    manifest = {
        "status": "ok", "cycles": cycles_info, "draft_unvalidated": is_draft,
        "left_13x18_mm": [round(w_l * 1000, 1), round(h_l * 1000, 1), 7.5],
        "right_a4_mm": [round(w_r * 1000, 1), round(h_r * 1000, 1), 30.0],
        "old_manifest": str(Path(old_manifest).resolve()) if old_manifest else None,
        "a4_manifest": str(Path(a4_manifest).resolve()) if a4_manifest else None,
        "old_stls": [str(Path(p).resolve()) for p in old_stls],
        "a4_stls": [str(Path(p).resolve()) for p in a4_stls],
        "views": rendered_paths, "elapsed_sec": round(time.time() - t0, 2),
    }
    (out_dir / "compare_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return 0


def _stack_views_ffmpeg(top_png: str, bot_png: str, out_png: Path) -> Optional[str]:
    from studio_blender.render_studio import find_ffmpeg_binary

    ffmpeg = find_ffmpeg_binary()
    if not ffmpeg:
        return None
    cmd = [
        ffmpeg, "-y", "-i", top_png, "-i", bot_png,
        "-filter_complex", "[0:v][1:v]vstack=inputs=2[v]",
        "-map", "[v]", "-frames:v", "1", str(out_png),
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return str(out_png) if (proc.returncode == 0 and out_png.is_file()) else None


def main(argv: Optional[Sequence[str]] = None) -> int:
    try:
        import bpy as _bpy  # type: ignore  # noqa: F401
        in_blender = True
    except ImportError:
        in_blender = False

    if in_blender:
        raw_argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
        return _run_blender_worker(_parse_args(raw_argv))

    from studio_blender.render_studio import find_blender_binary
    from studio_blender.stl_loader import apply_draft_prefix

    args = _parse_args(argv if argv is not None else sys.argv[1:])
    try:
        old_manifest, old_stls, a4_manifest, a4_stls, is_draft = _resolve_sides(args)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    for p in old_stls + a4_stls:
        if not os.path.isfile(p):
            raise FileNotFoundError(f"STL file not found: {p}")

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    blender = find_blender_binary(args.blender_bin)

    cmd: List[str] = [
        blender, "--background", "--factory-startup", "--python-exit-code", "1",
        "--python", str(_THIS_FILE), "--",
    ]
    if old_manifest:
        cmd.extend(["--old-manifest", str(Path(old_manifest).resolve())])
    if a4_manifest:
        cmd.extend(["--a4-manifest", str(Path(a4_manifest).resolve())])
    if is_draft:
        cmd.append("--draft-unvalidated")
    for p in old_stls:
        cmd.extend(["--old-stl", str(Path(p).resolve())])
    for p in a4_stls:
        cmd.extend(["--a4-stl", str(Path(p).resolve())])
    cmd.extend([
        "--samples", str(int(args.samples)), "--width", str(int(args.width)),
        "--gap-mm", str(float(args.gap_mm)), "--out", str(out_dir),
    ])

    proc = subprocess.run(cmd) if args.verbose else subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        err_tail = "" if args.verbose else (proc.stderr or "")[-1500:]
        print(f"ERROR: compare_frames worker exited {proc.returncode}\n{err_tail}", file=sys.stderr)
        return 1

    manifest_path = out_dir / "compare_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    out_fname = apply_draft_prefix(args.filename, is_draft)
    stacked = _stack_views_ffmpeg(manifest["views"]["compare_35deg.png"], manifest["views"]["compare_14deg.png"], out_dir / out_fname)
    manifest["stacked_png"] = stacked
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Comparison complete ({manifest['elapsed_sec']}s): {stacked or manifest['views']['compare_35deg.png']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
