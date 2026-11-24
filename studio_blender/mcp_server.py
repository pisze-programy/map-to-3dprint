#!/usr/bin/env python3
"""Zero-dependency stdio MCP server for the Photorealistic 3D City Blender Studio.

Implements MCP JSON-RPC 2.0 over stdin/stdout (supports both newline-delimited JSON
and Content-Length framed transport) exposing 5 tools:
  1. list_studio_presets
  2. list_studio_props
  3. render_city_stills
  4. render_flow_keyframes
  5. render_commercial_video
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from studio_blender import render_studio
from studio_blender.mcp_schemas import TOOLS_SCHEMA


SERVER_INFO = {"name": "studio-blender", "version": "2.0.0"}
DEFAULT_PROTOCOL_VERSION = "2024-11-05"


def _normalize_stl_paths(args: Dict[str, Any]) -> List[str]:
    paths = args.get("stl_paths")
    if isinstance(paths, str):
        return [paths]
    if isinstance(paths, list) and all(isinstance(p, str) for p in paths) and paths:
        return paths
    raise ValueError("Missing or invalid 'stl_paths' (expected non-empty list of STL file paths).")


def _common_render_kwargs(arguments: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "stl_paths": _normalize_stl_paths(arguments),
        "out_dir": str(arguments["out_dir"]),
        "env": arguments.get("env", "01_architect_window_desk"),
        "frame": arguments.get("frame", "single_13x18"),
        "mount": arguments.get("mount", "auto"),
        "frame_mm": arguments.get("frame_mm"),
        "frame_width_mm": float(arguments.get("frame_width_mm", 4.0)),
        "frame_height_mm": float(arguments.get("frame_height_mm", 7.5)),
        "backing_finish": arguments.get("backing_finish", "matte_black"),
        "show_nameplate": bool(arguments.get("show_nameplate", False)),
        "title": arguments.get("title"),
        "surface": arguments.get("surface"),
        "window_gobo": arguments.get("window_gobo"),
        "hdri": arguments.get("hdri"),
        "light_temp": arguments.get("light_temp"),
        "sun_azimuth": arguments.get("sun_azimuth"),
        "add_props": arguments.get("add_props"),
        "remove_props": arguments.get("remove_props"),
        "clear_props": bool(arguments.get("clear_props", False)),
    }


def _handle_tool_call(name: str, arguments: Dict[str, Any]) -> Tuple[Any, bool]:
    """Execute one MCP tool and return (payload_dict, is_error)."""
    try:
        if name == "list_studio_presets":
            return (render_studio.get_studio_presets(), False)
        if name == "list_studio_props":
            return (render_studio.get_studio_props(), False)

        if name == "render_city_stills":
            kw = _common_render_kwargs(arguments)
            result = render_studio.run_studio_render(
                **kw,
                mode="stills",
                presets=arguments.get("presets"),
                aspect=arguments.get("aspect", "4:5"),
                resolution=arguments.get("resolution"),
                samples=arguments.get("samples", 96),
                filename=arguments.get("filename"),
            )
            return (result, False)

        if name == "render_flow_keyframes":
            kw = _common_render_kwargs(arguments)
            result = render_studio.run_studio_render(
                **kw,
                mode="keyframes",
                aspect=arguments.get("aspect", "9:16"),
                resolution=arguments.get("resolution"),
                samples=arguments.get("samples", 96),
                shots=arguments.get("shots", "1,2,3,4"),
            )
            return (result, False)

        if name == "render_commercial_video":
            kw = _common_render_kwargs(arguments)
            result = render_studio.run_studio_render(
                **kw,
                mode="video",
                aspect=arguments.get("aspect", "9:16"),
                resolution=arguments.get("resolution"),
                samples=arguments.get("samples", 32),
                fps=arguments.get("fps", 24),
                video_name=arguments.get("video_name"),
                shots=arguments.get("shots", "1,2,3,4"),
            )
            return (result, False)

        return ({"error": f"Unknown tool: {name}"}, True)
    except Exception as exc:
        return ({"error": str(exc)}, True)


def _read_message() -> Tuple[Optional[Dict[str, Any]], str]:
    """Read one JSON-RPC message from stdin, auto-detecting NDJSON vs Content-Length."""
    stdin = sys.stdin.buffer
    while True:
        raw_line = stdin.readline()
        if not raw_line:
            return (None, "ndjson")
        stripped = raw_line.strip()
        if not stripped:
            continue

        if stripped.lower().startswith(b"content-length:"):
            content_length = int(stripped.split(b":", 1)[1].strip())
            while True:
                hdr = stdin.readline()
                if not hdr or hdr.strip() == b"":
                    break
            body = stdin.read(content_length)
            return (json.loads(body.decode("utf-8")), "framed") if body else (None, "framed")

        return (json.loads(stripped.decode("utf-8")), "ndjson")


def _write_message(msg: Dict[str, Any], framing: str) -> None:
    payload = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    stdout = sys.stdout.buffer
    if framing == "framed":
        stdout.write(f"Content-Length: {len(payload)}\r\n\r\n".encode("ascii") + payload)
    else:
        stdout.write(payload + b"\n")
    stdout.flush()


def _process_request(req: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    method = req.get("method")
    req_id = req.get("id")
    params = req.get("params") or {}

    if req_id is None:
        return None

    if method == "initialize":
        proto = params.get("protocolVersion") or DEFAULT_PROTOCOL_VERSION
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": proto,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
            },
        }

    if method == "ping":
        return {"jsonrpc": "2.0", "id": req_id, "result": {}}

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS_SCHEMA}}

    if method == "tools/call":
        tool_name = params.get("name")
        tool_args = params.get("arguments") or {}
        if not isinstance(tool_name, str) or not isinstance(tool_args, dict):
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32602, "message": "Invalid tools/call parameters."},
            }
        payload, is_error = _handle_tool_call(tool_name, tool_args)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(payload, indent=2, ensure_ascii=False)}],
                "isError": is_error,
            },
        }

    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


def main() -> int:
    while True:
        try:
            msg, framing = _read_message()
        except json.JSONDecodeError as exc:
            _write_message(
                {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": f"Parse error: {exc}"}},
                "ndjson",
            )
            continue
        except KeyboardInterrupt:
            break

        if msg is None:
            break

        try:
            resp = _process_request(msg)
            if resp is not None:
                _write_message(resp, framing)
        except Exception as exc:
            if msg.get("id") is not None:
                _write_message(
                    {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32603, "message": f"Internal error: {exc}"}},
                    framing,
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
