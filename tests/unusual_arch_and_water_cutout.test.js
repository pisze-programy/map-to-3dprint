// tests/unusual_arch_and_water_cutout.test.js
// Comprehensive verification for:
// 1. Water Cutout mode (2-manifold coastline/vault geometry, Z=0 piers, empty sea tile skip, zero regression when OFF)
// 2. Ferris Wheels (Ain Dubai & London Eye S3DB suppression, 3D wheel geometry, sync vs progressive parity)
// 3. Global Unusual S3DB Shapes (Marina Bay Sands Skybridge, Portal Arch, Torus Ring, cached Singapore scene)
// 4. AquaFun "I ♡ EXPO 2020 DUBAI" Pontoon (thin U-stroke + multi-hole incremental splicing)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Minimal DOM & global shims required by browser-oriented modules in Node
global.document = undefined;
global.window = undefined;
global.localStorage = undefined;

const filesToLoad = [
  'src/geometry/polygon_2d.js',
  'src/geometry/obb_medial_2d.js',
  'src/geometry/marching_squares_2d.js',
  'src/mesh/mesh_primitives.js',
  'src/mesh/mesh_clipper_3d.js',
  'src/mesh/roof_shapes.js',
  'src/mesh/roof_architectural.js',
  'src/mesh/terrain_dem_grid.js',
  'src/mesh/mesh_tile_append.js',
  'src/mesh/water_masks.js',
  'src/mesh/features_greenery.js',
  'src/mesh/features_roads.js',
  'src/mesh/features_trees.js',
  'src/mesh/terrain_masks.js',
  'src/mesh/features_water.js',
  'src/mesh/terrain_base_water.js',
  'src/mesh/features_roads_parks.js',
  'src/mesh/features_bridges.js',
  'src/mesh/buildings_prepare.js',
  'src/mesh/buildings_s3db.js',
  'src/mesh/mesh_topology.js',
  'src/mesh/mesh_builder.js',
  'src/export/crc32_zip.js',
  'src/export/stl_writer.js',
  'src/export/zip_packager.js',
  'src/ui/ui_config.js',
  'src/gis_client/overpass_chunk_grid.js',
  'src/gis_client/overpass_dem_fetch.js',
  'src/gis_client/s3db_client_matcher.js',
  'src/gis_client/osm_bridges_piers_extract.js',
  'src/gis_client/osm_buildings_extract.js',
  'src/gis_client/osm_scene_builder.js'
];

for (const relPath of filesToLoad) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  (0, eval)(code);
}

let passed = 0;
let failed = 0;

function check(cond, name, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeBaseState(overrides = {}) {
  return {
    plaqueText: 'TEST_SCENE',
    bedSizeMm: 250,
    totalHeightMm: 250,
    tileCols: 1,
    tileRows: 1,
    isResin: true,
    printerPreset: 'photon_mono_4',
    xyPixelMm: 0.035,
    layerHeightMm: 0.05,
    hollowBase: true,
    hollowWallMm: 1.8,
    waterCutout: false,
    exportFrame: false,
    showFrame: true,
    zScale: 1.25,
    terrainScale: 1.15,
    cropRatio: 0.88,
    cropCenterX: 0,
    cropCenterY: 0,
    kerfMm: 0.08,
    layerVisible: {
      water: true,
      base: true,
      greenery: true,
      roads: true,
      buildings: true,
      highlighted: true
    },
    lodSettings: {
      minBuildingFootprintM: 0,
      enableTrees: true,
      treeMaxSpanKm: 4.0,
      roadDetail: 'all'
    },
    ...overrides
  };
}

function makeCoastalBridgeScene({ demRelief = false } = {}) {
  const grid = Array.from({ length: 16 }, (_, ry) =>
    Array.from({ length: 16 }, (__, rx) => {
      if (!demRelief) return rx < 8 ? 0 : 12;
      return rx < 7 ? 0 : (10 + (rx - 7) * 8 + ry * 1.5);
    })
  );
  return {
    title: 'COASTAL_TEST',
    spanMeters: 1500,
    metersToUnits: 200 / 1500,
    halfW: 100,
    halfH: 100,
    dem: {
      gridSize: 16,
      minElev: 0,
      maxElev: demRelief ? 95 : 12,
      grid
    },
    waterPolys: [
      {
        // Entire western half (x < 0) + strip (+6) + eastern cove (+14 around y=-24..+24) is water,
        // leaving NW quadrant R1C1 (x<0, y>0) 100% open ocean while SW R2C1 has the island & pier.
        outer: [
          [-110, -110], [6, -110], [6, -24], [14, -24], [14, 24], [6, 24], [6, 110], [-110, 110]
        ],
        holes: [
          [[-68, -68], [-32, -68], [-32, -32], [-68, -32]]
        ]
      }
    ],
    waterLines: [],
    greenPolys: [
      { outer: [[24, 24], [65, 24], [65, 65], [24, 65]], holes: [] }
    ],
    trees: [],
    roads: [
      {
        hwy: 'primary',
        isBridge: true,
        pts: [[-50, -35], [-20, -25], [18, -25], [45, -25]],
        width: 1.4
      },
      {
        hwy: 'residential',
        isBridge: false,
        pts: [[20, -75], [20, 75]],
        width: 1.2
      },
      // Offshore breakwater pier in SW quadrant (R2C1), leaving NW quadrant (R1C1) 100% open water
      {
        man_made: 'pier',
        floating: true,
        pts: [[-45, -18], [-20, -18]],
        width: 1.0
      }
    ],
    roadPolys: [],
    bridgePolys: [],
    buildings: [
      {
        id: 1,
        outer: [[25, -55], [48, -55], [48, -32], [25, -32]],
        holes: [],
        height: 28,
        minH: 0,
        roof: 'flat'
      },
      {
        id: 2,
        outer: [[-56, -56], [-42, -56], [-42, -42], [-56, -42]],
        holes: [],
        height: 18,
        minH: 0,
        roof: 'flat'
      }
    ]
  };
}

function signedMeshVolume(tris) {
  let vol = 0;
  for (let i = 0; i < tris.length; i++) {
    const { v0, v1, v2 } = tris[i];
    const cx = v1[1] * v2[2] - v1[2] * v2[1];
    const cy = v1[2] * v2[0] - v1[0] * v2[2];
    const cz = v1[0] * v2[1] - v1[1] * v2[0];
    vol += (v0[0] * cx + v0[1] * cy + v0[2] * cz) / 6.0;
  }
  return Math.abs(vol);
}

(async function main() {
  console.log('\n[1/4] Water Cutout Mode, Bridge Piers at Z=0 & Empty Sea Tile ZIP Skip');
  {
    const scene = makeCoastalBridgeScene({ demRelief: false });

    const offRes = buildComplete3DModel(scene, makeBaseState({ waterCutout: false, hollowBase: true, tileCols: 2, tileRows: 2 }), { isExport: true });
    const offPm = offRes.printMetrics;
    check(offRes.meshes.water.length > 0, 'waterCutout=false emits full water mesh', `waterTris=${offRes.meshes.water.length}`);
    check(offPm.isWatertightManifold && offPm.openEdges === 0 && offPm.nonManifoldEdges === 0, 'waterCutout=false 2x2 is strictly 2-manifold', `open=${offPm.openEdges}, nm=${offPm.nonManifoldEdges}`);

    for (const cfg of [
      { name: 'solid_1x1', hollowBase: false, tileCols: 1, tileRows: 1, demRelief: false, isExport: false },
      { name: 'hollow_1x1_export', hollowBase: true, tileCols: 1, tileRows: 1, demRelief: false, isExport: true },
      { name: 'hollow_2x2_export', hollowBase: true, tileCols: 2, tileRows: 2, demRelief: false, isExport: true },
      { name: 'alpine_hollow_2x2_export', hollowBase: true, tileCols: 2, tileRows: 2, demRelief: true, isExport: true }
    ]) {
      const sc = makeCoastalBridgeScene({ demRelief: cfg.demRelief });
      const st = makeBaseState({ waterCutout: true, hollowBase: cfg.hollowBase, tileCols: cfg.tileCols, tileRows: cfg.tileRows });
      const res = buildComplete3DModel(sc, st, { isExport: cfg.isExport });
      const pm = res.printMetrics;
      check(res.meshes.water.length === 0, `${cfg.name}: meshes.water empty`, `count=${res.meshes.water.length}`);
      check(
        pm.openEdges === 0 && pm.nonManifoldEdges === 0 && pm.sameDirDupEdges === 0 && pm.degenerateTrisCount === 0,
        `${cfg.name}: base+features 0 open/non-manifold/dup/degen edges`,
        `open=${pm.openEdges}, nm=${pm.nonManifoldEdges}, dup=${pm.sameDirDupEdges}, degen=${pm.degenerateTrisCount}`
      );
      check(pm.outOfTileTrisCount === 0 && pm.floatingBuildingsCount === 0, `${cfg.name}: 0 out-of-tile & 0 floating buildings`, `out=${pm.outOfTileTrisCount}, float=${pm.floatingBuildingsCount}`);
      check(pm.isWatertightManifold === true, `${cfg.name}: isWatertightManifold=true`);

      // Check that water piers/pontoons reach Z = 0.0 under waterCutout=true
      let roadMinZ = Infinity;
      for (const t of res.meshes.roads) {
        const mz = Math.min(t.v0[2], t.v1[2], t.v2[2]);
        if (mz < roadMinZ) roadMinZ = mz;
      }
      check(roadMinZ <= 1e-4, `${cfg.name}: offshore piers/bridge piers seated at Z=0`, `minZ=${roadMinZ.toFixed(4)}`);
    }

    // Empty sea tile omission in ZIP packager (tileCols=2, tileRows=2 -> NorthWest tile R1C1 is open sea!)
    const zipSc = makeCoastalBridgeScene({ demRelief: false });
    const zipState = makeBaseState({ waterCutout: true, hollowBase: true, tileCols: 2, tileRows: 2 });
    const zipRes = buildComplete3DModel(zipSc, zipState, { isExport: true });
    zipState.layerMeshes = zipRes.meshes;
    zipState.printMetrics = zipRes.printMetrics;

    let capturedFiles = null;
    const origCreateZip = global.createZipArchive;
    const origDownloadBlob = global.downloadBlob;
    global.createZipArchive = (files) => { capturedFiles = files; return new Uint8Array([1, 2, 3]); };
    global.downloadBlob = () => {};
    exportAllTilesZipSTL(zipState, 'all');
    global.createZipArchive = origCreateZip;
    global.downloadBlob = origDownloadBlob;

    const stlFiles = (capturedFiles || []).filter(f => f.name.endsWith('.stl'));
    const readmeFile = (capturedFiles || []).find(f => f.name === 'README.txt');
    check(stlFiles.length === 3, 'ZIP omits 100% open-water R1C1 tile under waterCutout=true', `stlCount=${stlFiles.length} (${stlFiles.map(f => f.name).join(', ')})`);
    check(
      readmeFile && readmeFile.content.includes('POMINIĘTO — 100% wycięta woda') && readmeFile.content.includes('Wycięcie wody (Cutout):      TAK'),
      'ZIP README logs omitted water tile & cutout status'
    );
  }

  console.log('\n[2/4] Ferris Wheels (Ain Dubai & London Eye) Suppression, 3D Geometry & Sync/Progressive Parity');
  {
    const qlDetail = buildAdaptiveOverpassQL(51.500, -0.125, 51.508, -0.114, 'detail');
    const qlUrban = buildAdaptiveOverpassQL(51.500, -0.125, 51.508, -0.114, 'urban');
    const qlRegional = buildAdaptiveOverpassQL(51.500, -0.125, 51.508, -0.114, 'regional');
    check(
      qlDetail.includes('big_wheel|observation_wheel|ferris_wheel') &&
      qlUrban.includes('big_wheel|observation_wheel|ferris_wheel') &&
      qlRegional.includes('big_wheel|observation_wheel|ferris_wheel'),
      'Overpass QL (detail/urban/regional) includes Ferris wheel attraction tags'
    );

    // Simulate OSM Ain Dubai + London Eye relation extraction via s3db_client_matcher
    const matcher = createS3DBClientCollector(80, 80, 200 / 1600);
    // Parent observation wheel with elevated slices (simulating London Eye filling bug if parent isn't suppressed!)
    const wheelBox = [[-8, -1.5], [8, -1.5], [8, 1.5], [-8, 1.5]];
    const plinthBox = [[-4.5, -1.2], [4.5, -1.2], [4.5, 1.2], [-4.5, 1.2]];
    matcher.registerCandidate(9001, { name: 'London Eye', attraction: 'big_wheel', height: '135', building: 'yes' }, wheelBox, [], false, 9001, true);
    matcher.registerCandidate(900101, { 'building:part': 'yes', height: '2', min_height: '0', location: 'surface' }, plinthBox, [], true, 9001, true);
    matcher.registerCandidate(900102, { 'building:part': 'yes', height: '135', min_height: '15' }, [[-6, -1], [6, -1], [6, 1], [-6, 1]], [], true, 9001, true);
    matcher.registerCandidate(900103, { 'building:part': 'yes', height: '130', min_height: '20' }, [[-3, -1], [3, -1], [3, 1], [-3, 1]], [], true, 9001, true);
    // Also a synthetic multi-part Arc de Triomphe parent where only pier bases touch ground (< 40% groundCov)
    const archParent = [[20, -5], [32, -5], [32, 5], [20, 5]];
    matcher.registerCandidate(9002, { name: 'Arc Portal', height: '50', building: 'yes' }, archParent, [], false, 9002, false);
    matcher.registerCandidate(900201, { 'building:part': 'yes', height: '50', min_height: '0' }, [[20, -5], [24, -5], [24, 5], [20, 5]], [], true, 9002, false);
    matcher.registerCandidate(900202, { 'building:part': 'yes', height: '50', min_height: '0' }, [[28, -5], [32, -5], [32, 5], [28, 5]], [], true, 9002, false);
    matcher.registerCandidate(900203, { 'building:part': 'yes', height: '50', min_height: '32' }, [[20, -5], [32, -5], [32, 5], [20, 5]], [], true, 9002, false);

    const outMatched = matcher.resolveAndEmitS3DBBuildings(false);
    const parent9001 = outMatched.find(b => b.groupId === 9001 && !b.part && b.archType !== 'ferris_wheel');
    const wheel9001 = outMatched.find(b => b.groupId === 9001 && b.archType === 'ferris_wheel');
    const parent9002 = outMatched.find(b => b.groupId === 9002 && !b.part);
    check(Boolean(wheel9001) && !parent9001, 'S3DB matcher emits single ferris_wheel & suppresses parent solid wall for London Eye', `matched=${outMatched.length}`);
    check(!parent9002, 'S3DB matcher suppresses portal-arch parent outline via allCov >= 0.72');

    // Twin-polygon deduplication: wide building=yes outline + shifted thin attraction=big_wheel rim + _nameInherited part + Ticket Office
    const twinMatcher = createS3DBClientCollector(80, 80, 200 / 1600);
    twinMatcher.registerCandidate(9101, { name: 'London Eye', building: 'yes', height: '135' }, [[-11, -5], [11, -5], [11, 5], [-11, 5]], [], false, null, false);
    twinMatcher.registerCandidate(9102, { name: 'London Eye', attraction: 'big_wheel', building: 'yes' }, [[-11, 1.5], [11, 1.5], [11, 3.5], [-11, 3.5]], [], false, null, false);
    twinMatcher.registerCandidate(9103, { name: 'London Eye', _nameInherited: true, 'building:part': 'yes', height: '130', min_height: '15' }, [[-9, 1.6], [9, 1.6], [9, 3.4], [-9, 3.4]], [], true, null, false);
    twinMatcher.registerCandidate(9104, { name: 'London Eye Ticket Office', building: 'yes', height: '5' }, [[8, -6.5], [12, -6.5], [12, -4.5], [8, -4.5]], [], false, null, false);

    const twinOut = twinMatcher.resolveAndEmitS3DBBuildings(false);
    const twinWheels = twinOut.filter(b => b.archType === 'ferris_wheel');
    const ticketOffice = twinOut.find(b => b.name === 'London Eye Ticket Office');
    check(twinWheels.length === 1, 'Twin-polygon wheel complex emits strictly 1 ferris_wheel', `count=${twinWheels.length}, total=${twinOut.length}`);
    check(
      twinWheels.length === 1 && Math.abs(twinWheels[0].cy - 2.5) < 0.25 && twinWheels[0].h === 135,
      'Consolidated wheel selects thin attraction=big_wheel rim center & harvests h=135',
      twinWheels[0] ? `cy=${twinWheels[0].cy.toFixed(2)}, h=${twinWheels[0].h}` : 'none'
    );
    check(
      Boolean(ticketOffice) && ticketOffice.archType === null && ticketOffice.h === 5 && twinOut.length === 2,
      'Auxiliary ground building (London Eye Ticket Office) stays regular building while duplicate outline/part suppressed',
      `total=${twinOut.length}, officeArch=${ticketOffice && ticketOffice.archType}`
    );

    // Full 3D scene with London Eye + Ain Dubai crossing 2x2 tile boundary!
    const wheelScene = {
      title: 'WHEEL_PARITY',
      spanMeters: 1600,
      metersToUnits: 200 / 1600,
      halfW: 100,
      halfH: 100,
      dem: { gridSize: 8, minElev: 0, maxElev: 10, grid: Array.from({ length: 8 }, () => Array(8).fill(5)) },
      waterPolys: [],
      waterLines: [],
      greenPolys: [],
      trees: [],
      roads: [],
      roadPolys: [],
      bridgePolys: [],
      buildings: [
        // London Eye positioned right across vertical tile seam x = 0!
        {
          id: 5001,
          groupId: 5001,
          name: 'London Eye',
          archType: 'ferris_wheel',
          outer: [[-2.0, -7.5], [2.0, -7.5], [2.0, 7.5], [-2.0, 7.5]],
          holes: [],
          h: 135,
          minH: 0,
          roof: 'flat'
        },
        // Ain Dubai standing strictly on tile x = +35, y = 0
        {
          id: 5002,
          groupId: 5002,
          name: 'Ain Dubai',
          archType: 'ferris_wheel',
          outer: [[30, -2.5], [50, -2.5], [50, 2.5], [30, 2.5]],
          holes: [],
          h: 250,
          minH: 0,
          roof: 'flat'
        }
      ]
    };

    const st2 = makeBaseState({ tileCols: 2, tileRows: 2, hollowBase: true, waterCutout: false });
    const syncWheelRes = buildComplete3DModel(wheelScene, st2, { isExport: true });
    const progWheelRes = await rebuildModel3DProgressive(wheelScene, { ...st2 }, { isExport: true });

    check(syncWheelRes.meshes.buildings.length > 0, 'Ferris wheels produce 3D triangles', `tris=${syncWheelRes.meshes.buildings.length}`);
    check(
      syncWheelRes.meshes.buildings.length === progWheelRes.meshes.buildings.length,
      'London Eye / Ain Dubai sync vs progressive exact tri count parity (never fills solid at finish)',
      `sync=${syncWheelRes.meshes.buildings.length}, prog=${progWheelRes.meshes.buildings.length}`
    );
    check(
      syncWheelRes.printMetrics.isWatertightManifold &&
      progWheelRes.printMetrics.isWatertightManifold &&
      progWheelRes.printMetrics.floatingBuildingsCount === 0 &&
      progWheelRes.printMetrics.outOfTileTrisCount === 0,
      'Multi-tile split Ferris wheel is 100% 2-manifold with 0 floating shells & 0 out-of-tile',
      `open=${progWheelRes.printMetrics.openEdges}, nm=${progWheelRes.printMetrics.nonManifoldEdges}, float=${progWheelRes.printMetrics.floatingBuildingsCount}`
    );

    // Confirm Ain Dubai mesh volume is a hollow wheel (< 25% of solid scaled 20x5 OBB box at cropRatio=0.88)
    const ainTris = syncWheelRes.meshes.buildings.filter(t => t.v0[0] > 10);
    let ainMinZ = Infinity, ainMaxZ = -Infinity;
    for (const t of ainTris) {
      ainMinZ = Math.min(ainMinZ, t.v0[2], t.v1[2], t.v2[2]);
      ainMaxZ = Math.max(ainMaxZ, t.v0[2], t.v1[2], t.v2[2]);
    }
    const bedScale = 1.0 / (st2.cropRatio || 0.88);
    const solidObbVol = (20.0 * bedScale) * (5.0 * bedScale) * Math.max(1.0, ainMaxZ - ainMinZ);
    const actualAinVol = signedMeshVolume(ainTris);
    check(actualAinVol < solidObbVol * 0.25 && actualAinVol > 0, 'Ain Dubai wheel volume < 25% of solid wall prism (hollow wheel confirmed)', `vol=${actualAinVol.toFixed(1)} vs obb=${solidObbVol.toFixed(1)}`);

    // Verify wide OBB halfW=8 does NOT bloat wheel axial thickness; stays < 0.35 * R and watertight manifold
    const wideWheelScene = {
      title: 'WIDE_HALF_W_WHEEL',
      spanMeters: 1600,
      metersToUnits: 200 / 1600,
      halfW: 100,
      halfH: 100,
      dem: { gridSize: 8, minElev: 0, maxElev: 10, grid: Array.from({ length: 8 }, () => Array(8).fill(5)) },
      waterPolys: [],
      waterLines: [],
      greenPolys: [],
      trees: [],
      roads: [],
      roadPolys: [],
      buildings: [
        {
          id: 1,
          outer: [[-10, -8], [10, -8], [10, 8], [-10, 8]],
          holes: [],
          h: 250,
          minH: 0,
          roof: 'flat',
          roofH: 0,
          archType: 'ferris_wheel',
          name: 'Wide Ain Dubai'
        }
      ]
    };
    const wideSt = makeBaseState({ bedSizeMm: 250, totalHeightMm: 250, tileCols: 1, tileRows: 1, cropRatio: 0.88, hollow: true });
    const wideRes = buildComplete3DModel(wideWheelScene, wideSt, { isExport: false });
    let wMinX = Infinity, wMaxX = -Infinity, wMinY = Infinity, wMaxY = -Infinity, wMinZ = Infinity, wMaxZ = -Infinity;
    for (const t of wideRes.meshes.buildings) {
      for (const v of [t.v0, t.v1, t.v2]) {
        if (v[0] < wMinX) wMinX = v[0]; if (v[0] > wMaxX) wMaxX = v[0];
        if (v[1] < wMinY) wMinY = v[1]; if (v[1] > wMaxY) wMaxY = v[1];
        if (v[2] < wMinZ) wMinZ = v[2]; if (v[2] > wMaxZ) wMaxZ = v[2];
      }
    }
    const wideRadiusApprox = (wMaxX - wMinX) * 0.5;
    const wideAxialSpan = wMaxY - wMinY;
    check(
      wideRes.meshes.buildings.length > 0 && wideAxialSpan < wideRadiusApprox * 0.35 && wideRes.printMetrics.isWatertightManifold === true,
      'Wide-halfW (8 units) observation wheel decouples axial span < 0.35*R & stays watertight manifold',
      `axialSpan=${wideAxialSpan.toFixed(2)}, R=${wideRadiusApprox.toFixed(2)}, manifold=${wideRes.printMetrics.isWatertightManifold}, open=${wideRes.printMetrics.openEdges}, nm=${wideRes.printMetrics.nonManifoldEdges}`
    );
  }

  console.log('\n[3/4] Global Unusual Architectural Archetypes & Cached Singapore Marina Bay Scene');
  {
    const sgPath = path.join(ROOT, 'cache/scene_v3_1.2810_103.8487_1.2926_103.8603.json');
    if (fs.existsSync(sgPath)) {
      const sgScene = JSON.parse(fs.readFileSync(sgPath, 'utf8'));
      const sgOff = buildComplete3DModel(sgScene, makeBaseState({ bedSizeMm: 250, totalHeightMm: 250, tileCols: 2, tileRows: 2, waterCutout: false }), { isExport: false });
      const sgOn = buildComplete3DModel(sgScene, makeBaseState({ bedSizeMm: 250, totalHeightMm: 250, tileCols: 2, tileRows: 2, waterCutout: true }), { isExport: false });
      check(
        sgOff.printMetrics.isWatertightManifold && sgOff.printMetrics.floatingBuildingsCount === 0,
        'Real cached Singapore Marina Bay (waterCutout=false) is 2-manifold with 0 floating shells',
        `open=${sgOff.printMetrics.openEdges}, nm=${sgOff.printMetrics.nonManifoldEdges}, float=${sgOff.printMetrics.floatingBuildingsCount}`
      );
      check(
        sgOn.printMetrics.isWatertightManifold && sgOn.printMetrics.floatingBuildingsCount === 0 && sgOn.meshes.water.length === 0,
        'Real cached Singapore Marina Bay (waterCutout=true) is 2-manifold with 0 floating shells',
        `open=${sgOn.printMetrics.openEdges}, nm=${sgOn.printMetrics.nonManifoldEdges}, float=${sgOn.printMetrics.floatingBuildingsCount}`
      );
    }

    // Synthetic Skybridge + Monumental Portal Arch + Torus Ring courtyard scene
    const archScene = {
      title: 'GLOBAL_ARCH',
      spanMeters: 1200,
      metersToUnits: 200 / 1200,
      halfW: 100,
      halfH: 100,
      dem: { gridSize: 8, minElev: 0, maxElev: 10, grid: Array.from({ length: 8 }, () => Array(8).fill(5)) },
      waterPolys: [],
      waterLines: [],
      greenPolys: [],
      trees: [],
      roads: [],
      roadPolys: [],
      bridgePolys: [],
      buildings: [
        // Marina Bay Sands style 3 towers + elevated SkyPark spanning across them!
        { id: 7001, groupId: 700, part: true, outer: [[-26, -3], [-18, -3], [-18, 3], [-26, 3]], holes: [], h: 65, minH: 0, roof: 'flat' },
        { id: 7002, groupId: 700, part: true, outer: [[-4, -3], [4, -3], [4, 3], [-4, 3]], holes: [], h: 65, minH: 0, roof: 'flat' },
        { id: 7003, groupId: 700, part: true, outer: [[18, -3], [26, -3], [26, 3], [18, 3]], holes: [], h: 65, minH: 0, roof: 'flat' },
        // SkyPark WITHOUT same groupId (standalone elevated way touching in 2D) -> tests polygonsOverlap2D minH > 0 fix!
        { id: 7004, groupId: 701, part: false, outer: [[-32, -4], [32, -4], [32, 4], [-32, 4]], holes: [], h: 73, minH: 63, roof: 'flat' },

        // Monumental Portal Arch (Dubai Frame / Arc de Triomphe)
        { id: 7011, groupId: 710, part: true, outer: [[-60, 20], [-54, 20], [-54, 28], [-60, 28]], holes: [], h: 52, minH: 0, roof: 'flat' },
        { id: 7012, groupId: 710, part: true, outer: [[-42, 20], [-36, 20], [-36, 28], [-42, 28]], holes: [], h: 52, minH: 0, roof: 'flat' },
        { id: 7013, groupId: 710, part: true, outer: [[-60, 20], [-36, 20], [-36, 28], [-60, 28]], holes: [], h: 60, minH: 48, roof: 'flat' },

        // Torus / Ring Building with Courtyard Hole
        {
          id: 7020,
          outer: [[35, 30], [58, 30], [58, 52], [35, 52]],
          holes: [[[41, 36], [52, 36], [52, 46], [41, 46]]],
          h: 38,
          minH: 0,
          roof: 'flat'
        }
      ]
    };

    const stArch = makeBaseState({ hollowBase: true, tileCols: 1, tileRows: 1 });
    const archSync = buildComplete3DModel(archScene, stArch, { isExport: true });
    const archProg = await rebuildModel3DProgressive(archScene, { ...stArch }, { isExport: true });
    check(
      archSync.printMetrics.isWatertightManifold &&
      archSync.printMetrics.floatingBuildingsCount === 0 &&
      archSync.meshes.buildings.length === archProg.meshes.buildings.length,
      'Global S3DB skybridge + portal arch + torus ring 2-manifold, 0 floating & sync=prog parity',
      `tris=${archSync.meshes.buildings.length}, float=${archSync.printMetrics.floatingBuildingsCount}`
    );
  }

  console.log('\n[4/4] AquaFun "I ♡ EXPO 2020 DUBAI" Pontoon & Multi-Hole Extraction');
  {
    const meterToU = 200 / 1600;

    // Build an AquaFun multipolygon pontoon (bar + letters with 5 valid holes + 1 degenerate boundary hole)
    const outerBarAndLetters = [
      [-35, -3], [35, -3], [35, 7], [28, 7], [28, 1], [23, 1], [23, 7],
      [-23, 7], [-23, 1], [-28, 1], [-28, 7], [-35, 7]
    ];
    const goodHole1 = [[-20, 2], [-15, 2], [-15, 5], [-20, 5]];
    const goodHole2 = [[-12, 2], [-7, 2], [-7, 5], [-12, 5]];
    const goodHole3 = [[-4, 2], [1, 2], [1, 5], [-4, 5]];
    const goodHole4 = [[4, 2], [9, 2], [9, 5], [4, 5]];
    const goodHole5 = [[12, 2], [18, 2], [18, 5], [12, 5]];
    // Bad hole whose centroid lies inside outerBarAndLetters but whose south edge straddles outside y = -3
    const badHoleTouching = [[19.5, -3.5], [22.0, -3.5], [22.0, 5.0], [19.5, 5.0]];

    const ctxExt = {
      nodesToPts: (ids, tol) => ids,
      usedWays: new Set(),
      bridgePolys: [],
      pierPolys: [],
      pierLines: [],
      metersToUnits: meterToU,
      stitchedRelPolys: new Map([
        [7701, {
          outerPolys: [outerBarAndLetters],
          innerPolys: [goodHole1, goodHole2, goodHole3, goodHole4, goodHole5, badHoleTouching],
          memberWayIds: [8800]
        }]
      ])
    };

    const relAdded = processOsmBridgeMultipolygonJS(
      { id: 7701 },
      { man_made: 'pier', pier: 'pontoon', floating: 'yes', name: 'AquaFun' },
      {},
      ctxExt
    );

    // Also add standalone narrow "U"-shaped letter pontoon with thin inner-slot gap (5e-4 units!)
    const narrowUPontoon = [
      [40.0, 0.0], [43.0, 0.0], [43.0, 4.0], [42.2, 4.0],
      [42.2, 0.8005], [40.8, 0.8005], [40.8, 4.0], [40.0, 4.0]
    ];
    const uWayAdded = processOsmBridgeOrPierWayJS(
      8801,
      {},
      { man_made: 'pier', pier: 'pontoon', floating: 'yes', area: 'yes', name: 'U' },
      narrowUPontoon,
      true,
      ctxExt
    );

    check(relAdded && uWayAdded && ctxExt.pierPolys.length >= 2, 'Extracted AquaFun multi-hole pontoon + narrow U pontoon', `piers=${ctxExt.pierPolys.length}`);
    check(ctxExt.pierPolys[0].holes.length === 6, 'Inner holes matched robustly via _ringInsideOuterExtract2D', `holes=${ctxExt.pierPolys[0].holes.length}`);

    const aquaScene = {
      title: 'AQUAFUN_DUBAI',
      spanMeters: 1600,
      metersToUnits: meterToU,
      halfW: 100,
      halfH: 100,
      dem: { gridSize: 8, minElev: 0, maxElev: 5, grid: Array.from({ length: 8 }, (_, ry) => Array.from({ length: 8 }, (__, rx) => (ry < 5 ? 0 : 4))) },
      waterPolys: [{ outer: [[-110, -110], [110, -110], [110, 12], [-110, 12]], holes: [] }],
      waterLines: [],
      greenPolys: [],
      trees: [],
      roads: [],
      roadPolys: [],
      bridgePolys: ctxExt.bridgePolys,
      buildings: []
    };

    const aqOff = buildComplete3DModel(aquaScene, makeBaseState({ waterCutout: false }), { isExport: true });
    const aqOn = buildComplete3DModel(aquaScene, makeBaseState({ waterCutout: true }), { isExport: true });

    // Confirm narrow U-stroke (x in [39..44]) emitted into meshes.roads AND seated at Z=0 when waterCutout=true
    const uTrisOn = aqOn.meshes.roads.filter(t => t.v0[0] >= 38 && t.v0[0] <= 45);
    let uMinZ = Infinity;
    for (const t of uTrisOn) uMinZ = Math.min(uMinZ, t.v0[2], t.v1[2], t.v2[2]);

    // Confirm good holes produced interior vertical hole walls even when 1 bad hole was present
    const aquaBarVertTris = aqOn.meshes.roads.filter(t => t.v0[0] < 36 && Math.abs(t.n[2]) < 0.2);

    check(uTrisOn.length > 0 && uMinZ <= 1e-4, 'Narrow U pontoon emitted & seated on Z=0 in waterCutout=true', `uTris=${uTrisOn.length}, minZ=${uMinZ.toFixed(4)}`);
    check(aquaBarVertTris.length >= 24, 'Good inner letter holes preserved (not wiped out by 1 invalid hole)', `wallTris=${aquaBarVertTris.length}`);
    check(
      aqOff.printMetrics.isWatertightManifold && aqOn.printMetrics.isWatertightManifold,
      'AquaFun multi-hole pontoon is 2-manifold both with waterCutout OFF and ON',
      `offOpen=${aqOff.printMetrics.openEdges}, onOpen=${aqOn.printMetrics.openEdges}, onNm=${aqOn.printMetrics.nonManifoldEdges}`
    );
  }

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
})();
