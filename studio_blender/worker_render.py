"""Cycles Metal configuration, ProductAssembly (desk_flat/wall_mount), and render modes."""

from __future__ import annotations

import inspect
import json
import math
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import bpy  # type: ignore
from mathutils import Euler  # type: ignore

from studio_blender import camera_rig, environments, stl_loader
from studio_blender.studio_presets import get_default_still_preset


def _filter_kwargs(fn: Any, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Pass only keyword arguments accepted by `fn` (unless `fn` accepts **kwargs)."""
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return kwargs
    params = sig.parameters
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return kwargs
    return {k: v for k, v in kwargs.items() if k in params}


def configure_cycles_metal(
    scene: Any,
    samples: int,
    width: int,
    height: int,
    motion_blur: bool = False,
) -> Dict[str, Any]:
    """Configure Cycles with Apple Metal GPU, OpenImageDenoise, and AgX color management."""
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False

    active_devices: List[str] = []
    compute_backend = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        if hasattr(prefs, "refresh_devices"):
            prefs.refresh_devices()
        else:
            prefs.get_devices()
        metal_found = False
        for dev in prefs.devices:
            if dev.type == "METAL":
                dev.use = True
                metal_found = True
                active_devices.append(f"{dev.type}:{dev.name}")
            else:
                dev.use = False
        if metal_found:
            scene.cycles.device = "GPU"
            compute_backend = "METAL"
        else:
            scene.cycles.device = "CPU"
            for dev in prefs.devices:
                if dev.type == "CPU":
                    dev.use = True
                    active_devices.append(f"CPU:{dev.name}")
    except Exception as exc:
        scene.cycles.device = "CPU"
        active_devices.append(f"CPU_FALLBACK({exc})")

    scene.cycles.samples = int(samples)
    if hasattr(scene.cycles, "use_adaptive_sampling"):
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.02
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = True
    for attr, val in (
        ("denoiser", "OPENIMAGEDENOISE"),
        ("denoising_input_passes", "RGB_ALBEDO_NORMAL"),
        ("denoising_use_gpu", compute_backend == "METAL"),
    ):
        if hasattr(scene.cycles, attr):
            try:
                setattr(scene.cycles, attr, val)
            except Exception:
                pass

    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 8
    scene.cycles.volume_bounces = 2
    scene.cycles.transparent_max_bounces = 8
    if hasattr(scene.cycles, "sample_clamp_direct"):
        scene.cycles.sample_clamp_direct = 16.0
    if hasattr(scene.cycles, "sample_clamp_indirect"):
        scene.cycles.sample_clamp_indirect = 8.0
    if hasattr(scene.cycles, "caustics_reflective"):
        scene.cycles.caustics_reflective = False
    if hasattr(scene.cycles, "caustics_refractive"):
        scene.cycles.caustics_refractive = False

    scene.render.use_motion_blur = bool(motion_blur)
    if motion_blur:
        scene.render.motion_blur_shutter = 0.45
        if hasattr(scene.cycles, "motion_blur_position"):
            try:
                scene.cycles.motion_blur_position = "CENTER"
            except Exception:
                pass

    color_info = {"view_transform": "Standard", "look": "None"}
    try:
        scene.view_settings.view_transform = "AgX"
        color_info["view_transform"] = "AgX"
        for look_candidate in ("AgX - Medium High Contrast", "AgX - Base Contrast", "None"):
            try:
                scene.view_settings.look = look_candidate
                color_info["look"] = look_candidate
                break
            except TypeError:
                continue
    except TypeError:
        try:
            scene.view_settings.view_transform = "Filmic"
            color_info["view_transform"] = "Filmic"
        except TypeError:
            pass
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    return {
        "blender_version": bpy.app.version_string,
        "backend": compute_backend,
        "devices": active_devices,
        "samples": int(samples),
        "resolution": [width, height],
        "motion_blur": bool(motion_blur),
        "color_management": color_info,
    }


def build_product_assembly(
    scene: Any,
    load_result: Dict[str, Any],
    frame_style: str,
    title: str,
    mount: str = "desk_flat",
    rim_width_mm: float = 4.0,
    frame_height_mm: float = 7.5,
    backing_finish: str = "matte_black",
    show_nameplate: bool = False,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Build matte-black frame(s), parent under ProductAssembly, and orient for desk/wall mount."""
    add_cover = frame_style == "cube_cover"
    centers_xy: List[Tuple[float, float]] = load_result["frame_centers_xy"]
    tile_w = load_result["tile_width_m"]
    tile_h = load_result["tile_height_m"]
    max_z = load_result["max_z_m"]

    n_frames = len(centers_xy)
    mid_idx = n_frames // 2

    frame_objs: List[Any] = []
    desk_z: Optional[float] = None
    frame_top_z: Optional[float] = None
    frame_bottom_z: Optional[float] = None
    wall_y: Optional[float] = None
    cover_top_z = 0.0
    tile_outer_w = tile_w + 2.0 * rim_width_mm * 0.001
    tile_outer_h = tile_h + 2.0 * rim_width_mm * 0.001

    if frame_style == "none":
        from studio_blender import materials as _mats
        from studio_blender.envs.common import create_mesh_object, get_or_create_collection, make_box_bm

        col = get_or_create_collection("StudioFrame")
        slab_margin, slab_thick, slab_top = -0.0008, 0.0030, -0.00015
        slab_w = max(0.01, tile_w + 2.0 * slab_margin)
        slab_h = max(0.01, tile_h + 2.0 * slab_margin)
        mat_back = (
            _mats.make_backing_material(backing_finish)
            if hasattr(_mats, "make_backing_material")
            else _mats.make_obsidian_water_material()
        )
        slab = create_mesh_object(
            "FramelessBackingSlab",
            make_box_bm(slab_w, slab_h, slab_thick, (0.0, 0.0, slab_top - 0.5 * slab_thick)),
            col,
            material=mat_back,
            smooth=False,
        )
        bev = slab.modifiers.new(name="EdgeBevel", type="BEVEL")
        bev.width, bev.segments, bev.limit_method = 0.00025, 2, "ANGLE"
        frame_objs.append(slab)
        desk_z = slab_top - slab_thick
        frame_bottom_z, frame_top_z = desk_z, 0.0
        wall_y = -desk_z + 0.0015
        tile_outer_w, tile_outer_h = tile_w, tile_h
    else:
        frame_specs = load_result.get("frame_specs")
        if frame_specs and frame_style != "none":
            for idx, fs in enumerate(frame_specs):
                plate_text = title if (show_nameplate and idx == mid_idx) else None
                per_style = fs.get("format_id") or frame_style
                if per_style == "custom_grid":
                    per_style = "a4_passepartout" if (abs(fs["opening_w_m"] - 0.120) < 0.005 and abs(fs["opening_h_m"] - 0.170) < 0.005) else frame_style
                raw_kwargs: Dict[str, Any] = {
                    "width_m": fs["opening_w_m"],
                    "height_m": fs["opening_h_m"],
                    "style": per_style,
                    "rim_width_mm": rim_width_mm,
                    "rim_height_mm": frame_height_mm,
                    "frame_height_mm": frame_height_mm,
                    "backing_finish": backing_finish,
                    "show_nameplate": show_nameplate and (idx == mid_idx),
                    "add_nameplate_text": plate_text,
                    "add_cover": add_cover,
                    "center_xy": fs["center_xy"],
                    "max_z_m": max_z,
                    "mount": mount,
                }
                res = environments.build_frame_assembly(**_filter_kwargs(environments.build_frame_assembly, raw_kwargs))
                frame_objs.extend(res.get("objects", []))
                res_desk_z = float(res.get("desk_z", -0.021))
                desk_z = res_desk_z if desk_z is None else min(desk_z, res_desk_z)
                res_bot_z = float(res.get("frame_bottom_z", res_desk_z))
                frame_bottom_z = res_bot_z if frame_bottom_z is None else min(frame_bottom_z, res_bot_z)
                res_top_z = float(res.get("frame_top_z", 0.009))
                frame_top_z = res_top_z if frame_top_z is None else max(frame_top_z, res_top_z)
                if res.get("wall_y") is not None:
                    wy = float(res["wall_y"])
                    wall_y = wy if wall_y is None else max(wall_y, wy)
                if res.get("cover_top_z"):
                    cover_top_z = max(cover_top_z, float(res["cover_top_z"]))
                tile_outer_w = float(res.get("outer_width_m", tile_outer_w))
                tile_outer_h = float(res.get("outer_height_m", tile_outer_h))
        else:
            for idx, (cx, cy) in enumerate(centers_xy):
                plate_text = title if (show_nameplate and idx == mid_idx) else None
                is_a4_pair = abs(tile_w - 0.120) < 0.005 and abs(tile_h - 0.170) < 0.005
                per_style = "a4_passepartout" if (frame_style in ("triptych_3x1", "quartet_2x2") and is_a4_pair) else frame_style
                raw_kwargs = {
                    "width_m": tile_w,
                    "height_m": tile_h,
                    "style": per_style,
                    "rim_width_mm": rim_width_mm,
                    "rim_height_mm": frame_height_mm,
                    "frame_height_mm": frame_height_mm,
                    "backing_finish": backing_finish,
                    "show_nameplate": show_nameplate and (idx == mid_idx),
                    "add_nameplate_text": plate_text,
                    "add_cover": add_cover,
                    "center_xy": (cx, cy),
                    "max_z_m": max_z,
                    "mount": mount,
                }
                res = environments.build_frame_assembly(**_filter_kwargs(environments.build_frame_assembly, raw_kwargs))
                frame_objs.extend(res.get("objects", []))

                res_desk_z = float(res.get("desk_z", -0.006))
                desk_z = res_desk_z if desk_z is None else min(desk_z, res_desk_z)
                res_bot_z = float(res.get("frame_bottom_z", res_desk_z))
                frame_bottom_z = res_bot_z if frame_bottom_z is None else min(frame_bottom_z, res_bot_z)
                res_top_z = float(res.get("frame_top_z", 0.0035))
                frame_top_z = res_top_z if frame_top_z is None else max(frame_top_z, res_top_z)
                if res.get("wall_y") is not None:
                    wy = float(res["wall_y"])
                    wall_y = wy if wall_y is None else max(wall_y, wy)
                if res.get("cover_top_z"):
                    cover_top_z = max(cover_top_z, float(res["cover_top_z"]))
                tile_outer_w = float(res.get("outer_width_m", tile_outer_w))
                tile_outer_h = float(res.get("outer_height_m", tile_outer_h))

    desk_z = -0.006 if desk_z is None else desk_z
    frame_bottom_z = desk_z if frame_bottom_z is None else frame_bottom_z
    frame_top_z = 0.0035 if frame_top_z is None else frame_top_z
    if wall_y is None:
        wall_y = -frame_bottom_z + 0.0015

    xs = [c[0] for c in centers_xy]
    ys = [c[1] for c in centers_xy]
    total_outer_w = (max(xs) - min(xs)) + tile_outer_w
    total_outer_h = (max(ys) - min(ys)) + tile_outer_h

    # Parent all city tiles + frame objects under a single ProductAssembly root empty
    root = bpy.data.objects.new("ProductAssembly", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.02
    scene.collection.objects.link(root)

    product_objs = list(load_result["objects"]) + frame_objs
    for obj in product_objs:
        if obj.parent is None:
            obj.parent = root

    analysis = load_result["analysis"]
    if mount == "wall_mount":
        # Rotate upright +90 deg around X: local (x, y, z) -> world (x, -z, +y)
        # Local +Y (north/top) becomes +Z (up), local +Z (buildings) protrudes toward -Y (camera)
        root.rotation_euler = Euler((math.pi * 0.5, 0.0, 0.0), "XYZ")
        bpy.context.view_layer.update()
        analysis = stl_loader.transform_analysis_to_wall_mount(analysis, assembly_offset_y=0.0)

    frame_info = {
        "root": root,
        "objects": product_objs,
        "outer_width_m": total_outer_w,
        "outer_height_m": total_outer_h,
        "desk_z": desk_z,
        "frame_bottom_z": frame_bottom_z,
        "frame_top_z": frame_top_z,
        "wall_y": wall_y,
        "cover_top_z": cover_top_z if cover_top_z > 0.0 else None,
        "mount": mount,
    }
    return frame_info, analysis


def render_stills_mode(
    scene: Any,
    out_dir: Path,
    env_name: str,
    city_title: str,
    presets_arg: Optional[Sequence[str]],
    filename_override: Optional[str],
    analysis: Dict[str, Any],
    model_bounds: Dict[str, Any],
    aspect_ratio: float,
    mount: str = "desk_flat",
    load_result: Optional[Dict[str, Any]] = None,
    draft_unvalidated: bool = False,
) -> List[Dict[str, Any]]:
    """Render one or more still camera presets to PNG files."""
    if not presets_arg:
        presets = [get_default_still_preset(env_name, mount=mount)]
    elif "all" in presets_arg:
        presets = [p for p in camera_rig.STILL_PRESETS if (mount == "wall_mount" or p != "hero_wall")]
    else:
        presets = list(presets_arg)

    rendered: List[Dict[str, Any]] = []
    city_slug = city_title.lower().replace(" ", "_")
    draft_prefix = "DRAFT_UNVALIDATED_" if draft_unvalidated else ""
    for preset in presets:
        t_shot = time.time()
        if preset.startswith("qa_"):
            from studio_blender import camera_qa

            if load_result and load_result.get("objects"):
                camera_qa.apply_qa_alternating_tile_tints(load_result["objects"])
            camera_qa.configure_qa_lighting(scene, preset, analysis)
            cam_info = camera_qa.setup_qa_camera(
                scene=scene,
                preset_name=preset,
                load_result=load_result or {"total_width_m": model_bounds.get("frame_width_m", 0.12), "total_height_m": model_bounds.get("frame_height_m", 0.17), "max_z_m": analysis.get("max_z", 0.02)},
                aspect=aspect_ratio,
            )
        else:
            cam_info = camera_rig.setup_still_camera(
                scene=scene,
                preset_name=preset,
                analysis=analysis,
                model_bounds=model_bounds,
                env_name=env_name,
                aspect=aspect_ratio,
                mount=mount,
            )
        if filename_override and len(presets) == 1:
            base_fn = filename_override if filename_override.lower().endswith(".png") else f"{filename_override}.png"
            fname = f"{draft_prefix}{base_fn}"
        else:
            fname = f"{draft_prefix}{city_slug}_{env_name}_{preset}.png"
        out_path = out_dir / fname
        scene.render.filepath = str(out_path)
        bpy.ops.render.render(write_still=True)
        rendered.append({
            "preset": preset, "mount": mount, "path": str(out_path),
            "elapsed_sec": round(time.time() - t_shot, 2),
            "lens_mm": cam_info["pose"]["lens_mm"], "fstop": cam_info["pose"]["fstop"],
            "draft_unvalidated": draft_unvalidated,
        })
    return rendered


def render_keyframes_mode(
    scene: Any, out_dir: Path, env_name: str, city_title: str, shots_spec: str,
    analysis: Dict[str, Any], model_bounds: Dict[str, Any], env_refs: Dict[str, Any],
    aspect_ratio: float, base_sun_az: float, desk_z: float, mount: str = "desk_flat",
) -> Tuple[List[Dict[str, Any]], Dict[int, Dict[str, str]], str]:
    """Render Start -> End 9:16 keyframe pairs and write flow_prompts.json."""
    wanted = {int(s.strip()) for s in shots_spec.split(",") if s.strip()}
    all_shots = camera_rig.build_commercial_shot_plan(
        analysis, model_bounds, env_name=env_name, aspect=aspect_ratio,
        base_sun_azimuth_deg=base_sun_az, mount=mount,
    )
    selected_shots = [s for s in all_shots if s["index"] in wanted]
    cam_obj, focus_obj = camera_rig.ensure_studio_camera(scene)

    rendered_stills: List[Dict[str, Any]] = []
    rendered_keyframes: Dict[int, Dict[str, str]] = {}
    for shot in selected_shots:
        idx = int(shot["index"])
        rendered_keyframes[idx] = {}
        for label, raw_t in (("start", 0.0), ("end", 1.0)):
            t_shot = time.time()
            state = camera_rig.evaluate_shot_state(shot, raw_t, desk_z=desk_z)
            camera_rig.apply_camera_pose(
                cam_obj, focus_obj, state["eye"], state["target"], state["focus_point"],
                state["lens_mm"], state["fstop"], state["shift_x"], state["shift_y"], frame=None,
            )
            environments.update_key_light_azimuth(env_refs, state["sun_az"], elevation_deg=state["sun_el"])
            out_path = out_dir / f"{shot['id']}_{label}.png"
            scene.render.filepath = str(out_path)
            bpy.ops.render.render(write_still=True)
            rendered_keyframes[idx][label] = str(out_path)
            rendered_stills.append({
                "shot_index": idx, "shot_id": shot["id"], "keyframe": label,
                "path": str(out_path), "elapsed_sec": round(time.time() - t_shot, 2),
            })

    prompts_doc = camera_rig.build_flow_prompts(city_title, env_name, selected_shots, rendered_keyframes)
    prompts_file = out_dir / "flow_prompts.json"
    prompts_file.write_text(json.dumps(prompts_doc, indent=2, ensure_ascii=False), encoding="utf-8")
    return rendered_stills, rendered_keyframes, str(prompts_file)


def render_video_mode(
    scene: Any, out_dir: Path, env_name: str, shots_spec: str, fps: int,
    analysis: Dict[str, Any], model_bounds: Dict[str, Any], env_refs: Dict[str, Any],
    aspect_ratio: float, base_sun_az: float, desk_z: float, mount: str = "desk_flat",
) -> List[Dict[str, Any]]:
    """Render Cycles video frames per shot with clean pre/post-roll motion blur."""
    wanted = {int(s.strip()) for s in shots_spec.split(",") if s.strip()}
    all_shots = camera_rig.build_commercial_shot_plan(
        analysis, model_bounds, env_name=env_name, aspect=aspect_ratio,
        base_sun_azimuth_deg=base_sun_az, mount=mount,
    )
    selected_shots = [s for s in all_shots if s["index"] in wanted]
    frames_root = out_dir / "_frames"
    frames_root.mkdir(parents=True, exist_ok=True)

    video_shot_frames: List[Dict[str, Any]] = []
    for shot in selected_shots:
        t_shot = time.time()
        shot_dir = frames_root / shot["id"]
        shot_dir.mkdir(parents=True, exist_ok=True)
        seq_info = camera_rig.setup_commercial_sequence(
            scene, shot, fps=fps, desk_z=desk_z, env_refs=env_refs,
            update_light_fn=environments.update_key_light_azimuth,
        )
        shot_frame_paths: List[str] = []
        for f in range(seq_info["frame_start"], seq_info["frame_end"] + 1):
            scene.frame_set(f)
            fpath = shot_dir / f"frame_{f:04d}.png"
            scene.render.filepath = str(fpath)
            bpy.ops.render.render(write_still=True)
            shot_frame_paths.append(str(fpath))

        video_shot_frames.append({
            "shot_index": shot["index"], "shot_id": shot["id"], "title": shot["title"],
            "duration_sec": shot["duration_sec"], "frame_count": len(shot_frame_paths),
            "frames": shot_frame_paths, "elapsed_sec": round(time.time() - t_shot, 2),
        })
    return video_shot_frames
