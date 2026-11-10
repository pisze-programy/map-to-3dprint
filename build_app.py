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

    js_files = [
        "src/geometry_2d.js",
        "src/mesh_extrude.js",
        "src/mesh_topology.js",
        "src/mesh_builder.js",
        "src/webgl_shaders_math.js",
        "src/webgl_studio.js",
        "src/export_stl_zip.js",
        "src/export_3mf.js",
        "src/ui_config.js",
        "src/ui_map2d.js",
        "src/ui_gis_client.js",
        "src/ui_panels.js",
        "src/ui_app.js",
    ]
    js_bundle = []
    for jf in js_files:
        with open(os.path.join(ROOT, jf), "r", encoding="utf-8") as f:
            js_bundle.append(f.read())

    scene_file = os.path.join(ROOT, "cache/scene_v4_48.1280_11.5769_48.1396_11.5941.json")
    if not os.path.exists(scene_file):
        scene_file = os.path.join(ROOT, "cache/scene_v3_48.1280_11.5769_48.1396_11.5941.json")
    with open(scene_file, "r", encoding="utf-8") as f:
        scene_json = f.read()

    initial_scene_js = os.path.join(ROOT, "src/initial_scene.js")
    with open(initial_scene_js, "w", encoding="utf-8") as f:
        f.write(
            "// Auto-generated initial real GIS scene (Munich Isar & Deutsches Museum)\n"
            f"const INITIAL_REAL_SCENE = {scene_json};\n"
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

    # Single-file standalone bundle for artifact preview if requested
    if ARTIFACT_PATH and os.path.isdir(os.path.dirname(ARTIFACT_PATH)):
        full_script = (
            "(function(){\n"
            + "\n".join(js_bundle)
            + f"\nconst INITIAL_REAL_SCENE = {scene_json};\n"
            + boot_code
            + "\n})();"
        )
        bundled_html = tpl.replace("/*__BUNDLE_SCRIPT__*/", full_script)
        with open(ARTIFACT_PATH, "w", encoding="utf-8") as f:
            f.write(bundled_html)

    print(f"Built modular {index_path} ({len(modular_html.splitlines())} lines, {len(js_files)} JS modules).")


if __name__ == "__main__":
    build()
