import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const WATER_DIR = path.join(ROOT, 'src/Water');

const EXPECTED_WATER_MODULES = {
  'water_ring_geometry.js': [
    'polyAreaSignedJS', 'simplifyRingJS', 'stitchWayRingsJS', 'pointInPolyLocal',
    '_clipPolylineToRectPieces', '_bridgeSegHitsPolylinesJS',
    '_waterPointInPolyJS', '_waterRingAbsAreaJS', '_waterPointToRingDistSqJS',
    '_waterRingProbePtJS', '_waterRingsMatchSameLoopJS', '_waterRingStrictlyInsideOuterJS'
  ],
  'water_multipolygon_stitcher.js': [
    '_bridgeInteriorOpenChainsJS', '_pickLoopProbePtJS', '_buildPureLoopEntriesJS', 'stitchClippedMultipolygonRingsJS'
  ],
  'water_coastline_stitcher.js': [
    '_bridgeDirectedCoastlineGapsJS', 'stitchCoastlineSeaPolysJS'
  ],
  'water_osm_tags.js': [
    'isNonSurfaceWaterTagsJS', 'isOsmShingleOrShoalTagsJS', 'isOsmStandaloneIslandTagsJS',
    'defaultWaterwayWidthMetersJS', 'isOsmArealRelationTypeJS', 'isOsmWaterMultipolygonJS'
  ],
  'water_osm_extractor.js': [
    'collectOsmWaterSampleCandidateJS', 'processOsmWaterMultipolygonJS',
    'processOsmCoastlineWayJS', 'processOsmWaterWayJS', 'finalizeOsmWaterLayerJS'
  ],
  'water_elevation_sampler.js': [
    '_ptInRingLocal', '_probeRingInteriorPt', '_distSqToRingLocal',
    '_ptInWaterEntryLocal', '_distToWaterEntryLocal', '_computeMinWaterTerrainZ'
  ],
  'water_sloped_reaches.js': [
    '_buildSlopedPrism', '_subdivideWaterLine', '_despikeBridgeBumpsMonotonic',
    '_evalPolylineClosestT', '_buildSlopedWaterReaches'
  ],
  'water_carve_manifold.js': [
    'buildLayer1WaterAndCarve'
  ],
  'water_pier_osm_helper.js': [
    '_pointInRingExtract2D', '_ringInsideOuterExtract2D', '_signedRingAreaExtract2D',
    '_ringCentroidExtract2D', '_segsCrossExtract2D', '_isSimpleRingExtract2D',
    '_polylineCrossesRingExtract2D', '_bufferPierPolylineToPolys2D'
  ],
  'water_piers_solver.js': [
    'computeFootprintOBB', 'resolveGroundZ', 'buildMarinePiersAndBreakwaters'
  ]
};

test('1) src/Water/ exists with exact capital W, every .js module is < 380 lines, and 0 proper-noun leaks', () => {
  const srcEntries = fs.readdirSync(path.join(ROOT, 'src'));
  assert.ok(srcEntries.includes('Water'), 'src/Water directory must exist with exact capital W');

  const jsFiles = fs.readdirSync(WATER_DIR).filter(f => f.endsWith('.js')).sort();
  const expectedFiles = [...Object.keys(EXPECTED_WATER_MODULES), 'index.js'].sort();
  assert.deepEqual(jsFiles, expectedFiles, 'src/Water/ must contain the exact 10 domain modules + index.js');

  const forbidden = /\b(eiffel|petronas|london.?eye|ain.?dubai|marina.?bay|paulskirche|roemer|dom.?r[oö]mer|millau|brooklyn.?bridge|sagrada|rialto|landwasser|chicago|venice|sydney|porto|dubai)\b/i;

  for (const file of jsFiles) {
    const fullPath = path.join(WATER_DIR, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lineCount = content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
    assert.ok(lineCount < 380, `src/Water/${file} has ${lineCount} lines, must be < 380 lines`);
    const match = content.match(forbidden);
    assert.equal(match, null, `src/Water/${file} must contain 0 city/landmark proper nouns (found: ${match?.[0]})`);
  }
});

test('2) Every src/Water/*.js submodule can be require()d standalone in a fresh process AND via src/Water/index.js', () => {
  for (const [file, expectedFns] of Object.entries(EXPECTED_WATER_MODULES)) {
    const modPath = path.join(WATER_DIR, file);
    const script = `
      const m = require(${JSON.stringify(modPath)});
      const missing = ${JSON.stringify(expectedFns)}.filter(k => typeof m[k] !== 'function');
      if (missing.length) { console.error('Missing in ' + ${JSON.stringify(file)} + ': ' + missing.join(',')); process.exit(1); }
    `;
    execFileSync(process.execPath, ['-e', script], { cwd: ROOT, stdio: 'pipe' });
  }

  const barrel = require(path.join(WATER_DIR, 'index.js'));
  assert.ok(barrel && typeof barrel.modules === 'object', 'src/Water/index.js exports .modules namespace');
  for (const [file, expectedFns] of Object.entries(EXPECTED_WATER_MODULES)) {
    for (const fn of expectedFns) {
      assert.equal(typeof barrel[fn], 'function', `src/Water/index.js must re-export ${fn} (from ${file})`);
    }
  }
});

test('3) Legacy shim paths re-export 100% of historical functions cleanly', () => {
  const legacyExpectations = [
    ['src/gis_client/overpass_dem_fetch.js', [
      'simplifyRingJS', 'stitchWayRingsJS', 'polyAreaSignedJS', 'pointInPolyLocal',
      'chooseAdaptiveDemZoom', 'fetchAdaptiveTerrariumDem', 'fetchTerrariumDemInBrowser',
      'stitchClippedMultipolygonRingsJS', 'stitchCoastlineSeaPolysJS'
    ]],
    ['src/gis_client/osm_water_extract.js', [
      'isNonSurfaceWaterTagsJS', 'collectOsmWaterSampleCandidateJS', 'isOsmWaterMultipolygonJS',
      'processOsmWaterMultipolygonJS', 'processOsmCoastlineWayJS', 'processOsmWaterWayJS', 'finalizeOsmWaterLayerJS'
    ]],
    ['src/gis_client/osm_pier_geometry_helper.js', [
      '_pointInRingExtract2D', '_ringInsideOuterExtract2D', '_signedRingAreaExtract2D',
      '_ringCentroidExtract2D', '_segsCrossExtract2D', '_isSimpleRingExtract2D',
      '_polylineCrossesRingExtract2D', '_bufferPierPolylineToPolys2D'
    ]],
    ['src/mesh/terrain_delatin_water.js', [
      'buildDelatinTerrainManifold', 'buildLayer1WaterAndCarve'
    ]],
    ['src/mesh/waterfront_piers_solver.js', [
      'computeFootprintOBB', 'resolveGroundZ', 'buildMarinePiersAndBreakwaters'
    ]],
  ];

  for (const [relPath, expectedFns] of legacyExpectations) {
    const absPath = path.join(ROOT, relPath);
    const script = `
      const m = require(${JSON.stringify(absPath)});
      const missing = ${JSON.stringify(expectedFns)}.filter(k => typeof m[k] !== 'function');
      if (missing.length) { console.error('Missing in ' + ${JSON.stringify(relPath)} + ': ' + missing.join(',')); process.exit(1); }
    `;
    execFileSync(process.execPath, ['-e', script], { cwd: ROOT, stdio: 'pipe' });
  }

  for (const htmlFile of ['index.html', 'video_studio.html']) {
    const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
    for (const file of Object.keys(EXPECTED_WATER_MODULES)) {
      assert.ok(
        html.includes(`<script src="src/Water/${file}"></script>`),
        `${htmlFile} must include <script src="src/Water/${file}"></script>`
      );
    }
  }
});

test('4) Browser VM script-order execution and Node CommonJS buildComplete3DModel achieve bit-for-bit triangle parity', async () => {
  require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
  Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
  const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
  const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
  const { createPipelineRuntime } = require(path.join(ROOT, 'tools/headless_scene_harness.js'));

  await core.ensureManifoldLibAsync();
  const vmRuntime = createPipelineRuntime({ offlineOnly: true, silent: true });
  await vmRuntime.sandbox.__ensureManifoldReady();

  const N = 25;
  const grid = Array.from({ length: N }, (_, r) => {
    const wy = -60 + (r / (N - 1)) * 120;
    return Array.from({ length: N }, (__, c) => {
      const wx = -60 + (c / (N - 1)) * 120;
      if (wx <= 15 && Math.abs(wy) <= 22) return 0.0;
      if (wx > 15) return ((wx - 15) / 45) * 60.0;
      return Math.min(35.0, ((Math.abs(wy) - 22) / 38) * 35.0);
    });
  });

  const makeScene = () => ({
    spanMeters: 800,
    bounds: { widthM: 800, heightM: 800 },
    halfW: 60,
    halfH: 60,
    metersToUnits: 60 / 400,
    dem: { minElev: 0, maxElev: 60, gridSize: N, grid },
    waterPolys: [
      {
        outer: [[-58, -20], [15, -20], [15, 20], [-58, 20]],
        holes: [[[-32, -8], [-12, -8], [-12, 8], [-32, 8]]],
        name: 'Estuary Basin',
      },
      {
        outer: [[-26, -3], [-18, -3], [-18, 3], [-26, 3]],
        holes: [],
        name: 'Island Pond',
      },
    ],
    waterLines: [
      {
        pts: [[56, 2], [38, 1], [15, 0], [-5, 0]],
        width: 3.2,
        waterway: 'stream',
        name: 'Mountain Stream',
      },
    ],
    pierPolys: [
      {
        osmId: 501,
        pierKind: 'pier',
        outer: [[-8, 18], [4, 18], [4, 8], [-8, 8]],
        holes: [],
        tags: { man_made: 'pier' },
      },
    ],
    pierLines: [
      {
        osmId: 502,
        pierKind: 'pier',
        pts: [[6, -20], [6, -9]],
        width: 1.6,
        tags: { man_made: 'pier' },
      },
    ],
    bridgePolys: [],
    greenPolys: [{ outer: [[-30, -6], [-14, -6], [-14, 6], [-30, 6]], holes: [] }],
    trees: [],
    roads: [{ pts: [[-55, -30], [10, -30]], width: 2.2, highway: 'residential', tags: { highway: 'residential' } }],
    buildings: [
      {
        id: 701,
        outer: [[-29, 4], [-24, 4], [-24, 7], [-29, 7]],
        holes: [],
        h: 14,
        minH: 0,
        roof: 'gabled',
        roofH: 3,
        tags: { building: 'yes', 'roof:shape': 'gabled' },
      },
    ],
  });

  const makeState = (waterCutout) => ({
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
    waterCutout,
    showFrame: false,
    supportlessMode: false,
    cropRatio: 1.0,
    zScale: 1.0,
    terrainScale: 1.0,
    lodSettings: { enableTrees: false, treeMaxSpanKm: 5, minBuildingFootprintM: 0, roadDetail: 'all' },
    layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    elementVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    colors: { water: '#1e6e8c', base: '#f1efe8', greenery: '#5a944a', trees: '#3d7033', roads: '#7c7b77', buildings: '#fafaf6', highlighted: '#e65100' },
  });

  for (const waterCutout of [false, true]) {
    const cjsRes = buildComplete3DModel(makeScene(), makeState(waterCutout));
    const vmRes = vmRuntime.sandbox.buildComplete3DModel(
      JSON.parse(JSON.stringify(makeScene())),
      JSON.parse(JSON.stringify(makeState(waterCutout)))
    );

    assert.equal(cjsRes.printMetrics.isWatertightManifold, true, `CJS waterCutout=${waterCutout} must be watertight`);
    assert.equal(cjsRes.printMetrics.openEdgesCount, 0);
    assert.equal(cjsRes.printMetrics.nonManifoldEdgesCount, 0);
    assert.equal(cjsRes.printMetrics.totalTriangles, vmRes.printMetrics.totalTriangles, `Exact triangle parity (waterCutout=${waterCutout})`);
    assert.equal(cjsRes.audit.pierAudits.length, 2, 'Both areal and linear piers built');
    assert.equal(vmRes.audit.pierAudits.length, 2);
    if (!waterCutout) {
      assert.ok(cjsRes.audit.baseInfo.slopedRiverSegments > 0, 'Sloped stream segments emitted');
      assert.equal(cjsRes.audit.baseInfo.slopedRiverSegments, vmRes.audit.baseInfo.slopedRiverSegments);
    }

    for (const layer of ['base', 'water', 'greenery', 'roads', 'buildings']) {
      const a = cjsRes.meshes[layer] || [];
      const b = vmRes.meshes[layer] || [];
      assert.equal(a.length, b.length, `Layer ${layer} triangle count parity (waterCutout=${waterCutout})`);
      for (let i = 0; i < a.length; i++) {
        assert.deepEqual(Array.from(a[i].v0), Array.from(b[i].v0));
        assert.deepEqual(Array.from(a[i].v1), Array.from(b[i].v1));
        assert.deepEqual(Array.from(a[i].v2), Array.from(b[i].v2));
      }
    }
  }
});
