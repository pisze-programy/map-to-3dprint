import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));
const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
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
    `tris=${pm?.totalTriangles}, open=${pm?.openEdgesCount}, nm=${pm?.nonManifoldEdgesCount}, dup=${pm?.sameDirDupEdgesCount}, float=${pm?.floatingBuildingsCount}`
  );
}

function maxChordDeviation(pts) {
  if (!pts || pts.length < 3) return 0;
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let maxD = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const px = pts[i][0] - a[0], py = pts[i][1] - a[1];
    maxD = Math.max(maxD, Math.abs(px * (-dy / len) + py * (dx / len)));
  }
  return maxD;
}

function trisMeshVolume(tris) {
  let vol = 0;
  for (const t of tris || []) {
    const a = t.v0 || t.a, b = t.v1 || t.b, c = t.v2 || t.c;
    if (!a || !b || !c) continue;
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0;
  }
  return Math.abs(vol);
}

async function runSuite() {
  console.log('================================================================');
  console.log('   ETAP 4: GLOBAL OSM BRIDGE GRAPH & MSLA BRIDGE INVARIANTS');
  console.log('================================================================');

  // [1/7] Abutment Continuity (Z_A != Z_B) & Sloped Grade Z(s)
  console.log('\n[1/7] Abutment Continuity & Continuous Sloped Grade Z(s)');
  {
    const scene = {
      spanMeters: 600,
      dem: {
        grid: [
          [20, 4, 10],
          [20, 2, 10],
          [20, 4, 10],
        ],
        minElev: 2,
        maxElev: 20,
      },
      waterPolys: [{ outer: [[-18, -80], [18, -80], [18, 80], [-18, 80]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
      roads: [{
        pts: [[-58, 0], [58, 0]],
        width: 4.5,
        isBridge: true,
        layer: 1,
        structure: 'beam',
        tags: { bridge: 'yes', 'bridge:structure': 'beam' },
      }],
    };
    const res = buildComplete3DModel(scene, makeState());
    assertCleanManifold(res.printMetrics, 'Sloped asymmetric abutment bridge');
    const a = (res.audit.bridgeAudits || [])[0];
    assert.ok(a, 'Expected 1 bridge audit');
    const errA = Math.abs(a.zStartDeck - a.zAbutmentA);
    const errB = Math.abs(a.zEndDeck - a.zAbutmentB);
    check(errA <= 0.15 && errB <= 0.15,
      'Deck endpoints match bank terrain abutments within tolerance',
      `zStart=${a.zStartDeck} vs zA=${a.zAbutmentA}, zEnd=${a.zEndDeck} vs zB=${a.zAbutmentB}`);
    check(a.zStartDeck > a.zEndDeck + 0.8,
      'Asymmetric banks produce non-flat continuous downhill grade Z(s)',
      `zStart=${a.zStartDeck} -> zEnd=${a.zEndDeck}`);
  }

  // [2/7] height=343 Superstructure-Only Invariant
  console.log('\n[2/7] height=343 Superstructure-Only Invariant (No Floating Skyway)');
  {
    const scene = {
      spanMeters: 800,
      dem: {
        grid: [
          [16, 2, 16],
          [16, 2, 16],
          [16, 2, 16],
        ],
        minElev: 2,
        maxElev: 16,
      },
      waterPolys: [{ outer: [[-24, -82], [24, -82], [24, 82], [-24, 82]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
      roads: [{
        pts: [[-65, 0], [65, 0]],
        width: 5.0,
        isBridge: true,
        layer: 1,
        structure: 'cable-stayed',
        heightM: 343,
        tags: { bridge: 'yes', 'bridge:structure': 'cable-stayed', height: '343' },
      }],
    };
    const res = buildComplete3DModel(scene, makeState({ waterCutout: true }));
    assertCleanManifold(res.printMetrics, 'height=343 cable-stayed bridge');
    const a = (res.audit.bridgeAudits || [])[0];
    assert.ok(a, 'Expected cable-stayed audit');
    check(
      Math.abs(a.zStartDeck - a.zAbutmentA) <= 0.15 && Math.abs(a.zEndDeck - a.zAbutmentB) <= 0.15 && a.zDeckTop < a.zAbutmentA + 4.0,
      'height=343 does NOT lift roadway into stratosphere — deck anchors cleanly to banks',
      `zDeckTop=${a.zDeckTop}, zA=${a.zAbutmentA}, zB=${a.zAbutmentB}`
    );
    check(
      a.zPylonTop > a.zDeckTop + 3.0,
      'height=343 drives tall pylons soaring cleanly above the road deck',
      `zPylonTop=${a.zPylonTop} > zDeckTop=${a.zDeckTop}`
    );
  }

  // [3/7] Full OSM Extraction: type=bridge + across Inheritance, Curved Axis, bridge:support & layer=-1
  console.log('\n[3/7] OSM Graph Extraction (type=bridge, Curved Axis, bridge:support, layer=-1)');
  {
    const cLat = 47.0, cLon = 9.0;
    const dLat = 0.0008, dLon = 0.0012;
    const osmElements = [
      // Curved road bridge centerline (5 nodes arcing strongly south/north in middle)
      { type: 'node', id: 1, lat: cLat - 0.0002, lon: cLon - 0.0018 },
      { type: 'node', id: 2, lat: cLat + 0.00055, lon: cLon - 0.0009 },
      { type: 'node', id: 3, lat: cLat + 0.00095, lon: cLon },
      { type: 'node', id: 4, lat: cLat + 0.00055, lon: cLon + 0.0009 },
      { type: 'node', id: 5, lat: cLat - 0.0002, lon: cLon + 0.0018 },
      // Parallel carriageway sharing curved corridor inside man_made=bridge
      { type: 'node', id: 6, lat: cLat - 0.00026, lon: cLon - 0.0018 },
      { type: 'node', id: 7, lat: cLat + 0.00049, lon: cLon - 0.0009 },
      { type: 'node', id: 8, lat: cLat + 0.00089, lon: cLon },
      { type: 'node', id: 9, lat: cLat + 0.00049, lon: cLon + 0.0009 },
      { type: 'node', id: 10, lat: cLat - 0.00026, lon: cLon + 0.0018 },
      // man_made=bridge polygon outline enclosing the curve cleanly
      { type: 'node', id: 11, lat: cLat + 0.00000, lon: cLon - 0.00185 },
      { type: 'node', id: 12, lat: cLat + 0.00072, lon: cLon - 0.0009 },
      { type: 'node', id: 13, lat: cLat + 0.00112, lon: cLon },
      { type: 'node', id: 14, lat: cLat + 0.00072, lon: cLon + 0.0009 },
      { type: 'node', id: 15, lat: cLat + 0.00000, lon: cLon + 0.00185 },
      { type: 'node', id: 16, lat: cLat - 0.00040, lon: cLon + 0.00185 },
      { type: 'node', id: 17, lat: cLat + 0.00032, lon: cLon + 0.0009 },
      { type: 'node', id: 18, lat: cLat + 0.00072, lon: cLon },
      { type: 'node', id: 19, lat: cLat + 0.00032, lon: cLon - 0.0009 },
      { type: 'node', id: 25, lat: cLat - 0.00040, lon: cLon - 0.00185 },
      // Explicit bridge:support node + polygon (tagged with building=yes too — must not be swallowed!)
      { type: 'node', id: 20, lat: cLat + 0.00052, lon: cLon - 0.00045, tags: { 'bridge:support': 'pier' } },
      { type: 'node', id: 21, lat: cLat + 0.00050, lon: cLon + 0.00042 },
      { type: 'node', id: 22, lat: cLat + 0.00050, lon: cLon + 0.00048 },
      { type: 'node', id: 23, lat: cLat + 0.00056, lon: cLon + 0.00048 },
      { type: 'node', id: 24, lat: cLat + 0.00056, lon: cLon + 0.00042 },
      // River channel below
      { type: 'node', id: 30, lat: cLat - dLat * 2, lon: cLon - 0.0003 },
      { type: 'node', id: 31, lat: cLat - dLat * 2, lon: cLon + 0.0003 },
      { type: 'node', id: 32, lat: cLat + dLat * 2, lon: cLon + 0.0003 },
      { type: 'node', id: 33, lat: cLat + dLat * 2, lon: cLon - 0.0003 },
      // Negative layer=-1 bridge passing over layer=-2 cut road
      { type: 'node', id: 40, lat: cLat - 0.0011, lon: cLon - 0.0012 },
      { type: 'node', id: 41, lat: cLat - 0.0011, lon: cLon + 0.0012 },
      { type: 'node', id: 42, lat: cLat - 0.0016, lon: cLon },
      { type: 'node', id: 43, lat: cLat - 0.0006, lon: cLon },

      { type: 'way', id: 101, nodes: [1, 2, 3, 4, 5], tags: { highway: 'primary', bridge: 'yes', 'bridge:structure': 'arch', layer: '1', 'seamark:bridge:clearance_height': '18' } },
      { type: 'way', id: 102, nodes: [6, 7, 8, 9, 10], tags: { highway: 'primary', bridge: 'yes', layer: '1' } },
      { type: 'way', id: 103, nodes: [11, 12, 13, 14, 15, 16, 17, 18, 19, 25, 11], tags: { man_made: 'bridge', layer: '1' } },
      { type: 'way', id: 104, nodes: [21, 22, 23, 24, 21], tags: { building: 'yes', 'bridge:support': 'pier' } },
      { type: 'way', id: 105, nodes: [30, 31, 32, 33, 30], tags: { natural: 'water', waterway: 'riverbank' } },
      { type: 'way', id: 106, nodes: [40, 41], tags: { highway: 'secondary', bridge: 'yes', layer: '-1' } },
      { type: 'way', id: 107, nodes: [42, 43], tags: { highway: 'tertiary', layer: '-2' } },
      {
        type: 'relation', id: 201,
        members: [
          { type: 'way', ref: 103, role: 'outline' },
          { type: 'way', ref: 101, role: 'across' },
          { type: 'way', ref: 102, role: 'across' },
          { type: 'node', ref: 20, role: 'support' },
          { type: 'way', ref: 104, role: 'support' },
        ],
        tags: { type: 'bridge', name: 'Curved Test Viaduct' },
      },
    ];

    const built = await loadSceneAndBuildModel({
      title: 'ETAP4_OSM_EXTRACT',
      osmElements,
      lat: cLat,
      lon: cLon,
      spanMeters: 500,
      offlineOnly: true,
      offlineFallbackDem: true,
      waterCutout: false,
      wantTrees: false,
      showFrame: false,
      cropRatio: 1.0,
      silent: true,
    });
    assertCleanManifold(built.printMetrics, 'Full OSM type=bridge extraction');
    const supports = built.scene.bridgeSupports || [];
    check(supports.length >= 2, 'Extracts both node and building-tagged polygon bridge:support entries', `bridgeSupports=${supports.length}`);
    const audits = built.model.audit.bridgeAudits || [];
    const curvedArch = audits.find(a => a.structure === 'arch');
    assert.ok(curvedArch, 'man_made=bridge inherits arch structure from across road');
    const dev = maxChordDeviation(curvedArch.axisPts);
    check(curvedArch.axisPts.length >= 5 && dev > 1.0,
      'Bridge axis preserves curved graph alignment (no straight chord / 90° OBB flip)',
      `stations=${curvedArch.axisPts.length}, chordDeviation=${dev.toFixed(2)}u`);
    check(curvedArch.explicitSupportsUsed >= 1,
      'Extracted OSM bridge:support elements attached to arch bridge',
      `explicitSupportsUsed=${curvedArch.explicitSupportsUsed}`);
    const negBridge = audits.find(a => a.deckLayer === -1);
    check(Boolean(negBridge), 'Preserves layer=-1 road bridge instead of dropping negative-layer bridges',
      `layers=${JSON.stringify(audits.map(a => a.deckLayer))}`);
  }

  // [4/7] Waterway Channel Protection vs Explicit OSM Supports (+ waterCutout Z=0)
  console.log('\n[4/7] Waterway Protection vs Explicit bridge:support + waterCutout Z=0');
  {
    const baseScene = (structure, bridgeSupports = []) => ({
      spanMeters: 700,
      dem: { grid: [[14, 2, 14], [14, 2, 14], [14, 2, 14]], minElev: 2, maxElev: 14 },
      waterPolys: [{ outer: [[-26, -80], [26, -80], [26, 80], [-26, 80]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgePolys: [], buildings: [],
      bridgeSupports,
      roads: [{
        pts: [[-60, 0], [60, 0]],
        width: 4.5,
        isBridge: true,
        layer: 1,
        structure,
        heightM: structure === 'cable-stayed' || structure === 'suspension' ? 65 : undefined,
        tags: { bridge: 'yes', 'bridge:structure': structure },
      }],
    });

    for (const sType of ['arch', 'suspension', 'cable-stayed', 'truss']) {
      const res = buildComplete3DModel(baseScene(sType), makeState({ waterCutout: true }));
      assertCleanManifold(res.printMetrics, `${sType} without explicit supports`);
      const a = (res.audit.bridgeAudits || [])[0];
      check(a && a.syntheticWaterPiers === 0,
        `${sType} plants 0 synthetic mid-channel piers in water`,
        `syntheticWaterPiers=${a?.syntheticWaterPiers}`);
    }

    const withPier = buildComplete3DModel(
      baseScene('truss', [{ kind: 'node', pt: [0, 0], supportType: 'pier', tags: { 'bridge:support': 'pier' } }]),
      makeState({ waterCutout: true })
    );
    assertCleanManifold(withPier.printMetrics, 'truss with explicit OSM pier under waterCutout');
    const pa = (withPier.audit.bridgeAudits || [])[0];
    check(pa && pa.explicitSupportsUsed === 1 && pa.pierMinZ === 0,
      'Explicit bridge:support=pier placed in channel and anchored cleanly to Z=0.0',
      `explicitUsed=${pa?.explicitSupportsUsed}, pierMinZ=${pa?.pierMinZ}`);
  }

  // [5/7] Auto through-arch Over Low Flat River vs Lower arch in Deep Gorge
  console.log('\n[5/7] Auto through-arch (Low River) vs Lower deck-arch (Deep Gorge)');
  {
    const lowRiver = {
      spanMeters: 500,
      dem: { grid: [[4.5, 4.0, 4.5], [4.5, 4.0, 4.5]], minElev: 4.0, maxElev: 4.5 },
      waterPolys: [{ outer: [[-28, -80], [28, -80], [28, 80], [-28, 80]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
      roads: [{ pts: [[-55, 0], [55, 0]], width: 4.5, isBridge: true, layer: 1, structure: 'arch', tags: { bridge: 'yes', 'bridge:structure': 'arch' } }],
    };
    const deepGorge = {
      spanMeters: 500,
      dem: { grid: [[32, 32, 2, 32, 32], [32, 32, 2, 32, 32]], minElev: 2.0, maxElev: 32.0 },
      waterPolys: [{ outer: [[-18, -80], [18, -80], [18, 80], [-18, 80]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
      roads: [{ pts: [[-55, 0], [55, 0]], width: 4.5, isBridge: true, layer: 1, structure: 'arch', tags: { bridge: 'yes', 'bridge:structure': 'arch' } }],
    };

    const resLow = buildComplete3DModel(lowRiver, makeState());
    const resDeep = buildComplete3DModel(deepGorge, makeState());
    assertCleanManifold(resLow.printMetrics, 'Low-clearance flat-river arch');
    assertCleanManifold(resDeep.printMetrics, 'Deep-gorge arch');
    const aLow = resLow.audit.bridgeAudits[0];
    const aDeep = resDeep.audit.bridgeAudits[0];
    check(aLow.isThroughArch === true && aLow.zPylonTop > aLow.zDeckTop + 0.8,
      'Low river clearance triggers overhead through-arch above deck',
      `isThroughArch=${aLow.isThroughArch}, zTop=${aLow.zPylonTop} vs deck=${aLow.zDeckTop}`);
    check(aDeep.isThroughArch === false && aDeep.midspanClearanceU > 2.2,
      'Deep gorge keeps lower deck-arch beneath high deck without through-arch',
      `isThroughArch=${aDeep.isThroughArch}, clearance=${aDeep.midspanClearanceU}`);
  }

  // [6/7] Stacked Multi-Deck (layer=1 vs layer=2) & MSLA Mono 4 Strut/Anti-Capillary Laws
  console.log('\n[6/7] Multi-Deck Layer Clearance & MSLA Mono 4 Strut/Gap Physics');
  {
    const scene = {
      spanMeters: 750,
      dem: { grid: [[8, 8], [8, 8]], minElev: 8, maxElev: 8 },
      waterPolys: [{ outer: [[-20, -80], [20, -80], [20, 80], [-20, 80]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
      roads: [
        { pts: [[-55, 0], [55, 0]], width: 4.0, isBridge: true, layer: 1, structure: 'beam', tags: { bridge: 'yes', 'bridge:structure': 'beam', layer: '1' } },
        { pts: [[-55, 0], [55, 0]], width: 3.8, isBridge: true, layer: 2, structure: 'cable-stayed', heightM: 80, tags: { bridge: 'yes', 'bridge:structure': 'cable-stayed', layer: '2' } },
      ],
    };
    const res = buildComplete3DModel(scene, makeState({ bedSizeMm: 150, totalHeightMm: 150 }));
    assertCleanManifold(res.printMetrics, 'Double-deck layer=1 + layer=2 cable-stayed bridge');
    const [b1, b2] = res.audit.bridgeAudits;
    check(res.printMetrics.multiDeckSeparationsOk === true && b2 && b1 && b2.zBotArr[Math.floor(b2.zBotArr.length / 2)] > b1.zTopArr[Math.floor(b1.zTopArr.length / 2)] + 0.1,
      'Stacked layer=2 maintains positive air clearance above layer=1',
      `loTop=${Math.max(...b1.zTopArr).toFixed(2)}, hiBot=${b2.zBotArr[Math.floor(b2.zBotArr.length / 2)].toFixed(2)}`);
    check(b2.minStrutMm >= 0.48 && b2.minStayGapMm >= 0.48,
      'Cable-stayed stays obey MSLA Mono 4 >= 0.48 mm strut & anti-capillary gap',
      `minStrutMm=${b2.minStrutMm}, minStayGapMm=${b2.minStayGapMm}`);
  }

  // [7/7] supportlessMode Flag (Default false vs Optional true >= 35° Corbels)
  console.log('\n[7/7] supportlessMode Switch (Default false vs >= 35° Self-Supporting Corbels)');
  {
    const scene = {
      spanMeters: 280,
      dem: { grid: [[14, 2, 14], [14, 2, 14]], minElev: 2, maxElev: 14 },
      waterPolys: [], waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
      roads: [{ pts: [[-50, 0], [50, 0]], width: 5.0, isBridge: true, layer: 1, structure: 'beam', tags: { bridge: 'yes', 'bridge:structure': 'beam' } }],
    };
    const resDefault = buildComplete3DModel(scene, makeState());
    const resSupportless = buildComplete3DModel(scene, makeState({ supportlessMode: true }));
    assertCleanManifold(resDefault.printMetrics, 'Default supportlessMode (undefined -> false)');
    assertCleanManifold(resSupportless.printMetrics, 'Explicit supportlessMode=true');
    const volDef = trisMeshVolume(resDefault.meshes.roads);
    const volSup = trisMeshVolume(resSupportless.meshes.roads);
    check(
      resDefault.printMetrics.supportlessMode === false && resSupportless.printMetrics.supportlessMode === true,
      'Default build keeps supportlessMode === false; explicit true activates self-supporting mode',
      `default=${resDefault.printMetrics.supportlessMode}, true=${resSupportless.printMetrics.supportlessMode}`
    );
    check(
      resSupportless.meshes.roads.length > resDefault.meshes.roads.length && volSup > volDef + 0.05,
      'supportlessMode=true emits angled >=35° underside corbels vs flat soffit under false',
      `trisDef=${resDefault.meshes.roads.length} (vol=${volDef.toFixed(2)}) vs trisSup=${resSupportless.meshes.roads.length} (vol=${volSup.toFixed(2)})`
    );
  }

  // [8/9] Long 280mm Viaduct Strut Scale Regression (baySpanMm, No 10mm Strut Explosion)
  console.log('\n[8/9] Long 280mm Viaduct Strut Scale Regression (minStrutMm <= 1.0)');
  {
    const scene = {
      spanMeters: 2500,
      dem: { grid: [[18, 2, 18], [18, 2, 18]], minElev: 2, maxElev: 18 },
      waterPolys: [{ outer: [[-18, -80], [18, -80], [18, 80], [-18, 80]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
      roads: [{
        pts: [[-84.5, 0], [84.5, 0]],
        width: 3.5,
        isBridge: true,
        layer: 1,
        structure: 'cable-stayed',
        heightM: 90,
        tags: { bridge: 'yes', 'bridge:structure': 'cable-stayed', height: '90' },
      }],
    };
    const res = buildComplete3DModel(scene, makeState({ bedSizeMm: 280, totalHeightMm: 280 }));
    assertCleanManifold(res.printMetrics, 'Long 280mm cable-stayed viaduct');
    const a = (res.audit.bridgeAudits || [])[0];
    check(
      Boolean(a && a.minStrutMm >= 0.48 && a.minStrutMm <= 1.0),
      'Long 280mm viaduct maintains minStrutMm <= 1.0 mm (no 10mm strut bloat)',
      `minStrutMm=${a?.minStrutMm}, minStayGapMm=${a?.minStayGapMm}`
    );
  }

  // [9/11] man_made=bridge With 3 Short Disconnected Midspan Roads Keeps Full Span
  console.log('\n[9/11] man_made=bridge With 3 Short Disconnected Roads Keeps Full Bank-to-Bank Span');
  {
    const polyLenU = 120.0;
    const scene = {
      spanMeters: 800,
      dem: { grid: [[16, 2, 8], [16, 2, 8]], minElev: 2, maxElev: 16 },
      waterPolys: [{ outer: [[-45, -80], [45, -80], [45, 80], [-45, 80]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], buildings: [],
      bridgePolys: [{
        osmId: 901,
        outer: [[-60, -4], [60, -4], [60, 4], [-60, 4]],
        holes: [],
        layer: 1,
        bridgeStructure: 'suspension',
        acrossRoadIds: [911, 912, 913],
        tags: { man_made: 'bridge', 'bridge:structure': 'suspension', layer: '1' },
      }],
      roads: [
        { osmId: 911, _bridgePolyOsmId: 901, pts: [[-20, -0.5], [-10, -0.5]], width: 2.5, isBridge: true, layer: 1, structure: 'suspension', tags: { bridge: 'yes', 'bridge:structure': 'suspension' } },
        { osmId: 912, _bridgePolyOsmId: 901, pts: [[-4, 0.5], [6, 0.5]], width: 2.5, isBridge: true, layer: 1, structure: 'suspension', tags: { bridge: 'yes', 'bridge:structure': 'suspension' } },
        { osmId: 913, _bridgePolyOsmId: 901, pts: [[12, 0.0], [22, 0.0]], width: 2.5, isBridge: true, layer: 1, structure: 'suspension', tags: { bridge: 'yes', 'bridge:structure': 'suspension' } },
      ],
    };
    const res = buildComplete3DModel(scene, makeState());
    assertCleanManifold(res.printMetrics, 'man_made=bridge crossed by 3 short disconnected roads');
    const a = (res.audit.bridgeAudits || [])[0];
    let spanU = 0;
    for (let i = 1; i < ((a && a.axisPts) || []).length; i++) {
      spanU += Math.hypot(a.axisPts[i][0] - a.axisPts[i - 1][0], a.axisPts[i][1] - a.axisPts[i - 1][1]);
    }
    const deckSpanX = a ? (a.bbox[2] - a.bbox[0]) : 0;
    check(
      Boolean(a && spanU >= 0.85 * polyLenU && deckSpanX >= 0.85 * polyLenU),
      'Short disconnected midspan roads do not truncate bridge axis or sloped deck (span >= 0.85 * polyLen)',
      `axisSpanU=${spanU.toFixed(2)} vs polyLenU=${polyLenU.toFixed(2)}, deckSpanX=${deckSpanX.toFixed(2)}`
    );
  }

  // [10/11] Palm Jumeirah / Red Line Metro Regression: Curved 6km Twin-Track Viaduct & 27km Way Clip
  console.log('\n[10/11] Curved 6km Twin-Track Monorail & 27km Metro Way (No Chord-Sagitta Slab or 5.55x Ski-Jump)');
  {
    const track1 = [], track2 = [];
    for (let k = 0; k <= 24; k++) {
      const u = k / 24;
      const x = -68 + u * 136;
      const y = 16.0 * Math.sin(Math.PI * u);
      track1.push([x, y - 0.07]);
      track2.push([x, y + 0.07]);
    }
    const metro1 = [[-420, -310], [-180, -140], [45, -62], [78, -25], [260, 190], [440, 380]];
    const metro2 = metro1.map(([x, y]) => [x + 0.12, y - 0.12]);
    const scene = {
      spanMeters: 6000,
      metersToUnits: 169.2 / 6000,
      dem: { grid: [[3, 3, 3], [3, 3, 3]], minElev: 3, maxElev: 3 },
      waterPolys: [{ outer: [[-56, -40], [-46, -40], [-46, 40], [-56, 40]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], bridgeSupports: [], bridgePolys: [], buildings: [],
      roads: [
        { osmId: 32596320, name: 'Palm Jumeirah Monorail', hwy: 'monorail', pts: track1, width: 0.24, isBridge: true, layer: 2, hasExplicitLayer: true, tags: { railway: 'monorail', bridge: 'yes', layer: '2' } },
        { osmId: 47660188, name: 'Palm Jumeirah Monorail', hwy: 'monorail', pts: track2, width: 0.24, isBridge: true, layer: 2, hasExplicitLayer: true, tags: { railway: 'monorail', bridge: 'yes', layer: '2' } },
        { osmId: 206373167, name: 'Red Line Metro', hwy: 'subway', pts: metro1, width: 0.24, isBridge: true, layer: 3, hasExplicitLayer: true, tags: { railway: 'subway', bridge: 'yes', layer: '3' } },
        { osmId: 700726320, name: 'Red Line Metro', hwy: 'subway', pts: metro2, width: 0.24, isBridge: true, layer: 3, hasExplicitLayer: true, tags: { railway: 'subway', bridge: 'yes', layer: '3' } },
      ],
    };
    const res = buildComplete3DModel(scene, makeState({ zScale: 1.25 }));
    assertCleanManifold(res.printMetrics, '6km curved twin-track Monorail + 27km Metro');
    const mono = (res.audit.bridgeAudits || []).find(a => a.name === 'Palm Jumeirah Monorail');
    const metro = (res.audit.bridgeAudits || []).find(a => a.name === 'Red Line Metro');
    check(
      Boolean(mono && mono.width < 0.9 && maxChordDeviation(mono.axisPts) > 12.0),
      'Curved twin-track Monorail merges locally (<0.9u width, ~15m) while preserving 16u curve sagitta',
      `monoWidth=${mono?.width?.toFixed(2)}u, curveDev=${maxChordDeviation(mono?.axisPts || []).toFixed(2)}u`
    );
    check(
      Boolean(mono && mono.zDeckTop < 2.85),
      'Off-center water crossing at u=0.10..0.15 does NOT trigger 5.55x ski-jump over dry trunk',
      `monoZBot=${mono?.zDeckBot}, monoZTop=${mono?.zDeckTop}`
    );
    check(
      Boolean(metro && metro.width < 0.9),
      '27km Red Line Metro clips to print bed before solving and keeps slender <0.9u width (no 43u slab)',
      `metroWidth=${metro?.width?.toFixed(2)}u`
    );
  }

  // [11/11] Dry-Land layer=1 Overpass Over layer=0 Street + Non-Zero cropCenterX/Y (ctx.toBed)
  console.log('\n[11/11] Dry-Land layer=1 Overpass Over layer=0 Street + Cropped Bed (ctx.toBed) Alignment');
  {
    const cxScene = 25.0, cyScene = -18.0;
    const scene = {
      spanMeters: 1200,
      metersToUnits: 169.2 / 1200,
      halfW: 84.6,
      halfH: 84.6,
      _fetchedCropRatio: 1.0,
      dem: { grid: [[6, 6], [6, 6]], minElev: 6, maxElev: 6 },
      waterPolys: [], waterLines: [], greenPolys: [], trees: [], bridgePolys: [], buildings: [],
      bridgeSupports: [{ kind: 'pier', isPoint: true, pt: [cxScene - 6, cyScene], osmId: 501, tags: { 'bridge:support': 'pier' } }],
      roads: [
        { osmId: 601, pts: [[cxScene, cyScene - 28], [cxScene, cyScene + 28]], width: 1.5, isBridge: false, layer: 0, hasExplicitLayer: false, tags: { highway: 'primary' } },
        { osmId: 602, name: 'Dry Overpass', pts: [[cxScene - 26, cyScene], [cxScene + 26, cyScene]], width: 1.4, isBridge: true, layer: 1, hasExplicitLayer: true, tags: { highway: 'primary', bridge: 'yes', layer: '1' } },
      ],
    };
    const res = buildComplete3DModel(scene, makeState({
      cropRatio: 0.5,
      cropCenterX: cxScene / 84.6,
      cropCenterY: cyScene / 84.6,
    }));
    assertCleanManifold(res.printMetrics, 'Dry-land layer=1 overpass with non-zero cropCenterX/Y');
    const ov = (res.audit.bridgeAudits || [])[0];
    const midX = ov ? (ov.bbox[0] + ov.bbox[2]) * 0.5 : 999;
    const midY = ov ? (ov.bbox[1] + ov.bbox[3]) * 0.5 : 999;
    check(
      Boolean(ov && ov.midspanClearanceU >= 0.28 && ov.explicitSupportsUsed === 1 && Math.abs(midX) < 1.5 && Math.abs(midY) < 1.5),
      'Dry-land layer=1 overpass clears layer=0 road (>=0.28u) and honors ctx.toBed cropCenterX/Y',
      `clearU=${ov?.midspanClearanceU}, supports=${ov?.explicitSupportsUsed}, bedCenter=[${midX.toFixed(2)}, ${midY.toFixed(2)}]`
    );
  }

  // [12/12] Multi-City Detail Regressions (Explicit Poly Beam vs Linked Arch, Multi-Bay Arch Piers, Approach Street Pinning & Butt-Joint Continuity, Dry Cable Approach)
  console.log('\n[12/12] Multi-City Detail Invariants (Warsaw / Tokyo / Chicago Regressions)');
  {
    const scene = {
      spanMeters: 1600,
      metersToUnits: 169.2 / 1600,
      dem: { grid: [[14, 14, 4, 10], [14, 14, 4, 10]], minElev: 4, maxElev: 14 },
      waterPolys: [{ outer: [[4, -80], [52, -80], [52, 80], [4, 80]], holes: [] }],
      waterLines: [], greenPolys: [], trees: [], buildings: [],
      bridgeSupports: [
        { kind: 'pier', isPoint: true, pt: [20, 0], osmId: 701, tags: { 'bridge:support': 'pier' } },
        { kind: 'pier', isPoint: true, pt: [36, 0], osmId: 702, tags: { 'bridge:support': 'pier' } },
      ],
      bridgePolys: [
        // Dry-land viaduct explicitly tagged bridge:structure=beam (like Wiadukt Poniatowskiego)
        {
          osmId: 801, name: 'Dry Beam Viaduct',
          outer: [[-64, -2], [-2, -2], [-2, 2], [-64, 2]], holes: [], layer: 1,
          bridgeStructure: 'beam', acrossRoadIds: [811],
          tags: { man_made: 'bridge', 'bridge:structure': 'beam', layer: '1' },
        },
        // River arch bridge continuing collinearly at layer=2 with 2 interior river piers (3 bays)
        {
          osmId: 802, name: 'Multi-Bay River Arch',
          outer: [[-2, -2], [60, -2], [60, 2], [-2, 2]], holes: [], layer: 2,
          bridgeStructure: 'arch', acrossRoadIds: [811], supportIds: [701, 702],
          tags: { man_made: 'bridge', 'bridge:structure': 'arch', layer: '2' },
        },
        // Short dry-land cable-stayed anchorage fragment with 0 pylons (like Rainbow Bridge land anchorage)
        {
          osmId: 803, name: 'Dry Cable Anchorage',
          outer: [[-70, 28], [-62, 28], [-62, 31], [-70, 31]], holes: [], layer: 1,
          bridgeStructure: 'cable-stayed', acrossRoadIds: [],
          tags: { man_made: 'bridge', 'bridge:structure': 'cable-stayed', layer: '1' },
        },
      ],
      roads: [
        // Collinear layer=0 approach streets connecting at both ends
        { osmId: 810, pts: [[-82, 0], [-64, 0]], width: 1.8, isBridge: false, layer: 0, hasExplicitLayer: false, tags: { highway: 'secondary' } },
        { osmId: 812, pts: [[60, 0], [82, 0]], width: 1.8, isBridge: false, layer: 0, hasExplicitLayer: false, tags: { highway: 'secondary' } },
        // Shared across road carrying arch tag across both polygons
        { osmId: 811, pts: [[-64, 0], [60, 0]], width: 1.8, isBridge: true, layer: 2, bridgeStructure: 'arch', tags: { highway: 'secondary', bridge: 'yes', 'bridge:structure': 'arch', layer: '2' } },
      ],
    };
    const res = buildComplete3DModel(scene, makeState());
    assertCleanManifold(res.printMetrics, 'Multi-city detail invariants scene');
    const audits = res.audit.bridgeAudits || [];
    const dryViaduct = audits.find(a => a.name === 'Dry Beam Viaduct');
    const riverArch = audits.find(a => a.name === 'Multi-Bay River Arch');
    const dryAnchorage = audits.find(a => a.name === 'Dry Cable Anchorage');
    check(
      Boolean(dryViaduct && dryViaduct.structure === 'beam' && Math.abs(dryViaduct.zPylonTop - dryViaduct.zDeckTop) < 0.05),
      'Explicit bridge:structure=beam on man_made=bridge is NOT overwritten into giant arch by linked road',
      `structure=${dryViaduct?.structure}, zTop=${dryViaduct?.zDeckTop}, pyTop=${dryViaduct?.zPylonTop}`
    );
    check(
      Boolean(dryViaduct && Math.abs(dryViaduct.zStartDeck - dryViaduct.zAbutmentA) <= 0.15),
      'Collinear layer=0 approach road at dry abutment does NOT lift bridge start into a vertical cliff',
      `zStart=${dryViaduct?.zStartDeck} vs zA=${dryViaduct?.zAbutmentA}`
    );
    check(
      Boolean(res.printMetrics.multiDeckSeparationsOk === true && dryViaduct && riverArch && Math.abs(dryViaduct.zEndDeck - riverArch.zStartDeck) <= 0.25 && riverArch.zPylonTop < riverArch.zDeckTop + 5.5),
      'Collinear layer=1 -> layer=2 butt-joint welds smoothly without step, passes multiDeckSeparationsOk, and subdivides river arch across piers',
      `multiDeckOk=${res.printMetrics.multiDeckSeparationsOk}, viaductEnd=${dryViaduct?.zEndDeck}, riverStart=${riverArch?.zStartDeck}, archPyTop=${riverArch?.zPylonTop}`
    );
    check(
      Boolean(dryAnchorage && Math.abs(dryAnchorage.zPylonTop - dryAnchorage.zDeckTop) < 0.05),
      'Short dry-land cable-stayed anchorage fragment without pylons does NOT sprout synthetic cable towers',
      `anchorageDeckTop=${dryAnchorage?.zDeckTop}, pyTop=${dryAnchorage?.zPylonTop}`
    );
  }

  // [13/13] Driveable Longitudinal Grade & Concave-Free Water Crossings (No Mid-River Sag & No Embankment Cliff Hump)
  console.log('\n[13/13] Driveable Grade & Concave-Free Water Crossings (Humpback Sag & Urban River Cliff Regressions)');
  {
    const scene = {
      spanMeters: 1200,
      metersToUnits: 169.2 / 1200,
      dem: { grid: [[9, 9, 3, 7], [9, 9, 3, 7]], minElev: 3, maxElev: 9 },
      waterPolys: [
        { outer: [[-18, -75], [22, -75], [22, -5], [-18, -5]], holes: [] },
        { outer: [[-8, 12], [8, 12], [8, 75], [-8, 75]], holes: [] },
      ],
      waterLines: [], greenPolys: [], trees: [], buildings: [], bridgeSupports: [],
      bridgePolys: [
        // A. 220m humpback footbridge crossing a layer=0 shoreline promenade before spanning a wide bay
        {
          osmId: 901, name: 'Bay Humpback Footbridge',
          outer: [[-28, -42], [28, -42], [28, -39], [-28, -39]], holes: [], layer: 1,
          bridgeStructure: 'humpback', acrossRoadIds: [],
          tags: { man_made: 'bridge', 'bridge:structure': 'humpback', layer: '1' },
        },
        // B. 45m urban street bridge over incised river channel with riverside towpath & on-deck tram/junction
        {
          osmId: 902, name: 'Urban River Humpback Bridge',
          outer: [[-11, 38], [11, 38], [11, 42], [-11, 42]], holes: [], layer: 1,
          bridgeStructure: 'humpback', acrossRoadIds: [912],
          tags: { man_made: 'bridge', 'bridge:structure': 'humpback', layer: '1' },
        },
      ],
      roads: [
        // Shoreline promenade (layer=0) running perpendicular under left end of Bay Humpback Footbridge
        { osmId: 910, pts: [[-22, -65], [-22, -15]], width: 1.2, isBridge: false, isPath: true, layer: 0, hasExplicitLayer: false, tags: { highway: 'pedestrian' } },
        // Parallel highway bridge next to Bay Humpback Footbridge crossing shoreline roads on both banks
        { osmId: 911, name: 'Bay Trunk Bridge', pts: [[-30, -32], [30, -32]], width: 2.0, isBridge: true, layer: 1, hasExplicitLayer: true, tags: { highway: 'trunk', bridge: 'yes', layer: '1' } },
        { osmId: 915, pts: [[25, -65], [25, -15]], width: 1.5, isBridge: false, isPath: false, layer: 0, hasExplicitLayer: false, tags: { highway: 'secondary' } },
        // On-deck tram/street + island T-junction + riverside park towpath on Urban River Bridge
        { osmId: 912, name: 'Urban River Street', pts: [[-25, 40], [25, 40]], width: 1.6, isBridge: false, layer: 0, hasExplicitLayer: false, tags: { highway: 'secondary' } },
        { osmId: 913, pts: [[10, 40], [10, 62]], width: 0.9, isBridge: false, layer: 0, hasExplicitLayer: false, tags: { highway: 'service' } },
        { osmId: 914, pts: [[-9.5, 20], [-9.5, 65]], width: 0.6, isBridge: false, isPath: true, layer: 0, hasExplicitLayer: false, tags: { highway: 'footway' } },
      ],
    };

    const res = buildComplete3DModel(scene, makeState());
    assertCleanManifold(res.printMetrics, 'Driveable grade & concave-free water bridges');
    const audits = res.audit.bridgeAudits || [];
    const bayHump = audits.find(a => a.name === 'Bay Humpback Footbridge');
    const bayTrunk = audits.find(a => a.name === 'Bay Trunk Bridge');
    const urbRiver = audits.find(a => a.name === 'Urban River Humpback Bridge');

    check(
      Boolean(bayHump && bayHump.isThroughArch === false && Math.abs(bayHump.zPylonTop - bayHump.zDeckTop) < 0.08),
      'bridge:structure=humpback never invents an overhead through-arch superstructure',
      `isThrough=${bayHump?.isThroughArch}, deckTop=${bayHump?.zDeckTop}, pyTop=${bayHump?.zPylonTop}`
    );

    const checkNoMidSag = (aud) => {
      if (!aud || !Array.isArray(aud.zTopArr) || aud.zTopArr.length < 5) return false;
      const z = aud.zTopArr, n = z.length, mid = z[n >> 1];
      const maxL = Math.max(...z.slice(0, Math.max(2, Math.floor(n * 0.28))));
      const maxR = Math.max(...z.slice(Math.min(n - 2, Math.ceil(n * 0.72))));
      return mid + 0.03 >= Math.min(maxL, maxR);
    };
    check(
      Boolean(bayHump && bayTrunk && checkNoMidSag(bayHump) && checkNoMidSag(bayTrunk) && bayHump.zDeckTop <= Math.max(bayHump.zStartDeck, bayHump.zEndDeck) + 0.9),
      'Water-crossing bridges maintain smooth convex/chord deck without mid-river U-sag or bank spike',
      `bayHump=[${bayHump?.zStartDeck}..${bayHump?.zDeckTop}..${bayHump?.zEndDeck}], bayTrunk=[${bayTrunk?.zStartDeck}..${bayTrunk?.zDeckTop}..${bayTrunk?.zEndDeck}]`
    );

    check(
      Boolean(urbRiver && urbRiver.zDeckTop <= Math.max(urbRiver.zStartDeck, urbRiver.zEndDeck) + 0.45),
      'Short urban river bridge stays driveable without +2mm cliff hump over bank towpath or on-deck junction',
      `start=${urbRiver?.zStartDeck}, maxTop=${urbRiver?.zDeckTop}, end=${urbRiver?.zEndDeck}`
    );
  }

  console.log(`\nETAP 4 BRIDGES GLOBAL SUMMARY: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runSuite().catch(err => {
  console.error('bridges_global_invariants.test.mjs FAILED:', err);
  process.exit(1);
});
