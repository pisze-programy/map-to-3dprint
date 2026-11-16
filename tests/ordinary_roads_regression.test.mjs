import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/print_physics_config.js')));
Object.assign(globalThis, require(path.join(ROOT, 'src/geometry/sla_print_laws.js')));

const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
const { buildComplete3DModel } = require(path.join(ROOT, 'src/mesh/mesh_builder.js'));
const {
  collectSurfacePolys,
  collectPrintedBuildingFootprints2D,
  buildSurfaceDrapesAndFrame,
} = require(path.join(ROOT, 'src/mesh/terrain_surface_drape.js'));
const {
  selectLodTier,
  buildAdaptiveOverpassQL,
} = require(path.join(ROOT, 'src/gis_client/overpass_chunk_grid.js'));
const {
  finalizeOsmGreeneryLayerJS,
} = require(path.join(ROOT, 'src/gis_client/osm_greenery_extract.js'));
const {
  LocalOverpassEvaluator,
  loadSceneAndBuildModel,
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

function rectRing(cx, cy, hx, hy) {
  return [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
}

function makeState(overrides = {}) {
  return {
    targetWidthCm: 16,
    targetHeightCm: 16,
    bedSizeMm: 160,
    totalHeightMm: 160,
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

function sampleMaxZAtXY(tris, px, py) {
  let maxZ = -Infinity;
  for (const t of tris) {
    const [ax, ay, az] = t.v0;
    const [bx, by, bz] = t.v1;
    const [cx, cy, cz] = t.v2;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-10) continue;
    const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
    const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
    const w = 1.0 - u - v;
    if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) {
      const z = u * az + v * bz + w * cz;
      if (z > maxZ) maxZ = z;
    }
  }
  return maxZ;
}

async function runTests() {
  await core.ensureManifoldLibAsync();
  console.log('\n=== Ordinary Roads & Surface Drape Regression Suite ===\n');

  // ---------------------------------------------------------------------------
  // 1. Regression #1: Minimum road width floor (halfW = 0.225 mm, NOT 0.45 mm -> 0.90 mm)
  // ---------------------------------------------------------------------------
  console.log('1) Minimum road & footpath buffer width floor (halfW radius vs full width):');
  {
    // Simulate Palm Jumeirah 5.4 km regional scale on 16 cm Mono 4 bed:
    // plateWidth = 169 units -> scaleMm = 160 / 169 = 0.9467 mm/unit, metersToUnits = 169 / 5400 = 0.0313
    const scaleMm = 160 / 169;
    const metersToUnits = 169 / 5400;
    const mf = core.getManifoldLib();
    const ctx = {
      halfW: 84.5,
      halfH: 84.5,
      scaleMm,
      scaleToBed: 1.0,
      toBed: p => [p[0], p[1]],
      metersToUnits,
      minPrintU: 0.45 / scaleMm,
      zFloor: 0,
      zLandDatum: 2.0,
      zCeil: 10.0,
      cfg: {},
      state: makeState(),
      plateClipPoly: [rectRing(0, 0, 84.5, 84.5)],
    };
    const scene = {
      roads: [
        // 3.8 m service road on a Palm frond: 3.8 * 0.0313 = 0.119 units (0.113 mm natural -> floored to 0.45 mm full width)
        { hwy: 'service', width: 3.8 * metersToUnits, isBridge: false, isTunnel: false, isPath: false, pts: [[-20, 0], [20, 0]] },
        // Parallel Sheikh Zayed carriageways separated by 18 m (0.563 units = 0.533 mm center-to-center)
        { hwy: 'residential', width: 5.5 * metersToUnits, isBridge: false, isTunnel: false, isPath: false, pts: [[-20, 10], [20, 10]] },
        { hwy: 'residential', width: 5.5 * metersToUnits, isBridge: false, isTunnel: false, isPath: false, pts: [[-20, 10 + 18 * metersToUnits], [20, 10 + 18 * metersToUnits]] },
        // Narrow park footpath: floored to 0.25 mm full width (0.125 mm halfW)
        { hwy: 'footway', width: 2.0 * metersToUnits, isBridge: false, isTunnel: false, isPath: true, pts: [[-20, -15], [20, -15]] },
      ],
      roadPolys: [],
      greenPolys: [],
      buildings: [],
      meta: { metersToUnits },
    };

    const slab = core.extrudeRingSolid(mf, ctx.plateClipPoly[0], [], 0, 2.0);
    const surfaceData = collectSurfacePolys(core, ctx, scene, ctx.plateClipPoly);
    const res = buildSurfaceDrapesAndFrame(core, mf, ctx, slab, ctx.plateClipPoly, [], surfaceData);
    slab.delete();
    if (res.roadManifold) res.roadManifold.delete();
    if (res.greeneryManifold) res.greeneryManifold.delete();
    // Measure Y-span of the service road around y = 0
    const servicePoly = res.streetPolys2D.find(p => p.outer.some(pt => Math.abs(pt[1]) < 1.0));
    check(Boolean(servicePoly), 'Service road polygon generated');
    const ys = servicePoly.outer.map(pt => pt[1]);
    const fullWidthMm = (Math.max(...ys) - Math.min(...ys)) * scaleMm;
    check(
      fullWidthMm >= 0.43 && fullWidthMm <= 0.48,
      'Service road minimum full width is ~0.45 mm (NOT 2x inflated 0.90 mm)',
      `measured=${fullWidthMm.toFixed(3)} mm`
    );

    // Parallel carriageways 18 m apart must remain 2 separate polygons (NOT fused into 1 blob!)
    const parallelPolys = res.streetPolys2D.filter(p => p.outer.some(pt => pt[1] > 8));
    check(
      parallelPolys.length === 2,
      'Parallel carriageways 18 m apart stay cleanly separated at 5.4 km scale',
      `polyCount=${parallelPolys.length}`
    );

    // Footpath minimum full width is ~0.25 mm
    check(res.footpathPolys2D.length === 1, 'Footpath separated into footpathPolys2D');
    const pathYs = res.footpathPolys2D[0].outer.map(pt => pt[1]);
    const pathWidthMm = (Math.max(...pathYs) - Math.min(...pathYs)) * scaleMm;
    check(
      pathWidthMm >= 0.23 && pathWidthMm <= 0.28,
      'Footpath minimum full width is ~0.25 mm',
      `measured=${pathWidthMm.toFixed(3)} mm`
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Regression #2: Building footprint subtraction (courtyards + elevated buildings)
  // ---------------------------------------------------------------------------
  console.log('\n2) Building footprint subtraction from roads (villas, courtyards, elevated bridges):');
  {
    const scaleMm = 1.0;
    const mf = core.getManifoldLib();
    const ctx = {
      halfW: 50,
      halfH: 50,
      scaleMm,
      scaleToBed: 1.0,
      toBed: p => [p[0], p[1]],
      metersToUnits: 0.2,
      minPrintU: 0.45,
      zFloor: 0,
      zLandDatum: 2.0,
      zCeil: 10.0,
      cfg: {},
      state: makeState(),
      plateClipPoly: [rectRing(0, 0, 50, 50)],
    };
    const scene = {
      roads: [
        // Axial frond road passing next to a grounded villa (overlaps villa wall), through a courtyard building, and under an elevated skybridge
        { hwy: 'service', width: 2.0, isBridge: false, isTunnel: false, isPath: false, pts: [[-35, 0], [35, 0]] },
      ],
      roadPolys: [],
      greenPolys: [],
      buildings: [
        // A: Grounded villa overlapping half of the road at x=[-18..-10], y=[0.2..6.0]
        { id: 1, h: 8, minH: 0, outer: rectRing(-14, 3.1, 4, 2.9), holes: [] },
        // B: Courtyard building at x=[-4..4], y=[-6..6] with inner courtyard hole x=[-2..2], y=[-3..3]
        { id: 2, h: 12, minH: 0, outer: rectRing(0, 0, 4, 6), holes: [rectRing(0, 0, 2, 3)] },
        // C: Elevated skybridge / gatehouse (minH = 5.0 m > 2.5 m) at x=[12..18], y=[-4..4] -> road MUST pass underneath!
        { id: 3, h: 14, minH: 5.0, outer: rectRing(15, 0, 3, 4), holes: [] },
      ],
      meta: { metersToUnits: 0.2 }, // 1 m = 0.2 units -> minH=5m is above ground
    };

    const bldFps = collectPrintedBuildingFootprints2D(core, ctx, scene, ctx.plateClipPoly);
    const bldStructured = core.ringsToOutersWithHoles(bldFps, 1e-4);
    check(
      bldStructured.length === 2 && bldFps.length === 3,
      'Grounded buildings collected (with courtyard hole ring) while minH=5m skybridge is excluded',
      `structured=${bldStructured.length}, rings=${bldFps.length}`
    );

    const slab = core.extrudeRingSolid(mf, ctx.plateClipPoly[0], [], 0, 2.0);
    const surfaceData = collectSurfacePolys(core, ctx, scene, ctx.plateClipPoly);
    const res = buildSurfaceDrapesAndFrame(core, mf, ctx, slab, ctx.plateClipPoly, [], surfaceData);
    slab.delete();
    if (res.roadManifold) res.roadManifold.delete();
    if (res.greeneryManifold) res.greeneryManifold.delete();
    const pointInRing = (px, py, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
      }
      return inside;
    };
    const pointOnStreet = (x, y) => res.streetPolys2D.some(
      p => pointInRing(x, y, p.outer) && !(p.holes || []).some(h => pointInRing(x, y, h))
    );

    check(!pointOnStreet(-14, 0.6), 'Road subtracted under grounded Palm villa footprint');
    check(pointOnStreet(-14, -0.5), 'Road preserved outside grounded villa footprint');
    check(!pointOnStreet(-3.0, 0), 'Road subtracted under courtyard building outer wing');
    check(pointOnStreet(0, 0), 'Road preserved inside building inner courtyard hole');
    check(pointOnStreet(15, 0), 'Road passes cleanly underneath elevated minH=5m building');
  }

  // ---------------------------------------------------------------------------
  // 3. Regression #3: footpathHeightMm: 0.303 active & parks NOT shredded
  // ---------------------------------------------------------------------------
  console.log('\n3) Park footpaths (footpathHeightMm = 0.303 mm) draped ON TOP of intact greenery:');
  {
    // Build a complete 3D model (160 mm bed, 160 scene units -> scaleMm = 1.0 mm/unit)
    // Park spans x=[-25..25], y=[-25..25] on flat ground z=2.0.
    // Park footpath crosses x=[-40..40], y=0 (both bare ground outside park and across park interior!).
    // Ordinary street crosses x=[-40..40], y=32 (outside park).
    const scene = {
      meta: {
        plateWidth: 160,
        plateHeight: 160,
        metersToUnits: 0.1,
        centerLat: 50.057,
        centerLon: 19.938,
      },
      terrain: {
        xs: [-80, 0, 80],
        ys: [-80, 0, 80],
        elev: [[2.0, 2.0, 2.0], [2.0, 2.0, 2.0], [2.0, 2.0, 2.0]],
      },
      water: [],
      greenPolys: [
        { outer: rectRing(0, 0, 25, 25), holes: [], isPark: true },
      ],
      roadPolys: [],
      roads: [
        { hwy: 'footway', width: 1.2, isPath: true, isBridge: false, isTunnel: false, pts: [[-45, 0], [45, 0]] },
        { hwy: 'secondary', width: 2.2, isPath: false, isBridge: false, isTunnel: false, pts: [[-45, 35], [45, 35]] },
      ],
      buildings: [],
      piers: [],
      trees: [],
    };

    const st = makeState({ targetWidthCm: 16, targetHeightCm: 16, bedSizeMm: 160 });
    const built = await buildComplete3DModel(scene, st);

    check(built.printMetrics.openEdgesCount === 0, 'Complete 3D model has 0 open edges', `open=${built.printMetrics.openEdgesCount}`);
    check(built.printMetrics.nonManifoldEdgesCount === 0, 'Complete 3D model has 0 non-manifold edges', `nonManifold=${built.printMetrics.nonManifoldEdgesCount}`);

    // Verify greenery polygon was NOT split or trenched by the footpath!
    check(
      built.audit.baseInfo.greenPolyCount === 1,
      'Park greenery remains 1 unbroken polygon (NOT shredded into halves by footpath)',
      `greenPolyCount=${built.audit.baseInfo.greenPolyCount}`
    );

    // Measure Z heights in physical mm (scaleMm = 1.0, ground z = 2.0):
    // Greenery top = 2.0 + 0.454 = 2.454
    // Bare-ground footpath top (x in [-40, -30], y in [-1, 1]) = 2.0 + 0.303 = 2.303
    // Park footpath top (x in [-10, 10], y in [-1, 1]) = 2.0 + 0.454 + 0.303 = 2.757
    // Street top (x in [-10, 10], y in [34, 36]) = 2.0 + 0.567 = 2.567
    const scaleMm = built.audit.scaleMm || 1.0;
    const baseTopZ = sampleMaxZAtXY(built.meshes.base, -35, 20);
    const greenTopZ = sampleMaxZAtXY(built.meshes.greenery, 0, 12);
    const barePathTopZ = sampleMaxZAtXY(built.meshes.roads, -35, 0);
    const parkPathTopZ = sampleMaxZAtXY(built.meshes.roads, 0, 0);
    const streetTopZ = sampleMaxZAtXY(built.meshes.roads, 0, 35);

    const barePathRelMm = (barePathTopZ - baseTopZ) * scaleMm;
    const greenRelMm = (greenTopZ - baseTopZ) * scaleMm;
    const parkPathAboveGreenMm = (parkPathTopZ - greenTopZ) * scaleMm;
    const streetRelMm = (streetTopZ - baseTopZ) * scaleMm;

    check(
      barePathRelMm >= 0.30 && barePathRelMm <= 0.35,
      'Bare-ground footpath uses footpathHeightMm = 0.303 mm quantized to MSLA layer (NOT dead code 0.567 mm)',
      `barePathRelMm=${barePathRelMm.toFixed(3)} mm`
    );
    check(
      greenRelMm >= 0.45 && greenRelMm <= 0.50,
      'Park greenery relief is greeneryHeightMm = 0.454 mm quantized to MSLA layer',
      `greenRelMm=${greenRelMm.toFixed(3)} mm`
    );
    check(
      parkPathAboveGreenMm >= 0.30 && parkPathAboveGreenMm <= 0.35,
      'Park alley rises +0.303 mm (MSLA quantized) ON TOP of greenery',
      `parkPathAboveGreenMm=${parkPathAboveGreenMm.toFixed(3)} mm`
    );
    check(
      streetRelMm >= 0.56 && streetRelMm <= 0.62,
      'Ordinary street preserves roadHeightMm = 0.567 mm quantized to MSLA layer',
      `streetRelMm=${streetRelMm.toFixed(3)} mm`
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Regression #4: Regional & Urban Overpass QL local road retention
  // ---------------------------------------------------------------------------
  console.log('\n4) Overpass QL regional (3.8–7.2 km) & urban highway / multipolygon retention:');
  {
    const tier = selectLodTier(5400);
    check(tier === 'regional', '5.4 km Palm Jumeirah span selects regional tier', `tier=${tier}`);

    const bbox = { south: 25.09, west: 55.11, north: 25.14, east: 55.16 };
    const syntheticOsm = [
      { type: 'node', id: 1, lat: 25.115, lon: 55.130 },
      { type: 'node', id: 2, lat: 25.116, lon: 55.135 },
      { type: 'node', id: 3, lat: 25.117, lon: 55.135 },
      { type: 'node', id: 4, lat: 25.115, lon: 55.130 },
      { type: 'way', id: 101, nodes: [1, 2], tags: { highway: 'secondary_link' } },
      { type: 'way', id: 102, nodes: [1, 2], tags: { highway: 'tertiary_link' } },
      { type: 'way', id: 103, nodes: [1, 2], tags: { highway: 'pedestrian' } },
      { type: 'way', id: 104, nodes: [1, 2], tags: { highway: 'living_street' } },
      { type: 'way', id: 105, nodes: [1, 2], tags: { highway: 'service', access: 'private' } },
      { type: 'way', id: 106, nodes: [1, 2], tags: { highway: 'footway' } },
      { type: 'way', id: 107, nodes: [1, 2], tags: { highway: 'footway', footway: 'sidewalk' } },
      { type: 'way', id: 108, nodes: [1, 2], tags: { highway: 'path' } },
      { type: 'way', id: 109, nodes: [1, 2], tags: { railway: 'monorail', bridge: 'yes' } },
      { type: 'way', id: 110, nodes: [1, 2, 3, 4], tags: {} }, // untagged member way of breakwater multipolygon
      { type: 'relation', id: 500, members: [{ type: 'way', ref: 110, role: 'outer' }], tags: { type: 'multipolygon', man_made: 'breakwater' } },
    ];

    const evalRegional = new LocalOverpassEvaluator(syntheticOsm);
    const regionalQL = buildAdaptiveOverpassQL(bbox.south, bbox.west, bbox.north, bbox.east, 'regional');
    const regOut = evalRegional.evaluateQL(regionalQL).elements;
    const regWayIds = new Set(regOut.filter(e => e.type === 'way').map(e => e.id));
    const regRelIds = new Set(regOut.filter(e => e.type === 'relation').map(e => e.id));

    check(regWayIds.has(101), 'regional QL retains highway=secondary_link');
    check(regWayIds.has(102), 'regional QL retains highway=tertiary_link');
    check(regWayIds.has(103), 'regional QL retains highway=pedestrian');
    check(regWayIds.has(104), 'regional QL retains highway=living_street');
    check(regWayIds.has(105), 'regional QL retains highway=service + access=private (Palm frond & Crescent roads)');
    check(regWayIds.has(106), 'regional QL retains park/promenade highway=footway');
    check(!regWayIds.has(107), 'regional QL filters out noisy street-parallel footway=sidewalk');
    check(regWayIds.has(108), 'regional QL retains highway=path');
    check(regWayIds.has(109), 'regional QL retains elevated railway=monorail bridge');
    check(regRelIds.has(500) && regWayIds.has(110), 'regional QL retains man_made=breakwater multipolygon & member ways');

    const urbanQL = buildAdaptiveOverpassQL(bbox.south, bbox.west, bbox.north, bbox.east, 'urban');
    const urbOut = evalRegional.evaluateQL(urbanQL).elements;
    const urbWayIds = new Set(urbOut.filter(e => e.type === 'way').map(e => e.id));
    const urbRelIds = new Set(urbOut.filter(e => e.type === 'relation').map(e => e.id));
    check(urbWayIds.has(102) && urbRelIds.has(500), 'urban QL also retains tertiary_link and man_made=breakwater multipolygons');
  }

  // ---------------------------------------------------------------------------
  // 5. Additional Audit Bug: osm_roads_extract.js scene-unit width floor + greenery split flags
  // ---------------------------------------------------------------------------
  console.log('\n5) Regional OSM road extraction scaling & waterfront promenade split flag preservation:');
  {
    // Verify osm_roads_extract.js does NOT clamp 3.8 m service roads to 0.24 scene units (7.7 m!) at 5.4 km span
    const built = await loadSceneAndBuildModel({
      title: 'REGIONAL_ROAD_SCALE_CHECK',
      osmElements: [
        { type: 'node', id: 1, lat: 25.1160, lon: 55.1340 },
        { type: 'node', id: 2, lat: 25.1160, lon: 55.1380 },
        { type: 'node', id: 3, lat: 25.1170, lon: 55.1340 },
        { type: 'node', id: 4, lat: 25.1170, lon: 55.1380 },
        { type: 'way', id: 201, nodes: [1, 2], tags: { highway: 'service', service: 'driveway', access: 'private' } },
        { type: 'way', id: 202, nodes: [3, 4], tags: { highway: 'tertiary_link' } },
        { type: 'way', id: 203, nodes: [1, 3], tags: { highway: 'footway' } },
      ],
      offlineOnly: true,
      offlineFallbackDem: true,
      lat: 25.1165,
      lon: 55.1360,
      spanMeters: 5400,
      targetWidthCm: 16,
      targetHeightCm: 16,
      silent: true,
    });

    const svc = built.scene.roads.find(r => r.hwy === 'service');
    const tlink = built.scene.roads.find(r => r.hwy === 'tertiary_link');
    const fway = built.scene.roads.find(r => r.hwy === 'footway');
    const m2u = (built.meta && built.meta.metersToUnits) || (built.scene.meta && built.scene.meta.metersToUnits);
    check(
      Boolean(svc) && Math.abs(svc.width / m2u - 3.8) < 0.25,
      'Extracted regional service driveway preserves ~3.8 m natural width (not inflated to 7.7 m by 0.24 unit floor)',
      svc ? `naturalM=${(svc.width / m2u).toFixed(2)} m` : 'missing'
    );
    check(
      Boolean(fway) && Math.abs(fway.width / m2u - 2.2) < 0.25,
      'Extracted regional footway preserves ~2.2 m natural width (not inflated 3.5x to 7.7 m)',
      fway ? `naturalM=${(fway.width / m2u).toFixed(2)} m` : 'missing'
    );
    check(
      Boolean(tlink) && Math.abs(tlink.width / m2u - 6.4) < 0.3,
      'Extracted tertiary_link road has explicit 6.4 m natural width',
      tlink ? `naturalM=${(tlink.width / m2u).toFixed(2)} m` : 'missing'
    );

    // Verify finalizeOsmGreeneryLayerJS preserves isQuay / isWaterfrontPromenade / hwy on all split pieces
    const roadPolys = [{
      outer: rectRing(0, 0, 20, 4),
      holes: [],
      name: 'Bulwar Nadmorski',
      hwy: 'pedestrian',
      isSquare: true,
      isQuay: true,
      isWaterfrontPromenade: true,
    }];
    // A garden strip splitting the promenade cleanly into left and right pieces
    const greenPolys = [{
      outer: rectRing(0, 0, 2, 6),
      holes: [],
      isPark: true,
    }];
    finalizeOsmGreeneryLayerJS({ greenPolys, roadPolys });
    check(roadPolys.length === 2, 'Promenade split by garden strip produces 2 roadPolys', `len=${roadPolys.length}`);
    check(
      roadPolys.every(rp => rp.isQuay && rp.isWaterfrontPromenade && rp.isSquare && rp.hwy === 'pedestrian'),
      'Both split pieces preserve isQuay, isWaterfrontPromenade, isSquare, and hwy flags'
    );

    // 6) Hillside park turf shader threshold (found during NYC Central Park detail audit):
    // Sloped DEM park turf (vNorm.z ~ 0.85..0.979, i.e. 11..31 deg) must NOT be misclassified as tree cones (< 0.82)
    const fsModule = await import('node:fs');
    const webglShaderSrc = fsModule.readFileSync(path.join(ROOT, 'src/render/webgl_shaders.js'), 'utf8');
    const headlessRendererSrc = fsModule.readFileSync(path.join(ROOT, 'tools/headless_3d_renderer.js'), 'utf8');
    check(
      webglShaderSrc.includes('vNorm.z > 0.03 && vNorm.z < 0.82') && !webglShaderSrc.includes('vNorm.z < 0.98'),
      'WebGL fragment shader preserves greenery color on sloped DEM park lawns up to ~35 deg (vNorm.z >= 0.82)'
    );
    check(
      headlessRendererSrc.includes('nz > 0.03 && nz < 0.82') && !headlessRendererSrc.includes('nz < 0.98'),
      'Headless 3D renderer preserves greenery color on sloped DEM park lawns up to ~35 deg (nz >= 0.82)'
    );
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
