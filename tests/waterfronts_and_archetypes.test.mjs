import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
const { computeFootprintOBB, resolveGroundZ } = require(path.join(ROOT, 'src/mesh/waterfront_piers_solver.js'));
const { buildWindTurbineManifold, buildObservationWheelManifold, buildTowerOrIndustrialManifold } = require(path.join(ROOT, 'src/mesh/lattice_and_structures_solver.js'));
const { loadSceneAndBuildModel } = require(path.join(ROOT, 'tools/headless_scene_harness.js'));

let passed = 0;
let failed = 0;

function check(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS: ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeState(overrides = {}) {
  return {
    targetWidthCm: 28,
    targetHeightCm: 28,
    bedSizeMm: 280,
    totalHeightMm: 280,
    bedZ: 165,
    tileCols: 1,
    tileRows: 1,
    kerfMm: 0.08,
    isResin: true,
    xyPixelMm: 0.017,
    layerHeightMm: 0.05,
    hollowBase: false,
    waterCutout: false,
    showFrame: false,
    supportlessMode: false,
    cropRatio: 1.0,
    zScale: 1.0,
    terrainScale: 1.0,
    lodSettings: { enableTrees: false, treeMaxSpanKm: 5, minBuildingFootprintM: 0, roadDetail: 'all' },
    layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    elementVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    colors: { water: '#1e6e8c', base: '#f1efe8', greenery: '#5a944a', trees: '#3d7033', roads: '#7c7b77', buildings: '#fafaf6', highlighted: '#e65100' },
    ...overrides,
  };
}

function rectRing(cx, cy, hx, hy) {
  return [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
}

function latLonNodes(baseId, cLat, cLon, ptsMeters) {
  const cosLat = Math.cos((cLat * Math.PI) / 180.0);
  const nodes = [];
  for (let i = 0; i < ptsMeters.length; i++) {
    nodes.push({
      type: 'node',
      id: baseId + i,
      lat: cLat + ptsMeters[i][1] / 111320.0,
      lon: cLon + ptsMeters[i][0] / (111320.0 * cosLat),
    });
  }
  return nodes;
}

function trisInBoxCount(tris, minX, maxX, minY, maxY, minZ = -Infinity) {
  let cnt = 0;
  for (const t of tris) {
    const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
    const cy = (t.v0[1] + t.v1[1] + t.v2[1]) / 3;
    const cz = (t.v0[2] + t.v1[2] + t.v2[2]) / 3;
    if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY && cz >= minZ) cnt++;
  }
  return cnt;
}

function assertSliceConnectivity05mm(mf, man, scaleMm, label, startOffsetMm = 0.05) {
  const dz = 0.05 / scaleMm;
  const bb = man.boundingBox();
  let prevPolys = null;
  let islands = 0;
  let slices = 0;
  const z0 = bb.min[2] + startOffsetMm / scaleMm + dz * 0.5;
  const z1 = bb.max[2] - dz * 0.25;
  for (let z = z0; z <= z1; z += dz) {
    slices++;
    const cs = man.slice(z);
    const outers = cs.toPolygons().filter(r => r.length >= 3 && core.signedArea2D(r) > 1e-8);
    cs.delete();
    if (prevPolys) {
      for (const op of outers) {
        if (core.clipperIntersectPolys([op], prevPolys, 1e-6).length === 0) islands++;
      }
    }
    prevPolys = outers;
  }
  check(slices >= 20 && islands === 0, `${label}: 0 Z-islands across ${slices} resin 0.05 mm slices`, `islands=${islands}`);
}

function soupToManifold(mf, tris) {
  const pos = new Float32Array(tris.length * 9);
  const idx = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    const vs = [tris[i].v0, tris[i].v1, tris[i].v2];
    for (let k = 0; k < 3; k++) {
      const vi = i * 3 + k;
      pos[vi * 3] = vs[k][0];
      pos[vi * 3 + 1] = vs[k][1];
      pos[vi * 3 + 2] = vs[k][2];
      idx[vi] = vi;
    }
  }
  return core.manifoldFromRawSoup(mf, pos, idx, 1e-4);
}

async function run() {
  const mf = await core.ensureManifoldLibAsync();
  console.log('================================================================');
  console.log('   STAGE 5: WATERFRONTS, PIERS, RIVER SLOPES & ARCHETYPES SUITE');
  console.log('================================================================');

  // [1/6] Linear & Areal Piers + Anti-Capillary Hysteresis (gap == 0 vs >= 0.48mm)
  console.log('\n[1/6] Linear & Areal Piers + Anti-Capillary Hysteresis');
  {
    const cLat = 51.505, cLon = -0.115;
    const els = [];
    const addWay = (wid, pts, tags, closed = true) => {
      const ns = latLonNodes(wid * 100, cLat, cLon, pts);
      els.push(...ns);
      const nids = ns.map(n => n.id);
      if (closed) nids.push(nids[0]);
      els.push({ type: 'way', id: wid, nodes: nids, tags });
    };
    addWay(1000, [[-180, -180], [180, -180], [180, 180], [-180, 180]], { natural: 'water', water: 'river' }, true);
    addWay(1001, [[-120, -60], [-60, -60], [-60, -48]], { man_made: 'pier', min_height: '1.5' }, false);
    addWay(1002, [[20, -60], [65, -60], [65, -45], [20, -45]], { man_made: 'pier', area: 'yes', public_transport: 'platform', min_height: '1.5' }, true);
    addWay(1003, [[-60, 40], [-15, 40], [-15, 58], [-60, 58]], { building: 'roof', man_made: 'pier', public_transport: 'platform', min_height: '1.4' }, true);
    addWay(1004, [[30, 40], [75, 40], [75, 55], [30, 55]], { man_made: 'pontoon', area: 'yes', floating: 'yes' }, true);

    const built = await loadSceneAndBuildModel({
      title: 'PIERS_GIS',
      osmElements: els,
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: cLat, lon: cLon, spanMeters: 420,
      targetWidthCm: 28, targetHeightCm: 28,
      cropRatio: 1.0, waterCutout: false, hollowBase: false, wantTrees: false,
      isResin: true, zScale: 1.0, terrainScale: 1.0, silent: true,
    });
    const pm = built.printMetrics;
    check(pm.openEdgesCount === 0 && pm.nonManifoldEdgesCount === 0 && pm.sameDirDupEdgesCount === 0 && pm.floatingBuildingsCount === 0,
      'Linear+areal pier scene is strictly 2-manifold', `open=${pm.openEdgesCount} nm=${pm.nonManifoldEdgesCount} float=${pm.floatingBuildingsCount}`);
    check((pm.archetypeCounts.marinePiers || 0) >= 4, 'All 4 piers (linear + area + roof/platform + pontoon) preserved', JSON.stringify(pm.archetypeCounts));
    const audits = (built.audit && built.audit.pierAudits) || [];
    const areaAudits = audits.filter(a => a.isArea), linAudits = audits.filter(a => !a.isArea);
    const pontoonA = audits.find(a => a.isFloating || a.rawGapMm < 0.24);
    const elevatedA = audits.filter(a => a.rawGapMm >= 0.24);
    check(areaAudits.length >= 3 && linAudits.length >= 1, 'Pier solver processes both areal and linear piers', `area=${areaAudits.length}, linear=${linAudits.length}`);
    check(pontoonA && pontoonA.resolvedGapMm === 0 && !pontoonA.hasPiles, 'Anti-capillary hysteresis fuses <0.24mm gap pontoon to 0 solid', JSON.stringify(pontoonA));
    check(elevatedA.length >= 3 && elevatedA.every(a => a.resolvedGapMm >= 0.48 && a.hasPiles && a.pileDiameterMm >= SLA_PRINT_LAWS.minStrutDiameterMm(4.0)),
      'Elevated piers enforce >=0.48mm gap & MSLA piles >= minStrutDiameterMm', JSON.stringify(elevatedA.map(a => a.resolvedGapMm)));

    const cutScene = {
      center: [0, 0], bounds: { widthM: 280, heightM: 280 }, halfW: 60, halfH: 60, metersToUnits: 60 / 140,
      dem: { minElev: 0, maxElev: 0, gridSize: 4, grid: Array.from({ length: 4 }, () => Array(4).fill(0)) },
      waterPolys: [{ outer: rectRing(0, 0, 55, 55), holes: [] }], waterLines: [],
      greenery: [], roads: [], buildings: [], treePoints: [], treeRows: [], bridgePolys: [],
      pierPolys: [
        { outer: rectRing(-22, 0, 10, 4), holes: [], isPier: true, pierKind: 'pier', gapMm: 0.12 },
        { outer: rectRing(22, 0, 10, 4), holes: [], isPier: true, pierKind: 'pier', gapMm: 0.30 },
      ],
      pierLines: [], osmElements: [],
    };
    const cutBuilt = buildComplete3DModel(cutScene, makeState({ waterCutout: true }));
    const cutAud = cutBuilt.audit.pierAudits || [];
    check(cutAud[0]?.resolvedGapMm === 0 && cutAud[1]?.resolvedGapMm >= 0.48 && cutAud[1]?.hasPiles,
      'Direct waterCutout anti-capillary hysteresis snaps 0.12->0 and 0.30->0.48+ with piles', JSON.stringify(cutAud));
    const pileTrisAtZ0 = cutBuilt.meshes.roads.filter(t => {
      const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
      const mz = Math.min(t.v0[2], t.v1[2], t.v2[2]);
      return cx > 10 && cx < 34 && mz <= 0.01;
    }).length;
    check(pileTrisAtZ0 > 0 && cutBuilt.printMetrics.isWatertightManifold, 'Cutout pier piles anchor cleanly down to Z=0', `pileTrisZ0=${pileTrisAtZ0}`);
  }

  // [2/6] Waterfront Quays & Pedestrian Areas Preservation
  console.log('\n[2/6] man_made=quay & highway=pedestrian (area=yes) Preservation vs Water');
  {
    const ovChunkTxt = fs.readFileSync(path.join(ROOT, 'src/gis_client/overpass_chunk_grid.js'), 'utf8');
    check(ovChunkTxt.includes('quay') && ovChunkTxt.includes('area:highway'), 'OverpassQL query requests quay and area:highway');

    const cLat = 45.438, cLon = 12.335;
    const els = [];
    const addPoly = (wid, pts, tags) => {
      const ns = latLonNodes(wid * 100, cLat, cLon, pts);
      els.push(...ns);
      els.push({ type: 'way', id: wid, nodes: [...ns.map(n => n.id), ns[0].id], tags });
    };
    addPoly(2000, [[-160, -160], [160, -160], [160, 160], [-160, 160]], { natural: 'water', water: 'canal' });
    addPoly(2001, [[-90, -40], [-30, -40], [-30, 40], [-90, 40]], { man_made: 'quay' });
    addPoly(2002, [[20, -45], [90, -45], [90, 45], [20, 45]], { highway: 'pedestrian', area: 'yes' });
    addPoly(2003, [[-25, 65], [25, 65], [25, 110], [-25, 110]], { 'area:highway': 'pedestrian' });

    const built = await loadSceneAndBuildModel({
      title: 'QUAY_FONDAMENTA',
      osmElements: els,
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: cLat, lon: cLon, spanMeters: 360,
      targetWidthCm: 28, targetHeightCm: 28,
      cropRatio: 1.0, waterCutout: false, hollowBase: false, wantTrees: false,
      isResin: true, zScale: 1.0, terrainScale: 1.0, silent: true,
    });
    const pm = built.printMetrics;
    check(pm.isWatertightManifold && pm.openEdgesCount === 0 && pm.nonManifoldEdgesCount === 0,
      'Quay + pedestrian area waterfront model is watertight 2-manifold', `open=${pm.openEdgesCount} nm=${pm.nonManifoldEdgesCount}`);
    const wfCnt = built.audit?.baseInfo?.protectedWaterfrontCount || 0;
    check(wfCnt >= 3, 'Protected waterfront structures tracked in baseInfo', `count=${wfCnt}`);
    const roadTrisQuay = trisInBoxCount(built.meshes.roads, -28, -16, -10, 10, 0.5);
    const roadTrisPed = trisInBoxCount(built.meshes.roads, 14, 30, -10, 10, 0.5);
    const waterInQuay = trisInBoxCount(built.meshes.water, -28, -16, -10, 10, -Infinity);
    const waterInPed = trisInBoxCount(built.meshes.water, 14, 30, -10, 10, -Infinity);
    check(roadTrisQuay > 0 && roadTrisPed > 0 && waterInQuay === 0 && waterInPed === 0,
      'Quay and pedestrian area=yes remain intact and un-eaten by water subtraction',
      `quayRoads=${roadTrisQuay} pedRoads=${roadTrisPed} waterInQuay=${waterInQuay} waterInPed=${waterInPed}`);
  }

  // [3/6] Mountain River Segment-by-Segment Monotonic Slope Z Profiling
  console.log('\n[3/6] Monotonic Mountain River Segment Profiling');
  {
    const rows = 9, cols = 9;
    const grid = Array.from({ length: rows }, (_, r) => {
      const elev = 20 + (1 - r / (rows - 1)) * 100.0; // South (r=0) = 120m -> North (r=8) = 20m
      return Array(cols).fill(elev);
    });
    const scene = {
      center: [0, 0], bounds: { widthM: 320, heightM: 320 }, halfW: 60, halfH: 60, metersToUnits: 60 / 160,
      dem: { minElev: 20, maxElev: 120, gridSize: rows, grid },
      waterPolys: [],
      waterLines: [{ pts: [[0, -52], [0, -26], [0, 0], [0, 26], [0, 52]], width: 4.5, waterway: 'river' }],
      greenery: [], roads: [], buildings: [], treePoints: [], treeRows: [], bridgePolys: [],
    };
    const built = buildComplete3DModel(scene, makeState({ waterCutout: false }));
    const pm = built.printMetrics;
    check(pm.isWatertightManifold && (built.audit.baseInfo.slopedRiverSegments || 0) >= 3,
      'Mountain river scene watertight with >= 3 sloped river segments', `segs=${built.audit.baseInfo.slopedRiverSegments}`);
    const stationsY = [-42, -21, 0, 21, 42];
    const stationWaterZ = stationsY.map(sy => {
      let maxZ = -Infinity;
      for (const t of built.meshes.water) {
        const [a, b, c] = [t.v0, t.v1, t.v2];
        const denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(denom) < 1e-10) continue;
        const w1 = ((b[1] - c[1]) * (0 - c[0]) + (c[0] - b[0]) * (sy - c[1])) / denom;
        const w2 = ((c[1] - a[1]) * (0 - c[0]) + (a[0] - c[0]) * (sy - c[1])) / denom;
        const w3 = 1 - w1 - w2;
        if (w1 >= -1e-4 && w2 >= -1e-4 && w3 >= -1e-4) {
          maxZ = Math.max(maxZ, w1 * a[2] + w2 * b[2] + w3 * c[2]);
        }
      }
      return maxZ;
    });
    const strictlyDescending = stationWaterZ.every((z, i) => Number.isFinite(z) && (i === 0 || z < stationWaterZ[i - 1] - 0.1));
    check(strictlyDescending && (stationWaterZ[0] - stationWaterZ[4]) > 2.0,
      'River channel surface Z drops monotonically downstream along slope', `z=${stationWaterZ.map(v => v.toFixed(2)).join(' > ')}`);
  }

  // [4/6] Parametric Lattice Truss (S3DB building:part + standalone tower)
  console.log('\n[4/6] Parametric Lattice Truss (S3DB Part + Standalone Tower)');
  {
    const scene = {
      center: [0, 0], bounds: { widthM: 320, heightM: 320 }, halfW: 60, halfH: 60, metersToUnits: 60 / 160,
      dem: { minElev: 0, maxElev: 0, gridSize: 4, grid: Array.from({ length: 4 }, () => Array(4).fill(0)) },
      waterPolys: [], waterLines: [], greenery: [], roads: [], treePoints: [], treeRows: [], bridgePolys: [], osmElements: [],
      buildings: [
        { id: 1, osmId: 9001, groupId: 9001, outer: rectRing(-20, 0, 7, 7), holes: [], minH: 0, h: 10, roof: 'flat', part: true },
        { id: 2, osmId: 9002, groupId: 9001, outer: rectRing(-20, 0, 6.5, 6.5), holes: [], minH: 10, h: 55, roof: 'skillion', roofDir: 45, part: true, towerConstruction: 'lattice' },
        { id: 3, osmId: 9003, groupId: 9001, outer: rectRing(-20, 0, 3.8, 3.8), holes: [], minH: 55, h: 61, roof: 'flat', part: true },
        { id: 4, osmId: 9010, groupId: 9010, outer: [[18, -5], [28, -5], [23, 6]], holes: [], minH: 0, h: 80, roof: 'flat', btype: 'tower', tower: true, towerConstruction: 'lattice', tags: { man_made: 'tower', 'tower:construction': 'lattice', height: '80' } },
      ],
    };
    const built = buildComplete3DModel(scene, makeState());
    const pm = built.printMetrics;
    check(pm.isWatertightManifold && pm.floatingBuildingsCount === 0 && pm.archetypeCounts.latticeTowers === 2,
      'Parametric S3DB + standalone lattice towers build clean 2-manifold geometry',
      `lat=${pm.archetypeCounts.latticeTowers}, float=${pm.floatingBuildingsCount}, open=${pm.openEdgesCount}`);
    const s3dbTop = built.meshes.buildings.filter(t => (t.v0[0] + t.v1[0] + t.v2[0]) / 3 < 0);
    const maxLatticeZ = Math.max(...s3dbTop.flatMap(t => [t.v0[2], t.v1[2], t.v2[2]]));
    const standaloneTris = built.meshes.buildings.filter(t => (t.v0[0] + t.v1[0] + t.v2[0]) / 3 > 10);
    const saLo = standaloneTris.filter(t => t.v0[2] < 8 && t.v1[2] < 8 && t.v2[2] < 8).flatMap(t => [t.v0[0], t.v1[0], t.v2[0]]);
    const saHi = standaloneTris.filter(t => t.v0[2] > 22 && t.v1[2] > 22 && t.v2[2] > 22).flatMap(t => [t.v0[0], t.v1[0], t.v2[0]]);
    const spanLo = Math.max(...saLo) - Math.min(...saLo), spanHi = Math.max(...saHi) - Math.min(...saHi);
    check(maxLatticeZ > 15 && spanHi < spanLo * 0.75,
      'Lattice truss adapts height & tapers pyramidally from polygon corners', `maxZ=${maxLatticeZ.toFixed(2)}, spanLo=${spanLo.toFixed(2)}, spanHi=${spanHi.toFixed(2)}`);
  }

  // [5/6] Small Observation Wheel Height (35m NOT inflated to 115m)
  console.log('\n[5/6] Small Observation Wheel Height Fidelity (35m vs 115m)');
  {
    const baseScene = (hM, spanM) => ({
      center: [0, 0], bounds: { widthM: 320, heightM: 320 }, halfW: 60, halfH: 60, metersToUnits: 60 / 160,
      dem: { minElev: 0, maxElev: 0, gridSize: 4, grid: Array.from({ length: 4 }, () => Array(4).fill(0)) },
      waterPolys: [], waterLines: [], greenery: [], roads: [], treePoints: [], treeRows: [], bridgePolys: [], osmElements: [],
      buildings: [{
        id: 1, osmId: 8001, groupId: 8001,
        outer: rectRing(0, 0, spanM * 0.5 * (60 / 160), 2.0),
        holes: [], minH: 0, h: hM, roof: 'flat', archType: 'ferris_wheel', btype: 'observation_wheel',
        tags: { attraction: 'ferris_wheel', height: String(hM) }
      }],
    });
    const b35 = buildComplete3DModel(baseScene(35, 28), makeState());
    const b115 = buildComplete3DModel(baseScene(115, 95), makeState());
    const zMax35 = Math.max(...b35.meshes.buildings.flatMap(t => [t.v0[2], t.v1[2], t.v2[2]]));
    const zMax115 = Math.max(...b115.meshes.buildings.flatMap(t => [t.v0[2], t.v1[2], t.v2[2]]));
    const groundZ = 2.35 / (280 / 120);
    const h35U = zMax35 - groundZ, h115U = zMax115 - groundZ;
    check(b35.printMetrics.isWatertightManifold && b115.printMetrics.isWatertightManifold,
      '35m and 115m wheels build clean 2-manifolds');
    check(h35U / h115U < 0.45 && h35U < 17.5,
      '35m wheel retains ~35m scale rather than being clamped up to 115m',
      `h35U=${h35U.toFixed(2)}, h115U=${h115U.toFixed(2)}, ratio=${(h35U / h115U).toFixed(2)}`);
  }

  // [6/6] Direct 0.05 mm Z-Slice Connectivity (0 Z-islands in supportlessMode: true)
  console.log('\n[6/6] Z-Slice 0.05 mm Connectivity Invariant (supportlessMode: true)');
  {
    const ctx = core.createBuildContext({
      center: [0, 0], bounds: { widthM: 320, heightM: 320 },
      buildings: [], roads: [], waterPolys: [], waterLines: [],
      dem: { minElev: 10, maxElev: 10, gridSize: 2, grid: [[10, 10], [10, 10]] },
    }, makeState({ supportlessMode: true }));
    const tw = { isPointInWater: () => false, getSurfaceZ: (x, y) => ctx.getTerrainZ(x, y), getWaterFloorZ: () => ctx.zWaterCarveFloor, getWaterTopZ: () => ctx.zWaterTop };
    const utils = { computeFootprintOBB, resolveGroundZ };

    const turbMan = buildWindTurbineManifold(core, mf, ctx, tw, 0, 0, 75, 30, utils);
    const wheel35Man = buildObservationWheelManifold(core, mf, ctx, tw, rectRing(0, 0, 6, 1.5), 35, utils);
    const wheel80Man = buildObservationWheelManifold(core, mf, ctx, tw, rectRing(0, 0, 14, 2.2), 80, utils);
    const craneMan = buildTowerOrIndustrialManifold(core, mf, ctx, tw, rectRing(0, 0, 3, 3), 'crane', {}, 55, utils);

    assertSliceConnectivity05mm(mf, turbMan, ctx.scaleMm, 'Supportless Wind Turbine (direct)');
    assertSliceConnectivity05mm(mf, wheel35Man, ctx.scaleMm, 'Supportless Observation Wheel 35m (direct)');
    assertSliceConnectivity05mm(mf, wheel80Man, ctx.scaleMm, 'Supportless Observation Wheel 80m (direct)');
    assertSliceConnectivity05mm(mf, craneMan, ctx.scaleMm, 'Supportless Crane (direct)');
    turbMan.delete(); wheel35Man.delete(); wheel80Man.delete(); craneMan.delete();

    // End-to-end buildComplete3DModel verification -> slice final triangle soup!
    for (const [label, bld] of [
      ['Full-Pipeline Wind Turbine', { id: 1, osmId: 7001, groupId: 7001, outer: rectRing(0, 0, 2.5, 2.5), holes: [], minH: 0, h: 75, roof: 'flat', tags: { man_made: 'wind_turbine', height: '75' } }],
      ['Full-Pipeline Wheel', { id: 1, osmId: 7002, groupId: 7002, outer: rectRing(0, 0, 12, 2.0), holes: [], minH: 0, h: 65, roof: 'flat', archType: 'ferris_wheel', btype: 'observation_wheel', tags: { attraction: 'ferris_wheel', height: '65' } }],
      ['Full-Pipeline Crane', { id: 1, osmId: 7003, groupId: 7003, outer: rectRing(0, 0, 3, 3), holes: [], minH: 0, h: 55, roof: 'flat', tags: { man_made: 'crane', height: '55' } }],
    ]) {
      const sc = {
        center: [0, 0], bounds: { widthM: 320, heightM: 320 }, halfW: 60, halfH: 60, metersToUnits: 60 / 160,
        dem: { minElev: 10, maxElev: 10, gridSize: 4, grid: Array.from({ length: 4 }, () => Array(4).fill(10)) },
        waterPolys: [], waterLines: [], greenery: [], roads: [], treePoints: [], treeRows: [], bridgePolys: [], osmElements: [],
        buildings: [bld],
      };
      const built = buildComplete3DModel(sc, makeState({ supportlessMode: true }));
      check(built.printMetrics.isWatertightManifold && built.printMetrics.supportlessMode === true, `${label} full pipeline clean 2-manifold`);
      const rebuilt = soupToManifold(mf, built.meshes.buildings);
      assertSliceConnectivity05mm(mf, rebuilt, 280 / 120, `${label} (soup)`);
      rebuilt.delete();
    }
  }

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
  assert.equal(failed, 0, `${failed} Stage 5 waterfront/archetype tests failed`);
}

run().catch(err => {
  console.error('waterfronts_and_archetypes.test.mjs ERROR:', err);
  process.exit(1);
});
