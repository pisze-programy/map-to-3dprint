"""Blender 5.3.0 DSLR & cinema compositor finishing for lifestyle & persona scenes.

Adds optical highlight halation (Fog Glow), subtle cinema Teal-Shadow / Warm-Gold
split-tone grading, gentle filmic S-curve contrast, optical vignette, and fine
35mm micro-grain (automatically capped <= 0.003 during motion-blur video renders
to prevent temporal flicker). Strictly disabled on 09, 10, and 11.
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


def _set_named_rgba(node: Any, name: str, rgba: Tuple[float, float, float, float]) -> None:
    socks = [s for s in node.inputs if s.name == name and s.type == "RGBA"]
    if socks:
        socks[0].default_value = rgba


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
    cinema_grade: bool = False,
    cool_lift: Tuple[float, float, float] = (0.974, 0.992, 1.022),
    mid_gamma: Tuple[float, float, float] = (0.992, 0.996, 1.000),
    is_video: bool = False,
) -> Optional[Any]:
    """Attach a Blender 5.3.0 CompositorNodeTree for DSLR or cinema finishing."""
    if env_id in _RAW_STUDIO_ENVS:
        _clear_compositor(scene)
        return None
    if not hasattr(scene, "compositing_node_group"):
        return None

    video_mode = bool(is_video or getattr(scene.render, "use_motion_blur", False))
    eff_grain = min(float(grain_strength), 0.0025) if video_mode else float(grain_strength)

    scene.render.use_compositing = True
    ng_name = f"StudioComp_{env_id}"
    old_ng = bpy.data.node_groups.get(ng_name)
    if old_ng is not None:
        bpy.data.node_groups.remove(old_ng)

    ng = bpy.data.node_groups.new(ng_name, "CompositorNodeTree")
    scene.compositing_node_group = ng
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")

    rl = ng.nodes.new("CompositorNodeRLayers")
    rl.location = (-780, 0)
    cur_out = rl.outputs["Image"]

    # 1. Optical Fog Glow highlight halation on sunlit edges, glass, and brushed brass
    try:
        glare = ng.nodes.new("CompositorNodeGlare")
        glare.location = (-500, 40)
        glare.inputs["Type"].default_value = "Fog Glow"
        glare.inputs["Quality"].default_value = "High"
        glare.inputs["Threshold"].default_value = 1.05 if cinema_grade else 1.10
        glare.inputs["Size"].default_value = 0.65
        glare.inputs["Strength"].default_value = float(bloom_strength)
        ng.links.new(cur_out, glare.inputs["Image"])
        cur_out = glare.outputs["Image"]
    except Exception:
        pass

    # 2. Color balance: cinema Teal-Shadow / Warm-Gold Split-Tone (personas) or gentle polish (01-08)
    try:
        cb = ng.nodes.new("CompositorNodeColorBalance")
        cb.location = (-220, 40)
        cb.inputs["Type"].default_value = "Lift/Gamma/Gain"
        cb.inputs["Factor"].default_value = 0.48 if cinema_grade else 0.28
        if cinema_grade:
            _set_named_rgba(cb, "Lift", (cool_lift[0], cool_lift[1], cool_lift[2], 1.0))
            _set_named_rgba(cb, "Gamma", (mid_gamma[0], mid_gamma[1], mid_gamma[2], 1.0))
        _set_named_rgba(cb, "Gain", (warm_gain[0], warm_gain[1], warm_gain[2], 1.0))
        ng.links.new(cur_out, cb.inputs["Image"])
        cur_out = cb.outputs["Image"]
    except Exception:
        pass

    # 3. Gentle filmic S-curve contrast on cinema-graded persona environments
    if cinema_grade:
        try:
            crv = ng.nodes.new("CompositorNodeCurveRGB")
            crv.location = (40, 40)
            crv.inputs["Factor"].default_value = 0.52
            c_master = crv.mapping.curves[3]
            c_master.points.new(0.22, 0.192)
            c_master.points.new(0.50, 0.504)
            c_master.points.new(0.80, 0.832)
            crv.mapping.update()
            ng.links.new(cur_out, crv.inputs["Image"])
            cur_out = crv.outputs["Image"]
        except Exception:
            pass

    # 4. Natural optical lens corner vignette guiding eye to hero city
    if vignette_strength > 1e-4:
        try:
            emask = ng.nodes.new("CompositorNodeEllipseMask")
            emask.location = (-200, -280)
            emask.inputs["Size"].default_value = (0.86, 0.88) if cinema_grade else (0.90, 0.92)

            blur = ng.nodes.new("CompositorNodeBlur")
            blur.location = (20, -280)
            blur.inputs["Size"].default_value = (280.0, 280.0)
            ng.links.new(emask.outputs["Mask"], blur.inputs["Image"])

            mix_v = ng.nodes.new("ShaderNodeMix")
            mix_v.data_type = "RGBA"
            mix_v.blend_type = "MULTIPLY"
            mix_v.location = (320, 40)
            fac_v, a_v, b_v, out_v = _get_rgba_mix_sockets(mix_v)
            fac_v.default_value = float(vignette_strength)
            ng.links.new(cur_out, a_v)
            ng.links.new(blur.outputs["Image"], b_v)
            cur_out = out_v
        except Exception:
            pass

    # 5. Ultra-subtle organic 35mm grain (capped <= 0.0025 during video to prevent flicker)
    if eff_grain > 1e-4:
        try:
            noise = ng.nodes.new("ShaderNodeTexNoise")
            noise.location = (320, -240)
            noise.inputs["Scale"].default_value = 980.0
            noise.inputs["Detail"].default_value = 2.0

            mix_g = ng.nodes.new("ShaderNodeMix")
            mix_g.data_type = "RGBA"
            mix_g.blend_type = "OVERLAY"
            mix_g.location = (560, 40)
            fac_g, a_g, b_g, out_g = _get_rgba_mix_sockets(mix_g)
            fac_g.default_value = eff_grain
            ng.links.new(cur_out, a_g)
            ng.links.new(noise.outputs["Color"], b_g)
            cur_out = out_g
        except Exception:
            pass

    out_node = ng.nodes.new("NodeGroupOutput")
    out_node.location = (800, 40)
    ng.links.new(cur_out, out_node.inputs["Image"])
    return ng
