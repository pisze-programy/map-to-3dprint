"""Composable scale-prop subsystem for studio_blender."""

from __future__ import annotations

from .registry import (
    PROP_CATALOG,
    PropPlacement,
    list_available_props,
    parse_prop_spec,
    place_props,
    resolve_prop_placements,
)

__all__ = [
    "PROP_CATALOG",
    "PropPlacement",
    "list_available_props",
    "parse_prop_spec",
    "place_props",
    "resolve_prop_placements",
]
