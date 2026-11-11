#!/usr/bin/env python3
"""
Bundles Map3D Studio into index.html and the Antigravity artifact map3d_studio.html,
injecting the real OpenStreetMap + AWS Terrarium DEM initial dataset.
"""
import glob
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
ARTIFACT_PATH = os.environ.get("MAP3D_ARTIFACT_PATH", "")


def build():
    with open(os.path.join(ROOT, "src/template.html"), "r", encoding="utf-8") as f:
        tpl = f.read()
    with open(os.path.join(ROOT, "src/video/video_studio_view.html"), "r", encoding="utf-8") as f:
        video_view_html = f.read()
    tpl = tpl.replace("<!--__VIDEO_STUDIO_VIEW__-->", video_view_html)

    js_files = [
        # 1. 2D Geometry & Marching Squares
        "src/geometry/polygon_2d.js",
        "src/geometry/obb_medial_2d.js",
        "src/geometry/marching_squares_2d.js",
        # 2. 3D Mesh Generation, Architectural Roofs & 2-Manifold Topology
        "src/mesh/mesh_primitives.js",
        "src/mesh/mesh_clipper_3d.js",
        "src/mesh/roof_shapes.js",
        "src/mesh/roof_architectural.js",
        "src/mesh/terrain_dem_grid.js",
        "src/mesh/terrain_masks.js",
        "src/mesh/terrain_base_water.js",
        "src/mesh/features_roads_parks.js",
        "src/mesh/features_bridges.js",
        "src/mesh/buildings_prepare.js",
        "src/mesh/buildings_s3db.js",
        "src/mesh/mesh_topology.js",
        "src/mesh/mesh_builder.js",
        # 3. Studio WebGL Renderer & Shaders
        "src/render/webgl_math.js",
        "src/render/webgl_shaders.js",
        "src/render/webgl_studio.js",
        # 4. Binary .STL / .ZIP / .3MF Exporters
        "src/export/crc32_zip.js",
        "src/export/stl_writer.js",
        "src/export/zip_packager.js",
        "src/export/export_3mf.js",
        # 5. In-Browser Overpass + Terrarium DEM GIS Pipeline
        "src/gis_client/overpass_dem_fetch.js",
        "src/gis_client/s3db_client_matcher.js",
        "src/gis_client/osm_scene_builder.js",
        "src/gis_client/overpass_chunk_grid.js",
        "src/gis_client/gis_chunk_streamer.js",
        # 6. Modular UI Controllers
        "src/ui/ui_config.js",
        "src/ui/map_rotation.js",
        "src/ui/fast_render_manager.js",
        "src/ui/ui_map2d.js",
        "src/ui/ui_panels_layers.js",
        "src/ui/ui_panels_buildings.js",
        "src/ui/ui_viewport_search.js",
        "src/ui/ui_controls_bind.js",
        "src/ui/ui_url_hooks.js",
        # 7. Video Preview & Order Demo Studio
        "src/video/video_config.js",
        "src/video/video_math_mesh.js",
        "src/video/video_shaders.js",
        "src/video/video_shader_main_fs.js",
        "src/video/video_frame_builder.js",
        "src/video/video_timeline_2d.js",
        "src/video/video_recorder.js",
        "src/video/video_gl_engine.js",
        "src/video/ui_video_map_gis.js",
        "src/video/ui_video_order_demo.js",
        "src/video/ui_video_controls.js",
        "src/video/ui_video_studio.js",
        # 8. Main Application Bootstrap
        "src/ui/ui_app.js",
    ]
    js_bundle = []
    for jf in js_files:
        with open(os.path.join(ROOT, jf), "r", encoding="utf-8") as f:
            js_bundle.append(f.read())

    initial_scene_js = os.path.join(ROOT, "src/initial_scene.js")
    with open(initial_scene_js, "w", encoding="utf-8") as f:
        f.write(
            "// Initial scene: null by default (empty print bed until user renders or restores last session)\n"
            "const INITIAL_REAL_SCENE = null;\n"
        )

    boot_code = (
        "function boot() {\n"
        "  try {\n"
        "    initMap3DApp(INITIAL_REAL_SCENE);\n"
        "  } catch (e) {\n"
        "    console.error('Boot error:', e);\n"
        "    const b = document.getElementById('meshStatsBadge');\n"
        "    if (b) b.textContent = 'ERR: ' + (e && e.message ? e.message : String(e));\n"
        "  }\n"
        "}\n"
        "if (document.readyState === 'loading') {\n"
        "  window.addEventListener('DOMContentLoaded', boot);\n"
        "} else {\n"
        "  boot();\n"
        "}"
    )

    # Modular index.html loading each functional module cleanly
    script_tags = "\n".join(f'  <script src="{jf}"></script>' for jf in js_files + ["src/initial_scene.js"])
    modular_block = f"{script_tags}\n  <script>\n{boot_code}\n  </script>"
    modular_html = tpl.replace("  <script>\n/*__BUNDLE_SCRIPT__*/\n  </script>", modular_block)

    index_path = os.path.join(ROOT, "index.html")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(modular_html)

    # Standalone Video Preview & Order Demo Module Entry Point (video_studio.html)
    video_boot = "window.MAP3D_STANDALONE_VIDEO_MODULE = true;\n" + boot_code
    video_block = f"{script_tags}\n  <script>\n{video_boot}\n  </script>"
    video_html = tpl.replace("  <script>\n/*__BUNDLE_SCRIPT__*/\n  </script>", video_block)
    video_html = video_html.replace(
        "<title>Map3D Studio — Fotorealistyczny Konfigurator GIS & Eksporter .3MF / .STL</title>",
        "<title>Map3D Video Preview Studio — Generator Animacji 2D→3D & Demo Zamówienia w Ramce</title>",
    )
    video_path = os.path.join(ROOT, "video_studio.html")
    with open(video_path, "w", encoding="utf-8") as f:
        f.write(video_html)

    # Single-file standalone bundle for artifact preview if requested
    if ARTIFACT_PATH and os.path.isdir(os.path.dirname(ARTIFACT_PATH)):
        full_script = (
            "(function(){\n"
            + "\n".join(js_bundle)
            + "\nconst INITIAL_REAL_SCENE = null;\n"
            + boot_code
            + "\n})();"
        )
        bundled_html = tpl.replace("/*__BUNDLE_SCRIPT__*/", full_script)
        with open(ARTIFACT_PATH, "w", encoding="utf-8") as f:
            f.write(bundled_html)

    print(f"Built modular {index_path} ({len(modular_html.splitlines())} lines, {len(js_files)} JS modules).")


if __name__ == "__main__":
    build()
