#!/usr/bin/env python3
"""
Automated Verification Suite for Map3D Print Studio (Tasks 1-10, R1-R11, B05-B31).
Runs Headless Chrome against:
- tests/v3.html (6 benchmark scenes x 3 configs, 160x160 = 25,600 rays per run)
- tests/roofs.html (courtyard keyhole preservation & LoD2 pitched roof rate)
- Combined SLA Resin binary .STL ray-winding & UI/DOM checks (R6, R9, R10, R11, B16, B17, B24)
Writes full results to tests/audit_report.json.
"""
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import urllib.error

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)
import gis_pipeline  # noqa: E402

CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE_URL = "http://127.0.0.1:8765"

SCENES = [
    "scene_v4_48.1280_11.5769_48.1396_11.5941.json",
    "scene_v4_50.0488_19.9280_50.0598_19.9450.json",
    "scene_v4_52.2415_21.0050_52.2525_21.0220.json",
    "scene_v4_54.4381_18.5575_54.4511_18.5797.json",
    "scene_v4_1.2810_103.8487_1.2926_103.8603.json",
    "scene_v4_42.6352_18.1006_42.6468_18.1164.json",
]

CONFIGS = [
    {"tileCols": 1, "tileRows": 1, "hollowBase": False},
    {"tileCols": 1, "tileRows": 1, "hollowBase": True},
    {"tileCols": 2, "tileRows": 3, "hollowBase": True},
]


def run_chrome_dom(url, window_size="1440,900", budget_ms=30000):
    cmd = [
        CHROME_BIN,
        "--headless=new",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-gl=angle",
        f"--window-size={window_size}",
        f"--virtual-time-budget={budget_ms}",
        "--dump-dom",
        url,
    ]
    return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)


def check_http_status(path, method="GET"):
    req = urllib.request.Request(f"{BASE_URL}{path}", method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def run_stl_and_ui_checks():
    html = """<!DOCTYPE html><html><body><pre id="out">RUNNING</pre><script>
function getText(u){const x=new XMLHttpRequest();x.open('GET',u,false);x.send();return x.responseText;}
(0,eval)(getText('../src/mesh_builder.js'));
(0,eval)(getText('../src/exporters.js'));
const scene=JSON.parse(getText('../cache/scene_v4_48.1280_11.5769_48.1396_11.5941.json'));
const state={
  cropRatio:0.88,zScale:1.25,terrainScale:1.15,bedSizeMm:252,totalHeightMm:252,
  tileCols:2,tileRows:3,hollowBase:true,hollowWallMm:1.8,isResin:true,layerHeightMm:0.05,
  layerVisible:{water:true,base:true,greenery:true,roads:true,buildings:true,highlighted:true}
};
const res=buildComplete3DModel(scene,state);
state.layerMeshes=res.meshes;
state.printMetrics=res.printMetrics;
const stlBytes=buildBinarySTLBytes(state,'all',0);
const view=new DataView(stlBytes.buffer,stlBytes.byteOffset,stlBytes.byteLength);
const nTris=view.getUint32(80,true);
const tris=[];
let off=84;
for(let i=0;i<nTris;i++){
  const v0=[view.getFloat32(off+12,true),view.getFloat32(off+16,true),view.getFloat32(off+20,true)];
  const v1=[view.getFloat32(off+24,true),view.getFloat32(off+28,true),view.getFloat32(off+32,true)];
  const v2=[view.getFloat32(off+36,true),view.getFloat32(off+40,true),view.getFloat32(off+44,true)];
  tris.push({v0,v1,v2});
  off+=50;
}
// Ray winding check on exported binary .STL (Tile 0: 126 x 84 mm)
const RAYS=120;
let windingGt1=0,windingLt0=0,unbalanced=0;
for(let iy=0;iy<RAYS;iy++){
  const py=(iy+0.513)*84.0/RAYS;
  for(let ix=0;ix<RAYS;ix++){
    const px=(ix+0.529)*126.0/RAYS;
    const cr=[];
    for(let i=0;i<tris.length;i++){
      const t=tris[i],a=t.v0,b=t.v1,c=t.v2;
      const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
      if(Math.abs(d)<1e-12)continue;
      const l1=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/d;
      const l2=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/d;
      const l3=1-l1-l2;
      if(l1<0||l2<0||l3<0)continue;
      const z=l1*a[2]+l2*b[2]+l3*c[2];
      cr.push({z,s:d>0?1:-1});
    }
    cr.sort((p,q)=>p.z-q.z);
    let w=0,maxW=0,minW=0;
    for(const c of cr){
      w+=(c.s>0?-1:1);
      if(w>maxW)maxW=w;
      if(w<minW)minW=w;
    }
    if(maxW>1)windingGt1++;
    if(minW<0)windingLt0++;
    if(w!==0)unbalanced++;
  }
}
document.getElementById('out').textContent='STL_JSON='+JSON.stringify({
  stlTriangles:nTris,
  raysChecked:RAYS*RAYS,
  windingGt1,
  windingLt0,
  unbalanced,
  printMetrics:res.printMetrics
});
</script></body></html>"""
    tmp_path = os.path.join(ROOT_DIR, "tests", "_tmp_stl_check.html")
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(html)
    try:
        dom = run_chrome_dom(f"{BASE_URL}/tests/_tmp_stl_check.html", budget_ms=15000)
        m = re.search(r'STL_JSON=(\{.*?\})</pre>', dom, re.S)
        return json.loads(m.group(1))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def main():
    print("1. Running tests/v3.html across 6 scenes x 3 configs (160x160 = 25,600 rays)...")
    v3_results = []
    for sc in SCENES:
        url = (
            f"{BASE_URL}/tests/v3.html?scenes={sc}"
            f"&configs={urllib.parse.quote(json.dumps(CONFIGS))}&rays=160"
        )
        dom = run_chrome_dom(url, budget_ms=25000)
        m = re.search(r'<pre id="out">RESULT_JSON=(\[.*?\])</pre>', dom, re.S)
        if not m:
            raise RuntimeError(f"v3.html failed on {sc}")
        sc_res = json.loads(m.group(1))
        v3_results.extend(sc_res)
        for r in sc_res:
            open_e = sum(v["openEdges"] for v in r["layers"].values())
            nm_e = sum(v["nonManifoldEdges"] for v in r["layers"].values())
            neg_w = sum(v["negative"] for v in r["ray"].values())
            self_ov = sum(v["selfOverlap"] for v in r["ray"].values())
            green_pct = round(100.0 * r["ray"]["greenery"]["rays"] / (160 * 160), 1)
            ov = {k: v["rays"] for k, v in r["layerOverlap"].items()}
            c = r["cfg"]
            cfg_str = f"{c['tileCols']}x{c['tileRows']}_{'hollow' if c['hollowBase'] else 'solid'}"
            cav = r["extra"]["cavity"]["rays"]
            bf = r["floating"]["floatingGt005mm"]
            rf = r["extra"]["roadFloat"]["floatingGt005mm"]
            tf = r["extra"]["treeFloat"]["floatingGt005mm"]
            print(
                f"  {r['scene'][:22]:22s} | {cfg_str:10s} | open={open_e} nm={nm_e} "
                f"negW={neg_w} selfOv={self_ov} | green={green_pct}% | cav={cav} | "
                f"bldFloat={bf} rdFloat={rf} trFloat={tf} | ov={ov}"
            )

    print("\n2. Running tests/roofs.html across 6 scenes...")
    url_roofs = f"{BASE_URL}/tests/roofs.html?scenes={','.join(SCENES)}"
    dom_roofs = run_chrome_dom(url_roofs, budget_ms=20000)
    mr = re.search(r'<pre id="out">RESULT_JSON=(\[.*?\])</pre>', dom_roofs, re.S)
    if not mr:
        raise RuntimeError("roofs.html failed")
    roofs_results = json.loads(mr.group(1))
    for r in roofs_results:
        print(f"  ROOFS {r['scene'][:22]:22s} | holesInData={r['buildingsWithHolesInData']} | {r['counters']}")

    print("\n3. Running Combined SLA Resin .STL Winding Check (Task 10 / R6) & Security/UI Checks...")
    stl_check = run_stl_and_ui_checks()
    print(
        f"  Combined SLA .STL (Tile 0): tris={stl_check['stlTriangles']}, "
        f"rays={stl_check['raysChecked']}, windingGt1={stl_check['windingGt1']}, "
        f"windingLt0={stl_check['windingLt0']}, unbalanced={stl_check['unbalanced']}"
    )

    dom_main = run_chrome_dom(f"{BASE_URL}/index.html", window_size="1440,900", budget_ms=8000)
    dom_mob = run_chrome_dom(f"{BASE_URL}/index.html", window_size="414,896", budget_ms=8000)

    security_checks = {
        "get_git_config": check_http_status("/.git/config", "GET"),
        "head_git_config": check_http_status("/.git/config", "HEAD"),
        "get_server_py": check_http_status("/server.py", "GET"),
        "head_server_py": check_http_status("/server.py", "HEAD"),
        "corrupted_heidelberg_rejected": not gis_pipeline.validate_processed_scene(
            {"buildings": [{}] * 88, "roads": [{}] * 4, "greenPolys": [], "trees": []}
        ),
    }
    print("  Security & Cache Validation:", security_checks)

    report = {
        "v3": v3_results,
        "roofs": roofs_results,
        "combined_sla_stl": stl_check,
        "security_and_cache": security_checks,
        "ui_loaded": "Manifold ✓ (0/0 kraw.) • 0 lewitujących" in dom_main and "4 kanały drenażowe SLA" in dom_mob,
    }
    out_path = os.path.join(ROOT_DIR, "tests", "audit_report.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\nSaved complete verification report to {out_path}")


if __name__ == "__main__":
    main()
