"""Shared bmesh geometry, lighting, and coordinate utilities for studio_blender/envs."""

from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

Vec3 = Tuple[float, float, float]


def get_or_create_collection(name: str) -> Any:
    """Return an existing scene collection or create and link a new one."""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def set_smooth_polygons(mesh: Any, smooth: bool = True) -> None:
    """Apply flat or smooth polygon shading safely across Blender 4.x and 5.x."""
    n_polys = len(mesh.polygons)
    if n_polys > 0:
        mesh.polygons.foreach_set("use_smooth", [bool(smooth)] * n_polys)


def create_mesh_object(
    name: str,
    bm: Any,
    collection: Any,
    material: Optional[Any] = None,
    smooth: bool = False,
    location: Vec3 = (0.0, 0.0, 0.0),
    rotation: Vec3 = (0.0, 0.0, 0.0),
) -> Any:
    """Convert a bmesh into a linked Blender mesh object and free the bmesh."""
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    set_smooth_polygons(mesh, smooth=smooth)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    obj.location = Vector(location)
    obj.rotation_euler = Euler(rotation, "XYZ")
    collection.objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    return obj


def add_bevel(obj: Any, width: float = 0.0005, segments: int = 3, limit_method: str = "ANGLE") -> Any:
    """Attach a clamped Bevel modifier for realistic specular edge highlights."""
    mod = obj.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = limit_method
    mod.angle_limit = math.radians(30.0)
    mod.use_clamp_overlap = True
    return mod


def add_subsurf(obj: Any, levels: int = 2) -> Any:
    """Attach a Subdivision Surface modifier."""
    mod = obj.modifiers.new(name="Subsurf", type="SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    return mod


def make_box_bm(sx: float, sy: float, sz: float, center: Vec3 = (0.0, 0.0, 0.0)) -> Any:
    """Create a bmesh axis-aligned box of dimensions (sx, sy, sz)."""
    bm = bmesh.new()
    mat = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((sx, sy, sz, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=mat)
    return bm


def make_lathe_bm(
    profile_rz: Sequence[Tuple[float, float]],
    segments: int = 64,
    cap_bottom: bool = True,
    cap_top: bool = False,
) -> Any:
    """Revolve a list of (radius, z) profile points around the local +Z axis."""
    bm = bmesh.new()
    rings: List[List[Any]] = []
    for r, z in profile_rz:
        ring = []
        for i in range(segments):
            ang = 2.0 * math.pi * i / segments
            ring.append(bm.verts.new((r * math.cos(ang), r * math.sin(ang), z)))
        rings.append(ring)

    bm.verts.ensure_lookup_table()
    for j in range(len(rings) - 1):
        r0 = rings[j]
        r1 = rings[j + 1]
        for i in range(segments):
            ni = (i + 1) % segments
            bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))

    if cap_bottom and rings and profile_rz[0][0] > 1e-6:
        c_bot = bm.verts.new((0.0, 0.0, profile_rz[0][1]))
        r0 = rings[0]
        for i in range(segments):
            ni = (i + 1) % segments
            bm.faces.new((r0[ni], r0[i], c_bot))

    if cap_top and rings and profile_rz[-1][0] > 1e-6:
        c_top = bm.verts.new((0.0, 0.0, profile_rz[-1][1]))
        r_last = rings[-1]
        for i in range(segments):
            ni = (i + 1) % segments
            bm.faces.new((r_last[i], r_last[ni], c_top))

    return bm


def make_tube_bm(points: Sequence[Vector], radius: float, segments: int = 12) -> Any:
    """Sweep a circular cross-section along a polyline using twist-free parallel transport."""
    bm = bmesh.new()
    rings: List[List[Any]] = []
    n_pts = len(points)
    prev_side_a: Optional[Vector] = None
    for k, pt in enumerate(points):
        t_vec = (points[min(k + 1, n_pts - 1)] - points[max(k - 1, 0)]).normalized()
        if prev_side_a is None:
            ref = Vector((0.0, 1.0, 0.0)) if abs(t_vec.y) < 0.90 else Vector((1.0, 0.0, 0.0))
            side_a = (ref - t_vec * ref.dot(t_vec)).normalized()
        else:
            proj = prev_side_a - t_vec * prev_side_a.dot(t_vec)
            side_a = proj.normalized() if proj.length > 1e-6 else prev_side_a
        prev_side_a = side_a
        side_b = t_vec.cross(side_a).normalized()
        ring = []
        for s in range(segments):
            ang = 2.0 * math.pi * s / segments
            pos = pt + (side_a * math.cos(ang) + side_b * math.sin(ang)) * radius
            ring.append(bm.verts.new(pos))
        rings.append(ring)

    for j in range(len(rings) - 1):
        for s in range(segments):
            ns = (s + 1) % segments
            bm.faces.new((rings[j][s], rings[j][ns], rings[j + 1][ns], rings[j + 1][s]))
    return bm


def aim_object_at(obj: Any, target_pt: Sequence[float]) -> None:
    """Aim a Blender light or camera (-Z forward, +Y up) continuously with Euler wrap safety."""
    direction = Vector(target_pt) - obj.location
    if direction.length < 1e-6:
        return
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler("XYZ", obj.rotation_euler)


def spherical_offset(azimuth_deg: float, elevation_deg: float, distance: float) -> Vector:
    """Compute world offset from spherical angles (0 deg = front -Y, +90 deg = right +X)."""
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    horiz = distance * math.cos(el)
    return Vector((horiz * math.sin(az), -horiz * math.cos(az), distance * math.sin(el)))


def create_area_light(
    name: str,
    collection: Any,
    location: Sequence[float],
    target: Sequence[float],
    energy: float,
    color: Vec3 = (1.0, 1.0, 1.0),
    size_x: float = 0.5,
    size_y: float = 0.5,
    spread_deg: Optional[float] = None,
    visible_camera: bool = False,
    visible_glossy: bool = True,
) -> Any:
    """Create and aim a rectangular Cycles AREA light with optional spread cone."""
    ldata = bpy.data.lights.new(name=name + "_Data", type="AREA")
    ldata.shape = "RECTANGLE"
    ldata.size = size_x
    ldata.size_y = size_y
    ldata.energy = energy
    ldata.color = color
    if spread_deg is not None and hasattr(ldata, "spread"):
        ldata.spread = math.radians(spread_deg)

    lobj = bpy.data.objects.new(name=name, object_data=ldata)
    lobj.location = Vector(location)
    aim_object_at(lobj, target)
    collection.objects.link(lobj)

    if hasattr(lobj, "visible_camera"):
        lobj.visible_camera = visible_camera
    if hasattr(lobj, "visible_glossy"):
        lobj.visible_glossy = visible_glossy
    return lobj


def parse_model_bounds(model_bounds: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalize model_bounds dict keys across desk_flat and wall_mount callers."""
    mb = model_bounds or {}
    width_m = float(mb.get("width_m", mb.get("frame_width_m", 0.122)))
    height_m = float(mb.get("height_m", mb.get("frame_height_m", 0.172)))
    outer_w = float(mb.get("outer_width_m", width_m + 0.008))
    outer_h = float(mb.get("outer_height_m", height_m + 0.008))
    max_z = float(mb.get("max_z", mb.get("max_z_m", 0.085)))
    desk_z = float(mb.get("desk_z", mb.get("desk_z_m", -0.0053)))
    frame_top_z = float(mb.get("frame_top_z", 0.0033))
    wall_y = float(mb.get("wall_y", 0.0015))
    return {
        "width_m": width_m,
        "height_m": height_m,
        "outer_width_m": outer_w,
        "outer_height_m": outer_h,
        "max_z": max_z,
        "desk_z": desk_z,
        "frame_top_z": frame_top_z,
        "wall_y": wall_y,
        "water_side": mb.get("water_side"),
    }


def parent_objects_to_empty(
    name: str,
    objects: Iterable[Any],
    collection: Any,
    location: Vec3 = (0.0, 0.0, 0.0),
    rotation_z_deg: float = 0.0,
    scale: float = 1.0,
) -> Any:
    """Parent a group of local-origin prop meshes under one positioned/rotated Empty."""
    root = bpy.data.objects.new(name, None)
    root.empty_display_size = 0.015
    root.location = Vector(location)
    root.rotation_euler = Euler((0.0, 0.0, math.radians(rotation_z_deg)), "XYZ")
    root.scale = (scale, scale, scale)
    collection.objects.link(root)
    for obj in objects:
        obj.parent = root
    return root
