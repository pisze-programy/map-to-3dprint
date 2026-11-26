# Blender Cycles Studio and MCP Workflow

Render photorealistic stills, `3x3` chalk detail mosaics, Google Flow keyframes, and commercial MP4 videos for any city STL.
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
- **Catalog frame styles (`--frame`)**: `auto` (default with `--manifest`), `single_a4_1x3`, `single_a4_landscape_3x1`, `triptych_a4_3x1`, `quartet_a4_2x2`, `square_150_2x2`, `square_240_2x4`, `flagship_50x70_3x9`, `custom_grid`.
- **Additional frame styles (`--frame`)**: `a4_passepartout`, `none`, `single_thin`, `single_thick`, `cube_cover`, `cube_plinth`, `triptych_3x1`, `quartet_2x2`, `single_13x18`.
- **Mount modes (`--mount`)**: `auto`, `desk_flat`, `wall_mount`.
- **Packshot and hero presets (`--preset`)**: `hero_desk`, `hero_wall`, `macro_skyline`, `macro_waterfront`, `profile_low`, `top_down`, `packshot_iso`, `all`.
- **Detail and QA presets (`--preset`)**: `detail_grid_3x3` (renders `detail_grid_01..09` and `details_3x3_grid.png`), `detail_spire`, `detail_canyon`, `detail_oblique_grid`, `detail_waterfront`, `qa_seam_raking`, `qa_top_down_grid`, `qa_underside`.
- **Aspect ratios (`--aspect`)**: `9:16`, `4:5`, `1:1`, `16:9`.

## 3. Composable Prop, Camera, and Scene Overrides

- **Camera**: `--fstop <float>` (aperture override, e.g. `56.0` or `2.8`), `--focus-xy <x_mm,y_mm>` (detail focus point in mm).
- **Props**: `--add-prop <id_or_path@x,y,yaw,scale>`, `--remove-prop <id>`, `--clear-props`.
- **Scene**: `--mount <mode>`, `--surface <preset>`, `--window-gobo <preset>`, `--hdri <preset_or_path>`, `--light-temp <K>`, `--sun-azimuth <deg>`.
- **Frame**: `--frame-mm <WxH>`, `--frame-width-mm 4.0`, `--frame-height-mm 7.5`, `--backing-finish matte_black|satin_black`, `--show-nameplate` (OFF by default).

## 4. Manifest-Locked Production CLI and SKU Bundle

Run the full production bundle (STL export, `VAL-01..14`, Seam QA, packshots, and `3x3` chalk grid) in one command:
```bash
node tools/produce_sku_bundle.mjs --city paris_true_scale --format single --mode full
```
Production `render_studio.py` runs require `--manifest <export_dir>/assembly_manifest.json` (`validation.verdict == "PASS"` and matching SHA-256).
Use `--frame auto` so framing matches `manifest.format_id` automatically across Single A4, Triptych, Quartet, Square, `50x70`, and custom grids.
Raw `--stl` calls fail unless you pass `--draft-unvalidated`, which prefixes every output file with `DRAFT_UNVALIDATED_`.

### Render `3x3` Chalk Detail Mosaic (`18_detail_chalk_gallery`)
```bash
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 18_detail_chalk_gallery --frame none --preset detail_grid_3x3 \
  --aspect 1:1 --samples 48 --out ./renders/paris_detail_3x3
```
This writes `detail_grid_01..09.png` (`f/56.0` minimal blur) and stitches `details_3x3_grid.png`.
Override depth of field or focus target with `--fstop` and `--focus-xy x_mm,y_mm`.

### Render Gate 3 Seam-Truth QA (`qa_*`)
```bash
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 11_packshot_white --frame none --preset qa_seam_raking \
  --preset qa_top_down_grid --preset qa_underside --aspect 1:1 \
  --samples 24 --out ./renders/paris_qa
```
`qa_*` presets hide frames and backing slabs cleanly during each QA shot and restore visibility afterward.

### Render Manifest-Locked Stills and Flow Keyframes
```bash
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 12_persona_architect --frame auto --mode stills \
  --aspect 4:5 --samples 64 --out ./renders/paris_a4
```
Pass `--mode keyframes --aspect 9:16 --shots 1,2,3,4` to generate Google Flow `Start -> End` pairs and `flow_prompts.json`.

### Render City-Swappable Kinder Commercial Video (`studio_blender/kinder_video.py`)
```bash
python3 studio_blender/kinder_video.py \
  --manifest exports/dubai_downtown_a4_120x170_1x3/assembly_manifest.json \
  --env 16_persona_realestate --frame auto --packshot-env 11_packshot_white \
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
| `render_city_stills` | Render Cycles stills, packshots, QA views, or `detail_grid_3x3`. | `manifest_path`, `out_dir`, `env`, `frame` (`auto`), `presets`, `fstop`, `focus_xy`, `mount`, `samples` |
| `render_flow_keyframes` | Render `9:16` `Start -> End` frames and prompts. | `manifest_path`, `out_dir`, `env`, `frame` (`auto`), `mount`, `shots`, `samples` |
| `render_commercial_video` | Render 5-angle Kinder (`kinder_multishot` default) or continuous MP4. | `manifest_path`, `out_dir`, `env`, `frame` (`auto`), `camera_mode`, `packshot_end`, `samples`, `shutter`, `duration_sec` |
