import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

const {
  selectLodTier,
  buildAdaptiveOverpassQL,
  buildSpatialChunkGrid,
  clearOverpassChunkCache,
} = require(path.join(ROOT, 'src/gis_client/overpass_chunk_grid.js'));

const {
  LocalOverpassEvaluator,
  createPipelineRuntime,
} = require(path.join(ROOT, 'tools/headless_scene_harness.js'));

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

// Legacy pre-compaction Overpass QL builder (commit 05379c1 / bb8ca6e) used as exact ground-truth oracle
function buildLegacyExpandedOverpassQL(south, west, north, east, lodTier = 'detail', timeoutSec = 20, lodOptions = null) {
  const _BUILD_QL_LAYER2_WAY = 'way.bw["bridge:support"];way.bw["power"="generator"];way.bw["man_made"~"^(bridge|pier|pontoon|breakwater|groyne|jetty|quay|tower|mast|communications_tower|lighthouse|chimney|cooling_tower|storage_tank|silo|crane|wind_turbine)$"];';
  const _BUILD_QL_LAYER2_NODE = 'node["bridge:support"];node["man_made"~"^(wind_turbine|tower|mast|communications_tower|lighthouse|chimney|crane)$"];node["power"="generator"]["generator:source"="wind"];';
  const _BUILD_QL_REL_BRIDGE_BLD = '(rel(bw.bw)["type"~"^(building|bridge)$"];rel(bw.bw)["building"];rel(bw.bw)["building:part"];rel(bw.bw)["bridge:support"];rel(bw.bw)["man_made"="bridge"];rel(bw.bw)["attraction"~"^(big_wheel|observation_wheel|ferris_wheel)$"];)->.br;(way(r.br);rel(r.br)->.brs;way(r.brs);)->.brw;';
  const _MP_EXCL_CONTINENTAL = '[!"building"][!"building:part"][!"route"][!"boundary"][!"restriction"][natural!~"^(bay|strait|peninsula|cape|mountain_range|massif|desert|valley|sea|ridge)$"][place!~"^(sea|ocean|peninsula|archipelago|continent|country|state|region)$"]';
  const _MP_STD_CLAUSES =
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["natural"~"^(water|wood|scrub|grassland|heath|wetland|beach|shingle|shoal|mud|bare_rock)$"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["waterway"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["water"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["landuse"~"^(reservoir|basin|forest|grass|meadow|park|recreation_ground|cemetery|village_green|allotments|farmland|orchard|vineyard)$"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["leisure"~"^(park|garden|nature_reserve|pitch|playground|common|golf_course|recreation_ground|dog_park|marina|swimming_pool)$"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["highway"="pedestrian"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["area:highway"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["man_made"~"^(quay|pier|pontoon|breakwater|groyne|jetty)$"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["railway"="platform"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["public_transport"="platform"];`;
  const _MP_MTN_CLAUSES =
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["natural"~"^(water|wood|scrub|shingle|shoal)$"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["waterway"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["water"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["landuse"~"^(reservoir|basin|forest)$"];` +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["leisure"~"^(park|nature_reserve|marina)$"];`;

  const assemble = (bbox, tSec, mpClauses, wayClauses, nodeClauses) => (
    `[out:json][timeout:${tSec}][bbox:${bbox}];way->.bw;` +
    _BUILD_QL_REL_BRIDGE_BLD +
    `rel(bw.bw)["type"="multipolygon"]${_MP_EXCL_CONTINENTAL}["place"~"^(island|islet|square)$"]->.isl;way(r.isl)->.islw;` +
    `(${mpClauses})->.mp;way(r.mp)(${bbox})->.mpw;` +
    `(${wayClauses}.brw;.islw;.mpw;)->.wbox;` +
    `(rel.br;rel.brs;.isl;.mp;.wbox;${nodeClauses}node(r.br););out body qt;node(w.wbox);out skel qt;`
  );

  const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
  const wantTrees = (lodOptions && typeof lodOptions.wantTrees === 'boolean')
    ? lodOptions.wantTrees
    : (lodTier === 'detail' || lodTier === 'urban');
  const minBldM = (lodOptions && typeof lodOptions.minBuildingFootprintM === 'number')
    ? lodOptions.minBuildingFootprintM
    : 0;
  const roadDetail = (lodOptions && lodOptions.roadDetail) || 'all';
  const nodeClause = wantTrees ? `node["natural"="tree"];${_BUILD_QL_LAYER2_NODE}` : _BUILD_QL_LAYER2_NODE;
  const wheelFilter = 'way.bw["attraction"~"^(big_wheel|observation_wheel|ferris_wheel)$"];';
  const bridgeValRegex = '^(yes|viaduct|aqueduct|boardwalk|cantilever|covered|movable|suspension|trestle)$';
  const majorHwyFilter = 'way.bw["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"];';
  const elevatedTransitFilter = `way.bw["railway"~"^(monorail|subway)$"]["bridge"~"${bridgeValRegex}"];`;

  if (lodTier === 'detail') {
    const hwyFilter = roadDetail === 'major' ? majorHwyFilter : 'way.bw["highway"];';
    const extraBridge = roadDetail === 'major' ? `way.bw["highway"]["bridge"~"${bridgeValRegex}"];` : '';
    const ways =
      'way.bw["building"];way.bw["building:part"];' +
      'way.bw["natural"~"^(water|coastline|wood|scrub|grassland|heath|tree_row|beach|wetland|shingle|shoal|mud|bare_rock)$"];' +
      'way.bw["waterway"];way.bw["water"];way.bw["landuse"];way.bw["leisure"];way.bw["area:highway"];way.bw["railway"];' +
      'way.bw["amenity"="fountain"];' +
      wheelFilter + hwyFilter + extraBridge +
      'way.bw["place"~"^(square|island|islet)$"];way.bw["public_transport"="platform"];' +
      _BUILD_QL_LAYER2_WAY;
    return assemble(bbox, timeoutSec, _MP_STD_CLAUSES, ways, nodeClause);
  }
  if (lodTier === 'urban') {
    const bldWay = minBldM <= 0
      ? 'way.bw["building"];way.bw["building:part"];'
      : 'way.bw["building"][building!~"^(shed|garage|garages|hut|cabin|kiosk|allotment_house|sty|greenhouse|static_caravan|ger)$"];way.bw["building:part"];';
    const hwyFilter = roadDetail === 'major'
      ? `${majorHwyFilter}way.bw["highway"]["bridge"~"${bridgeValRegex}"];`
      : 'way.bw["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|cycleway|footway|path|steps|track|bridleway|corridor)$"];';
    const ways =
      bldWay + wheelFilter + hwyFilter +
      'way.bw["natural"~"^(water|coastline|wood|scrub|grassland|heath|tree_row|beach|wetland|shingle|shoal|mud|bare_rock)$"];' +
      'way.bw["waterway"];way.bw["water"];way.bw["area:highway"];way.bw["amenity"="fountain"];' +
      'way.bw["landuse"~"^(reservoir|basin|forest|grass|meadow|park|recreation_ground|cemetery|village_green|allotments|farmland|orchard|vineyard)$"];' +
      'way.bw["leisure"~"^(park|garden|nature_reserve|pitch|playground|common|golf_course|recreation_ground|dog_park|marina|swimming_pool)$"];' +
      'way.bw["place"~"^(square|island|islet)$"];way.bw["railway"~"^(rail|light_rail|tram|narrow_gauge|funicular|platform)$"];' +
      elevatedTransitFilter + 'way.bw["public_transport"="platform"];' +
      _BUILD_QL_LAYER2_WAY;
    return assemble(bbox, timeoutSec, _MP_STD_CLAUSES, ways, nodeClause);
  }
  // Regional & wide-span ('mountain') unstripped oracle: zero artificial stripping of buildings, building:part, streets, squares, or parks
  const regNodes = (lodOptions && lodOptions.wantTrees === true) ? `node["natural"="tree"];${_BUILD_QL_LAYER2_NODE}` : _BUILD_QL_LAYER2_NODE;
  const natRegex = (lodOptions && lodOptions.wantTrees === true)
    ? '^(water|coastline|wood|scrub|grassland|heath|beach|wetland|shingle|shoal|mud|bare_rock|tree_row)$'
    : '^(water|coastline|wood|scrub|grassland|heath|beach|wetland|shingle|shoal|mud|bare_rock)$';
  const bldWayWide = minBldM <= 0
    ? 'way.bw["building"];way.bw["building:part"];'
    : 'way.bw["building"][building!~"^(shed|garage|garages|hut|cabin|kiosk|allotment_house|sty|greenhouse|static_caravan|ger)$"];way.bw["building:part"];';
  const regHwyFilter = roadDetail === 'major'
    ? majorHwyFilter
    : 'way.bw["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|path|cycleway|steps|track|bridleway|corridor)$"];' +
      'way.bw["highway"="footway"][footway!~"^(sidewalk|crossing|access_aisle|island)$"];';
  const ways =
    bldWayWide + wheelFilter +
    `way.bw["natural"~"${natRegex}"];way.bw["waterway"];way.bw["water"];way.bw["area:highway"];way.bw["amenity"="fountain"];way.bw["place"~"^(square|island|islet)$"];` +
    'way.bw["landuse"~"^(reservoir|basin|forest|grass|meadow|park|recreation_ground|cemetery|village_green|allotments|farmland|orchard|vineyard)$"];' +
    'way.bw["leisure"~"^(park|garden|nature_reserve|pitch|playground|common|golf_course|recreation_ground|dog_park|marina|swimming_pool)$"];' +
    regHwyFilter +
    `way.bw["highway"]["bridge"~"${bridgeValRegex}"];way.bw["railway"~"^(rail|light_rail|tram|narrow_gauge|funicular|platform)$"];` +
    elevatedTransitFilter + 'way.bw["public_transport"="platform"];' +
    _BUILD_QL_LAYER2_WAY;
  return assemble(bbox, timeoutSec, _MP_STD_CLAUSES, ways, regNodes);
}

function resolveOverpassV2CacheDir() {
  const candidates = [path.join(ROOT, 'cache/overpass_v2')];
  try {
    const commonGit = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (commonGit) {
      candidates.push(path.resolve(ROOT, commonGit, '..', 'cache/overpass_v2'));
    }
  } catch (_) {}
  candidates.push('/Users/krystianblaszczyk/nodes/piszeprogramy/map-to-3dprint/cache/overpass_v2');
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function parseQueryBBox(initBody) {
  const raw = String(initBody || '');
  const m = raw.match(/(?:^|&)data=([^&]+)/);
  const ql = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : raw;
  const bm = ql.match(/\[bbox:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\]/);
  return {
    ql,
    bboxKey: bm ? `${bm[1]},${bm[2]},${bm[3]},${bm[4]}` : 'unknown',
    bbox: bm ? [Number(bm[1]), Number(bm[2]), Number(bm[3]), Number(bm[4])] : null,
  };
}

function makeQuadrantBuildingsDataset(south, west, north, east) {
  const midLat = (south + north) * 0.5;
  const midLon = (west + east) * 0.5;
  const dLat = (north - south) * 0.25;
  const dLon = (east - west) * 0.25;
  // 4 distinct buildings centered cleanly inside each of the 4 2x2 sub-chunks (.1 SW, .2 SE, .3 NW, .4 NE)
  const centers = [
    { id: 9001, name: 'Tower_SW_Sub1', lat: south + dLat, lon: west + dLon },
    { id: 9002, name: 'Tower_SE_Sub2', lat: south + dLat, lon: midLon + dLon },
    { id: 9003, name: 'Tower_NW_Sub3', lat: midLat + dLat, lon: west + dLon },
    { id: 9004, name: 'Tower_NE_Sub4', lat: midLat + dLat, lon: midLon + dLon },
  ];
  const elements = [];
  for (const c of centers) {
    const baseNid = c.id * 10;
    const rLat = 0.00035;
    const rLon = 0.00035;
    const coords = [
      [c.lat - rLat, c.lon - rLon],
      [c.lat - rLat, c.lon + rLon],
      [c.lat + rLat, c.lon + rLon],
      [c.lat + rLat, c.lon - rLon],
    ];
    const nids = [];
    for (let i = 0; i < coords.length; i++) {
      const nid = baseNid + i + 1;
      nids.push(nid);
      elements.push({ type: 'node', id: nid, lat: coords[i][0], lon: coords[i][1] });
    }
    nids.push(nids[0]);
    elements.push({
      type: 'way',
      id: c.id,
      nodes: nids,
      tags: { building: 'apartments', 'building:levels': '18', height: '65', name: c.name },
    });
  }
  return elements;
}

async function runTests() {
  console.log('\n=== Overpass QL Compaction (<1800B), Exact Parity & Sub-Chunk Retry Suite ===\n');

  // ---------------------------------------------------------------------------
  // 1. Raw byte length < 1,800 B across ALL LOD tiers and option combinations
  // ---------------------------------------------------------------------------
  console.log('1) Overpass QL raw UTF-8 byte length < 1,800 B across all LOD tiers & options:');
  {
    const tiers = ['detail', 'urban', 'regional', 'mountain'];
    let maxObservedBytes = 0;
    const tierStats = {};

    for (const tier of tiers) {
      let minOld = Infinity, maxOld = 0, minNew = Infinity, maxNew = 0;
      for (const roadDetail of ['all', 'major']) {
        for (const wantTrees of [true, false]) {
          for (const minBuildingFootprintM of [0, 12]) {
            for (const fetchSpanMeters of [0, 20000]) {
              if (tier !== 'mountain' && fetchSpanMeters > 0) continue;
              const opts = { roadDetail, wantTrees, minBuildingFootprintM, fetchSpanMeters };
              const oldQL = buildLegacyExpandedOverpassQL(25.0986, 55.1460, 25.1135, 55.1624, tier, 20, opts);
              const newQL = buildAdaptiveOverpassQL(25.0986, 55.1460, 25.1135, 55.1624, tier, 20, opts);
              const oldB = Buffer.byteLength(oldQL, 'utf8');
              const newB = Buffer.byteLength(newQL, 'utf8');
              if (oldB < minOld) minOld = oldB;
              if (oldB > maxOld) maxOld = oldB;
              if (newB < minNew) minNew = newB;
              if (newB > maxNew) maxNew = newB;
              if (newB > maxObservedBytes) maxObservedBytes = newB;

              if (newB >= 1800) {
                check(false, `${tier} (${JSON.stringify(opts)}) < 1800 B`, `got ${newB} B`);
              }
            }
          }
        }
      }
      tierStats[tier] = { minOld, maxOld, minNew, maxNew };
      check(
        maxNew < 1800,
        `${tier.toUpperCase()} QL strictly < 1,800 B across all option combinations`,
        `legacy=${minOld}..${maxOld} B -> compacted=${minNew}..${maxNew} B`
      );
    }
    check(
      maxObservedBytes < 1800,
      'Global maximum raw Overpass QL byte length across all tiers < 1,800 B',
      `maxObserved=${maxObservedBytes} B`
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Exact 100% element parity on real Dubai cached OSM chunks
  // ---------------------------------------------------------------------------
  console.log('\n2) Exact 100% element-for-element parity (ways, relations, nodes) on real Dubai OSM data:');
  {
    const cacheDir = resolveOverpassV2CacheDir();
    check(Boolean(cacheDir), 'Located cache/overpass_v2 directory with real Dubai OSM chunks', cacheDir || 'missing');

    if (cacheDir) {
      const dubaiTargets = [
        { file: '9f49cd1c01d44d66.json.gz', label: 'Dubai Marina / Al Sufouh failing sub-sector', bbox: [25.0986, 55.1460, 25.1135, 55.1624] },
        { file: '4fc3b3fcd74debd8.json.gz', label: 'Palm Jumeirah & Trunk / Crescent', bbox: [25.0900, 55.1100, 25.1400, 55.1600] },
        { file: '991ce32db73c29b2.json.gz', label: 'Dense Dubai Sheikh Zayed / Media City', bbox: [25.0950, 55.1350, 25.1350, 55.1750] },
      ].filter(t => fs.existsSync(path.join(cacheDir, t.file)));

      check(dubaiTargets.length >= 1, 'At least one real Dubai .json.gz chunk loaded for parity verification', `count=${dubaiTargets.length}`);

      for (const target of dubaiTargets) {
        const rawJson = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(cacheDir, target.file))).toString('utf8'));
        const rawEls = Array.isArray(rawJson) ? rawJson : (rawJson.elements || []);
        const evaluator = new LocalOverpassEvaluator(rawEls);
        const [s, w, n, e] = target.bbox;

        let combosChecked = 0;
        let mismatchDetail = null;
        let totalVerifiedElements = 0;

        for (const tier of ['detail', 'urban', 'regional', 'mountain']) {
          for (const roadDetail of ['all', 'major']) {
            for (const wantTrees of [true, false]) {
              for (const minBuildingFootprintM of [0, 12]) {
                const opts = { roadDetail, wantTrees, minBuildingFootprintM };
                const oldOut = evaluator.evaluateQL(buildLegacyExpandedOverpassQL(s, w, n, e, tier, 20, opts)).elements;
                const newOut = evaluator.evaluateQL(buildAdaptiveOverpassQL(s, w, n, e, tier, 20, opts)).elements;
                totalVerifiedElements += newOut.length;
                combosChecked++;

                const oldKeys = new Set(oldOut.map(el => `${el.type}:${el.id}`));
                const newKeys = new Set(newOut.map(el => `${el.type}:${el.id}`));
                if (oldKeys.size !== newKeys.size) {
                  const lost = [...oldKeys].filter(k => !newKeys.has(k));
                  const extra = [...newKeys].filter(k => !oldKeys.has(k));
                  mismatchDetail = `${tier} ${JSON.stringify(opts)}: lost=${lost.slice(0, 4).join(',')} (${lost.length}), extra=${extra.slice(0, 4).join(',')} (${extra.length})`;
                  break;
                }
                for (const k of oldKeys) {
                  if (!newKeys.has(k)) {
                    mismatchDetail = `${tier} ${JSON.stringify(opts)}: missing ${k}`;
                    break;
                  }
                }
                if (mismatchDetail) break;
              }
              if (mismatchDetail) break;
            }
            if (mismatchDetail) break;
          }
          if (mismatchDetail) break;
        }

        check(
          mismatchDetail === null && combosChecked === 32 && totalVerifiedElements > 0,
          `100% exact node/way/relation parity on ${target.file} (${target.label}) across all 32 tier/option combos`,
          mismatchDetail || `combos=${combosChecked}, totalMatchedElements=${totalVerifiedElements.toLocaleString()}`
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Simulated HTTP 400 -> 2x2 split -> sub-chunk #3 fails on attempt 1, succeeds on targeted retry
  // ---------------------------------------------------------------------------
  console.log('\n3) Parent HTTP 400 -> 2x2 split -> sub-chunk #3 transient failure recovered via targeted retry:');
  {
    const south = 25.1000, west = 55.1400, north = 25.1120, east = 55.1520;
    const dataset = makeQuadrantBuildingsDataset(south, west, north, east);
    const evaluator = new LocalOverpassEvaluator(dataset);

    const runtime = createPipelineRuntime({ offlineOnly: true, offlineFallbackDem: true, silent: true });
    runtime.sandbox.clearOverpassChunkCache();

    // Compute exact parent & 2x2 sub-chunk bboxes matching fetchChunkWithRecursiveSplit
    const grid = buildSpatialChunkGrid(south, west, north, east, 1400, { fetchSpanMeters: 1400 });
    check(grid.chunks.length === 1, 'Single parent chunk created for ~1.4 km test sector', `chunks=${grid.chunks.length}`);
    const parentChunk = grid.chunks[0];
    const parentBBoxKey = `${parentChunk.south.toFixed(5)},${parentChunk.west.toFixed(5)},${parentChunk.north.toFixed(5)},${parentChunk.east.toFixed(5)}`;

    const midLat = (parentChunk.south + parentChunk.north) * 0.5;
    const midLon = (parentChunk.west + parentChunk.east) * 0.5;
    const subPadLat = (parentChunk.north - parentChunk.south) * 0.008;
    const subPadLon = (parentChunk.east - parentChunk.west) * 0.008;
    const subBBoxKeys = [
      `${parentChunk.south.toFixed(5)},${parentChunk.west.toFixed(5)},${Math.min(parentChunk.north, midLat + subPadLat).toFixed(5)},${Math.min(parentChunk.east, midLon + subPadLon).toFixed(5)}`,
      `${parentChunk.south.toFixed(5)},${Math.max(parentChunk.west, midLon - subPadLon).toFixed(5)},${Math.min(parentChunk.north, midLat + subPadLat).toFixed(5)},${parentChunk.east.toFixed(5)}`,
      `${Math.max(parentChunk.south, midLat - subPadLat).toFixed(5)},${parentChunk.west.toFixed(5)},${parentChunk.north.toFixed(5)},${Math.min(parentChunk.east, midLon + subPadLon).toFixed(5)}`,
      `${Math.max(parentChunk.south, midLat - subPadLat).toFixed(5)},${Math.max(parentChunk.west, midLon - subPadLon).toFixed(5)},${parentChunk.north.toFixed(5)},${parentChunk.east.toFixed(5)}`,
    ];

    const subChunkLogicalAttempts = new Map(); // bboxKey -> logical chunk fetch attempts
    let sub3MirrorCalls = 0;

    runtime.sandbox._overpassCustomFetch = async (ep, init) => {
      const { ql, bboxKey } = parseQueryBBox(init && init.body);
      if (bboxKey === parentBBoxKey) {
        // Parent chunk fails across all mirrors with HTTP 400 (simulating heavy/oversized sector)
        return {
          ok: false,
          status: 400,
          async text() { return 'HTTP 400 Bad Request'; },
          async json() { throw new Error('HTTP 400'); },
        };
      }
      if (bboxKey === subBBoxKeys[2]) {
        // Sub-chunk #3: fail ALL 4 mirrors on attempt 1 (4 mirror calls), then succeed on targeted retry (5th call)!
        sub3MirrorCalls++;
        if (sub3MirrorCalls <= 4) {
          return {
            ok: false,
            status: 504,
            async text() { return 'HTTP 504 Gateway Timeout'; },
            async json() { throw new Error('HTTP 504'); },
          };
        }
      }
      subChunkLogicalAttempts.set(bboxKey, (subChunkLogicalAttempts.get(bboxKey) || 0) + 1);
      const data = evaluator.evaluateQL(ql);
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify(data); },
        async json() { return data; },
      };
    };

    const progressEvents = [];
    const scene = await runtime.sandbox.fetchChunkedGISInBrowser(south, west, north, east, 'SUBCHUNK_RETRY_RECOVERY', {
      targetSpanMeters: 1400,
      subRetryDelayMs: 15,
      retryDelayMs: 15,
      onProgress: (info) => progressEvents.push(info),
    });

    const buildingNames = new Set((scene.buildings || []).map(b => b.name).filter(Boolean));
    check(
      scene.buildings.length === 4 &&
      buildingNames.has('Tower_SW_Sub1') &&
      buildingNames.has('Tower_SE_Sub2') &&
      buildingNames.has('Tower_NW_Sub3') &&
      buildingNames.has('Tower_NE_Sub4'),
      'All 4 sub-chunks (including recovered sub-chunk #3) assembled with 0 holes',
      `buildings=${scene.buildings.length} (${[...buildingNames].sort().join(', ')})`
    );
    check(
      subChunkLogicalAttempts.get(subBBoxKeys[0]) === 1 &&
      subChunkLogicalAttempts.get(subBBoxKeys[1]) === 1 &&
      subChunkLogicalAttempts.get(subBBoxKeys[3]) === 1,
      'Healthy sub-chunks #1, #2, #4 were each fetched ONLY ONCE (stored in _overpassChunkCache)',
      `counts=[${subChunkLogicalAttempts.get(subBBoxKeys[0])}, ${subChunkLogicalAttempts.get(subBBoxKeys[1])}, ${subChunkLogicalAttempts.get(subBBoxKeys[3])}]`
    );
    const subProgressHeartbeats = progressEvents.filter(e => e && e.progressKind === 'subchunk');
    const hasStartHeartbeat = subProgressHeartbeats.some(e => e.subChunkPhase === 'start' || e.subChunkPhase === 'retry-start');
    const hasDoneHeartbeat = subProgressHeartbeats.some(e => e.subChunkPhase === 'done' || e.subChunkPhase === 'retry-done');
    check(
      subProgressHeartbeats.length >= 6 && hasStartHeartbeat && hasDoneHeartbeat,
      'onProgress(progressKind="subchunk") heartbeats emitted BEFORE and AFTER sub-chunk attempts for 45s watchdog',
      `subchunkEvents=${subProgressHeartbeats.length}`
    );
    check(
      scene._partialIncomplete === false && scene._failedChunkCount === 0 && Array.isArray(scene._missingSubChunkIds) && scene._missingSubChunkIds.length === 0,
      'Recovered scene has scene._partialIncomplete === false and 0 missing sub-chunks',
      `_partialIncomplete=${scene._partialIncomplete}, _failedChunkCount=${scene._failedChunkCount}`
    );

    // 3b) Direct leaf sub-chunk targeted retry (400m parent -> ~200m 2x2 sub-chunks where sub-chunk #3 fails pass 1 and succeeds on retry-start/retry-done)
    {
      const sLeaf = 25.1000, wLeaf = 55.1400, nLeaf = 25.1036, eLeaf = 55.1438; // ~400m parent -> ~200m sub-chunks
      const leafData = makeQuadrantBuildingsDataset(sLeaf, wLeaf, nLeaf, eLeaf);
      const leafEval = new LocalOverpassEvaluator(leafData);
      runtime.sandbox.clearOverpassChunkCache();

      const leafGrid = buildSpatialChunkGrid(sLeaf, wLeaf, nLeaf, eLeaf, 400, { fetchSpanMeters: 400 });
      const leafParent = leafGrid.chunks[0];
      const leafParentKey = `${leafParent.south.toFixed(5)},${leafParent.west.toFixed(5)},${leafParent.north.toFixed(5)},${leafParent.east.toFixed(5)}`;
      const lMidLat = (leafParent.south + leafParent.north) * 0.5;
      const lMidLon = (leafParent.west + leafParent.east) * 0.5;
      const lPadLat = (leafParent.north - leafParent.south) * 0.008;
      const lPadLon = (leafParent.east - leafParent.west) * 0.008;
      const leafSubKeys = [
        `${leafParent.south.toFixed(5)},${leafParent.west.toFixed(5)},${Math.min(leafParent.north, lMidLat + lPadLat).toFixed(5)},${Math.min(leafParent.east, lMidLon + lPadLon).toFixed(5)}`,
        `${leafParent.south.toFixed(5)},${Math.max(leafParent.west, lMidLon - lPadLon).toFixed(5)},${Math.min(leafParent.north, lMidLat + lPadLat).toFixed(5)},${leafParent.east.toFixed(5)}`,
        `${Math.max(leafParent.south, lMidLat - lPadLat).toFixed(5)},${leafParent.west.toFixed(5)},${leafParent.north.toFixed(5)},${Math.min(leafParent.east, lMidLon + lPadLon).toFixed(5)}`,
        `${Math.max(leafParent.south, lMidLat - lPadLat).toFixed(5)},${Math.max(leafParent.west, lMidLon - lPadLon).toFixed(5)},${leafParent.north.toFixed(5)},${leafParent.east.toFixed(5)}`,
      ];

      const leafCounts = new Map();
      let leafSub3MirrorHits = 0;
      runtime.sandbox._overpassCustomFetch = async (ep, init) => {
        const { ql, bboxKey } = parseQueryBBox(init && init.body);
        if (bboxKey === leafParentKey) {
          return { ok: false, status: 400, async text() { return 'HTTP 400'; }, async json() { throw new Error('HTTP 400'); } };
        }
        if (bboxKey === leafSubKeys[2]) {
          leafSub3MirrorHits++;
          if (leafSub3MirrorHits <= 4) {
            return { ok: false, status: 429, async text() { return 'HTTP 429 Too Many Requests'; }, async json() { throw new Error('HTTP 429'); } };
          }
        }
        leafCounts.set(bboxKey, (leafCounts.get(bboxKey) || 0) + 1);
        const data = leafEval.evaluateQL(ql);
        return { ok: true, status: 200, async text() { return JSON.stringify(data); }, async json() { return data; } };
      };

      const leafEvents = [];
      const leafScene = await runtime.sandbox.fetchChunkedGISInBrowser(sLeaf, wLeaf, nLeaf, eLeaf, 'LEAF_SUBCHUNK_TARGETED_RETRY', {
        targetSpanMeters: 400,
        subRetryDelayMs: 15,
        retryDelayMs: 15,
        onProgress: (info) => leafEvents.push(info),
      });

      const hasRetryStart = leafEvents.some(e => e && e.progressKind === 'subchunk' && e.subChunkId === 'R1C1.3' && e.subChunkPhase === 'retry-start');
      const hasRetryDone = leafEvents.some(e => e && e.progressKind === 'subchunk' && e.subChunkId === 'R1C1.3' && e.subChunkPhase === 'retry-done');
      check(
        leafScene.buildings.length === 4 &&
        leafScene._partialIncomplete === false &&
        leafCounts.get(leafSubKeys[0]) === 1 &&
        leafCounts.get(leafSubKeys[1]) === 1 &&
        leafCounts.get(leafSubKeys[2]) === 1 &&
        leafCounts.get(leafSubKeys[3]) === 1 &&
        hasRetryStart &&
        hasRetryDone,
        'Leaf sub-chunk #3 HTTP 429 recovered via targeted retry (retry-start -> retry-done) without re-fetching sub-chunks #1, #2, #4',
        `buildings=${leafScene.buildings.length}, sub3MirrorHits=${leafSub3MirrorHits}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Simulated permanent sub-chunk #3 failure -> partialElements preserved & _partialIncomplete === true
  // ---------------------------------------------------------------------------
  console.log('\n4) Permanent sub-chunk #3 failure preserves 3 healthy sub-chunks & marks scene._partialIncomplete === true:');
  {
    const south = 25.1000, west = 55.1400, north = 25.1120, east = 55.1520;
    const dataset = makeQuadrantBuildingsDataset(south, west, north, east);
    const evaluator = new LocalOverpassEvaluator(dataset);

    const runtime = createPipelineRuntime({ offlineOnly: true, offlineFallbackDem: true, silent: true });
    runtime.sandbox.clearOverpassChunkCache();

    const grid = buildSpatialChunkGrid(south, west, north, east, 1400, { fetchSpanMeters: 1400 });
    const parentChunk = grid.chunks[0];
    const parentBBoxKey = `${parentChunk.south.toFixed(5)},${parentChunk.west.toFixed(5)},${parentChunk.north.toFixed(5)},${parentChunk.east.toFixed(5)}`;
    const midLat = (parentChunk.south + parentChunk.north) * 0.5;
    const midLon = (parentChunk.west + parentChunk.east) * 0.5;
    const subPadLat = (parentChunk.north - parentChunk.south) * 0.008;
    const subPadLon = (parentChunk.east - parentChunk.west) * 0.008;
    const subBBoxKeys = [
      `${parentChunk.south.toFixed(5)},${parentChunk.west.toFixed(5)},${Math.min(parentChunk.north, midLat + subPadLat).toFixed(5)},${Math.min(parentChunk.east, midLon + subPadLon).toFixed(5)}`,
      `${parentChunk.south.toFixed(5)},${Math.max(parentChunk.west, midLon - subPadLon).toFixed(5)},${Math.min(parentChunk.north, midLat + subPadLat).toFixed(5)},${parentChunk.east.toFixed(5)}`,
      `${Math.max(parentChunk.south, midLat - subPadLat).toFixed(5)},${parentChunk.west.toFixed(5)},${parentChunk.north.toFixed(5)},${Math.min(parentChunk.east, midLon + subPadLon).toFixed(5)}`,
      `${Math.max(parentChunk.south, midLat - subPadLat).toFixed(5)},${Math.max(parentChunk.west, midLon - subPadLon).toFixed(5)},${parentChunk.north.toFixed(5)},${parentChunk.east.toFixed(5)}`,
    ];

    const healthyFetchCounts = new Map();
    let failedSub3LeafHits = 0;

    runtime.sandbox._overpassCustomFetch = async (ep, init) => {
      const { ql, bboxKey, bbox } = parseQueryBBox(init && init.body);
      if (bboxKey === parentBBoxKey) {
        return {
          ok: false,
          status: 400,
          async text() { return 'HTTP 400 Bad Request'; },
          async json() { throw new Error('HTTP 400'); },
        };
      }
      // Fail sub-chunk #3 AND any recursive depth-2 children inside the NW quadrant permanently
      const isInNWQuadrant = bbox && bbox[0] >= midLat - subPadLat - 1e-4 && bbox[3] <= midLon + subPadLon + 1e-4;
      if (bboxKey === subBBoxKeys[2] || isInNWQuadrant) {
        failedSub3LeafHits++;
        return {
          ok: false,
          status: 504,
          async text() { return 'HTTP 504 Gateway Timeout'; },
          async json() { throw new Error('HTTP 504'); },
        };
      }
      healthyFetchCounts.set(bboxKey, (healthyFetchCounts.get(bboxKey) || 0) + 1);
      const data = evaluator.evaluateQL(ql);
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify(data); },
        async json() { return data; },
      };
    };

    const scene = await runtime.sandbox.fetchChunkedGISInBrowser(south, west, north, east, 'PERMANENT_SUB3_FAILURE', {
      targetSpanMeters: 1400,
      subRetryDelayMs: 10,
      retryDelayMs: 10,
    });

    const buildingNames = new Set((scene.buildings || []).map(b => b.name).filter(Boolean));
    check(
      scene.buildings.length === 3 &&
      buildingNames.has('Tower_SW_Sub1') &&
      buildingNames.has('Tower_SE_Sub2') &&
      buildingNames.has('Tower_NE_Sub4') &&
      !buildingNames.has('Tower_NW_Sub3'),
      'partialElements from the 3 healthy sub-chunks are preserved in final scene',
      `buildings=${scene.buildings.length} (${[...buildingNames].sort().join(', ')})`
    );
    check(
      healthyFetchCounts.get(subBBoxKeys[0]) === 1 &&
      healthyFetchCounts.get(subBBoxKeys[1]) === 1 &&
      healthyFetchCounts.get(subBBoxKeys[3]) === 1 &&
      failedSub3LeafHits > 4,
      'Pass 2 targeted retry ONLY hit missing sub-chunk #3 (healthy sub-chunks #1, #2, #4 fetched once)',
      `healthy=[${healthyFetchCounts.get(subBBoxKeys[0])}, ${healthyFetchCounts.get(subBBoxKeys[1])}, ${healthyFetchCounts.get(subBBoxKeys[3])}], sub3Hits=${failedSub3LeafHits}`
    );
    check(
      scene._partialIncomplete === true &&
      scene._failedChunkCount === 1 &&
      Array.isArray(scene._missingSubChunkIds) &&
      scene._missingSubChunkIds.length >= 1 &&
      scene._missingSubChunkIds.every(id => id.startsWith('R1C1.3')),
      'Incomplete parent chunk is NEVER silently marked complete (scene._partialIncomplete === true, _failedChunkCount === 1)',
      `_partialIncomplete=${scene._partialIncomplete}, _failedChunkCount=${scene._failedChunkCount}, missing=${JSON.stringify(scene._missingSubChunkIds)}`
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Late onPartialScene race guard: streamCompleted blocks post-completion overwrite
  // ---------------------------------------------------------------------------
  console.log('\n5) Late partialPreviewPromise race guard (onPartialScene never fires after streamCompleted):');
  {
    // 2.4 km span -> 2x2 grid (4 chunks) so partialPreviewPromise triggers at >= 50% (2/4 chunks)
    const south = 25.1000, west = 55.1400, north = 25.1220, east = 55.1640;
    const dataset = makeQuadrantBuildingsDataset(south, west, north, east);
    const evaluator = new LocalOverpassEvaluator(dataset);

    const runtime = createPipelineRuntime({ offlineOnly: true, offlineFallbackDem: true, silent: true });
    runtime.sandbox.clearOverpassChunkCache();
    runtime.sandbox._overpassCustomFetch = async (ep, init) => {
      const { ql } = parseQueryBBox(init && init.body);
      const data = evaluator.evaluateQL(ql);
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify(data); },
        async json() { return data; },
      };
    };

    let finalResolved = false;
    let partialCalledAfterFinal = false;
    const scene = await runtime.sandbox.fetchChunkedGISInBrowser(south, west, north, east, 'PARTIAL_GUARD_CHECK', {
      targetSpanMeters: 2400,
      partialPreviewDelayMs: 120, // Slower than the remaining in-memory chunks so streamCompleted wins first
      onPartialScene: () => {
        if (finalResolved) partialCalledAfterFinal = true;
      },
    });
    finalResolved = true;
    await new Promise(r => setTimeout(r, 180));

    check(
      !partialCalledAfterFinal && scene.buildings.length === 4 && scene._partialIncomplete === false,
      'streamCompleted prevents late onPartialScene from firing after final scene resolves',
      `partialCalledAfterFinal=${partialCalledAfterFinal}, buildings=${scene.buildings.length}`
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Proxy timeout remark (generator="Map3D Overpass Proxy") immediately triggers 2x2 split (0 secondary mirror waste) + 12km dynamic grid
  // ---------------------------------------------------------------------------
  console.log('\n6) Map3D Overpass Proxy timeout remark immediately triggers 2x2 split + dynamic 12km spatial tiling:');
  {
    const grid12km = buildSpatialChunkGrid(25.1400, 55.2110, 25.2543, 55.3373, 12000, { fetchSpanMeters: 12720 });
    check(
      grid12km.rows === 6 && grid12km.cols === 6 && grid12km.chunks.length === 36,
      '12km metropolis fetch (12.72km envelope) splits into 6x6 = 36 tiles (~2.1km each) instead of 3x3 (4.37km)',
      `grid=${grid12km.rows}x${grid12km.cols} (${grid12km.chunks.length} tiles)`
    );

    const south = 25.1900, west = 55.2680, north = 25.2020, east = 55.2800;
    const dataset = makeQuadrantBuildingsDataset(south, west, north, east);
    const evaluator = new LocalOverpassEvaluator(dataset);
    const runtime = createPipelineRuntime({ offlineOnly: true, offlineFallbackDem: true, silent: true });
    runtime.sandbox.window.location.protocol = 'http:';
    runtime.sandbox.clearOverpassChunkCache();

    const parentGrid = buildSpatialChunkGrid(south, west, north, east, 1400, { fetchSpanMeters: 1400 });
    const pChunk = parentGrid.chunks[0];
    const parentKey = `${pChunk.south.toFixed(5)},${pChunk.west.toFixed(5)},${pChunk.north.toFixed(5)},${pChunk.east.toFixed(5)}`;

    const parentEndpointsHit = [];
    runtime.sandbox._overpassCustomFetch = async (ep, init) => {
      const { ql, bboxKey } = parseQueryBBox(init && init.body);
      if (bboxKey === parentKey) {
        parentEndpointsHit.push(ep);
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              version: 0.6,
              generator: 'Map3D Overpass Proxy',
              elements: [],
              remark: 'runtime error: Query timed out after 14s',
            });
          },
        };
      }
      const data = evaluator.evaluateQL(ql);
      return { ok: true, status: 200, async text() { return JSON.stringify(data); } };
    };

    const sc = await runtime.sandbox.fetchChunkedGISInBrowser(south, west, north, east, 'PROXY_INSTANT_SPLIT', {
      targetSpanMeters: 1400,
      subRetryDelayMs: 10,
      retryDelayMs: 10,
    });
    check(
      parentEndpointsHit.length === 1 && parentEndpointsHit[0] === '/api/interpreter' && sc.buildings.length === 4,
      'Map3D Overpass Proxy timeout remark sets isQueryTooHeavy=true and immediately splits 2x2 without polling direct browser mirrors',
      `parentEndpointsHit=${JSON.stringify(parentEndpointsHit)}, buildings=${sc.buildings.length}`
    );
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
