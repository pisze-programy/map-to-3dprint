"""Deterministic CC0 Poly Haven asset cache, PBR texture loader, and 3D prop importer.

Downloads and caches CC0 HDRIs, 2K PBR textures (Diffuse, Roughness, OpenGL Normal),
and photogrammetry glTF models under studio_blender/assets/ with graceful procedural
fallback when offline. All coordinates and scales are real-world meters.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import bpy
from mathutils import Vector

ASSETS_ROOT = Path(__file__).resolve().parent / "assets"
HDRI_DIR = ASSETS_ROOT / "hdris"
TEX_DIR = ASSETS_ROOT / "textures"
MODEL_DIR = ASSETS_ROOT / "models"

_POLYHAVEN_FILES_API = "https://api.polyhaven.com/files/{asset_id}"
_USER_AGENT = "map-to-3dprint-studio/2.0 (CC0 Blender Cycles Pipeline)"
_HTTP_TIMEOUT_SEC = 25


def _ensure_dirs() -> None:
    for folder in (HDRI_DIR, TEX_DIR, MODEL_DIR):
        folder.mkdir(parents=True, exist_ok=True)


def _fetch_json(url: str) -> Optional[Dict[str, Any]]:
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_SEC) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def _download_file(url: str, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_size > 128:
        return True
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_SEC) as resp:
            data = resp.read()
        if len(data) < 64:
            return False
        tmp.write_bytes(data)
        tmp.replace(dst)
        return True
    except (urllib.error.URLError, TimeoutError, OSError):
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        return False


def _get_files_manifest(asset_id: str) -> Optional[Dict[str, Any]]:
    _ensure_dirs()
    manifest_path = ASSETS_ROOT / f"_manifest_{asset_id}.json"
    if manifest_path.exists():
        try:
            return json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    data = _fetch_json(_POLYHAVEN_FILES_API.format(asset_id=asset_id))
    if data is not None:
        try:
            manifest_path.write_text(json.dumps(data), encoding="utf-8")
        except OSError:
            pass
    return data


def ensure_hdri(asset_id_or_path: str, resolution: str = "1k") -> Optional[Path]:
    """Return local path to a CC0 .hdr/.exr HDRI, downloading from Poly Haven if needed."""
    if not asset_id_or_path:
        return None
    direct = Path(asset_id_or_path).expanduser()
    if direct.is_file():
        return direct

    _ensure_dirs()
    cached = HDRI_DIR / f"{asset_id_or_path}_{resolution}.hdr"
    if cached.exists() and cached.stat().st_size > 1024:
        return cached

    manifest = _get_files_manifest(asset_id_or_path)
    if not manifest or "hdri" not in manifest:
        return None

    hdri_node = manifest["hdri"]
    res_node = hdri_node.get(resolution) or hdri_node.get("1k") or hdri_node.get("2k")
    if not isinstance(res_node, dict):
        return None
    fmt_node = res_node.get("hdr") or res_node.get("exr")
    if not isinstance(fmt_node, dict) or "url" not in fmt_node:
        return None

    ext = ".hdr" if "hdr" in res_node else ".exr"
    out_path = HDRI_DIR / f"{asset_id_or_path}_{resolution}{ext}"
    if _download_file(str(fmt_node["url"]), out_path):
        return out_path
    return None


def ensure_pbr_texture_set(asset_id: str, resolution: str = "2k") -> Dict[str, Path]:
    """Ensure local CC0 PBR maps (diffuse, rough, normal) for a Poly Haven texture asset."""
    _ensure_dirs()
    out_dir = TEX_DIR / asset_id
    out_dir.mkdir(parents=True, exist_ok=True)

    result: Dict[str, Path] = {}
    channel_specs = (
        ("diffuse", ("Diffuse", "diff"), f"{asset_id}_diff_{resolution}.jpg"),
        ("rough", ("Rough", "rough"), f"{asset_id}_rough_{resolution}.jpg"),
        ("normal", ("nor_gl", "Normal"), f"{asset_id}_nor_gl_{resolution}.jpg"),
    )

    all_cached = all((out_dir / fname).exists() and (out_dir / fname).stat().st_size > 1024 for _, _, fname in channel_specs)
    if all_cached:
        for key, _, fname in channel_specs:
            result[key] = out_dir / fname
        return result

    manifest = _get_files_manifest(asset_id)
    if not manifest:
        for key, _, fname in channel_specs:
            p = out_dir / fname
            if p.exists() and p.stat().st_size > 1024:
                result[key] = p
        return result

    for key, api_keys, fname in channel_specs:
        dst = out_dir / fname
        if dst.exists() and dst.stat().st_size > 1024:
            result[key] = dst
            continue
        chan_node = None
        for ak in api_keys:
            if ak in manifest and isinstance(manifest[ak], dict):
                chan_node = manifest[ak]
                break
        if chan_node is None:
            continue
        res_node = chan_node.get(resolution) or chan_node.get("1k") or chan_node.get("2k")
        if not isinstance(res_node, dict):
            continue
        fmt_node = res_node.get("jpg") or res_node.get("png")
        if not isinstance(fmt_node, dict) or "url" not in fmt_node:
            continue
        if _download_file(str(fmt_node["url"]), dst):
            result[key] = dst

    return result


def ensure_gltf_model(asset_id: str, resolution: str = "1k") -> Optional[Path]:
    """Download and cache a Poly Haven CC0 glTF photogrammetry model and its included files."""
    _ensure_dirs()
    model_dir = MODEL_DIR / asset_id
    gltf_path = model_dir / f"{asset_id}_{resolution}.gltf"
    if gltf_path.exists() and gltf_path.stat().st_size > 128:
        return gltf_path

    manifest = _get_files_manifest(asset_id)
    if not manifest or "gltf" not in manifest:
        return None

    gltf_root = manifest["gltf"]
    res_node = gltf_root.get(resolution) or gltf_root.get("1k") or gltf_root.get("2k")
    if not isinstance(res_node, dict):
        return None
    entry = res_node.get("gltf")
    if not isinstance(entry, dict) or "url" not in entry:
        return None

    model_dir.mkdir(parents=True, exist_ok=True)
    if not _download_file(str(entry["url"]), gltf_path):
        return None

    includes = entry.get("include") or {}
    if isinstance(includes, dict):
        for rel_path, info in includes.items():
            if not isinstance(info, dict) or "url" not in info:
                continue
            inc_dst = model_dir / rel_path
            if not _download_file(str(info["url"]), inc_dst):
                return None

    return gltf_path


def load_image_cached(path: Path, colorspace: str = "sRGB") -> Any:
    """Load an image file into bpy.data.images cleanly with requested colorspace."""
    abs_str = str(path.resolve())
    for img in bpy.data.images:
        if img.filepath and os.path.abspath(bpy.path.abspath(img.filepath)) == abs_str:
            try:
                img.colorspace_settings.name = colorspace
            except Exception:
                pass
            return img
    img = bpy.data.images.load(abs_str, check_existing=True)
    try:
        img.colorspace_settings.name = colorspace
    except Exception:
        pass
    return img


def build_cc0_pbr_material(
    name: str,
    asset_id: str,
    tile_scale_m: float = 0.60,
    tint_rgb: Optional[Tuple[float, float, float]] = None,
    tint_factor: float = 0.0,
    roughness_range: Tuple[float, float] = (0.35, 0.85),
    normal_strength: float = 0.65,
    specular_level: float = 0.30,
    rotation_z_rad: float = 0.0,
    resolution: str = "2k",
    blend_mode: str = "MULTIPLY",
    desaturate: bool = False,
) -> Optional[Any]:
    """Build a Cycles PBR material from cached Poly Haven 2K maps using Box projection.

    Returns None if CC0 maps are unavailable so caller can fall back cleanly.
    """
    from .materials_core import (
        add_map_range,
        add_mix_color,
        get_input,
        get_or_create_material,
        set_input,
    )

    maps = ensure_pbr_texture_set(asset_id, resolution=resolution)
    if "diffuse" not in maps:
        return None

    mat, nt, bsdf, _ = get_or_create_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1180, 0)
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.location = (-940, 0)
    inv_tile = 1.0 / max(0.05, float(tile_scale_m))
    mp.inputs["Scale"].default_value = (inv_tile, inv_tile, inv_tile)
    mp.inputs["Rotation"].default_value = (0.0, 0.0, rotation_z_rad)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])

    # Albedo / Diffuse (Box projection avoids stretching on procedural beveled slabs)
    tex_diff = nt.nodes.new("ShaderNodeTexImage")
    tex_diff.location = (-640, 260)
    tex_diff.projection = "BOX"
    tex_diff.projection_blend = 0.20
    tex_diff.image = load_image_cached(maps["diffuse"], colorspace="sRGB")
    nt.links.new(mp.outputs["Vector"], tex_diff.inputs["Vector"])

    diff_out = tex_diff.outputs["Color"]
    if desaturate:
        hsv = nt.nodes.new("ShaderNodeHueSaturation")
        hsv.location = (-460, 260)
        hsv.inputs["Saturation"].default_value = 0.0
        nt.links.new(diff_out, hsv.inputs["Color"])
        diff_out = hsv.outputs["Color"]

    if tint_rgb is not None and tint_factor > 1e-4:
        _, fac_m, col_a, col_b, col_out = add_mix_color(nt, blend_mode, loc=(-280, 260))
        fac_m.default_value = float(tint_factor)
        nt.links.new(diff_out, col_a)
        col_b.default_value = (tint_rgb[0], tint_rgb[1], tint_rgb[2], 1.0)
        nt.links.new(col_out, get_input(bsdf, "Base Color"))
    else:
        nt.links.new(diff_out, get_input(bsdf, "Base Color"))

    # Roughness (Non-Color)
    if "rough" in maps:
        tex_r = nt.nodes.new("ShaderNodeTexImage")
        tex_r.location = (-640, -20)
        tex_r.projection = "BOX"
        tex_r.projection_blend = 0.20
        tex_r.image = load_image_cached(maps["rough"], colorspace="Non-Color")
        nt.links.new(mp.outputs["Vector"], tex_r.inputs["Vector"])

        mr_r = add_map_range(nt, 0.0, 1.0, roughness_range[0], roughness_range[1], clamp=True, loc=(-300, -20))
        nt.links.new(tex_r.outputs["Color"], mr_r.inputs["Value"])
        nt.links.new(mr_r.outputs["Result"], get_input(bsdf, "Roughness"))
    else:
        set_input(bsdf, "Roughness", 0.5 * (roughness_range[0] + roughness_range[1]))

    # OpenGL Normal Map (Non-Color)
    if "normal" in maps:
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.location = (-640, -320)
        tex_n.projection = "BOX"
        tex_n.projection_blend = 0.20
        tex_n.image = load_image_cached(maps["normal"], colorspace="Non-Color")
        nt.links.new(mp.outputs["Vector"], tex_n.inputs["Vector"])

        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-300, -320)
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], get_input(bsdf, "Normal"))

    set_input(bsdf, ("Specular IOR Level", "Specular"), specular_level)
    set_input(bsdf, ("Coat Weight", "Clearcoat"), 0.0)
    return mat


def import_external_prop(
    filepath: Path,
    collection: Any,
    name_prefix: str,
    target_height_m: Optional[float] = None,
    scale_factor: float = 1.0,
) -> Tuple[Optional[Any], List[Any]]:
    """Import .glb/.gltf/.obj/.stl/.blend prop, normalize ground plane Z=0, return (root, meshes)."""
    p = Path(filepath).expanduser().resolve()
    if not p.is_file():
        return None, []

    ext = p.suffix.lower()
    before = set(bpy.data.objects)

    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(p))
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(p))
    elif ext == ".stl":
        bpy.ops.wm.stl_import(filepath=str(p), global_scale=0.001)
    elif ext == ".blend":
        with bpy.data.libraries.load(str(p), link=False) as (data_from, data_to):
            data_to.objects = list(data_from.objects)
        for obj in data_to.objects:
            if obj is not None:
                bpy.context.scene.collection.objects.link(obj)
    else:
        return None, []

    imported = [obj for obj in bpy.data.objects if obj not in before]
    mesh_objs = [obj for obj in imported if obj.type == "MESH"]
    if not mesh_objs:
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)
        return None, []

    # Remove non-mesh helpers (cameras/lights) and move meshes into target collection
    for obj in list(imported):
        if obj.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        collection.objects.link(obj)

    bpy.context.view_layer.update()

    # Compute combined world bounding box across all imported meshes
    min_pt = Vector((1e9, 1e9, 1e9))
    max_pt = Vector((-1e9, -1e9, -1e9))
    for mobj in mesh_objs:
        for corner in mobj.bound_box:
            wc = mobj.matrix_world @ Vector(corner)
            min_pt.x = min(min_pt.x, wc.x)
            min_pt.y = min(min_pt.y, wc.y)
            min_pt.z = min(min_pt.z, wc.z)
            max_pt.x = max(max_pt.x, wc.x)
            max_pt.y = max(max_pt.y, wc.y)
            max_pt.z = max(max_pt.z, wc.z)

    cx = 0.5 * (min_pt.x + max_pt.x)
    cy = 0.5 * (min_pt.y + max_pt.y)
    cur_h = max(1e-5, max_pt.z - min_pt.z)
    norm_s = (target_height_m / cur_h) if target_height_m else 1.0
    final_s = norm_s * float(scale_factor)

    # Parent top-level imported objects under a clean grounded root Empty at (0, 0, 0)
    root = bpy.data.objects.new(f"{name_prefix}_Root", None)
    root.empty_display_size = 0.02
    collection.objects.link(root)

    top_objs = [obj for obj in imported if obj.name in bpy.data.objects and obj.parent is None]
    for idx, obj in enumerate(top_objs):
        obj.name = f"{name_prefix}_{idx}"
        obj.parent = root
        # Shift so combined center XY -> (0, 0) and bottom Z -> 0 before root scaling
        obj.location = (
            obj.location.x - cx,
            obj.location.y - cy,
            obj.location.z - min_pt.z,
        )

    root.scale = (final_s, final_s, final_s)
    return root, mesh_objs
