# Blender Cycles Studio and MCP Workflow

Render photorealistic stills, Google Flow keyframes, and commercial MP4 videos for any exported city STL.
The studio uses Blender Cycles with Apple Metal GPU, OpenImageDenoise, and AgX color management.
Read `docs/studio-art-direction-and-scenes.md` for art direction rules and full environment specs.

## 1. Requirements

- Install Blender `4.2+` or `5.x` at `/Applications/Blender.app/Contents/MacOS/Blender` (verified on Blender `5.3.0`).
- Install `ffmpeg` for MP4 video encoding and storyboard contact sheets.
- Use Python `3.10+` with standard library packages only.

## 2. Verified Presets, Frames, and Mounts

Run `python3 studio_blender/render_studio.py --list-presets --json` to inspect all live presets.
Run `python3 studio_blender/render_studio.py --list-props --json` to list all 10 real-scale props.

- **Environments (`--env`)**: `01_architect_window_desk`, `02_creative_office_desk`, `03_morning_coffee_table`, `04_minimal_home_console`, `05_gallery_wall_sunlight`, `06_architect_slat_wall`, `07_evening_warm_desk`, `08_loft_concrete_studio`, `09_dark_cinematic`, `10_macro_editorial`, `11_packshot_white`.
- **Frame styles (`--frame`)**: `single_13x18` (default Variant C), `single_thin`, `single_thick`, `cube_cover` (`cube_plinth`), `triptych_3x1`, `quartet_2x2`.
- **Mount modes (`--mount`)**: `auto`, `desk_flat`, `wall_mount`.
- **Still presets (`--preset`)**: `hero_desk`, `hero_wall`, `macro_skyline`, `macro_waterfront`, `profile_low`, `top_down`, `packshot_iso`, `all`.
- **Aspect ratios (`--aspect`)**: `9:16`, `4:5`, `1:1`, `16:9`.
- **Commercial shots (`--shots 1,2,3,4`)**: `shot01_hero_crash_zoom`, `shot02_crane_rise_raking_light`, `shot03_overhead_canyon_swoop`, `shot04_pullout_environment_reveal`.

## 3. Composable Prop and Scene Overrides

Customize any environment without code edits using these CLI flags:

- **Props**: `--add-prop <id_or_path@x,y,yaw,scale>`, `--remove-prop <id>`, `--clear-props`.
- **Scene**: `--mount <mode>`, `--surface <preset>`, `--window-gobo <preset>`, `--hdri <preset_or_path>`, `--light-temp <K>`, `--sun-azimuth <deg>`.
- **Frame**: `--frame-mm <WxH>`, `--frame-width-mm 4.0`, `--frame-height-mm 7.5`, `--backing-finish matte_black|satin_black`, `--show-nameplate` (OFF by default).

## 4. CLI Workflows (`studio_blender/render_studio.py`)

Repeat `--stl` for multi-tile frames (`2` tiles for `single_13x18`, `3` for `triptych_3x1`, `4` for `quartet_2x2`).

### Render Product Stills with Prop Swap (`--mode stills`)
```bash
python3 studio_blender/render_studio.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_Triptych_01_Top_Tribeca_145x79mm.stl \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --env 02_creative_office_desk --frame single_13x18 --mode stills \
  --remove-prop espresso_cup --add-prop ceramic_vessel@145,55,25,1.0 \
  --aspect 4:5 --samples 96 --out ./renders/nyc_office
```

### Render Google Flow `9:16` Keyframes (`--mode keyframes`)
```bash
python3 studio_blender/render_studio.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --env 01_architect_window_desk --frame single_13x18 --mode keyframes \
  --aspect 9:16 --samples 64 --shots 1,2,3,4 --out ./renders/nyc_flow
```
This command creates eight `Start -> End` PNGs, `blender_flow_storyboard.png`, and `flow_prompts.json`.

### Render Direct Cycles MP4 Video (`--mode video`)
```bash
python3 studio_blender/render_studio.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --env 09_dark_cinematic --frame single_13x18 --mode video \
  --aspect 9:16 --resolution 540x960 --samples 32 --fps 24 --out ./renders/nyc_video
```
This command outputs a `9.0 s`, `24 fps` H.264 MP4 clip with Cycles motion blur.

### Render Continuous C2 Kinder-Style Video (`studio_blender/kinder_video.py`)
```bash
python3 studio_blender/kinder_video.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_Triptych_01_Top_Tribeca_145x79mm.stl \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --env 09_dark_cinematic --packshot-env 11_packshot_white \
  --resolution 540x960 --fps 24 --duration 11.0 --samples 32 \
  --shutter 0.55 --dissolve-start 9.75 --dissolve-dur 0.45 --out ./renders/kinder_video
```
This script renders one continuous `11.0 s` C2-smooth camera path with Cycles optical motion blur.
It dissolves spatially locked from `09_dark_cinematic` into `11_packshot_white` and builds a 12-frame filmstrip.
Pass `--preview-only` for a quick 12-beat visual preview strip before full rendering.

## 5. Registered MCP Server (`studio-blender`)

Antigravity registers `studio-blender` in `/Users/krystianblaszczyk/.gemini/config/mcp_config.json`.
Command: `python3 /Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/studio_blender/mcp_server.py`.

| MCP Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| `list_studio_presets` | Return all 11 environments, frames, mounts, and shots. | None |
| `list_studio_props` | Return all 10 composable props and placement syntax. | None |
| `render_city_stills` | Render Cycles PNG stills with prop and scene overrides. | `stl_paths`, `out_dir`, `env`, `frame`, `mount`, `add_props`, `remove_props`, `samples` |
| `render_flow_keyframes` | Render `9:16` `Start -> End` frames and prompts. | `stl_paths`, `out_dir`, `env`, `frame`, `mount`, `add_props`, `shots`, `samples` |
| `render_commercial_video` | Render a `24 fps` H.264 Cycles MP4 clip. | `stl_paths`, `out_dir`, `env`, `frame`, `mount`, `resolution`, `fps`, `video_name` |
