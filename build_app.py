#!/usr/bin/env python3
"""
Bundles Map3D Studio into index.html and the Antigravity artifact map3d_studio.html,
injecting the real OpenStreetMap + AWS Terrarium DEM initial dataset.
"""
import glob
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
ARTIFACT_PATH = os.environ.get(
    "MAP3D_ARTIFACT_PATH",
    "/Users/krystianblaszczyk/.gemini/antigravity/brain/3ca72a24-3cdc-4841-a6f2-02585746d8a3/map3d_studio.html",
)


def build():
    with open(os.path.join(ROOT, "src/template.html"), "r", encoding="utf-8") as f:
        tpl = f.read()

    js_files = [
        "src/mesh_builder.js",
        "src/webgl_studio.js",
        "src/exporters.js",
        "src/ui_app.js",
    ]
    js_bundle = []
    for jf in js_files:
        with open(os.path.join(ROOT, jf), "r", encoding="utf-8") as f:
            js_bundle.append(f.read())

    scene_file = os.path.join(ROOT, "cache/scene_v3_48.1280_11.5769_48.1396_11.5941.json")
    with open(scene_file, "r", encoding="utf-8") as f:
        scene_json = f.read()

    full_script = (
        "(function(){\n"
        + "\n".join(js_bundle)
        + f"\nconst INITIAL_REAL_SCENE = {scene_json};\n"
        + "function boot() {\n"
        + "  try {\n"
        + "    initMap3DApp(INITIAL_REAL_SCENE);\n"
        + "  } catch (e) {\n"
        + "    console.error('Boot error:', e);\n"
        + "    const b = document.getElementById('meshStatsBadge');\n"
        + "    if (b) b.textContent = 'ERR: ' + (e && e.message ? e.message : String(e));\n"
        + "  }\n"
        + "}\n"
        + "if (document.readyState === 'loading') {\n"
        + "  window.addEventListener('DOMContentLoaded', boot);\n"
        + "} else {\n"
        + "  boot();\n"
        + "}\n"
        + "})();"
    )

    out_html = tpl.replace("/*__BUNDLE_SCRIPT__*/", full_script)

    index_path = os.path.join(ROOT, "index.html")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(out_html)
    if os.path.isdir(os.path.dirname(ARTIFACT_PATH)):
        with open(ARTIFACT_PATH, "w", encoding="utf-8") as f:
            f.write(out_html)

    print(f"Built {index_path} ({len(out_html) // 1024} KB).")


if __name__ == "__main__":
    build()
