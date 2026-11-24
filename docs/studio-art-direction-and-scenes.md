# Studio Art Direction and 17 Render Environments

Follow this unified visual standard across all product photos, packshots, and in-house Meta Ads videos.
The studio ships 17 environments and 26 real-scale props for direct city-swappable Cycles videos (replacing Veo).
Read `docs/blender-studio-workflow.md` for exact CLI commands and MCP tool parameters.

## 1. Unified Aesthetic Rules

Draw visual restraint from Architectural Digest, Dieter Rams, and Kinfolk editorial photography.

- **Variant C frame**: Use a matte jet-black `4.0 mm` bezel (`7.5 mm` height) in `13 x 18 cm` full-bleed format.
- **Archival backing**: Keep `backing_finish` set to `matte_black` so water cutouts absorb glare cleanly.
- **Zero nameplates**: Keep `--show-nameplate` OFF by default so architecture speaks without cheap text plaques.
- **Zero stands**: Place frames flat on desks (`desk_flat`) or mount flush on walls (`wall_mount`). Never tilt or add stands.
- **Real materials**: Use Poly Haven CC0 textures, props, and HDRIs (cached in gitignored `studio_blender/assets/`).
- **DSLR compositor finish**: Apply Blender DSLR Compositor grading (`studio_blender/envs/compositor.py`) on lifestyle and persona rooms.
- **Zero AI slop**: Never add logos on mugs, text on book spines, cramped smartphones, or plastic clutter.

## 2. Core 11 Environments (Verified v3)

| Environment ID | Mount | Surface and Room Style | Default Real-Scale Props | Set Fit |
| :--- | :--- | :--- | :--- | :--- |
| `01_architect_window_desk` | `desk_flat` | Pale ash-oak desk, black-mullioned window | `potted_plant`, `glass_tumbler`, `architect_pen` | `13x18`, `3x1` |
| `02_creative_office_desk` | `desk_flat` | Oiled American walnut desk, sunlit office | `desk_mat_laptop`, `espresso_cup`, `potted_plant` | `13x18` |
| `03_morning_coffee_table` | `desk_flat` | Honed Italian sandstone table, Milanese lounge | `monograph_stack`, `espresso_cup` | `13x18` |
| `04_minimal_home_console` | `desk_flat` | Brushed honey-oak console, boiserie wall | `ceramic_vessel`, `ceramic_vessel_low`, `potted_plant` | `13x18`, `3x1` |
| `05_gallery_wall_sunlight` | `wall_mount` | Milanese ivory boiserie wall + oak credenza | Built-in credenza styling (zero desk props) | `13x18`, `3x1`, `2x2` |
| `06_architect_slat_wall` | `wall_mount` | Copenhagen honey-oak slats + oak credenza | Built-in credenza styling (zero desk props) | `13x18`, `3x1`, `2x2` |
| `07_evening_warm_desk` | `desk_flat` | Oiled walnut penthouse, twilight golden bokeh | `desk_lamp_edge`, `leather_notebook`, `architect_pen`, `crystal_glass` | `13x18` |
| `08_loft_concrete_studio` | `desk_flat` | Scandinavian pale terrazzo loft desk | `monograph_stack`, `coffee_mug`, `potted_plant` | `13x18`, `3x1` |
| `09_dark_cinematic` | `desk_flat` | Honed volcanic basalt plinth (locked hero) | Zero props (golden key + cool rim) | `13x18`, `3x1`, `2x2` |
| `10_macro_editorial` | `desk_flat` | Dark-neutral macro backdrop (locked macro) | Zero props (`90 mm f/2.0` plaster grain) | `13x18`, `3x1`, `2x2` |
| `11_packshot_white` | `desk_flat` | Pure `#FFFFFF` cyclorama (locked packshot) | Zero props (shadow-catcher contact shadow) | `13x18`, `3x1`, `2x2` |

## 3. Customer Persona Environments (`12`..`17`, `desk_flat`)

Each persona room keeps wide orbital camera clearance for sweeping `kinder_video.py` commercial shots.

| Environment ID | Target Audience | Surface and Room Style | Default Real-Scale Props (Zero Text/Logos) |
| :--- | :--- | :--- | :--- |
| `12_persona_architect` | Architects and designers | Pale ash-oak studio desk, skyline window | `drafting_vellum_rolls`, `concrete_pencil_cup`, `basswood_maquette`, `desk_lamp_edge`, `architect_pen` |
| `13_persona_traveler` | Travelers and explorers | Oiled walnut desk, golden-hour window | `vintage_camera`, `travel_monograph_stack`, `brass_tabletop_globe`, `vintage_compass`, `potted_plant` |
| `14_persona_lawyer` | Lawyers and advisors | Oiled mahogany study, dark shelves | `law_volumes_row`, `leather_desk_folio`, `gold_fountain_pen` |
| `15_persona_corporate` | Corporate executives | Smoked walnut high-rise glass office | `desk_mat_laptop`, `matte_black_mug`, `concrete_planter_plant` |
| `16_persona_realestate` | Real estate showrooms | Honed Calacatta Gold marble, tower view | `fluted_crystal_vase_greenery`, `material_sample_board` |
| `17_persona_executive_study` | Home office and design | Oiled walnut desk, dark built-in bookcase | `brass_dome_lamp`, `brass_arch_print_frame`, `leather_notebook` |

## 4. Recommended First Paid Meta and TikTok Ad (`15 s`, `9:16`)

Build the first `15 s` vertical campaign from four contrasting studio environments:

1. **Hook (`0-3 s`, `01_architect_window_desk`)**: Show the full `13 x 18 cm` framed city on sunlit ash-oak. Establish scale via tumbler, plant, and pen.
2. **Detail proof (`3-6 s`, `10_macro_editorial`)**: Cut to `90 mm f/2.0` macro over the hero spire. Prove tactile `10K` plaster-like print precision.
3. **Wall proof (`6-10 s`, `05_gallery_wall_sunlight`)**: Show the framed city mounted flush on a Milanese boiserie wall. Highlight deep 3D shadow relief.
4. **Close (`10-15 s`, `02_creative_office_desk` or `09_dark_cinematic`)**: Finish on a calm walnut desk scene or dark basalt reveal. Drive strong CTA recall.

## 5. Customizing Props per Ad Test

Agents swap scale props per A/B test without changing lighting or camera framing:

- Run `--list-props --json` (or MCP `list_studio_props`) to inspect all 26 catalog prop IDs and millimeter sizes.
- Pass `--remove-prop <id>` (or `--clear-props`) to strip default objects cleanly.
- Pass `--add-prop <id_or_glb_path@x,y,yaw,scale>` to place catalog or custom `.glb` props in millimeters.
- Use `add_props`, `remove_props`, and `clear_props` arrays when calling `studio-blender` MCP tools.
