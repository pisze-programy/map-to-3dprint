"""Declarative EnvironmentSpec for 18_detail_chalk_gallery (frameless chalk architectural macro)."""

from __future__ import annotations

from typing import Any, Dict

DETAIL_ENV_ALIASES: Dict[str, str] = {
    "detail_chalk": "18_detail_chalk_gallery",
}

DETAIL_ENV_DESCRIPTION: str = (
    "Frameless sunlit chalk-plaster architectural detail gallery with pure #FFFFFF horizon, "
    "razor-sharp low-angle 0.55 deg architectural sunlight, crisp diagonal canyon shadows, "
    "and tactile 0.1 mm matte chalk materiality."
)


def build_detail_env_specs(env_spec_cls: Any) -> Dict[str, Any]:
    """Instantiate the immutable EnvironmentSpec record for 18_detail_chalk_gallery."""
    return {
        "18_detail_chalk_gallery": env_spec_cls(
            env_id="18_detail_chalk_gallery",
            label="Detail Chalk Gallery",
            mount="desk_flat",
            architecture_style="detail_chalk_gallery",
            surface="packshot_white",
            wall_material="packshot_white",
            window_gobo="none",
            hdri_id="",
            hdri_strength=0.20,
            hdri_rot_deg=0.0,
            key_azimuth_deg=96.0,
            key_elevation_deg=25.0,
            key_energy=9.6,
            key_color=(1.0, 0.988, 0.968),
            key_spread_deg=0.50,
            key_size=(0.0, 0.0),
            fill_energy=0.0,
            fill_color=(0.86, 0.91, 1.0),
            rim_energy=0.0,
            rim_color=(1.0, 1.0, 1.0),
            default_still_preset="detail_spire",
            default_props=(),
            description=DETAIL_ENV_DESCRIPTION,
        ),
    }


__all__ = [
    "DETAIL_ENV_ALIASES",
    "DETAIL_ENV_DESCRIPTION",
    "build_detail_env_specs",
]
