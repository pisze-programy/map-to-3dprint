"""Headless Blender 4/5 Cycles Metal worker entry point invoked by render_studio.py.

Usage:
    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python studio_blender/blender_worker.py -- --stl <path> --env 01_architect_window_desk ...
"""

from __future__ import annotations

import argparse
import inspect
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import bpy  # type: ignore

from studio_blender import environments, materials, stl_loader
from studio_blender.studio_presets import ALL_ENV_CHOICES, get_env_mount, resolve_env_name
from studio_blender.worker_render import (
    build_product_assembly,
    configure_cycles_metal,
    render_keyframes_mode,
    render_stills_mode,
    render_video_mode,
)


ASPECT_DEFAULTS: Dict[str, Dict[str, Tuple[int, int]]] = {
    "stills": {"4:5": (1200, 1500), "9:16": (1080, 1920), "1:1": (1400, 1400), "16:9": (1920, 1080)},
    "keyframes": {"9:16": (1080, 1920), "4:5": (1200, 1500), "1:1": (1400, 1400), "16:9": (1920, 1080)},
    "video": {"9:16": (540, 960), "4:5": (640, 800), "1:1": (720, 720), "16:9": (960, 540)},
}


def _filter_kwargs(fn: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return kwargs
    params = sig.parameters
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return kwargs
    return {k: v for k, v in kwargs.items() if k in params}


def _parse_resolution(res_str: Optional[str], mode: str, aspect: str) -> Tuple[int, int]:
    if res_str:
        parts = res_str.lower().replace("x", " ").split()
        if len(parts) != 2:
            raise ValueError(f"Invalid --resolution '{res_str}', expected WxH (e.g. 1080x1920).")
        w, h = int(parts[0]), int(parts[1])
        if w < 64 or h < 64:
            raise ValueError(f"Resolution too small: {w}x{h}")
        if mode == "video":
            w -= w % 2
            h -= h % 2
        return (w, h)
    table = ASPECT_DEFAULTS.get(mode, ASPECT_DEFAULTS["stills"])
    if aspect not in table:
        raise ValueError(f"Unsupported --aspect '{aspect}'. Choose from {tuple(table.keys())}.")
    return table[aspect]


def _clear_scene(scene: Any) -> None:
    """Remove all default startup objects, meshes, lights, cameras, and materials."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    for block_group in (
        bpy.data.meshes,
        bpy.data.lights,
        bpy.data.cameras,
        bpy.data.materials,
        bpy.data.worlds,
    ):
        for blk in list(block_group):
            if blk.users == 0:
                block_group.remove(blk)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def _parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Headless Blender Cycles Studio Worker")
    p.add_argument("--stl", action="append", required=True, help="Path to STL (repeatable)")
    p.add_argument("--env", default="01_architect_window_desk", choices=ALL_ENV_CHOICES)
    p.add_argument(
        "--frame",
        default="single_13x18",
        choices=("single_13x18", "a4_passepartout", "single_thin", "single_thick", "cube_cover", "cube_plinth", "triptych_3x1", "quartet_2x2"),
    )
    p.add_argument("--mount", default="auto", choices=("auto", "desk_flat", "wall_mount"))
    p.add_argument("--mode", default="stills", choices=("stills", "keyframes", "video"))
    p.add_argument("--preset", action="append", default=None)
    p.add_argument("--aspect", default=None, choices=("9:16", "4:5", "1:1", "16:9"))
    p.add_argument("--resolution", default=None)
    p.add_argument("--samples", type=int, default=None)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--frame-mm", default=None)
    p.add_argument("--frame-width-mm", type=float, default=4.0, help="Frame rim width in mm (default 4.0)")
    p.add_argument("--frame-height-mm", type=float, default=7.5, help="Frame profile height in mm (default 7.5)")
    p.add_argument("--backing-finish", default="matte_black", choices=("matte_black", "satin_black"))
    p.add_argument("--show-nameplate", action="store_true", default=False)
    p.add_argument("--title", default=None)
    p.add_argument("--surface", default=None, help="Surface material override")
    p.add_argument("--window-gobo", default=None, help="Window/blinds gobo override")
    p.add_argument("--hdri", default=None, help="HDRI preset name or local .hdr/.exr path")
    p.add_argument("--light-temp", type=float, default=None, help="Key light color temperature in Kelvin")
    p.add_argument("--sun-azimuth", type=float, default=None)
    p.add_argument("--add-prop", action="append", default=None, help="Add prop spec (repeatable)")
    p.add_argument("--remove-prop", action="append", default=None, help="Remove prop ID (repeatable)")
    p.add_argument("--clear-props", action="store_true", default=False)
    p.add_argument("--out", required=True)
    p.add_argument("--filename", default=None)
    p.add_argument("--shots", default="1,2,3,4")
    p.add_argument("--manifest", default=None)
    return p.parse_args(argv)


def main() -> int:
    worker_argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    args = _parse_args(worker_argv)
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    canonical_env = resolve_env_name(args.env)
    mount = get_env_mount(canonical_env, args.mount)
    aspect = args.aspect or ("4:5" if args.mode == "stills" else "9:16")
    width, height = _parse_resolution(args.resolution, args.mode, aspect)
    aspect_ratio = float(width) / float(height)
    samples = args.samples if args.samples is not None else (32 if args.mode == "video" else 96)
    city_title = args.title.strip() if args.title else stl_loader.infer_city_title(args.stl)

    t0 = time.time()
    scene = bpy.context.scene
    _clear_scene(scene)

    cycles_info = configure_cycles_metal(
        scene=scene, samples=samples, width=width, height=height, motion_blur=(args.mode == "video")
    )

    plaster_mat = materials.make_plaster_cement_material()
    load_result = stl_loader.load_city_stls(
        stl_paths=args.stl,
        frame_style=args.frame,
        rim_width_mm=args.frame_width_mm,
        frame_mm=args.frame_mm,
        material=plaster_mat,
    )

    frame_info, analysis = build_product_assembly(
        scene=scene,
        load_result=load_result,
        frame_style=args.frame,
        title=city_title,
        mount=mount,
        rim_width_mm=args.frame_width_mm,
        frame_height_mm=args.frame_height_mm,
        backing_finish=args.backing_finish,
        show_nameplate=bool(args.show_nameplate),
    )

    model_bounds: Dict[str, Any] = {
        "frame_width_m": load_result["total_width_m"],
        "frame_height_m": load_result["total_height_m"],
        "outer_width_m": frame_info["outer_width_m"],
        "outer_height_m": frame_info["outer_height_m"],
        "max_z_m": load_result["max_z_m"],
        "max_z": load_result["max_z_m"],
        "desk_z_m": frame_info["desk_z"],
        "desk_z": frame_info["desk_z"],
        "frame_bottom_z": frame_info["frame_bottom_z"],
        "frame_top_z": frame_info["frame_top_z"],
        "wall_y": frame_info["wall_y"],
        "cover_top_z": frame_info["cover_top_z"],
        "mount": mount,
        "water_side": analysis["water_side"],
        "hero_peak": analysis["hero_peak"],
        "skyline_centroid": analysis["skyline_centroid"],
    }

    env_kwargs: Dict[str, Any] = {
        "env_name": canonical_env,
        "model_bounds": model_bounds,
        "mount": mount,
        "surface_override": args.surface,
        "window_gobo_override": args.window_gobo,
        "hdri_override": args.hdri,
        "sun_azimuth_deg": args.sun_azimuth,
        "light_temp": args.light_temp,
        "add_props": args.add_prop,
        "remove_props": args.remove_prop,
        "clear_props": bool(args.clear_props),
    }
    env_refs = environments.build_environment(**_filter_kwargs(environments.build_environment, env_kwargs))
    base_sun_az = float(
        args.sun_azimuth
        if args.sun_azimuth is not None
        else env_refs.get("key_rig_meta", {}).get("azimuth_deg", 38.0)
    )

    rendered_stills: List[Dict[str, Any]] = []
    rendered_keyframes: Dict[int, Dict[str, str]] = {}
    video_shot_frames: List[Dict[str, Any]] = []
    flow_prompts_path: Optional[str] = None

    if args.mode == "stills":
        rendered_stills = render_stills_mode(
            scene, out_dir, canonical_env, city_title, args.preset,
            args.filename, analysis, model_bounds, aspect_ratio, mount=mount,
        )
    elif args.mode == "keyframes":
        rendered_stills, rendered_keyframes, flow_prompts_path = render_keyframes_mode(
            scene, out_dir, canonical_env, city_title, args.shots,
            analysis, model_bounds, env_refs, aspect_ratio, base_sun_az, frame_info["desk_z"], mount=mount,
        )
    elif args.mode == "video":
        video_shot_frames = render_video_mode(
            scene, out_dir, canonical_env, args.shots, args.fps,
            analysis, model_bounds, env_refs, aspect_ratio, base_sun_az, frame_info["desk_z"], mount=mount,
        )

    manifest = {
        "status": "ok",
        "mode": args.mode,
        "env": canonical_env,
        "mount": mount,
        "frame": args.frame,
        "frame_width_mm": args.frame_width_mm,
        "frame_height_mm": args.frame_height_mm,
        "backing_finish": args.backing_finish,
        "show_nameplate": bool(args.show_nameplate),
        "city_title": city_title,
        "stl_paths": [str(Path(p).resolve()) for p in args.stl],
        "cycles": cycles_info,
        "analysis": analysis,
        "model_bounds": {
            "outer_width_m": round(frame_info["outer_width_m"], 5),
            "outer_height_m": round(frame_info["outer_height_m"], 5),
            "desk_z": round(frame_info["desk_z"], 5),
            "wall_y": round(frame_info["wall_y"], 5),
            "max_z": round(load_result["max_z_m"], 5),
        },
        "placed_props": env_refs.get("placed_props", []),
        "stills": rendered_stills,
        "keyframes": rendered_keyframes,
        "flow_prompts_path": flow_prompts_path,
        "video_shots": video_shot_frames,
        "fps": args.fps,
        "total_elapsed_sec": round(time.time() - t0, 2),
    }

    manifest_path = Path(args.manifest).resolve() if args.manifest else (out_dir / "render_manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[STUDIO_MANIFEST] {manifest_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
