"""Clean facade re-exporting all 11 environments, frame builder, lighting, and prop catalog."""

from __future__ import annotations

from .envs import (
    ENV_ALIASES,
    ENV_SPECS,
    ENVIRONMENTS,
    FRAME_STYLES,
    EnvironmentSpec,
    build_environment,
    build_frame_assembly,
    get_env_spec,
    get_environment_spec,
    resolve_env_name,
    update_key_light_azimuth,
)
from .materials_studio import AVAILABLE_SURFACES
from .props import (
    PROP_CATALOG,
    PropPlacement,
    list_available_props,
    parse_prop_spec,
)

__all__ = [
    "AVAILABLE_SURFACES",
    "ENVIRONMENTS",
    "ENV_ALIASES",
    "ENV_SPECS",
    "FRAME_STYLES",
    "PROP_CATALOG",
    "EnvironmentSpec",
    "PropPlacement",
    "build_environment",
    "build_frame_assembly",
    "get_env_spec",
    "get_environment_spec",
    "list_available_props",
    "parse_prop_spec",
    "resolve_env_name",
    "update_key_light_azimuth",
]
