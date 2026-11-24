"""JSON Schema definitions for the studio-blender MCP server's 5 tools."""

from __future__ import annotations

from typing import Any, Dict, List

from studio_blender.studio_presets import ALL_ENV_CHOICES, STILL_PRESETS


ENV_ENUM = list(ALL_ENV_CHOICES)
FRAME_ENUM = [
    "single_13x18", "a4_passepartout", "single_thin", "single_thick", "cube_cover",
    "cube_plinth", "triptych_3x1", "quartet_2x2",
]
MOUNT_ENUM = ["auto", "desk_flat", "wall_mount"]
BACKING_ENUM = ["matte_black", "satin_black"]
PRESET_ENUM = list(STILL_PRESETS.keys()) + ["all"]
ASPECT_ENUM = ["9:16", "4:5", "1:1", "16:9"]


def _common_scene_properties() -> Dict[str, Any]:
    """Shared composable product, environment, lighting, and prop override fields."""
    return {
        "stl_paths": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 4,
            "description": "1-2 STLs for Variant C 13x18 (2 tiles stack seamlessly), 3 for triptych_3x1, 4 for quartet_2x2.",
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
            "default": "single_13x18",
            "description": "Frame assembly style (default Variant C 13x18cm matte-black).",
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
                "Render photorealistic Cycles (Metal GPU + AgX + real DoF) still photos for any "
                "city STL (1-2 tiles for 13x18 Variant C, 3x1 triptych, or 2x2 quartet) in desk_flat or wall_mount."
            ),
            "inputSchema": {
                "type": "object",
                "properties": still_props,
                "required": ["stl_paths", "out_dir"],
                "additionalProperties": False,
            },
        },
        {
            "name": "render_flow_keyframes",
            "description": (
                "Render 9:16 photorealistic Cycles Start->End keyframe pairs, storyboard sheet, "
                "and tailored Google Flow (Frames to Video / Veo) prompts."
            ),
            "inputSchema": {
                "type": "object",
                "properties": kf_props,
                "required": ["stl_paths", "out_dir"],
                "additionalProperties": False,
            },
        },
        {
            "name": "render_commercial_video",
            "description": (
                "Render a smooth 24fps Cycles Metal GPU commercial MP4 video with speed-ramp "
                "transitions, raking light sweeps, real DoF bokeh, and Cycles motion blur."
            ),
            "inputSchema": {
                "type": "object",
                "properties": vid_props,
                "required": ["stl_paths", "out_dir"],
                "additionalProperties": False,
            },
        },
    ]


TOOLS_SCHEMA: List[Dict[str, Any]] = build_tools_schema()
