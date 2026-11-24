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

## 4. Headless A4 STL Export and Studio CLI

Export verified A4 `12x17 cm` solid-base STLs headlessly via CLI or `map3d-inspector` MCP (`export_map3d_stl`, `framePreset: 'a4_12x17'`):
```bash
node tools/mcp_map3d_inspector.mjs export-stl --frame-preset a4_12x17 \
  --lat 48.8576 --lon 2.2956 --span 1780 --rot -46 --z-scale 1.7 --out-dir ./exports/paris_a4
```

### Render Frameless Chalk-Plaster Detail Gallery (`18_detail_chalk_gallery`)
```bash
python3 studio_blender/render_studio.py \
  --stl exports/paris_eiffel_a4_120x170_2x1/Map3D_PARIS_A4_Top_120x85mm.stl \
  --stl exports/paris_eiffel_a4_120x170_2x1/Map3D_PARIS_A4_Bottom_120x85mm.stl \
  --env 18_detail_chalk_gallery --frame none --preset detail_spire \
  --aspect 1:1 --samples 64 --out ./renders/paris_detail
```
Use `--preset detail_canyon`, `detail_oblique_grid`, or `detail_waterfront` for the other three gallery angles.

### Render A4 Stills, Flow Keyframes, and 1:1 Comparison
```bash
python3 studio_blender/render_studio.py \
  --stl exports/nyc_wtc_a4_120x170_2x1/Map3D_NYC_A4_Top_120x85mm.stl \
  --stl exports/nyc_wtc_a4_120x170_2x1/Map3D_NYC_A4_Bottom_120x85mm.stl \
  --env 12_persona_architect --frame a4_passepartout --mode stills \
  --aspect 4:5 --samples 64 --out ./renders/nyc_a4
```
Pass `--mode keyframes --aspect 9:16 --shots 1,2,3,4` to generate Google Flow `Start -> End` pairs and `flow_prompts.json`.
Run `python3 studio_blender/compare_frames.py --old-stl <old> --a4-stl <a4> --out <dir>` for a 1:1 frame packshot.

### Render City-Swappable Kinder Commercial Video (`studio_blender/kinder_video.py`)
```bash
python3 studio_blender/kinder_video.py \
  --stl calibration/Map3D_DUBAI_Pelna_Bryla_145x79mm.stl \
  --env 16_persona_realestate --frame single_thin --packshot-env 11_packshot_white \
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
| `render_city_stills` | Render Cycles PNG stills, A4 packshots, or chalk details. | `stl_paths`, `out_dir`, `env`, `frame`, `presets`, `mount`, `add_props`, `samples` |
| `render_flow_keyframes` | Render `9:16` `Start -> End` frames and prompts. | `stl_paths`, `out_dir`, `env`, `frame`, `mount`, `add_props`, `shots`, `samples` |
| `render_commercial_video` | Render 5-angle Kinder (`kinder_multishot` default) or continuous MP4. | `stl_paths`, `out_dir`, `env`, `camera_mode`, `packshot_end`, `samples`, `shutter`, `duration_sec` |
