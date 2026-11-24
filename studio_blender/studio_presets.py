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
    "12_persona_architect": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Architect studio: pale ash-oak workbench beside black-mullioned studio window "
            "overlooking blurred city towers, rolled vellum, concrete pencil cup, basswood maquette & lamp."
        ),
    },
    "13_persona_traveler": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Traveler golden-hour walnut desk with real CC0 vintage Leica rangefinder camera, blind-debossed "
            "travel monographs, sculptural brass tabletop globe, antique compass & sunlit greenery."
        ),
    },
    "14_persona_lawyer": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Executive law office: deep oiled mahogany desk in warm 2700K study with gold-banded dark leather "
            "law volumes, tufted leather chair in bokeh, stitched espresso desk folio & black-and-gold pen."
        ),
    },
    "15_persona_corporate": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Corporate high-rise office: smoked-walnut executive desk beside floor-to-ceiling glass curtain wall "
            "overlooking sunlit skyscrapers, straight aluminum laptop, unbranded matte-black mug & concrete planter."
        ),
    },
    "16_persona_realestate": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Luxury real-estate showroom: honed warm Calacatta veined marble table beside glass tower windows, "
            "fluted crystal vase with real CC0 botanical stems, material-sample board & distant basswood maquette."
        ),
    },
    "17_persona_executive_study": {
        "mount": "desk_flat",
        "default_preset": "hero_desk",
        "description": (
            "Executive home study (Gabinet): oiled walnut desk before a warm-lit dark wood library bookcase, "
            "spun brushed-brass dome desk lamp, stitched leather notebook & brass-framed architectural print."
        ),
    },
    "18_detail_chalk_gallery": {
        "mount": "desk_flat",
        "default_preset": "detail_spire",
        "description": (
            "Frameless chalk-plaster architectural detail gallery: luminous pure #FFFFFF horizon, "
            "razor-sharp low-angle sunlight shadows & tactile dry chalk-resin macro texture."
        ),
    },
}

PERSONA_ENV_ALIASES: Dict[str, str] = {
    "persona_architect": "12_persona_architect",
    "persona_traveler": "13_persona_traveler",
    "persona_lawyer": "14_persona_lawyer",
    "persona_corporate": "15_persona_corporate",
    "persona_realestate": "16_persona_realestate",
    "persona_executive_study": "17_persona_executive_study",
}

PERSONA_HERO_PROFILES: Dict[str, Tuple[float, float, float, float, float, float, float]] = {
    "12_persona_architect": (50.0, 2.8, 21.0, -17.0, 0.032, 0.68, 0.64),
    "13_persona_traveler": (50.0, 2.6, 20.0, -16.0, 0.035, 0.68, 0.64),
    "14_persona_lawyer": (50.0, 2.6, 21.0, -17.0, 0.035, 0.68, 0.64),
    "15_persona_corporate": (48.0, 2.8, 21.0, -16.0, 0.035, 0.66, 0.62),
    "16_persona_realestate": (50.0, 2.8, 22.0, -18.0, 0.032, 0.68, 0.64),
    "17_persona_executive_study": (50.0, 2.6, 20.0, -16.0, 0.035, 0.68, 0.64),
}

ENV_ALIASES: Dict[str, str] = {
    "desk_daylight": "01_architect_window_desk",
    "leather_workspace": "02_creative_office_desk",
    "dark_cinematic": "09_dark_cinematic",
    "macro_editorial": "10_macro_editorial",
    "packshot_white": "11_packshot_white",
    "detail_chalk": "18_detail_chalk_gallery",
    **PERSONA_ENV_ALIASES,
}

ALL_ENV_CHOICES: Tuple[str, ...] = tuple(ENVIRONMENTS.keys()) + tuple(ENV_ALIASES.keys())

FRAME_STYLES: Dict[str, str] = {
    "single_13x18": (
        "True Variant C 130x180mm ultra-thin matte-black frame (4.0mm bezel, 7.5mm low-profile "
        "height, matte-black archival backing, no nameplate by default; stacks 2 tiles seamlessly)."
    ),
    "a4_passepartout": (
        "Heavy A4 210x297x30mm matte-black gallery frame (15.0mm rim, 7.0mm inner recess, "
        "classic white 2.0mm 45-deg beveled cotton-rag passe-partout with 120x170mm opening "
        "for flush 2x 120x85mm tiles, matte-black archival paper backing, no glass)."
    ),
    "none": "Frameless raw architectural city relief on a thin flush matte-black backing slab (zero frame rails).",
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
    "detail_spire": "90mm f/2.0 architectural detail shot of hero spire rising into luminous #FFFFFF sunlit horizon.",
    "detail_canyon": "95mm f/1.9 diagonal street-canyon macro slashed by razor-sharp hard sunlight shadows.",
    "detail_oblique_grid": "105mm f/2.4 full-bleed 44-deg oblique architectural grid packed edge-to-edge with crisp shadows.",
    "detail_edge_horizon": "85mm f/2.0 frameless diagonal matte-black slab edge slicing cleanly over pure #FFFFFF.",
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
    "drafting_vellum_rolls": {"category": "architect", "approx_mm": [240, 320, 45], "description": "Rolled architectural vellum tubes over clean CAD grid sheet"},
    "concrete_pencil_cup": {"category": "architect", "approx_mm": [78, 78, 156], "description": "Honed-concrete pencil cup holding angled drafting pens"},
    "basswood_maquette": {"category": "architect", "approx_mm": [160, 125, 116], "description": "Minimalist Swiss basswood pavilion block massing study"},
    "vintage_camera": {"category": "traveler", "approx_mm": [148, 89, 77], "description": "Real Poly Haven CC0 vintage Leica rangefinder film camera"},
    "vintage_compass": {"category": "traveler", "approx_mm": [55, 68, 56], "description": "Real Poly Haven CC0 antique brass pocket compass"},
    "travel_monograph_stack": {"category": "traveler", "approx_mm": [188, 236, 66], "description": "Stacked blind-debossed linen and leather travel monographs (zero text)"},
    "brass_tabletop_globe": {"category": "traveler", "approx_mm": [176, 176, 235], "description": "Brushed-brass meridian tabletop globe with antique cartography"},
    "law_volumes_row": {"category": "lawyer", "approx_mm": [195, 172, 244], "description": "Standing dark leather-bound law volumes with subtle gold bands"},
    "leather_desk_folio": {"category": "lawyer", "approx_mm": [175, 238, 24], "description": "Stitched espresso-leather desk folio with brass corner trim"},
    "gold_fountain_pen": {"category": "lawyer", "approx_mm": [144, 12, 12], "description": "Jet-black lacquer and 18k gold executive fountain pen"},
    "matte_black_mug": {"category": "corporate", "approx_mm": [82, 106, 91], "description": "Unbranded matte jet-black ceramic coffee mug (zero logo)"},
    "concrete_planter_plant": {"category": "corporate", "approx_mm": [145, 145, 275], "description": "Honed concrete cube planter with real CC0 green foliage"},
    "fluted_crystal_vase_greenery": {"category": "realestate", "approx_mm": [145, 145, 265], "description": "Fluted clear crystal glass vase with water and real CC0 foliage"},
    "material_sample_board": {"category": "realestate", "approx_mm": [175, 228, 17], "description": "Architectural stone, timber, and brass finish sample board"},
    "brass_dome_lamp": {"category": "study", "approx_mm": [210, 210, 290], "description": "Spun brushed-brass mid-century dome table lamp with warm pool light"},
    "brass_arch_print_frame": {"category": "study", "approx_mm": [145, 72, 172], "description": "Brushed-brass tabletop frame with real CC0 monochrome architectural print"},
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
