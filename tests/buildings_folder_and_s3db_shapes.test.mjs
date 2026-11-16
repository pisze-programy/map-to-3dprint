import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const BUILDINGS_DIR = path.join(ROOT, 'src/buildings');

const EXPECTED_BUILDING_MODULES = {
  's3db_tag_parser.js': {
    fns: [
      'normalizeRoofShapeS3DB', 'parseFloatTagJS', 'parseOsmLengthMetersJS',
      'parseRoofDirectionJS', 'resolveRoofAxesFromDirectionDeg', 'isObservationWheelTagsJS',
      'hasAllNegativeLevelJS', 'isBridgeSupportTagJS', 'isUndergroundOrSkippedBuildingJS',
      'isGroupingOnlyContainerTagsJS', 'estimateDefaultHeightM',
    ],
    consts: [
      'OSM_17_ROOF_SHAPES_JS', 'ROOF_SHAPES_NORM', 'CARDINAL_DEG_JS',
      'SKIP_BUILDING_VALS_JS', 'WHEEL_ATTRACTION_VALS_JS',
    ],
  },
  's3db_containment_2d.js': {
    fns: [
      '_polyAreaSignedS3DB', '_pointInPolyS3DB', '_pointInAnyHoleS3DB',
      '_minBoundaryDistSqS3DB', 'computeSolidInteriorPtJS',
      'computeRecordMetricsM', 'isPartEnclosedByParentS3DB',
    ],
    consts: [],
  },
  's3db_wheel_consolidator.js': {
    fns: ['consolidateWheelComplexesS3DB'],
    consts: [],
  },
  's3db_outline_suppressor.js': {
    fns: ['_fallbackPartsCoverageS3DB', 'evaluateParentOutlineSuppressionS3DB', 'groupOrphanBuildingPartsS3DB'],
    consts: [],
  },
  's3db_client_matcher.js': {
    fns: ['createS3DBClientCollector'],
    consts: [],
  },
  'osm_buildings_extractor.js': {
    fns: [
      '_bldPolyAreaAbsJS', '_bldPointInPolyJS', 'pairMultipolygonHolesForOutersJS',
      'collectOsmBuildingSampleCandidateJS', 'processOsmS3DBRelationsPass1BJS',
      'processOsmBuildingMultipolygonJS', 'processOsmBuildingWayJS', 'finalizeOsmBuildingsLayerJS',
    ],
    consts: [],
  },
  'roof_directional_revolve.js': {
    fns: [
      '_ringAreaSigned', '_ptInRing', '_computeOBB', '_insetRoofOuterAndHoles',
      '_extrudeProfileRoofClipped', '_buildLatheRoofClipped', 'buildDirectionalOrRevolveRoof',
    ],
    consts: [],
  },
  'roof_skeleton_poly.js': {
    fns: ['_buildStraightSkeletonRoof', '_buildConeOrPyramidalRoof', 'buildSkeletonOrPolyRoof'],
    consts: [],
  },
  's3db_part_solid_builder.js': {
    fns: [
      'isLayer2ArchetypeRecord', '_normalizeRoofShape', '_buildRoofManifold',
      'sampleFootprintTerrainZ', 'widenNarrowSpirePolys', 'buildSupportlessCorbel', 'buildS3DBPartSolid',
    ],
    consts: [],
  },
  's3db_skybridge_anchoring.js': {
    fns: [
      '_ptInSolid', '_segMinDistSq2D', '_ringsMinDist2D', '_ringsTouchOrOverlap2D',
      'recordsTouch3D', '_solidsOverlap3D', '_weldElevatedGapCollar',
      '_groundPortalOnEndPiers', 'anchorAndMergeS3DBClusters',
    ],
    consts: [],
  },
  'layer1_s3db_solver.js': {
    fns: ['buildLayer1S3DBBuildings'],
    consts: [],
  },
  'archetype_structures_solver.js': {
    fns: [
      'buildObservationWheelManifold', 'buildWindTurbineManifold',
      'buildParametricLatticeManifold', 'buildTowerOrIndustrialManifold',
    ],
    consts: [],
  },
  'layer2_archetypes_solver.js': {
    fns: ['_computeGroupDatums', '_mergeLayeredGroupManifolds', 'buildLayer2Archetypes'],
    consts: [],
  },
};

function makeRect(cx, cy, hx, hy) {
  return [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
}

function makeState(overrides = {}) {
  return {
    targetWidthCm: 24,
    targetHeightCm: 24,
    bedSizeMm: 240,
    totalHeightMm: 240,
    baseHeightMm: 2.2,
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
    mapRotationDeg: 0,
    lodSettings: { enableTrees: false, treeMaxSpanKm: 5, minBuildingFootprintM: 0, roadDetail: 'all' },
    layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    elementVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    colors: { water: '#1e6e8c', base: '#f1efe8', greenery: '#5a944a', trees: '#3d7033', roads: '#7c7b77', buildings: '#fafaf6', highlighted: '#e65100' },
    ...overrides,
  };
}

function assertWatertight2Manifold(res, label) {
  const pm = res.printMetrics;
  assert.equal(pm.isWatertightManifold, true, `${label}: isWatertightManifold must be true`);
  assert.equal(pm.openEdgesCount, 0, `${label}: openEdgesCount must be 0`);
  assert.equal(pm.nonManifoldEdgesCount, 0, `${label}: nonManifoldEdgesCount must be 0`);
  assert.equal(pm.sameDirDupEdgesCount, 0, `${label}: sameDirDupEdgesCount must be 0`);
  assert.equal(pm.degenerateTrisCount, 0, `${label}: degenerateTrisCount must be 0`);
  assert.equal(pm.floatingBuildingsCount, 0, `${label}: floatingBuildingsCount must be 0`);
}

test('1) src/buildings/ exists with exact 13 modules + index.js, every file < 300 lines, and 0 proper-noun leaks', () => {
  const srcEntries = fs.readdirSync(path.join(ROOT, 'src'));
  assert.ok(srcEntries.includes('buildings'), 'src/buildings directory must exist');

  const jsFiles = fs.readdirSync(BUILDINGS_DIR).filter(f => f.endsWith('.js')).sort();
  const expectedFiles = [...Object.keys(EXPECTED_BUILDING_MODULES), 'index.js'].sort();
  assert.deepEqual(jsFiles, expectedFiles, 'src/buildings/ must contain the exact 13 domain modules + index.js');

  const forbidden = /\b(eiffel|petronas|london.?eye|ain.?dubai|marina.?bay|paulskirche|roemer|dom.?r[oö]mer|millau|brooklyn.?bridge|sagrada|rialto|landwasser|chicago|venice|sydney|porto|dubai|manhattan|warsaw|frankfurt|marriott|bayswater|difc|cayan|opus|etihad|jumeirah|burj)\b/i;

  for (const file of jsFiles) {
    const fullPath = path.join(BUILDINGS_DIR, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lineCount = content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
    assert.ok(lineCount < 300, `src/buildings/${file} has ${lineCount} lines, must be < 300 lines`);
    const match = content.match(forbidden);
    assert.equal(match, null, `src/buildings/${file} must contain 0 city/landmark proper nouns (found: ${match?.[0]})`);
  }
});

test('2) Every src/buildings/*.js submodule can be require()d standalone in a fresh process AND via src/buildings/index.js', () => {
  for (const [file, spec] of Object.entries(EXPECTED_BUILDING_MODULES)) {
    const modPath = path.join(BUILDINGS_DIR, file);
    const script = `
      const m = require(${JSON.stringify(modPath)});
      const missingFns = ${JSON.stringify(spec.fns)}.filter(k => typeof m[k] !== 'function');
      const missingConsts = ${JSON.stringify(spec.consts)}.filter(k => m[k] === undefined);
      if (missingFns.length || missingConsts.length) {
        console.error('Missing in ' + ${JSON.stringify(file)} + ': ' + [...missingFns, ...missingConsts].join(','));
        process.exit(1);
      }
    `;
    execFileSync(process.execPath, ['-e', script], { cwd: ROOT, stdio: 'pipe' });
  }

  const barrel = require(path.join(BUILDINGS_DIR, 'index.js'));
  assert.ok(barrel && typeof barrel.modules === 'object', 'src/buildings/index.js exports .modules namespace');
  for (const [file, spec] of Object.entries(EXPECTED_BUILDING_MODULES)) {
    for (const fn of spec.fns) {
      assert.equal(typeof barrel[fn], 'function', `src/buildings/index.js must re-export function ${fn} (from ${file})`);
    }
    for (const c of spec.consts) {
      assert.notEqual(barrel[c], undefined, `src/buildings/index.js must re-export constant ${c} (from ${file})`);
    }
  }
});

test('3) All 10 legacy shims (< 45 lines each) re-export 100% of historical symbols, HTML bundles include all 13 modules, and Python gis/s3db_models.py honors building:part=no', () => {
  const legacyExpectations = [
    ['src/gis_client/s3db_unit_parser.js', [
      'normalizeRoofShapeS3DB', 'parseFloatTagJS', 'parseOsmLengthMetersJS', 'parseRoofDirectionJS',
      'resolveRoofAxesFromDirectionDeg', 'isObservationWheelTagsJS', 'hasAllNegativeLevelJS',
      'isBridgeSupportTagJS', 'isUndergroundOrSkippedBuildingJS', 'isGroupingOnlyContainerTagsJS', 'estimateDefaultHeightM',
    ]],
    ['src/gis_client/s3db_relation_helper.js', [
      '_polyAreaSignedS3DB', '_pointInPolyS3DB', '_pointInAnyHoleS3DB', '_minBoundaryDistSqS3DB',
      'computeSolidInteriorPtJS', 'computeRecordMetricsM', 'isPartEnclosedByParentS3DB', 'consolidateWheelComplexesS3DB',
    ]],
    ['src/gis_client/s3db_client_matcher.js', [
      'createS3DBClientCollector', 'evaluateParentOutlineSuppressionS3DB', 'groupOrphanBuildingPartsS3DB',
      '_fallbackPartsCoverageS3DB', 'computeSolidInteriorPtJS', 'isObservationWheelTagsJS',
      'parseFloatTagJS', 'parseOsmLengthMetersJS', 'parseRoofDirectionJS', 'isUndergroundOrSkippedBuildingJS',
    ]],
    ['src/gis_client/osm_buildings_extract.js', [
      '_bldPolyAreaAbsJS', '_bldPointInPolyJS', 'pairMultipolygonHolesForOutersJS',
      'collectOsmBuildingSampleCandidateJS', 'processOsmS3DBRelationsPass1BJS',
      'processOsmBuildingMultipolygonJS', 'processOsmBuildingWayJS', 'finalizeOsmBuildingsLayerJS',
    ]],
    ['src/mesh/s3db_roof_revolve.js', [
      '_ringAreaSigned', '_ptInRing', '_computeOBB', '_insetRoofOuterAndHoles',
      '_extrudeProfileRoofClipped', '_buildLatheRoofClipped', 'buildDirectionalOrRevolveRoof',
    ]],
    ['src/mesh/s3db_roof_skeleton.js', [
      '_buildStraightSkeletonRoof', '_buildConeOrPyramidalRoof', 'buildSkeletonOrPolyRoof',
    ]],
    ['src/mesh/s3db_part_builder.js', [
      'isLayer2ArchetypeRecord', '_normalizeRoofShape', '_buildRoofManifold',
      'sampleFootprintTerrainZ', 'widenNarrowSpirePolys', 'buildSupportlessCorbel', 'buildS3DBPartSolid',
    ]],
    ['src/mesh/layer1_s3db_buildings.js', [
      'buildLayer1S3DBBuildings', 'isLayer2ArchetypeRecord', '_normalizeRoofShape', '_buildRoofManifold',
      'recordsTouch3D', 'anchorAndMergeS3DBClusters', '_ptInSolid', '_weldElevatedGapCollar', '_groundPortalOnEndPiers',
    ]],
    ['src/mesh/lattice_and_structures_solver.js', [
      'buildObservationWheelManifold', 'buildWindTurbineManifold',
      'buildParametricLatticeManifold', 'buildTowerOrIndustrialManifold',
    ]],
    ['src/mesh/layer2_archetypes.js', [
      '_computeGroupDatums', '_mergeLayeredGroupManifolds', 'buildLayer2Archetypes',
    ]],
  ];

  for (const [relPath, expectedFns] of legacyExpectations) {
    const absPath = path.join(ROOT, relPath);
    const content = fs.readFileSync(absPath, 'utf8');
    const lineCount = content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
    assert.ok(lineCount < 45, `${relPath} has ${lineCount} lines, must be < 45 lines`);

    const script = `
      const m = require(${JSON.stringify(absPath)});
      const missing = ${JSON.stringify(expectedFns)}.filter(k => typeof m[k] !== 'function');
      if (missing.length) { console.error('Missing in ' + ${JSON.stringify(relPath)} + ': ' + missing.join(',')); process.exit(1); }
    `;
    execFileSync(process.execPath, ['-e', script], { cwd: ROOT, stdio: 'pipe' });
  }

  for (const htmlFile of ['index.html', 'video_studio.html']) {
    const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
    for (const file of Object.keys(EXPECTED_BUILDING_MODULES)) {
      assert.ok(
        html.includes(`<script src="src/buildings/${file}"></script>`),
        `${htmlFile} must include <script src="src/buildings/${file}"></script>`
      );
    }
  }

  const pyCheck = `
import sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
from gis.s3db_models import match_and_emit_s3db
buildings = []
parents = [{
    "wid": 100, "tags": {"building": "yes", "building:part": "no", "height": "95"},
    "pts": [[-10, -10], [10, -10], [10, 10], [-10, 10]], "holes": [],
    "cx": 0.0, "cy": 0.0, "bbox": [-10, -10, 10, 10], "area": 400.0, "netArea": 400.0,
    "minH": 0.0, "hasParts": False, "partCount": 0, "partsAreaSum": 0.0, "groundPartsAreaSum": 0.0,
    "fromBuildingRel": False, "groupId": None, "parentHeightHint": None,
}]
parts = [{
    "wid": 101, "tags": {"building:part": "yes", "height": "95"},
    "pts": [[-10, -10], [-4, -10], [-4, 10], [-10, 10]], "holes": [],
    "cx": -7.0, "cy": 0.0, "bbox": [-10, -10, -4, 10], "area": 80.0, "netArea": 80.0,
    "minH": 0.0, "groupId": None, "parentHeightHint": None,
}]
match_and_emit_s3db(buildings, parents, parts, 0.25, 80.0, 80.0)
assert len(buildings) == 1 and buildings[0]["osmId"] == 101, f"Expected only part 101, got {buildings}"
`;
  execFileSync('python3', ['-c', pyCheck], { cwd: ROOT, stdio: 'pipe' });
});

test('4) Browser VM (createPipelineRuntime) vs Node CommonJS (buildComplete3DModel) achieve bit-for-bit triangle parity on S3DB + Layer-2 scene', async () => {
  require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
  const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
  const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
  const { createPipelineRuntime } = require(path.join(ROOT, 'tools/headless_scene_harness.js'));

  await core.ensureManifoldLibAsync();
  const vmRuntime = createPipelineRuntime({ offlineOnly: true, silent: true });
  await vmRuntime.sandbox.__ensureManifoldReady();

  const N = 13;
  const grid = Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (__, c) => 3.0 + (r / (N - 1)) * 5.0 + (c / (N - 1)) * 2.0)
  );

  const makeScene = () => ({
    spanMeters: 500,
    bounds: { widthM: 500, heightM: 500 },
    halfW: 60,
    halfH: 60,
    metersToUnits: 120 / 500,
    dem: { minElev: 3, maxElev: 10, gridSize: N, grid },
    waterPolys: [],
    waterLines: [],
    pierPolys: [],
    pierLines: [],
    bridgePolys: [],
    greenPolys: [],
    trees: [],
    roads: [{ pts: [[-50, -35], [50, -35]], width: 2.0, highway: 'primary', tags: { highway: 'primary' } }],
    buildings: [
      { id: 1, osmId: 101, groupId: 100, part: true, outer: makeRect(-18, 0, 12, 8), holes: [], h: 16, minH: 0, roof: 'skillion', roofH: 4, roofDir: 180, tags: { 'building:part': 'yes', height: '16', 'roof:shape': 'skillion', 'roof:direction': '180', 'roof:height': '4' } },
      { id: 2, osmId: 102, groupId: 100, part: true, outer: makeRect(-25, 0, 4, 5), holes: [], h: 82, minH: 0, roof: 'skillion', roofH: 10, roofDir: 90, tags: { 'building:part': 'yes', height: '82', 'roof:shape': 'skillion', 'roof:direction': '90', 'roof:height': '10' } },
      { id: 3, osmId: 103, groupId: 100, part: true, outer: makeRect(-11, 0, 4, 5), holes: [], h: 68, minH: 0, roof: 'skillion', roofH: 8, roofDir: 270, tags: { 'building:part': 'yes', height: '68', 'roof:shape': 'skillion', 'roof:direction': '270', 'roof:height': '8' } },
      { id: 4, osmId: 104, groupId: 100, part: true, outer: makeRect(-18, 0, 3.2, 2.0), holes: [], h: 48, minH: 40, roof: 'flat', tags: { 'building:part': 'yes', height: '48', min_height: '40' } },
      { id: 5, osmId: 201, groupId: 201, part: false, outer: makeRect(22, 12, 10, 10), holes: [makeRect(22, 12, 4, 4)], h: 20, minH: 0, roof: 'hipped', roofH: 5, tags: { building: 'yes', height: '20', 'roof:shape': 'hipped', 'roof:height': '5' } },
      { id: 6, osmId: 301, groupId: 301, part: false, outer: makeRect(24, -18, 3.5, 3.5), holes: [], h: 55, minH: 0, roof: 'flat', towerConstruction: 'lattice', tags: { man_made: 'tower', 'tower:construction': 'lattice', height: '55' } },
    ],
  });

  const cjsRes = buildComplete3DModel(makeScene(), makeState());
  const vmRes = vmRuntime.sandbox.buildComplete3DModel(
    JSON.parse(JSON.stringify(makeScene())),
    JSON.parse(JSON.stringify(makeState()))
  );

  assertWatertight2Manifold(cjsRes, 'CJS S3DB + Layer-2 parity scene');
  assert.equal(cjsRes.printMetrics.totalTriangles, vmRes.printMetrics.totalTriangles, 'Exact totalTriangles parity');

  for (const layer of ['base', 'roads', 'buildings']) {
    const a = cjsRes.meshes[layer] || [];
    const b = vmRes.meshes[layer] || [];
    assert.equal(a.length, b.length, `Layer ${layer} triangle count parity`);
    for (let i = 0; i < a.length; i++) {
      assert.deepEqual(Array.from(a[i].v0), Array.from(b[i].v0));
      assert.deepEqual(Array.from(a[i].v1), Array.from(b[i].v1));
      assert.deepEqual(Array.from(a[i].v2), Array.from(b[i].v2));
    }
  }
});

test('5) All 6 unusual S3DB shape fixes produce faithful geometry and strictly 2-manifold meshes', async () => {
  require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
  const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
  await core.ensureManifoldLibAsync();

  const buildingsPkg = require(path.join(BUILDINGS_DIR, 'index.js'));
  const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));

  const mToU = 169.2 / 400;
  const flatDem = { gridSize: 4, minElev: 2, maxElev: 2, grid: Array.from({ length: 4 }, () => Array(4).fill(2)) };
  const runScene = (buildings, dem = flatDem) => buildComplete3DModel({
    spanMeters: 400, metersToUnits: mToU, halfW: 84.6, halfH: 84.6,
    dem, waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
    buildings,
  }, makeState());

  // -------------------------------------------------------------------------
  // (a) High-level outer building=* box enclosing sloped skillion podium + twin sculpted skillion towers
  // -------------------------------------------------------------------------
  {
    const col = buildingsPkg.createS3DBClientCollector(84.6, 84.6, mToU);
    // Outer 77-level envelope box (would turn twin towers into a solid rectangular brick if not suppressed!)
    col.registerCandidate(1000, { building: 'commercial', 'building:levels': '77', name: 'Twin Sculpted Complex' }, makeRect(0, 0, 22, 12), [], false);
    // Sloped skillion podium (0..22m)
    col.registerCandidate(1001, { 'building:part': 'yes', height: '22', 'roof:shape': 'skillion', 'roof:height': '6', 'roof:direction': '180' }, makeRect(0, 0, 14, 8), [], true);
    // West sculpted tower (0..135m)
    col.registerCandidate(1002, { 'building:part': 'yes', height: '135', 'roof:shape': 'skillion', 'roof:height': '18', 'roof:direction': '90' }, makeRect(-9, 0, 4.2, 5.5), [], true);
    // East sculpted tower (0..112m)
    col.registerCandidate(1003, { 'building:part': 'yes', height: '112', 'roof:shape': 'skillion', 'roof:height': '15', 'roof:direction': '270' }, makeRect(9, 0, 4.2, 5.5), [], true);

    const emitted = col.resolveAndEmitS3DBBuildings();
    assert.equal(emitted.some(b => b.osmId === 1000), false, '(a) Outer 77-level box must be suppressed');
    assert.equal(emitted.length, 3, '(a) Sloped podium + both sculpted twin towers emitted');
    assert.ok(emitted.every(b => b.name === 'Twin Sculpted Complex'), '(a) Parts inherit complex name');

    const res = runScene(emitted);
    assertWatertight2Manifold(res, '(a) Twin sculpted towers + skillion podium');
    const zAbovePodium = (2.2 / (240 / 169.2)) + 30 * mToU;
    const midGapTris = res.meshes.buildings.filter(t => {
      const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
      const maxZ = Math.max(t.v0[2], t.v1[2], t.v2[2]);
      return Math.abs(cx) < 3.5 && maxZ > zAbovePodium;
    });
    assert.equal(midGapTris.length, 0, '(a) Open gap between twin sculpted towers above podium must remain clear');
  }

  // -------------------------------------------------------------------------
  // (b) building:part=no on tall parent outline -> suppressed, void-cube cutout preserved!
  // -------------------------------------------------------------------------
  {
    const col = buildingsPkg.createS3DBClientCollector(84.6, 84.6, mToU);
    col.registerCandidate(2000, { building: 'yes', 'building:part': 'no', height: '90', name: 'Void Cube Tower' }, makeRect(0, 0, 14, 8), [], false);
    // Left pillar, right pillar, base plinth, and top bridge forming a central void window (18..68m, |x|<6)
    col.registerCandidate(2001, { 'building:part': 'yes', height: '90' }, makeRect(-10, 0, 4, 8), [], true);
    col.registerCandidate(2002, { 'building:part': 'yes', height: '90' }, makeRect(10, 0, 4, 8), [], true);
    col.registerCandidate(2003, { 'building:part': 'yes', height: '18' }, makeRect(0, 0, 6.2, 8), [], true);
    col.registerCandidate(2004, { 'building:part': 'yes', min_height: '68', height: '90' }, makeRect(0, 0, 6.2, 8), [], true);

    const emitted = col.resolveAndEmitS3DBBuildings();
    assert.equal(emitted.some(b => b.osmId === 2000), false, '(b) building:part=no parent outline must be suppressed');
    assert.equal(emitted.length, 4, '(b) All 4 void-cube parts emitted');

    const res = runScene(emitted);
    assertWatertight2Manifold(res, '(b) Void-cube cutout building');
    const zVoidLo = (2.2 / (240 / 169.2)) + 24 * mToU;
    const zVoidHi = (2.2 / (240 / 169.2)) + 60 * mToU;
    const voidInteriorTris = res.meshes.buildings.filter(t => {
      const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
      const cz = (t.v0[2] + t.v1[2] + t.v2[2]) / 3;
      return Math.abs(cx) < 4.5 && cz > zVoidLo && cz < zVoidHi;
    });
    assert.equal(voidInteriorTris.length, 0, '(b) Central void window remains completely open');
  }

  // -------------------------------------------------------------------------
  // (c) Stilted / bridge building (groundParts.length === 0, min_height=6, allCov=0.92) -> parent suppressed, archway open!
  //     AND base shaft beneath high crown (min_height=18 >= 24*0.58) -> parent kept!
  // -------------------------------------------------------------------------
  {
    const colStilt = buildingsPkg.createS3DBClientCollector(84.6, 84.6, mToU);
    colStilt.registerCandidate(3000, { building: 'commercial', height: '24' }, makeRect(0, 0, 15, 5), [], false);
    colStilt.registerCandidate(3001, { 'building:part': 'yes', min_height: '6', height: '24' }, makeRect(0, 0, 14.4, 4.8), [], true);
    const outStilt = colStilt.resolveAndEmitS3DBBuildings();
    assert.equal(outStilt.length, 1, '(c) Stilted building parent suppressed');
    assert.equal(outStilt[0].osmId, 3001);

    const resStilt = runScene(outStilt);
    assertWatertight2Manifold(resStilt, '(c) Stilted over-street archway');
    const zUnderMax = (2.2 / (240 / 169.2)) + 4.2 * mToU;
    const centerUnderTris = resStilt.meshes.buildings.filter(t => {
      const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
      const minZ = Math.min(t.v0[2], t.v1[2], t.v2[2]);
      return Math.abs(cx) < 5.0 && minZ < zUnderMax;
    });
    assert.equal(centerUnderTris.length, 0, '(c) Central archway under stilted building stays open');

    const colCrown = buildingsPkg.createS3DBClientCollector(84.6, 84.6, mToU);
    colCrown.registerCandidate(3010, { building: 'office', height: '24' }, makeRect(0, 0, 10, 10), [], false);
    colCrown.registerCandidate(3011, { 'building:part': 'yes', min_height: '18', height: '30' }, makeRect(0, 0, 8.5, 8.5), [], true);
    const outCrown = colCrown.resolveAndEmitS3DBBuildings();
    assert.equal(outCrown.length, 2, '(c) Base shaft kept when elevated part starts high (min_height >= 0.58 * parH)');
  }

  // -------------------------------------------------------------------------
  // (d) type=building relation with role="" building:parts AND role="outline" + building:part=yes low podium
  // -------------------------------------------------------------------------
  {
    const nodes = new Map([
      [1, [-16, -12]], [2, [16, -12]], [3, [16, 12]], [4, [-16, 12]],
      [5, [-6, -6]], [6, [6, -6]], [7, [6, 6]], [8, [-6, 6]],
      [9, [-3, -3]], [10, [3, -3]], [11, [3, 3]], [12, [-3, 3]],
    ]);
    const ways = new Map([
      [4001, { id: 4001, nodes: [1, 2, 3, 4, 1], tags: { building: 'commercial', 'building:part': 'yes', height: '12' } }],
      [4002, { id: 4002, nodes: [5, 6, 7, 8, 5], tags: { 'building:part': 'yes', height: '58' } }],
      [4003, { id: 4003, nodes: [9, 10, 11, 12, 9], tags: { 'building:part': 'yes', min_height: '58', height: '78' } }],
    ]);
    const rel = {
      id: 9400,
      tags: { type: 'building', name: 'Dual Podium Relation Tower' },
      members: [
        { type: 'way', ref: 4001, role: 'outline' },
        { type: 'way', ref: 4002, role: '' },
        { type: 'way', ref: 4003, role: '' },
      ],
    };
    const s3db = buildingsPkg.createS3DBClientCollector(84.6, 84.6, mToU);
    const extractCtx = {
      relations: [rel], ways, relById: new Map([[9400, rel]]), stitchedRelPolys: new Map(),
      nodesToPts: (nids) => nids.slice(0, -1).map(id => nodes.get(id)),
      consumedRels: new Set(), usedWays: new Set(), s3db, minBldFootprintM: 0, metersToUnits: mToU,
    };
    buildingsPkg.processOsmS3DBRelationsPass1BJS(extractCtx);
    const outRel = buildingsPkg.finalizeOsmBuildingsLayerJS(extractCtx);
    assert.equal(outRel.length, 3, '(d) Low dual-tagged podium + both role="" building:parts emitted');
    assert.ok(outRel.some(b => b.osmId === 4001 && !b.part && b.h === 12), '(d) Dual-tagged 12m podium preserved');
    assert.ok(outRel.some(b => b.osmId === 4002 && b.part && b.h === 58), '(d) role="" 58m shaft classified as part');
    assert.ok(outRel.some(b => b.osmId === 4003 && b.part && b.minH === 58 && b.h === 78), '(d) role="" 58..78m crown classified as part');
    assertWatertight2Manifold(runScene(outRel), '(d) Dual-tagged podium + empty-role parts');

    // Inner dual-tagged (building=yes + building:part=yes) twin wings inside a larger outer building=* shell
    const colDualInner = buildingsPkg.createS3DBClientCollector(84.6, 84.6, mToU);
    colDualInner.registerCandidate(4100, { building: 'hotel', height: '160', name: 'Twin Wing Complex' }, makeRect(0, 0, 18, 10), [], false);
    colDualInner.registerCandidate(4101, { building: 'yes', 'building:part': 'yes', height: '160' }, makeRect(-9, 0, 6.5, 8.5), [], false);
    colDualInner.registerCandidate(4102, { building: 'yes', 'building:part': 'yes', height: '140' }, makeRect(9, 0, 6.5, 8.5), [], false);
    const outDualInner = colDualInner.resolveAndEmitS3DBBuildings();
    assert.equal(outDualInner.some(b => b.osmId === 4100), false, '(d2) Outer shell suppressed by enclosed dual-tagged inner towers');
    assert.equal(outDualInner.length, 2, '(d2) Both dual-tagged inner towers emitted');
    assert.equal(outDualInner[0].groupId, outDualInner[1].groupId, '(d2) Inner dual-tagged towers share 1 groupId');
    assert.ok(outDualInner.every(b => b.name === 'Twin Wing Complex'), '(d2) Inner dual-tagged towers inherit outer shell name');
  }

  // -------------------------------------------------------------------------
  // (e) building=construction outer container enclosing multi-tier building:part stack
  //     + orphan multi-tier part stack + elevated part without explicit height
  // -------------------------------------------------------------------------
  {
    const nodes = new Map([
      [1, [-18, -18]], [2, [18, -18]], [3, [18, 18]], [4, [-18, 18]],
      [5, [-12, -12]], [6, [12, -12]], [7, [12, 12]], [8, [-12, 12]],
      [9, [-8, -8]], [10, [8, -8]], [11, [8, 8]], [12, [-8, 8]],
      [13, [-5, -5]], [14, [5, -5]], [15, [5, 5]], [16, [-5, 5]],
      // Orphan stack at x = +45 (no parent way at all!)
      [21, [35, -10]], [22, [55, -10]], [23, [55, 10]], [24, [35, 10]],
      [25, [38, -7]], [26, [52, -7]], [27, [52, 7]], [28, [38, 7]],
    ]);
    const ways = new Map([
      [5000, { id: 5000, nodes: [1, 2, 3, 4, 1], tags: { building: 'construction', height: '110', name: 'Stepped Spire Complex' } }],
      [5001, { id: 5001, nodes: [5, 6, 7, 8, 5], tags: { 'building:part': 'yes', height: '24' } }],
      [5002, { id: 5002, nodes: [9, 10, 11, 12, 9], tags: { 'building:part': 'yes', min_height: '24', height: '64' } }],
      [5003, { id: 5003, nodes: [13, 14, 15, 16, 13], tags: { 'building:part': 'yes', min_height: '64', height: '98' } }],
      [5011, { id: 5011, nodes: [21, 22, 23, 24, 21], tags: { 'building:part': 'yes', height: '22', name: 'Orphan Stack' } }],
      [5012, { id: 5012, nodes: [25, 26, 27, 28, 25], tags: { 'building:part': 'yes', min_height: '22' } }],
    ]);
    const s3db = buildingsPkg.createS3DBClientCollector(84.6, 84.6, mToU);
    const extractCtx = {
      relations: [], ways, relById: new Map(), stitchedRelPolys: new Map(),
      nodesToPts: (nids) => nids.slice(0, -1).map(id => nodes.get(id)),
      consumedRels: new Set(), usedWays: new Set(), s3db, minBldFootprintM: 0, metersToUnits: mToU,
    };
    for (const [wid, w] of ways) {
      buildingsPkg.processOsmBuildingWayJS(wid, w, w.tags, w.nodes, true, extractCtx);
    }
    const emitted = buildingsPkg.finalizeOsmBuildingsLayerJS(extractCtx);

    assert.equal(emitted.some(b => b.osmId === 5000), false, '(e) building=construction shell must NEVER be emitted');
    const cParts = emitted.filter(b => [5001, 5002, 5003].includes(b.osmId));
    assert.equal(cParts.length, 3, '(e) All 3 tiers inside building=construction emitted');
    assert.equal(new Set(cParts.map(b => b.groupId)).size, 1, '(e) All 3 tiers share 1 groupId');
    assert.ok(cParts.every(b => b.name === 'Stepped Spire Complex'), '(e) All 3 tiers inherit building=construction name');

    const oParts = emitted.filter(b => [5011, 5012].includes(b.osmId));
    assert.equal(oParts.length, 2, '(e) Orphan multi-tier parts emitted');
    assert.equal(oParts[0].groupId, oParts[1].groupId, '(e) Orphan multi-tier parts clustered into 1 groupId');
    assert.equal(oParts[1].name, 'Orphan Stack', '(e) Orphan upper tier inherits cluster name');
    const topOrphan = oParts.find(b => b.osmId === 5012);
    assert.equal(topOrphan.minH, 22, '(e) Elevated part without explicit height keeps minH=22');
    assert.ok(topOrphan.h >= 25.5, `(e) Elevated part without explicit height receives h=${topOrphan.h} > minH`);

    // Sloped DEM verifies shared groupDatumById prevents floating gaps or spurious end-piers
    const slopedDem = {
      gridSize: 4, minElev: 2, maxElev: 18,
      grid: Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (__, c) => 2 + r * 3 + c * 2)),
    };
    const res = runScene(emitted, slopedDem);
    assertWatertight2Manifold(res, '(e) Stepped stacks on sloped DEM');
    assert.equal(res.audit.s3dbAllFinalBuildings.filter(x => [5001, 5002, 5003].includes(x.osmId)).map(x => x.pickId).filter((v, i, a) => a.indexOf(v) === i).length, 1, '(e) Stepped tiers unified into 1 cluster without spurious piers');
  }

  // -------------------------------------------------------------------------
  // (f) Minor interior sub-part (395m tower + 4% 10m booth), low podium + 15% tower,
  //     and turret inside gabled sloped roof not swallowed below ridge
  // -------------------------------------------------------------------------
  {
    const col = buildingsPkg.createS3DBClientCollector(84.6, 84.6, mToU);
    // 395m tower (20x20) + 4%-coverage 10m entrance booth (4x4)
    col.registerCandidate(6001, { building: 'yes', height: '395' }, makeRect(-30, 0, 10, 10), [], false);
    col.registerCandidate(6002, { 'building:part': 'yes', height: '10' }, makeRect(-30, -7, 2, 2), [], true);
    // 20m low podium (20x20) + 15%-coverage 80m tower (7.6x7.8)
    col.registerCandidate(6011, { building: 'apartments', height: '20' }, makeRect(10, 0, 10, 10), [], false);
    col.registerCandidate(6012, { 'building:part': 'yes', height: '80' }, makeRect(6, -4, 3.8, 3.9), [], true);
    // Gabled church nave (h=24, roofH=10 -> eaves at 14m) + corner turret inside footprint (h=22m, protrudes above 14m eaves!)
    col.registerCandidate(6021, { building: 'church', height: '24', 'roof:shape': 'gabled', 'roof:height': '10' }, makeRect(45, 0, 10, 6), [], false, 6021);
    col.registerCandidate(6022, { 'building:part': 'yes', height: '22', 'roof:shape': 'cone', 'roof:height': '5' }, makeRect(38, 4.2, 1.5, 1.5), [], true, 6021);

    // 30m historic palace/townhall with parts covering only East half (~40%) -> must preserve West Wing!
    col.registerCandidate(6031, { building: 'civic', height: '30' }, makeRect(-30, 35, 16, 10), [makeRect(-38, 35, 3, 3)], false);
    col.registerCandidate(6032, { 'building:part': 'yes', height: '26' }, makeRect(-20, 35, 5.5, 4.5), [], true);
    col.registerCandidate(6033, { 'building:part': 'yes', height: '24' }, makeRect(-20, 29, 5.5, 3.0), [], true);

    const emitted = col.resolveAndEmitS3DBBuildings();
    assert.ok(emitted.some(b => b.osmId === 6001 && b.h === 395), '(f) 395m tower preserved despite 4% 10m interior booth');
    assert.ok(emitted.some(b => b.osmId === 6011 && b.h === 20) && emitted.some(b => b.osmId === 6012 && b.h === 80), '(f) 20m podium + 80m tower both preserved');
    assert.ok(emitted.some(b => b.osmId === 6031 && b.h === 30), '(f) 30m partially-mapped historic townhall preserves unmapped wing');

    const res = runScene(emitted);
    assertWatertight2Manifold(res, '(f) Preserved tower, podium & gabled nave corner turret');
    const turretPrep = res.audit.preparedList.find(p => p.osmId === 6022);
    assert.ok(turretPrep && turretPrep.skip === false, '(f) Corner turret inside gabled roof is NOT skipped by cluster_swallowed_interior');
  }
});
