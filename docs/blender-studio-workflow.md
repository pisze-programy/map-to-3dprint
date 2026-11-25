# Blender Cycles Studio and MCP Workflow

Render photorealistic stills, detail galleries, Google Flow keyframes, and commercial MP4 videos for any city STL.
The studio uses Blender Cycles with Apple Metal GPU, OpenImageDenoise, and AgX color management.
Read `docs/studio-art-direction-and-scenes.md` for art direction rules and environment specs.

## 1. Requirements

- Install Blender `4.2+` or `5.x` at `/Applications/Blender.app/Contents/MacOS/Blender` (verified on Blender `5.3.0`).
- Install `ffmpeg` for MP4 video encoding and storyboard contact sheets.
- Use Python `3.10+` with standard library packages only.

## 2. Verified Presets, Frames, and Mounts

Run `python3 studio_blender/render_studio.py --list-presets --json` to inspect all 18 live environments.
Run `python3 studio_blender/render_studio.py --list-props --json` to list all 26 real-scale props.

- **Core environments (`01`..`11`)**: `01_architect_window_desk` .. `11_packshot_white`.
- **Persona environments (`12`..`17`)**: `12_persona_architect`, `13_persona_traveler`, `14_persona_lawyer`, `15_persona_corporate`, `16_persona_realestate`, `17_persona_executive_study`.
- **Detail gallery (`18`)**: `18_detail_chalk_gallery` (alias `detail_chalk`, frameless chalk-plaster architectural gallery).
- **Frame styles (`--frame`)**: `a4_passepartout` (`210x297x30 mm` white-only), `none` (frameless), `single_13x18`, `single_thin`, `single_thick`, `cube_cover`, `triptych_3x1`, `quartet_2x2`.
- **Mount modes (`--mount`)**: `auto`, `desk_flat`, `wall_mount`.
- **Still presets (`--preset`)**: `hero_desk`, `hero_wall`, `macro_skyline`, `macro_waterfront`, `profile_low`, `top_down`, `packshot_iso`, `detail_spire`, `detail_canyon`, `detail_oblique_grid`, `detail_waterfront`, `all`.
- **Aspect ratios (`--aspect`)**: `9:16`, `4:5`, `1:1`, `16:9`.

## 3. Composable Prop and Scene Overrides

- **Props**: `--add-prop <id_or_path@x,y,yaw,scale>`, `--remove-prop <id>`, `--clear-props`.
- **Scene**: `--mount <mode>`, `--surface <preset>`, `--window-gobo <preset>`, `--hdri <preset_or_path>`, `--light-temp <K>`, `--sun-azimuth <deg>`.
- **Frame**: `--frame-mm <WxH>`, `--frame-width-mm 4.0`, `--frame-height-mm 7.5`, `--backing-finish matte_black|satin_black`, `--show-nameplate` (OFF by default).

## 4. Headless A4 STL Export and Manifest-Locked Studio CLI

Export verified A4 `12x17 cm` (`1x3`) SKUs headlessly via `tools/export_city_sku.mjs` (writes STLs, `assembly_manifest.json`, and `VAL-01..14` report):
```bash
node tools/export_city_sku.mjs --city paris_true_scale
```
Production renders require `--manifest <export_dir>/assembly_manifest.json` (`validation.verdict == "PASS"` and matching SHA-256).
Raw `--stl` calls fail unless you pass `--draft-unvalidated`, which prefixes every output file with `DRAFT_UNVALIDATED_`.

### Render Frameless Chalk-Plaster Detail Gallery (`18_detail_chalk_gallery`)
```bash
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 18_detail_chalk_gallery --frame none --preset detail_spire \
  --aspect 1:1 --samples 64 --out ./renders/paris_detail
```
Use `--preset detail_canyon`, `detail_oblique_grid`, or `detail_waterfront` for the other three gallery angles (`f/56.0` minimal blur).

### Render A4 Stills, Flow Keyframes, and 1:1 Comparison
```bash
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 12_persona_architect --frame a4_passepartout --mode stills \
  --aspect 4:5 --samples 64 --out ./renders/paris_a4
```
Pass `--mode keyframes --aspect 9:16 --shots 1,2,3,4` to generate Google Flow `Start -> End` pairs and `flow_prompts.json`.
Run `python3 studio_blender/compare_frames.py --old-stl <old> --a4-stl <a4> --draft-unvalidated --out <dir>` for draft comparisons.

### Render City-Swappable Kinder Commercial Video (`studio_blender/kinder_video.py`)
```bash
python3 studio_blender/kinder_video.py \
  --manifest exports/dubai_downtown_a4_120x170_1x3/assembly_manifest.json \
  --env 16_persona_realestate --frame a4_passepartout --packshot-env 11_packshot_white \
  --camera-mode kinder_multishot --resolution 540x960 --fps 24 \
  --duration 9.5 --samples 56 --shutter 0.68 --out ./renders/dubai_video
```
Default `--camera-mode kinder_multishot` runs five contrasting Kinder angles with whip match-cuts (`studio_blender/kinder_shots.py`).
The anti-flicker Cycles stack combines `samples=56`, `use_animated_seed`, `OIDN ACCURATE`, `shutter=0.68`, and `hqdn3d`.

## 5. Registered MCP Server (`studio-blender`)

Antigravity registers `studio-blender` in `/Users/krystianblaszczyk/.gemini/config/mcp_config.json`.
Command: `python3 /Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/studio_blender/mcp_server.py`.

| MCP Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| `list_studio_presets` | Return all 18 environments, frames, mounts, and presets. | None |
| `list_studio_props` | Return all 26 composable props and placement syntax. | None |
| `render_city_stills` | Render Cycles PNG stills, A4 packshots, or chalk details. | `manifest_path`, `out_dir`, `env`, `frame`, `presets`, `mount`, `samples` |
| `render_flow_keyframes` | Render `9:16` `Start -> End` frames and prompts. | `manifest_path`, `out_dir`, `env`, `frame`, `mount`, `shots`, `samples` |
| `render_commercial_video` | Render 5-angle Kinder (`kinder_multishot` default) or continuous MP4. | `manifest_path`, `out_dir`, `env`, `camera_mode`, `packshot_end`, `samples`, `shutter`, `duration_sec` |
