# Studio Blender - Manifest-Locked Cycles Render Harness & MCP Server

Architectural editorial render studio built on Blender Cycles (Apple Metal GPU + OpenImageDenoise + AgX) for `map-to-3dprint`.

## Product Truth and Format Framing (`--frame auto`)

- **Default production rule**: Pass `--manifest <export_dir>/assembly_manifest.json` (`VAL-01..14 PASS`) with `--frame auto`.
- **Automatic format mapping**: `--frame auto` reads `manifest.format_id` (`single_a4_1x3`, `single_a4_landscape_3x1`, `triptych_a4_3x1`, `quartet_a4_2x2`, `square_150_2x2`, `square_240_2x4`, `flagship_50x70_3x9`, `custom_grid`).
- **Heavy A4 gallery spec**: `210 x 297 x 30 mm` matte-black frame, white beveled `120 x 170 mm` passe-partout, and `matte_black` backing.
- **Frameless chalk detail mode**: `--frame none` builds `FramelessBackingSlab` sized across `total_width_m x total_height_m` for single or multi-frame layouts.
- **Zero nameplates and zero stands**: `--show-nameplate` stays OFF by default; frames sit flat (`desk_flat`) or mount flush (`wall_mount`).
- **Draft lock**: Raw `--stl` calls fail unless you pass `--draft-unvalidated`, which prefixes outputs with `DRAFT_UNVALIDATED_`.

## 18 Cohesive Studio Environments

| Env ID | Mount | Scene |
| :--- | :--- | :--- |
| `01_architect_window_desk` | `desk_flat` | Pale ash-oak desk, black-mullioned studio window daylight, tumbler & architect pen |
| `02_creative_office_desk` | `desk_flat` | Oiled walnut desk, sunlit office light streaks, laptop corner & espresso cup |
| `03_morning_coffee_table` | `desk_flat` | Honed Italian sandstone table, morning sun, espresso cup & linen monograph |
| `04_minimal_home_console` | `desk_flat` | Brushed honey-oak console against boiserie wall, ceramic vessels & plant |
| `05_gallery_wall_sunlight` | `wall_mount` | Flush wall-mount on ivory boiserie wall with diagonal afternoon window sunbeam |
| `06_architect_slat_wall` | `wall_mount` | Flush wall-mount on vertical acoustic oak-slat wall with gallery spotlight |
| `07_evening_warm_desk` | `desk_flat` | Oiled walnut twilight desk, warm `2900 K` desk lamp vs cool dusk window |
| `08_loft_concrete_studio` | `desk_flat` | Pale terrazzo loft workbench, overcast skylight, monograph & ceramic mug |
| `09_dark_cinematic` | `desk_flat` | Honed volcanic basalt plinth, golden raking key & cool rim for video cuts |
| `10_macro_editorial` | `desk_flat` | `90 mm f/2.0` plaster-grain macro stage proving `10K` MSLA print resolution |
| `11_packshot_white` | `desk_flat` | Pure `#FFFFFF` seamless e-commerce cyclorama + shadow-catcher, zero props |
| `12_persona_architect` | `desk_flat` | Smoked oak studio desk, rolled vellum, concrete cup, basswood maquette & lamp |
| `13_persona_traveler` | `desk_flat` | Walnut desk, CC0 vintage camera, travel monographs, brass globe & compass |
| `14_persona_lawyer` | `desk_flat` | Mahogany study, dark leather law volumes, desk folio & gold fountain pen |
| `15_persona_corporate` | `desk_flat` | Smoked-walnut high-rise office beside curtain wall, laptop & matte-black mug |
| `16_persona_realestate` | `desk_flat` | Calacatta marble showroom table, crystal greenery vase & material sample board |
| `17_persona_executive_study` | `desk_flat` | Walnut home study, library bookcase, brass dome lamp & leather notebook |
| `18_detail_chalk_gallery` | `desk_flat` | Frameless chalk-plaster architectural gallery (`#FFFFFF` sky, `f/56.0` `detail_grid_3x3`) |

## CLI Quickstart (Manifest-Locked Production)

```bash
# Canonical full SKU bundle (exports STLs, validates VAL-01..14, renders QA + packshots + 3x3 chalk grid)
node tools/produce_sku_bundle.mjs --city paris_true_scale --format single --mode full

# Manifest-locked studio stills with automatic catalog framing (--frame auto)
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 01_architect_window_desk \
  --frame auto \
  --mode stills \
  --samples 64 \
  --out ./renders/paris_desk

# 3x3 chalk detail gallery mosaic (f/56.0 minimal lens blur, stitches details_3x3_grid.png)
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 18_detail_chalk_gallery \
  --frame none \
  --preset detail_grid_3x3 \
  --fstop 56.0 \
  --focus-xy 0,0 \
  --aspect 1:1 \
  --samples 48 \
  --out ./renders/paris_detail_3x3

# Gate 3 Seam-Truth QA renders (auto-hides frames and backing slabs cleanly)
python3 studio_blender/render_studio.py \
  --manifest exports/paris_true_scale_a4_120x170_1x3/assembly_manifest.json \
  --env 11_packshot_white \
  --frame none \
  --preset qa_seam_raking \
  --preset qa_top_down_grid \
  --preset qa_underside \
  --aspect 1:1 \
  --samples 24 \
  --out ./renders/paris_qa

# Inspect catalogs
python3 studio_blender/render_studio.py --list-presets --json
python3 studio_blender/render_studio.py --list-props --json
```

## MCP Server (`studio-blender`)

Exposes 5 tools over stdio JSON-RPC 2.0 (supporting `manifest_path`, `frame: "auto"`, `fstop`, `focus_xy`, and `detail_grid_3x3`):
- `list_studio_presets`
- `list_studio_props`
- `render_city_stills`
- `render_flow_keyframes`
- `render_commercial_video`

Registered in `/Users/krystianblaszczyk/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "studio-blender": {
      "command": "python3",
      "args": [
        "/Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/studio_blender/mcp_server.py"
      ]
    }
  }
}
```
