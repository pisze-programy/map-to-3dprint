// ============================================================================
// tests/video_studio_parity.test.js
// SLA PARITY, SHADER CONSISTENCY, WATER CUTOUT & ANIMATION MATH AUDIT TESTS
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// Minimal DOM & Browser Globals for headless Node execution
global.document = undefined;
global.window = undefined;
global.localStorage = undefined;
global.navigator = { userAgent: 'node-test' };
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

const CORE_FILES_IN_ORDER = [
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
  'src/render/webgl_math.js',
  'src/ui/ui_config.js',
  'src/ui/map_rotation.js',
  'src/ui/fast_render_manager.js',
  'src/ui/ui_map2d.js'
];

for (const rel of CORE_FILES_IN_ORDER) {
  const fullPath = path.join(ROOT, rel);
  const code = fs.readFileSync(fullPath, 'utf8');
  vm.runInThisContext(code, { filename: fullPath });
}

const VIDEO_FILES_IN_ORDER = [
  'src/video/video_config.js',
  'src/video/video_math_mesh.js',
  'src/video/video_shaders.js',
  'src/video/video_shader_main_fs.js',
  'src/video/video_frame_builder.js',
  'src/video/video_timeline_2d.js',
  'src/video/video_recorder.js',
  'src/video/video_gl_engine.js',
  'src/video/ui_video_map_gis.js',
  'src/video/ui_video_order_demo.js'
];

const videoMods = {};
for (const rel of VIDEO_FILES_IN_ORDER) {
  const fullPath = path.join(ROOT, rel);
  const mod = require(fullPath);
  videoMods[path.basename(rel, '.js')] = mod;
  Object.assign(global, mod);
}

let passCount = 0;
let failCount = 0;

function check(cond, name, detail = '') {
  if (cond) {
    passCount++;
    console.log(`  [PASS] ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function getTriBounds(tris) {
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  return { count: tris.length, minZ, maxZ, minX, maxX };
}

function makeFullSyntheticCityScene() {
  const grid = Array.from({ length: 16 }, (_, ry) =>
    Array.from({ length: 16 }, (__, rx) => {
      if (rx >= 6 && rx <= 9) return 0; // river valley
      return 6 + Math.abs(rx - 7.5) * 1.8 + ry * 0.4;
    })
  );

  return {
    title: 'PARITY_CITY',
    lat: 51.5033,
    lon: -0.1195,
    spanMeters: 1200,
    metersToUnits: 200 / 1200,
    halfW: 100,
    halfH: 100,
    _fetchedCropRatio: 0.88,
    dem: {
      gridSize: 16,
      minElev: 0,
      maxElev: 28,
      grid
    },
    waterPolys: [
      {
        outer: [[-18, -110], [18, -110], [18, 110], [-18, 110]],
        holes: []
      }
    ],
    waterLines: [],
    greenPolys: [
      {
        type: 'park',
        outer: [[26, 20], [82, 20], [82, 82], [26, 82]],
        holes: [[[45, 42], [58, 42], [58, 55], [45, 55]]]
      }
    ],
    trees: [
      [34, 28, 9],
      [42, 28, 10],
      [66, 28, 9],
      [72, 66, 11],
      [35, 68, 9],
      [68, 45, 10]
    ],
    roads: [
      {
        hwy: 'primary',
        isBridge: true,
        pts: [[-45, 0], [-15, 0], [15, 0], [45, 0]],
        width: 2.0
      },
      {
        hwy: 'residential',
        isBridge: false,
        pts: [[-60, -70], [-60, 70]],
        width: 1.5
      }
    ],
    roadPolys: [],
    bridgePolys: [],
    buildings: [
      // Courtyard ring building (id: 101 -> highlighted)
      {
        id: 101,
        outer: [[-75, 25], [-40, 25], [-40, 62], [-75, 62]],
        holes: [[[-65, 35], [-50, 35], [-50, 52], [-65, 52]]],
        h: 32,
        minH: 0,
        roof: 'gabled',
        roofH: 4,
        name: 'Highlighted Courtyard'
      },
      // Observation Ferris wheel landmark next to river
      {
        id: 102,
        outer: [[-28, -28], [-20, -28], [-20, -10], [-28, -10]],
        holes: [],
        h: 135,
        minH: 0,
        roof: 'flat',
        roofH: 0,
        archType: 'ferris_wheel',
        name: 'London Eye Fixture'
      },
      // Multi-part S3DB towers + skybridge (minH > 0)
      {
        id: 1031,
        groupId: 900,
        part: true,
        outer: [[32, -62], [44, -62], [44, -50], [32, -50]],
        holes: [],
        h: 65,
        minH: 0,
        roof: 'flat'
      },
      {
        id: 1032,
        groupId: 900,
        part: true,
        outer: [[60, -62], [72, -62], [72, -50], [60, -50]],
        holes: [],
        h: 65,
        minH: 0,
        roof: 'flat'
      },
      {
        id: 1033,
        groupId: 900,
        part: true,
        outer: [[32, -60], [72, -60], [72, -52], [32, -52]],
        holes: [],
        h: 48,
        minH: 38,
        roof: 'flat'
      }
    ]
  };
}

function makeMockVideoState(scene, overrides = {}) {
  return {
    sceneData: scene,
    mapRotationDeg: 18,
    tileCols: 2,
    tileRows: 2,
    targetWidthCm: 12.8,
    targetHeightCm: 12.8,
    bedSizeMm: 128,
    bedSizeXMm: 128,
    bedSizeYMm: 128,
    totalHeightMm: 128,
    bedZ: 200,
    isResin: true,
    printer: 'mono4_custom',
    printerPreset: 'mono4_custom',
    xyPixelMm: 0.05,
    layerHeightMm: 0.05,
    frameH: 128,
    zScale: 1.25,
    terrainScale: 1.15,
    cropRatio: 0.88,
    cropCenterX: 0,
    cropCenterY: 0,
    hollowBase: true,
    hollow: true,
    hollowWallMm: 1.8,
    kerfMm: 0.08,
    waterCutout: true,
    backingStyle: 'obsidian',
    framePreset: '50x70',
    showFrame: true,
    palette: 'alpine_relief',
    colors: {
      water: '#2b7a9b',
      base: '#d8ceb8',
      greenery: '#4c8c4a',
      trees: '#2d6a32',
      roads: '#ece8df',
      buildings: '#f7f5f0',
      highlighted: '#e67e22'
    },
    elementVisible: {
      water: true,
      base: true,
      greenery: true,
      trees: true,
      roads: true,
      buildings: true,
      highlighted: true
    },
    highlightedBuildingIds: new Set([101]),
    lodSettings: {
      minBuildingFootprintM: 0,
      enableTrees: true,
      treeMaxSpanKm: 4.0,
      roadDetail: 'all'
    },
    customTitle: 'PARITY CITY',
    customSubtitle: 'SLA 1:1',
    activePreset: 'london',
    ...overrides
  };
}

(async function main() {
  console.log('\n[1/6] Exact 1:1 Triangle Counts & Z-Bounds Parity (Configurator vs Video Studio)');
  {
    const rotSceneA = makeFullSyntheticCityScene();
    if (typeof applySceneRotation === 'function') {
      applySceneRotation(rotSceneA, 18, 84.6, 84.6);
    }

    const slaState = {
      isResin: true,
      printerPreset: 'mono4_custom',
      xyPixelMm: 0.05,
      layerHeightMm: 0.05,
      bedSizeMm: 128,
      bedSizeXMm: 128,
      bedSizeYMm: 128,
      bedZ: 200,
      tileCols: 2,
      tileRows: 2,
      totalHeightMm: 128,
      hollowBase: true,
      hollowWallMm: 1.8,
      waterCutout: true,
      mapRotationDeg: 18,
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
        trees: true,
        roads: true,
        buildings: true,
        highlighted: true
      },
      lodSettings: {
        minBuildingFootprintM: 0,
        enableTrees: true,
        treeMaxSpanKm: 4.0,
        roadDetail: 'all'
      }
    };

    const refBuild = buildComplete3DModel(rotSceneA, slaState, { isExport: false });
    const refPart = partitionSlotMeshes(
      refBuild.meshes,
      refBuild.pickIdMap,
      new Set([101]),
      rotSceneA.buildings
    );

    const vScene = makeFullSyntheticCityScene();
    const vState = makeMockVideoState(vScene);
    const dummyEngine = {
      rebuild: () => {},
      updatePaletteUniforms: () => {},
      setElementVisible: () => {}
    };
    const orderCtrl = createVideoOrderDemoController(
      vState,
      dummyEngine,
      { width: 640, height: 480 },
      {},
      null
    );

    const slotDesc = orderCtrl.buildSlotDescriptorFromCurrent();
    check(slotDesc && slotDesc.meshes, 'buildSlotDescriptorFromCurrent returns valid descriptor');

    // Sum buildings + highlighted vs reference buildings
    const refBldCount = refPart.buildings.length + refPart.highlighted.length;
    const vidBldCount = slotDesc.meshes.buildings.length + slotDesc.meshes.highlighted.length;
    check(refBldCount === vidBldCount && vidBldCount > 0, 'Exact 1:1 buildings+highlighted triangle count parity', `ref=${refBldCount}, vid=${vidBldCount}`);

    // Sum greenery + trees vs reference meshes.greenery
    const refGreenTotal = refBuild.meshes.greenery.length;
    const vidGreenTotal = slotDesc.meshes.greenery.length + slotDesc.meshes.trees.length;
    check(refGreenTotal === vidGreenTotal && vidGreenTotal > 0, 'Exact 1:1 greenery+trees triangle count parity', `ref=${refGreenTotal}, vid=${vidGreenTotal}`);
    check(slotDesc.meshes.trees.length > 0 && slotDesc.meshes.greenery.length > 0, '3D tree crowns partitioned cleanly from park slabs', `greenery=${slotDesc.meshes.greenery.length}, trees=${slotDesc.meshes.trees.length}`);

    for (const key of ['base', 'roads', 'water']) {
      const rTris = refBuild.meshes[key] || [];
      const vTris = slotDesc.meshes[key] || [];
      const rb = getTriBounds(rTris);
      const vb = getTriBounds(vTris);
      const zMatch = rTris.length === 0
        ? vTris.length === 0
        : (Math.abs(rb.minZ - vb.minZ) < 1e-6 && Math.abs(rb.maxZ - vb.maxZ) < 1e-6);
      check(rb.count === vb.count && zMatch, `Layer "${key}" 1:1 count & Z-bounds parity`, `ref=${rb.count} [${rb.minZ.toFixed(3)}..${rb.maxZ.toFixed(3)}], vid=${vb.count} [${vb.minZ.toFixed(3)}..${vb.maxZ.toFixed(3)}]`);
    }

    const rbBld = getTriBounds([...refPart.buildings, ...refPart.highlighted]);
    const vbBld = getTriBounds([...slotDesc.meshes.buildings, ...slotDesc.meshes.highlighted]);
    check(
      Math.abs(rbBld.minZ - vbBld.minZ) < 1e-6 && Math.abs(rbBld.maxZ - vbBld.maxZ) < 1e-6 && Math.abs(rbBld.minX - vbBld.minX) < 1e-6,
      'Buildings+FerrisWheel+Skybridge Z & X bounds 1:1 identical',
      `refZ=[${rbBld.minZ.toFixed(3)}..${rbBld.maxZ.toFixed(3)}], vidZ=[${vbBld.minZ.toFixed(3)}..${vbBld.maxZ.toFixed(3)}]`
    );
  }

  console.log('\n[2/6] Fast-Path Reuse & Strict Non-Mutation of Shared Main Configurator Meshes');
  {
    const sharedRotScene = makeFullSyntheticCityScene();
    applySceneRotation(sharedRotScene, 18, 84.6, 84.6);
    const sharedSt = {
      isResin: true,
      printerPreset: 'mono4_custom',
      xyPixelMm: 0.05,
      layerHeightMm: 0.05,
      bedSizeMm: 256,
      bedSizeXMm: 256,
      bedSizeYMm: 256,
      bedZ: 200,
      tileCols: 2,
      tileRows: 2,
      totalHeightMm: 256,
      hollowBase: true,
      waterCutout: true,
      mapRotationDeg: 18,
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
        trees: true,
        roads: true,
        buildings: true,
        highlighted: true
      },
      lodSettings: { minBuildingFootprintM: 0, enableTrees: true, treeMaxSpanKm: 4.0, roadDetail: 'all' }
    };
    const mainBuilt = buildComplete3DModel(sharedRotScene, sharedSt, { isExport: false });
    const mainBldLenBefore = mainBuilt.meshes.buildings.length;
    const mainGreenLenBefore = mainBuilt.meshes.greenery.length;
    const mainBldSnapshot = sharedRotScene.buildings.map((b) => ({ id: b.id, highlighted: b.highlighted }));

    check(isTreesLayerVisible(sharedRotScene, sharedSt) === true, 'isTreesLayerVisible(scene, state) returns true when enabled within span');

    const vState = makeMockVideoState(sharedRotScene, {
      bedSizeMm: 256,
      totalHeightMm: 256,
      targetWidthCm: 26,
      targetHeightCm: 26,
      highlightedBuildingIds: new Set([101, 102])
    });
    const mockBridge = {
      getState: () => ({
        sceneData: sharedRotScene,
        mapRotationDeg: 18,
        layerMeshes: mainBuilt.meshes,
        pickIdMap: mainBuilt.pickIdMap,
        isResin: true,
        xyPixelMm: 0.05,
        layerHeightMm: 0.05,
        bedSizeMm: 256,
        bedSizeXMm: 256,
        bedSizeYMm: 256,
        bedZ: 200,
        tileCols: 2,
        tileRows: 2,
        totalHeightMm: 256,
        hollowBase: true,
        waterCutout: true,
        zScale: 1.25,
        terrainScale: 1.15,
        cropRatio: 0.88,
        cropCenterX: 0,
        cropCenterY: 0,
        kerfMm: 0.08,
        lodSettings: sharedSt.lodSettings
      })
    };

    const orderCtrl = createVideoOrderDemoController(
      vState,
      { rebuild: () => {} },
      { width: 640, height: 480 },
      {},
      mockBridge
    );

    const fastAvail = orderCtrl.canFastBuildCurrentSlot();
    check(fastAvail === true, 'canFastBuildCurrentSlot() returns true for non-10mm-multiple bed (256mm) when bridge layerMeshes matches signature');

    const slot = orderCtrl.buildSlotDescriptorFromCurrent();
    check(
      slot && slot.meshes.highlighted.length > 0 && slot.meshes.buildings.length > 0,
      'Fast-path partitioned Set-based highlighted buildings cleanly',
      `highlighted=${slot.meshes.highlighted.length}, buildings=${slot.meshes.buildings.length}`
    );

    // Ensure shared objects were NOT mutated!
    const mainBldAfter = mainBuilt.meshes.buildings.length;
    const mainGreenAfter = mainBuilt.meshes.greenery.length;
    const buildingsFlagMutated = sharedRotScene.buildings.some((b, idx) => b.highlighted !== mainBldSnapshot[idx].highlighted);
    check(
      mainBldAfter === mainBldLenBefore && mainGreenAfter === mainGreenLenBefore && !buildingsFlagMutated,
      'Main 3D configurator meshes & shared scene.buildings remain strictly unmutated'
    );

    // Mismatch test when waterCutout changes
    vState.waterCutout = false;
    check(orderCtrl.canFastBuildCurrentSlot() === false, 'canFastBuildCurrentSlot() invalidates when waterCutout changes');
  }

  console.log('\n[3/6] Video Shaders GLSL Consistency & Varying Budget Verification');
  {
    const mainFS = buildVideoMainFS(true);
    const varyingMatches = VIDEO_MAIN_VS.match(/\bvarying\b/g) || [];
    check(varyingMatches.length <= 10 && varyingMatches.length >= 8, 'VIDEO_MAIN_VS varying count within WebGL1 safe budget (<= 10)', `count=${varyingMatches.length}`);

    check(VIDEO_VERTEX_TRANSFORM_GLSL.includes('uMaxSceneZ') && !VIDEO_VERTEX_TRANSFORM_GLSL.includes('36.0'), 'zslicer wave uses dynamic uMaxSceneZ instead of hardcoded 36.0 cap');
    check(VIDEO_VERTEX_TRANSFORM_GLSL.includes('uHalfW') && VIDEO_VERTEX_TRANSFORM_GLSL.includes('uHalfH'), 'diagonal/radial waves normalize with uHalfW/uHalfH');

    check(mainFS.includes('uColorTrees') && mainFS.includes('0.04') && mainFS.includes('0.98'), 'Main FS shades 3D tree crowns via uColorTrees when 0.04 < vNorm.z < 0.98');
    check(mainFS.includes('vRawPos') && mainFS.includes('uTileCols') && mainFS.includes('uTileRows'), 'Main FS uses vRawPos + uTileCols/uTileRows for per-tile clipping');
    check(!mainFS.includes('34.0'), 'Main FS removed hardcoded 34.0 tile clip magic number');

    check(VIDEO_SHADOW_FS.includes('vRawPos') && VIDEO_SHADOW_FS.includes('uTileCols') && VIDEO_SHADOW_FS.includes('uTileRows'), 'Shadow FS performs identical per-tile clipping via vRawPos');
    check(VIDEO_SHADOW_FS.includes('lid == 11'), 'Shadow FS discards non-casting glass/boardOnly layerId 11');
  }

  console.log('\n[4/6] Video Frame Builder: Water Cutout Obsidian/Walnut Backing & BoardOnly Geometry');
  {
    const slotCfgCutout = {
      halfW: 100,
      halfH: 100,
      bedZ: 200,
      showFrame: true,
      frameStyle: 'gallery',
      frameColorHex: '#18181c',
      backingStyle: 'obsidian',
      waterCutout: true,
      title: 'LONDON',
      subtitle: 'THAMES CUTOUT'
    };
    const fbOn = buildVideoProductFrameBuffers(slotCfgCutout, true);
    let maxBackingZ = -Infinity;
    for (const t of fbOn.backingTris) {
      maxBackingZ = Math.max(maxBackingZ, t.v0[2], t.v1[2], t.v2[2]);
    }
    check(fbOn.backingTris.length > 0 && Math.abs(maxBackingZ - (-0.025)) < 1e-6, 'waterCutout=true + hasBaseLayer positions backingTopZ at -0.025', `maxBackingZ=${maxBackingZ}`);
    check(Array.isArray(fbOn.boardOnlyTris) && fbOn.boardOnlyTris.length > 0, 'boardOnlyTris emitted for unframed waterCutout render', `tris=${fbOn.boardOnlyTris.length}`);
    check(fbOn.boardOnlyTris.every((t) => t.layerId === 11), 'boardOnlyTris tagged with layerId=11');

    const fbOff = buildVideoProductFrameBuffers({ ...slotCfgCutout, waterCutout: false }, true);
    let maxBackingOffZ = -Infinity;
    for (const t of fbOff.backingTris) {
      maxBackingOffZ = Math.max(maxBackingOffZ, t.v0[2], t.v1[2], t.v2[2]);
    }
    check(maxBackingOffZ <= -0.035 && maxBackingOffZ < -0.025, 'waterCutout=false keeps backing board below recessed slab base', `maxBackingZ=${maxBackingOffZ}`);
  }

  console.log('\n[5/6] computeLayerGroundZMap Hillside Shell Anchoring (Negative & Positive shellIds)');
  {
    const mkTri = (z0, z1, extra = {}) => ({
      v0: [0, 0, z0],
      v1: [1, 0, z0],
      v2: [0, 1, z1],
      n: [0, 0, 1],
      ...extra
    });
    const fakeMeshes = {
      base: [mkTri(0.0, 2.48), mkTri(2.48, 2.48)],
      buildings: [
        mkTri(18.5, 42.0, { shellId: -101, buildingId: 501 }),
        mkTri(24.0, 48.0, { shellId: -101, buildingId: 501 }),
        mkTri(12.0, 26.0, { shellId: 77, buildingId: 502 }),
        mkTri(2.48, 15.0, { shellId: -1, buildingId: 503 })
      ],
      trees: [
        mkTri(19.2, 24.5, { shellId: -105 })
      ],
      roads: [
        mkTri(16.0, 16.5, { shellId: -106 })
      ],
      greenery: [
        mkTri(2.5, 3.0, { shellId: -107 })
      ],
      water: [mkTri(0.0, 0.0)],
      highlighted: []
    };

    const zMap = computeLayerGroundZMap(fakeMeshes);
    const baseGz = zMap.resolveTriGroundZ(fakeMeshes.base[0], 'base', 0);
    const hillNegBldGz = zMap.resolveTriGroundZ(fakeMeshes.buildings[1], 'buildings', 2.48);
    const hillPosBldGz = zMap.resolveTriGroundZ(fakeMeshes.buildings[2], 'buildings', 2.48);
    const flatBldGz = zMap.resolveTriGroundZ(fakeMeshes.buildings[3], 'buildings', 2.48);
    const treeGz = zMap.resolveTriGroundZ(fakeMeshes.trees[0], 'trees', 2.48);
    const roadGz = zMap.resolveTriGroundZ(fakeMeshes.roads[0], 'roads', 2.48);

    check(Math.abs(baseGz - 0.0) < 1e-6, 'base layer anchors to groundZ = 0.0', `baseGz=${baseGz}`);
    check(Math.abs(hillNegBldGz - 18.5) < 1e-6, 'negative shellId (-101) hillside building anchors to shellMinZ=18.5 (not 2.48)', `hillNegBldGz=${hillNegBldGz}`);
    check(Math.abs(hillPosBldGz - 12.0) < 1e-6, 'positive shellId (77) hillside building anchors to shellMinZ=12.0', `hillPosBldGz=${hillPosBldGz}`);
    check(Math.abs(treeGz - 19.2) < 1e-6, 'negative shellId (-105) hillside tree crown anchors to shellMinZ=19.2', `treeGz=${treeGz}`);
    check(Math.abs(roadGz - 16.0) < 1e-6, 'negative shellId (-106) hillside road anchors to shellMinZ=16.0', `roadGz=${roadGz}`);
    check(Math.abs(flatBldGz - 2.48) < 1e-6, 'un-shelled (shellId=-1) building resolves cleanly to minZ/bldMinZ', `flatBldGz=${flatBldGz}`);
    check(Math.abs(zMap.maxSceneZ - 48.0) < 1e-6, 'maxSceneZ computed accurately across all layers', `maxSceneZ=${zMap.maxSceneZ}`);
  }

  console.log('\n[6/6] 2D Whip-Pan CAD Scaling, Uncapped Buildings & Continuous Timeline');
  {
    const manyBuildings = [];
    for (let i = 0; i < 2800; i++) {
      manyBuildings.push({
        id: i + 1,
        outer: [[10, 20], [14, 20], [14, 24], [10, 24]],
        holes: [],
        h: 15 + (i % 20)
      });
    }
    // Hidden and outline buildings must be excluded
    for (let i = 0; i < 5; i++) {
      manyBuildings.push({ id: 9000 + i, outer: [[0, 0], [5, 0], [5, 5], [0, 5]], h: 20, hidden: true });
      manyBuildings.push({ id: 9100 + i, outer: [[0, 0], [5, 0], [5, 5], [0, 5]], h: 20, isOutline: true });
    }
    const cadScene = {
      title: 'DENSE_CAD',
      halfW: 100,
      halfH: 100,
      _fetchedCropRatio: 1.0,
      roads: [{ pts: [[10, -20], [10, 20]] }],
      waterPolys: [{ outer: [[-50, -50], [-40, -50], [-40, -40], [-50, -40]] }],
      buildings: manyBuildings
    };

    const { cad2D } = extractVideoTelemetryAndCad2D(cadScene, 0.88);
    const expectedScale = 1.0 / 0.88;
    check(Math.abs(cad2D.scaleToBed - expectedScale) < 1e-6, 'cad2D.scaleToBed uses terrain_masks effectiveCrop formula', `scale=${cad2D.scaleToBed.toFixed(6)}`);
    check(cad2D.bldOuters.length === 2800, 'cad2D excludes hidden/isOutline and removes old 2600 cap', `count=${cad2D.bldOuters.length}`);
    const firstCoordX = cad2D.bldOuters[0].pts[0][0];
    check(Math.abs(firstCoordX - 10 * expectedScale) < 1e-5, 'cad2D building coordinates scaled by scaleToBed', `firstX=${firstCoordX.toFixed(5)}`);

    let allFinite = true;
    const animCfg = { storyboard: 'hero', waveMode: 'zslicer', showWhipPan: true };
    for (let k = 0; k <= 20; k++) {
      const st = evaluateVideoTimeline(k / 20, animCfg);
      for (const field of ['camDist', 'camYaw', 'camPitch', 'cad2dAlpha', 'waveProgress']) {
        if (st[field] === undefined || !Number.isFinite(st[field])) {
          allFinite = false;
        }
      }
    }
    check(allFinite, 'evaluateVideoTimeline returns finite state across tNorm in [0..1]');
  }

  console.log(`\n================================================================`);
  console.log(`VIDEO STUDIO PARITY TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log(`================================================================`);
  if (failCount > 0) process.exit(1);
})();
