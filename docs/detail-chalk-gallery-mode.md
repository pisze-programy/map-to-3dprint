# Frameless Chalk-Plaster Architectural Detail Gallery Mode

Use this Cycles mode to prove real `10K` (`17 um` XY) MSLA architectural detail without frame clutter.
Activate it with `--env 18_detail_chalk_gallery` (alias `detail_chalk`) and `--frame none`.

## 1. Visual Look and Pipeline Modules

- **Chalk-plaster shader (`studio_blender/materials_detail.py`)**: `make_chalk_plaster_material()` renders dry matte gypsum (`#F0EEE9`, roughness `0.85-0.93`). It adds fine powder grain, subtle `0.1 mm` vertical wall layer tooth, and crisp canyon AO.
- **Hard-sun gallery stage (`studio_blender/envs/arch_detail.py`)**: `build_detail_chalk_stage()` aims a `0.50 deg` cross-raking Sun (`96 deg` azimuth, `25 deg` elevation). Camera rays see pure `#FFFFFF` with cool sky bounce and zero vignette.
- **Frameless backing plinth (`studio_blender/stl_loader.py`)**: `--frame none` seats city STLs on a straight matte-black slab (`+0.4 mm` margin, `3.0 mm` skirt). Top surface sits at `Z = -0.00015 m` to stop z-fighting.

## 2. Four Detail Presets and Crisp DoF Rules (`studio_blender/camera_detail.py`)

Keep `60-75%` of the architectural city tack-sharp, with only gentle bokeh at extreme corners:

| Preset (`--preset`) | Aperture | Framing Purpose |
| :--- | :---: | :--- |
| `detail_spire` | `f/8.0` | Hero spire and plaza tack-sharp soaring into pure `#FFFFFF` horizon. |
| `detail_canyon` | `f/11.0` | Deep sunlit street-canyon corridor sharp with subtle front and back fade. |
| `detail_oblique_grid` | `f/14.0` | Full-bleed edge-to-edge urban grid razor-sharp across courtyards and blocks. |
| `detail_edge_horizon` | `f/11.0` | Razor-straight diagonal matte-black slab edge with crisp front and mid towers. |

## 3. CLI Example (`studio_blender/render_studio.py`)

```bash
python3 studio_blender/render_studio.py \
  --stl exports/paris_eiffel_a4_120x170_2x1/Map3D_PARIS_A4_Top_120x85mm.stl \
  --stl exports/paris_eiffel_a4_120x170_2x1/Map3D_PARIS_A4_Bottom_120x85mm.stl \
  --env 18_detail_chalk_gallery --frame none \
  --preset detail_spire --preset detail_canyon \
  --preset detail_oblique_grid --preset detail_edge_horizon \
  --aspect 1:1 --samples 64 --out ./renders/paris_detail_gallery
```

## 4. MCP Example (`studio-blender`)

Call `render_city_stills` on the registered `studio-blender` MCP server with:

```json
{
  "stl_paths": ["exports/paris_eiffel_a4_120x170_2x1/Map3D_PARIS_A4_Top_120x85mm.stl", "exports/paris_eiffel_a4_120x170_2x1/Map3D_PARIS_A4_Bottom_120x85mm.stl"],
  "out_dir": "./renders/paris_detail_gallery",
  "env": "18_detail_chalk_gallery",
  "frame": "none",
  "presets": ["detail_spire", "detail_canyon", "detail_oblique_grid", "detail_edge_horizon"],
  "aspect": "1:1",
  "samples": 64
}
```
