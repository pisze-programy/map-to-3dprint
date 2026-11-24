"""Blender 5.3.0 DSLR photographic compositor finishing for lifestyle interior scenes.

Adds subtle optical highlight bloom (Fog Glow), gentle lens vignette, warm editorial
AgX color polish, and ultra-fine 35mm organic film micro-grain for environments 01-08.
Strictly disabled on 09_dark_cinematic, 10_macro_editorial, and 11_packshot_white.
"""

from __future__ import annotations

from typing import Any, Optional, Tuple

import bpy

_RAW_STUDIO_ENVS = frozenset({
    "09_dark_cinematic",
    "10_macro_editorial",
    "11_packshot_white",
})


def _get_rgba_mix_sockets(node: Any) -> Tuple[Any, Any, Any, Any]:
    fac_in = node.inputs.get("Factor") or node.inputs[0]
    rgba_in = [s for s in node.inputs if s.type == "RGBA"]
    rgba_out = [s for s in node.outputs if s.type == "RGBA"]
    return fac_in, rgba_in[0], rgba_in[1], rgba_out[0]


def _clear_compositor(scene: Any) -> None:
    scene.render.use_compositing = False
    if hasattr(scene, "compositing_node_group"):
        try:
            scene.compositing_node_group = None
        except Exception:
            pass


def setup_photographic_compositor(
    scene: Any,
    env_id: str,
    bloom_strength: float = 0.055,
    vignette_strength: float = 0.06,
    grain_strength: float = 0.010,
    warm_gain: Tuple[float, float, float] = (1.015, 1.004, 0.985),
) -> Optional[Any]:
    """Attach a Blender 5.3.0 CompositorNodeTree for authentic DSLR finishing on 01-08."""
    if env_id in _RAW_STUDIO_ENVS:
        _clear_compositor(scene)
        return None

    if not hasattr(scene, "compositing_node_group"):
        return None

    scene.render.use_compositing = True
    ng_name = f"StudioComp_{env_id}"
    old_ng = bpy.data.node_groups.get(ng_name)
    if old_ng is not None:
        bpy.data.node_groups.remove(old_ng)

    ng = bpy.data.node_groups.new(ng_name, "CompositorNodeTree")
    scene.compositing_node_group = ng
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")

    rl = ng.nodes.new("CompositorNodeRLayers")
    rl.location = (-600, 0)
    cur_out = rl.outputs["Image"]

    # 1. Subtle DSLR Fog Glow highlight halation on sunlit window edges & specular glass
    try:
        glare = ng.nodes.new("CompositorNodeGlare")
        glare.location = (-320, 40)
        glare.inputs["Type"].default_value = "Fog Glow"
        glare.inputs["Quality"].default_value = "High"
        glare.inputs["Threshold"].default_value = 1.10
        glare.inputs["Size"].default_value = 0.65
        glare.inputs["Strength"].default_value = float(bloom_strength)
        ng.links.new(cur_out, glare.inputs["Image"])
        cur_out = glare.outputs["Image"]
    except Exception:
        pass

    # 2. Gentle warm editorial color polish (subtle Lift/Gamma/Gain)
    try:
        cb = ng.nodes.new("CompositorNodeColorBalance")
        cb.location = (-40, 40)
        cb.inputs["Type"].default_value = "Lift/Gamma/Gain"
        cb.inputs["Factor"].default_value = 0.28
        gain_socks = [s for s in cb.inputs if s.name == "Gain" and s.type == "RGBA"]
        if gain_socks:
            gain_socks[0].default_value = (warm_gain[0], warm_gain[1], warm_gain[2], 1.0)
        ng.links.new(cur_out, cb.inputs["Image"])
        cur_out = cb.outputs["Image"]
    except Exception:
        pass

    # 3. Gentle natural optical lens corner falloff (vignette ~6%)
    if vignette_strength > 1e-4:
        try:
            emask = ng.nodes.new("CompositorNodeEllipseMask")
            emask.location = (-320, -280)
            emask.inputs["Size"].default_value = (0.90, 0.92)

            blur = ng.nodes.new("CompositorNodeBlur")
            blur.location = (-120, -280)
            blur.inputs["Size"].default_value = (260.0, 260.0)
            ng.links.new(emask.outputs["Mask"], blur.inputs["Image"])

            mix_v = ng.nodes.new("ShaderNodeMix")
            mix_v.data_type = "RGBA"
            mix_v.blend_type = "MULTIPLY"
            mix_v.location = (220, 40)
            fac_v, a_v, b_v, out_v = _get_rgba_mix_sockets(mix_v)
            fac_v.default_value = float(vignette_strength)
            ng.links.new(cur_out, a_v)
            ng.links.new(blur.outputs["Image"], b_v)
            cur_out = out_v
        except Exception:
            pass

    # 4. Ultra-subtle organic 35mm medium-format film grain (~0.01)
    if grain_strength > 1e-4:
        try:
            noise = ng.nodes.new("ShaderNodeTexNoise")
            noise.location = (220, -240)
            noise.inputs["Scale"].default_value = 950.0
            noise.inputs["Detail"].default_value = 2.0

            mix_g = ng.nodes.new("ShaderNodeMix")
            mix_g.data_type = "RGBA"
            mix_g.blend_type = "OVERLAY"
            mix_g.location = (460, 40)
            fac_g, a_g, b_g, out_g = _get_rgba_mix_sockets(mix_g)
            fac_g.default_value = float(grain_strength)
            ng.links.new(cur_out, a_g)
            ng.links.new(noise.outputs["Color"], b_g)
            cur_out = out_g
        except Exception:
            pass

    out_node = ng.nodes.new("NodeGroupOutput")
    out_node.location = (700, 40)
    ng.links.new(cur_out, out_node.inputs["Image"])
    return ng
