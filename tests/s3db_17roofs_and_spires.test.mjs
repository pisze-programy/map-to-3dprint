import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/export/export_io_utils.js')));
const parser = require(path.join(ROOT, 'src/gis_client/s3db_unit_parser.js'));
const relHelper = require(path.join(ROOT, 'src/gis_client/s3db_relation_helper.js'));
const matcherMod = require(path.join(ROOT, 'src/gis_client/s3db_client_matcher.js'));
Object.assign(globalThis, parser, relHelper, matcherMod);
const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
const { recordsTouch3D } = require(path.join(ROOT, 'src/mesh/layer1_s3db_buildings.js'));

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
    targetWidthCm: 20, targetHeightCm: 20, bedSizeMm: 200, totalHeightMm: 100, baseHeightMm: 2.0,
    zScale: 1.0, terrainScale: 1.0, waterCutout: false, hollowBase: false, hollowWallMm: 2.0,
    showFrame: false, exportFrame: false, cropRatio: 1.0, cropCenterX: 0.5, cropCenterY: 0.5,
    tileCols: 1, tileRows: 1, isResin: true, xyPixelMm: 0.017, layerHeightMm: 0.05,
    supportlessMode: false, mapRotationDeg: 0, ...overrides,
  };
}

function makeRect(cx, cy, hx, hy) {
  return [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
}

function makeCircle(cx, cy, r, segs = 20) {
  return Array.from({ length: segs }, (_, i) => {
    const a = (i / segs) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

function getBuildingVerts(res) {
  const arr = res.meshes.buildings || [];
  const pts = [];
  for (const t of arr) {
    if (t && t.v0) pts.push(t.v0, t.v1, t.v2);
  }
  return pts;
}

function getBuildingStats(res) {
  const pts = getBuildingVerts(res);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
  }
  const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;
  const topMap = new Map();
  for (const p of pts) {
    if (p[2] >= maxZ - 0.15) topMap.set(`${p[0].toFixed(4)}_${p[1].toFixed(4)}`, p);
  }
  const topPts = [...topMap.values()];
  const dxTop = topPts.reduce((s, p) => s + (p[0] - cx), 0) / Math.max(1, topPts.length);
  const dyTop = topPts.reduce((s, p) => s + (p[1] - cy), 0) / Math.max(1, topPts.length);
  const bVol = (res.printMetrics.layerMetrics && res.printMetrics.layerMetrics.buildings ? res.printMetrics.layerMetrics.buildings.volumeMl : res.printMetrics.totalVolumeMl);
  return { pts, cx, cy, halfX: (maxX - minX) * 0.5, halfY: (maxY - minY) * 0.5, maxZ, dxTop, dyTop, vol: bVol, tris: res.meshes.buildings.length };
}

function assertClean(res, label) {
  const pm = res.printMetrics;
  const ok = pm.openEdgesCount === 0 && pm.nonManifoldEdgesCount === 0 && pm.sameDirDupEdgesCount === 0 && pm.degenerateTrisCount === 0 && pm.floatingBuildingsCount === 0;
  check(ok, `${label} strictly watertight 0 open/nm/dup/degen/float`, `tris=${pm.totalTriangles}, open=${pm.openEdgesCount}, nm=${pm.nonManifoldEdgesCount}, dup=${pm.sameDirDupEdgesCount}, float=${pm.floatingBuildingsCount}`);
}

console.log('================================================================');
console.log('   ETAP 3 S3DB 17-ROOFS, COMPASS DIRECTION, SPIRES & TOUCH TEST');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// 1. Unit parsing, bridge:support exclusion & all 17 OSM Wiki roof:shape types
// ---------------------------------------------------------------------------
console.log('[1/7] OSM Units, bridge:support Exclusion & All 17 OSM Roof Shapes');
check(Math.abs(parser.parseOsmLengthMetersJS('12 m') - 12.0) < 1e-6, 'parseOsmLengthMetersJS("12 m") === 12');
check(Math.abs(parser.parseOsmLengthMetersJS('350 cm') - 3.5) < 1e-6, 'parseOsmLengthMetersJS("350 cm") === 3.5');
check(Math.abs(parser.parseOsmLengthMetersJS('4500 mm') - 4.5) < 1e-6, 'parseOsmLengthMetersJS("4500 mm") === 4.5');
check(Math.abs(parser.parseOsmLengthMetersJS("10'6\"") - (10 * 0.3048 + 6 * 0.0254)) < 1e-4, 'parseOsmLengthMetersJS("10\'6\\"") converts feet+inches');
check(parser.isUndergroundOrSkippedBuildingJS({ building: 'yes', 'bridge:support': 'pier' }) === true, 'Excludes bridge:support=pier from S3DB');
check(parser.isUndergroundOrSkippedBuildingJS({ building: 'yes' }) === false, 'Keeps normal building=yes');

const ALL_17_ROOFS = parser.OSM_17_ROOF_SHAPES_JS;
check(ALL_17_ROOFS.length === 17, 'Exact 17 OSM Wiki roof:shape count', `count=${ALL_17_ROOFS.length}`);

const roofStats = {};
const m = matcherMod.createS3DBClientCollector(80, 80, 0.25);
for (let i = 0; i < ALL_17_ROOFS.length; i++) {
  const shape = ALL_17_ROOFS[i];
  check(parser.normalizeRoofShapeS3DB(shape) === shape, `Preserves ${shape} without lossy remap`);
  m.registerCandidate(1000 + i, { building: 'yes', height: '16', 'roof:shape': shape, 'roof:height': '6' }, makeRect((i % 5) * 14 - 28, Math.floor(i / 5) * 14 - 20, 3, 2.5), [], false);
}
const emitted17 = m.resolveAndEmitS3DBBuildings();
check(emitted17.length === 17 && ALL_17_ROOFS.every((s, idx) => emitted17[idx].roof === s), 'Matcher preserves all 17 roof shapes verbatim');

for (const shape of ALL_17_ROOFS) {
  const isRound = shape === 'dome' || shape === 'onion' || shape === 'cone';
  const res = buildComplete3DModel({
    spanMeters: 200, dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [{
      id: 1, outer: isRound ? makeCircle(0, 0, 5, 16) : makeRect(0, 0, 6, 4), holes: [],
      h: 16, minH: 0, roof: shape, roofH: shape === 'flat' ? 0 : 6,
      tags: { building: 'yes', 'roof:shape': shape, 'roof:height': shape === 'flat' ? '0' : '6' },
    }],
  }, makeState());
  assertClean(res, `Roof ${shape}`);
  roofStats[shape] = getBuildingStats(res);
}

check(Math.abs(roofStats.saltbox.dyTop) > 0.5 && Math.abs(roofStats.gabled.dyTop) < 0.2, 'saltbox ridge offset differs cleanly from symmetric gabled', `saltDy=${roofStats.saltbox.dyTop.toFixed(2)}, gabDy=${roofStats.gabled.dyTop.toFixed(2)}`);
check(roofStats.butterfly.vol < roofStats.flat.vol && Math.abs(roofStats.butterfly.dyTop) < 0.15 && roofStats.butterfly.tris > roofStats.flat.tris, 'butterfly inverted V differs from flat');
check(roofStats.sawtooth.vol < roofStats.flat.vol && roofStats.sawtooth.tris > roofStats.flat.tris + 10, 'sawtooth multi-tooth differs cleanly from flat');
check(roofStats.hipped.vol < roofStats['half-hipped'].vol && roofStats['half-hipped'].vol < roofStats.gabled.vol && roofStats['half-hipped'].tris > roofStats.gabled.tris, 'half-hipped sits strictly between hipped & gabled', `volH=${roofStats.hipped.vol.toFixed(4)}, volHH=${roofStats['half-hipped'].vol.toFixed(4)}, volG=${roofStats.gabled.vol.toFixed(4)}, trisH=${roofStats.hipped.tris}, trisHH=${roofStats['half-hipped'].tris}, trisG=${roofStats.gabled.tris}`);
check(Math.abs(roofStats.side_hipped.dxTop) > 0.3 && Math.abs(roofStats.hipped.dxTop) < 0.2, 'side_hipped asymmetric lateral slope distinct from symmetric hipped', `sideDx=${roofStats.side_hipped.dxTop.toFixed(2)}, hipDx=${roofStats.hipped.dxTop.toFixed(2)}`);
check(Math.hypot(roofStats.quadruple_saltbox.dxTop, roofStats.quadruple_saltbox.dyTop) > 0.4 && Math.hypot(roofStats.mansard.dxTop, roofStats.mansard.dyTop) < 0.2, 'quadruple_saltbox asymmetric apex distinct from mansard', `qs=(${roofStats.quadruple_saltbox.dxTop.toFixed(2)},${roofStats.quadruple_saltbox.dyTop.toFixed(2)})`);

// ---------------------------------------------------------------------------
// 2. roof:direction (0, 90, 180, 270) + rotDeg (0, 45) -> ridge strictly +90°
// ---------------------------------------------------------------------------
console.log('\n[2/7] Compass roof:direction & rotDeg Ridge Perpendicularity');
for (const d of [0, 90, 180, 270]) {
  const ax = parser.resolveRoofAxesFromDirectionDeg(d, 0);
  const dot = ax.downhillVec[0] * ax.ridgeVec[0] + ax.downhillVec[1] * ax.ridgeVec[1];
  check(Math.abs(dot) < 1e-12, `dir=${d}°: dot(downhill, ridge) === 0`, `dot=${dot.toExponential(2)}`);
}
const dirTests = [
  { dir: 0, rot: 0, checkFn: (dx, dy) => dy < -5.0 && Math.abs(dx) < 0.05, desc: 'dir=0(N) rot=0 -> ridge on South (-Y)' },
  { dir: 90, rot: 0, checkFn: (dx, dy) => dx < -5.0 && Math.abs(dy) < 0.05, desc: 'dir=90(E) rot=0 -> ridge on West (-X)' },
  { dir: 180, rot: 0, checkFn: (dx, dy) => dy > 5.0 && Math.abs(dx) < 0.05, desc: 'dir=180(S) rot=0 -> ridge on North (+Y)' },
  { dir: 270, rot: 0, checkFn: (dx, dy) => dx > 5.0 && Math.abs(dy) < 0.05, desc: 'dir=270(W) rot=0 -> ridge on East (+X)' },
  { dir: 0, rot: 45, checkFn: (dx, dy) => dx > 4.0 && dy < -4.0, desc: 'dir=0(N) rot=45(CCW) -> downhill NW, ridge on SE (+X, -Y)' },
];
for (const dt of dirTests) {
  const res = buildComplete3DModel({
    spanMeters: 200, dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [{
      id: 20 + dt.dir, outer: makeRect(0, 0, 6, 6), holes: [], h: 16, minH: 0,
      roof: 'skillion', roofH: 6, roofDir: dt.dir,
      tags: { building: 'yes', 'roof:shape': 'skillion', 'roof:direction': String(dt.dir), 'roof:height': '6' },
    }],
  }, makeState({ mapRotationDeg: dt.rot }));
  const st = getBuildingStats(res);
  check(dt.checkFn(st.dxTop, st.dyTop), dt.desc, `ridgeOffset=(${st.dxTop.toFixed(2)}, ${st.dyTop.toFixed(2)})`);
}

// ---------------------------------------------------------------------------
// 3. Hard Rule partCount >= 1 -> unconditional outline suppression even at 15%
// ---------------------------------------------------------------------------
console.log('\n[3/7] Unconditional Outline Suppression when partCount >= 1 (15% Coverage)');
{
  const col = matcherMod.createS3DBClientCollector(80, 80, 0.25);
  col.registerCandidate(5001, { building: 'yes', height: '20' }, makeRect(0, 0, 10, 10), [], false, null, false);
  // Small corner part covering only (4*1.5)/(20*20) = 1.5%..15%
  col.registerCandidate(5002, { 'building:part': 'yes', height: '14' }, makeRect(-4, -4, 3.8, 3.9), [], true, null, false);
  const out = col.resolveAndEmitS3DBBuildings();
  check(out.length === 1 && out[0].osmId === 5002 && out[0].part === true, '15% part suppresses outline unconditionally', `emitted=${out.map(x => `${x.osmId}:${x.part}`).join(',')}`);
}

// ---------------------------------------------------------------------------
// 4. Courtyard Pavilion inside holes Preserved & Courtyard Roof Stays Open
// ---------------------------------------------------------------------------
console.log('\n[4/7] Courtyard Holes Pavilion Preservation & Open Courtyard CSG Roof');
{
  const outerRing = makeRect(0, 0, 20, 20);
  const holeRing = makeRect(0, 0, 10, 10);
  const pavRing = makeRect(0, 0, 3, 3);
  const col = matcherMod.createS3DBClientCollector(80, 80, 0.25);
  col.registerCandidate(6001, { building: 'yes', height: '18', 'roof:shape': 'hipped', 'roof:height': '5' }, outerRing, [holeRing], false, 6001, false);
  col.registerCandidate(6002, { 'building:part': 'yes', height: '8', 'roof:shape': 'flat' }, pavRing, [], true, null, false);
  const out = col.resolveAndEmitS3DBBuildings();
  const ids = new Set(out.map(x => x.osmId));
  check(ids.has(6001) && ids.has(6002), 'Both ring building and courtyard pavilion preserved in matcher', `ids=[${[...ids]}]`);

  // Check courtyard hipped roof has NO triangles spanning open hole margin (4 < |x|,|y| < 9 above ground)
  const resRingOnly = buildComplete3DModel({
    spanMeters: 200, dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [{ id: 6001, outer: outerRing, holes: [holeRing], h: 18, minH: 0, roof: 'hipped', roofH: 5, tags: { building: 'yes', 'roof:shape': 'hipped', 'roof:height': '5' } }],
  }, makeState());
  assertClean(resRingOnly, 'Courtyard hipped building');
  const stRing = getBuildingStats(resRingOnly);
  const bridgedPts = stRing.pts.filter(p => Math.abs(p[0] - stRing.cx) < stRing.halfX * 0.42 && Math.abs(p[1] - stRing.cy) < stRing.halfY * 0.42 && p[2] > 0.5);
  check(bridgedPts.length === 0, 'Courtyard hole strictly open in CSG hipped roof', `bridgedVerts=${bridgedPts.length}`);
}

// ---------------------------------------------------------------------------
// 5. Spire Preservation, Pin Widening, explicit roof:height=40 & Mono 4 Cap + Lattice Part
// ---------------------------------------------------------------------------
console.log('\n[5/7] Narrow Spire Pin Widening, roof:height=40, Mono 4 Cap & Lattice Part');
{
  const col = matcherMod.createS3DBClientCollector(80, 80, 0.25);
  col.registerCandidate(7001, { building: 'yes', height: '46', 'roof:shape': 'cone', 'roof:height': '40' }, makeRect(0, 0, 0.75, 0.75), [], false, null, false);
  const [spireRec] = col.resolveAndEmitS3DBBuildings();
  check(spireRec.roofH === 40, 'Explicit roof:height=40 not clamped by 6x6 m width', `roofH=${spireRec.roofH}`);

  // Group with lower body (h=30) + thin narrow spire part (0.4x0.4m, h=140)
  const resSpire = buildComplete3DModel({
    spanMeters: 400, dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [
      { id: 7010, groupId: 7010, part: true, outer: makeRect(0, 0, 10, 10), holes: [], h: 30, minH: 0, roof: 'flat', tags: { 'building:part': 'yes', height: '30' } },
      { id: 7011, groupId: 7010, part: true, outer: makeRect(0, 0, 0.15, 0.15), holes: [], h: 140, minH: 28, roof: 'cone', roofH: 30, tags: { 'building:part': 'yes', height: '140', min_height: '28', 'roof:shape': 'cone', 'roof:height': '30' } },
      { id: 7012, groupId: 7012, part: true, outer: makeRect(20, 0, 1.5, 1.5), holes: [], h: 35, minH: 0, roof: 'flat', towerConstruction: 'lattice', tags: { 'building:part': 'yes', 'tower:construction': 'lattice', height: '35' } },
    ],
  }, makeState());
  assertClean(resSpire, 'Spire cap + lattice building:part');
  const bodyB = resSpire.buildingBounds.find(b => b.id === 7010);
  const spB = resSpire.buildingBounds.find(b => b.id === 7011);
  const latB = resSpire.buildingBounds.find(b => b.id === 7012);
  const scaleMm = 200 / 169.2;
  const protMm = (spB.maxZ - bodyB.maxZ) * scaleMm;
  const spSpanMm = Math.min(spB.maxX - spB.minX, spB.maxY - spB.minY) * scaleMm;
  const reqPinMm = globalThis.SLA_PRINT_LAWS.minPinDiameterMm(protMm);
  check(Boolean(spB) && protMm > 0.5 && protMm <= 4.55, 'Spire protrusion capped by Mono 4 law (0 < protMm <= 4.5)', `protMm=${protMm.toFixed(2)}`);
  check(spSpanMm >= reqPinMm * 0.96, 'Narrow spire widened >= minPinDiameterMm', `spanMm=${spSpanMm.toFixed(2)}, reqPin=${reqPinMm.toFixed(2)}`);
  check(Boolean(latB), 'tower:construction=lattice as building:part emitted non-zero geometry');
}

// ---------------------------------------------------------------------------
// 6. recordsTouch3D Fix (No False AABB Diagonal Merge)
// ---------------------------------------------------------------------------
console.log('\n[6/7] recordsTouch3D Geometric Polygon + Z Contact');
{
  const diagStrip = { outer: [[0, 9], [1, 10], [10, 1], [9, 0]], minZ: 0, maxZ: 10 };
  const cornerBox = { outer: [[7, 7], [10, 7], [10, 10], [7, 10]], minZ: 0, maxZ: 10 };
  const touchingBox = { outer: [[1.05, 8.95], [3, 9], [3, 11], [1, 11]], minZ: 9.8, maxZ: 15 };
  const disjointZ = { outer: [[1.05, 8.95], [3, 9], [3, 11], [1, 11]], minZ: 15, maxZ: 20 };
  check(recordsTouch3D(diagStrip, cornerBox, 0.15, 0.35) === false, 'Overlapping AABBs with disjoint diagonal polygons -> false');
  check(recordsTouch3D(diagStrip, touchingBox, 0.15, 0.35) === true, 'Touching XY + Z solids -> true');
  check(recordsTouch3D(diagStrip, disjointZ, 0.15, 0.35) === false, 'Touching XY with disjoint Z -> false');
}

// ---------------------------------------------------------------------------
// 7. supportlessMode Switch (false crisp undercut vs true >= 40° bevel)
// ---------------------------------------------------------------------------
console.log('\n[7/7] supportlessMode Switch (false vs true)');
{
  const sceneSup = {
    spanMeters: 200, dem: { grid: [[2, 2], [2, 2]], minElev: 2, maxElev: 2 },
    waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings: [
      { id: 8001, groupId: 8000, part: true, outer: makeRect(-12, 0, 4, 5), holes: [], h: 30, minH: 0, roof: 'flat', tags: { 'building:part': 'yes', height: '30' } },
      { id: 8002, groupId: 8000, part: true, outer: makeRect(12, 0, 4, 5), holes: [], h: 30, minH: 0, roof: 'flat', tags: { 'building:part': 'yes', height: '30' } },
      { id: 8003, groupId: 8000, part: true, outer: makeRect(0, 0, 10, 4), holes: [], h: 28, minH: 18, roof: 'flat', tags: { 'building:part': 'yes', height: '28', min_height: '18' } },
    ],
  };
  const rFalse = buildComplete3DModel(sceneSup, makeState({ supportlessMode: false }));
  const rTrue = buildComplete3DModel(sceneSup, makeState({ supportlessMode: true }));
  assertClean(rFalse, 'supportlessMode=false bridge');
  assertClean(rTrue, 'supportlessMode=true bridge');
  const bFalse = rFalse.buildingBounds.find(b => b.id === 8003);
  const bTrue = rTrue.buildingBounds.find(b => b.id === 8003);
  check(rTrue.printMetrics.totalVolumeMl > rFalse.printMetrics.totalVolumeMl && bTrue.minX <= bFalse.minX + 0.01 && rTrue.meshes.buildings.length > rFalse.meshes.buildings.length,
    'supportlessMode=true adds 40° under-bridge bevel vs sharp supportlessMode=false',
    `volFalse=${rFalse.printMetrics.totalVolumeMl.toFixed(2)}, volTrue=${rTrue.printMetrics.totalVolumeMl.toFixed(2)}`);
}

console.log(`\nS3DB ETAP 3 TEST SUMMARY: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
