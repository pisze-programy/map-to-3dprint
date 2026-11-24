# Studio Blender - Variant C 13x18 cm Photorealistic Render Harness & MCP Server

Architectural editorial render studio built on Blender Cycles (Apple Metal GPU + OpenImageDenoise + AgX) for any 3D city STL exported by `map-to-3dprint`.

## Product Truth (Variant C 13 x 18 cm)

- Frame: Ultra-thin `4.0 mm` neutral matte-black bezel (`#0A0A0C`, low-profile `7.5 mm` height, zero mirror glare).
- Backing: Deep matte/satin archival black (`#060608`, zero vanity mirror reflection).
- Nameplate: OFF by default (`--show-nameplate` is opt-in only).
- Mounting: Flat on desk (`desk_flat`) or flush wall-mount (`wall_mount`, `1.5 mm` shadow gap, zero stands).
- Multi-tile assembly: Pass 2 STLs (e.g. Tribeca + One WTC) with `--frame single_13x18` to stack seamlessly along Y with 100% shared X alignment inside `130 x 180 mm`. Also supports `triptych_3x1` and `quartet_2x2`.

## 11 Cohesive Studio Environments

| Env ID | Mount | Scene |
| :--- | :--- | :--- |
| `01_architect_window_desk` | `desk_flat` | Honed travertine desk, black-mullioned studio window daylight, steel ruler & architect pen |
| `02_creative_office_desk` | `desk_flat` | Matte dark walnut desk, window blinds light streaks, laptop corner, smartphone & espresso cup |
| `03_morning_coffee_table` | `desk_flat` | Warm travertine coffee table, soft morning sun, espresso cup & linen monograph |
| `04_minimal_home_console` | `desk_flat` | Brushed matte oak console against warm limewash wall, stoneware vessel & glass tumbler |
| `05_gallery_wall_sunlight` | `wall_mount` | Flush wall-mount on warm limewash wall with diagonal afternoon window-mullion sunbeam |
| `06_architect_slat_wall` | `wall_mount` | Flush wall-mount on acoustic oak-slat & matte charcoal feature wall with gallery spotlight |
| `07_evening_warm_desk` | `desk_flat` | Deep charcoal microcement desk at twilight, warm 2900K desk lamp vs cool dusk window |
| `08_loft_concrete_studio` | `desk_flat` | Poured concrete workbench, overcast skylight, steel ruler, monograph & stoneware mug |
| `09_dark_cinematic` | `desk_flat` | Honed dark volcanic basalt plinth, golden raking key & cool rim for commercial video cuts |
| `10_macro_editorial` | `desk_flat` | 90mm f/2.0 plaster-grain macro stage proving 10K MSLA print resolution |
| `11_packshot_white` | `desk_flat` | Pure `#FFFFFF` seamless e-commerce cyclorama + shadow-catcher, zero props |

Legacy aliases remain valid: `desk_daylight`, `leather_workspace`, `dark_cinematic`, `macro_editorial`, `packshot_white`.

## CLI Quickstart

```bash
# 2-tile Variant C 13x18 cm on architectural window desk (4:5, 96 samples)
python3 studio_blender/render_studio.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_Triptych_01_Top_Tribeca_145x79mm.stl \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --env 01_architect_window_desk \
  --frame single_13x18 \
  --mode stills \
  --samples 96 \
  --out ./renders/nyc_13x18

# Flush gallery wall mount
python3 studio_blender/render_studio.py \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_Triptych_01_Top_Tribeca_145x79mm.stl \
  --stl exports/nyc_wtc_145x79_1x1/Map3D_NYC_WTC_145x79mm.stl \
  --env 05_gallery_wall_sunlight \
  --frame single_13x18 \
  --mode stills \
  --out ./renders/nyc_wall

# Composable prop & lighting overrides
python3 studio_blender/render_studio.py \
  --stl calibration/Map3D_DUBAI_Pelna_Bryla_145x79mm.stl \
  --env 02_creative_office_desk \
  --remove-prop smartphone \
  --add-prop steel_ruler \
  --sun-azimuth 45 \
  --out ./renders/dubai_custom

# Inspect catalogs
python3 studio_blender/render_studio.py --list-presets
python3 studio_blender/render_studio.py --list-props
```

## MCP Server (`studio-blender`)

Exposes 5 tools over stdio JSON-RPC 2.0:
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
