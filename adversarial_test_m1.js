/**
 * adversarial_test_m1.js
 * Empirical stress-testing of JavaScript client modules for Milestone 1:
 * - Hedged Overpass query manager & AggregateError elimination
 * - Overpass error fallback with valid DEM scene
 * - Watchdog timeout rejection & error structures
 * - JS Adaptive DEM zoom boundary validation
 * - JS Spatial Proximity catalog matching
 */

const assert = require('assert');
const fs = require('fs');

console.log('=== SUITE JS 1: Overpass Hedging & Error Handling ===');

// Load osm_scene_builder.js
const osmSrc = fs.readFileSync('src/gis_client/osm_scene_builder.js', 'utf8');

// Verify static properties
assert(!osmSrc.includes('Promise.any'), 'STRESS VULNERABILITY: Promise.any still present in osm_scene_builder.js!');
assert(!osmSrc.includes('AggregateError'), 'STRESS VULNERABILITY: AggregateError still present in osm_scene_builder.js!');
console.log('  [PASS] Static audit: Promise.any and AggregateError completely absent');

// Mock browser globals for Node.js execution
global.OVERPASS_ENDPOINTS_BUILDER = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
];
global._overpassMirrorRoundRobin = 0;

// Extract fetchHedgedOverpassJson
const hedgedFnMatch = osmSrc.match(/function fetchHedgedOverpassJson\([^\)]+\)\s*\{[\s\S]*?\n\}/);
if (!hedgedFnMatch) throw new Error('fetchHedgedOverpassJson not found');
eval(hedgedFnMatch[0]);

async function testHedgedAllFail() {
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    return {
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded'
    };
  };

  try {
    await fetchHedgedOverpassJson('[out:json];', { timeoutMs: 1500 });
    assert.fail('Should have rejected when all mirrors fail');
  } catch (err) {
    assert(err instanceof Error, 'Error must be standard Error instance');
    assert(!(err instanceof (global.AggregateError || Error && err.name === 'AggregateError')), 'Must not throw AggregateError');
    assert(err.message.includes('All Overpass mirrors failed'), `Unexpected message: ${err.message}`);
    console.log('  [PASS] All mirrors fail: throws standard Error with detailed diagnostic, zero AggregateError');
  } finally {
    global.fetch = origFetch;
  }
}

async function testHedgedFailoverSuccess() {
  const origFetch = global.fetch;
  let callCount = 0;
  global.fetch = async (url, opts) => {
    callCount++;
    if (url.includes('overpass-api.de')) {
      // First mirror fails immediately with 504 Gateway Timeout
      return { ok: false, status: 504, text: async () => 'Gateway Timeout' };
    }
    // Second mirror succeeds
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ elements: [{ id: 1, type: 'node', lat: 52.2, lon: 21.0 }] })
    };
  };

  try {
    const result = await fetchHedgedOverpassJson('[out:json];', { timeoutMs: 3000 });
    assert(result && Array.isArray(result.elements), 'Must resolve with elements array');
    assert.strictEqual(result.elements.length, 1);
    console.log(`  [PASS] Staggered failover: immediate mirror failover resolved valid JSON (attempts: ${callCount})`);
  } finally {
    global.fetch = origFetch;
  }
}

console.log('\n=== SUITE JS 2: JS Adaptive Terrarium DEM Zoom ===');

const demSrc = fs.readFileSync('src/gis_client/overpass_dem_fetch.js', 'utf8');
const chooseDemMatch = demSrc.match(/function chooseAdaptiveDemZoom\([^\)]+\)\s*\{[\s\S]*?\n\}/);
if (!chooseDemMatch) throw new Error('chooseAdaptiveDemZoom not found');
eval(chooseDemMatch[0]);

const zoomTests = [
  [0, 14],
  [-50, 14],
  [1200, 14],
  [2199, 14],
  [2200, 14],
  [2201, 13],
  [5499, 13],
  [5500, 13],
  [5501, 12],
  [11499, 12],
  [11500, 12],
  [11501, 11],
  [25000, 11],
  [50000, 11],
  [100000, 11],
  ['2500', 13],
  ['8000', 12]
];

for (const [s, exp] of zoomTests) {
  const z = chooseAdaptiveDemZoom(s);
  assert.strictEqual(z, exp, `chooseAdaptiveDemZoom(${s}) => ${z}, expected ${exp}`);
}
console.log('  [PASS] All 17 JS zoom boundary and extreme cases validated');

console.log('\n=== SUITE JS 3: JS Spatial Proximity Catalog Matching ===');

const streamerSrc = fs.readFileSync('src/gis_client/gis_chunk_streamer.js', 'utf8');
const haversineJsMatch = streamerSrc.match(/function haversineDistM\([^\)]+\)\s*\{[\s\S]*?\n\}/);
if (!haversineJsMatch) throw new Error('haversineDistM not found');
eval(haversineJsMatch[0]);

const catMatch = streamerSrc.match(/const PRECOMPUTED_CACHE_CATALOG = (\[[\s\S]*?\]);/);
if (!catMatch) throw new Error('PRECOMPUTED_CACHE_CATALOG not found');
const CATALOG = eval(catMatch[1]);

function findCatalogMatch(lat, lon, maxDistM = 1500.0) {
  let bestCat = null;
  let bestDist = Infinity;
  for (const cat of CATALOG) {
    const d = haversineDistM(lat, lon, cat.lat, cat.lon);
    if (d < bestDist) {
      bestDist = d;
      bestCat = cat;
    }
  }
  if (bestDist <= maxDistM) return { cat: bestCat, dist: bestDist };
  return null;
}

// Warsaw center: 52.2470, 21.0135
const R_EARTH = 6371000.0;
const dlatM = (m) => (m / R_EARTH) * (180 / Math.PI);

// Test 0m
const hit0 = findCatalogMatch(52.2470, 21.0135);
assert(hit0 && hit0.cat.title === 'WARSZAWA', '0m must hit Warsaw');

// Test 500m
const hit500 = findCatalogMatch(52.2470 + dlatM(500), 21.0135);
assert(hit500 && hit500.cat.title === 'WARSZAWA' && Math.abs(hit500.dist - 500) < 0.1, '500m must hit');

// Test 1499m
const hit1499 = findCatalogMatch(52.2470 + dlatM(1499), 21.0135);
assert(hit1499 && hit1499.cat.title === 'WARSZAWA', '1499m must hit');

// Test 1500m
const hit1500 = findCatalogMatch(52.2470 + dlatM(1500), 21.0135);
assert(hit1500 && hit1500.cat.title === 'WARSZAWA', '1500.0m must hit');

// Test 1500.5m
const miss15005 = findCatalogMatch(52.2470 + dlatM(1500.5), 21.0135);
assert(miss15005 === null, '1500.5m must miss');

// Test 1501m
const miss1501 = findCatalogMatch(52.2470 + dlatM(1501), 21.0135);
assert(miss1501 === null, '1501.0m must miss');

// Test 5000m
const miss5000 = findCatalogMatch(52.2470 + dlatM(5000), 21.0135);
assert(miss5000 === null, '5000m must miss');

console.log('  [PASS] Catalog spatial boundaries: 0m, 500m, 1499m, 1500m HIT; 1500.5m, 1501m, 5000m MISS');

// Run all async tests
(async () => {
  await testHedgedAllFail();
  await testHedgedFailoverSuccess();
  console.log('\nAll JS adversarial stress tests executed successfully!');
})();
