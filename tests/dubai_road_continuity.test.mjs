import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));

const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
const { buildLayer1TerrainAndWater } = require(path.join(ROOT, 'src/mesh/layer1_terrain_water.js'));
const {
  collectSurfacePolys,
  buildSurfaceDrapesAndFrame,
} = require(path.join(ROOT, 'src/mesh/terrain_surface_drape.js'));
const { solveBridgeGraph } = require(path.join(ROOT, 'src/mesh/bridges/bridge_multideck_solver.js'));
const { processOsmRoadOrPlazaWayJS } = require(path.join(ROOT, 'src/gis_client/osm_roads_extract.js'));
const {
  selectLodTier,
  buildAdaptiveOverpassQL,
} = require(path.join(ROOT, 'src/gis_client/overpass_chunk_grid.js'));
const {
  loadSceneAndBuildModel,
  latLonToSceneXY,
} = require(path.join(ROOT, 'tools/headless_scene_harness.js'));

const OVERPASS_CACHE_DIR = fs.existsSync(path.join(ROOT, 'cache/overpass_v2'))
  ? path.join(ROOT, 'cache/overpass_v2')
  : '/Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/cache/overpass_v2';

const DEM_TILE_CACHE_DIR =
  '/Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch/dem_tile_cache';

let passed = 0;
let failed = 0;

function check(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeState(overrides = {}) {
  return {
    targetWidthCm: 50,
    targetHeightCm: 50,
    bedSizeMm: 160,
    totalHeightMm: 500,
    bedZ: 165,
    tileCols: 4,
    tileRows: 6,
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
    layerVisible: { water: true, base: true, greenery: true, trees: false, roads: true, buildings: true, highlighted: true },
    elementVisible: { water: true, base: true, greenery: true, trees: false, roads: true, buildings: true, highlighted: true },
    colors: { water: '#1e6e8c', base: '#f1efe8', greenery: '#5a944a', trees: '#3d7033', roads: '#7c7b77', buildings: '#fafaf6', highlighted: '#e65100' },
    ...overrides,
  };
}

// ============================================================================
// 2D / 3D Spatial & Arc-Length Coverage Helpers
// ============================================================================

function pointInRing2D(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInStructuredPolys2D(px, py, polys) {
  for (const p of (polys || [])) {
    if (!p || !p.outer || p.outer.length < 3) continue;
    if (!pointInRing2D(px, py, p.outer)) continue;
    if ((p.holes || []).some(h => h && h.length >= 3 && pointInRing2D(px, py, h))) continue;
    return true;
  }
  return false;
}

function buildSpatialTriIndex2D(tris, cellSize = 2.0) {
  const buckets = new Map();
  for (let idx = 0; idx < (tris || []).length; idx++) {
    const t = tris[idx];
    const minX = Math.min(t.v0[0], t.v1[0], t.v2[0]);
    const maxX = Math.max(t.v0[0], t.v1[0], t.v2[0]);
    const minY = Math.min(t.v0[1], t.v1[1], t.v2[1]);
    const maxY = Math.max(t.v0[1], t.v1[1], t.v2[1]);
    const gx0 = Math.floor(minX / cellSize), gx1 = Math.floor(maxX / cellSize);
    const gy0 = Math.floor(minY / cellSize), gy1 = Math.floor(maxY / cellSize);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = `${gx}:${gy}`;
        let arr = buckets.get(key);
        if (!arr) { arr = []; buckets.set(key, arr); }
        arr.push(t);
      }
    }
  }
  return { buckets, cellSize };
}

function queryMaxZFromIndex(triIdx, px, py) {
  const gx = Math.floor(px / triIdx.cellSize);
  const gy = Math.floor(py / triIdx.cellSize);
  const cand = triIdx.buckets.get(`${gx}:${gy}`);
  if (!cand) return -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < cand.length; i++) {
    const t = cand[i];
    const [ax, ay, az] = t.v0;
    const [bx, by, bz] = t.v1;
    const [cx, cy, cz] = t.v2;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-10) continue;
    const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
    const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
    const w = 1.0 - u - v;
    if (u >= -1e-5 && v >= -1e-5 && w >= -1e-5) {
      const z = u * az + v * bz + w * cz;
      if (z > maxZ) maxZ = z;
    }
  }
  return maxZ;
}

function samplePolylineCoverage(bedPts, isCoveredFn, stepMeters, mToBedXY) {
  const stepU = Math.max(1e-4, stepMeters * mToBedXY);
  let totalSamples = 0;
  let coveredSamples = 0;
  let curGapM = 0;
  let maxGapM = 0;
  let totalLengthM = 0;

  for (let i = 0; i < bedPts.length - 1; i++) {
    const a = bedPts[i];
    const b = bedPts[i + 1];
    const segLenU = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLenU < 1e-6) continue;
    const segLenM = segLenU / mToBedXY;
    totalLengthM += segLenM;
    const steps = Math.max(1, Math.round(segLenM / stepMeters));
    const subStepM = segLenM / steps;
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const px = a[0] + (b[0] - a[0]) * t;
      const py = a[1] + (b[1] - a[1]) * t;
      totalSamples++;
      if (isCoveredFn(px, py)) {
        coveredSamples++;
        curGapM = 0;
      } else {
        curGapM += subStepM;
        if (curGapM > maxGapM) maxGapM = curGapM;
      }
    }
  }

  return {
    totalSamples,
    coveredSamples,
    coveragePct: totalSamples > 0 ? (100 * coveredSamples) / totalSamples : 0,
    maxGapM,
    totalLengthM,
  };
}

function waysToOsmElements(wayDefs) {
  const nodeMap = new Map();
  const ways = [];
  for (const wd of wayDefs) {
    const nids = [];
    for (const [id, lat, lon] of wd.pts) {
      if (!nodeMap.has(id)) nodeMap.set(id, { type: 'node', id, lat, lon });
      nids.push(id);
    }
    ways.push({ type: 'way', id: wd.id, nodes: nids, tags: { ...wd.tags } });
  }
  return [...nodeMap.values(), ...ways];
}

// ============================================================================
// Self-Contained Real-Coordinate Dubai OSM Fixtures (Deterministic in CI)
// ============================================================================

// 1) Bluewaters Wharf Link (Screenshots 7 & 8):
//    - way/655705704: JBR Walk approach along beach ending at peninsula base [25.0738872, 55.1255603]
//    - way/655705707: Bluewaters Wharf Link (highway=pedestrian, bridge=boardwalk, layer=1)
//      running 165 m on dry-land JBR peninsula [25.0739086,55.1254759 -> 25.0753428,55.1257783]
//      then crossing water to Bluewaters Island [-> 25.076226,55.1244475]
//    - way/1128103200: Bluewaters Bridge (man_made=bridge) water-span deck [25.0752741,55.1258527 -> 25.0762293,55.1244899]
//    - Persian Gulf channel water polygon separating JBR peninsula tip (~25.07535) from Bluewaters Island (~25.07616)
const BLUEWATERS_FIXTURE_WAYS = [
  {
    id: 655705704,
    tags: { highway: 'pedestrian', lit: 'yes', surface: 'wood' },
    pts: [
      [9969487853, 25.073924, 55.1268346],
      [11917669962, 25.0738975, 55.1266815],
      [11917669963, 25.0738306, 55.1264508],
      [9969487863, 25.0737863, 55.1262506],
      [9969487861, 25.0737785, 55.1260903],
      [6445759908, 25.0737882, 55.1259829],
      [11917680919, 25.0738289, 55.1258066],
      [6143214625, 25.0738835, 55.1255759],
      [11917680493, 25.0738872, 55.1255603],
      [6143214626, 25.0739086, 55.1254759],
    ],
  },
  {
    id: 655705707,
    tags: { bridge: 'boardwalk', highway: 'pedestrian', layer: '1', lit: 'yes', name: 'Bluewaters Wharf Link', surface: 'wood' },
    pts: [
      [6143214626, 25.0739086, 55.1254759],
      [10313883359, 25.0744095, 55.1256115],
      [10313883360, 25.0748449, 55.1257177],
      [10313883362, 25.0752007, 55.1258002],
      [11904083092, 25.075237, 55.1258045],
      [6143214628, 25.0752734, 55.1258021],
      [6567959608, 25.075309, 55.1257933],
      [9970175159, 25.0753428, 55.1257783],
      [6567959609, 25.0753739, 55.1257573],
      [9970175158, 25.0754015, 55.1257311],
      [6143214629, 25.075425, 55.1257002],
      [7593172511, 25.0759922, 55.1248151],
      [10313883392, 25.0761999, 55.124486],
      [6143214633, 25.076226, 55.1244475],
    ],
  },
  {
    id: 1128103200,
    tags: { layer: '1', man_made: 'bridge', name: 'Bluewaters Bridge', 'name:en': 'Bluewaters Bridge' },
    pts: [
      [10313883387, 25.0753803, 55.1258163],
      [10313883371, 25.075375, 55.1257171],
      [10313883372, 25.0754188, 55.1256608],
      [10313883373, 25.0754838, 55.1255582],
      [7593172485, 25.0754686, 55.1255191],
      [7593148678, 25.0754802, 55.1254655],
      [7593172488, 25.0755386, 55.1254291],
      [10313883374, 25.0755663, 55.1254345],
      [10313883375, 25.075887, 55.1249355],
      [7593172498, 25.0758735, 55.1248661],
      [7593172495, 25.0759218, 55.1248058],
      [7593172512, 25.07597, 55.1248037],
      [10313883376, 25.076168, 55.1244913],
      [10313883377, 25.0761707, 55.1243901],
      [10313883378, 25.0762208, 55.1243813],
      [6143214633, 25.076226, 55.1244475],
      [10313883379, 25.0762293, 55.1244899],
      [10313883380, 25.0760138, 55.1248409],
      [7593172507, 25.0760233, 55.1249103],
      [7593172503, 25.0759433, 55.1249715],
      [10313883383, 25.0756052, 55.1254717],
      [7593172494, 25.075612, 55.1255331],
      [7593148681, 25.0755362, 55.125591],
      [10313883387, 25.0753803, 55.1258163],
    ],
  },
  // Bluewaters Island promenade continuation
  {
    id: 1128103198,
    tags: { highway: 'footway' },
    pts: [
      [6143214633, 25.076226, 55.1244475],
      [7700001001, 25.07645, 55.12420],
    ],
  },
  // Sea channel between JBR peninsula tip (25.07536, 55.12576) and Bluewaters Island (25.07615, 55.12452)
  {
    id: 812925343,
    tags: { natural: 'water', water: 'sea' },
    pts: [
      [7700002001, 25.075385, 55.12680],
      [7700002002, 25.07680, 55.12680],
      [7700002003, 25.07680, 55.12495],
      [7700002004, 25.07612, 55.12456],
      [7700002005, 25.07565, 55.12410],
      [7700002006, 25.07440, 55.12410],
      [7700002007, 25.07440, 55.12536],
      [7700002008, 25.07536, 55.12562],
      [7700002009, 25.075385, 55.12588],
      [7700002001, 25.075385, 55.12680],
    ],
  },
];

// 2) Porte-Cochère Loop (way/199488448 -> way/1090745323 covered=yes -> way/1090745322)
//    + Shaded Promenade Wallach Walk (way/1315426780 -> way/1315426779 covered=yes -> way/857974348)
//    + Genuine underground controls (way/607818565 tunnel=yes, layer=-1 & location=underground)
const PORTE_COCHERE_FIXTURE_WAYS = [
  {
    id: 199488448,
    tags: { highway: 'service', oneway: 'yes', service: 'driveway' },
    pts: [
      [2094766403, 25.1078085, 55.1492988],
      [2094766417, 25.107947, 55.1493164],
      [2094766426, 25.1079995, 55.1493144],
      [2094766430, 25.1080496, 55.1492969],
      [2094766434, 25.108098, 55.1492591],
    ],
  },
  {
    id: 1090745323,
    tags: { covered: 'yes', highway: 'service', oneway: 'yes', service: 'driveway' },
    pts: [
      [2094766434, 25.108098, 55.1492591],
      [9990539498, 25.1081162, 55.1492382],
      [9849534597, 25.1081319, 55.1492149],
      [9990539497, 25.1081449, 55.1491898],
      [2094766438, 25.1081551, 55.149163],
    ],
  },
  {
    id: 1090745322,
    tags: { highway: 'service', oneway: 'yes', service: 'driveway' },
    pts: [
      [2094766438, 25.1081551, 55.149163],
      [9849534596, 25.1081595, 55.1491117],
      [2094766437, 25.108154, 55.149054],
      [2094766432, 25.1081406, 55.1488563],
    ],
  },
  // Elevated hotel porte-cochère canopy (min_height=4.5 m -> road must run cleanly underneath)
  {
    id: 656933947,
    tags: { building: 'roof', height: '7.5', min_height: '4.5' },
    pts: [
      [6153253681, 25.1081189, 55.1491294],
      [6153253682, 25.1080524, 55.1492167],
      [6153253683, 25.1081299, 55.1492889],
      [6153253688, 25.1082017, 55.1492063],
      [6153253681, 25.1081189, 55.1491294],
    ],
  },
  // Genuine underground tunnel control (real Dubai Bluewaters tunnel way/607818565, layer=-1, tunnel=yes)
  {
    id: 607818565,
    tags: { highway: 'service', lanes: '2', layer: '-1', oneway: 'yes', tunnel: 'yes' },
    pts: [
      [7700003001, 25.10770, 55.14890],
      [7700003002, 25.10790, 55.14890],
    ],
  },
  // Genuine location=underground control
  {
    id: 607818566,
    tags: { highway: 'footway', covered: 'yes', location: 'underground' },
    pts: [
      [7700003003, 25.10770, 55.14900],
      [7700003004, 25.10790, 55.14900],
    ],
  },
];

const WALLACH_WALK_FIXTURE_WAYS = [
  {
    id: 1315426780,
    tags: { highway: 'footway', lit: 'yes', name: 'Wallach Walk', surface: 'asphalt' },
    pts: [
      [422438909, 40.7699713, -73.9709387],
      [7998661206, 40.7700195, -73.9710308],
      [422438910, 40.7700451, -73.9710833],
      [12175730073, 40.770107, -73.9712184],
    ],
  },
  {
    id: 1315426779,
    tags: { covered: 'yes', highway: 'footway', lit: 'yes', name: 'Wallach Walk', surface: 'asphalt' },
    pts: [
      [12175730073, 40.770107, -73.9712184],
      [12175730072, 40.7701709, -73.9713578],
    ],
  },
  {
    id: 857974348,
    tags: { highway: 'footway', lit: 'yes', name: 'Wallach Walk', surface: 'asphalt' },
    pts: [
      [12175730072, 40.7701709, -73.9713578],
      [7998654884, 40.7702276, -73.9714816],
      [422438911, 40.7702487, -73.9715224],
    ],
  },
];

// 3) JBR Walk tunnel=building_passage (way/698938758 -> way/1238963528 -> way/1238963527)
function makeBuildingPassageFixture(buildingTags) {
  return [
    {
      id: 698938758,
      tags: { alt_name: 'JBR Walk', highway: 'residential', name: 'Al Mamsha Street', surface: 'cobblestone' },
      pts: [
        [605034670, 25.0753643, 55.131619],
        [6418373109, 25.0749166, 55.1311825],
        [6443847701, 25.0745185, 55.1308078],
        [11509643284, 25.0742188, 55.1305084],
      ],
    },
    {
      id: 1238963528,
      tags: { alt_name: 'JBR Walk', highway: 'residential', name: 'Al Mamsha Street', surface: 'cobblestone', tunnel: 'building_passage' },
      pts: [
        [11509643284, 25.0742188, 55.1305084],
        [11509643283, 25.0740313, 55.1303205],
      ],
    },
    {
      id: 1238963527,
      tags: { alt_name: 'JBR Walk', highway: 'residential', name: 'Al Mamsha Street', surface: 'cobblestone' },
      pts: [
        [11509643283, 25.0740313, 55.1303205],
        [4911467999, 25.0738488, 55.1301384],
      ],
    },
    // Building / arch straddling the middle 60% of way/1238963528 ([25.07407..25.07418, 55.13036..55.13047])
    // so ~5 m of way/1238963528 sits OUTSIDE the building wall on each side!
    {
      id: 1238963526,
      tags: buildingTags,
      pts: [
        [7700004001, 25.074195, 55.130395],
        [7700004002, 25.074115, 55.130495],
        [7700004003, 25.074045, 55.130425],
        [7700004004, 25.074125, 55.130325],
        [7700004001, 25.074195, 55.130395],
      ],
    },
  ];
}

// 4c) Cayan Tower Bridge (way/1052951457, 35 m wide man_made=bridge) + King Salman St carriageways
//     (way/10376665, way/26633195) + Dubai Tram (way/548105707, way/548105708 without bridge=yes)
const CAYAN_TRAM_FIXTURE_WAYS = [
  {
    id: 1052951457,
    tags: { 'bridge:structure': 'beam', layer: '1', man_made: 'bridge' },
    pts: [
      [2268129768, 25.0880494, 55.1447941],
      [9676543757, 25.0876985, 55.1449396],
      [9676543758, 25.0875678, 55.1443352],
      [9676543759, 25.0873815, 55.1439057],
      [9676543760, 25.087107, 55.143534],
      [9676543761, 25.0867998, 55.1432471],
      [9676543762, 25.0864174, 55.143036],
      [9676543763, 25.0862948, 55.1430035],
      [9676543764, 25.0863814, 55.1426679],
      [9676543765, 25.0866118, 55.1427581],
      [9676543766, 25.0868317, 55.1428842],
      [9676543767, 25.0870216, 55.1426827],
      [9676543768, 25.0874106, 55.1431645],
      [9676543769, 25.0877227, 55.1435975],
      [9340628009, 25.0878861, 55.1439205],
      [9676543771, 25.0880014, 55.1442807],
      [9676543772, 25.0880397, 55.144552],
      [2268129768, 25.0880494, 55.1447941],
    ],
  },
  {
    id: 10376665,
    tags: { bridge: 'yes', highway: 'primary', lanes: '3', layer: '1', name: 'King Salman bin Abdulaziz Al Saud Street', oneway: 'yes', ref: 'D94' },
    pts: [
      [13039198824, 25.087937, 55.1448757],
      [2268129848, 25.0877996, 55.144398],
      [2268129749, 25.0875987, 55.1438779],
      [631520254, 25.0873088, 55.1434286],
      [9961066783, 25.0869309, 55.1430678],
      [3039737528, 25.0863679, 55.1427716],
    ],
  },
  {
    id: 26633195,
    tags: { bridge: 'yes', highway: 'primary', lanes: '3', layer: '1', name: 'King Salman bin Abdulaziz Al Saud Street', oneway: 'yes', ref: 'D94' },
    pts: [
      [2268129653, 25.0863315, 55.1429039],
      [2268129869, 25.0868333, 55.1431733],
      [2268129679, 25.0872522, 55.1435801],
      [9961066786, 25.0875871, 55.1441502],
      [13039198856, 25.0878277, 55.1449681],
    ],
  },
  // Dubai Tram tracks (exact OSM tags: railway=tram, level=0, WITHOUT bridge=yes) crossing Cayan bridge over canal
  {
    id: 548105707,
    tags: { electrified: 'ground-level_power_supply', gauge: '1435', level: '0', name: 'Dubai Tram', oneway: 'yes', railway: 'tram', tracks: '1' },
    pts: [
      [7700005001, 25.08595, 55.14262],
      [7700005002, 25.08635, 55.14284],
      [7700005003, 25.08688, 55.14312],
      [7700005004, 25.08735, 55.14355],
      [7700005005, 25.08772, 55.14422],
      [7700005006, 25.08788, 55.14485],
      [7700005007, 25.08825, 55.14535],
    ],
  },
  {
    id: 548105708,
    tags: { electrified: 'ground-level_power_supply', gauge: '1435', level: '0', name: 'Dubai Tram', oneway: 'yes', railway: 'tram', tracks: '1' },
    pts: [
      [7700005011, 25.08822, 55.14540],
      [7700005012, 25.08784, 55.14489],
      [7700005013, 25.08768, 55.14426],
      [7700005014, 25.08731, 55.14360],
      [7700005015, 25.08684, 55.14317],
      [7700005016, 25.08632, 55.14289],
      [7700005017, 25.08592, 55.14267],
    ],
  },
  // Dubai Marina canal passing underneath way/1052951457
  {
    id: 415396753,
    tags: { natural: 'water', water: 'canal', name: 'Dubai Marina' },
    pts: [
      [7700005021, 25.08775, 55.14220],
      [7700005022, 25.08648, 55.14460],
      [7700005023, 25.08705, 55.14505],
      [7700005024, 25.08830, 55.14265],
      [7700005021, 25.08775, 55.14220],
    ],
  },
];

// ============================================================================
// Main Hard Continuity Test Runner
// ============================================================================

async function runTests() {
  await core.ensureManifoldLibAsync();
  console.log('\n=== Dubai Real-World Road & Bridge Continuity Suite ===\n');

  // ---------------------------------------------------------------------------
  // 1. Bluewaters Wharf Link Peninsula-to-Bridge 100% Arc-Length Continuity
  // ---------------------------------------------------------------------------
  console.log('1) Bluewaters Wharf Link (way/655705704 -> way/655705707 -> way/1128103200) 100% Arc-Length Continuity:');
  try {
    const res = await loadSceneAndBuildModel({
      title: 'BLUEWATERS_WHARF_LINK',
      osmElements: waysToOsmElements(BLUEWATERS_FIXTURE_WAYS),
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: 25.0751,
      lon: 55.1253,
      spanMeters: 520,
      targetWidthCm: 16,
      targetHeightCm: 16,
      showFrame: false,
      cropRatio: 1.0,
      wantTrees: false,
      silent: true,
    });

    const ctx = core.createBuildContext(res.scene, res.state);
    const mToBedXY = res.scene.metersToUnits * (ctx.scaleToBed || 1.0);
    const plateClipPoly = [[[-ctx.halfW, -ctx.halfH], [ctx.halfW, -ctx.halfH], [ctx.halfW, ctx.halfH], [-ctx.halfW, ctx.halfH]]];
    const mf = core.getManifoldLib();
    const slab = core.extrudeRingSolid(mf, plateClipPoly[0], [], 0, 2.0);
    const surfaceData = collectSurfacePolys(core, ctx, res.scene, plateClipPoly);
    const drapeRes = buildSurfaceDrapesAndFrame(core, mf, ctx, slab, plateClipPoly, [], surfaceData);
    slab.delete();
    if (drapeRes.roadManifold) drapeRes.roadManifold.delete();
    if (drapeRes.greeneryManifold) drapeRes.greeneryManifold.delete();

    const roadTriIdx = buildSpatialTriIndex2D(res.meshes.roads, 2.0);
    const isCovered2D = (px, py) =>
      pointInStructuredPolys2D(px, py, drapeRes.streetPolys2D) ||
      pointInStructuredPolys2D(px, py, drapeRes.footpathPolys2D) ||
      queryMaxZFromIndex(roadTriIdx, px, py) > -Infinity;

    const jbrBedPts = BLUEWATERS_FIXTURE_WAYS[0].pts.map(([, lat, lon]) => ctx.toBed(latLonToSceneXY(lat, lon, res.scene)));
    const wharfBedPts = BLUEWATERS_FIXTURE_WAYS[1].pts.map(([, lat, lon]) => ctx.toBed(latLonToSceneXY(lat, lon, res.scene)));
    const fullChainPts = jbrBedPts.concat(wharfBedPts.slice(1));

    const wharfCov = samplePolylineCoverage(wharfBedPts, isCovered2D, 2.0, mToBedXY);
    const fullCov = samplePolylineCoverage(fullChainPts, isCovered2D, 2.0, mToBedXY);

    check(
      wharfCov.coveragePct >= 98.0,
      'way/655705707 (Bluewaters Wharf Link) >= 98% 2D coverage across 165m peninsula + bridge span',
      `coverage=${wharfCov.coveragePct.toFixed(1)}% (${wharfCov.coveredSamples}/${wharfCov.totalSamples}), len=${wharfCov.totalLengthM.toFixed(1)}m`
    );
    check(
      wharfCov.maxGapM <= 3.0 && fullCov.maxGapM <= 3.0,
      'Zero contiguous uncovered gap > 3.0 m from JBR Walk (way/655705704) onto Bluewaters Wharf Link (way/655705707)',
      `wharfMaxGap=${wharfCov.maxGapM.toFixed(1)} m, fullChainMaxGap=${fullCov.maxGapM.toFixed(1)} m`
    );
    check(
      res.printMetrics.openEdgesCount === 0 && res.printMetrics.nonManifoldEdgesCount === 0,
      'Bluewaters 3D mesh is a watertight 2-manifold',
      `openEdges=${res.printMetrics.openEdgesCount}, nonManifoldEdges=${res.printMetrics.nonManifoldEdgesCount}`
    );
  } catch (err) {
    check(false, 'Bluewaters Wharf Link test executed without throwing', err.stack || String(err));
  }

  // ---------------------------------------------------------------------------
  // 2. Surface covered=yes Porte-Cochère Loops & Shaded Promenades Continuity
  // ---------------------------------------------------------------------------
  console.log('\n2) Surface covered=yes Porte-Cochère Loops (way/1090745323) & Shaded Promenades (way/1315426779):');
  try {
    // Direct unit check on processOsmRoadOrPlazaWayJS
    const mockNodes = new Map([[1, [-10, 0]], [2, [10, 0]]]);
    const mkExtractorCtx = () => ({
      usedWays: new Set(),
      roads: [],
      roadPolys: [],
      metersToUnits: 0.2,
      effectiveSpanM: 600,
      minBldFootprintM: 0,
      nodesToPts: (nids) => nids.map(id => mockNodes.get(id)).filter(Boolean),
    });

    const ctxSurfCov = mkExtractorCtx();
    processOsmRoadOrPlazaWayJS(1090745323, { id: 1090745323 }, { highway: 'service', service: 'driveway', covered: 'yes' }, [1, 2], false, ctxSurfCov);
    processOsmRoadOrPlazaWayJS(1315426779, { id: 1315426779 }, { highway: 'footway', name: 'Wallach Walk', covered: 'yes' }, [1, 2], false, ctxSurfCov);
    processOsmRoadOrPlazaWayJS(607818565, { id: 607818565 }, { highway: 'service', tunnel: 'yes', layer: '-1' }, [1, 2], false, ctxSurfCov);
    processOsmRoadOrPlazaWayJS(607818566, { id: 607818566 }, { highway: 'footway', covered: 'yes', location: 'underground' }, [1, 2], false, ctxSurfCov);

    const extractedIds = new Set(ctxSurfCov.roads.map(r => r.osmId));
    check(
      extractedIds.has(1090745323) && extractedIds.has(1315426779),
      'processOsmRoadOrPlazaWayJS retains surface covered=yes ways (way/1090745323 & way/1315426779)',
      `retained=[${[...extractedIds].join(', ')}]`
    );
    check(
      !extractedIds.has(607818565) && !extractedIds.has(607818566),
      'processOsmRoadOrPlazaWayJS still rejects genuine underground ways (layer=-1, tunnel=yes & location=underground)',
      `retained=[${[...extractedIds].join(', ')}]`
    );

    // Full end-to-end 3D build of U-shaped hotel porte-cochère driveway loop
    const loopRes = await loadSceneAndBuildModel({
      title: 'DUBAI_PORTE_COCHERE_LOOP',
      osmElements: waysToOsmElements(PORTE_COCHERE_FIXTURE_WAYS),
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: 25.1080,
      lon: 55.1491,
      spanMeters: 220,
      targetWidthCm: 16,
      targetHeightCm: 16,
      showFrame: false,
      cropRatio: 1.0,
      wantTrees: false,
      silent: true,
    });

    const loopCtx = core.createBuildContext(loopRes.scene, loopRes.state);
    const loopMToBed = loopRes.scene.metersToUnits * (loopCtx.scaleToBed || 1.0);
    const loopTriIdx = buildSpatialTriIndex2D(loopRes.meshes.roads, 2.0);
    const loopRawLatLon = [
      ...PORTE_COCHERE_FIXTURE_WAYS[0].pts,
      ...PORTE_COCHERE_FIXTURE_WAYS[1].pts.slice(1),
      ...PORTE_COCHERE_FIXTURE_WAYS[2].pts.slice(1),
    ];
    const loopBedPts = loopRawLatLon.map(([, lat, lon]) => loopCtx.toBed(latLonToSceneXY(lat, lon, loopRes.scene)));
    const loopCov = samplePolylineCoverage(loopBedPts, (px, py) => queryMaxZFromIndex(loopTriIdx, px, py) > -Infinity, 1.0, loopMToBed);

    const sceneRoadIds = new Set((loopRes.scene.roads || []).map(r => r.osmId));
    check(
      !sceneRoadIds.has(607818565) && !sceneRoadIds.has(607818566),
      'parseRealGISScene rejects underground control ways in full scene pipeline'
    );
    check(
      sceneRoadIds.has(1090745323) && loopCov.coveragePct >= 99.5 && loopCov.maxGapM === 0,
      '100% end-to-end polyline coverage around U-shaped hotel driveway loop (zero round-capped gap under porte-cochère)',
      `hasWay1090745323=${sceneRoadIds.has(1090745323)}, coverage=${loopCov.coveragePct.toFixed(1)}%, maxGap=${loopCov.maxGapM.toFixed(2)}m`
    );

    // Shaded promenade Wallach Walk (way/1315426779) end-to-end check
    const promRes = await loadSceneAndBuildModel({
      title: 'WALLACH_WALK_COVERED_PROMENADE',
      osmElements: waysToOsmElements(WALLACH_WALK_FIXTURE_WAYS),
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: 40.77012,
      lon: -73.97125,
      spanMeters: 220,
      targetWidthCm: 16,
      targetHeightCm: 16,
      showFrame: false,
      cropRatio: 1.0,
      wantTrees: false,
      silent: true,
    });
    const promCtx = core.createBuildContext(promRes.scene, promRes.state);
    const promMToBed = promRes.scene.metersToUnits * (promCtx.scaleToBed || 1.0);
    const promTriIdx = buildSpatialTriIndex2D(promRes.meshes.roads, 2.0);
    const promBedPts = [
      ...WALLACH_WALK_FIXTURE_WAYS[0].pts,
      ...WALLACH_WALK_FIXTURE_WAYS[1].pts.slice(1),
      ...WALLACH_WALK_FIXTURE_WAYS[2].pts.slice(1),
    ].map(([, lat, lon]) => promCtx.toBed(latLonToSceneXY(lat, lon, promRes.scene)));
    const promCov = samplePolylineCoverage(promBedPts, (px, py) => queryMaxZFromIndex(promTriIdx, px, py) > -Infinity, 1.0, promMToBed);

    check(
      promCov.coveragePct >= 99.5 && promCov.maxGapM === 0,
      '100% continuous promenade coverage across shaded Wallach Walk (way/1315426779, covered=yes)',
      `coverage=${promCov.coveragePct.toFixed(1)}%, maxGap=${promCov.maxGapM.toFixed(2)}m`
    );
  } catch (err) {
    check(false, 'Porte-cochère & covered promenade tests executed without throwing', err.stack || String(err));
  }

  // ---------------------------------------------------------------------------
  // 3. tunnel=building_passage Continuity Under Elevated Arches vs Grounded Buildings
  // ---------------------------------------------------------------------------
  console.log('\n3) tunnel=building_passage (JBR Walk way/1238963528) Under Elevated Arches vs Solid Grounded Buildings:');
  try {
    // 3a) Elevated arch / bridge-tower (min_height=4.5, height=18) -> 100% continuous road right underneath
    const archWays = makeBuildingPassageFixture({ building: 'hotel', height: '18', min_height: '4.5' });
    const archRes = await loadSceneAndBuildModel({
      title: 'JBR_WALK_ELEVATED_ARCH',
      osmElements: waysToOsmElements(archWays),
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: 25.07413,
      lon: 55.13041,
      spanMeters: 260,
      targetWidthCm: 16,
      targetHeightCm: 16,
      showFrame: false,
      cropRatio: 1.0,
      wantTrees: false,
      silent: true,
    });
    const archCtx = core.createBuildContext(archRes.scene, archRes.state);
    const archMToBed = archRes.scene.metersToUnits * (archCtx.scaleToBed || 1.0);
    const archTriIdx = buildSpatialTriIndex2D(archRes.meshes.roads, 2.0);
    const passageOnlyArchPts = archWays[1].pts.map(([, lat, lon]) => archCtx.toBed(latLonToSceneXY(lat, lon, archRes.scene)));
    const archCov = samplePolylineCoverage(passageOnlyArchPts, (px, py) => queryMaxZFromIndex(archTriIdx, px, py) > -Infinity, 1.0, archMToBed);

    check(
      archCov.coveragePct >= 99.5 && archCov.maxGapM === 0,
      'JBR Walk (way/1238963528, tunnel=building_passage) is 100% continuous underneath elevated arch (min_height=4.5m)',
      `coverage=${archCov.coveragePct.toFixed(1)}%, maxGap=${archCov.maxGapM.toFixed(2)}m`
    );

    // 3b) Grounded solid building (min_height=0, height=18) -> reaches right up to building wall on both sides & subtracted inside
    const solidWays = makeBuildingPassageFixture({ building: 'hotel', height: '18', min_height: '0' });
    const solidRes = await loadSceneAndBuildModel({
      title: 'JBR_WALK_GROUNDED_SOLID_BLD',
      osmElements: waysToOsmElements(solidWays),
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: 25.07413,
      lon: 55.13041,
      spanMeters: 260,
      targetWidthCm: 16,
      targetHeightCm: 16,
      showFrame: false,
      cropRatio: 1.0,
      wantTrees: false,
      silent: true,
    });
    const solidCtx = core.createBuildContext(solidRes.scene, solidRes.state);
    const solidMToBed = solidRes.scene.metersToUnits * (solidCtx.scaleToBed || 1.0);
    const solidTriIdx = buildSpatialTriIndex2D(solidRes.meshes.roads, 2.0);
    const bldBedRing = solidWays[3].pts.slice(0, -1).map(([, lat, lon]) => solidCtx.toBed(latLonToSceneXY(lat, lon, solidRes.scene)));
    const passageChainSolidPts = [
      ...solidWays[0].pts.slice(-2),
      ...solidWays[1].pts.slice(1),
      ...solidWays[2].pts.slice(1),
    ].map(([, lat, lon]) => solidCtx.toBed(latLonToSceneXY(lat, lon, solidRes.scene)));

    let outsideTotal = 0, outsideCovered = 0;
    let deepInsideTotal = 0, deepInsideCovered = 0;
    for (let i = 0; i < passageChainSolidPts.length - 1; i++) {
      const a = passageChainSolidPts[i], b = passageChainSolidPts[i + 1];
      const segM = Math.hypot(b[0] - a[0], b[1] - a[1]) / solidMToBed;
      const steps = Math.max(1, Math.ceil(segM / 0.5));
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
        const inBld = pointInRing2D(px, py, bldBedRing);
        // Ignore a 0.35 m regularization margin right on the wall boundary itself
        let minWallDistM = Infinity;
        for (let e = 0; e < bldBedRing.length; e++) {
          const p0 = bldBedRing[e], p1 = bldBedRing[(e + 1) % bldBedRing.length];
          const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l2 = dx * dx + dy * dy || 1e-9;
          const u = Math.max(0, Math.min(1, ((px - p0[0]) * dx + (py - p0[1]) * dy) / l2));
          minWallDistM = Math.min(minWallDistM, Math.hypot(px - (p0[0] + dx * u), py - (p0[1] + dy * u)) / solidMToBed);
        }
        if (minWallDistM < 0.35) continue;
        const cov = queryMaxZFromIndex(solidTriIdx, px, py) > -Infinity;
        if (!inBld) {
          outsideTotal++;
          if (cov) outsideCovered++;
        } else {
          deepInsideTotal++;
          if (cov) deepInsideCovered++;
        }
      }
    }

    check(
      outsideTotal >= 6 && outsideCovered === outsideTotal,
      'JBR Walk reaches right up to grounded solid building wall on both sides (zero gap outside building footprint)',
      `outsideCovered=${outsideCovered}/${outsideTotal}`
    );
    check(
      deepInsideTotal >= 4 && deepInsideCovered === 0,
      'JBR Walk is cleanly subtracted inside grounded solid building footprint (min_height=0)',
      `insideCovered=${deepInsideCovered}/${deepInsideTotal}`
    );
  } catch (err) {
    check(false, 'tunnel=building_passage tests executed without throwing', err.stack || String(err));
  }

  // ---------------------------------------------------------------------------
  // 4. Delatin TIN Clearance (frame=50x50) + SZR Skybridge Smoothness + Tram over man_made=bridge
  // ---------------------------------------------------------------------------
  console.log('\n4) Delatin TIN Clearance (frame=50x50, scaleMm≈2.955) + SZR Skybridge Plateau + Cayan Tram Bridge:');
  try {
    // 4a) frame=50x50 (4x6 tiles, span=6600m) bridge ramp crossing a dry-land ridge whose Delatin TIN sits +0.30u above linear chord
    const N = 65;
    const demGrid = Array.from({ length: N }, () =>
      Array.from({ length: N }, (_, c) => {
        const ux = -85.0 + (c / (N - 1)) * 170.0;
        const d = (ux - (-2.0)) / 1.6;
        return d * d < 4.5 ? 14.5 * Math.exp(-d * d) : 0.0;
      })
    );
    const m2u6600 = 169.2 / 6600;
    const scene4a = {
      spanMeters: 6600,
      metersToUnits: m2u6600,
      halfW: 84.6,
      halfH: 84.6,
      _fetchedCropRatio: 1.0,
      dem: { gridSize: N, minElev: 0, maxElev: 14.5, grid: demGrid },
      waterPolys: [{ outer: [[2.5, -15], [5.5, -15], [5.5, 15], [2.5, 15]], holes: [] }],
      roads: [{
        osmId: 9001,
        hwy: 'secondary',
        width: 10.0 * m2u6600,
        bridge: true,
        isBridge: true,
        layer: 1,
        hasExplicitLayer: true,
        pts: [[-6.5, 0], [7.0, 0]],
      }],
      bridgePolys: [],
      greenPolys: [],
      roadPolys: [],
      buildings: [],
    };
    const state50 = makeState({ targetWidthCm: 50, targetHeightCm: 50, tileCols: 4, tileRows: 6 });
    const ctx4a = core.createBuildContext(scene4a, state50);
    const tw4a = buildLayer1TerrainAndWater(ctx4a, scene4a);
    const sp4a = solveBridgeGraph(scene4a, tw4a, ctx4a)[0];

    check(
      Math.abs(ctx4a.scaleMm - 2.955) < 0.05,
      'frame=50x50 (4x6 grid, span=6600m) operates at scaleMm ≈ 2.955 mm/unit',
      `scaleMm=${ctx4a.scaleMm.toFixed(4)}`
    );

    const endGroundZA = tw4a.getSurfaceZ(sp4a.pts[0][0], sp4a.pts[0][1]);
    const endGroundZB = tw4a.getSurfaceZ(sp4a.pts[sp4a.pts.length - 1][0], sp4a.pts[sp4a.pts.length - 1][1]);
    let maxBulgeAboveChord = -Infinity;
    let minClearAboveSurface = Infinity;
    let violatingStations = 0;
    for (let k = 0; k < sp4a.pts.length; k++) {
      if (sp4a.inWater[k]) continue;
      const p = sp4a.pts[k];
      const pPrev = sp4a.pts[Math.max(0, k - 1)];
      const pNext = sp4a.pts[Math.min(sp4a.pts.length - 1, k + 1)];
      const dx = pNext[0] - pPrev[0], dy = pNext[1] - pPrev[1], dl = Math.hypot(dx, dy) || 1;
      const nx = -dy / dl, ny = dx / dl;
      const hw = sp4a.width * 0.48;
      const chordZ = endGroundZA + (endGroundZB - endGroundZA) * (sp4a.sArr[k] / sp4a.spanU);
      for (const latOff of [-hw, 0, hw]) {
        const sx = p[0] + nx * latOff, sy = p[1] + ny * latOff;
        if (tw4a.isPointInWater(sx, sy)) continue;
        const surfZ = tw4a.getSurfaceZ(sx, sy);
        maxBulgeAboveChord = Math.max(maxBulgeAboveChord, surfZ - chordZ);
        const clearU = sp4a.zTopArr[k] - surfZ;
        if (clearU < minClearAboveSurface) minClearAboveSurface = clearU;
        if (clearU < 0.15 - 1e-4) violatingStations++;
      }
    }
    check(
      maxBulgeAboveChord >= 0.28,
      'Test fixture ridge bulges >= +0.28..0.30 scene units above linear abutment chord',
      `maxBulgeAboveChord=+${maxBulgeAboveChord.toFixed(3)}u`
    );
    check(
      violatingStations === 0 && minClearAboveSurface >= 0.15 - 1e-4,
      'Every dry-land bridge station & half-width cross-section clears terrainWater.getSurfaceZ(x,y) + 0.15u (zero TIN bleed-through)',
      `minClearance=${minClearAboveSurface.toFixed(3)}u, violatingSamples=${violatingStations}`
    );

    // 4b) Pedestrian skybridge (highway=footway, bridge=yes, layer=1) crossing 8 parallel SZR carriageways (~16m spacing)
    const m2uSzr = 169.2 / 600;
    const szrCarriageways = [];
    for (let i = 0; i < 8; i++) {
      const x = (-3.5 + i) * 16.0 * m2uSzr;
      szrCarriageways.push({
        osmId: 8100 + i,
        hwy: 'motorway',
        width: 8.5 * m2uSzr,
        bridge: false,
        isBridge: false,
        layer: 0,
        hasExplicitLayer: true,
        pts: [[x, -35], [x, 35]],
      });
    }
    const szrSkybridge = {
      osmId: 8199,
      hwy: 'footway',
      isPath: true,
      width: 3.0 * m2uSzr,
      bridge: true,
      isBridge: true,
      layer: 1,
      hasExplicitLayer: true,
      pts: [[-75 * m2uSzr, 0], [75 * m2uSzr, 0]],
    };
    const scene4b = {
      spanMeters: 600,
      metersToUnits: m2uSzr,
      halfW: 84.6,
      halfH: 84.6,
      _fetchedCropRatio: 1.0,
      dem: { gridSize: 4, minElev: 0, maxElev: 0, grid: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
      waterPolys: [],
      greenPolys: [],
      roadPolys: [],
      buildings: [],
      bridgePolys: [],
      roads: [...szrCarriageways, szrSkybridge],
    };
    const ctx4b = core.createBuildContext(scene4b, state50);
    const tw4b = buildLayer1TerrainAndWater(ctx4b, scene4b);
    const sp4b = solveBridgeGraph(scene4b, tw4b, ctx4b)[0];

    // Count distinct plateau maxima (collapsing flat equal-height runs) and measure max dip between outermost carriageways
    const collapsedZ = [];
    for (const z of sp4b.zTopArr) {
      if (collapsedZ.length === 0 || Math.abs(z - collapsedZ[collapsedZ.length - 1]) > 1e-3) collapsedZ.push(z);
    }
    let plateauPeaks = 0;
    for (let k = 1; k < collapsedZ.length - 1; k++) {
      if (collapsedZ[k] > collapsedZ[k - 1] + 1e-3 && collapsedZ[k] > collapsedZ[k + 1] + 1e-3) plateauPeaks++;
    }
    const outerCwX = 3.5 * 16.0 * m2uSzr;
    const corridorZ = sp4b.pts
      .map((p, idx) => ({ x: p[0], z: sp4b.zTopArr[idx] }))
      .filter(item => Math.abs(item.x) <= outerCwX);
    let maxInteriorDip = 0;
    for (let k = 0; k < corridorZ.length; k++) {
      const leftMax = Math.max(...corridorZ.slice(0, k + 1).map(o => o.z));
      const rightMax = Math.max(...corridorZ.slice(k).map(o => o.z));
      const dip = Math.min(leftMax, rightMax) - corridorZ[k].z;
      if (dip > maxInteriorDip) maxInteriorDip = dip;
    }

    check(
      plateauPeaks <= 1 && maxInteriorDip <= 0.05,
      'SZR pedestrian skybridge over 8 carriageways has <= 1 plateau peak and zero roller-coaster dips > 0.05u',
      `plateauPeaks=${plateauPeaks}, maxInteriorDip=${maxInteriorDip.toFixed(3)}u`
    );

    // 4c) Cayan Tower Bridge (way/1052951457, 35m wide man_made=bridge) + Dubai Tram (way/548105707 without bridge=yes)
    const cayanRes = await loadSceneAndBuildModel({
      title: 'CAYAN_TOWER_BRIDGE_TRAM',
      osmElements: waysToOsmElements(CAYAN_TRAM_FIXTURE_WAYS),
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: 25.0872,
      lon: 55.1438,
      spanMeters: 520,
      targetWidthCm: 50,
      targetHeightCm: 50,
      tileCols: 4,
      tileRows: 6,
      showFrame: false,
      cropRatio: 1.0,
      wantTrees: false,
      silent: true,
    });
    const cayanCtx = core.createBuildContext(cayanRes.scene, cayanRes.state);
    const cayanTw = buildLayer1TerrainAndWater(cayanCtx, cayanRes.scene);
    const cayanSpecs = solveBridgeGraph(cayanRes.scene, cayanTw, cayanCtx);
    const bp1052 = (cayanRes.scene.bridgePolys || []).find(b => b.osmId === 1052951457);
    const sp1052 = cayanSpecs.find(s => s.osmId === 1052951457);
    const cayanMToBed = cayanRes.scene.metersToUnits * (cayanCtx.scaleToBed || 1.0);
    const cayanRoadIdx = buildSpatialTriIndex2D(cayanRes.meshes.roads, 2.0);
    const tram548Pts = CAYAN_TRAM_FIXTURE_WAYS[3].pts.map(([, lat, lon]) => cayanCtx.toBed(latLonToSceneXY(lat, lon, cayanRes.scene)));
    const tramCov = samplePolylineCoverage(tram548Pts, (px, py) => queryMaxZFromIndex(cayanRoadIdx, px, py) > -Infinity, 1.5, cayanMToBed);

    const linkedTram = Boolean(bp1052 && Array.isArray(bp1052.acrossRoadIds) && bp1052.acrossRoadIds.includes(548105707));
    const deckThickMeters = sp1052 ? sp1052.deckThick / cayanMToBed : Infinity;

    check(
      linkedTram && tramCov.coveragePct >= 98.0 && tramCov.maxGapM <= 2.5,
      'Dubai Tram (way/548105707 without bridge=yes) is linked to way/1052951457, preserved on both banks & bridged across canal',
      `linkedInAcrossRoadIds=${linkedTram}, tramCoverage=${tramCov.coveragePct.toFixed(1)}%, maxGap=${tramCov.maxGapM.toFixed(2)}m`
    );
    check(
      Boolean(sp1052) && deckThickMeters <= 4.0,
      'Wide 35m Cayan Tower man_made=bridge (way/1052951457) keeps sleek deckThick (<= 4.0 m equivalent)',
      sp1052 ? `deckThickMeters=${deckThickMeters.toFixed(2)}m (deckThickU=${sp1052.deckThick.toFixed(3)}u)` : 'missing spec'
    );
  } catch (err) {
    check(false, 'Delatin TIN / Skybridge / Cayan Tram tests executed without throwing', err.stack || String(err));
  }

  // ---------------------------------------------------------------------------
  // 5. Overpass QL Size Budget (< 1,800 B across all 4 LOD tiers)
  // ---------------------------------------------------------------------------
  console.log('\n5) Overpass QL Size Budget (< 1,800 B across detail, urban, regional, and mountain tiers):');
  try {
    const bbox = { south: 25.0837, west: 55.1460, north: 25.1135, east: 55.1788 };
    for (const tier of ['detail', 'urban', 'regional', 'mountain']) {
      const qlAll = buildAdaptiveOverpassQL(bbox.south, bbox.west, bbox.north, bbox.east, tier, 20, {
        roadDetail: 'all',
        wantTrees: tier === 'detail' || tier === 'urban',
        minBuildingFootprintM: 0,
      });
      const bytesAll = Buffer.byteLength(qlAll, 'utf8');
      check(
        bytesAll < 1800,
        `buildAdaptiveOverpassQL('${tier}') fits strictly under 1,800 B budget`,
        `bytes=${bytesAll} B`
      );
    }
  } catch (err) {
    check(false, 'Overpass QL size budget checks executed without throwing', err.stack || String(err));
  }

  // ---------------------------------------------------------------------------
  // 6. Optional Real Cached Dubai Overpass + DEM Full-Sector Verification
  // ---------------------------------------------------------------------------
  if (fs.existsSync(OVERPASS_CACHE_DIR)) {
    const gzFiles = fs.readdirSync(OVERPASS_CACHE_DIR).filter(f => f.endsWith('.json.gz'));
    if (gzFiles.length > 0) {
      console.log(`\n6) Real Cached Dubai Overpass (${gzFiles.length} .json.gz chunks) + DEM Verification:`);
      try {
        const nodes = new Map();
        const ways = new Map();
        for (const f of gzFiles) {
          const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OVERPASS_CACHE_DIR, f))).toString('utf8'));
          for (const el of (data.elements || [])) {
            if (el.type === 'node') {
              if (el.lat >= 25.068 && el.lat <= 25.112 && el.lon >= 55.120 && el.lon <= 55.184) nodes.set(el.id, el);
            } else if (el.type === 'way') {
              if (!ways.has(el.id) || (el.tags && !ways.get(el.id).tags)) ways.set(el.id, el);
            }
          }
        }
        const dubWays = [...ways.values()].filter(w => {
          if (!w.tags || w.tags.building || w.tags['building:part']) return false;
          return (w.nodes || []).some(id => nodes.has(id));
        });
        const needNodeIds = new Set();
        for (const w of dubWays) for (const nid of w.nodes) needNodeIds.add(nid);
        for (const f of gzFiles) {
          const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OVERPASS_CACHE_DIR, f))).toString('utf8'));
          for (const el of (data.elements || [])) {
            if (el.type === 'node' && needNodeIds.has(el.id)) nodes.set(el.id, el);
          }
        }
        const cachedElements = [...nodes.values(), ...dubWays];

        if (ways.has(655705707) && ways.has(1090745323) && ways.has(1238963528)) {
          const hasDemDir = fs.existsSync(DEM_TILE_CACHE_DIR);
          const cacheRes = await loadSceneAndBuildModel({
            title: 'DUBAI_REAL_CACHE_CONTINUITY',
            osmElements: cachedElements,
            ...(hasDemDir ? { demCacheDir: DEM_TILE_CACHE_DIR } : {}),
            offlineOnly: true,
            offlineFallbackDem: true,
            lat: 25.0910,
            lon: 55.1380,
            spanMeters: 5200,
            targetWidthCm: 50,
            targetHeightCm: 50,
            tileCols: 4,
            tileRows: 6,
            showFrame: false,
            cropRatio: 1.0,
            wantTrees: false,
            silent: true,
          });

          const roadIds = new Set((cacheRes.scene.roads || []).map(r => r.osmId));
          const cacheCtx = core.createBuildContext(cacheRes.scene, cacheRes.state);
          const cacheMToBed = cacheRes.scene.metersToUnits * (cacheCtx.scaleToBed || 1.0);
          const cacheRoadIdx = buildSpatialTriIndex2D(cacheRes.meshes.roads, 2.0);
          const w655 = ways.get(655705707);
          const w655BedPts = w655.nodes
            .map(nid => nodes.get(nid))
            .filter(Boolean)
            .map(n => cacheCtx.toBed(latLonToSceneXY(n.lat, n.lon, cacheRes.scene)));
          const cacheWharfCov = samplePolylineCoverage(
            w655BedPts,
            (px, py) => queryMaxZFromIndex(cacheRoadIdx, px, py) > -Infinity,
            2.0,
            cacheMToBed
          );

          check(
            cacheWharfCov.coveragePct >= 98.0 && cacheWharfCov.maxGapM <= 3.0,
            'Cached Dubai sector: Bluewaters Wharf Link (way/655705707) has >= 98% coverage and zero gap > 3.0 m',
            `coverage=${cacheWharfCov.coveragePct.toFixed(1)}%, maxGap=${cacheWharfCov.maxGapM.toFixed(2)}m`
          );
          check(
            roadIds.has(1090745323) && roadIds.has(1238963528) && !roadIds.has(607818565),
            'Cached Dubai sector retains way/1090745323 (covered=yes) & way/1238963528 (building_passage) while rejecting tunnel way/607818565',
            `has1090745323=${roadIds.has(1090745323)}, has1238963528=${roadIds.has(1238963528)}, has607818565=${roadIds.has(607818565)}`
          );
          check(
            cacheRes.printMetrics.openEdgesCount === 0 && cacheRes.printMetrics.nonManifoldEdgesCount === 0,
            'Cached Dubai sector 50x50 3D build is watertight 2-manifold',
            `openEdges=${cacheRes.printMetrics.openEdgesCount}, nonManifold=${cacheRes.printMetrics.nonManifoldEdgesCount}`
          );
        }
      } catch (err) {
        check(false, 'Cached Dubai sector verification executed without throwing', err.stack || String(err));
      }
    }
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
