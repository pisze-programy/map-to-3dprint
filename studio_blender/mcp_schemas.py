"""JSON Schema definitions for the studio-blender MCP server's 5 tools."""

from __future__ import annotations

from typing import Any, Dict, List

from studio_blender.camera_qa import QA_PRESETS
from studio_blender.studio_presets import ALL_ENV_CHOICES, ALL_FRAME_CHOICES, STILL_PRESETS


ENV_ENUM = list(ALL_ENV_CHOICES)
FRAME_ENUM = list(ALL_FRAME_CHOICES)
MOUNT_ENUM = ["auto", "desk_flat", "wall_mount"]
BACKING_ENUM = ["matte_black", "satin_black"]
PRESET_ENUM = list(dict.fromkeys(list(STILL_PRESETS.keys()) + list(QA_PRESETS) + ["all"]))
ASPECT_ENUM = ["9:16", "4:5", "1:1", "16:9"]


def _common_scene_properties() -> Dict[str, Any]:
    """Shared composable product, environment, lighting, and prop override fields."""
    return {
        "manifest_path": {
            "type": "string",
            "description": "Path to validated assembly_manifest.json (required for production renders).",
        },
        "draft_unvalidated": {
            "type": "boolean",
            "default": False,
            "description": "Explicitly allow unvalidated/raw-STL draft renders with DRAFT_UNVALIDATED_ filename prefix.",
        },
        "stl_paths": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 4,
            "description": "Raw STL paths (only permitted when draft_unvalidated=true; production renders require manifest_path).",
        },
        "out_dir": {
            "type": "string",
            "description": "Output directory for rendered PNG/MP4 files and render_manifest.json.",
        },
        "env": {
            "type": "string",
            "enum": ENV_ENUM,
            "default": "01_architect_window_desk",
            "description": "Any cohesive studio or customer persona environment (or alias).",
        },
        "frame": {
            "type": "string",
            "enum": FRAME_ENUM,
            "default": "auto",
            "description": "Frame assembly style ('auto' resolves from manifest.format_id; defaults to single_13x18 for raw STLs).",
        },
        "mount": {
            "type": "string",
            "enum": MOUNT_ENUM,
            "default": "auto",
            "description": "Mount orientation: auto (from env), desk_flat, or flush wall_mount.",
        },
        "frame_mm": {"type": "string", "description": "Optional inner frame opening override (e.g. '122x172')."},
        "frame_width_mm": {
            "type": "number", "minimum": 2.0, "maximum": 25.0, "default": 4.0,
            "description": "Ultra-thin matte-black bezel width in mm (default 4.0).",
        },
        "frame_height_mm": {
            "type": "number", "minimum": 4.0, "maximum": 30.0, "default": 7.5,
            "description": "Low-profile frame height in mm (default 7.5).",
        },
        "backing_finish": {
            "type": "string", "enum": BACKING_ENUM, "default": "matte_black",
            "description": "Water-cutout backing finish (matte_black or satin_black; zero vanity mirror).",
        },
        "show_nameplate": {
            "type": "boolean", "default": False,
            "description": "Opt-in front nameplate (False by default for true Variant C faithfulness).",
        },
        "title": {"type": "string", "description": "Optional city title for metadata / Flow prompts."},
        "surface": {"type": "string", "description": "Override tabletop/wall surface texture preset."},
        "window_gobo": {"type": "string", "description": "Override window mullion / blinds light gobo."},
        "hdri": {"type": "string", "description": "Override Poly Haven HDRI preset ID or local .hdr path."},
        "light_temp": {"type": "number", "minimum": 2200, "maximum": 8000, "description": "Key light temperature (K)."},
        "sun_azimuth": {"type": "number", "minimum": -180, "maximum": 180, "description": "Key light azimuth (deg)."},
        "add_props": {
            "type": "array", "items": {"type": "string"},
            "description": "Add built-in prop IDs or custom '/path/item.glb@x_mm,y_mm,yaw_deg,scale'.",
        },
        "remove_props": {
            "type": "array", "items": {"type": "string"},
            "description": "Default environment prop IDs to omit.",
        },
        "clear_props": {
            "type": "boolean", "default": False,
            "description": "Clear all default environment props before applying add_props.",
        },
    }


def build_tools_schema() -> List[Dict[str, Any]]:
    """Build complete MCP tools/list schema for all 5 studio-blender tools."""
    still_props = _common_scene_properties()
    still_props.update(
        {
            "presets": {"type": "array", "items": {"type": "string", "enum": PRESET_ENUM}},
            "aspect": {"type": "string", "enum": ASPECT_ENUM, "default": "4:5"},
            "resolution": {"type": "string"},
            "samples": {"type": "integer", "minimum": 8, "maximum": 1024, "default": 96},
            "filename": {"type": "string"},
            "fstop": {
                "type": "number",
                "minimum": 0.7,
                "maximum": 128.0,
                "description": "Optional camera aperture f-stop override (e.g. 56.0 for minimal blur or 2.8 for shallow DoF).",
            },
            "focus_xy": {
                "type": "string",
                "description": "Optional focus target XY in millimeters as 'x_mm,y_mm' (forwarded to detail presets).",
            },
        }
    )

    kf_props = _common_scene_properties()
    kf_props.update(
        {
            "aspect": {"type": "string", "enum": ASPECT_ENUM, "default": "9:16"},
            "resolution": {"type": "string"},
            "samples": {"type": "integer", "minimum": 8, "maximum": 1024, "default": 96},
            "shots": {"type": "string", "default": "1,2,3,4"},
        }
    )

    vid_props = _common_scene_properties()
    vid_props.update(
        {
            "camera_mode": {
                "type": "string",
                "enum": ["kinder_multishot", "kinder_continuous", "shots"],
                "default": "kinder_multishot",
                "description": (
                    "kinder_multishot (default 5-angle Kinder whip-match-cut), "
                    "kinder_continuous (single-take C2 spline), or legacy 4-shot cuts."
                ),
            },
            "packshot_end": {
                "type": "boolean",
                "default": True,
                "description": "End video with a spatially-locked dissolve into 11_packshot_white.",
            },
            "duration_sec": {
                "type": "number",
                "minimum": 4.0,
                "maximum": 30.0,
                "default": 10.5,
                "description": "Total duration in seconds (default 10.5).",
            },
            "shutter": {
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0,
                "default": 0.68,
                "description": "Cycles optical motion blur shutter fraction (default 0.68).",
            },
            "aspect": {"type": "string", "enum": ASPECT_ENUM, "default": "9:16"},
            "resolution": {"type": "string"},
            "samples": {"type": "integer", "minimum": 8, "maximum": 256, "default": 56},
            "fps": {"type": "integer", "minimum": 12, "maximum": 60, "default": 24},
            "video_name": {"type": "string"},
            "shots": {"type": "string", "default": "1,2,3,4"},
        }
    )

    return [
        {
            "name": "list_studio_presets",
            "description": (
                "List all cohesive Cycles studio and customer persona environments (desk_flat & wall_mount), "
                "frame styles (single_13x18, single_thin, triptych_3x1, quartet_2x2), still presets, and video shots."
            ),
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "name": "list_studio_props",
            "description": (
                "List all verified composable scale props (CC0 photogrammetry + CAD hard-surface) "
                "and custom external 3D asset placement syntax."
            ),
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "name": "render_city_stills",
            "description": (
                "Render photorealistic Cycles (Metal GPU + AgX + real DoF) still photos from a validated "
                "assembly_manifest.json (or raw stl_paths only with draft_unvalidated=true)."
            ),
            "inputSchema": {
                "type": "object",
                "properties": still_props,
                "required": ["out_dir"],
                "additionalProperties": False,
            },
        },
        {
            "name": "render_flow_keyframes",
            "description": (
                "Render 9:16 photorealistic Cycles Start->End keyframe pairs, storyboard sheet, "
                "and tailored Google Flow prompts from a validated assembly_manifest.json."
            ),
            "inputSchema": {
                "type": "object",
                "properties": kf_props,
                "required": ["out_dir"],
                "additionalProperties": False,
            },
        },
        {
            "name": "render_commercial_video",
            "description": (
                "Render a smooth 24fps Cycles Metal GPU commercial MP4 video from a validated "
                "assembly_manifest.json with speed-ramp transitions, raking light sweeps, and real DoF bokeh."
            ),
            "inputSchema": {
                "type": "object",
                "properties": vid_props,
                "required": ["out_dir"],
                "additionalProperties": False,
            },
        },
    ]


TOOLS_SCHEMA: List[Dict[str, Any]] = build_tools_schema()
