"""Canonical studio environment, frame, camera preset, and prop catalog definitions.

Single source of truth for CLI (`render_studio.py`), Blender worker, and MCP server.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple


ENVIRONMENTS: Dict[str, Dict[str, str]] = {
    "01_architect_window_desk": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Honed travertine desk, black-mullioned studio window casting crisp diagonal daylight "
            "shafts, brushed-steel architectural ruler & machined pen."
        ),
    },
    "02_creative_office_desk": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Matte dark walnut desk with soft office window-blinds light streaks, aluminum laptop "
            "corner, matte-black smartphone & ceramic espresso cup."
        ),
    },
    "03_morning_coffee_table": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Warm limestone/travertine coffee table in soft morning window sun with ceramic "
            "espresso cup and linen-bound architectural monograph."
        ),
    },
    "04_minimal_home_console": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Brushed matte oak sideboard console against warm limewash plaster wall in soft "
            "daylight with stoneware ceramic vessel & clear glass tumbler."
        ),
    },
    "05_gallery_wall_sunlight": {
        "mount": "wall_mount",
        "default_preset": "hero_wall",
        "description": (
            "WALL MOUNT on warm textured limewash/microcement wall with dramatic diagonal "
            "afternoon window-mullion light raking across skyscrapers & minimal floating ledge."
        ),
    },
    "06_architect_slat_wall": {
        "mount": "wall_mount",
        "default_preset": "hero_wall",
        "description": (
            "WALL MOUNT on modern vertical acoustic oak-slat & matte charcoal plaster feature "
            "wall with warm directional gallery ceiling spotlight."
        ),
    },
    "07_evening_warm_desk": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Deep charcoal microcement desk at twilight with warm 2900K architectural desk-lamp "
            "light pool vs cool dusk window glow, machined pen & glass tumbler."
        ),
    },
    "08_loft_concrete_studio": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Architectural poured concrete workbench with overcast skylight, warm side fill, "
            "brushed-steel ruler, monograph book & ceramic coffee mug."
        ),
    },
    "09_dark_cinematic": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Honed volcanic basalt plinth with razor-sharp golden raking key, cool rim & subtle "
            "atmospheric depth for luxury Meta/TikTok ad cuts."
        ),
    },
    "10_macro_editorial": {
        "mount": "desk_flat",
        "default_preset": "macro_skyline",
        "description": (
            "Dedicated 90mm f/2.0 razor-sharp plaster-grain macro stage with crisp raking side "
            "light & creamy dark-neutral bokeh proving 10K MSLA print detail."
        ),
    },
    "11_packshot_white": {
        "mount": "desk_flat",
        "default_preset": "packshot_iso",
        "description": (
            "Pure #FFFFFF seamless e-commerce studio cyclorama + Cycles shadow-catcher showing "
            "pure 13x18 Variant C product truth with zero props."
        ),
    },
}

ENV_ALIASES: Dict[str, str] = {
    "desk_daylight": "01_architect_window_desk",
    "leather_workspace": "02_creative_office_desk",
    "dark_cinematic": "09_dark_cinematic",
    "macro_editorial": "10_macro_editorial",
    "packshot_white": "11_packshot_white",
}

ALL_ENV_CHOICES: Tuple[str, ...] = tuple(ENVIRONMENTS.keys()) + tuple(ENV_ALIASES.keys())

FRAME_STYLES: Dict[str, str] = {
    "single_13x18": (
        "True Variant C 130x180mm ultra-thin matte-black frame (4.0mm bezel, 7.5mm low-profile "
        "height, matte-black archival backing, no nameplate by default; stacks 2 tiles seamlessly)."
    ),
    "single_thin": "Ultra-thin matte-black frame (4.0mm bezel) hugging the exact tile footprint.",
    "single_thick": "Gallery matte-black shadowbox frame (10.0mm bezel) with matte-black backing.",
    "cube_cover": "Matte-black plinth base with crystal-clear museum acrylic cover (IOR 1.49).",
    "triptych_3x1": "3-tile side-by-side matte-black wall/desk collection (pass 3 --stl flags).",
    "quartet_2x2": "4-tile 2x2 matte-black architectural wall/desk grid (pass 4 --stl flags).",
}

STILL_PRESETS: Dict[str, str] = {
    "hero_desk": "Editorial 3/4 desk lifestyle hero framing the full 13x18 matte-black frame, skyline & real scale props.",
    "hero_wall": "Architectural Digest 3/4 gallery wall-mount hero highlighting protruding 3D relief & raking shadows.",
    "macro_skyline": "Intimate 90mm f/2.0 macro locked onto the tallest hero tower facade showing tactile 10K plaster grain.",
    "macro_waterfront": "Oblique 75mm f/2.2 macro across matte-black water cutout into white architectural skyscrapers.",
    "profile_low": "Dramatic low-angle 85mm telephoto skyline silhouette emphasizing spire height & thin bezel.",
    "top_down": "Clean 85mm gallery overhead plan view showing crisp street grid geometry inside the black frame.",
    "packshot_iso": "E-commerce 3/4 product hero (68mm f/7.1 tack-sharp front-to-back) with clean balanced margins.",
}

VIDEO_SHOTS: List[Dict[str, Any]] = [
    {
        "index": 1,
        "id": "shot01_hero_crash_zoom",
        "timing": "0.0-2.0s",
        "description": "Full-environment 13x18 establish -> buttery exponential speed-ramp crash-zoom into skyline.",
    },
    {
        "index": 2,
        "id": "shot02_crane_rise_raking_light",
        "timing": "2.0-4.0s",
        "description": "Low-angle 85mm f/2.0 crane rise up the hero spire as warm raking light sweeps across facades.",
    },
    {
        "index": 3,
        "id": "shot03_overhead_canyon_swoop",
        "timing": "4.0-6.5s",
        "description": "Continuous high-oblique to eye-level orbital swoop gliding down into the auto-detected canyon.",
    },
    {
        "index": 4,
        "id": "shot04_pullout_environment_reveal",
        "timing": "6.5-9.0s",
        "description": "Smooth decelerating crane pull-out revealing the entire framed 13x18 sculpture in its room.",
    },
]

DEFAULT_PROPS_CATALOG: Dict[str, Dict[str, Any]] = {
    "espresso_cup": {"category": "tableware", "approx_mm": [62, 62, 58], "description": "Ceramic espresso cup & saucer"},
    "coffee_mug": {"category": "tableware", "approx_mm": [84, 84, 92], "description": "Matte stoneware coffee mug"},
    "glass_tumbler": {"category": "tableware", "approx_mm": [76, 76, 94], "description": "Clear minimalist water tumbler"},
    "arch_book": {"category": "editorial", "approx_mm": [220, 280, 28], "description": "Textured linen architectural monograph"},
    "ceramic_vessel": {"category": "decor", "approx_mm": [105, 105, 165], "description": "Sculptural matte stoneware vessel"},
    "laptop_corner": {"category": "desk_tech", "approx_mm": [304, 212, 15], "description": "Machined aluminum laptop corner"},
    "smartphone": {"category": "desk_tech", "approx_mm": [72, 148, 8], "description": "Matte-black smartphone face-down"},
    "architect_pen": {"category": "stationery", "approx_mm": [142, 10, 10], "description": "Machined matte-black/brass technical pen"},
    "steel_ruler": {"category": "stationery", "approx_mm": [200, 22, 16], "description": "Brushed-steel triangular architectural scale ruler"},
    "desk_lamp_edge": {"category": "lighting", "approx_mm": [160, 160, 380], "description": "Minimalist architectural desk lamp"},
}


def resolve_env_name(name: str) -> str:
    """Resolve canonical environment ID or backwards-compatible alias."""
    key = (name or "01_architect_window_desk").strip()
    if key in ENVIRONMENTS:
        return key
    if key in ENV_ALIASES:
        return ENV_ALIASES[key]
    raise ValueError(f"Unknown environment '{name}'. Choose from {ALL_ENV_CHOICES}.")


def get_env_mount(env_name: str, mount_override: str = "auto") -> str:
    """Return 'desk_flat' or 'wall_mount' given environment default and optional override."""
    if mount_override in ("desk_flat", "wall_mount"):
        return mount_override
    canonical = resolve_env_name(env_name)
    return ENVIRONMENTS[canonical]["mount"]


def get_default_still_preset(env_name: str, mount: str = "desk_flat") -> str:
    canonical = resolve_env_name(env_name)
    if mount == "wall_mount":
        return "hero_wall"
    return ENVIRONMENTS[canonical]["default_preset"]


def get_studio_presets() -> Dict[str, Any]:
    """Return complete metadata catalog of studio environments, frames, stills, and video shots."""
    return {
        "environments": {k: v["description"] for k, v in ENVIRONMENTS.items()},
        "environment_details": ENVIRONMENTS,
        "environment_aliases": ENV_ALIASES,
        "frame_styles": FRAME_STYLES,
        "still_presets": STILL_PRESETS,
        "video_shots": VIDEO_SHOTS,
        "mounts": ["auto", "desk_flat", "wall_mount"],
        "backing_finishes": ["matte_black", "satin_black"],
        "aspect_ratios": ["9:16", "4:5", "1:1", "16:9"],
        "modes": ["stills", "keyframes", "video"],
    }


def get_studio_props() -> Dict[str, Any]:
    """Return available composable scale props (live from props registry when importable)."""
    try:
        from studio_blender import environments  # type: ignore

        if hasattr(environments, "list_available_props"):
            live = environments.list_available_props()
            if isinstance(live, dict) and live:
                return {
                    "props": live,
                    "custom_prop_syntax": "/abs/path/to/model.glb@x_mm,y_mm,yaw_deg,scale",
                    "placement_origin": "Relative to frame outer edges in millimeters on tabletop",
                }
    except Exception:
        pass
    return {
        "props": DEFAULT_PROPS_CATALOG,
        "custom_prop_syntax": "/abs/path/to/model.glb@x_mm,y_mm,yaw_deg,scale",
        "placement_origin": "Relative to frame outer edges in millimeters on tabletop",
    }
