// tests/mcp_map3d_inspector.test.js
// Comprehensive zero-network verification suite for:
// 1. Software Canvas (evenodd polygon + courtyard hole, stroke, 256x256 PNG decode + drawImage)
// 2. Headless 3D Renderer (valid PNG IHDR, non-uniform shading, waterCutout dark obsidian board vs blue water, contact sheet)
// 3. Fidelity Audit Detectors (roundToDomeTents, flattenedDomesUnderSuperstructure, swallowedInteriorParts,
//    leakedUndergroundOrIndoor, untagged44mTowerSpikes, droppedRailwayPlatforms, untaggedHistoricFlatBlocks, etc.)
// 4. Dual-Framing MCP stdio Server (NDJSON + Content-Length: initialize, notifications/initialized, tools/list, tools/call)
// 5. CLI Smoke & Real Cached / Snapshot Render Benchmark

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'map3d-inspector-test-'));

const {
  createPipelineRuntime,
  loadSceneAndBuildModel,
  decodePngRgba,
  computeBBoxFromParams,
  latLonToSceneXY,
  sceneXYToLatLon,
  createHeadlessCanvas,
} = require('../tools/headless_scene_harness.js');

const {
  encodePngRgba,
  computePresetCamera,
  computeFocusCamera,
  renderSceneToPngBuffer,
  renderContactSheet,
} = require('../tools/headless_3d_renderer.js');

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

function approx(a, b, tol = 1e-4) {
  return Math.abs(a - b) <= tol;
}

// Helper to verify PNG binary IHDR header
function inspectPngHeader(buf) {
  const sigOk = buf.length > 32 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  const ihdrType = buf.toString('ascii', 12, 16);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { sigOk, ihdrType, width, height };
}

// ============================================================================
// Suite 1: Software Canvas Parity & PNG Decode / Blit
// ============================================================================

async function testSoftwareCanvasAndPngDecode() {
  console.log('\n[1] Software Canvas evenodd/stroke & 256x256 PNG decode');

  // 1A. Encode synthetic 256x256 Terrarium PNG (10m elevation -> R=128, G=10, B=0) and decode + blit
  const w = 256, h = 256;
  const rawRgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < rawRgba.length; i += 4) {
    rawRgba[i] = 128;
    rawRgba[i + 1] = 10;
    rawRgba[i + 2] = 0;
    rawRgba[i + 3] = 255;
  }
  const pngBuf = encodePngRgba(w, h, rawRgba);
  const decoded = decodePngRgba(pngBuf);
  check(decoded.width === 256 && decoded.height === 256, 'decodePngRgba restores 256x256 dimensions');
  check(decoded.data[0] === 128 && decoded.data[1] === 10 && decoded.data[2] === 0 && decoded.data[3] === 255,
    'decodePngRgba restores exact Terrarium RGB values');

  const demCanvas = createHeadlessCanvas(10, 10);
  demCanvas.width = 256;
  demCanvas.height = 256;
  const demCtx = demCanvas.getContext('2d', { willReadFrequently: true });
  demCtx.clearRect(0, 0, 256, 256);
  demCtx.drawImage({ width: decoded.width, height: decoded.height, data: decoded.data }, 0, 0, 256, 256);
  const imgData = demCtx.getImageData(0, 0, 256, 256);
  check(imgData.data[400] === 128 && imgData.data[401] === 10 && imgData.data[403] === 255,
    'drawImage 256x256 blit matches decoded pixels cleanly after canvas resize');

  // 1B. Polygon with courtyard/island hole: Headless Canvas evenodd + Clipper2 parity
  const runtime = createPipelineRuntime({ silent: true, offlineOnly: true });
  const Clipper2 = runtime.sandbox.__CLIPPER2__;
  check(Boolean(Clipper2 && typeof Clipper2.differenceD === 'function' && typeof Clipper2.areaPathsD === 'function'),
    'VM exposes Clipper2 2D boolean kernel (__CLIPPER2__)');

  const maskSize = 80;
  const outer = [[10, 10], [70, 10], [70, 70], [10, 70]];
  const hole = [[28, 28], [52, 28], [52, 52], [28, 52]];

  const cHeadless = createHeadlessCanvas(maskSize, maskSize);
  const c = cHeadless.getContext('2d', { willReadFrequently: true });
  c.clearRect(0, 0, maskSize, maskSize);
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#ffffff';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = 2.0;
  c.beginPath();
  outer.forEach((p, i) => (i === 0 ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1])));
  c.closePath();
  hole.forEach((p, i) => (i === 0 ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1])));
  c.closePath();
  c.fill('evenodd');
  const fillData = new Uint8ClampedArray(c.getImageData(0, 0, maskSize, maskSize).data);
  c.stroke();
  const dataHeadless = c.getImageData(0, 0, maskSize, maskSize).data;

  const pxAlpha = (buf, x, y) => buf[(y * maskSize + x) * 4 + 3];
  check(pxAlpha(dataHeadless, 40, 40) === 0,
    'Courtyard center (40,40) remains unfilled in headless Canvas');
  check(pxAlpha(dataHeadless, 18, 40) === 255,
    'Courtyard ring (18,40) is filled in headless Canvas');
  check(pxAlpha(dataHeadless, 4, 4) === 0,
    'Exterior pixel (4,4) stays empty in headless Canvas');

  const toPathD = (ring) => ring.map(([x, y]) => ({ x, y }));
  const diffPaths = Clipper2.differenceD([toPathD(outer)], [toPathD(hole)], Clipper2.FillRule.NonZero);
  const clipperArea = Math.abs(Clipper2.areaPathsD(diffPaths));
  let filledPx = 0;
  for (let i = 0; i < maskSize * maskSize; i++) {
    if (fillData[i * 4 + 3] > 127) filledPx++;
  }
  const areaDiffRatio = Math.abs(filledPx - clipperArea) / clipperArea;
  check(areaDiffRatio < 0.04, 'Headless Canvas evenodd courtyard area closely matches Clipper2 differenceD (<4% error)',
    `filledPx=${filledPx}, clipperArea=${clipperArea.toFixed(1)}, diff=${(areaDiffRatio * 100).toFixed(2)}%`);

  // Verify exact HTML5 Canvas 2D pixel-center fillRect bounds [10..69]
  const rectCanvas = createHeadlessCanvas(maskSize, maskSize);
  const rc = rectCanvas.getContext('2d');
  rc.fillStyle = '#ffffff';
  rc.fillRect(10, 10, 60, 60);
  const rd = rc.getImageData(0, 0, maskSize, maskSize).data;
  check(pxAlpha(rd, 10, 10) === 255 && pxAlpha(rd, 69, 69) === 255 && pxAlpha(rd, 70, 70) === 0,
    'fillRect obeys exact Canvas 2D [x, x+w) pixel-center boundary');
}

// ============================================================================
// Suite 2: Coordinate Mapping & 3D Renderer Visual / Water Cutout Verification
// ============================================================================

async function testRendererAndWaterCutout() {
  console.log('\n[2] Coordinate mapping, 3D shading, and waterCutout board contrast');

  // 2A. Coordinate mapping round-trip under rotation + crop
  const meta = {
    bbox: [50.100, 8.660, 50.120, 8.685],
    center: [50.110, 8.6725],
    spanMeters: 1600,
    metersToUnits: 169.2 / 1600,
    halfW: 84.6,
    halfH: 84.6,
    _fetchedCropRatio: 0.88,
    cropRatio: 0.72,
    cropCenterX: 0.1,
    cropCenterY: -0.05,
    sceneAppliedRotationDeg: 65,
  };
  const testLat = 50.1124, testLon = 8.6758;
  const xy = latLonToSceneXY(testLat, testLon, meta);
  const rt = sceneXYToLatLon(xy[0], xy[1], meta);
  check(approx(rt[0], testLat, 1e-6) && approx(rt[1], testLon, 1e-6),
    'latLonToSceneXY <-> sceneXYToLatLon exact round-trip with rotation & crop',
    `delta=(${Math.abs(rt[0] - testLat).toExponential(1)}, ${Math.abs(rt[1] - testLon).toExponential(1)})`);

  const bboxParams = computeBBoxFromParams({ lat: 50.11, lon: 8.67, spanMeters: 1600, rotationDeg: 65 });
  check(bboxParams.fetchNorth > bboxParams.north && bboxParams.fetchEast > bboxParams.east,
    'computeBBoxFromParams expands rotated fetch envelope beyond tight bbox');

  // 2B. Synthetic scene with river + gabled building + domed building
  const syntheticScene = {
    bbox: [50.105, 8.665, 50.115, 8.675],
    center: [50.110, 8.670],
    spanMeters: 600,
    metersToUnits: 169.2 / 600,
    halfW: 84.6,
    halfH: 84.6,
    _fetchedCropRatio: 0.88,
    title: 'SYNTH_TEST',
    dem: {
      gridSize: 16,
      minElev: 0,
      maxElev: 8,
      grid: Array.from({ length: 16 }, (_, r) => Array.from({ length: 16 }, (__, c) => c < 6 ? 0 : 6 + (c - 6) * 0.25)),
    },
    waterPolys: [
      { outer: [[-80, -80], [-20, -80], [-20, 80], [-80, 80]], holes: [] },
    ],
    waterLines: [],
    greenPolys: [
      { outer: [[35, -60], [72, -60], [72, -25], [35, -25]], holes: [] },
    ],
    trees: [],
    roads: [
      { pts: [[-10, -70], [-10, 70]], w: 4.5, isFootpath: false },
    ],
    roadPolys: [],
    bridgePolys: [],
    buildings: [
      {
        id: 101,
        osmId: 1001,
        name: 'Gabled Hall',
        outer: [[5, -25], [35, -25], [35, 5], [5, 5]],
        holes: [],
        h: 16,
        roofH: 5.5,
        roof: 'gabled',
        minH: 0,
      },
      {
        id: 102,
        osmId: 1002,
        name: 'Dome Rotunda',
        outer: Array.from({ length: 16 }, (_, k) => {
          const a = (k / 16) * Math.PI * 2;
          return [48 + Math.cos(a) * 14, 32 + Math.sin(a) * 14];
        }),
        holes: [],
        h: 22,
        roofH: 7.0,
        roof: 'dome',
        minH: 0,
      },
    ],
  };

  const builtWaterOn = await loadSceneAndBuildModel({
    scene: syntheticScene,
    palette: 'white',
    frameStyle: 'black',
    waterCutout: false,
    silent: true,
    offlineOnly: true,
  });
  const builtCutout = await loadSceneAndBuildModel({
    scene: syntheticScene,
    palette: 'white',
    frameStyle: 'black',
    waterCutout: true,
    silent: true,
    offlineOnly: true,
  });

  const topCam = computePresetCamera('top', { halfW: 84.6, halfH: 84.6, zMax: 24 });
  const renderWater = renderSceneToPngBuffer({
    meshes: builtWaterOn.meshes,
    state: builtWaterOn.state,
    camera: topCam,
    width: 320,
    height: 240,
    ssaa: 1,
    shadowRes: 512,
  });
  const renderCutout = renderSceneToPngBuffer({
    meshes: builtCutout.meshes,
    state: builtCutout.state,
    camera: topCam,
    width: 320,
    height: 240,
    ssaa: 1,
    shadowRes: 512,
  });

  const hdr = inspectPngHeader(renderWater.pngBuffer);
  check(hdr.sigOk && hdr.ihdrType === 'IHDR' && hdr.width === 320 && hdr.height === 240,
    'renderSceneToPngBuffer writes valid PNG signature and exact IHDR dimensions');

  // Measure river channel region (left quadrant of plate around X=-50, Y=0 -> left center in top view)
  const sampleRegionStats = (rgba, w, h, x0, y0, x1, y1) => {
    let rSum = 0, gSum = 0, bSum = 0, minL = 255, maxL = 0, cnt = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        rSum += r; gSum += g; bSum += b;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
        cnt++;
      }
    }
    return { r: rSum / cnt, g: gSum / cnt, b: bSum / cnt, luma: (0.299 * rSum + 0.587 * gSum + 0.114 * bSum) / cnt, minL, maxL };
  };

  // Channel x in [85..125], y in [95..145] inside 320x240 top view
  const channelWater = sampleRegionStats(renderWater.rgba, 320, 240, 85, 95, 125, 145);
  const channelCutout = sampleRegionStats(renderCutout.rgba, 320, 240, 85, 95, 125, 145);
  const fullViewStats = sampleRegionStats(renderWater.rgba, 320, 240, 60, 40, 260, 200);

  check(fullViewStats.maxL - fullViewStats.minL > 40,
    'Rendered scene exhibits non-uniform shaded luminance across terrain, roofs, and shadows',
    `range=${(fullViewStats.maxL - fullViewStats.minL).toFixed(1)}`);
  check(channelWater.b > channelWater.r + 25,
    'Water channel shows distinct water tint when waterCutout=false',
    `rgb=(${channelWater.r.toFixed(0)},${channelWater.g.toFixed(0)},${channelWater.b.toFixed(0)})`);
  check(channelCutout.luma < 50 && channelCutout.luma < channelWater.luma - 20,
    'Water channel exposes dark obsidian backing board when waterCutout=true',
    `cutoutLuma=${channelCutout.luma.toFixed(1)} vs waterLuma=${channelWater.luma.toFixed(1)}`);

  const focusCam = computeFocusCamera({ target: [20, 0, 5], radiusScene: 25, yawDeg: -35, pitchDeg: 35 });
  check(focusCam.distance > 25 && focusCam.distance < 300, 'computeFocusCamera computes bounded framing distance');

  const sheet = renderContactSheet({
    meshes: builtCutout.meshes,
    state: builtCutout.state,
    width: 400,
    height: 300,
    ssaa: 1,
    shadowRes: 256,
  });
  const sheetHdr = inspectPngHeader(sheet.pngBuffer);
  check(sheetHdr.sigOk && sheetHdr.width === 400 && sheetHdr.height === 300,
    'renderContactSheet produces valid 4-angle composite PNG');
}

// ============================================================================
// Suite 3: Synthetic Audit Fidelity Regression Suite
// ============================================================================

async function testFidelityAuditDetectors() {
  console.log('\n[3] audit_scene_fidelity synthetic architectural & GIS regression detectors');

  // Build synthetic OSM elements inside bbox [50.106, 8.664, 50.114, 8.676]
  let nextNodeId = 900001;
  const nodes = [];
  const ways = [];
  const relations = [];

  const centerLat = 50.110;
  const centerLon = 8.670;
  const metersToLat = (m) => m / 111320.0;
  const cosLat = Math.cos((centerLat * Math.PI) / 180.0);
  const metersToLon = (m) => m / (111320.0 * cosLat);

  const makeRectWay = (id, offXm, offYm, wM, hM, tags) => {
    const cLat = centerLat + metersToLat(offYm);
    const cLon = centerLon + metersToLon(offXm);
    const dx = metersToLon(wM * 0.5);
    const dy = metersToLat(hM * 0.5);
    const corners = [
      [cLat - dy, cLon - dx],
      [cLat - dy, cLon + dx],
      [cLat + dy, cLon + dx],
      [cLat + dy, cLon - dx],
    ];
    const nids = [];
    for (const [lat, lon] of corners) {
      const nid = nextNodeId++;
      nodes.push({ type: 'node', id: nid, lat, lon });
      nids.push(nid);
    }
    nids.push(nids[0]);
    ways.push({ type: 'way', id, nodes: nids, tags });
  };

  const makeCircleWay = (id, offXm, offYm, rM, segs, tags) => {
    const cLat = centerLat + metersToLat(offYm);
    const cLon = centerLon + metersToLon(offXm);
    const nids = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const lat = cLat + metersToLat(Math.sin(a) * rM);
      const lon = cLon + metersToLon(Math.cos(a) * rM);
      const nid = nextNodeId++;
      nodes.push({ type: 'node', id: nid, lat, lon });
      nids.push(nid);
    }
    nids.push(nids[0]);
    ways.push({ type: 'way', id, nodes: nids, tags });
  };

  // A. Elongated round station hall (aspect ~ 4.0) -> fixed to true 'round' barrel vault (roundToDomeTents === 0)
  makeRectWay(800101, -180, -140, 96, 24, {
    building: 'train_station',
    name: 'Elongated Round Hall',
    'roof:shape': 'round',
    height: '18',
    'roof:height': '10',
  });

  // B. Realistic lantern (r=9m) preserves dome (r=16m); oversized slab (r=13.5m > 60% area of r=14m dome) triggers detector
  makeCircleWay(800201, -60, -140, 16, 16, {
    'building:part': 'yes',
    name: 'Synthesized Dome Church',
    'roof:shape': 'dome',
    height: '20',
  });
  makeCircleWay(800202, -60, -140, 9, 16, {
    'building:part': 'yes',
    name: 'Preserved Lantern Cap',
    'roof:shape': 'cone',
    min_height: '20',
    height: '27',
  });
  relations.push({
    type: 'relation',
    id: 700200,
    tags: { type: 'building', building: 'church', name: 'Synthesized Dome Church' },
    members: [
      { type: 'way', ref: 800201, role: 'part' },
      { type: 'way', ref: 800202, role: 'part' },
    ],
  });

  makeCircleWay(800211, -60, -220, 14, 16, {
    'building:part': 'yes',
    name: 'Oversized Superstructure Victim Dome',
    'roof:shape': 'dome',
    height: '20',
  });
  makeCircleWay(800212, -60, -220, 13.5, 16, {
    'building:part': 'yes',
    name: 'Oversized Flat Podium Over Dome',
    'roof:shape': 'flat',
    min_height: '20',
    height: '28',
  });
  relations.push({
    type: 'relation',
    id: 700210,
    tags: { type: 'building', building: 'church', name: 'Oversized Victim Dome Complex' },
    members: [
      { type: 'way', ref: 800211, role: 'part' },
      { type: 'way', ref: 800212, role: 'part' },
    ],
  });

  // C. Equal explicit-height interior building:part inside larger gallery -> swallowedInteriorParts
  makeRectWay(800301, 60, -140, 56, 56, {
    'building:part': 'yes',
    name: 'Outer Gallery Part',
    height: '18',
  });
  makeCircleWay(800302, 60, -140, 12, 16, {
    'building:part': 'yes',
    name: 'Swallowed Equal-Height Part',
    height: '18',
  });

  // D. Underground / indoor / levels=0 structures -> filtered cleanly (leakedUndergroundOrIndoor === 0)
  makeRectWay(800401, 180, -140, 22, 18, {
    building: 'yes',
    indoor: 'yes',
    name: 'Indoor Hall Leak',
    height: '10',
  });
  makeRectWay(800402, 180, -80, 18, 18, {
    'building:part': 'yes',
    level: '-1',
    name: 'Basement Part Leak',
    height: '6',
  });
  makeRectWay(800403, 180, -20, 20, 16, {
    building: 'yes',
    'building:levels': '0',
    name: 'Zero Levels Leak',
  });

  // E. Untagged man_made=tower -> proportional tower height < 36m (untagged44mTowerSpikes === 0)
  makeCircleWay(800501, -180, 40, 7, 12, {
    building: 'tower',
    man_made: 'tower',
    name: 'Untagged Proportional Tower',
  });

  // F. Railway platform -> extracted into roadPolys (droppedRailwayPlatforms === 0)
  makeRectWay(800601, 0, 60, 110, 8, {
    railway: 'platform',
    public_transport: 'platform',
    name: 'Platform 1',
  });

  // G. Historic civic building with explicit S3DB roof:shape='hipped' -> pitched roof (untaggedHistoricFlatBlocks === 0)
  makeRectWay(800701, 90, 60, 34, 24, {
    building: 'townhall',
    historic: 'yes',
    name: 'Old Town Hall',
    height: '15',
    'roof:shape': 'hipped',
    'roof:height': '4',
  });

  // H. side_hipped normalized cleanly; exotic roof:shape still flagged in unsupportedRoofShapesHistogram
  makeRectWay(800801, -90, 140, 26, 20, {
    building: 'yes',
    'roof:shape': 'side_hipped',
    name: 'Side Hipped House',
    height: '12',
  });
  makeRectWay(800802, -30, 140, 26, 20, {
    building: 'yes',
    'roof:shape': 'hyperbolic_paraboloid',
    name: 'Exotic Roof House',
    height: '12',
  });

  const snapPath = path.join(TMP_DIR, 'synthetic_audit_snapshot.json');
  fs.writeFileSync(snapPath, JSON.stringify({
    bbox: { south: 50.106, west: 8.664, north: 50.114, east: 8.676 },
    elements: [...nodes, ...ways, ...relations],
  }));

  const outJsonPath = path.join(TMP_DIR, 'synthetic_audit_out.json');
  const cliOut = execFileSync('node', [
    path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'),
    'audit-scene',
    '--snapshot', snapPath,
    '--offline',
    '--span', '700',
    '--out', outJsonPath,
  ], { encoding: 'utf8' });
  const report = JSON.parse(fs.readFileSync(outJsonPath, 'utf8'));
  check(cliOut.length > 0 && report && report.meta, 'CLI audit-scene writes valid JSON report');
  check(report.roundToDomeTents.count === 0, 'Fixes round->dome bug cleanly (roundToDomeTents=0)',
    `count=${report.roundToDomeTents.count}`);
  check(report.flattenedDomesUnderSuperstructure.count === 1,
    'Preserves realistic r=9m lantern dome while still detecting oversized r=13.5m flat slab',
    `count=${report.flattenedDomesUnderSuperstructure.count}`);
  check(report.swallowedInteriorParts.count >= 1,
    'Detects equal-height swallowedInteriorParts', `count=${report.swallowedInteriorParts.count}`);
  check(report.leakedUndergroundOrIndoor.count === 0,
    'Filters indoor=yes, level=-1, and building:levels=0 cleanly (0 leaks)',
    `count=${report.leakedUndergroundOrIndoor.count}`);
  check(report.untagged44mTowerSpikes.count === 0,
    'Computes footprint-proportional height for untagged man_made=tower (0 44m spikes)',
    `count=${report.untagged44mTowerSpikes.count}`);
  check(report.droppedRailwayPlatforms.count === 0,
    'Preserves railway=platform surfaces (0 dropped platforms)',
    `count=${report.droppedRailwayPlatforms.count}`);
  check(report.untaggedHistoricFlatBlocks.count === 0,
    'Explicit S3DB roof:shape on historic civic building yields pitched roof (0 untagged historic flat blocks)',
    `count=${report.untaggedHistoricFlatBlocks.count}`);
  check(!report.unsupportedRoofShapesHistogram.unsupportedValues.side_hipped &&
        (report.unsupportedRoofShapesHistogram.unsupportedValues.hyperbolic_paraboloid || 0) >= 1,
    'Supports side_hipped while flagging unsupported roof:shape values');
}

// ============================================================================
// Suite 4: MCP Stdio JSON-RPC 2.0 Tests (NDJSON + Content-Length)
// ============================================================================

function parseMcpFrames(buf, mode) {
  const msgs = [];
  let rest = buf;
  if (mode === 'lsp') {
    while (rest.length > 0) {
      const sepIdx = rest.indexOf('\r\n\r\n');
      if (sepIdx < 0) break;
      const hdr = rest.subarray(0, sepIdx).toString('utf8');
      const m = hdr.match(/Content-Length:\s*(\d+)/i);
      if (!m) break;
      const len = parseInt(m[1], 10);
      const start = sepIdx + 4;
      if (rest.length < start + len) break;
      msgs.push(JSON.parse(rest.subarray(start, start + len).toString('utf8')));
      rest = rest.subarray(start + len);
    }
  } else {
    const lines = rest.toString('utf8').split('\n').map(s => s.trim()).filter(Boolean);
    for (const ln of lines) msgs.push(JSON.parse(ln));
  }
  return msgs;
}

function runMcpSession(mode, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'), 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const outChunks = [];
    const errChunks = [];
    child.stdout.on('data', d => outChunks.push(d));
    child.stderr.on('data', d => errChunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdoutBuf = Buffer.concat(outChunks);
      const stderrText = Buffer.concat(errChunks).toString('utf8');
      try {
        const responses = parseMcpFrames(stdoutBuf, mode);
        resolve({ code, stdoutBuf, stderrText, responses });
      } catch (e) {
        reject(new Error(`Failed parsing ${mode} stdout (${e.message}): ${stdoutBuf.toString('utf8')}\nstderr: ${stderrText}`));
      }
    });

    for (const req of requests) {
      const json = JSON.stringify(req);
      if (mode === 'lsp') {
        const byteLen = Buffer.byteLength(json, 'utf8');
        child.stdin.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
      } else {
        child.stdin.write(`${json}\n`);
      }
    }
    child.stdin.end();
  });
}

async function testMcpStdioServer() {
  console.log('\n[4] MCP stdio JSON-RPC server (NDJSON & Content-Length framing + 3 tools)');

  const snapPath = path.join(TMP_DIR, 'synthetic_audit_snapshot.json');
  const renderPng = path.join(TMP_DIR, 'mcp_render.png');
  const sheetPng = path.join(TMP_DIR, 'mcp_sheet.png');

  // 4A. Newline-delimited JSON-RPC (NDJSON)
  const ndRequests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'render_map3d_view',
        arguments: {
          snapshotPath: snapPath,
          offlineFallbackDem: true,
          spanMeters: 700,
          width: 320,
          height: 240,
          ssaa: 1,
          shadowRes: 512,
          waterCutout: true,
          outputPath: renderPng,
        },
      },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'inspect_landmark_3d',
        arguments: {
          snapshotPath: snapPath,
          offlineFallbackDem: true,
          spanMeters: 700,
          focus: { query: 'Synthesized Dome Church', radiusM: 120 },
          width: 320,
          height: 240,
          ssaa: 1,
          outputSheetPath: sheetPng,
        },
      },
    },
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'audit_scene_fidelity',
        arguments: { snapshotPath: snapPath, spanMeters: 700 },
      },
    },
  ];

  const ndRes = await runMcpSession('ndjson', ndRequests);
  check(ndRes.code === 0, 'MCP NDJSON server exited cleanly');
  check(ndRes.responses.length === 5, 'MCP NDJSON returned 5 responses (ignoring notification)',
    `got=${ndRes.responses.length}`);
  check(ndRes.responses[0]?.result?.protocolVersion === '2024-11-05', 'MCP initialize returns protocolVersion 2024-11-05');
  const toolNames = (ndRes.responses[1]?.result?.tools || []).map(t => t.name);
  check(
    toolNames.includes('render_map3d_view') &&
    toolNames.includes('inspect_landmark_3d') &&
    toolNames.includes('audit_scene_fidelity') &&
    toolNames.includes('export_map3d_stl'),
    'MCP tools/list exposes all 4 tools including export_map3d_stl'
  );

  const renderCallJson = JSON.parse(ndRes.responses[2]?.result?.content?.[0]?.text || '{}');
  check(fs.existsSync(renderPng) && inspectPngHeader(fs.readFileSync(renderPng)).sigOk && renderCallJson.renderedTriangles > 0,
    'MCP tools/call render_map3d_view writes valid PNG file');

  const inspectCallJson = JSON.parse(ndRes.responses[3]?.result?.content?.[0]?.text || '{}');
  check(fs.existsSync(sheetPng) && inspectPngHeader(fs.readFileSync(sheetPng)).sigOk && inspectCallJson.counts.matchedOsmElements >= 1,
    'MCP tools/call inspect_landmark_3d writes 4-angle contact sheet and returns matched hierarchy');

  const auditCallJson = JSON.parse(ndRes.responses[4]?.result?.content?.[0]?.text || '{}');
  check(auditCallJson.flattenedDomesUnderSuperstructure.count >= 1 && auditCallJson.swallowedInteriorParts.count >= 1,
    'MCP tools/call audit_scene_fidelity returns structured detector findings');

  // 4B. Content-Length framed JSON-RPC (LSP stdio style)
  const lspRequests = [
    { jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', id: 11, method: 'ping' },
    { jsonrpc: '2.0', id: 12, method: 'tools/list' },
  ];
  const lspRes = await runMcpSession('lsp', lspRequests);
  check(lspRes.code === 0 && lspRes.stdoutBuf.toString('utf8').startsWith('Content-Length: '),
    'MCP Content-Length server replies using Content-Length framing');
  check(lspRes.responses.length === 3 && lspRes.responses[1]?.id === 11,
    'MCP Content-Length handles initialize, ping, tools/list cleanly');
}

// ============================================================================
// Suite 5: CLI Smoke & Real Snapshot Benchmark (if available locally)
// ============================================================================

async function testCliAndBenchmark() {
  console.log('\n[5] CLI smoke test & offline Frankfurt benchmark (if snapshot exists)');

  const helpOut = execFileSync('node', [path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'), '--help'], { encoding: 'utf8' });
  check(helpOut.includes('render') && helpOut.includes('inspect-landmark') && helpOut.includes('audit-scene') && helpOut.includes('export-stl'),
    'CLI --help lists render, inspect-landmark, audit-scene, and export-stl');

  const frankfurtSnap = '/Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch/frankfurt_osm_live_snapshot.json';
  const frankfurtDem = '/Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch/dem_tile_cache';
  if (fs.existsSync(frankfurtSnap) && fs.existsSync(frankfurtDem)) {
    const outPng = path.join(TMP_DIR, 'frankfurt_bench.png');
    const t0 = Date.now();
    const outJson = execFileSync('node', [
      path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'),
      'render',
      '--snapshot', frankfurtSnap,
      '--dem-cache-dir', frankfurtDem,
      '--offline',
      '--lat', '50.1098',
      '--lon', '8.6712',
      '--span', '1950',
      '--rot', '65',
      '--width-cm', '50',
      '--height-cm', '50',
      '--z-scale', '1.15',
      '--palette', 'white',
      '--frame-style', 'black',
      '--water-cutout',
      '--preset', 'overview',
      '--width', '1200',
      '--height', '900',
      '--ssaa', '2',
      '--out', outPng,
    ], { encoding: 'utf8' });
    const wallMs = Date.now() - t0;
    const res = JSON.parse(outJson);
    const hdr = inspectPngHeader(fs.readFileSync(outPng));
    check(hdr.sigOk && hdr.width === 1200 && hdr.height === 900 && res.renderedTriangles > 100000,
      'Frankfurt snapshot 1200x900 SSAA=2 render completes cleanly',
      `tris=${res.renderedTriangles}, renderMs=${res.elapsedMs}ms, totalWallMs=${wallMs}ms`);
  } else {
    // Cached scene fallback smoke check if external snapshot path absent
    const cacheFiles = fs.readdirSync(path.join(ROOT, 'cache')).filter(f => f.startsWith('scene_v4_') && f.endsWith('.json'));
    if (cacheFiles.length > 0) {
      const outPng = path.join(TMP_DIR, 'cached_smoke.png');
      const outJson = execFileSync('node', [
        path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'),
        'render',
        '--scene', path.join(ROOT, 'cache', cacheFiles[0]),
        '--width', '400',
        '--height', '300',
        '--ssaa', '1',
        '--out', outPng,
      ], { encoding: 'utf8' });
      const res = JSON.parse(outJson);
      check(fs.existsSync(outPng) && res.renderedTriangles > 1000,
        `Cached scene ${cacheFiles[0]} CLI render passes`, `tris=${res.renderedTriangles}`);
    }
  }
}

// ============================================================================
// Main Runner
// ============================================================================

// ============================================================================
// Suite 6: Architectural S3DB Fixes (Barrel Vault, Rotunda, Dome Finial, TV Sphere)
// ============================================================================

async function testArchitecturalFidelityFixes() {
  console.log('\n[6] Barrel vault manifold geometry, Schirn rotunda, Paulskirche finial, suspended spheres');

  let nid = 950001;
  const nodes = [], ways = [], relations = [];
  const centerLat = 50.110, centerLon = 8.680;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const mLat = m => m / 111320;
  const mLon = m => m / (111320 * cosLat);

  const addRectBounds = (id, x0m, x1m, y0m, y1m, tags) => {
    const l0 = centerLat + mLat(y0m), l1 = centerLat + mLat(y1m);
    const n0 = centerLon + mLon(x0m), n1 = centerLon + mLon(x1m);
    const nids = [[l0, n0], [l0, n1], [l1, n1], [l1, n0]].map(([lat, lon]) => {
      const i = nid++; nodes.push({ type: 'node', id: i, lat, lon }); return i;
    });
    nids.push(nids[0]);
    ways.push({ type: 'way', id, nodes: nids, tags });
  };
  const addRect = (id, xm, ym, wM, hM, tags) =>
    addRectBounds(id, xm - wM * 0.5, xm + wM * 0.5, ym - hM * 0.5, ym + hM * 0.5, tags);
  const addPolyCircle = (id, xm, ym, rM, segs, tags) => {
    const cl = centerLat + mLat(ym), cn = centerLon + mLon(xm);
    const nids = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const i = nid++;
      nodes.push({ type: 'node', id: i, lat: cl + mLat(Math.sin(a) * rM), lon: cn + mLon(Math.cos(a) * rM) });
      nids.push(i);
    }
    nids.push(nids[0]);
    ways.push({ type: 'way', id, nodes: nids, tags });
  };

  // 1. Paulskirche-style tower dome + gold finial shaft with cone cap + thin crossbar
  addPolyCircle(880101, -120, 0, 5, 16, { 'building:part': 'yes', 'roof:shape': 'dome', 'roof:height': '5', height: '65' });
  addRect(880102, -120, 0, 0.8, 0.8, { 'building:part': 'yes', height: '69', 'roof:shape': 'cone', 'roof:height': '1', 'building:material': 'gold', name: 'Finial Shaft' });
  addRect(880103, -120, 0, 3.0, 1.2, { 'building:part': 'yes', height: '68', min_height: '67.5', 'building:material': 'gold', name: 'Crossbar' });
  relations.push({
    type: 'relation', id: 780100, tags: { type: 'building', building: 'church', name: 'Test Paulskirche Tower' },
    members: [{ type: 'way', ref: 880101, role: 'part' }, { type: 'way', ref: 880102, role: 'part' }, { type: 'way', ref: 880103, role: 'part' }],
  });

  // 2. Rotunda drum (explicit S3DB cone roof & height) inside 120m horizontal gallery wing
  addRect(880201, 20, 0, 120, 26, { 'building:part': 'yes', height: '12', name: 'Gallery Wing' });
  addPolyCircle(880202, 20, 0, 9.3, 24, { 'building:part': 'yes', height: '22', 'roof:shape': 'cone', 'roof:height': '5', name: 'Rotunda Drum' });

  // 3. Berliner Fernsehturm-style suspended observation sphere (min_height=205, r=16m on r=4.5m shaft)
  addPolyCircle(880301, 140, -60, 4.5, 16, { 'building:part': 'yes', height: '250', name: 'TV Shaft' });
  addPolyCircle(880302, 140, -60, 16.0, 20, { 'building:part': 'yes', 'roof:shape': 'dome', 'roof:height': '16', min_height: '205', height: '235', name: 'TV Sphere' });

  // 4. Notched/multi-vertex barrel-vault hall (`roof:shape=round` — like Frankfurt Hbf halls with minor bays)
  {
    const cl = centerLat + mLat(90), cn = centerLon + mLon(-40);
    const dx = mLon(60), dy = mLat(16);
    const notchY = mLat(0.5);
    const pts = [
      [cl - dy, cn - dx],
      [cl - dy, cn - mLon(12)],
      [cl - dy - notchY, cn - mLon(12)],
      [cl - dy - notchY, cn + mLon(12)],
      [cl - dy, cn + mLon(12)],
      [cl - dy, cn + dx],
      [cl + dy, cn + dx],
      [cl + dy, cn - dx],
    ];
    const nids = pts.map(([lat, lon]) => {
      const i = nid++; nodes.push({ type: 'node', id: i, lat, lon }); return i;
    });
    nids.push(nids[0]);
    ways.push({
      type: 'way', id: 880401, nodes: nids,
      tags: { building: 'train_station', 'roof:shape': 'round', 'roof:height': '16', height: '26', name: 'Barrel Shed' },
    });
  }

  // 5. Historic courtyard palace multipolygon (48m x 44m outer with 20m x 16m inner courtyard, explicit S3DB hipped roof)
  addRect(880501, -130, -110, 48, 44, {});
  addRect(880502, -130, -110, 20, 16, {});
  relations.push({
    type: 'relation', id: 780500,
    tags: { type: 'multipolygon', building: 'yes', historic: 'building', start_date: '1878', height: '18', 'roof:shape': 'hipped', 'roof:height': '4', name: 'Test Courtyard Palace' },
    members: [{ type: 'way', ref: 880501, role: 'outer' }, { type: 'way', ref: 880502, role: 'inner' }],
  });

  // 6. Parent outline suppressed unconditionally when building:part children exist, while overhang part is preserved
  addRectBounds(880601, 20, 60, -144, -116, { building: 'office', height: '24', name: 'Flat Overhang Parent' });
  addRectBounds(880602, 24, 40, -141, -119, { 'building:part': 'yes', height: '10', name: 'Ground Wing A' });
  addRectBounds(880603, 40, 56, -141, -119, { 'building:part': 'yes', height: '10', name: 'Ground Wing B' });
  addRectBounds(880604, 24, 56, -141, -119, { 'building:part': 'yes', min_height: '10', height: '24', name: 'Overhang Upper Part' });

  const osmElements6 = [...nodes, ...ways, ...relations];
  const built = await loadSceneAndBuildModel({
    osmElements: osmElements6,
    lat: centerLat,
    lon: centerLon,
    spanMeters: 450,
    isResin: true,
    offlineOnly: true,
    skipTopologyAudit: false,
    silent: true,
  });

  const findPrep = (osmId) => built.audit.preparedList.find(p => String(p.osmId) === String(osmId));
  const domePrep = findPrep(880101);
  const finialPrep = findPrep(880102);
  const crossbarPrep = findPrep(880103);
  check(domePrep && domePrep.roofShape === 'dome', 'Paulskirche-style tower dome preserved under finial',
    `roofShape=${domePrep?.roofShape}`);
  check(finialPrep && finialPrep.roofShape === 'cone' && !crossbarPrep,
    'Horizontal crossbar skipped and vertical finial tapered to cone',
    `finialRoof=${finialPrep?.roofShape}, crossbarSkipped=${!crossbarPrep}`);

  const wingPrep = findPrep(880201);
  const rotundaPrep = findPrep(880202);
  check(wingPrep && rotundaPrep && !rotundaPrep.skip && rotundaPrep.zTop > wingPrep.zTop + 3.0 && rotundaPrep.roofShape === 'cone',
    'Schirn-style circular rotunda rises proudly with conical cap above lower horizontal gallery wing',
    `rotundaZ=${rotundaPrep?.zTop?.toFixed(2)} (${rotundaPrep?.roofShape}) vs wingZ=${wingPrep?.zTop?.toFixed(2)}`);

  const spherePrep = findPrep(880302);
  const sphereScene = built.scene.buildings.find(b => String(b.osmId) === '880302');
  const [sphereCX, sphereCY] = latLonToSceneXY(centerLat + mLat(-60), centerLon + mLon(140), built.meta);
  const innerShaftR = 7.0 * (built.meta.metersToUnits || 0.376);
  let outerSphereMinTriZ = Infinity;
  let outerSphereTris = 0;
  for (const layer of [built.meshes.buildings, built.meshes.highlighted]) {
    if (layer instanceof Float32Array) {
      for (let off = 0; off + 26 < layer.length; off += 27) {
        if (Math.round(layer[off + 7]) === spherePrep?.pickId) {
          const mx = (layer[off] + layer[off + 9] + layer[off + 18]) / 3;
          const my = (layer[off + 1] + layer[off + 10] + layer[off + 19]) / 3;
          if (Math.hypot(mx - sphereCX, my - sphereCY) > innerShaftR) {
            outerSphereTris++;
            outerSphereMinTriZ = Math.min(outerSphereMinTriZ, layer[off + 2], layer[off + 11], layer[off + 20]);
          }
        }
      }
    } else if (Array.isArray(layer)) {
      for (const tri of layer) {
        if (tri && Math.round(tri.buildingId ?? tri.bId ?? -1) === spherePrep?.pickId && tri.v0 && tri.v1 && tri.v2) {
          const mx = (tri.v0[0] + tri.v1[0] + tri.v2[0]) / 3;
          const my = (tri.v0[1] + tri.v1[1] + tri.v2[1]) / 3;
          if (Math.hypot(mx - sphereCX, my - sphereCY) > innerShaftR) {
            outerSphereTris++;
            outerSphereMinTriZ = Math.min(outerSphereMinTriZ, tri.v0[2], tri.v1[2], tri.v2[2]);
          }
        }
      }
    }
  }
  check(
    spherePrep && sphereScene && outerSphereTris > 20 &&
      spherePrep.zBase > spherePrep.tZ + 40.0 && outerSphereMinTriZ > spherePrep.tZ + 40.0,
    'Fernsehturm-style suspended sphere remains elevated at min_height rather than dropping to Z=0',
    `zBase=${spherePrep?.zBase?.toFixed(2)}, outerMinTriZ=${outerSphereMinTriZ.toFixed(2)}, outerTris=${outerSphereTris}, tZ=${spherePrep?.tZ?.toFixed(2)}`
  );

  const shedPrep = findPrep(880401);
  const [shedCX] = latLonToSceneXY(centerLat + mLat(90), centerLon + mLon(-40), built.meta);
  const endOffsetMin = 45.0 * (built.meta.metersToUnits || 0.376);
  let endMaxTriZ = -Infinity;
  for (const layer of [built.meshes.buildings, built.meshes.highlighted]) {
    if (Array.isArray(layer)) {
      for (const tri of layer) {
        if (!tri || Math.round(tri.buildingId ?? tri.bId ?? -1) !== shedPrep?.pickId || !tri.v0) continue;
        for (const v of [tri.v0, tri.v1, tri.v2]) {
          if (Math.abs(v[0] - shedCX) >= endOffsetMin && v[2] > endMaxTriZ) endMaxTriZ = v[2];
        }
      }
    }
  }
  check(
    shedPrep && shedPrep.roofShape === 'round' && shedPrep.zRidge > shedPrep.zEaves + 2.0 &&
      endMaxTriZ >= shedPrep.zRidge - 0.3,
    'Notched train shed with roof:shape=round retains full open cylindrical barrel arch all the way to both gable ends',
    `roofShape=${shedPrep?.roofShape}, eaves=${shedPrep?.zEaves?.toFixed(2)}, ridge=${shedPrep?.zRidge?.toFixed(2)}, endMaxZ=${endMaxTriZ.toFixed(2)}`
  );

  const palacePrep = findPrep(780500) || (built.audit.preparedList || []).find(p => String(p.osmId).includes('780500'));
  check(palacePrep && !palacePrep.skip && palacePrep.roofShape === 'hipped',
    'Historic courtyard palace receives hipped roof matching its wing width',
    `roofShape=${palacePrep?.roofShape}`);

  const overhangParentPrep = findPrep(880601);
  const overhangPartPrep = findPrep(880604);
  check(!overhangParentPrep && overhangPartPrep && !overhangPartPrep.skip && overhangPartPrep.roofShape === 'flat',
    'Parent outline is suppressed unconditionally while overhanging upper building:part is preserved',
    `parentEmitted=${Boolean(overhangParentPrep)}, partRoof=${overhangPartPrep?.roofShape}`);

  const pm = built.printMetrics;
  check(pm &&
      pm.isWatertightManifold === true &&
      pm.nonManifoldEdgesCount === 0 &&
      pm.openEdgesCount === 0 &&
      pm.sameDirDupEdgesCount === 0 &&
      pm.unpairedDirEdgesCount === 0 &&
      pm.degenerateTrisCount === 0,
    'All Suite 6 meshes remain strictly 2-manifold watertight (0 non-manifold, 0 open, 0 dup, 0 unpaired, 0 degenerate)',
    pm ? `wt=${pm.isWatertightManifold}, nm=${pm.nonManifoldEdgesCount}, ob=${pm.openEdgesCount}, dup=${pm.sameDirDupEdgesCount}, unp=${pm.unpairedDirEdgesCount}, deg=${pm.degenerateTrisCount}` : 'missing printMetrics');

  const { pathToFileURL } = require('url');
  const { handleAuditSceneFidelity } = await import(pathToFileURL(path.join(ROOT, 'tools/mcp_map3d_inspector.mjs')).href);
  const suite6Audit = await handleAuditSceneFidelity({
    osmElements: osmElements6,
    lat: centerLat,
    lon: centerLon,
    spanMeters: 450,
    isResin: true,
    offlineOnly: true,
  }, { silent: true });
  check(suite6Audit.untaggedHistoricFlatBlocks.count === 0 && suite6Audit.crumpledConcaveLod2Roofs.count === 0,
    'Suite 6 fidelity audit confirms 0 untagged historic flat blocks and 0 crumpled concave roofs',
    `historicFlat=${suite6Audit.untaggedHistoricFlatBlocks.count}, crumpled=${suite6Audit.crumpledConcaveLod2Roofs.count}`);
}

// ============================================================================
// Suite 7: CLI & MCP A4 12x17 (2x1) 4.0mm Tunnel-Free STL Export
// ============================================================================

async function testA4TunnelFreeCliAndMcpExport() {
  console.log('\n[7] CLI & MCP A4 12x17 (2x1) 4.0mm tunnel-free solid-base STL export');
  const snapPath = path.join(TMP_DIR, 'synthetic_audit_snapshot.json');

  const cliOutDir = path.join(TMP_DIR, 'cli_a4_stl');
  const cliOut = execFileSync('node', [
    path.join(ROOT, 'tools/mcp_map3d_inspector.mjs'),
    'export-stl',
    '--snapshot', snapPath,
    '--offline',
    '--frame-preset', 'a4_12x17',
    '--prefix', 'Test_A4',
    '--out-dir', cliOutDir,
  ], { encoding: 'utf8' });
  const cliRes = JSON.parse(cliOut);

  check(
    Array.isArray(cliRes.frameMm) && cliRes.frameMm[0] === 120 && cliRes.frameMm[1] === 170 &&
    Array.isArray(cliRes.grid) && cliRes.grid[0] === 1 && cliRes.grid[1] === 2,
    'CLI export-stl --frame-preset a4_12x17 resolves 120x170 mm 1x2 grid',
    `frameMm=${JSON.stringify(cliRes.frameMm)}, grid=${JSON.stringify(cliRes.grid)}`
  );
  check(
    cliRes.solidBaseNoTunnels === true && Math.abs(cliRes.baseHeightMm - 4.0) < 1e-6 && cliRes.kerfMm === 0,
    'CLI a4_12x17 enforces solidBaseNoTunnels=true, baseHeightMm=4.0, kerfMm=0',
    `solid=${cliRes.solidBaseNoTunnels}, baseMm=${cliRes.baseHeightMm}, kerf=${cliRes.kerfMm}`
  );
  check(
    cliRes.tiles && cliRes.tiles.length === 2 &&
    cliRes.tiles.every(t =>
      fs.existsSync(t.path) &&
      t.triangles > 100 &&
      Math.abs(t.spanMm[0] - 120.0) <= 0.05 &&
      Math.abs(t.spanMm[1] - 85.0) <= 0.05 &&
      t.minMm[2] >= -0.01 &&
      t.maxMm[2] > 4.0
    ),
    'CLI export-stl writes 2 exact 120x85 mm tiles above 4.0 mm solid base',
    JSON.stringify((cliRes.tiles || []).map(t => ({ pos: t.position, span: t.spanMm, tris: t.triangles })))
  );
  check(
    cliRes.printMetrics && cliRes.printMetrics.isWatertightManifold === true && cliRes.printMetrics.openEdgesCount === 0,
    'CLI exported A4 tiles are strictly watertight 2-manifold',
    JSON.stringify(cliRes.printMetrics)
  );

  const mcpOutDir = path.join(TMP_DIR, 'mcp_a4_stl');
  const mcpRes = await runMcpSession('ndjson', [
    { jsonrpc: '2.0', id: 21, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'export_map3d_stl',
        arguments: {
          snapshotPath: snapPath,
          offlineOnly: true,
          framePreset: 'a4_12x17',
          filePrefix: 'MCP_A4',
          outputDir: mcpOutDir,
        },
      },
    },
  ]);
  const mcpPayload = JSON.parse(mcpRes.responses[1]?.result?.content?.[0]?.text || '{}');
  check(
    mcpRes.code === 0 &&
    mcpPayload.solidBaseNoTunnels === true &&
    Math.abs(mcpPayload.baseHeightMm - 4.0) < 1e-6 &&
    Array.isArray(mcpPayload.tiles) &&
    mcpPayload.tiles.length === 2 &&
    mcpPayload.tiles.every(t => fs.existsSync(t.path) && Math.abs(t.spanMm[1] - 85.0) <= 0.05),
    'MCP tools/call export_map3d_stl exports 2 watertight 120x85 mm A4 solid-base STLs',
    JSON.stringify((mcpPayload.tiles || []).map(t => ({ file: path.basename(t.path), span: t.spanMm })))
  );
}

(async function main() {
  try {
    await testSoftwareCanvasAndPngDecode();
    await testRendererAndWaterCutout();
    await testFidelityAuditDetectors();
    await testMcpStdioServer();
    await testCliAndBenchmark();
    await testArchitecturalFidelityFixes();
    await testA4TunnelFreeCliAndMcpExport();
  } finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
