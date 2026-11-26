# Frameless Chalk-Plaster Architectural Detail Gallery Mode

Use this Cycles mode to prove real `10K` (`17 um` XY) MSLA architectural detail without frame clutter.
Activate it with `--env 18_detail_chalk_gallery` (alias `detail_chalk`) and `--frame none`.

## 1. Visual Look and Pipeline Modules

- **Chalk-plaster shader (`studio_blender/materials_detail.py`)**: `make_chalk_plaster_material()` renders dry matte gypsum (`#F0EEE9`, roughness `0.85-0.93`).
- **Grain and tooth**: The shader adds fine powder grain, subtle `0.1 mm` layer tooth, and crisp canyon AO.
- **Hard-sun gallery stage (`studio_blender/envs/arch_detail.py`)**: `build_detail_chalk_stage()` aims a `0.50 deg` Sun (`96 deg` azimuth, `25 deg` elevation).
- **Clean backdrop**: Camera rays see pure `#FFFFFF` with cool sky bounce and zero vignette.
- **Recessed backing plinth (`studio_blender/worker_render.py`)**: `--frame none` builds `FramelessBackingSlab` sized to `total_width_m x total_height_m` across multi-frame spreads.
- **Plinth inset**: The matte-black slab recesses `-0.8 mm` inside tile edges (`Z = -0.00015 m`) with zero outer border.
- **Tile alignment (`studio_blender/stl_loader.py`)**: `--manifest` aligns every strip (`single_a4_1x3`, `triptych_a4_3x1`, `quartet_a4_2x2`) on its nominal grid.

## 2. Detail Presets, `3x3` Mosaic, and Aperture Overrides (`studio_blender/camera_detail.py`)

Keep the miniature tack-sharp across depth with `f/56.0` minimal lens blur (`detail_edge_horizon` stays an alias).
Override depth of field or focus target anytime with `--fstop <float>` and `--focus-xy <x_mm,y_mm>`.

| Preset (`--preset`) | Default Aperture | Framing Purpose |
| :--- | :---: | :--- |
| `detail_spire` | `f/56.0` | `135 mm` eye-level spire soaring into pure `#FFFFFF` horizon. |
| `detail_canyon` | `f/56.0` | `120 mm` sunlit street-canyon corridor into `#FFFFFF` horizon. |
| `detail_oblique_grid` | `f/56.0` | `130 mm` `44 deg` full-bleed urban grid across blocks. |
| `detail_waterfront` | `f/56.0` | `125 mm` `30 deg` interior waterfront or canyon tier macro. |
| `detail_grid_3x3` | `f/56.0` | Renders `detail_grid_01..09` (`1:1`, NW to SE) and stitches `details_3x3_grid.png`. |

`detail_grid_3x3` expands into nine deterministic interior cells (`detail_grid_01` through `detail_grid_09`) from NW to SE.
Each cell uses `125-135 mm` telephoto framing at `26-42 deg` elevation with strict interior frustum clamping.
`stitch_detail_grid_3x3()` builds `<out>/details_3x3_grid.png` with `6 px` white gutters and cell numbers `1..9`.
`render_manifest.json` records the mosaic path in `detail_grid_3x3_path`.

## 3. CLI Examples (`studio_blender/render_studio.py`)

Production renders require `--manifest <export_dir>/assembly_manifest.json` (`validation.verdict == "PASS"`).

```bash
# Full 3x3 chalk detail mosaic (9 cells + details_3x3_grid.png)
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 18_detail_chalk_gallery --frame none \
  --preset detail_grid_3x3 \
  --aspect 1:1 --samples 48 --out ./renders/paris_detail_3x3

# Single detail shot with custom f-stop and XY focus point in mm
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 18_detail_chalk_gallery --frame none \
  --preset detail_spire --fstop 56.0 --focus-xy 0,0 \
  --aspect 1:1 --samples 64 --out ./renders/paris_detail_gallery
```

## 4. MCP Example (`studio-blender`)

Call `render_city_stills` on the registered `studio-blender` MCP server with:

```json
{
  "manifest_path": "exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json",
  "out_dir": "./renders/paris_detail_3x3",
  "env": "18_detail_chalk_gallery",
  "frame": "none",
  "presets": ["detail_grid_3x3"],
  "fstop": 56.0,
  "focus_xy": "0,0",
  "aspect": "1:1",
  "samples": 48
}
```
