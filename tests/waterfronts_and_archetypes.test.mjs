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
    const { buildAdaptiveOverpassQL } = require(path.join(ROOT, 'src/gis_client/overpass_chunk_grid.js'));
    const ovSampleQl = buildAdaptiveOverpassQL(45.43, 12.33, 45.44, 12.34, 'urban', 20);
    check(ovSampleQl.includes('quay') && ovSampleQl.includes('area:highway'), 'OverpassQL query requests quay and area:highway');

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

    // Building-mounted micro VAWT wind generator nodes (min_height > 0, vertical_axis, rotor:diameter < 12m)
    // must NOT be inflated into freestanding ground-mast utility wind turbines.
    {
      const scMicro = {
        center: [48.858, 2.294], bbox: [48.856, 2.291, 48.860, 2.297],
        bounds: { widthM: 320, heightM: 320 }, halfW: 60, halfH: 60, metersToUnits: 60 / 160,
        dem: { minElev: 30, maxElev: 30, gridSize: 4, grid: Array.from({ length: 4 }, () => Array(4).fill(30)) },
        waterPolys: [], waterLines: [], greenery: [], roads: [], treePoints: [], treeRows: [], bridgePolys: [],
        buildings: [],
        osmElements: [
          {
            type: 'node', id: 990001, lat: 48.858, lon: 2.294,
            tags: {
              power: 'generator',
              'generator:source': 'wind',
              'generator:type': 'vertical_axis',
              height: '134',
              min_height: '127',
              level: '2',
              'rotor:diameter': '3.2',
            },
          },
        ],
      };
      const builtMicro = buildComplete3DModel(scMicro, makeState({ supportlessMode: false }));
      check(
        builtMicro.meshes.buildings.length === 0,
        'Elevated vertical-axis micro wind generator is skipped instead of emitting ground mast + giant blades',
        `buildingTris=${builtMicro.meshes.buildings.length}`
      );
    }
  }

  // [7/7] Pier/Island Rotation Invariance (±42°), Marina Pier Z-Height, Waterfront Building Datum, 3D Picking & Video Prism
  console.log('\n[7/7] Pier/Island Rotation (±42°), Marina Z-Height, Waterfront Datum, 3D Picking & Video Frame');
  {
    const { applySceneRotation } = require(path.join(ROOT, 'src/ui/map_rotation.js'));
    const { fastSwapHighlightedBuildings } = require(path.join(ROOT, 'src/ui/fast_render_manager.js'));
    const { buildVideoProductFrameBuffers } = require(path.join(ROOT, 'src/video/video_frame_builder.js'));

    // 7a. Linear floating piers (pierLines) + areal piers (pierPolys) + _openSeaIslands rotate identically with buildings at ±42°
    const rotScene = {
      center: [25.0775, 55.1298], spanMeters: 3800, halfW: 84.6, halfH: 84.6, metersToUnits: 169.2 / 3800,
      _hasMarineTags: true,
      _openSeaIslands: [rectRing(20, -25, 18, 12)],
      dem: { minElev: 0, maxElev: 4, gridSize: 8, grid: Array.from({ length: 8 }, () => Array(8).fill(2.0)) },
      waterPolys: [], waterLines: [], greenPolys: [], trees: [],
      roads: [{ pts: [[12, -25], [28, -25]], width: 0.5, hwy: 'residential' }],
      roadPolys: [],
      bridgePolys: [{ outer: rectRing(20, -8, 4, 1.5), holes: [], isPier: true, isPierLine: true, pierKind: 'pier', floating: true, osmId: 5001 }],
      pierLines: [
        { pts: [[16, -8], [24, -8]], width: 0.45, pierKind: 'pier', floating: true, layer: 0, osmId: 5001, tags: { man_made: 'pier', floating: 'yes' } },
        { pts: [[20, -13], [20, -4]], width: 0.40, pierKind: 'pier', floating: false, layer: 0, osmId: 5002, tags: { man_made: 'pier' } },
      ],
      pierPolys: [
        { outer: rectRing(28, -10, 2.2, 1.2), holes: [], isPier: true, pierKind: 'pontoon', floating: true, osmId: 5003 }
      ],
      bridgeSupports: [],
      buildings: [
        { id: 1, osmId: 6001, cx: 20, cy: -22, outer: rectRing(20, -22, 2.5, 2.5), holes: [], h: 9, minH: 0, roof: 'flat', highlighted: false },
        { id: 2, osmId: 6002, cx: 20, cy: -13.2, outer: rectRing(20, -13.2, 2.0, 1.5), holes: [], h: 8, minH: 0, roof: 'flat', highlighted: false }
      ],
      osmElements: []
    };

    const distPierToBld = (sc) => {
      const pmx = (sc.pierLines[0].pts[0][0] + sc.pierLines[0].pts[1][0]) * 0.5;
      const pmy = (sc.pierLines[0].pts[0][1] + sc.pierLines[0].pts[1][1]) * 0.5;
      const b = sc.buildings[0];
      return Math.hypot(pmx - b.cx, pmy - b.cy);
    };
    const d0 = distPierToBld(rotScene);
    applySceneRotation(rotScene, 42, 84.6, 84.6);
    const dPos42 = distPierToBld(rotScene);
    applySceneRotation(rotScene, -42, 84.6, 84.6);
    const dNeg42 = distPierToBld(rotScene);
    check(Math.abs(dPos42 - d0) < 0.05 && Math.abs(dNeg42 - d0) < 0.05,
      'pierLines rotate rigidly with shoreline buildings at +42° and -42° (0 angular drift)',
      `d0=${d0.toFixed(3)}, d+42=${dPos42.toFixed(3)}, d-42=${dNeg42.toFixed(3)}`);

    const rotState = makeState({ bedSizeMm: 150, totalHeightMm: 150, targetWidthCm: 15, targetHeightCm: 15, waterCutout: true, mapRotationDeg: -42 });
    const rotBuilt = buildComplete3DModel(rotScene, rotState);
    const rpm = rotBuilt.printMetrics;
    check(rpm.isWatertightManifold && rpm.openEdgesCount === 0 && rpm.nonManifoldEdgesCount === 0 && rpm.floatingBuildingsCount === 0,
      'Rotated -42° open-sea island + floating/pile piers + waterfront villa model is 100% 2-manifold (0 float)',
      `open=${rpm.openEdgesCount}, nm=${rpm.nonManifoldEdgesCount}, float=${rpm.floatingBuildingsCount}`);

    const scaleMm150 = 150 / 169.2;
    const pAudits = rotBuilt.audit.pierAudits || [];
    const floatAudit = pAudits.find(a => a.osmId === 5001);
    const marinaPileAudit = pAudits.find(a => a.osmId === 5002);
    check(floatAudit && floatAudit.deckTopZ * scaleMm150 >= 2.0,
      'Floating pier/pontoon in waterCutout=true rises to nominal waterline height (>=2.0 mm, never collapsed to 0.65 mm)',
      `topMm=${(floatAudit ? floatAudit.deckTopZ * scaleMm150 : 0).toFixed(2)}`);
    check(marinaPileAudit && marinaPileAudit.hasPiles && marinaPileAudit.resolvedGapMm >= 0.48 && marinaPileAudit.deckTopZ * scaleMm150 >= 2.5,
      'Regional-scale standard man_made=pier retains MSLA Z=0 piles & quay-level deck (>=2.5 mm)',
      JSON.stringify(marinaPileAudit));

    // 7b. Waterfront low-rise villa (8m) grazing waterCutout keeps zBase=0 AND roof proud above 2.35mm land datum
    const wfVillaBounds = rotBuilt.buildingBounds.find(bb => bb.id === 2);
    check(wfVillaBounds && wfVillaBounds.minZ <= 0.01 && wfVillaBounds.maxZ * scaleMm150 > 2.45,
      'Waterfront 8m building grazing waterCutout anchors at Z=0 while roof rises above 2.35 mm land slab',
      `minZMm=${(wfVillaBounds.minZ * scaleMm150).toFixed(2)}, maxZMm=${(wfVillaBounds.maxZ * scaleMm150).toFixed(2)}`);

    // 7c. 3D picking metadata & fastSwapHighlightedBuildings
    check(rotBuilt.buildingBounds.every(bb => bb.pickId > 0 && bb.layerId === 4 && bb.building && bb.building._pickId === bb.pickId),
      'All buildingBounds populate pickId, layerId, and building._pickId for 3D raycast & highlight swap');
    rotScene.buildings[0].highlighted = true;
    const uiState = { ...rotState, sceneData: rotScene, layerMeshes: rotBuilt.meshes, buildingBounds: rotBuilt.buildingBounds, pickIdMap: rotBuilt.pickIdMap };
    const swapped = fastSwapHighlightedBuildings(uiState);
    check(swapped && uiState.layerMeshes.highlighted.length > 0, 'fastSwapHighlightedBuildings swaps highlighted building triangles cleanly', `hlTris=${uiState.layerMeshes.highlighted.length}`);

    // 7d. Video Studio frame builder works without legacy extrudeBuildingLoD2
    const vFrame = buildVideoProductFrameBuffers({ halfW: 84.6, halfH: 84.6, matStyle: 'gallery_white', frameStyle: 'black', showPlaque: true, showGlass: true, waterCutout: true }, true);
    check(vFrame.frameTris.length >= 48 && vFrame.backingTris.length >= 12 && vFrame.matTris.length >= 48,
      'Video Studio buildVideoProductFrameBuffers emits closed frame/backing/mat prisms cleanly',
      `frame=${vFrame.frameTris.length}, backing=${vFrame.backingTris.length}, mat=${vFrame.matTris.length}`);
  }

  // ==========================================================================
  // [8] Palm Jumeirah / Logo Island / Crescent / Emaar Regression Suite
  // ==========================================================================
  console.log('\n[8] Palm Jumeirah, Logo Island, C-Shaped Crescent & Overpass Resilience Regressions');
  {
    const { buildAdaptiveOverpassQL, buildSpatialChunkGrid } = require(path.join(ROOT, 'src/gis_client/overpass_chunk_grid.js'));
    const { stitchCoastlineSeaPolysJS } = require(path.join(ROOT, 'src/gis_client/overpass_dem_fetch.js'));
    const { createS3DBClientCollector } = require(path.join(ROOT, 'src/gis_client/s3db_client_matcher.js'));
    const { buildLayer1TerrainAndWater } = require(path.join(ROOT, 'src/mesh/layer1_terrain_water.js'));
    const { applySceneRotation } = require(path.join(ROOT, 'src/ui/map_rotation.js'));

    // 8a. Overpass QL excludes continental natural=bay|peninsula and includes unclipped place=island|islet across all tiers
    for (const tier of ['detail', 'urban', 'regional', 'mountain']) {
      const ql = buildAdaptiveOverpassQL(25.09, 55.10, 25.14, 55.16, tier, 20, { wantTrees: false, minBuildingFootprintM: 0 });
      check(
        ql.includes('natural!~') && ql.includes('bay') && ql.includes('peninsula') && ql.includes('way(r.isl)->.islw;'),
        `buildAdaptiveOverpassQL(${tier}) excludes continental bay/peninsula & fetches unclipped island ways`,
      );
    }
    const grid22 = buildSpatialChunkGrid(25.10, 55.12, 25.12, 55.14, 2200, { fetchSpanMeters: 2200 });
    check(grid22.rows === 2 && grid22.cols === 2, 'buildSpatialChunkGrid splits >1650m scenes into 2x2 sectors', `${grid22.rows}x${grid22.cols}`);

    // 8b. Open 3-of-4 CCW coastline island chain (Logo Island missing 1 segment) closes into dry island
    const openLogoChain = [[-18, -12], [18, -12], [18, 8], [-12, 12]]; // CCW open chain missing closing west segment
    const wpLogo = [];
    const metaLogo = {};
    stitchCoastlineSeaPolysJS([openLogoChain], 84.6, 84.6, wpLogo, metaLogo);
    check(
      Array.isArray(metaLogo.openSeaIslands) && metaLogo.openSeaIslands.length === 1,
      'stitchCoastlineSeaPolysJS closes open 3-of-4 CCW island coastline chain instead of dropping the island',
      `openSeaIslands=${(metaLogo.openSeaIslands || []).length}`
    );

    // 8c. C-shaped concave Crescent island hole (centroid outside polygon!) + _unrotatedLandRings across overlapping waterPolys
    const seaOuter = rectRing(0, 0, 75, 75);
    // C-shaped Crescent ring (CW hole or CCW island): vertex centroid sits in the central lagoon around (0, 12), OUTSIDE the C-ring!
    const cCrescent = [
      [-40, 10], [-40, 42], [40, 42], [40, 10],
      [30, 10], [30, 32], [-30, 32], [-30, 10]
    ];
    const unrotIslet = rectRing(22, -28, 7, 5);
    const cScene = {
      center: [25.12, 55.13], spanMeters: 5000, halfW: 84.6, halfH: 84.6, metersToUnits: 169.2 / 5000,
      dem: { minElev: 0, maxElev: 3, gridSize: 8, grid: Array.from({ length: 8 }, () => Array(8).fill(2.0)) },
      waterPolys: [
        { outer: seaOuter, holes: [cCrescent], _unrotatedLandRings: [unrotIslet], name: 'Morze' },
        { outer: rectRing(20, -25, 30, 25), holes: [], name: 'Nakładająca się Marina' }, // overlaps unrotIslet without hole!
      ],
      waterLines: [], greenPolys: [], trees: [], roads: [], roadPolys: [], bridgePolys: [], pierPolys: [], pierLines: [], bridgeSupports: [], buildings: [],
    };
    applySceneRotation(cScene, -35, 84.6, 84.6);
    const cState = makeState({ waterCutout: true, mapRotationDeg: -35 });
    const cCtx = core.createBuildContext(cScene, cState, {});
    const cTw = buildLayer1TerrainAndWater(cCtx, cScene, {});
    const rad35 = (-35 * Math.PI) / 180;
    const rotPt35 = (x, y) => [x * Math.cos(rad35) - y * Math.sin(rad35), x * Math.sin(rad35) + y * Math.cos(rad35)];
    const crescentTopApex = rotPt35(0, 37);
    const lagoonCenter = rotPt35(0, 18);
    const rotIsletCenter = rotPt35(22, -28);
    check(
      !cTw.isPointInWater(crescentTopApex[0], crescentTopApex[1]) && cTw.isPointInWater(lagoonCenter[0], lagoonCenter[1]),
      'C-shaped Crescent island stays dry while its concave central lagoon stays water',
      `apexInWater=${cTw.isPointInWater(crescentTopApex[0], crescentTopApex[1])}, lagoonInWater=${cTw.isPointInWater(lagoonCenter[0], lagoonCenter[1])}`
    );
    check(
      !cTw.isPointInWater(rotIsletCenter[0], rotIsletCenter[1]),
      '_unrotatedLandRings survives rotation and overlapping marina waterPolys without flooding',
      `isletInWater=${cTw.isPointInWater(rotIsletCenter[0], rotIsletCenter[1])}`
    );

    // 8d. Emaar Beachfront Sunrise Bay podium (levels=6, h=18) with two elevated twin towers (min_height=18, h=102) keeps podium + both towers
    const colEmaar = createS3DBClientCollector(84.6, 84.6, 169.2 / 4200);
    colEmaar.registerCandidate(810426328, { building: 'apartments', 'building:levels': '6', height: '18', name: 'Sunrise Bay' }, rectRing(0, 0, 4.0, 2.5), [], false, null, false);
    colEmaar.registerCandidate(1077704746, { 'building:part': 'apartments', 'building:levels': '34', height: '102', min_height: '18' }, rectRing(-2.0, 0, 1.1, 1.1), [], true, null, false);
    colEmaar.registerCandidate(1077704747, { 'building:part': 'apartments', 'building:levels': '34', height: '102', min_height: '18' }, rectRing(2.0, 0, 1.1, 1.1), [], true, null, false);
    const emaarOut = colEmaar.resolveAndEmitS3DBBuildings();
    check(
      emaarOut.length === 3 && emaarOut.some(b => b.osmId === 810426328 && !b.part),
      'Emaar Beachfront Sunrise Bay podium + 2 twin tower parts emits all 3 records cleanly',
      `count=${emaarOut.length}`
    );

    // 8e. Asymmetric P-shaped marina-loop areal pier (long narrow walkway + looped yacht basin hole)
    //     places 0 stray piles in open water south of walkway or inside the central yacht-basin hole
    const pLoopOuter = [
      [-45, 9], [25, 9], [25, -25], [-5, -25], [-5, 7], [-45, 7]
    ];
    const pLoopHole = [
      [-1, 5], [-1, -21], [21, -21], [21, 5]
    ];
    const pLoopScene = {
      widthM: 1200, heightM: 1200, metersToUnits: 169.2 / 1200,
      centerLat: 54.447, centerLon: 18.574,
      elevGrid: { rows: 4, cols: 4, minElev: 0, maxElev: 1.5, values: new Float32Array(16).fill(1.2) },
      osmElements: [],
      waterPolys: [{ outer: rectRing(5, 0, 62, 62), holes: [] }],
      waterLines: [], greenPolys: [], trees: [], roads: [], roadPolys: [],
      bridgePolys: [{ osmId: 9101, isPier: true, isPierLine: false, pierKind: 'pier', outer: pLoopOuter, holes: [pLoopHole], tags: { man_made: 'pier', area: 'yes' } }],
      pierPolys: [{ osmId: 9101, isPier: true, pierKind: 'pier', _inBridgePolys: true, outer: pLoopOuter, holes: [pLoopHole], tags: { man_made: 'pier', area: 'yes' } }],
      pierLines: [], bridgeSupports: [], buildings: [],
    };
    const pLoopModel = buildComplete3DModel(pLoopScene, makeState({ waterCutout: true, targetWidthCm: 18, targetHeightCm: 18 }), {});
    let strayOpenSeaTris = 0, strayBasinHoleTris = 0, groundedPileVerts = 0;
    for (const tri of pLoopModel.meshes.roads) {
      for (const v of [tri.v0, tri.v1, tri.v2]) {
        if (v[2] <= 0.02) groundedPileVerts++;
      }
      const cx = (tri.v0[0] + tri.v1[0] + tri.v2[0]) / 3;
      const cy = (tri.v0[1] + tri.v1[1] + tri.v2[1]) / 3;
      if (cx > -42 && cx < -8 && cy < 4.5) strayOpenSeaTris++;
      if (cx > 1.5 && cx < 18.5 && cy > -18.5 && cy < 2.5) strayBasinHoleTris++;
    }
    check(
      groundedPileVerts > 0 && strayOpenSeaTris === 0 && strayBasinHoleTris === 0 &&
      pLoopModel.printMetrics.openEdgesCount === 0 && pLoopModel.printMetrics.nonManifoldEdgesCount === 0,
      'P-shaped marina-loop areal pier places Z=0 medial piles strictly under deck (0 stray open-sea or basin-hole piles)',
      `groundedVerts=${groundedPileVerts}, openSeaStray=${strayOpenSeaTris}, holeStray=${strayBasinHoleTris}`
    );

    // Closed loop of linear canals (Venice-style rii network) preserves enclosed dry island blocks (never inverts CW holes!)
    const veniceGridScene = {
      center: [45.438, 12.336], spanMeters: 800, halfW: 84.6, halfH: 84.6, metersToUnits: 169.2 / 800,
      dem: { minElev: 1, maxElev: 2, gridSize: 6, grid: Array.from({ length: 6 }, () => Array(6).fill(1.5)) },
      waterPolys: [],
      waterLines: [
        { pts: [[-30, -30], [30, -30]], width: 1.8, waterway: 'canal' },
        { pts: [[30, -30], [30, 30]], width: 1.8, waterway: 'canal' },
        { pts: [[30, 30], [-30, 30]], width: 1.8, waterway: 'canal' },
        { pts: [[-30, 30], [-30, -30]], width: 1.8, waterway: 'canal' },
      ],
      greenPolys: [], trees: [], roads: [], roadPolys: [], bridgePolys: [], pierPolys: [], pierLines: [], bridgeSupports: [],
      buildings: [{ id: 1, osmId: 9901, cx: 0, cy: 0, outer: rectRing(0, 0, 8, 8), holes: [], h: 14, minH: 0, roof: 'flat' }],
    };
    const vgBuilt = buildComplete3DModel(veniceGridScene, makeState({ waterCutout: true }));
    check(
      vgBuilt.printMetrics.isWatertightManifold && vgBuilt.printMetrics.floatingBuildingsCount === 0 && vgBuilt.meshes.base.length > 20,
      'Closed loop of linear canals (Venice grid) preserves dry central island block under waterCutout=true',
      `baseTris=${vgBuilt.meshes.base.length}, float=${vgBuilt.printMetrics.floatingBuildingsCount}`
    );
  }

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
  assert.equal(failed, 0, `${failed} Stage 5 waterfront/archetype tests failed`);
}

run().catch(err => {
  console.error('waterfronts_and_archetypes.test.mjs ERROR:', err);
  process.exit(1);
});
