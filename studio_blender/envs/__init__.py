"""Modular 11-environment architectural studio package for studio_blender."""

from __future__ import annotations

from .builder import build_environment
from .frame import build_frame_assembly
from .frame_gallery import build_gallery_frame, resolve_gallery_frame_dims_m
from .lighting import update_key_light_azimuth
from .spec import (
    ENV_ALIASES,
    ENV_SPECS,
    ENVIRONMENTS,
    FRAME_STYLES,
    EnvironmentSpec,
    get_env_spec,
    get_environment_spec,
    resolve_env_name,
)

__all__ = [
    "ENVIRONMENTS",
    "ENV_ALIASES",
    "ENV_SPECS",
    "FRAME_STYLES",
    "EnvironmentSpec",
    "build_environment",
    "build_frame_assembly",
    "build_gallery_frame",
    "get_env_spec",
    "get_environment_spec",
    "resolve_env_name",
    "resolve_gallery_frame_dims_m",
    "update_key_light_azimuth",
]
