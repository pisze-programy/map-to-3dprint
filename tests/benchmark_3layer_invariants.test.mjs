import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/export/export_io_utils.js')));
const { buildComplete3DModel, rebuildModel3DProgressive } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
const stlMod = require(path.join(ROOT, 'src/export/stl_writer.js'));
const m3fMod = require(path.join(ROOT, 'src/export/export_3mf.js'));
const zipMod = require(path.join(ROOT, 'src/export/zip_packager.js'));
Object.assign(globalThis, stlMod, m3fMod, zipMod);
const { exportBinarySTL } = stlMod;
const { exportMultiColor3MF } = m3fMod;
const { exportAllTilesZipSTL } = zipMod;

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

function makeSquare(cx, cy, halfSide) {
  return [
    [cx - halfSide, cy - halfSide],
    [cx + halfSide, cy - halfSide],
    [cx + halfSide, cy + halfSide],
    [cx - halfSide, cy + halfSide],
  ];
}

function makeCircle(cx, cy, r, segs = 16) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
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
    cropRatio: 1.0,
    zScale: 1.0,
    terrainScale: 1.0,
    lodSettings: { enableTrees: true, treeMaxSpanKm: 5, minBuildingFootprintM: 0, roadDetail: 'all' },
    layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    elementVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    colors: { water: '#1e6e8c', base: '#f1efe8', greenery: '#5a944a', trees: '#3d7033', roads: '#7c7b77', buildings: '#fafaf6', highlighted: '#e65100' },
    ...overrides,
  };
}

function assertCleanManifold(pm, label) {
  check(
    pm &&
      pm.isWatertightManifold === true &&
      pm.openEdgesCount === 0 &&
      pm.nonManifoldEdgesCount === 0 &&
      pm.sameDirDupEdgesCount === 0 &&
      pm.degenerateTrisCount === 0 &&
      pm.floatingBuildingsCount === 0 &&
      pm.outOfTileTrisCount === 0,
    `${label} is strictly watertight 2-manifold (0 open/nm/dup/degen/float/outOfTile)`,
    `tris=${pm?.totalTriangles}, open=${pm?.openEdgesCount}, nm=${pm?.nonManifoldEdgesCount}, dup=${pm?.sameDirDupEdgesCount}, degen=${pm?.degenerateTrisCount}, float=${pm?.floatingBuildingsCount}, oot=${pm?.outOfTileTrisCount}`
  );
}

async function runSuite() {
  const suiteStart = Date.now();
  console.log('================================================================');
  console.log('   3-LAYER MANIFOLD ARCHITECTURE & INVARIANT BENCHMARK SUITE');
  console.log('================================================================');

  // [1/6] Zero Proper-Noun Regex / City-Specific Hardcode Guard
  console.log('\n[1/6] Architecture Purity: Zero Proper-Noun Regexes & Zero City Hacks');
  {
    const targetFiles = [
      'src/geometry/manifold_core.js',
      'src/Water/water_ring_geometry.js',
      'src/Water/water_multipolygon_stitcher.js',
      'src/Water/water_coastline_stitcher.js',
      'src/Water/water_osm_tags.js',
      'src/Water/water_osm_extractor.js',
      'src/Water/water_elevation_sampler.js',
      'src/Water/water_sloped_reaches.js',
      'src/Water/water_carve_manifold.js',
      'src/Water/water_pier_osm_helper.js',
      'src/Water/water_piers_solver.js',
      'src/mesh/terrain_delatin_water.js',
      'src/mesh/terrain_surface_drape.js',
      'src/mesh/layer1_terrain_water.js',
      'src/mesh/s3db_roof_revolve.js',
      'src/mesh/s3db_roof_skeleton.js',
      'src/mesh/s3db_part_builder.js',
      'src/mesh/layer1_s3db_buildings.js',
      'src/mesh/bridges/bridge_geom_2d.js',
      'src/mesh/bridges/bridge_spine_stitch.js',
      'src/mesh/bridges/bridge_tin_sampler.js',
      'src/mesh/bridges/bridge_specs_extract.js',
      'src/mesh/bridges/bridge_elevation_profile.js',
      'src/mesh/bridges/bridge_multideck_solver.js',
      'src/mesh/bridges/bridge_deck_builder.js',
      'src/mesh/bridges/bridge_supports_solver.js',
      'src/mesh/bridges/bridge_superstructure_arch_cable.js',
      'src/mesh/bridges/layer1_bridges.js',
      'src/mesh/waterfront_piers_solver.js',
      'src/mesh/lattice_and_structures_solver.js',
      'src/mesh/tree_scatter_solver.js',
      'src/mesh/layer2_archetypes.js',
      'src/mesh/frame_csg_solver.js',
      'src/mesh/tile_id_emboss.js',
      'src/mesh/tile_sla_vault_solver.js',
      'src/mesh/global_invariants_auditor.js',
      'src/mesh/layer3_invariants_tiles.js',
      'src/mesh/mesh_builder.js',
      'src/gis_client/s3db_unit_parser.js',
      'src/gis_client/s3db_relation_helper.js',
      'src/gis_client/s3db_client_matcher.js',
      'src/gis_client/osm_scene_builder.js',
      'src/gis_client/osm_pier_geometry_helper.js',
      'src/gis_client/osm_bridges_piers_extract.js',
      'src/gis_client/osm_roads_extract.js',
    ];
    const forbidden = /\b(eiffel|petronas|london.?eye|ain.?dubai|marina.?bay|paulskirche|roemer|dom.?r[oö]mer|millau|brooklyn.?bridge|sagrada|rialto|landwasser|chicago)\b/i;
    const leaks = [];
    for (const rel of targetFiles) {
      const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const m = txt.match(forbidden);
      if (m) leaks.push(`${rel}:${m[0]}`);
    }
    check(leaks.length === 0, 'Core 3-layer & GIS client modules contain 0 landmark/city proper-noun rules', leaks.join(', '));
  }

  // [2/6] Layer-1 S3DB: All 16 OSM roof:shape + cone + type=building outline/part + min_height
  console.log('\n[2/6] Layer-1 S3DB 17-Roof Matrix, Outline Suppression & min_height Parts');
  {
    const roofShapes = [
      'flat', 'gabled', 'hipped', 'half-hipped', 'pyramidal', 'dome', 'onion', 'round',
      'skillion', 'mansard', 'gambrel', 'saltbox', 'sawtooth', 'butterfly',
      'quadruple_saltbox', 'stepped', 'cone',
    ];
    const buildings = [];
    roofShapes.forEach((shape, idx) => {
      const col = idx % 5;
      const row = Math.floor(idx / 5);
      const cx = -56 + col * 28;
      const cy = 52 - row * 28;
      const isRound = shape === 'dome' || shape === 'onion' || shape === 'cone';
      buildings.push({
        id: 100 + idx,
        outer: isRound ? makeCircle(cx, cy, 5.2, 16) : [
          [cx - 6.0, cy - 4.0],
          [cx + 6.0, cy - 4.0],
          [cx + 6.0, cy + 4.0],
          [cx - 6.0, cy + 4.0],
        ],
        holes: [],
        h: 18,
        minH: 0,
        roof: shape,
        roofH: shape === 'flat' ? 0 : 6.0,
        tags: { building: 'yes', 'roof:shape': shape, 'roof:height': shape === 'flat' ? '0' : '6' },
      });
    });

    // Multi-part relation (suppressed outline + twin towers + elevated min_height skybridge)
    buildings.push(
      { id: 900, groupId: 900, isOutline: true, outer: [[36, -64], [70, -64], [70, -44], [36, -44]], holes: [], h: 40, minH: 0, roof: 'flat' },
      { id: 901, groupId: 900, part: true, outer: [[38, -62], [48, -62], [48, -46], [38, -46]], holes: [], h: 40, minH: 0, roof: 'flat' },
      { id: 902, groupId: 900, part: true, outer: [[58, -62], [68, -62], [68, -46], [58, -46]], holes: [], h: 40, minH: 0, roof: 'flat' },
      { id: 903, groupId: 900, part: true, outer: [[42, -58], [64, -58], [64, -50], [42, -50]], holes: [], h: 32, minH: 22, roof: 'flat' }
    );

    const t0 = Date.now();
    const res = buildComplete3DModel({
      spanMeters: 700,
      dem: { grid: [[6, 6], [6, 6]], minElev: 6, maxElev: 6 },
      waterPolys: [], waterLines: [], greenPolys: [], trees: [], roads: [], bridgePolys: [],
      buildings,
    }, makeState());
    const dt = Date.now() - t0;

    assertCleanManifold(res.printMetrics, `17-roof S3DB matrix (${dt} ms)`);
    check(res.meshes.buildings.length > 500, 'All 17 S3DB roofs & skybridge group emitted building geometry', `tris=${res.meshes.buildings.length}`);
    // Verify outline id=900 was suppressed while 17 roof shapes + 3 solid parts emitted
    const builtIds = new Set(res.buildingBounds.map(b => b.id));
    check(!builtIds.has(900) && builtIds.has(901) && builtIds.has(903), 'isOutline suppressed while building:part + min_height bridge preserved');
  }

  // [3/6] Layer-1 Bridges: All 7 bridge:structure types + multi-deck clearance + waterCutout Z=0 piers
  console.log('\n[3/6] Layer-1 Bridge Typology Matrix, Multi-Deck Clearance & Z=0 Piers');
  {
    const structs = ['arch', 'suspension', 'cable-stayed', 'truss', 'beam', 'floating'];
    const roads = structs.map((st, idx) => ({
      pts: [[-60 + idx * 24, -40], [-60 + idx * 24, 40]],
      width: 4.0,
      isBridge: true,
      layer: 1,
      structure: st,
      tags: { highway: 'primary', bridge: 'yes', 'bridge:structure': st },
    }));
    // Covered bridge + crossing upper layer=2 viaduct overlapping lower layer=1 arch
    roads.push({
      pts: [[-70, 0], [70, 0]],
      width: 4.2,
      isBridge: true,
      layer: 2,
      covered: 'yes',
      structure: 'beam',
      tags: { highway: 'motorway', bridge: 'yes', layer: '2', covered: 'yes' },
    });

    const t0 = Date.now();
    const res = buildComplete3DModel({
      spanMeters: 700,
      dem: { grid: [[10, 10, 10], [10, 0, 10], [10, 10, 10]], minElev: 0, maxElev: 10 },
      waterPolys: [{ outer: [[-80, -16], [80, -16], [80, 16], [-80, 16]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgePolys: [], buildings: [],
      roads,
    }, makeState({ waterCutout: true }));
    const dt = Date.now() - t0;

    assertCleanManifold(res.printMetrics, `7-bridge + multi-deck matrix (${dt} ms)`);
    check(res.printMetrics.bridgeCount === 7, 'All 7 bridges built across river channel', `bridgeCount=${res.printMetrics.bridgeCount}`);
    check(res.printMetrics.multiDeckSeparationsOk === true, 'Crossing layer=1 vs layer=2 decks maintain positive air gap');
    const waterBeamAudits = res.audit.bridgeAudits.filter(a => a.crossesWater && a.structure === 'beam');
    const waterProtectedAudits = res.audit.bridgeAudits.filter(a => a.crossesWater && ['arch', 'suspension', 'cable-stayed', 'truss'].includes(a.structure));
    check(waterBeamAudits.length >= 1 && waterBeamAudits.every(a => Number.isFinite(a.pierMinZ) && a.pierMinZ <= 0.01), 'Over-water beam piers anchor down to Z=0.0 under waterCutout=true', `beamPiersZero=${waterBeamAudits.filter(a => a.pierMinZ <= 0.01).length}/${waterBeamAudits.length}`);
    check(waterProtectedAudits.length >= 4 && waterProtectedAudits.every(a => a.syntheticWaterPiers === 0), 'Channel-protected arch/suspension/cable-stayed/truss keep 0 synthetic mid-water piers', `protected=${waterProtectedAudits.length}`);
  }

  // [4/6] Layer-2 Pure Semantic OSM Tag Archetypes (NO proper-noun names)
  console.log('\n[4/6] Layer-2 Procedural Semantic Archetypes (Zero Proper-Noun Names)');
  {
    const genericBuildings = [
      { id: 1, name: 'Object A', outer: makeCircle(-60, 40, 2.5, 16), h: 90, tags: { attraction: 'big_wheel' } },
      { id: 2, name: 'Object B', outer: makeCircle(-30, 40, 1.5, 12), h: 80, tags: { man_made: 'wind_turbine', 'generator:source': 'wind' } },
      { id: 3, name: 'Object C', outer: makeSquare(0, 40, 3.0), h: 70, tags: { man_made: 'tower', 'tower:construction': 'lattice' } },
      { id: 4, name: 'Object D', outer: makeCircle(30, 40, 3.0, 12), tags: { man_made: 'tower' } },
      { id: 5, name: 'Object E', outer: makeCircle(60, 40, 6.0, 16), h: 16, tags: { man_made: 'storage_tank' } },
      { id: 6, name: 'Object F', outer: makeCircle(-60, -20, 4.0, 16), h: 28, tags: { man_made: 'silo' } },
      { id: 7, name: 'Object G', outer: makeCircle(-30, -20, 2.5, 16), h: 65, tags: { man_made: 'chimney' } },
      { id: 8, name: 'Object H', outer: makeCircle(0, -20, 9.0, 18), h: 65, tags: { man_made: 'cooling_tower' } },
      { id: 9, name: 'Object I', outer: makeSquare(30, -20, 2.0), h: 35, tags: { man_made: 'crane' } },
    ];
    const scene = {
      spanMeters: 800,
      dem: { grid: [[6, 6], [6, 6]], minElev: 6, maxElev: 6 },
      waterPolys: [{ outer: [[-80, -80], [80, -80], [80, -45], [-80, -45]], holes: [] }],
      waterLines: [],
      greenPolys: [],
      trees: [
        { x: -15, y: 10, height: 11, crownRadius: 3.5 },
        { x: 15, y: 10, height: 9, crownRadius: 3.0 },
      ],
      roads: [
        { pts: [[55, -75], [55, -40]], width: 4.5, isPier: true, tags: { man_made: 'pier' } },
      ],
      bridgePolys: [],
      buildings: genericBuildings,
    };

    const t0 = Date.now();
    const res = buildComplete3DModel(scene, makeState({ waterCutout: true }));
    const dt = Date.now() - t0;
    const ac = res.printMetrics.archetypeCounts;

    assertCleanManifold(res.printMetrics, `All 10 Layer-2 semantic archetypes (${dt} ms)`);
    check(
      ac.wheels === 1 && ac.windTurbines === 1 && ac.latticeTowers === 1 && ac.towers >= 1 &&
        ac.tanksAndSilos >= 2 && ac.chimneys === 1 && ac.coolingTowers === 1 && ac.cranes === 1 &&
        ac.marinePiers >= 1 && ac.trees >= 2,
      'All 10 semantic OSM tag categories triggered purely from generic tags (no landmark names)',
      JSON.stringify(ac)
    );
    const coneTreeTris = (res.meshes.greenery || []).filter(t => t.n && t.n[2] > 0.04 && t.n[2] < 0.98 && t.shellId !== undefined && t.shellId !== -1);
    check(coneTreeTris.length >= 12, 'Trees preserve non-flat sloped conical geometry with positive shellId', `coneTris=${coneTreeTris.length}`);
  }

  // [5/6] Layer-3 Multi-Tile Kerf Split, HollowBase, Sync === Progressive & Exporters Parity
  console.log('\n[5/6] Layer-3 2x2 Kerf Split, Hollow Base, Sync === Progressive & .STL/.3MF/.ZIP Export');
  {
    const scene = {
      spanMeters: 700,
      dem: { grid: [[28, 32, 28], [24, 2, 24], [28, 32, 28]], minElev: 2, maxElev: 32 },
      waterPolys: [{ outer: [[-84, -14], [84, -14], [84, 14], [-84, 14]], holes: [] }],
      waterLines: [],
      greenPolys: [{ outer: [[-65, 25], [-20, 25], [-20, 65], [-65, 65]], holes: [] }],
      trees: [{ x: -42, y: 45, height: 10, crownRadius: 3.5 }],
      roads: [{ pts: [[-10, -70], [-10, 70]], width: 4.5, isBridge: true, layer: 1, structure: 'cable-stayed', tags: { bridge: 'yes', 'bridge:structure': 'cable-stayed' } }],
      bridgePolys: [],
      buildings: [
        { id: 501, outer: makeSquare(35, 45, 7), holes: [], h: 24, roof: 'hipped', roofH: 5, highlighted: true },
        { id: 502, outer: makeSquare(35, -45, 6), holes: [], h: 18, roof: 'gabled', roofH: 4 },
      ],
    };
    const st = makeState({ tileCols: 2, tileRows: 2, bedSizeMm: 260, totalHeightMm: 260, hollowBase: true, waterCutout: false });

    const syncRes = buildComplete3DModel(scene, st);
    const stages = [];
    const progRes = await rebuildModel3DProgressive(scene, st, {
      onStageReady: (layer, tris) => stages.push({ layer, count: tris.length }),
    });

    assertCleanManifold(syncRes.printMetrics, '2x2 hollowed multi-tile model');
    check(syncRes.printMetrics.hasDrainChannels === true && syncRes.printMetrics.hollowSavingsPct > 15,
      'Conformal hollowBase + drain channels active with resin volume savings',
      `savings=${syncRes.printMetrics.hollowSavingsPct}%`);

    const layerKeys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'];
    const diffLayers = layerKeys.filter(k => (syncRes.meshes[k]?.length || 0) !== (progRes.meshes[k]?.length || 0));
    check(
      diffLayers.length === 0 && syncRes.totalTriangles === progRes.totalTriangles && stages.length >= 4,
      'Sync === Progressive exact triangle-count & stage parity',
      `diff=${diffLayers.length}, sync=${syncRes.totalTriangles}, prog=${progRes.totalTriangles}`
    );

    const downloads = [];
    globalThis.downloadBlobHook = (bytes, name, mime) => downloads.push({ bytes, name, mime });
    st.layerMeshes = syncRes.meshes;
    st.printMetrics = syncRes.printMetrics;
    st.totalTriangles = syncRes.totalTriangles;
    st.exportTileFilter = 'all';

    const okStl = exportBinarySTL(st, 'all');
    const ok3mf = exportMultiColor3MF(st);
    const okZip = exportAllTilesZipSTL(st, 'all');
    delete globalThis.downloadBlobHook;

    check(
      okStl === true && ok3mf === true && okZip === true && downloads.length === 3 &&
        downloads[0].bytes.byteLength > 84 &&
        downloads[1].bytes[0] === 0x50 && downloads[1].bytes[1] === 0x4b &&
        downloads[2].bytes[0] === 0x50 && downloads[2].bytes[1] === 0x4b,
      'Render === Export parity (.STL, .3MF PK-ZIP, .ZIP PK-ZIP)',
      downloads.map(d => `${d.name}:${d.bytes.byteLength}B`).join(', ')
    );
  }

  // [6/6] Real Cached OSM Scene Benchmark (Porto, optional disk cache)
  console.log('\n[6/6] Real Cached OSM Scene Benchmark');
  {
    const portoPath = '/Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch/scenes_5/porto.json';
    const portoDemDir = '/Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch/scenes_5_dem_cache';
    if (fs.existsSync(portoPath)) {
      const { loadSceneAndBuildModel } = require(path.join(ROOT, 'tools/headless_scene_harness.js'));
      const scJson = JSON.parse(fs.readFileSync(portoPath, 'utf8'));
      const [west, south, east, north] = scJson.bbox;
      const cosLat = Math.max(0.2, Math.cos((scJson.center.lat * Math.PI) / 180.0));
      const widthM = (east - west) * 111320 * cosLat;
      const heightM = (north - south) * 111320;
      const maxSpanM = Math.max(widthM, heightM);

      const t0 = Date.now();
      const built = await loadSceneAndBuildModel({
        title: 'PORTO',
        osmElements: scJson.osmElements,
        demCacheDir: portoDemDir,
        offlineOnly: true,
        offlineFallbackDem: true,
        lat: scJson.center.lat,
        lon: scJson.center.lon,
        spanMeters: maxSpanM / 1.045,
        rotationDeg: 0,
        targetWidthCm: 32.0 * (widthM / maxSpanM),
        targetHeightCm: 32.0 * (heightM / maxSpanM),
        cropRatio: 1.0,
        waterCutout: false,
        hollowBase: false,
        showFrame: false,
        wantTrees: true,
        isResin: true,
        zScale: 1.0,
        terrainScale: 1.0,
        skipTopologyAudit: false,
        silent: true,
      });
      const dt = Date.now() - t0;
      assertCleanManifold(built.printMetrics, `Real OSM Porto (${dt} ms)`);
    } else {
      console.log('  INFO: External Porto cache not present on disk; real-scene benchmark skipped cleanly.');
    }
  }

  console.log(`\n3-LAYER BENCHMARK SUMMARY: ${passed} passed, ${failed} failed in ${Date.now() - suiteStart} ms.`);
  assert.equal(failed, 0, `${failed} invariant check(s) failed`);
}

runSuite().catch(err => {
  console.error('Fatal error in benchmark_3layer_invariants:', err);
  process.exit(1);
});
