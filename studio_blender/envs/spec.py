"""Declarative specification for all 11 cohesive studio_blender environments."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple

from ..props.registry import PropPlacement
from .spec_personas import PERSONA_ENV_ALIASES, build_persona_env_specs

try:
    from .spec_detail import DETAIL_ENV_ALIASES, build_detail_env_specs
except ImportError:  # pragma: no cover
    DETAIL_ENV_ALIASES = {}
    build_detail_env_specs = None  # type: ignore

Rgb = Tuple[float, float, float]


@dataclass(frozen=True)
class EnvironmentSpec:
    """Complete architectural, lighting, surface, and prop specification for one scene."""

    env_id: str
    label: str
    mount: str  # "desk_flat" | "wall_mount"
    architecture_style: str
    surface: str
    wall_material: str
    window_gobo: str  # "none" | "mullions" | "blinds" | "dappled"
    hdri_id: str
    hdri_strength: float
    hdri_rot_deg: float
    key_azimuth_deg: float
    key_elevation_deg: float
    key_energy: float
    key_color: Rgb
    key_spread_deg: float
    key_size: Tuple[float, float]
    fill_energy: float
    fill_color: Rgb
    rim_energy: float
    rim_color: Rgb
    default_still_preset: str
    default_props: Tuple[PropPlacement, ...]
    description: str


FRAME_STYLES: Tuple[str, ...] = (
    "single_13x18",
    "a4_passepartout",
    "none",
    "single_thin",
    "single_thick",
    "cube_plinth",
    "cube_cover",
    "triptych_3x1",
    "quartet_2x2",
)

ENV_SPECS: Dict[str, EnvironmentSpec] = {
    "01_architect_window_desk": EnvironmentSpec(
        env_id="01_architect_window_desk",
        label="Architect Window Desk",
        mount="desk_flat",
        architecture_style="window_studio",
        surface="pale_ash_oak",
        wall_material="warm_ivory_plaster",
        window_gobo="dappled",
        hdri_id="photo_studio_loft_hall",
        hdri_strength=0.24,
        hdri_rot_deg=35.0,
        key_azimuth_deg=52.0,
        key_elevation_deg=32.0,
        key_energy=13.5,
        key_color=(1.0, 0.96, 0.89),
        key_spread_deg=58.0,
        key_size=(0.52, 0.74),
        fill_energy=2.6,
        fill_color=(0.89, 0.94, 1.0),
        rim_energy=2.4,
        rim_color=(1.0, 0.99, 0.97),
        default_still_preset="hero_desk",
        default_props=(
            PropPlacement("potted_plant", x_mm=-78.0, y_mm=98.0, yaw_deg=18.0, anchor="back_left"),
            PropPlacement("glass_tumbler", x_mm=68.0, y_mm=56.0, yaw_deg=0.0, anchor="back_right"),
            PropPlacement("architect_pen", x_mm=44.0, y_mm=-18.0, yaw_deg=82.0, anchor="right"),
        ),
        description="Sunlit pale Scandinavian ash-oak studio desk with black-mullioned daylight window, dappled botanical sun, greenery, water tumbler, and drafting pen",
    ),
    "02_creative_office_desk": EnvironmentSpec(
        env_id="02_creative_office_desk",
        label="Creative Office Desk",
        mount="desk_flat",
        architecture_style="office_wall",
        surface="oiled_walnut",
        wall_material="warm_ivory_plaster",
        window_gobo="blinds",
        hdri_id="blinds",
        hdri_strength=0.22,
        hdri_rot_deg=20.0,
        key_azimuth_deg=56.0,
        key_elevation_deg=29.0,
        key_energy=13.0,
        key_color=(1.0, 0.94, 0.84),
        key_spread_deg=54.0,
        key_size=(0.48, 0.64),
        fill_energy=2.8,
        fill_color=(0.88, 0.93, 1.0),
        rim_energy=2.2,
        rim_color=(1.0, 0.95, 0.88),
        default_still_preset="hero_desk",
        default_props=(
            PropPlacement("desk_mat_laptop", x_mm=-206.0, y_mm=132.0, yaw_deg=0.0, anchor="back_left"),
            PropPlacement("espresso_cup", x_mm=82.0, y_mm=52.0, yaw_deg=-35.0, anchor="back_right"),
            PropPlacement("potted_plant", x_mm=155.0, y_mm=142.0, yaw_deg=-24.0, scale=0.86, anchor="back_right"),
        ),
        description="Oiled American walnut creative-director desk in golden afternoon sunlight with straight wool-felt laptop pad, porcelain espresso cup, and greenery",
    ),
    "03_morning_coffee_table": EnvironmentSpec(
        env_id="03_morning_coffee_table",
        label="Morning Coffee Table",
        mount="desk_flat",
        architecture_style="living_room",
        surface="honed_sandstone",
        wall_material="warm_ivory_plaster",
        window_gobo="dappled",
        hdri_id="brown_photostudio_03",
        hdri_strength=0.24,
        hdri_rot_deg=45.0,
        key_azimuth_deg=58.0,
        key_elevation_deg=28.0,
        key_energy=13.2,
        key_color=(1.0, 0.93, 0.82),
        key_spread_deg=60.0,
        key_size=(0.58, 0.76),
        fill_energy=2.6,
        fill_color=(0.90, 0.94, 1.0),
        rim_energy=2.2,
        rim_color=(1.0, 0.96, 0.90),
        default_still_preset="hero_desk",
        default_props=(
            PropPlacement("monograph_stack", x_mm=-132.0, y_mm=34.0, yaw_deg=5.0, anchor="back_left"),
            PropPlacement("espresso_cup", x_mm=76.0, y_mm=32.0, yaw_deg=-42.0, anchor="back_right"),
        ),
        description="Seamless honed Italian sandstone coffee table in a sunlit Milanese living room with sofa bokeh, stacked linen monographs, and espresso",
    ),
    "04_minimal_home_console": EnvironmentSpec(
        env_id="04_minimal_home_console",
        label="Minimal Home Console",
        mount="desk_flat",
        architecture_style="boiserie_console",
        surface="brushed_oak",
        wall_material="warm_ivory_plaster",
        window_gobo="mullions",
        hdri_id="photo_studio_loft_hall",
        hdri_strength=0.22,
        hdri_rot_deg=15.0,
        key_azimuth_deg=52.0,
        key_elevation_deg=32.0,
        key_energy=12.8,
        key_color=(1.0, 0.95, 0.87),
        key_spread_deg=62.0,
        key_size=(0.64, 0.80),
        fill_energy=2.5,
        fill_color=(0.90, 0.95, 1.0),
        rim_energy=2.4,
        rim_color=(0.99, 0.99, 1.0),
        default_still_preset="hero_desk",
        default_props=(
            PropPlacement("ceramic_vessel", x_mm=-42.0, y_mm=78.0, yaw_deg=18.0, anchor="back_left"),
            PropPlacement("ceramic_vessel_low", x_mm=-112.0, y_mm=54.0, yaw_deg=-26.0, anchor="back_left"),
            PropPlacement("potted_plant", x_mm=104.0, y_mm=112.0, yaw_deg=-22.0, scale=0.80, anchor="back_right"),
        ),
        description="Brushed honey-oak entryway console against sunlit Milanese boiserie plaster wall with paired stoneware vessels and tabletop botanical plant",
    ),
    "05_gallery_wall_sunlight": EnvironmentSpec(
        env_id="05_gallery_wall_sunlight",
        label="Gallery Wall Sunlight",
        mount="wall_mount",
        architecture_style="gallery_wall",
        surface="brushed_oak",
        wall_material="warm_ivory_plaster",
        window_gobo="mullions",
        hdri_id="photo_studio_loft_hall",
        hdri_strength=0.18,
        hdri_rot_deg=60.0,
        key_azimuth_deg=60.0,
        key_elevation_deg=26.0,
        key_energy=10.8,
        key_color=(1.0, 0.93, 0.82),
        key_spread_deg=48.0,
        key_size=(0.48, 0.72),
        fill_energy=2.2,
        fill_color=(0.90, 0.94, 1.0),
        rim_energy=0.0,
        rim_color=(1.0, 1.0, 1.0),
        default_still_preset="hero_wall",
        default_props=(),
        description="Flush wall-mount on smooth warm ivory Venetian plaster with Milanese boiserie molding, golden sunbeams, and styled natural oak credenza below",
    ),
    "06_architect_slat_wall": EnvironmentSpec(
        env_id="06_architect_slat_wall",
        label="Architect Acoustic Slat Wall",
        mount="wall_mount",
        architecture_style="slat_wall",
        surface="brushed_oak",
        wall_material="warm_greige_stone",
        window_gobo="none",
        hdri_id="photo_studio_loft_hall",
        hdri_strength=0.17,
        hdri_rot_deg=15.0,
        key_azimuth_deg=50.0,
        key_elevation_deg=38.0,
        key_energy=10.2,
        key_color=(1.0, 0.93, 0.83),
        key_spread_deg=44.0,
        key_size=(0.38, 0.46),
        fill_energy=2.0,
        fill_color=(0.88, 0.93, 1.0),
        rim_energy=0.0,
        rim_color=(1.0, 1.0, 1.0),
        default_still_preset="hero_wall",
        default_props=(),
        description="Flush wall-mount on smooth warm greige plaster framed by brushed honey-oak acoustic slats and matching styled oak credenza below",
    ),
    "07_evening_warm_desk": EnvironmentSpec(
        env_id="07_evening_warm_desk",
        label="Evening Warm Desk",
        mount="desk_flat",
        architecture_style="evening_window",
        surface="oiled_walnut",
        wall_material="charcoal_plaster",
        window_gobo="none",
        hdri_id="small_empty_room_2",
        hdri_strength=0.06,
        hdri_rot_deg=110.0,
        key_azimuth_deg=-48.0,
        key_elevation_deg=34.0,
        key_energy=11.0,
        key_color=(1.0, 0.80, 0.56),
        key_spread_deg=44.0,
        key_size=(0.28, 0.28),
        fill_energy=1.5,
        fill_color=(0.56, 0.72, 1.0),
        rim_energy=2.4,
        rim_color=(0.54, 0.72, 1.0),
        default_still_preset="hero_desk",
        default_props=(
            PropPlacement("desk_lamp_edge", x_mm=-64.0, y_mm=156.0, yaw_deg=-22.0, anchor="back_left"),
            PropPlacement("leather_notebook", x_mm=-118.0, y_mm=-10.0, yaw_deg=5.0, anchor="left"),
            PropPlacement("architect_pen", x_mm=44.0, y_mm=-18.0, yaw_deg=76.0, anchor="right"),
            PropPlacement("crystal_glass", x_mm=78.0, y_mm=52.0, yaw_deg=0.0, anchor="back_right"),
        ),
        description="Opulent oiled American walnut penthouse study desk at twilight with warm brass desk lamp, glowing Manhattan city-light bokeh, stitched leather notebook, and cut-crystal glass",
    ),
    "08_loft_concrete_studio": EnvironmentSpec(
        env_id="08_loft_concrete_studio",
        label="Loft Studio Workbench",
        mount="desk_flat",
        architecture_style="loft_wall",
        surface="pale_terrazzo",
        wall_material="warm_ivory_plaster",
        window_gobo="none",
        hdri_id="photo_studio_broadway_hall",
        hdri_strength=0.25,
        hdri_rot_deg=25.0,
        key_azimuth_deg=48.0,
        key_elevation_deg=38.0,
        key_energy=12.8,
        key_color=(1.0, 0.98, 0.94),
        key_spread_deg=64.0,
        key_size=(0.74, 0.74),
        fill_energy=2.8,
        fill_color=(1.0, 0.96, 0.90),
        rim_energy=2.2,
        rim_color=(0.95, 0.98, 1.0),
        default_still_preset="hero_desk",
        default_props=(
            PropPlacement("monograph_stack", x_mm=-134.0, y_mm=42.0, yaw_deg=7.0, anchor="back_left"),
            PropPlacement("coffee_mug", x_mm=84.0, y_mm=50.0, yaw_deg=-38.0, anchor="back_right"),
            PropPlacement("potted_plant", x_mm=162.0, y_mm=124.0, yaw_deg=-18.0, anchor="back_right"),
        ),
        description="Bright airy Scandinavian loft workbench in pale honed terrazzo under skylight with floating oak shelf bokeh, stacked monographs, stoneware mug, and greenery",
    ),
    "09_dark_cinematic": EnvironmentSpec(
        env_id="09_dark_cinematic",
        label="Dark Cinematic Basalt",
        mount="desk_flat",
        architecture_style="dark_stage",
        surface="basalt_plinth",
        wall_material="charcoal_plaster",
        window_gobo="none",
        hdri_id="studio_small_08",
        hdri_strength=0.025,
        hdri_rot_deg=0.0,
        key_azimuth_deg=54.0,
        key_elevation_deg=27.0,
        key_energy=7.6,
        key_color=(1.0, 0.89, 0.74),
        key_spread_deg=38.0,
        key_size=(0.26, 0.36),
        fill_energy=0.65,
        fill_color=(0.84, 0.90, 0.98),
        rim_energy=3.8,
        rim_color=(0.64, 0.80, 1.0),
        default_still_preset="hero_desk",
        default_props=(),
        description="Honed volcanic basalt plinth with golden raking key, cool architectural rim, and subtle atmospheric depth",
    ),
    "10_macro_editorial": EnvironmentSpec(
        env_id="10_macro_editorial",
        label="Macro 10K Editorial",
        mount="desk_flat",
        architecture_style="editorial_sweep",
        surface="editorial_sweep",
        wall_material="editorial_sweep",
        window_gobo="none",
        hdri_id="studio_small_09",
        hdri_strength=0.035,
        hdri_rot_deg=15.0,
        key_azimuth_deg=58.0,
        key_elevation_deg=29.0,
        key_energy=6.8,
        key_color=(1.0, 0.97, 0.93),
        key_spread_deg=40.0,
        key_size=(0.28, 0.40),
        fill_energy=1.1,
        fill_color=(0.94, 0.96, 1.0),
        rim_energy=1.8,
        rim_color=(0.96, 0.98, 1.0),
        default_still_preset="macro_skyline",
        default_props=(),
        description="Dedicated 90mm f/2.0 plaster-grain macro editorial stage with crisp raking light and creamy dark-neutral bokeh",
    ),
    "11_packshot_white": EnvironmentSpec(
        env_id="11_packshot_white",
        label="Packshot Pure White",
        mount="desk_flat",
        architecture_style="packshot_white",
        surface="packshot_white",
        wall_material="packshot_white",
        window_gobo="none",
        hdri_id="studio_small_09",
        hdri_strength=0.09,
        hdri_rot_deg=0.0,
        key_azimuth_deg=44.0,
        key_elevation_deg=46.0,
        key_energy=12.0,
        key_color=(1.0, 0.99, 0.98),
        key_spread_deg=70.0,
        key_size=(0.72, 0.72),
        fill_energy=3.8,
        fill_color=(0.96, 0.98, 1.0),
        rim_energy=2.4,
        rim_color=(1.0, 1.0, 1.0),
        default_still_preset="packshot_iso",
        default_props=(),
        description="Pure #FFFFFF e-commerce studio cyclorama with Cycles shadow-catcher showing pure Variant C 13x18 product truth",
    ),
}

ENV_SPECS.update(build_persona_env_specs(EnvironmentSpec))
if build_detail_env_specs is not None:
    ENV_SPECS.update(build_detail_env_specs(EnvironmentSpec))

ENVIRONMENTS: Tuple[str, ...] = tuple(ENV_SPECS.keys())

ENV_ALIASES: Dict[str, str] = {
    "desk_daylight": "01_architect_window_desk",
    "leather_workspace": "02_creative_office_desk",
    "dark_cinematic": "09_dark_cinematic",
    "macro_editorial": "10_macro_editorial",
    "packshot_white": "11_packshot_white",
    **PERSONA_ENV_ALIASES,
    **DETAIL_ENV_ALIASES,
}


def resolve_env_name(name: str) -> str:
    """Resolve an environment ID or backwards-compatible alias to its canonical ID."""
    key = (name or "01_architect_window_desk").strip().lower()
    resolved = ENV_ALIASES.get(key, key)
    if resolved not in ENV_SPECS:
        raise ValueError(f"Unknown environment '{name}'. Expected one of: {ENVIRONMENTS}")
    return resolved


def get_environment_spec(name: str) -> EnvironmentSpec:
    """Return the immutable EnvironmentSpec for a canonical environment name or alias."""
    return ENV_SPECS[resolve_env_name(name)]


get_env_spec = get_environment_spec
