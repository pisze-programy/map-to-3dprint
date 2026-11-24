"""Tailored Google Flow (Frames to Video / Veo 3.1) prompt builder for all 11 environments."""

from __future__ import annotations

from typing import Any, Dict, Sequence

from studio_blender.studio_presets import resolve_env_name


_ENV_PROMPT_DESCRIPTIONS: Dict[str, str] = {
    "01_architect_window_desk": (
        "resting flat on a honed warm travertine desk beside a brushed-steel architectural scale "
        "ruler and machined matte-black pen, with crisp diagonal daylight shafts cast through a "
        "black-mullioned studio window in the background"
    ),
    "02_creative_office_desk": (
        "resting flat on a matte dark walnut desk beside an anodized aluminum laptop corner, "
        "matte-black smartphone, and ceramic espresso cup under soft office window-blinds light"
    ),
    "03_morning_coffee_table": (
        "resting flat on a warm travertine coffee table beside a porcelain espresso cup and "
        "linen-bound architectural monograph in soft morning window sunlight"
    ),
    "04_minimal_home_console": (
        "resting flat on a brushed matte oak sideboard console against a warm limewash plaster "
        "wall beside a sculptural stoneware ceramic vessel and clear glass tumbler"
    ),
    "05_gallery_wall_sunlight": (
        "mounted flush on a warm textured limewash architectural gallery wall with a subtle "
        "1.5mm shadow gap and zero stand, illuminated by dramatic diagonal afternoon window-mullion sun"
    ),
    "06_architect_slat_wall": (
        "mounted flush on a modern vertical acoustic oak-slat and matte charcoal plaster feature "
        "wall with zero stand, sculpted by a warm directional gallery ceiling spotlight"
    ),
    "07_evening_warm_desk": (
        "resting flat on a deep charcoal microcement desk at twilight under a warm 2900K "
        "architectural desk-lamp pool contrasting with cool dusk window glow"
    ),
    "08_loft_concrete_studio": (
        "resting flat on an architectural poured concrete workbench under soft overcast loft "
        "skylight beside a steel scale ruler, architectural monograph, and stoneware mug"
    ),
    "09_dark_cinematic": (
        "resting flat on a honed dark volcanic basalt plinth sculpted by a razor-sharp golden "
        "raking spotlight, cool rim accent, and subtle studio atmosphere"
    ),
    "10_macro_editorial": (
        "on a minimalist architectural macro photography stage with razor-sharp raking side "
        "light and creamy dark-neutral depth-of-field bokeh showcasing fine 10K plaster grain"
    ),
    "11_packshot_white": (
        "on a pure seamless #FFFFFF studio cyclorama with crisp softbox lighting and clean "
        "physical contact shadow"
    ),
}

_SHOT_MOTION_PROMPTS: Dict[int, str] = {
    1: (
        "Smooth continuous cinema camera move with zero initial pause: begins with a brief "
        "establishing drift showing the entire 13x18cm matte-black framed architectural city "
        "sculpture in real scale, then accelerates into a buttery exponential speed-ramp "
        "crash-zoom gliding into the skyscraper cluster as shallow f/2.0 bokeh blooms. 24fps."
    ),
    2: (
        "Silky smooth low-angle 85mm f/2.0 vertical crane rise up the tallest hero tower with "
        "gentle orbital parallax while warm raking sunlight sweeps steadily across the matte "
        "white plaster facades casting crisp gliding architectural shadows."
    ),
    3: (
        "Continuous sweeping orbital crane arc descending smoothly from a high oblique vista "
        "down into the miniature street canyon at eye level, gliding between flanking towers "
        "toward the hero spire over deep matte-black archival backing."
    ),
    4: (
        "Smooth decelerating cinema crane pull-out transitioning from intimate skyscraper "
        "macro detail back out to a wide luxury product reveal of the entire ultra-thin "
        "matte-black framed sculpture in its authentic architectural space."
    ),
}


def build_flow_prompts(
    city_title: str,
    env_name: str,
    shots: Sequence[Dict[str, Any]],
    keyframe_files: Dict[int, Dict[str, str]],
) -> Dict[str, Any]:
    """Generate tailored Google Flow (Frames to Video / Veo 3.1) prompts per shot."""
    canonical = resolve_env_name(env_name)
    env_desc = _ENV_PROMPT_DESCRIPTIONS.get(canonical, _ENV_PROMPT_DESCRIPTIONS["01_architect_window_desk"])
    material_anchor = (
        f"Photorealistic 3D architectural scale model of {city_title} printed in tactile matte "
        f"gallery-white mineral plaster inside an ultra-thin 4mm neutral matte-black 13x18cm "
        f"frame over deep matte-black archival backing (no nameplate, no mirror glare), "
        f"{env_desc}. Preserve exact geometry, crisp building edges, and rigid physical "
        f"solidity with zero warping or morphing."
    )

    entries = []
    for shot in shots:
        idx = int(shot["index"])
        files = keyframe_files.get(idx, {})
        entries.append(
            {
                "shot_index": idx,
                "shot_id": shot["id"],
                "title": shot["title"],
                "duration_sec": shot["duration_sec"],
                "start_frame": files.get("start", ""),
                "end_frame": files.get("end", ""),
                "veo_prompt": f"{material_anchor} {_SHOT_MOTION_PROMPTS.get(idx, '')}",
            }
        )

    return {
        "city_title": city_title,
        "environment": canonical,
        "aspect_ratio": "9:16",
        "workflow": "Google Flow -> Frames to Video (upload start_frame and end_frame per shot)",
        "shots": entries,
    }
