"""Core Blender 4.x/5.x shader node helpers for procedural Cycles materials."""

from __future__ import annotations

from typing import Any, Sequence, Tuple, Union

import bpy

SocketName = Union[str, Sequence[str]]
Vec2 = Tuple[float, float]
Vec3 = Tuple[float, float, float]
Rgba = Tuple[float, float, float, float]


def get_or_create_material(name: str) -> Tuple[Any, Any, Any, Any]:
    """Create a fresh Cycles node-based material, reusing/clearing if it exists."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
    if mat.node_tree is None and hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (650, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (320, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat, nt, bsdf, out


def set_input(node: Any, names: SocketName, value: Any) -> Any:
    """Set the first matching input socket name on a shader node."""
    name_list: Sequence[str] = (names,) if isinstance(names, str) else names
    for sock_name in name_list:
        sock = node.inputs.get(sock_name)
        if sock is not None:
            sock.default_value = value
            return sock
    return None


def get_input(node: Any, names: SocketName) -> Any:
    """Return the first matching input socket on a shader node."""
    name_list: Sequence[str] = (names,) if isinstance(names, str) else names
    for sock_name in name_list:
        sock = node.inputs.get(sock_name)
        if sock is not None:
            return sock
    return None


def add_mix_color(
    nt: Any,
    blend_type: str = "MIX",
    clamp_result: bool = True,
    loc: Vec2 = (0.0, 0.0),
) -> Tuple[Any, Any, Any, Any, Any]:
    """Create a color Mix node compatible with Blender 4.x and 5.x.

    Returns (node, fac_in, color_a_in, color_b_in, color_out).
    """
    node = nt.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = blend_type
    if hasattr(node, "clamp_result"):
        node.clamp_result = clamp_result
    node.location = loc

    fac_in = node.inputs.get("Factor")
    if fac_in is None:
        fac_in = node.inputs[0]

    rgba_inputs = [s for s in node.inputs if s.type == "RGBA"]
    rgba_outputs = [s for s in node.outputs if s.type == "RGBA"]
    return node, fac_in, rgba_inputs[0], rgba_inputs[1], rgba_outputs[0]


def add_map_range(
    nt: Any,
    from_min: float,
    from_max: float,
    to_min: float,
    to_max: float,
    clamp: bool = True,
    loc: Vec2 = (0.0, 0.0),
) -> Any:
    """Create a configured ShaderNodeMapRange node."""
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.clamp = clamp
    mr.location = loc
    mr.inputs["From Min"].default_value = from_min
    mr.inputs["From Max"].default_value = from_max
    mr.inputs["To Min"].default_value = to_min
    mr.inputs["To Max"].default_value = to_max
    return mr


def add_tex_coord_mapping(
    nt: Any,
    scale: Vec3 = (1.0, 1.0, 1.0),
    rotation: Vec3 = (0.0, 0.0, 0.0),
    loc: Vec2 = (-900.0, 0.0),
) -> Tuple[Any, Any]:
    """Create Object-space Texture Coordinate + Mapping nodes."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (loc[0] - 220.0, loc[1])
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.location = loc
    mp.inputs["Scale"].default_value = scale
    mp.inputs["Rotation"].default_value = rotation
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    return tc, mp


def apply_shadow_transparency_bypass(
    nt: Any,
    bsdf_out: Any,
    out_node: Any,
    shadow_tint: Rgba = (0.98, 0.99, 1.0, 1.0),
) -> None:
    """Bypass opaque shadow rays for refractive glass/acrylic in Cycles."""
    lp = nt.nodes.new("ShaderNodeLightPath")
    lp.location = (320, 320)
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    transp.location = (320, 160)
    transp.inputs["Color"].default_value = shadow_tint
    mix_sh = nt.nodes.new("ShaderNodeMixShader")
    mix_sh.location = (540, 60)
    nt.links.new(lp.outputs["Is Shadow Ray"], mix_sh.inputs["Fac"])
    nt.links.new(bsdf_out, mix_sh.inputs[1])
    nt.links.new(transp.outputs["BSDF"], mix_sh.inputs[2])
    nt.links.new(mix_sh.outputs["Shader"], out_node.inputs["Surface"])
