"""Headless Blender + Apple Silicon Metal GPU Cycles verification & benchmark script.

Run via:
    /Applications/Blender.app/Contents/MacOS/Blender --background --python studio_blender/verify_metal.py
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

DEFAULT_STL = Path(
    "/Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/"
    "exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl"
)
OUT_DIR = Path("/tmp/studio_blender_verify")


def enum_ids(rna_struct, prop_name: str) -> list[str]:
    prop = rna_struct.bl_rna.properties.get(prop_name)
    if prop is None or not hasattr(prop, "enum_items"):
        return []
    return [item.identifier for item in prop.enum_items]


def inspect_bpy_apis() -> dict:
    info: dict = {
        "blender_version": list(bpy.app.version),
        "blender_version_string": bpy.app.version_string,
        "binary_path": bpy.app.binary_path,
        "python_version": sys.version.split()[0],
    }

    scene = bpy.context.scene

    # Available render engines
    info["render_engines"] = enum_ids(scene.render, "engine")

    # Color management view transforms & AgX looks
    vs = scene.view_settings
    info["view_transforms"] = enum_ids(vs, "view_transform")
    if "AgX" in info["view_transforms"]:
        vs.view_transform = "AgX"
    info["looks_for_current_view_transform"] = enum_ids(vs, "look")

    # STL import operators (Note: hasattr on bpy.ops submodules always returns True;
    # must check via get_rna_type()!)
    stl_ops: dict = {}
    for op_name, op_fn in (
        ("wm.stl_import", bpy.ops.wm.stl_import),
        ("import_mesh.stl", bpy.ops.import_mesh.stl),
    ):
        try:
            op_rna = op_fn.get_rna_type()
            stl_ops[op_name] = [p.identifier for p in op_rna.properties if p.identifier != "rna_type"]
        except KeyError:
            stl_ops[op_name] = None
    info["stl_import_operators"] = stl_ops

    # Principled BSDF & key shader nodes
    mat = bpy.data.materials.new(name="__api_probe_mat")
    info["material_node_tree_default"] = mat.node_tree is not None
    if mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    info["principled_bsdf_inputs"] = [
        {"name": s.name, "type": s.type} for s in bsdf.inputs
    ]

    # Probe extra shader nodes
    node_probes = {}
    for node_id in (
        "ShaderNodeTexNoise",
        "ShaderNodeBump",
        "ShaderNodeAmbientOcclusion",
        "ShaderNodeBevel",
        "ShaderNodeMix",
        "ShaderNodeMixRGB",
        "ShaderNodeTexSky",
    ):
        try:
            n = nt.nodes.new(node_id)
            entry = {"inputs": [s.name for s in n.inputs], "outputs": [s.name for s in n.outputs]}
            if node_id == "ShaderNodeTexSky":
                entry["sky_types"] = enum_ids(n, "sky_type")
                entry["props"] = [
                    p.identifier
                    for p in n.bl_rna.properties
                    if p.identifier in (
                        "sky_type",
                        "sun_disc",
                        "sun_size",
                        "sun_intensity",
                        "sun_elevation",
                        "sun_rotation",
                        "altitude",
                        "air_density",
                        "aerosol_density",
                        "dust_density",
                        "ozone_density",
                    )
                ]
            node_probes[node_id] = entry
            nt.nodes.remove(n)
        except Exception as exc:
            node_probes[node_id] = {"error": str(exc)}
    info["shader_nodes"] = node_probes
    bpy.data.materials.remove(mat)

    # World & Compositor API checks (Blender 4.x vs 5.x differences)
    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("__probe_world")
        scene.world = world
    info["world_node_tree_default"] = world.node_tree is not None
    info["scene_has_compositing_node_group"] = "compositing_node_group" in scene.bl_rna.properties

    # Cycles & denoiser options
    scene.render.engine = "CYCLES"
    c = scene.cycles
    info["cycles_denoiser_options"] = enum_ids(c, "denoiser")
    info["cycles_denoising_input_passes"] = enum_ids(c, "denoising_input_passes")
    info["cycles_denoising_prefilter"] = enum_ids(c, "denoising_prefilter")
    info["cycles_has_denoising_use_gpu"] = hasattr(c, "denoising_use_gpu")
    info["cycles_has_use_guiding"] = hasattr(c, "use_guiding")

    # Light API checks
    light_data = bpy.data.lights.new("__probe_area", type="AREA")
    info["area_light_props"] = [
        p for p in ("energy", "size", "size_y", "shape", "spread", "use_shadow", "color", "use_temperature", "temperature")
        if hasattr(light_data, p)
    ]
    bpy.data.lights.remove(light_data)

    return info


def configure_cycles_metal(scene: bpy.types.Scene) -> dict:
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences

    compute_types = enum_ids(prefs, "compute_device_type")
    prefs.compute_device_type = "METAL"
    if hasattr(prefs, "refresh_devices"):
        prefs.refresh_devices()
    else:
        prefs.get_devices()

    devices_report = []
    metal_gpu_found = False
    for dev in prefs.devices:
        is_metal = dev.type == "METAL"
        dev.use = is_metal
        if is_metal:
            metal_gpu_found = True
        devices_report.append(
            {
                "name": dev.name,
                "type": dev.type,
                "use": bool(dev.use),
            }
        )

    scene.cycles.device = "GPU" if metal_gpu_found else "CPU"
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except TypeError:
        pass
    try:
        scene.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    except TypeError:
        pass
    if hasattr(scene.cycles, "denoising_use_gpu"):
        scene.cycles.denoising_use_gpu = True

    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 6
    scene.cycles.transparent_max_bounces = 8

    # AgX color management (OCIO enums are dynamic; assign with try/except TypeError)
    vs = scene.view_settings
    try:
        vs.view_transform = "AgX"
    except TypeError:
        pass
    for preferred in ("AgX - Medium High Contrast", "AgX - Punchy", "None"):
        try:
            vs.look = preferred
            break
        except TypeError:
            continue

    return {
        "available_compute_device_types": compute_types,
        "active_compute_device_type": prefs.compute_device_type,
        "metal_gpu_found": metal_gpu_found,
        "scene_cycles_device": scene.cycles.device,
        "devices": devices_report,
        "use_denoising": bool(scene.cycles.use_denoising),
        "denoiser": scene.cycles.denoiser,
        "denoising_input_passes": getattr(scene.cycles, "denoising_input_passes", None),
        "denoising_use_gpu": getattr(scene.cycles, "denoising_use_gpu", None),
        "view_transform": vs.view_transform,
        "look": vs.look,
    }


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_stl_mm(stl_path: Path) -> tuple[bpy.types.Object, dict]:
    if not stl_path.exists():
        raise FileNotFoundError(f"STL not found: {stl_path}")

    t0 = time.perf_counter()
    before = set(bpy.data.objects)
    if hasattr(bpy.ops.wm, "stl_import"):
        op_used = "bpy.ops.wm.stl_import"
        bpy.ops.wm.stl_import(filepath=str(stl_path), global_scale=0.001)
    elif hasattr(bpy.ops, "import_mesh") and hasattr(bpy.ops.import_mesh, "stl"):
        op_used = "bpy.ops.import_mesh.stl"
        bpy.ops.import_mesh.stl(filepath=str(stl_path), global_scale=0.001)
    else:
        raise RuntimeError("No STL import operator found in bpy.ops")
    dt = time.perf_counter() - t0

    new_objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not new_objs:
        raise RuntimeError("STL import succeeded but created no mesh object")
    obj = new_objs[0]

    bpy.context.view_layer.update()
    corners_world = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners_world]
    ys = [c.y for c in corners_world]
    zs = [c.z for c in corners_world]
    dims_m = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))

    # Center XY at origin and place bottom at Z=0
    cx = 0.5 * (min(xs) + max(xs))
    cy = 0.5 * (min(ys) + max(ys))
    obj.location.x -= cx
    obj.location.y -= cy
    obj.location.z -= min(zs)
    bpy.context.view_layer.update()

    report = {
        "stl_path": str(stl_path),
        "operator_used": op_used,
        "import_seconds": round(dt, 3),
        "object_name": obj.name,
        "vertices": len(obj.data.vertices),
        "polygons": len(obj.data.polygons),
        "dimensions_m": [round(v, 5) for v in dims_m],
        "dimensions_mm": [round(v * 1000.0, 2) for v in dims_m],
    }
    return obj, report


def build_benchmark_scene(city_obj: bpy.types.Object) -> None:
    scene = bpy.context.scene

    # Matte plaster-resin material for city
    city_mat = bpy.data.materials.new("Verify_MatteResin")
    if city_mat.node_tree is None:
        city_mat.use_nodes = True
    nt = city_mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.86, 0.85, 0.82, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.62
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.35
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = 0.08
    if "Subsurface Scale" in bsdf.inputs:
        bsdf.inputs["Subsurface Scale"].default_value = 0.002
    city_obj.data.materials.clear()
    city_obj.data.materials.append(city_mat)

    # Dark studio tabletop
    bpy.ops.mesh.primitive_plane_add(size=1.2, location=(0.0, 0.0, -0.0005))
    plane = bpy.context.active_object
    plane.name = "Verify_Table"
    table_mat = bpy.data.materials.new("Verify_DarkSlate")
    if table_mat.node_tree is None:
        table_mat.use_nodes = True
    tbsdf = next(n for n in table_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    tbsdf.inputs["Base Color"].default_value = (0.04, 0.045, 0.05, 1.0)
    tbsdf.inputs["Roughness"].default_value = 0.32
    plane.data.materials.append(table_mat)

    # World subtle ambient
    world = bpy.data.worlds.new("Verify_World")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.06, 0.07, 0.09, 1.0)
    bg.inputs["Strength"].default_value = 0.25

    # Warm raking key area light (scaled for 0.12m tabletop miniature)
    key_data = bpy.data.lights.new("Verify_Key", type="AREA")
    key_data.energy = 1.8
    key_data.color = (1.0, 0.90, 0.78)
    key_data.size = 0.22
    if hasattr(key_data, "spread"):
        key_data.spread = math.radians(65.0)
    key_obj = bpy.data.objects.new("Verify_Key", key_data)
    scene.collection.objects.link(key_obj)
    key_obj.location = (0.22, -0.18, 0.16)
    direction = Vector((0.0, 0.0, 0.01)) - key_obj.location
    key_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    # Cool rim light
    rim_data = bpy.data.lights.new("Verify_Rim", type="AREA")
    rim_data.energy = 0.65
    rim_data.color = (0.76, 0.86, 1.0)
    rim_data.size = 0.25
    rim_obj = bpy.data.objects.new("Verify_Rim", rim_data)
    scene.collection.objects.link(rim_obj)
    rim_obj.location = (-0.20, 0.22, 0.14)
    direction = Vector((0.0, 0.0, 0.01)) - rim_obj.location
    rim_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    # Camera framed at 9:16 portrait
    cam_data = bpy.data.cameras.new("Verify_Camera")
    cam_data.lens = 50.0
    cam_data.clip_start = 0.005
    cam_data.clip_end = 50.0
    cam_data.dof.use_dof = True
    cam_data.dof.focus_distance = 0.26
    cam_data.dof.aperture_fstop = 2.8
    cam_obj = bpy.data.objects.new("Verify_Camera", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (0.14, -0.19, 0.12)
    direction = Vector((0.0, 0.0, 0.008)) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam_obj


def run_render_benchmark(scene: bpy.types.Scene, width: int, height: int, samples: int, out_path: Path) -> dict:
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(out_path)
    scene.cycles.samples = samples

    t0 = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    dt = time.perf_counter() - t0

    size_bytes = out_path.stat().st_size if out_path.exists() else 0
    return {
        "width": width,
        "height": height,
        "samples": samples,
        "seconds": round(dt, 3),
        "output_path": str(out_path),
        "file_size_bytes": size_bytes,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    clear_scene()

    api_info = inspect_bpy_apis()
    metal_info = configure_cycles_metal(bpy.context.scene)
    city_obj, stl_info = import_stl_mm(DEFAULT_STL)
    build_benchmark_scene(city_obj)

    # Small warmup render so Metal shader kernels are compiled & cached before timed benchmarks
    warmup = run_render_benchmark(
        bpy.context.scene, 128, 128, 4, OUT_DIR / "warmup_128x128_4spp.png"
    )
    bench_540 = run_render_benchmark(
        bpy.context.scene, 540, 960, 32, OUT_DIR / "bench_540x960_32spp.png"
    )
    bench_1080 = run_render_benchmark(
        bpy.context.scene, 1080, 1920, 64, OUT_DIR / "bench_1080x1920_64spp.png"
    )

    summary = {
        "api": api_info,
        "metal": metal_info,
        "stl": stl_info,
        "benchmarks": {
            "warmup_metal_compile": warmup,
            "540x960_32spp": bench_540,
            "1080x1920_64spp": bench_1080,
        },
    }
    report_path = OUT_DIR / "verify_metal_report.json"
    report_path.write_text(json.dumps(summary, indent=2))

    print("\n=== VERIFY_METAL_JSON_START ===")
    print(json.dumps(summary, indent=2))
    print("=== VERIFY_METAL_JSON_END ===\n")


if __name__ == "__main__":
    main()
