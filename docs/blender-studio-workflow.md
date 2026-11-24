# Blender Cycles Studio and MCP Workflow

Render photorealistic stills, Google Flow keyframes, and commercial MP4 videos for any exported city STL.
The studio uses Blender Cycles with Apple Metal GPU, OpenImageDenoise, and AgX color management.
Read `docs/studio-art-direction-and-scenes.md` for art direction rules and all 17 environment specs.

## 1. Requirements

- Install Blender `4.2+` or `5.x` at `/Applications/Blender.app/Contents/MacOS/Blender` (verified on Blender `5.3.0`).
- Install `ffmpeg` for MP4 video encoding and storyboard contact sheets.
- Use Python `3.10+` with standard library packages only.

## 2. Verified Presets, Frames, and Mounts

Run `python3 studio_blender/render_studio.py --list-presets --json` to inspect all 17 live environments.
Run `python3 studio_blender/render_studio.py --list-props --json` to list all 26 real-scale props.

- **Core environments (`01`..`11`)**: `01_architect_window_desk`, `02_creative_office_desk`, `03_morning_coffee_table`, `04_minimal_home_console`, `05_gallery_wall_sunlight`, `06_architect_slat_wall`, `07_evening_warm_desk`, `08_loft_concrete_studio`, `09_dark_cinematic`, `10_macro_editorial`, `11_packshot_white`.
- **Persona environments (`12`..`17`)**: `12_persona_architect`, `13_persona_traveler`, `14_persona_lawyer`, `15_persona_corporate`, `16_persona_realestate`, `17_persona_executive_study`.
- **Frame styles (`--frame`)**: `single_13x18` (default Variant C), `a4_passepartout` (`210x297x30 mm` 45-deg bevel), `single_thin`, `single_thick`, `cube_cover`, `triptych_3x1`, `quartet_2x2`.
- **Mount modes (`--mount`)**: `auto`, `desk_flat`, `wall_mount`.
- **Still presets (`--preset`)**: `hero_desk`, `hero_wall`, `macro_skyline`, `macro_waterfront`, `profile_low`, `top_down`, `packshot_iso`, `all`.
- **Aspect ratios (`--aspect`)**: `9:16`, `4:5`, `1:1`, `16:9`.

## 3. Composable Prop and Scene Overrides

Customize any environment without code edits using these CLI flags:

- **Props**: `--add-prop <id_or_path@x,y,yaw,scale>`, `--remove-prop <id>`, `--clear-props`.
- **Scene**: `--mount <mode>`, `--surface <preset>`, `--window-gobo <preset>`, `--hdri <preset_or_path>`, `--light-temp <K>`, `--sun-azimuth <deg>`.
- **Frame**: `--frame-mm <WxH>`, `--frame-width-mm 4.0`, `--frame-height-mm 7.5`, `--backing-finish matte_black|satin_black`, `--passepartout-color white|ivory|charcoal|greige`, `--show-nameplate` (OFF by default).

## 4. CLI Workflows

Repeat `--stl` for multi-tile frames (`2` tiles for `single_13x18`, `3` for `triptych_3x1`, `4` for `quartet_2x2`).

### Render Product Stills with Prop Swap (`studio_blender/render_studio.py`)
```bash
python3 studio_blender/render_studio.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_Triptych_01_Top_Tribeca_145x79mm.stl \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --env 15_persona_corporate --frame single_13x18 --mode stills \
  --remove-prop matte_black_mug --add-prop ceramic_vessel@145,55,25,1.0 \
  --aspect 4:5 --samples 96 --out ./renders/nyc_corporate
```

### Render Google Flow `9:16` Keyframes (`--mode keyframes`)
```bash
python3 studio_blender/render_studio.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --env 01_architect_window_desk --frame single_13x18 --mode keyframes \
  --aspect 9:16 --samples 64 --shots 1,2,3,4 --out ./renders/nyc_flow
```
This command creates eight `Start -> End` PNGs, `blender_flow_storyboard.png`, and `flow_prompts.json`.

### Render City-Swappable Kinder Commercial Video (`studio_blender/kinder_video.py`)
Swap only `--stl`, `--frame`, and `--env` to render any city in any of the 17 rooms:
```bash
python3 studio_blender/kinder_video.py \
  --stl calibration/Map3D_DUBAI_Pelna_Bryla_145x79mm.stl \
  --env 16_persona_realestate --frame single_thin --packshot-env 11_packshot_white \
  --camera-mode kinder_multishot --resolution 540x960 --fps 24 \
  --duration 9.5 --samples 56 --shutter 0.68 --out ./renders/dubai_video
```
Default `--camera-mode kinder_multishot` runs five contrasting Kinder angles with whip match-cuts (`studio_blender/kinder_shots.py`).
The anti-flicker Cycles stack combines `samples=56`, `use_animated_seed`, `OIDN ACCURATE`, `shutter=0.68`, and `hqdn3d`.
Pass `--camera-mode kinder_continuous` for a single-take spline, `--packshot-env none` to skip dissolve, or `--preview-only`.

### Compare `13x18` vs Heavy A4 Passe-Partout (`studio_blender/compare_frames.py`)
```bash
python3 studio_blender/compare_frames.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_Triptych_01_Top_Tribeca_145x79mm.stl \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --passepartout-color white --samples 64 --out ./renders/a4_compare
```
This helper renders a true 1:1 millimeter packshot comparing thin `13x18` and heavy A4 frames.

## 5. Registered MCP Server (`studio-blender`)

Antigravity registers `studio-blender` in `/Users/krystianblaszczyk/.gemini/config/mcp_config.json`.
Command: `python3 /Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/studio_blender/mcp_server.py`.

| MCP Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| `list_studio_presets` | Return all 17 environments, frames, mounts, and shots. | None |
| `list_studio_props` | Return all 26 composable props and placement syntax. | None |
| `render_city_stills` | Render Cycles PNG stills with prop and scene overrides. | `stl_paths`, `out_dir`, `env`, `frame`, `passepartout_color`, `mount`, `add_props`, `samples` |
| `render_flow_keyframes` | Render `9:16` `Start -> End` frames and prompts. | `stl_paths`, `out_dir`, `env`, `frame`, `mount`, `add_props`, `shots`, `samples` |
| `render_commercial_video` | Render 5-angle Kinder (`kinder_multishot` default) or continuous MP4. | `stl_paths`, `out_dir`, `env`, `camera_mode`, `packshot_end`, `samples`, `shutter`, `duration_sec` |
