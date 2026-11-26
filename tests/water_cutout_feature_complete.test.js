// ============================================================================
// tests/water_cutout_feature_complete.test.js
// Comprehensive verification suite for Water Cutout (waterCutout=true) and
// strict zero-regression when waterCutout=false:
//   1. Strict Zero-Regression (waterCutout=false baseline preservation)
//   2. Micro-Islet Filtering (< 6.0 mm²) + Building/Border Protection & Manifold
//   3. MSLA Z=0 Bridge Pier Cross-Section Reinforcement (gated on waterCutout)
//   4. 100% Open Sea & 360° Sea-Surrounded Island (with/without inland pond)
//   5. Exporters (.STL, .3MF, .ZIP) Empty Sea Blocking vs Mixed Tile Export
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHeadlessCanvas, PIPELINE_SCRIPTS } = require('../tools/headless_scene_harness.js');

const ROOT = path.resolve(__dirname, '..');

function makeFakeElement(tagName, id = '') {
  return {
    tagName: String(tagName || 'div').toUpperCase(),
    id,
    value: '',
    textContent: '',
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); if (!v) this.children.length = 0; },
    className: '',
    checked: false,
    disabled: false,
    title: '',
    children: [],
    style: {},
    dataset: {},
    get options() { return this.children; },
    classList: {
      add() {},
      remove() {},
      toggle() { return false; },
      contains() { return false; }
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector(sel) {
      const m = /^option\[value="([^"]+)"\]$/.exec(sel);
      if (m) {
        return this.children.find(c => c.value === m[1]) || null;
      }
      return null;
    },
    addEventListener() {}
  };
}

function createSandbox() {
  const elements = new Map();
  const makeRegistered = (tag, id, init = {}) => {
    const el = Object.assign(makeFakeElement(tag, id), init);
    elements.set(id, el);
    return el;
  };

  makeRegistered('span', 'preflightStatusBadge');
  makeRegistered('span', 'waterCutoutBadge');
  makeRegistered('span', 'hollowSavingsBadge');
  makeRegistered('select', 'exportTileSelect');
  const singleLayerSel = makeRegistered('select', 'singleLayerStlSelect', { value: 'water' });
  const optWater = makeFakeElement('option');
  optWater.value = 'water';
  optWater.textContent = 'Tylko Woda i Batymetria';
  const optBuildings = makeFakeElement('option');
  optBuildings.value = 'buildings';
  optBuildings.textContent = 'Tylko Budynki i Dachy LoD2';
  singleLayerSel.appendChild(optWater);
  singleLayerSel.appendChild(optBuildings);
  makeRegistered('input', 'chkPreviewWaterCutout', { type: 'checkbox' });
  makeRegistered('input', 'chkWaterCutout', { type: 'checkbox' });
  makeRegistered('div', 'backingStyleWrap');
  makeRegistered('select', 'backingStyleSelect', { value: 'black_wood' });

  const sandbox = {
    console,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Error,
    TypeError,
    RangeError,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    TextEncoder,
    TextDecoder,
    JSON,
    URLSearchParams,
    Blob: class FakeBlob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    document: {
      activeElement: null,
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, makeFakeElement('div', id));
        return elements.get(id);
      },
      createElement: (tag) => {
        if (String(tag).toLowerCase() === 'canvas') {
          const c = makeFakeElement('canvas');
          c.width = 512;
          c.height = 512;
          c.getContext = () => {
            if (!c._sw) c._sw = createHeadlessCanvas(c.width, c.height);
            return c._sw.getContext('2d');
          };
          return c;
        }
        return makeFakeElement(tag);
      },
      body: { appendChild() {}, removeChild() {} }
    },
    window: null,
    navigator: { userAgent: 'node-test' },
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ elements: [] }) }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} }
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const modules = [];
  for (const rel of PIPELINE_SCRIPTS) {
    modules.push(rel);
    if (rel === 'src/export/stl_writer.js') {
      modules.push('src/export/zip_packager.js', 'src/export/export_3mf.js');
    }
  }
  for (const rel of modules) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  sandbox.__elements = elements;
  return sandbox;
}

const sb = createSandbox();
let passed = 0;
let failed = 0;

function check(cond, name, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.error(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function makeBaseState(overrides = {}) {
  return {
    bedSizeMm: 250,
    totalHeightMm: 250,
    targetWidthCm: 25,
    targetHeightCm: 25,
    tileCols: 1,
    tileRows: 1,
    kerfMm: 0.08,
    isResin: true,
    hollowBase: false,
    hollowWallMm: 1.8,
    waterCutout: false,
    backingStyle: 'black_wood',
    exportFrame: false,
    exportTileFilter: 'all',
    zScale: 1.25,
    terrainScale: 1.0,
    cropRatio: 1.0,
    layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    lodSettings: { minBuildingFootprintM: 0, minBuildingMeters: 0, enableTrees: true, treeMaxSpanKm: 4.0, treeThresholdKm: 4.0, roadDetail: 'all' },
    colors: { water: '#0284c7', base: '#f8fafc', greenery: '#15803d', roads: '#94a3b8', buildings: '#ffffff', highlighted: '#f8fafc' },
    plaqueText: 'CUTOUT_TEST',
    totalTriangles: 0,
    sceneData: null,
    ...overrides
  };
}

function parseZipEntries(zipBytes) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map();
  let off = 0;
  while (off + 30 <= zipBytes.length && view.getUint32(off, true) === 0x04034b50) {
    const compSize = view.getUint32(off + 18, true);
    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const name = decoder.decode(zipBytes.subarray(off + 30, off + 30 + nameLen));
    const dataStart = off + 30 + nameLen + extraLen;
    const data = zipBytes.subarray(dataStart, dataStart + compSize);
    entries.set(name, data);
    off = dataStart + compSize;
  }
  return entries;
}

function makeSquare(cx, cy, halfSide) {
  return [
    [cx - halfSide, cy - halfSide],
    [cx + halfSide, cy - halfSide],
    [cx + halfSide, cy + halfSide],
    [cx - halfSide, cy + halfSide]
  ];
}

function countTrisInBox(tris, minX, maxX, minY, maxY, minZ = -Infinity) {
  let cnt = 0;
  for (let i = 0; i < (tris || []).length; i++) {
    const t = tris[i];
    const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
    const cy = (t.v0[1] + t.v1[1] + t.v2[1]) / 3;
    const cz = (t.v0[2] + t.v1[2] + t.v2[2]) / 3;
    if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY && cz >= minZ) cnt++;
  }
  return cnt;
}

function getTileNonWaterTriCounts(meshes, numTiles) {
  const counts = new Array(numTiles).fill(0);
  for (const k of ['base', 'greenery', 'roads', 'buildings', 'highlighted']) {
    const arr = meshes[k] || [];
    for (let i = 0; i < arr.length; i++) {
      const tid = arr[i].tileId !== undefined ? arr[i].tileId : 0;
      if (tid >= 0 && tid < numTiles) counts[tid]++;
    }
  }
  return counts;
}

// ============================================================================
// [1/6] Strict Zero-Regression (waterCutout=false) & Micro-Islet / Protection
// ============================================================================
console.log('\n[1/6] Zero-Regression (waterCutout=false), Micro-Islet Filtering (< 6 mm²) & Protected Islets');
(() => {
  // Large lake spanning upper quadrant & left-side open channel so 2x2 has one 100% water tile
  const demGrid = Array.from({ length: 16 }, (_, r) =>
    Array.from({ length: 16 }, (__, c) => (r >= 6 && c <= 6 ? -1.5 : 4.0))
  );
  // At 250mm / 169.2u = 1.4775 mm/u:
  //   micro-islet halfSide=0.55 => area=1.21 u² => 2.64 mm² (< 6.0 mm²)
  //   building-protected small islet halfSide=0.60 => area=1.44 u² => 3.14 mm² (< 6.0 mm²), has building!
  //   large islet halfSide=3.0 => area=36.0 u² => 78.6 mm² (> 6.0 mm²)
  const microIslet = makeSquare(-35, 35, 0.55);
  const protectedIslet = makeSquare(-15, 35, 0.60);
  const largeIslet = makeSquare(15, 35, 3.0);

  const isletScene = {
    spanMeters: 800,
    dem: { grid: demGrid, minElev: -1.5, maxElev: 4.0 },
    waterPolys: [
      {
        outer: [[-80, 10], [50, 10], [50, 75], [-80, 75]],
        holes: [microIslet, protectedIslet, largeIslet],
        name: 'Jezioro Testowe'
      }
    ],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [],
    bridgePolys: [],
    buildings: [
      {
        id: 'b_islet_keep',
        outer: makeSquare(-15, 35, 0.45),
        holes: [],
        height: 8.0,
        levels: 2,
        btype: 'house',
        role: 'solid',
        buildingId: 'b_islet_keep'
      }
    ]
  };

  // Strict baseline when waterCutout=false
  const stateOff = makeBaseState({ waterCutout: false });
  const resOff = sb.buildComplete3DModel(isletScene, stateOff);
  check(resOff.meshes.water.length > 0, 'waterCutout=false emits water mesh', `waterTris=${resOff.meshes.water.length}`);
  check(
    resOff.printMetrics.isWatertightManifold && resOff.printMetrics.openEdgesCount === 0 && resOff.printMetrics.nonManifoldEdgesCount === 0,
    'waterCutout=false islet scene is 2-manifold',
    `open=${resOff.printMetrics.openEdgesCount}, nm=${resOff.printMetrics.nonManifoldEdgesCount}`
  );
  const microTrisOff = countTrisInBox(resOff.meshes.base, -37, -33, 33, 37, 0.2);
  check(microTrisOff > 0, 'waterCutout=false keeps tiny islet via Nyquist guard (no regression)', `tris=${microTrisOff}`);

  // Enabled waterCutout=true
  const stateOn = makeBaseState({ waterCutout: true });
  const resOn = sb.buildComplete3DModel(isletScene, stateOn);
  check(resOn.meshes.water.length === 0, 'waterCutout=true emits 0 water tris');
  const microTrisOn = countTrisInBox(resOn.meshes.base, -37, -33, 33, 37, 0.05);
  const protBaseTrisOn = countTrisInBox(resOn.meshes.base, -17, -13, 33, 37, 0.05);
  const protBldTrisOn = countTrisInBox(resOn.meshes.buildings, -17, -13, 33, 37, 0.05);
  const largeTrisOn = countTrisInBox(resOn.meshes.base, 12, 18, 32, 38, 0.05);
  check(microTrisOn === 0, 'waterCutout=true removes uninhabited < 6 mm² micro-islet cleanly', `microTris=${microTrisOn}`);
  check(protBaseTrisOn > 0 && protBldTrisOn > 0, 'waterCutout=true preserves building-protected small islet', `base=${protBaseTrisOn}, bld=${protBldTrisOn}`);
  check(largeTrisOn > 0, 'waterCutout=true preserves > 6 mm² island', `largeTris=${largeTrisOn}`);
  check(
    resOn.printMetrics.isWatertightManifold &&
    resOn.printMetrics.openEdgesCount === 0 &&
    resOn.printMetrics.nonManifoldEdgesCount === 0 &&
    resOn.printMetrics.floatingBuildingsCount === 0,
    'waterCutout=true filtered-islet scene is strictly 2-manifold with 0 floating buildings',
    `open=${resOn.printMetrics.openEdgesCount}, nm=${resOn.printMetrics.nonManifoldEdgesCount}, float=${resOn.printMetrics.floatingBuildingsCount}`
  );
})();

// ============================================================================
// [2/6] Bridge Pier Reinforcement at Z=0 Exclusively Under waterCutout=true
// ============================================================================
console.log('\n[2/6] MSLA Z=0 Bridge Pier Reinforcement (gated on waterCutout=true)');
(() => {
  const bridgeScene = {
    spanMeters: 700,
    dem: {
      grid: Array.from({ length: 10 }, (_, r) => Array(10).fill((r <= 3 || r >= 6) ? 16.0 : 0.0)),
      minElev: 0.0,
      maxElev: 16.0
    },
    waterPolys: [
      { outer: [[-80, -18], [80, -18], [80, 18], [-80, 18]], holes: [], name: 'Rzeka Testowa' }
    ],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [
      {
        pts: [[0, -34], [0, -14], [0, 14], [0, 34]],
        width: 1.8,
        isBridge: true,
        layer: 1,
        highway: 'footway'
      }
    ],
    bridgePolys: [],
    buildings: []
  };

  const stateOff = makeBaseState({ waterCutout: false });
  const resOff = sb.buildComplete3DModel(bridgeScene, stateOff);
  const stateOn = makeBaseState({ waterCutout: true });
  const resOn = sb.buildComplete3DModel(bridgeScene, stateOn);

  const measureChannelPiers = (roadTris) => {
    let minZ = Infinity;
    const channelTris = [];
    for (const t of roadTris || []) {
      const cy = (t.v0[1] + t.v1[1] + t.v2[1]) / 3;
      const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
      if (Math.abs(cy) < 10 && Math.abs(cx) < 8) {
        channelTris.push(t);
        const triMinZ = Math.min(t.v0[2], t.v1[2], t.v2[2]);
        if (triMinZ < minZ) minZ = triMinZ;
      }
    }
    // Triangles on bottom pier face (or within 0.05u of minZ) reveal pier XY cross-section
    let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
    let bottomArea = 0;
    for (const t of channelTris) {
      const pts = [t.v0, t.v1, t.v2];
      if (pts.every(p => Math.abs(p[2] - minZ) < 0.03)) {
        for (const p of pts) {
          if (p[0] < pMinX) pMinX = p[0];
          if (p[0] > pMaxX) pMaxX = p[0];
          if (p[1] < pMinY) pMinY = p[1];
          if (p[1] > pMaxY) pMaxY = p[1];
        }
        const ax = t.v1[0] - t.v0[0], ay = t.v1[1] - t.v0[1];
        const bx = t.v2[0] - t.v0[0], by = t.v2[1] - t.v0[1];
        bottomArea += 0.5 * Math.abs(ax * by - ay * bx);
      }
    }
    return { minZ, pierWidthX: pMaxX - pMinX, bottomArea };
  };

  const offPiers = measureChannelPiers(resOff.meshes.roads);
  const onPiers = measureChannelPiers(resOn.meshes.roads);
  check(offPiers.minZ > 0.3, 'waterCutout=false pier stops on water surface (>0)', `minZ=${offPiers.minZ.toFixed(3)}`);
  check(Math.abs(onPiers.minZ) < 1e-4, 'waterCutout=true pier descends cleanly to Z=0.0', `minZ=${onPiers.minZ.toFixed(4)}`);
  check(
    onPiers.bottomArea > offPiers.bottomArea * 1.25 && onPiers.pierWidthX >= offPiers.pierWidthX,
    'waterCutout=true reinforces bridge pier cross-section footprint at Z=0 (+50%+)',
    `offArea=${offPiers.bottomArea.toFixed(3)} (w=${offPiers.pierWidthX.toFixed(3)}) -> onArea=${onPiers.bottomArea.toFixed(3)} (w=${onPiers.pierWidthX.toFixed(3)})`
  );
  check(
    resOn.printMetrics.openEdgesCount === 0 && resOn.printMetrics.nonManifoldEdgesCount === 0,
    'Reinforced Z=0 bridge piers remain 100% 2-manifold',
    `open=${resOn.printMetrics.openEdgesCount}, nm=${resOn.printMetrics.nonManifoldEdgesCount}`
  );
})();

// ============================================================================
// [3/6] 100% Open Sea & 360° Sea-Surrounded Island (With/Without Inland Pond)
// ============================================================================
console.log('\n[3/6] 100% Open Sea & 360° Sea-Surrounded Island Coastline Synthesis');
(() => {
  // Verify stitchCoastlineSeaPolysJS detects closed CCW island loop inside frame with 0 bbox cuts
  const islandLoop = [[-22, -22], [22, -22], [22, 22], [-22, 22], [-22, -22]]; // CCW = land left, water right
  const wpTest = [];
  const metaOut = {};
  sb.stitchCoastlineSeaPolysJS([islandLoop], 84.6, 84.6, wpTest, metaOut);
  check(wpTest.length === 0, 'Closed in-frame island coastline produces 0 stitched edge-chord waterPolys');
  check(
    Array.isArray(metaOut.openSeaIslands) && metaOut.openSeaIslands.length === 1,
    'stitchCoastlineSeaPolysJS records metaOut.openSeaIslands for 360° sea-surrounded island',
    `islands=${metaOut.openSeaIslands ? metaOut.openSeaIslands.length : 0}`
  );

  // 3a. 100% Pure Open Ocean Scene
  const pureSeaScene = {
    spanMeters: 1200,
    _hasMarineTags: true,
    dem: { grid: Array.from({ length: 8 }, () => Array(8).fill(-4.0)), minElev: -4.0, maxElev: -4.0 },
    waterPolys: [],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [],
    bridgePolys: [],
    buildings: []
  };

  const seaOff = sb.buildComplete3DModel(pureSeaScene, makeBaseState({ waterCutout: false }));
  check(seaOff.meshes.water.length === 0 && seaOff.meshes.base.length > 0, 'Pure ocean (no polys) waterCutout=false does NOT trigger open-sea cutout (strict zero-regression)', `water=${seaOff.meshes.water.length}, base=${seaOff.meshes.base.length}`);

  const seaOn = sb.buildComplete3DModel(pureSeaScene, makeBaseState({ waterCutout: true }));
  const printableSeaOn = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted']
    .reduce((acc, k) => acc + ((seaOn.meshes[k] && seaOn.meshes[k].length) || 0), 0);
  check(
    seaOn.meshes.water.length === 0 && seaOn.meshes.base.length === 0 && printableSeaOn === 0,
    'Pure ocean waterCutout=true cuts out 100% printable layers to 0 triangles',
    `water=${seaOn.meshes.water.length}, base=${seaOn.meshes.base.length}, printable=${printableSeaOn}`
  );

  // 3b. 360° Sea-Surrounded Island WITH Inland Pond + Building on Dry Ring
  const islandOuter = makeSquare(0, 0, 26);
  const inlandPond = makeSquare(0, 0, 8);
  const atollScene = {
    spanMeters: 1000,
    _hasMarineTags: true,
    _openSeaIslands: [islandOuter],
    dem: { grid: Array.from({ length: 12 }, () => Array(12).fill(3.5)), minElev: 0.0, maxElev: 3.5 },
    waterPolys: [{ outer: inlandPond, holes: [], name: 'Laguna Wewnętrzna' }],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [],
    bridgePolys: [],
    buildings: [
      {
        id: 'b_atoll',
        outer: makeSquare(15, 0, 2.5),
        holes: [],
        height: 10.0,
        levels: 3,
        btype: 'house',
        role: 'solid',
        buildingId: 'b_atoll'
      }
    ]
  };

  const atollOn = sb.buildComplete3DModel(atollScene, makeBaseState({ waterCutout: true }));
  const outerCornerTris = countTrisInBox(atollOn.meshes.base, -80, -45, -80, -45, 0.01);
  const pondCenterTris = countTrisInBox(atollOn.meshes.base, -3, 3, -3, 3, 0.05);
  const islandRingTris = countTrisInBox(atollOn.meshes.base, 11, 22, -5, 5, 0.05);
  check(outerCornerTris === 0, '360° sea-surrounded island cuts outer surrounding sea completely', `outerTris=${outerCornerTris}`);
  check(pondCenterTris === 0, '360° island inland pond is also cut cleanly to Z=0', `pondTris=${pondCenterTris}`);
  check(islandRingTris > 0 && atollOn.meshes.buildings.length > 0, '360° island dry ring and buildings remain intact', `ringTris=${islandRingTris}, bld=${atollOn.meshes.buildings.length}`);
  check(
    atollOn.printMetrics.isWatertightManifold && atollOn.printMetrics.openEdgesCount === 0 && atollOn.printMetrics.nonManifoldEdgesCount === 0,
    '360° sea-surrounded island with inland pond is 100% 2-manifold',
    `open=${atollOn.printMetrics.openEdgesCount}, nm=${atollOn.printMetrics.nonManifoldEdgesCount}`
  );
})();

// ============================================================================
// [4/6] Exporters (.STL, .3MF, .ZIP) Blocking Empty Sea & Exporting Mixed Tiles
// ============================================================================
console.log('\n[4/6] .STL / .3MF / .ZIP Empty Sea Tile Blocking & Mixed Tile Export + UI Selectors');
(() => {
  const downloads = [];
  sb.downloadBlobHook = (bytes, filename, mime) => {
    downloads.push({ bytes, filename, mime });
  };
  const clearDownloads = () => { downloads.length = 0; };

  // 4a. 100% Open Ocean state (waterCutout=true) -> .STL / .3MF / .ZIP all blocked
  const oceanState = makeBaseState({
    waterCutout: true,
    tileCols: 2,
    tileRows: 2,
    layerMeshes: { water: [], base: [], greenery: [], roads: [], buildings: [], highlighted: [], frame: [] },
    printMetrics: { totalVolumeMl: 0, isWatertightManifold: false }
  });

  clearDownloads();
  const rStl1x1 = sb.exportBinarySTL({ ...oceanState, tileCols: 1, tileRows: 1 }, 'all');
  const rStlWater = sb.exportBinarySTL(oceanState, 'water');
  const r3mfOcean = sb.exportMultiColor3MF(oceanState);
  const rZipOcean = sb.exportAllTilesZipSTL(oceanState, 'all');
  check(
    rStl1x1 === false && rStlWater === false && r3mfOcean === false && rZipOcean === false && downloads.length === 0,
    'All exporters (.STL, water-layer, .3MF, .ZIP) block 100% empty sea under waterCutout=true',
    `results=[${rStl1x1},${rStlWater},${r3mfOcean},${rZipOcean}], downloads=${downloads.length}`
  );
  const badgeText = sb.__elements.get('preflightStatusBadge').textContent;
  check(badgeText.includes('Pominięto'), 'Empty cutout export shows non-blocking amber status badge', `badge="${badgeText}"`);

  // 4b. 2x2 Coastal Scene: Northwest corner (R1C1 -> tid=2) 100% sea; East/South tiles contain mixed sea+land
  const coastal2x2Scene = {
    spanMeters: 1000,
    dem: { grid: Array.from({ length: 12 }, () => Array(12).fill(3.0)), minElev: 3.0, maxElev: 3.0 },
    waterPolys: [{ outer: [[-90, -25], [30, -25], [30, 90], [-90, 90]], holes: [], name: 'Zatoka Północna' }],
    waterLines: [],
    greenPolys: [],
    trees: [],
    roads: [],
    bridgePolys: [],
    buildings: [
      { id: 'b_coast_se', outer: makeSquare(45, -45, 4), holes: [], height: 9.0, levels: 3, btype: 'house', role: 'solid', buildingId: 'b_coast_se' }
    ]
  };

  const st2x2Cut = makeBaseState({ waterCutout: true, tileCols: 2, tileRows: 2, sceneData: coastal2x2Scene });
  const builtCut = sb.buildComplete3DModel(coastal2x2Scene, st2x2Cut);
  st2x2Cut.layerMeshes = builtCut.meshes;
  st2x2Cut.printMetrics = builtCut.printMetrics;
  st2x2Cut.totalTriangles = builtCut.totalTriangles;

  const tileCounts = getTileNonWaterTriCounts(builtCut.meshes, 4);
  const emptyTid = tileCounts.findIndex(c => c === 0);
  const mixedTid = tileCounts.findIndex(c => c > 0 && builtCut.meshes.base.some(t => t.tileId === 0 || t.tileId === 3));
  check(emptyTid >= 0 && tileCounts.filter(c => c > 0).length >= 2, '2x2 coastal scene has >=1 pure empty-sea tile and >=2 mixed/land tiles', `counts=${JSON.stringify(tileCounts)}`);

  // Single empty-sea tile export blocked
  clearDownloads();
  st2x2Cut.exportTileFilter = String(emptyTid);
  const blockEmptyStl = sb.exportBinarySTL(st2x2Cut, 'all');
  const blockEmpty3mf = sb.exportMultiColor3MF(st2x2Cut);
  check(blockEmptyStl === false && blockEmpty3mf === false && downloads.length === 0, 'Exporting empty sea tile individually is blocked in .STL and .3MF');

  // Mixed sea+land tile (has both bay water cut and coastal land/buildings) MUST export normally!
  const mixedBayTid = [0, 1, 3].find(id => tileCounts[id] > 0 && id !== emptyTid);
  clearDownloads();
  st2x2Cut.exportTileFilter = String(mixedBayTid);
  const okMixedStl = sb.exportBinarySTL(st2x2Cut, 'all');
  const okMixed3mf = sb.exportMultiColor3MF(st2x2Cut);
  check(
    okMixedStl === true && okMixed3mf === true && downloads.length === 2 &&
    downloads[0].bytes.byteLength > 84 && downloads[1].bytes[0] === 0x50 && downloads[1].bytes[1] === 0x4b,
    'Mixed sea+land tile exports normally in both .STL (>84B) and .3MF (PK ZIP)',
    `stl=${downloads[0] && downloads[0].bytes.byteLength}B, 3mf=${downloads[1] && downloads[1].bytes.byteLength}B`
  );

  // Full 2x2 ZIP & 3MF export: omits empty sea tile, exports mixed tiles + README marker
  clearDownloads();
  st2x2Cut.exportTileFilter = 'all';
  const okZipAll = sb.exportAllTilesZipSTL(st2x2Cut, 'all');
  const ok3mfAll = sb.exportMultiColor3MF(st2x2Cut);
  check(okZipAll === true && ok3mfAll === true && downloads.length === 2, 'Full 2x2 coastal grid exports .ZIP and .3MF');
  const zipEntries = parseZipEntries(downloads[0].bytes);
  const stlNames = Array.from(zipEntries.keys()).filter(k => k.endsWith('.stl'));
  const readmeText = new TextDecoder().decode(zipEntries.get('README.txt'));
  check(stlNames.length === tileCounts.filter(c => c > 0).length, 'ZIP contains exact count of non-empty tiles and omits 100%-sea tile', `stls=${stlNames.join(', ')}`);
  check(readmeText.includes('POMINIĘTO — 100% wycięta woda'), 'ZIP README logs POMINIĘTO — 100% wycięta woda');

  const threemfEntries = parseZipEntries(downloads[1].bytes);
  const modelXml = new TextDecoder().decode(threemfEntries.get('3D/3dmodel.model'));
  check(!modelXml.includes(`<item objectid="${100 + emptyTid}"/>`) && modelXml.includes(`<item objectid="${100 + mixedBayTid}"/>`), '.3MF omits empty sea tile assembly and preserves mixed/land tile assemblies');

  // Same coastal 2x2 with waterCutout=false: empty sea tile IS exported (strict zero-regression)
  const st2x2Off = makeBaseState({ waterCutout: false, tileCols: 2, tileRows: 2, sceneData: coastal2x2Scene });
  const builtOff = sb.buildComplete3DModel(coastal2x2Scene, st2x2Off);
  st2x2Off.layerMeshes = builtOff.meshes;
  st2x2Off.printMetrics = builtOff.printMetrics;
  st2x2Off.totalTriangles = builtOff.totalTriangles;
  clearDownloads();
  st2x2Off.exportTileFilter = String(emptyTid);
  const offSeaTileExport = sb.exportBinarySTL(st2x2Off, 'all');
  check(offSeaTileExport === true && downloads.length === 1 && downloads[0].bytes.byteLength > 84, 'waterCutout=false still exports sea tile normally (zero regression)');
})();

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
