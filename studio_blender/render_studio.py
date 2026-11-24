#!/usr/bin/env python3
"""Self-contained CLI runner for the Photorealistic 3D City Blender Studio.

Runs from regular system Python (`python3 studio_blender/render_studio.py ...`) by
automatically invoking headless Blender 4/5 (`blender_worker.py`) with Apple Metal GPU
Cycles rendering, then post-processing keyframes into a storyboard contact sheet or
stitching smooth 24fps H.264 commercial video via ffmpeg.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

_THIS_FILE = Path(__file__).resolve()
_REPO_ROOT = _THIS_FILE.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from studio_blender.studio_presets import (
    ALL_ENV_CHOICES,
    ENVIRONMENTS,
    ENV_ALIASES,
    FRAME_STYLES,
    STILL_PRESETS,
    VIDEO_SHOTS,
    get_studio_presets,
    get_studio_props,
    resolve_env_name,
)


STUDIO_DIR = _THIS_FILE.parent
WORKER_SCRIPT = STUDIO_DIR / "blender_worker.py"
DEFAULT_BLENDER_PATHS = (
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "/opt/homebrew/bin/blender",
    "/usr/local/bin/blender",
)


def find_blender_binary(override: Optional[str] = None) -> str:
    """Locate the Blender executable on macOS/Linux."""
    candidates: List[str] = []
    if override:
        candidates.append(override)
    env_bin = os.environ.get("BLENDER_BIN")
    if env_bin:
        candidates.append(env_bin)
    candidates.extend(DEFAULT_BLENDER_PATHS)
    which_bin = shutil.which("blender")
    if which_bin:
        candidates.append(which_bin)
    for cand in candidates:
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    raise FileNotFoundError(
        "Blender binary not found. Checked BLENDER_BIN, /Applications/Blender.app/Contents/MacOS/Blender, "
        "and PATH. Install Blender via `brew install --cask blender`."
    )


def find_ffmpeg_binary() -> Optional[str]:
    for cand in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", shutil.which("ffmpeg")):
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def _build_keyframes_storyboard(keyframes: Dict[str, Dict[str, str]], out_path: Path) -> Optional[str]:
    """Build a crisp 2-column (Start -> End) storyboard contact sheet via ffmpeg."""
    ffmpeg = find_ffmpeg_binary()
    if not ffmpeg or not keyframes:
        return None

    row_pairs: List[tuple[str, str]] = []
    for k in sorted(keyframes.keys(), key=lambda x: int(x)):
        s_img, e_img = keyframes[k].get("start"), keyframes[k].get("end")
        if s_img and e_img and os.path.isfile(s_img) and os.path.isfile(e_img):
            row_pairs.append((s_img, e_img))
    if not row_pairs:
        return None

    cmd: List[str] = [ffmpeg, "-y"]
    for s_img, e_img in row_pairs:
        cmd.extend(["-i", s_img, "-i", e_img])

    filter_parts: List[str] = []
    row_labels: List[str] = []
    for row_idx in range(len(row_pairs)):
        i0, i1 = row_idx * 2, row_idx * 2 + 1
        filter_parts.append(f"[{i0}:v]scale=540:-1[s{row_idx}]")
        filter_parts.append(f"[{i1}:v]scale=540:-1[e{row_idx}]")
        filter_parts.append(f"[s{row_idx}][e{row_idx}]hstack=inputs=2[r{row_idx}]")
        row_labels.append(f"[r{row_idx}]")

    if len(row_labels) == 1:
        filter_parts[-1] = filter_parts[-1].replace("[r0]", "[outv]")
    else:
        filter_parts.append(f"{''.join(row_labels)}vstack=inputs={len(row_labels)}[outv]")

    cmd.extend(["-filter_complex", ";".join(filter_parts), "-map", "[outv]", "-frames:v", "1", str(out_path)])
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return str(out_path) if (proc.returncode == 0 and out_path.is_file()) else None


def _stitch_video_mp4(video_shots: Sequence[Dict[str, Any]], fps: int, out_mp4: Path) -> str:
    """Stitch rendered PNG frame sequences across all shots into a silky-smooth H.264 MP4."""
    ffmpeg = find_ffmpeg_binary()
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found in PATH or /opt/homebrew/bin/ffmpeg; cannot stitch MP4.")

    all_frames: List[str] = []
    for shot in video_shots:
        all_frames.extend(shot.get("frames", []))
    if not all_frames:
        raise RuntimeError("No video frames found in render manifest to stitch.")

    frame_dur = 1.0 / float(max(1, fps))
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as tf:
        concat_list = Path(tf.name)
        for fp in all_frames:
            safe_fp = fp.replace("'", "'\\''")
            tf.write(f"file '{safe_fp}'\n")
            tf.write(f"duration {frame_dur:.8f}\n")
        last_fp = all_frames[-1].replace("'", "'\\''")
        tf.write(f"file '{last_fp}'\n")

    try:
        cmd = [
            ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-vf", f"fps={fps},format=yuv420p", "-c:v", "libx264", "-preset", "medium",
            "-crf", "17", "-movflags", "+faststart", str(out_mp4),
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed (rc={proc.returncode}):\n{proc.stderr[-1500:]}")
    finally:
        try:
            concat_list.unlink()
        except OSError:
            pass
    return str(out_mp4)


def run_studio_render(
    stl_paths: Sequence[str],
    out_dir: str,
    env: str = "01_architect_window_desk",
    frame: str = "single_13x18",
    mount: str = "auto",
    mode: str = "stills",
    presets: Optional[Sequence[str]] = None,
    aspect: Optional[str] = None,
    resolution: Optional[str] = None,
    samples: Optional[int] = None,
    fps: int = 24,
    frame_mm: Optional[str] = None,
    frame_width_mm: float = 4.0,
    frame_height_mm: float = 7.5,
    backing_finish: str = "matte_black",
    show_nameplate: bool = False,
    title: Optional[str] = None,
    surface: Optional[str] = None,
    window_gobo: Optional[str] = None,
    hdri: Optional[str] = None,
    light_temp: Optional[float] = None,
    sun_azimuth: Optional[float] = None,
    add_props: Optional[Sequence[str]] = None,
    remove_props: Optional[Sequence[str]] = None,
    clear_props: bool = False,
    filename: Optional[str] = None,
    video_name: Optional[str] = None,
    shots: str = "1,2,3,4",
    blender_bin: Optional[str] = None,
    keep_frames: bool = False,
    verbose: bool = False,
) -> Dict[str, Any]:
    """Programmatic entry point used by both CLI and MCP server."""
    if not stl_paths:
        raise ValueError("At least one STL path is required.")
    for p in stl_paths:
        if not os.path.isfile(p):
            raise FileNotFoundError(f"STL file not found: {p}")

    canonical_env = resolve_env_name(env)
    blender = find_blender_binary(blender_bin)
    out_path = Path(out_dir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)
    manifest_path = out_path / "render_manifest.json"

    cmd: List[str] = [
        blender, "--background", "--factory-startup", "--python-exit-code", "1",
        "--python", str(WORKER_SCRIPT), "--",
    ]
    for p in stl_paths:
        cmd.extend(["--stl", str(Path(p).resolve())])
    cmd.extend([
        "--env", canonical_env, "--frame", frame, "--mount", mount, "--mode", mode,
        "--frame-width-mm", str(float(frame_width_mm)),
        "--frame-height-mm", str(float(frame_height_mm)),
        "--backing-finish", backing_finish,
        "--out", str(out_path), "--manifest", str(manifest_path),
    ])

    if show_nameplate:
        cmd.append("--show-nameplate")
    if presets:
        for pr in presets:
            cmd.extend(["--preset", pr])
    if aspect:
        cmd.extend(["--aspect", aspect])
    if resolution:
        cmd.extend(["--resolution", resolution])
    if samples is not None:
        cmd.extend(["--samples", str(int(samples))])
    if fps:
        cmd.extend(["--fps", str(int(fps))])
    if frame_mm:
        cmd.extend(["--frame-mm", frame_mm])
    if title:
        cmd.extend(["--title", title])
    if surface:
        cmd.extend(["--surface", surface])
    if window_gobo:
        cmd.extend(["--window-gobo", window_gobo])
    if hdri:
        cmd.extend(["--hdri", hdri])
    if light_temp is not None:
        cmd.extend(["--light-temp", str(float(light_temp))])
    if sun_azimuth is not None:
        cmd.extend(["--sun-azimuth", str(float(sun_azimuth))])
    if add_props:
        for spec in add_props:
            cmd.extend(["--add-prop", spec])
    if remove_props:
        for pid in remove_props:
            cmd.extend(["--remove-prop", pid])
    if clear_props:
        cmd.append("--clear-props")
    if filename:
        cmd.extend(["--filename", filename])
    if shots:
        cmd.extend(["--shots", shots])

    if verbose:
        proc = subprocess.run(cmd)
        stderr_tail, stdout_tail = "", ""
    else:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout_tail = (proc.stdout or "")[-2000:]
        stderr_tail = (proc.stderr or "")[-2000:]

    if proc.returncode != 0:
        hint = (
            "\nHint: Exit code 137 (SIGKILL) on macOS usually means Gatekeeper blocked Blender.app."
            if proc.returncode in (-9, 137)
            else ""
        )
        raise RuntimeError(
            f"Blender worker exited with code {proc.returncode}.{hint}\n"
            f"--- STDOUT (tail) ---\n{stdout_tail}\n--- STDERR (tail) ---\n{stderr_tail}"
        )

    if not manifest_path.is_file():
        raise RuntimeError(f"Blender worker succeeded but did not write manifest: {manifest_path}")

    manifest: Dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))

    if mode == "keyframes":
        sb_path = out_path / "blender_flow_storyboard.png"
        manifest["storyboard_path"] = _build_keyframes_storyboard(manifest.get("keyframes", {}), sb_path)
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    if mode == "video":
        city_slug = manifest.get("city_title", "city").lower().replace(" ", "_")
        mp4_fname = video_name or f"{city_slug}_{canonical_env}_commercial.mp4"
        if not mp4_fname.lower().endswith(".mp4"):
            mp4_fname += ".mp4"
        manifest["video_path"] = _stitch_video_mp4(manifest.get("video_shots", []), fps=fps, out_mp4=out_path / mp4_fname)
        if not keep_frames:
            frames_dir = out_path / "_frames"
            if frames_dir.is_dir():
                shutil.rmtree(frames_dir, ignore_errors=True)
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    return manifest


def _build_cli_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Photorealistic Blender Cycles Studio CLI for 3D City STLs")
    p.add_argument("--stl", action="append", help="Path to city STL file (repeatable for 2-tile 13x18 / 3x1 / 2x2)")
    p.add_argument("--env", default="01_architect_window_desk", choices=ALL_ENV_CHOICES, help="3D studio environment")
    p.add_argument(
        "--frame", default="single_13x18",
        choices=("single_13x18", "single_thin", "single_thick", "cube_cover", "cube_plinth", "triptych_3x1", "quartet_2x2"),
    )
    p.add_argument("--mount", default="auto", choices=("auto", "desk_flat", "wall_mount"))
    p.add_argument("--mode", default="stills", choices=("stills", "keyframes", "video"))
    p.add_argument("--preset", action="append", default=None, help="Still preset(s) or 'all'")
    p.add_argument("--aspect", default=None, choices=("9:16", "4:5", "1:1", "16:9"))
    p.add_argument("--resolution", default=None, help="Explicit WxH override (e.g. 540x960, 1080x1920)")
    p.add_argument("--samples", type=int, default=None)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--frame-mm", default=None, help="Override nominal inner frame opening in mm")
    p.add_argument("--frame-width-mm", type=float, default=4.0, help="Matte-black frame rim width in mm (default 4.0)")
    p.add_argument("--frame-height-mm", type=float, default=7.5, help="Low-profile frame height in mm (default 7.5)")
    p.add_argument("--backing-finish", default="matte_black", choices=("matte_black", "satin_black"))
    p.add_argument("--show-nameplate", action="store_true", default=False, help="Opt-in front plaque (OFF by default)")
    p.add_argument("--title", default=None, help="City title for metadata / opt-in nameplate")
    p.add_argument("--surface", default=None, help="Override tabletop/wall surface texture preset")
    p.add_argument("--window-gobo", default=None, help="Override window/blinds gobo preset")
    p.add_argument("--hdri", default=None, help="Override Poly Haven HDRI preset or local .hdr path")
    p.add_argument("--light-temp", type=float, default=None, help="Override key light color temperature (Kelvin)")
    p.add_argument("--sun-azimuth", type=float, default=None, help="Override key light azimuth (degrees)")
    p.add_argument("--add-prop", action="append", default=None, help="Add prop ID or custom path@x,y,yaw,scale")
    p.add_argument("--remove-prop", action="append", default=None, help="Remove default prop by ID")
    p.add_argument("--clear-props", action="store_true", default=False, help="Remove all default environment props")
    p.add_argument("--out", default="./studio_renders")
    p.add_argument("--filename", default=None)
    p.add_argument("--video-name", default=None)
    p.add_argument("--shots", default="1,2,3,4")
    p.add_argument("--blender-bin", default=None)
    p.add_argument("--keep-frames", action="store_true")
    p.add_argument("--list-presets", action="store_true", help="Print environments, frames & presets JSON")
    p.add_argument("--list-props", action="store_true", help="Print composable scale props catalog JSON")
    p.add_argument("--json", action="store_true")
    p.add_argument("--verbose", action="store_true")
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_cli_parser()
    args = parser.parse_args(argv)

    if args.list_presets:
        print(json.dumps(get_studio_presets(), indent=2, ensure_ascii=False))
        return 0
    if args.list_props:
        print(json.dumps(get_studio_props(), indent=2, ensure_ascii=False))
        return 0
    if not args.stl:
        parser.error("--stl is required unless --list-presets or --list-props is specified.")

    try:
        manifest = run_studio_render(
            stl_paths=args.stl, out_dir=args.out, env=args.env, frame=args.frame, mount=args.mount,
            mode=args.mode, presets=args.preset, aspect=args.aspect, resolution=args.resolution,
            samples=args.samples, fps=args.fps, frame_mm=args.frame_mm,
            frame_width_mm=args.frame_width_mm, frame_height_mm=args.frame_height_mm,
            backing_finish=args.backing_finish, show_nameplate=args.show_nameplate,
            title=args.title, surface=args.surface, window_gobo=args.window_gobo, hdri=args.hdri,
            light_temp=args.light_temp, sun_azimuth=args.sun_azimuth, add_props=args.add_prop,
            remove_props=args.remove_prop, clear_props=args.clear_props, filename=args.filename,
            video_name=args.video_name, shots=args.shots, blender_bin=args.blender_bin,
            keep_frames=args.keep_frames, verbose=args.verbose,
        )
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
    else:
        print(f"Render complete ({manifest.get('mode')}, {manifest.get('mount')}, {manifest.get('total_elapsed_sec')}s)")
        print(f"  Env: {manifest.get('env')} | Backend: {manifest.get('cycles', {}).get('backend')}")
        for st in manifest.get("stills", []):
            print(f"  [PNG] {st.get('path')} ({st.get('elapsed_sec')}s)")
        if manifest.get("storyboard_path"):
            print(f"  [STORYBOARD] {manifest['storyboard_path']}")
        if manifest.get("flow_prompts_path"):
            print(f"  [FLOW PROMPTS] {manifest['flow_prompts_path']}")
        if manifest.get("video_path"):
            print(f"  [VIDEO] {manifest['video_path']}")
    return 0


__all__ = [
    "ALL_ENV_CHOICES", "ENVIRONMENTS", "ENV_ALIASES", "FRAME_STYLES",
    "STILL_PRESETS", "VIDEO_SHOTS", "find_blender_binary", "find_ffmpeg_binary",
    "get_studio_presets", "get_studio_props", "run_studio_render",
]


if __name__ == "__main__":
    raise SystemExit(main())
