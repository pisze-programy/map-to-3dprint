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
  'src/video/ui_video_order_demo.js',
  'src/video/ui_video_controls.js',
  'src/video/ui_video_studio.js'
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
  console.log('\n[1/10] Exact 1:1 Triangle Counts & Z-Bounds Parity (Configurator vs Video Studio)');
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

  console.log('\n[2/10] Fast-Path Reuse & Strict Non-Mutation of Shared Main Configurator Meshes');
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

  console.log('\n[3/10] Video Shaders GLSL Consistency & Varying Budget Verification');
  {
    const mainFS = buildVideoMainFS(true);
    const varyingMatches = VIDEO_MAIN_VS.match(/\bvarying\b/g) || [];
    check(varyingMatches.length <= 10 && varyingMatches.length >= 8, 'VIDEO_MAIN_VS varying count within WebGL1 safe budget (<= 10)', `count=${varyingMatches.length}`);

    check(VIDEO_VERTEX_TRANSFORM_GLSL.includes('uMaxSceneZ') && !VIDEO_VERTEX_TRANSFORM_GLSL.includes('36.0'), 'zslicer wave uses dynamic uMaxSceneZ instead of hardcoded 36.0 cap');
    check(VIDEO_VERTEX_TRANSFORM_GLSL.includes('uHalfW') && VIDEO_VERTEX_TRANSFORM_GLSL.includes('uHalfH'), 'diagonal/radial waves normalize with uHalfW/uHalfH');

    check(mainFS.includes('uColorTrees') && mainFS.includes('0.04') && mainFS.includes('0.98'), 'Main FS shades 3D tree crowns via uColorTrees when 0.04 < vNorm.z < 0.98');
    check(mainFS.includes('vRawPos') && mainFS.includes('uTileCols') && mainFS.includes('uTileRows'), 'Main FS uses vRawPos + uTileCols/uTileRows for per-tile clipping');
    check(mainFS.includes('vSubId >= 0.0 && uTileExplode > 0.001'), 'Main FS gates per-tile discard with uTileExplode > 0.001');
    check(!mainFS.includes('34.0'), 'Main FS removed hardcoded 34.0 tile clip magic number');

    check(VIDEO_SHADOW_FS.includes('vRawPos') && VIDEO_SHADOW_FS.includes('uTileCols') && VIDEO_SHADOW_FS.includes('uTileRows'), 'Shadow FS performs identical per-tile clipping via vRawPos');
    check(VIDEO_SHADOW_FS.includes('vSubId >= 0.0 && uTileExplode > 0.001'), 'Shadow FS gates per-tile discard with uTileExplode > 0.001');
    check(VIDEO_SHADOW_FS.includes('lid == 11'), 'Shadow FS discards non-casting glass/boardOnly layerId 11');
  }

  console.log('\n[4/10] Video Frame Builder: Water Cutout Obsidian/Walnut Backing & BoardOnly Geometry');
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

  console.log('\n[5/10] computeLayerGroundZMap Hillside Shell Anchoring (Negative & Positive shellIds)');
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

  console.log('\n[6/10] 2D Whip-Pan CAD Scaling, Uncapped Buildings & Continuous Timeline');
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

  console.log('\n[7/10] Real Cached Cities 1:1 Mesh & Progressive Parity (DUBAI, SINGAPORE, INNSBRUCK)');
  const builtRealSlots = {};
  {
    const cityConfigs = [
      {
        key: 'dubai',
        file: 'cache/scene_v5_25.1865_55.2660_25.1981_55.2788.json',
        waterCutout: false,
        mapRotationDeg: 15,
        tileCols: 2,
        tileRows: 2
      },
      {
        key: 'singapore',
        file: 'cache/scene_v5_1.2810_103.8487_1.2926_103.8603.json',
        waterCutout: true,
        mapRotationDeg: 0,
        tileCols: 2,
        tileRows: 2
      },
      {
        key: 'innsbruck',
        file: 'cache/scene_v5_47.2627_11.3847_47.2743_11.4019.json',
        waterCutout: false,
        mapRotationDeg: 15,
        tileCols: 2,
        tileRows: 2
      }
    ];

    for (const cfg of cityConfigs) {
      const fullFile = path.join(ROOT, cfg.file);
      if (!fs.existsSync(fullFile)) {
        console.log(`  [SKIP] Cached scene missing: ${cfg.file}`);
        continue;
      }
      const rawJson = fs.readFileSync(fullFile, 'utf8');
      const refScene = JSON.parse(rawJson);
      const syncScene = JSON.parse(rawJson);
      const asyncScene = JSON.parse(rawJson);

      if (typeof applySceneRotation === 'function') {
        applySceneRotation(refScene, cfg.mapRotationDeg, 84.6, 84.6);
      }

      const commonSt = {
        isResin: true,
        printerPreset: 'mono4_custom',
        xyPixelMm: 0.05,
        layerHeightMm: 0.05,
        bedSizeMm: 256,
        bedSizeXMm: 256,
        bedSizeYMm: 256,
        bedZ: 200,
        tileCols: cfg.tileCols,
        tileRows: cfg.tileRows,
        totalHeightMm: 256,
        hollowBase: true,
        hollowWallMm: 1.8,
        waterCutout: cfg.waterCutout,
        mapRotationDeg: cfg.mapRotationDeg,
        zScale: 1.25,
        terrainScale: 1.15,
        cropRatio: refScene._fetchedCropRatio || 0.88,
        cropCenterX: 0,
        cropCenterY: 0,
        kerfMm: 0.08,
        layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
        lodSettings: { minBuildingFootprintM: 0, enableTrees: true, treeMaxSpanKm: 4.0, roadDetail: 'all' }
      };

      const refRes = buildComplete3DModel(refScene, commonSt, { isExport: false });

      const vStSync = makeMockVideoState(syncScene, {
        bedSizeMm: 256,
        totalHeightMm: 256,
        targetWidthCm: 25.6,
        targetHeightCm: 25.6,
        tileCols: cfg.tileCols,
        tileRows: cfg.tileRows,
        waterCutout: cfg.waterCutout,
        mapRotationDeg: cfg.mapRotationDeg,
        cropRatio: syncScene._fetchedCropRatio || 0.88,
        highlightedBuildingIds: []
      });
      const ctrlSync = createVideoOrderDemoController(vStSync, { rebuild: () => {} }, { width: 640, height: 480 }, {}, null);
      const syncSlot = ctrlSync.buildSlotDescriptorFromCurrent();

      const vStAsync = makeMockVideoState(asyncScene, {
        bedSizeMm: 256,
        totalHeightMm: 256,
        targetWidthCm: 25.6,
        targetHeightCm: 25.6,
        tileCols: cfg.tileCols,
        tileRows: cfg.tileRows,
        waterCutout: cfg.waterCutout,
        mapRotationDeg: cfg.mapRotationDeg,
        cropRatio: asyncScene._fetchedCropRatio || 0.88,
        highlightedBuildingIds: []
      });
      const ctrlAsync = createVideoOrderDemoController(vStAsync, { rebuild: () => {} }, { width: 640, height: 480 }, {}, null);
      const asyncSlot = await ctrlAsync.buildSlotDescriptorAsync();

      const refGreen = refRes.meshes.greenery.length;
      const syncGreen = syncSlot.meshes.greenery.length + syncSlot.meshes.trees.length;
      const asyncGreen = asyncSlot.meshes.greenery.length + asyncSlot.meshes.trees.length;

      const refBld = refRes.meshes.buildings.length + refRes.meshes.highlighted.length;
      const syncBld = syncSlot.meshes.buildings.length + syncSlot.meshes.highlighted.length;
      const asyncBld = asyncSlot.meshes.buildings.length + asyncSlot.meshes.highlighted.length;

      const countParity =
        refRes.meshes.water.length === syncSlot.meshes.water.length &&
        refRes.meshes.water.length === asyncSlot.meshes.water.length &&
        (!cfg.waterCutout || refRes.meshes.water.length === 0) &&
        refRes.meshes.base.length === syncSlot.meshes.base.length &&
        refRes.meshes.base.length === asyncSlot.meshes.base.length &&
        refRes.meshes.roads.length === syncSlot.meshes.roads.length &&
        refRes.meshes.roads.length === asyncSlot.meshes.roads.length &&
        refGreen === syncGreen && refGreen === asyncGreen &&
        refBld === syncBld && refBld === asyncBld && refBld > 0;

      const rb = getTriBounds([...refRes.meshes.buildings, ...refRes.meshes.highlighted]);
      const sb = getTriBounds([...syncSlot.meshes.buildings, ...syncSlot.meshes.highlighted]);
      const ab = getTriBounds([...asyncSlot.meshes.buildings, ...asyncSlot.meshes.highlighted]);
      const boundsParity =
        Math.abs(rb.minZ - sb.minZ) < 1e-6 && Math.abs(rb.maxZ - sb.maxZ) < 1e-6 &&
        Math.abs(rb.minZ - ab.minZ) < 1e-6 && Math.abs(rb.maxZ - ab.maxZ) < 1e-6 &&
        Math.abs(rb.minX - sb.minX) < 1e-6 && Math.abs(rb.maxX - sb.maxX) < 1e-6;

      check(
        countParity && boundsParity,
        `${cfg.key.toUpperCase()} 1:1 parity across Main3D / VideoSync / VideoAsync (wc=${cfg.waterCutout}, rot=${cfg.mapRotationDeg}°)`,
        `bld=${refBld}/${syncBld}/${asyncBld}, Z=[${rb.minZ.toFixed(2)}..${rb.maxZ.toFixed(2)}], trees=${syncSlot.meshes.trees.length}`
      );
      builtRealSlots[cfg.key] = syncSlot;
    }
  }

  function createInstrumentedMockEnv() {
    const createMock2DCtx = () => ({
      fillStyle: '#000',
      strokeStyle: '#000',
      font: '12px sans-serif',
      textAlign: 'left',
      textBaseline: 'top',
      globalAlpha: 1,
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      shadowColor: 'transparent',
      shadowBlur: 0,
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      setTransform() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      rect() {},
      roundRect() {},
      arc() {},
      clip() {},
      fill() {},
      stroke() {},
      fillRect() {},
      strokeRect() {},
      clearRect() {},
      fillText() {},
      strokeText() {},
      drawImage() {},
      setLineDash() {},
      measureText: (txt) => ({ width: String(txt || '').length * 7 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4) })
    });

    let nextId = 1;
    const programs = [];
    const shaders = [];
    const uniformQueries = new Map();
    const attribQueries = new Map();
    const uniformValues = new Map();
    let frameDraws = [];
    let currentProg = null;
    let boundArrayBuf = null;
    const bufRecords = new Map();
    const uploadedOrder = [];

    const gl = {
      VERTEX_SHADER: 0x8B31,
      FRAGMENT_SHADER: 0x8B30,
      COMPILE_STATUS: 0x8B81,
      LINK_STATUS: 0x8B82,
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88E4,
      TRIANGLES: 0x0004,
      TEXTURE_2D: 0x0DE1,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      NEAREST: 0x2600,
      LINEAR: 0x2601,
      CLAMP_TO_EDGE: 0x812F,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      FRAMEBUFFER: 0x8D40,
      COLOR_ATTACHMENT0: 0x8CE0,
      DEPTH_ATTACHMENT: 0x8D00,
      RENDERBUFFER: 0x8D41,
      DEPTH_COMPONENT16: 0x81A5,
      COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x0100,
      DEPTH_TEST: 0x0B71,
      LEQUAL: 0x0203,
      BLEND: 0x0BE2,
      SRC_ALPHA: 0x0302,
      ONE_MINUS_SRC_ALPHA: 0x0303,
      FLOAT: 0x1406,
      TEXTURE0: 0x84C0,
      TEXTURE1: 0x84C1,
      UNPACK_FLIP_Y_WEBGL: 0x9240,
      createShader(type) {
        const s = { id: nextId++, type, src: '' };
        shaders.push(s);
        return s;
      },
      shaderSource(s, src) { s.src = String(src || ''); },
      compileShader() {},
      getShaderParameter() { return true; },
      getShaderInfoLog() { return ''; },
      createProgram() {
        const p = { id: nextId++, label: '', vsSrc: '', fsSrc: '', src: '', attribs: new Map() };
        programs.push(p);
        uniformQueries.set(p.id, new Set());
        attribQueries.set(p.id, new Set());
        uniformValues.set(p.id, new Map());
        return p;
      },
      attachShader(p, s) {
        if (s.type === gl.VERTEX_SHADER) p.vsSrc = s.src;
        else p.fsSrc = s.src;
        p.src = p.vsSrc + '\n' + p.fsSrc;
        p.label = p.vsSrc.includes('uLightMatrix') && !p.vsSrc.includes('uProj') ? 'shadow' : 'main';
      },
      linkProgram() {},
      getProgramParameter() { return true; },
      getProgramInfoLog() { return ''; },
      getExtension() { return {}; },
      createTexture() { return { id: nextId++ }; },
      bindTexture() {},
      texImage2D() {},
      texParameteri() {},
      pixelStorei() {},
      createRenderbuffer() { return { id: nextId++ }; },
      bindRenderbuffer() {},
      renderbufferStorage() {},
      createFramebuffer() { return { id: nextId++ }; },
      bindFramebuffer() {},
      framebufferTexture2D() {},
      framebufferRenderbuffer() {},
      createBuffer() {
        const b = { id: nextId++, data: null, lid: -1, subId: 0 };
        bufRecords.set(b.id, b);
        uploadedOrder.push(b);
        return b;
      },
      bindBuffer(target, b) {
        if (target === gl.ARRAY_BUFFER) boundArrayBuf = b;
      },
      bufferData(target, data) {
        if (target === gl.ARRAY_BUFFER && boundArrayBuf && data) {
          const copy = new Float32Array(data.length);
          copy.set(data);
          boundArrayBuf.data = copy;
          boundArrayBuf.lid = copy.length >= 13 ? Math.round(copy[9]) : -1;
          boundArrayBuf.subId = copy.length >= 13 ? Math.round(copy[11]) : 0;
        }
      },
      deleteBuffer(b) { if (b) bufRecords.delete(b.id); },
      deleteTexture() {},
      viewport() {},
      clearColor() {},
      clear() {},
      enable() {},
      disable() {},
      depthFunc() {},
      depthMask() {},
      blendFunc() {},
      useProgram(p) { currentProg = p; },
      getUniformLocation(p, name) {
        if (p && uniformQueries.has(p.id)) uniformQueries.get(p.id).add(name);
        return { prog: p, name };
      },
      getAttribLocation(p, name) {
        if (p && attribQueries.has(p.id)) attribQueries.get(p.id).add(name);
        if (p && !p.attribs.has(name)) p.attribs.set(name, p.attribs.size);
        return p ? p.attribs.get(name) : -1;
      },
      enableVertexAttribArray() {},
      vertexAttribPointer() {},
      uniform1f(loc, v) { if (loc && loc.prog) uniformValues.get(loc.prog.id).set(loc.name, v); },
      uniform1i(loc, v) { if (loc && loc.prog) uniformValues.get(loc.prog.id).set(loc.name, v); },
      uniform3f(loc, a, b, c) { if (loc && loc.prog) uniformValues.get(loc.prog.id).set(loc.name, [a, b, c]); },
      uniform3fv(loc, v) { if (loc && loc.prog) uniformValues.get(loc.prog.id).set(loc.name, Array.from(v)); },
      uniform4f(loc, a, b, c, d) { if (loc && loc.prog) uniformValues.get(loc.prog.id).set(loc.name, [a, b, c, d]); },
      uniformMatrix4fv(loc, _t, v) { if (loc && loc.prog) uniformValues.get(loc.prog.id).set(loc.name, Float32Array.from(v)); },
      activeTexture() {},
      drawArrays(_mode, _first, count) {
        frameDraws.push({
          progLabel: currentProg ? currentProg.label : 'unknown',
          count,
          tris: Math.round(count / 3),
          lid: boundArrayBuf ? boundArrayBuf.lid : -1,
          subId: boundArrayBuf ? boundArrayBuf.subId : 0,
          buf: boundArrayBuf
        });
      }
    };

    const makeCanvas = (w = 1280, h = 720) => ({
      width: w,
      height: h,
      style: {},
      classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
      addEventListener() {},
      getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
      getContext(kind) {
        if (kind === 'webgl' || kind === 'experimental-webgl') return gl;
        return createMock2DCtx();
      }
    });

    return {
      gl,
      programs,
      uniformQueries,
      attribQueries,
      uniformValues,
      uploadedOrder,
      getDraws: () => frameDraws,
      resetDraws: () => { frameDraws = []; },
      makeCanvas,
      createMock2DCtx
    };
  }

  function mulMat4Vec4(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
      m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3]
    ];
  }

  console.log('\n[8/10] Headless WebGL 1.0 + Canvas2D Effect Audit (London Eye, Close Zoom, Dubai zslicer, Innsbruck GroundZ)');
  {
    const prevDoc = global.document;
    const mockEnv = createInstrumentedMockEnv();
    global.document = {
      createElement: (tag) => (tag === 'canvas' ? mockEnv.makeCanvas() : { style: {}, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {} }),
      getElementById: () => null,
      querySelectorAll: () => []
    };
    try {
      const compositeCanvas = mockEnv.makeCanvas(1280, 720);
      const engine = createVideoPreviewEngine(compositeCanvas);
      const mainProg = mockEnv.programs.find(p => p.label === 'main') || mockEnv.programs[1];
      const shadowProg = mockEnv.programs.find(p => p.label === 'shadow') || mockEnv.programs[0];

      // Build London Eye + waterCutout slot
      const londonScene = makeFullSyntheticCityScene();
      const vLondon = makeMockVideoState(londonScene, {
        bedSizeMm: 256,
        totalHeightMm: 256,
        targetWidthCm: 25.6,
        targetHeightCm: 25.6,
        mapRotationDeg: 0,
        waterCutout: true,
        backingStyle: 'obsidian',
        showFrameProduct: true
      });
      const ctrlLondon = createVideoOrderDemoController(vLondon, engine, compositeCanvas, {}, null);
      const londonSlot = ctrlLondon.buildSlotDescriptorFromCurrent();
      engine.uploadOrderSlots([londonSlot]);

      const animLondon = {
        storyboard: 'hero',
        waveMode: 'none',
        styleTransition: 'wire_to_studio',
        easing: 'cubic',
        frameAnimMode: 'z_drop',
        bgTheme: 'dark_to_white',
        showTelemetry: true,
        showWhipPan: true,
        showOrderHud: true,
        showFrameProduct: true,
        sunAngleDeg: 132
      };
      mockEnv.resetDraws();
      engine.renderFrameAt(0.92, animLondon, 1280, 720);
      const framedDraws = mockEnv.getDraws().slice();

      // Verify every queried uniform & attrib exists in compiled shader source
      let allUniformsExist = true;
      let missingUniforms = [];
      for (const prog of [shadowProg, mainProg]) {
        const uSet = mockEnv.uniformQueries.get(prog.id) || new Set();
        const aSet = mockEnv.attribQueries.get(prog.id) || new Set();
        for (const name of [...uSet, ...aSet]) {
          if (!(new RegExp(`\\b${name}\\b`).test(prog.src))) {
            allUniformsExist = false;
            missingUniforms.push(`${prog.label}:${name}`);
          }
        }
      }
      check(allUniformsExist, 'All queried WebGL uniforms & attributes exist in compiled GLSL shaders', missingUniforms.join(','));

      // Check water draws === 0 and backing top Z === -0.025 when waterCutout=true
      const waterDrawsFramed = framedDraws.filter(d => d.lid === 0);
      const backingDraw = framedDraws.find(d => d.progLabel === 'main' && d.lid === 8 && d.subId === 0);
      let gpuBackingMaxZ = -Infinity;
      if (backingDraw && backingDraw.buf && backingDraw.buf.data) {
        const d = backingDraw.buf.data;
        for (let i = 0; i < d.length; i += 13) gpuBackingMaxZ = Math.max(gpuBackingMaxZ, d[i + 2]);
      }
      check(waterDrawsFramed.length === 0, 'waterCutout=true executes 0 WebGL drawArrays calls on water buffer (shadow & main)');
      check(Boolean(backingDraw) && Math.abs(gpuBackingMaxZ - (-0.025)) < 1e-5, 'Framed waterCutout draws obsidian backing in WebGL with top Z=-0.025', `gpuMaxZ=${gpuBackingMaxZ}`);

      // Verify wheel buildings buffer has 0 NaNs and slim axial thickness along its minor axis
      const bldBuf = mockEnv.uploadedOrder.find(b => b.data && b.data.length > 0 && b.lid === 4);
      let bldNaN = 0;
      let wheelMinX = Infinity, wheelMaxX = -Infinity;
      let wheelMinY = Infinity, wheelMaxY = -Infinity;
      let wheelMaxZ = -Infinity, wheelMinZ = Infinity;
      if (bldBuf) {
        const d = bldBuf.data;
        for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) bldNaN++;
        for (let i = 0; i < d.length; i += 13) {
          const x = d[i], y = d[i + 1], z = d[i + 2];
          if (x >= -42 && x <= -5 && y >= -42 && y <= 5 && z > 8) {
            if (x < wheelMinX) wheelMinX = x;
            if (x > wheelMaxX) wheelMaxX = x;
            if (y < wheelMinY) wheelMinY = y;
            if (y > wheelMaxY) wheelMaxY = y;
            if (z < wheelMinZ) wheelMinZ = z;
            if (z > wheelMaxZ) wheelMaxZ = z;
          }
        }
      }
      const wheelAxialMin = Math.min(wheelMaxX - wheelMinX, wheelMaxY - wheelMinY);
      const wheelHeight = wheelMaxZ - wheelMinZ;
      check(
        bldNaN === 0 && Number.isFinite(wheelHeight) && wheelHeight > 5 && wheelAxialMin < wheelHeight * 0.5,
        'Packed GPU London Eye buffer has 0 NaNs & slim open-wheel axial ratio',
        `axialMin=${wheelAxialMin.toFixed(2)}, height=${wheelHeight.toFixed(2)}`
      );

      // Render unframed waterCutout=true -> boardOnly (lid == 11) must draw
      mockEnv.resetDraws();
      engine.renderFrameAt(0.92, { ...animLondon, showFrameProduct: false }, 1280, 720);
      const unframedDraws = mockEnv.getDraws().slice();
      const boardOnlyMainDraw = unframedDraws.find(d => d.progLabel === 'main' && d.lid === 11);
      check(Boolean(boardOnlyMainDraw) && unframedDraws.every(d => d.lid !== 0), 'Unframed waterCutout draws boardOnly (lid=11) with 0 water draws');

      // Close Zoom Near-Plane Safety (zoomMult = 0.14) + non-NaN projection matrix check
      engine.userOrbitOffset.zoomMult = 0.14;
      mockEnv.resetDraws();
      engine.renderFrameAt(0.92, animLondon, 1280, 720);
      const mainUnifClose = mockEnv.uniformValues.get(mainProg.id);
      const uProj = mainUnifClose.get('uProj');
      const uView = mainUnifClose.get('uView');
      const projFinite = Boolean(uProj && uView) && Array.from(uProj).every(Number.isFinite) && Array.from(uView).every(Number.isFinite);
      const testPts = [[0, -2, 2.5], [0, -12, 10], [-14, -8, 12], [12, -10, 6]];
      let closeClipOk = projFinite;
      if (closeClipOk) {
        for (const pt of testPts) {
          const viewV = mulMat4Vec4(uView, [pt[0], pt[1], pt[2], 1]);
          const clipV = mulMat4Vec4(uProj, viewV);
          if (!(clipV[3] > 0 && clipV[2] > -clipV[3] && clipV[2] < clipV[3])) {
            closeClipOk = false;
          }
        }
      }
      engine.resetUserOrbit();
      check(closeClipOk, 'Close zoom (zoomMult=0.14) emits finite uProj/uView & keeps landmarks inside near/far clip frustum');

      // Dubai Burj Khalifa zslicer effect at t=0.45 and t=0.95
      if (builtRealSlots.dubai) {
        mockEnv.uploadedOrder.length = 0;
        engine.uploadOrderSlots([builtRealSlots.dubai]);
        const dubaiAnim = { ...animLondon, waveMode: 'zslicer' };

        const dubaiBldBufs = mockEnv.uploadedOrder.filter(b => b.data && b.data.length > 0 && (b.lid === 4 || b.lid === 5));
        let dubaiMaxRawZ = 0;
        for (const bb of dubaiBldBufs) {
          for (let i = 2; i < bb.data.length; i += 13) if (bb.data[i] > dubaiMaxRawZ) dubaiMaxRawZ = bb.data[i];
        }

        engine.renderFrameAt(0.45, dubaiAnim, 1280, 720);
        const u45 = mockEnv.uniformValues.get(mainProg.id);
        const uWaveMode45 = u45.get('uWaveMode');
        const uMaxZ45 = u45.get('uMaxSceneZ');
        const uProg45 = u45.get('uWaveProgress');
        const printZ45 = uProg45 * Math.max(18.0, uMaxZ45 * 1.04);

        engine.renderFrameAt(0.95, dubaiAnim, 1280, 720);
        const u95 = mockEnv.uniformValues.get(mainProg.id);
        const uMaxZ95 = u95.get('uMaxSceneZ');
        const uProg95 = u95.get('uWaveProgress');
        const printZ95 = uProg95 * Math.max(18.0, uMaxZ95 * 1.04);

        check(
          uWaveMode45 === 3 && uMaxZ45 > 50 && printZ45 < dubaiMaxRawZ && printZ95 >= dubaiMaxRawZ,
          'Dubai Burj Khalifa zslicer uses true uMaxSceneZ (>50, no Z=36 cap) and prints full spire at t=0.95',
          `dubaiMaxZ=${dubaiMaxRawZ.toFixed(2)}, printZ45=${printZ45.toFixed(2)}, printZ95=${printZ95.toFixed(2)}`
        );
      }

      // Innsbruck Alpine Hillside GPU aMeta.y (groundZ) inspection
      if (builtRealSlots.innsbruck) {
        mockEnv.uploadedOrder.length = 0;
        engine.uploadOrderSlots([builtRealSlots.innsbruck]);
        const alpineBufs = mockEnv.uploadedOrder.filter(b => b.data && b.data.length > 0 && (b.lid === 2 || b.lid === 3 || b.lid === 4));
        let nonFiniteVerts = 0;
        let maxPackedGroundZ = 0;
        for (const ab of alpineBufs) {
          for (let i = 0; i < ab.data.length; i++) if (!Number.isFinite(ab.data[i])) nonFiniteVerts++;
          for (let i = 10; i < ab.data.length; i += 13) if (ab.data[i] > maxPackedGroundZ) maxPackedGroundZ = ab.data[i];
        }
        check(
          nonFiniteVerts === 0 && maxPackedGroundZ > 3.0,
          'Innsbruck alpine GPU buffers have 0 NaNs and track hillside groundZ > 3.0',
          `maxPackedGroundZ=${maxPackedGroundZ.toFixed(2)}`
        );
      }
    } finally {
      global.document = prevDoc;
    }
  }

  console.log('\n[9/10] Full initVideoStudioModule(bridge) Lifecycle & DOM ID Integrity Audit');
  {
    const viewHtml = fs.readFileSync(path.join(ROOT, 'src/video/video_studio_view.html'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const allViewIds = new Set([...viewHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const allIndexIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

    const missingDomIds = [];
    for (const rel of fs.readdirSync(path.join(ROOT, 'src/video')).filter(f => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(ROOT, 'src/video', rel), 'utf8');
      for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const id = m[1];
        if (!allViewIds.has(id) && !allIndexIds.has(id)) {
          missingDomIds.push(`${rel}:#${id}`);
        }
      }
    }
    check(missingDomIds.length === 0, 'Every getElementById(...) in src/video/*.js exists in video_studio_view.html / index.html', missingDomIds.join(','));

    // Lifecycle check with headless DOM stub + mockBridge
    const prevDoc = global.document;
    const prevWin = global.window;
    const prevInitScene = global.INITIAL_REAL_SCENE;
    const prevImage = global.Image;
    const mockEnv = createInstrumentedMockEnv();
    const domMap = new Map();
    const makeDomNode = (id, tag = 'div') => {
      if (id === 'videoPreviewCanvas') return mockEnv.makeCanvas(1280, 720);
      if (id === 'vidMap2dCanvas') return mockEnv.makeCanvas(320, 240);
      const classes = new Set(id === 'vidLoadingOverlay' ? ['hidden'] : []);
      return {
        id,
        tagName: tag.toUpperCase(),
        value: '',
        checked: false,
        textContent: '',
        innerHTML: '',
        style: {},
        dataset: {},
        className: '',
        classList: {
          add: (...c) => c.forEach(k => classes.add(k)),
          remove: (...c) => c.forEach(k => classes.delete(k)),
          toggle: (k, f) => (f === undefined ? (classes.has(k) ? classes.delete(k) : classes.add(k)) : (f ? classes.add(k) : classes.delete(k))),
          contains: (k) => classes.has(k)
        },
        addEventListener() {},
        removeEventListener() {},
        appendChild: (c) => c,
        querySelectorAll: () => [],
        getContext: () => mockEnv.createMock2DCtx()
      };
    };
    for (const id of allViewIds) domMap.set(id, makeDomNode(id));

    global.INITIAL_REAL_SCENE = null;
    global.Image = function MockImage() { this.crossOrigin = ''; this.src = ''; };
    global.window = { addEventListener() {}, removeEventListener() {} };
    global.document = {
      activeElement: null,
      getElementById: (id) => domMap.get(id) || null,
      createElement: (tag) => (tag === 'canvas' ? mockEnv.makeCanvas() : makeDomNode('', tag)),
      querySelector: () => null,
      querySelectorAll: () => []
    };

    try {
      const bridgeScene = makeFullSyntheticCityScene();
      applySceneRotation(bridgeScene, 24, 84.6, 84.6);
      const bridgeSt = {
        sceneData: bridgeScene,
        mapCenterLat: 51.5033,
        mapCenterLon: -0.1195,
        mapZoom: 15,
        mapSpanMeters: 1200,
        cropRatio: 0.88,
        cropCenterX: 0,
        cropCenterY: 0,
        zScale: 1.25,
        terrainScale: 1.15,
        bedSizeMm: 256,
        totalHeightMm: 256,
        tileCols: 2,
        tileRows: 2,
        isResin: true,
        xyPixelMm: 0.05,
        layerHeightMm: 0.05,
        bedZ: 200,
        printerProfileId: 'mono4_custom',
        hollowBase: true,
        waterCutout: true,
        mapRotationDeg: 24,
        activePalette: 'alpine_relief',
        colors: { ...(PALETTES.find(p => p.id === 'alpine_relief') || PALETTES[0]).colors },
        frameStyle: 'black',
        plaqueText: 'LONDON EYE',
        lodSettings: { enableTrees: true, treeMaxSpanKm: 4.0, minBuildingFootprintM: 0, roadDetail: 'all' },
        layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true }
      };
      const builtMain = buildComplete3DModel(bridgeScene, bridgeSt, { isExport: false });
      bridgeSt.layerMeshes = builtMain.meshes;
      bridgeSt.pickIdMap = builtMain.pickIdMap;
      const bldNamesBefore = bridgeScene.buildings.map(b => Boolean(b.highlighted));

      const studio = initVideoStudioModule({
        getState: () => bridgeSt,
        getSceneData: () => bridgeScene
      });
      studio.activateModule(true);
      studio.deactivateModule();

      const syncedOk = Boolean(studio) &&
        studio.vState.waterCutout === true &&
        studio.vState.backingStyle === 'obsidian' &&
        studio.vState.mapRotationDeg === 24 &&
        studio.vState.bedSizeMm === 256 &&
        domMap.get('chkVidWaterCutout').checked === true &&
        bridgeScene.buildings.every((b, idx) => Boolean(b.highlighted) === bldNamesBefore[idx]);

      check(
        syncedOk,
        'initVideoStudioModule + activateModule(true) syncs waterCutout, obsidian backing, rotation, DOM checkboxes without mutating shared scene'
      );
    } finally {
      global.document = prevDoc;
      global.window = prevWin;
      global.INITIAL_REAL_SCENE = prevInitScene;
      global.Image = prevImage;
    }
  }

  console.log('\n[10/10] Production HTML Bundle Script Syntax & Video Marker Integrity');
  {
    for (const htmlRel of ['index.html', 'video_studio.html']) {
      const html = fs.readFileSync(path.join(ROOT, htmlRel), 'utf8');
      const inlineScripts = [];
      for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        if (m[1] && m[1].trim().length > 0) inlineScripts.push(m[1]);
      }
      let compiled = 0;
      let syntaxErr = null;
      for (let i = 0; i < inlineScripts.length; i++) {
        try {
          new vm.Script(inlineScripts[i], { filename: `${htmlRel}#script_${i}` });
          compiled++;
        } catch (err) {
          syntaxErr = err.message;
          break;
        }
      }
      const hasCanvas = html.includes('id="videoPreviewCanvas"') && html.includes('id="chkVidWaterCutout"');
      check(
        compiled >= 1 && !syntaxErr && hasCanvas,
        `${htmlRel} inline <script> bundle parses with 0 JS syntax errors & contains Video Studio DOM`,
        syntaxErr || `scripts=${compiled}`
      );
    }
  }

  console.log(`\n================================================================`);
  console.log(`VIDEO STUDIO PARITY TESTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log(`================================================================`);
  if (failCount > 0) process.exit(1);
})();
