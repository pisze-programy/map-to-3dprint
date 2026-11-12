#!/usr/bin/env node
/**
 * scripts/compare_1to1_crop.mjs
 *
 * Pure UI-free 1:1 OpenStreetMap vs 3D Render Crop & Diagnostic Harness.
 *
 * Usage:
 *   node scripts/compare_1to1_crop.mjs --lat <lat> --lon <lon> --span <km> [--rot 0] --name <slug> [--out <dir>]
 *
 * Outputs in <out> (default: /Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch/crops):
 *   - <slug>_3d.png   (800x800 UI-free North-up orthographic 1:1 crop of the 3D plate)
 *   - <slug>_osm.png  (800x800 UI-free 1:1 OpenStreetMap standard raster crop of exact same plate bounds)
 *   - <slug>_pair.png (1612x800 side-by-side: left 800x800 OSM, 12px dark divider, right 800x800 3D)
 *   - <slug>_meta.json (exact bounds, sceneData counts, raw OSM waterway tunnel/culvert/covered & island diagnostics, DEM & mesh stats)
 */

import dns from 'node:dns';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { chromium } from 'playwright';

dns.setDefaultResultOrder('ipv4first');

const DEFAULT_OUT_DIR =
  '/Users/krystianblaszczyk/.gemini/antigravity/brain/acf68bd7-959f-4001-b031-f431964aa593/scratch/crops';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8765';
const CROP_SIZE_PX = 800;
const DIVIDER_PX = 12;
const OSM_USER_AGENT = 'Map3DParityAudit/1.0';

function parseArgs(argv) {
  const opts = {
    lat: null,
    lon: null,
    span: null,
    rot: 0,
    name: null,
    out: DEFAULT_OUT_DIR,
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: 120000,
  };

  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eqIdx = raw.indexOf('=');
    const key = (eqIdx >= 0 ? raw.slice(2, eqIdx) : raw.slice(2)).trim();
    const nextVal = () => (eqIdx >= 0 ? raw.slice(eqIdx + 1) : argv[++i]);

    switch (key) {
      case 'lat':
        opts.lat = Number(nextVal());
        break;
      case 'lon':
      case 'lng':
        opts.lon = Number(nextVal());
        break;
      case 'span':
      case 'spanKm':
      case 'span-km':
        opts.span = Number(nextVal());
        break;
      case 'rot':
      case 'rotation':
        opts.rot = Number(nextVal()) || 0;
        break;
      case 'name':
      case 'slug':
        opts.name = String(nextVal() || '').trim();
        break;
      case 'out':
      case 'outDir':
      case 'out-dir':
        opts.out = String(nextVal() || DEFAULT_OUT_DIR).trim();
        break;
      case 'url':
      case 'base-url':
        opts.baseUrl = String(nextVal() || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
        break;
      case 'timeout':
        opts.timeoutMs = Math.max(15000, Number(nextVal()) || 120000);
        break;
      case 'help':
      case 'h':
        printUsageAndExit(0);
        break;
      default:
        break;
    }
  }

  if (
    !Number.isFinite(opts.lat) ||
    opts.lat < -85 ||
    opts.lat > 85 ||
    !Number.isFinite(opts.lon) ||
    opts.lon < -180 ||
    opts.lon > 180 ||
    !Number.isFinite(opts.span) ||
    opts.span <= 0 ||
    !opts.name
  ) {
    printUsageAndExit(1);
  }

  opts.name = opts.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return opts;
}

function printUsageAndExit(code) {
  console.error(
    'Usage: node scripts/compare_1to1_crop.mjs --lat <lat> --lon <lon> --span <km> [--rot 0] --name <slug> [--out <dir>]'
  );
  process.exit(code);
}

function lon2tileF(lon, z) {
  return ((lon + 180.0) / 360.0) * Math.pow(2, z);
}

function lat2tileF(lat, z) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180.0;
  return ((1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0) * Math.pow(2, z);
}

function chooseOsmZoom(centerLat, plateSpanMeters) {
  const cosLat = Math.max(0.15, Math.cos((centerLat * Math.PI) / 180.0));
  for (const z of [18, 17, 16]) {
    const metersPerPx = (156543.03392804097 * cosLat) / Math.pow(2, z);
    const nativeSpanPx = plateSpanMeters / metersPerPx;
    if (nativeSpanPx <= 1850 || z === 16) {
      return z;
    }
  }
  return 17;
}

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  family: 4,
});

function httpsGetBuffer(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: httpsAgent,
        family: 4,
        headers: {
          'User-Agent': OSM_USER_AGENT,
          Accept: 'image/png,image/*;q=0.9,*/*;q=0.5',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const redirected = new URL(res.headers.location, url).toString();
          httpsGetBuffer(redirected, timeoutMs).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms for ${url}`));
    });
    req.on('error', reject);
  });
}

async function fetchSingleOsmTileDataUrl(z, tx, ty, cacheDir) {
  const n = Math.pow(2, z);
  const wrappedX = ((tx % n) + n) % n;
  if (ty < 0 || ty >= n) return null;

  const cacheFile = path.join(cacheDir, `${z}_${wrappedX}_${ty}.png`);
  if (fs.existsSync(cacheFile)) {
    try {
      const buf = fs.readFileSync(cacheFile);
      if (buf.length > 64 && buf[0] === 0x89 && buf[1] === 0x50) {
        return `data:image/png;base64,${buf.toString('base64')}`;
      }
    } catch (_) {}
  }

  const urls = [
    `https://tile.openstreetmap.org/${z}/${wrappedX}/${ty}.png`,
    `https://a.tile.openstreetmap.fr/osmfr/${z}/${wrappedX}/${ty}.png`,
  ];

  let lastErr = null;
  for (let attempt = 0; attempt < urls.length; attempt++) {
    try {
      const buf = await httpsGetBuffer(urls[attempt], 15000);
      if (buf && buf.length > 64) {
        try {
          fs.writeFileSync(cacheFile, buf);
        } catch (_) {}
        return `data:image/png;base64,${buf.toString('base64')}`;
      }
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastErr || new Error(`Failed to fetch OSM tile ${z}/${wrappedX}/${ty}`);
}

async function fetchOsmTileGrid(z, tMinX, tMaxX, tMinY, tMaxY, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const jobs = [];
  for (let ty = tMinY; ty <= tMaxY; ty++) {
    for (let tx = tMinX; tx <= tMaxX; tx++) {
      jobs.push({ tx, ty });
    }
  }

  const results = [];
  const concurrency = Math.min(4, Math.max(1, jobs.length));
  let idx = 0;

  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      const dataUrl = await fetchSingleOsmTileDataUrl(z, job.tx, job.ty, cacheDir);
      if (dataUrl) {
        results.push({ tx: job.tx, ty: job.ty, dataUrl });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function summarizeRawOsmElements(rawElementsMap) {
  const elements = Array.from(rawElementsMap.values());
  let nodeCount = 0;
  let wayCount = 0;
  let relationCount = 0;

  const waterwaysByType = {};
  const waterwaysUndergroundByCombo = {};
  const waterwaysUndergroundItems = [];
  const waterwayItemsSample = [];
  const naturalSurfaceAndIslands = {};
  const naturalIslandItems = [];
  const waterMultipolygons = [];

  for (const el of elements) {
    if (el.type === 'node') {
      nodeCount++;
      const t = el.tags || {};
      if (t.place === 'island' || t.place === 'islet') {
        const key = `node:place=${t.place}`;
        naturalSurfaceAndIslands[key] = (naturalSurfaceAndIslands[key] || 0) + 1;
        if (naturalIslandItems.length < 30) {
          naturalIslandItems.push({ type: 'node', id: el.id, name: t.name || '', place: t.place });
        }
      }
      continue;
    }
    if (el.type === 'way') wayCount++;
    else if (el.type === 'relation') relationCount++;

    const t = el.tags || {};

    if (t.waterway) {
      const ww = String(t.waterway);
      waterwaysByType[ww] = (waterwaysByType[ww] || 0) + 1;
      if (waterwayItemsSample.length < 40) {
        waterwayItemsSample.push({ type: el.type, id: el.id, tags: t });
      }

      const tun = t.tunnel && !['no', 'false', '0', 'none'].includes(String(t.tunnel).toLowerCase())
        ? String(t.tunnel)
        : null;
      const cov = t.covered && !['no', 'false', '0', 'none'].includes(String(t.covered).toLowerCase())
        ? String(t.covered)
        : null;
      const ind = t.indoor && !['no', 'false', '0', 'none'].includes(String(t.indoor).toLowerCase())
        ? String(t.indoor)
        : null;
      const layerNum = t.layer !== undefined ? Number(t.layer) : 0;
      const negLayer = Number.isFinite(layerNum) && layerNum < 0 ? layerNum : null;

      if (tun || cov || ind || negLayer !== null) {
        const flags = [
          tun ? `tunnel=${tun}` : null,
          cov ? `covered=${cov}` : null,
          ind ? `indoor=${ind}` : null,
          negLayer !== null ? `layer=${negLayer}` : null,
        ]
          .filter(Boolean)
          .join(',');
        const comboKey = `${ww}|${flags}`;
        waterwaysUndergroundByCombo[comboKey] = (waterwaysUndergroundByCombo[comboKey] || 0) + 1;
        if (waterwaysUndergroundItems.length < 40) {
          waterwaysUndergroundItems.push({
            type: el.type,
            id: el.id,
            name: t.name || '',
            waterway: ww,
            tunnel: t.tunnel || null,
            covered: t.covered || null,
            indoor: t.indoor || null,
            layer: t.layer || null,
            width: t.width || null,
          });
        }
      }
    }

    if (
      t.place === 'island' ||
      t.place === 'islet' ||
      ['shingle', 'shoal', 'beach', 'sand', 'bare_rock', 'scree', 'wetland', 'mud'].includes(t.natural)
    ) {
      const k = t.place ? `place=${t.place}` : `natural=${t.natural}`;
      naturalSurfaceAndIslands[k] = (naturalSurfaceAndIslands[k] || 0) + 1;
      if (naturalIslandItems.length < 30) {
        naturalIslandItems.push({
          type: el.type,
          id: el.id,
          name: t.name || '',
          natural: t.natural || null,
          place: t.place || null,
        });
      }
    }

    if (
      el.type === 'relation' &&
      (t.natural === 'water' || ['riverbank', 'dock', 'canal'].includes(t.waterway) || Boolean(t.water))
    ) {
      const members = el.members || [];
      const outerCount = members.filter((m) => !m.role || m.role === 'outer' || m.role === 'outline').length;
      const innerCount = members.filter((m) => m.role === 'inner').length;
      if (waterMultipolygons.length < 30) {
        waterMultipolygons.push({
          id: el.id,
          name: t.name || '',
          natural: t.natural || null,
          water: t.water || null,
          waterway: t.waterway || null,
          outerWayMembers: outerCount,
          innerWayMembers: innerCount,
        });
      }
    }
  }

  const totalUndergroundWaterways = Object.values(waterwaysUndergroundByCombo).reduce((a, b) => a + b, 0);

  return {
    totalUniqueElements: elements.length,
    nodes: nodeCount,
    ways: wayCount,
    relations: relationCount,
    waterwaysByType,
    waterwaysWithTunnelCulvertOrCoveredCount: totalUndergroundWaterways,
    waterwaysUndergroundByCombo,
    waterwaysUndergroundItems,
    waterwayItemsSample,
    naturalSurfaceAndIslands,
    naturalIslandItems,
    waterMultipolygons,
  };
}

function dataUrlToBuffer(dataUrl) {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl || !dataUrl.startsWith(prefix)) {
    throw new Error('Invalid PNG dataURL');
  }
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(opts.out, { recursive: true });
  const tileCacheDir = path.join(opts.out, '.osm_tile_cache');

  const isMac = process.platform === 'darwin';
  const glFlags = isMac
    ? ['--use-gl=angle', '--use-angle=metal']
    : ['--use-gl=angle', '--use-angle=swiftshader'];

  const browser = await chromium.launch({
    headless: true,
    args: [
      ...glFlags,
      '--enable-webgl',
      '--enable-webgl2-compute-context',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const rawOsmElements = new Map();

  try {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1100 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    page.on('response', async (resp) => {
      try {
        const u = resp.url();
        if ((u.includes('/api/interpreter') || u.includes('overpass')) && resp.status() === 200) {
          const data = await resp.json().catch(() => null);
          if (data && Array.isArray(data.elements)) {
            for (const el of data.elements) {
              if (el && el.type && el.id !== undefined) {
                const key = `${el.type}/${el.id}`;
                const prev = rawOsmElements.get(key);
                if (!prev || (!prev.tags && el.tags) || (!prev.nodes && el.nodes)) {
                  rawOsmElements.set(key, el);
                }
              }
            }
          }
        }
      } catch (_) {}
    });

    const targetUrl =
      `${opts.baseUrl}/?lat=${opts.lat.toFixed(6)}&lon=${opts.lon.toFixed(6)}` +
      `&span=${opts.span}&palette=studio_4color&frame=50x50&rot=${opts.rot}&hollow=0` +
      `&lod_trees=1&lod_bld=0`;

    console.log(`[compare_1to1_crop] Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForFunction(() => Boolean(window.__map3d && window.__map3d.state && window.__map3d.studio), null, {
      timeout: 20000,
    });

    // Enforce Studio 4-color palette ('studio' in PALETTES; 'studio_4color' aliases to 'studio')
    // and ensure #lodMinBuildingSizeSlider === 0 and #lodEnableTreesCheck is checked.
    const lodChanged = await page.evaluate(() => {
      const { state, studio, renderPalettesUI, renderLayersUI } = window.__map3d;
      let needRefetch = false;

      if (typeof PALETTES !== 'undefined') {
        const studioPal =
          PALETTES.find((p) => p.id === 'studio_4color') ||
          PALETTES.find((p) => p.id === 'studio') ||
          PALETTES[1];
        if (studioPal) {
          state.activePalette = studioPal.id;
          state.colors = { ...studioPal.colors };
          delete state.colors.highlighted;
          if (typeof renderPalettesUI === 'function') renderPalettesUI();
          if (typeof renderLayersUI === 'function') renderLayersUI();
          if (studio && typeof studio.render === 'function') studio.render(true);
        }
      }

      const bldSlider = document.getElementById('lodMinBuildingSizeSlider');
      if (bldSlider && Number(bldSlider.value) !== 0) {
        bldSlider.value = '0';
        bldSlider.dispatchEvent(new Event('input', { bubbles: true }));
        bldSlider.dispatchEvent(new Event('change', { bubbles: true }));
        needRefetch = true;
      }
      if (state.lodSettings && state.lodSettings.minBuildingFootprintM !== 0) {
        state.lodSettings.minBuildingFootprintM = 0;
        state.lodSettings.minBuildingMeters = 0;
        needRefetch = true;
      }

      const treeCheck = document.getElementById('lodEnableTreesCheck');
      if (treeCheck && !treeCheck.checked) {
        treeCheck.checked = true;
        treeCheck.dispatchEvent(new Event('change', { bubbles: true }));
        needRefetch = true;
      }
      if (state.lodSettings && state.lodSettings.enableTrees === false) {
        state.lodSettings.enableTrees = true;
        needRefetch = true;
      }
      if (state.layerVisible) {
        state.layerVisible.water = true;
        state.layerVisible.base = true;
        state.layerVisible.greenery = true;
        state.layerVisible.trees = true;
        state.layerVisible.roads = true;
        state.layerVisible.buildings = true;
      }

      return needRefetch;
    });

    // Wait for initial URL-triggered GIS fetch if in progress
    await page.evaluate(async () => {
      if (window.__map3dUrlReady) {
        try {
          await window.__map3dUrlReady;
        } catch (_) {}
      }
    });

    const checkReady = () => {
      const m = window.__map3d;
      if (!m || !m.state || !m.state.sceneData) return false;
      const sc = m.state.sceneData;
      if (sc._isPartialPreview || sc._fallback) return false;
      const overlay = document.getElementById('loadingOverlay3D');
      const errBanner = document.getElementById('gisErrorBanner');
      const btn = document.getElementById('btnRender3D');
      if (!overlay || !overlay.classList.contains('hidden')) return false;
      if (errBanner && !errBanner.classList.contains('hidden')) return false;
      if (btn && btn.disabled) return false;
      return m.state.totalTriangles > 500 && m.state.printMetrics !== null;
    };

    const startWait = Date.now();
    let isReady = false;
    if (!lodChanged) {
      try {
        await page.waitForFunction(checkReady, null, { timeout: Math.min(45000, opts.timeoutMs) });
        isReady = true;
      } catch (_) {
        isReady = false;
      }
    }

    // Explicitly click #btnRender3D if LoD changed or initial URL fetch needed retry
    for (let attempt = 1; !isReady && Date.now() - startWait < opts.timeoutMs && attempt <= 2; attempt++) {
      console.log(`[compare_1to1_crop] Triggering #btnRender3D (attempt ${attempt})...`);
      await page.waitForFunction(
        () => {
          const btn = document.getElementById('btnRender3D');
          return Boolean(btn && !btn.disabled);
        },
        null,
        { timeout: 30000 }
      ).catch(() => {});
      await page.click('#btnRender3D', { force: true });
      const remMs = Math.max(15000, opts.timeoutMs - (Date.now() - startWait));
      try {
        await page.waitForFunction(checkReady, null, { timeout: remMs });
        isReady = true;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }

    if (!isReady) {
      throw new Error(`Timed out after ${opts.timeoutMs}ms waiting for 3D render (>500 tris, hidden overlays).`);
    }

    // Re-confirm Studio 4-color palette after fetch & capture pure UI-free 800x800 1:1 3D crop + scene metadata
    const captureResult = await page.evaluate(
      ({ cropPx }) => {
        const { state, studio } = window.__map3d;
        const sc = state.sceneData;

        if (typeof PALETTES !== 'undefined') {
          const studioPal =
            PALETTES.find((p) => p.id === 'studio_4color') ||
            PALETTES.find((p) => p.id === 'studio') ||
            PALETTES[1];
          if (studioPal) {
            state.activePalette = studioPal.id;
            state.colors = { ...studioPal.colors };
            delete state.colors.highlighted;
          }
        }

        const dimW = state.bedSizeMm || (state.targetWidthCm ? state.targetWidthCm * 10 : 500);
        const dimH = state.totalHeightMm || (state.targetHeightCm ? state.targetHeightCm * 10 : dimW);
        const maxDim = Math.max(dimW, dimH) || 500;
        const halfW = 84.6 * (dimW / maxDim);
        const halfH = 84.6 * (dimH / maxDim);

        const baseCrop = sc._fetchedCropRatio || 1.0;
        const effectiveCrop = Math.min(1.0, Math.max(0.35, (state.cropRatio || 0.88) / baseCrop));
        const scaleToBed = 1.0 / effectiveCrop;
        const cropCX = (state.cropCenterX || 0) * halfW;
        const cropCY = (state.cropCenterY || 0) * halfH;

        const centerLat = sc.center[0];
        const centerLon = sc.center[1];
        const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180.0));
        const mToU = sc.metersToUnits;
        const rotDeg = typeof normalizeRotationDeg === 'function'
          ? normalizeRotationDeg(state.mapRotationDeg || 0)
          : (state.mapRotationDeg || 0);
        const rad = (rotDeg * Math.PI) / 180.0;

        function bedToLatLon(bx, by) {
          const rx = bx / scaleToBed + cropCX;
          const ry = by / scaleToBed + cropCY;
          const ux = rx * Math.cos(rad) + ry * Math.sin(rad);
          const uy = -rx * Math.sin(rad) + ry * Math.cos(rad);
          const lon = centerLon + ux / (111320.0 * cosLat * mToU);
          const lat = centerLat + uy / (111320.0 * mToU);
          return [lat, lon];
        }

        const cornerNW = bedToLatLon(-halfW, halfH);
        const cornerNE = bedToLatLon(halfW, halfH);
        const cornerSE = bedToLatLon(halfW, -halfH);
        const cornerSW = bedToLatLon(-halfW, -halfH);

        const allLats = [cornerNW[0], cornerNE[0], cornerSE[0], cornerSW[0]];
        const allLons = [cornerNW[1], cornerNE[1], cornerSE[1], cornerSW[1]];
        const exactBounds =
          Array.isArray(sc.bounds) && sc.bounds.length === 4
            ? sc.bounds
            : [
                Math.min(...allLats),
                Math.min(...allLons),
                Math.max(...allLats),
                Math.max(...allLons),
              ];

        const plateWidthMeters = (2.0 * (halfW / scaleToBed)) / mToU;
        const plateHeightMeters = (2.0 * (halfH / scaleToBed)) / mToU;

        // Render pure UI-free 1:1 orthographic top-down 3D crop directly from #view3dCanvas
        const canvas3d = document.getElementById('view3dCanvas');
        const origStyle = canvas3d.getAttribute('style') || '';
        const origCam = {
          yaw: studio.camera.yaw,
          pitch: studio.camera.pitch,
          distance: studio.camera.distance,
          target: studio.camera.target.slice(),
        };
        const origShowFrame = state.showFrame;
        const origAutoRotate = state.autoRotate;
        const origExplode = state.explodeFactor;
        const origTileExplode = state.tileExplode;
        const origTileFilter = state.exportTileFilter;
        const origHovered = state.hoveredBuildingId;
        const origClicked = state.userClickedBuilding;
        const origMat4Perspective = window.mat4Perspective;

        let crop3dDataUrl = null;
        try {
          state.showFrame = false;
          state.autoRotate = false;
          state.explodeFactor = 0.0;
          state.tileExplode = 0.0;
          state.exportTileFilter = 'all';
          state.hoveredBuildingId = null;
          state.userClickedBuilding = false;

          // Position strictly top-down (North = +Y = screen Up, East = +X = screen Right)
          studio.camera.yaw = 0.0;
          studio.camera.pitch = Math.PI * 0.5 - 1e-5;
          studio.camera.distance = 320.0;
          studio.camera.target = [0.0, 0.0, 0.0];

          // Supersample at 1600x1600 (800 CSS px * dpr 2) with exact orthographic [-halfW..+halfW, -halfH..+halfH] projection
          canvas3d.style.cssText =
            `position:fixed !important; left:0 !important; top:0 !important; ` +
            `width:${cropPx}px !important; height:${cropPx}px !important; ` +
            `max-width:none !important; max-height:none !important; z-index:999999 !important;`;

          if (typeof window.mat4Ortho === 'function') {
            window.mat4Perspective = () => window.mat4Ortho(-halfW, halfW, -halfH, halfH, 10.0, 700.0);
          }

          studio.render(true);

          const out3d = document.createElement('canvas');
          out3d.width = cropPx;
          out3d.height = cropPx;
          const octx = out3d.getContext('2d');
          octx.imageSmoothingEnabled = true;
          octx.imageSmoothingQuality = 'high';
          octx.drawImage(canvas3d, 0, 0, cropPx, cropPx);
          crop3dDataUrl = out3d.toDataURL('image/png');
        } finally {
          window.mat4Perspective = origMat4Perspective;
          if (origStyle) canvas3d.setAttribute('style', origStyle);
          else canvas3d.removeAttribute('style');
          studio.camera.yaw = origCam.yaw;
          studio.camera.pitch = origCam.pitch;
          studio.camera.distance = origCam.distance;
          studio.camera.target = origCam.target;
          state.showFrame = origShowFrame;
          state.autoRotate = origAutoRotate;
          state.explodeFactor = origExplode;
          state.tileExplode = origTileExplode;
          state.exportTileFilter = origTileFilter;
          state.hoveredBuildingId = origHovered;
          state.userClickedBuilding = origClicked;
          studio.render(true);
        }

        // Summarize sceneData features
        const roadsByHwy = {};
        const bridgeRoadsByHwy = {};
        const bridgeRoadNames = [];
        let footpathCount = 0;
        let bridgeRoadCount = 0;
        for (const r of sc.roads || []) {
          const h = r.hwy || 'unknown';
          roadsByHwy[h] = (roadsByHwy[h] || 0) + 1;
          if (r.isPath) footpathCount++;
          if (r.bridge) {
            bridgeRoadCount++;
            bridgeRoadsByHwy[h] = (bridgeRoadsByHwy[h] || 0) + 1;
            if (r.name && !bridgeRoadNames.includes(r.name) && bridgeRoadNames.length < 25) {
              bridgeRoadNames.push(r.name);
            }
          }
        }

        const greenByType = {};
        let greenHolesCount = 0;
        for (const gp of sc.greenPolys || []) {
          const gt = gp.type || 'park';
          greenByType[gt] = (greenByType[gt] || 0) + 1;
          greenHolesCount += (gp.holes || []).length;
        }

        let waterPolyHolesCount = 0;
        const waterPolySummaries = [];
        for (const wp of sc.waterPolys || []) {
          const hc = (wp.holes || []).length;
          waterPolyHolesCount += hc;
          if (waterPolySummaries.length < 25) {
            waterPolySummaries.push({
              name: wp.name || 'Woda',
              outerVertices: (wp.outer || []).length,
              holesCount: hc,
            });
          }
        }

        const waterLinesSummary = (sc.waterLines || []).slice(0, 30).map((wl) => ({
          name: wl.name || '',
          widthUnits: wl.width,
          widthMetersApprox: Math.round((wl.width / mToU) * 100) / 100,
          ptsCount: (wl.pts || []).length,
        }));

        const blds = sc.buildings || [];
        let bldPartsCount = 0;
        let bldWithHolesCount = 0;
        let bldLandmarksCount = 0;
        for (const b of blds) {
          if (b.part) bldPartsCount++;
          if (b.holes && b.holes.length > 0) bldWithHolesCount++;
          if (b.landmark || b.church) bldLandmarksCount++;
        }

        const layerMeshes = state.layerMeshes || {};
        const trianglesByLayer = {};
        for (const k of ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted', 'frame']) {
          trianglesByLayer[k] = Array.isArray(layerMeshes[k]) ? layerMeshes[k].length : 0;
        }

        return {
          crop3dDataUrl,
          geometry: {
            center: sc.center,
            rotDeg,
            bounds: exactBounds.map((v) => Math.round(v * 1e6) / 1e6),
            fetchBbox: Array.isArray(sc.bbox) ? sc.bbox.map((v) => Math.round(v * 1e6) / 1e6) : null,
            cornersLatLon: {
              NW: cornerNW,
              NE: cornerNE,
              SE: cornerSE,
              SW: cornerSW,
            },
            plateWidthMeters: Math.round(plateWidthMeters * 100) / 100,
            plateHeightMeters: Math.round(plateHeightMeters * 100) / 100,
            metersToUnits: mToU,
            halfW,
            halfH,
            effectiveCrop,
          },
          sceneStats: {
            buildings: {
              total: blds.length,
              parts: bldPartsCount,
              withCourtyardHoles: bldWithHolesCount,
              landmarksOrChurches: bldLandmarksCount,
            },
            roads: {
              totalWays: (sc.roads || []).length,
              byHighwayType: roadsByHwy,
              footpathsCount: footpathCount,
              roadPolygonsCount: (sc.roadPolys || []).length,
            },
            bridges: {
              roadBridgeWaysCount: bridgeRoadCount,
              roadBridgesByHighwayType: bridgeRoadsByHwy,
              roadBridgeNames: bridgeRoadNames,
              manMadeBridgePolygonsCount: (sc.bridgePolys || []).length,
              manMadeBridgePolygonNames: (sc.bridgePolys || []).slice(0, 20).map((bp) => bp.name || 'Most'),
            },
            water: {
              waterPolygonsCount: (sc.waterPolys || []).length,
              waterPolygonHolesIslandsCount: waterPolyHolesCount,
              waterPolygonsSample: waterPolySummaries,
              waterLinesCount: (sc.waterLines || []).length,
              waterLinesSample: waterLinesSummary,
            },
            greeneryAndTrees: {
              greenPolygonsCount: (sc.greenPolys || []).length,
              greenPolygonsByType: greenByType,
              greenPolygonHolesCount: greenHolesCount,
              treesCount: (sc.trees || []).length,
            },
            dem: sc.dem
              ? {
                  gridSize: sc.dem.gridSize,
                  minElevM: sc.dem.minElev,
                  maxElevM: sc.dem.maxElev,
                  elevDeltaM: Math.round((sc.dem.maxElev - sc.dem.minElev) * 100) / 100,
                  zoom: sc.dem.zoom || sc._chunkStats?.demZoom || null,
                }
              : null,
            chunkStats: sc._chunkStats || null,
          },
          meshTriangles: {
            totalTriangles: state.totalTriangles,
            byLayer: trianglesByLayer,
          },
          activePalette: state.activePalette,
          activeColors: state.colors,
        };
      },
      { cropPx: CROP_SIZE_PX }
    );

    // Fetch standard OpenStreetMap raster tiles in Node with polite User-Agent & concurrency <= 4
    const geom = captureResult.geometry;
    const [south, west, north, east] = geom.bounds;
    const osmZoom = chooseOsmZoom(
      geom.center[0],
      Math.max(geom.plateWidthMeters, geom.plateHeightMeters)
    );

    const tMinX = Math.floor(lon2tileF(west, osmZoom));
    const tMaxX = Math.floor(lon2tileF(east, osmZoom));
    const tMinY = Math.floor(lat2tileF(north, osmZoom));
    const tMaxY = Math.floor(lat2tileF(south, osmZoom));

    console.log(
      `[compare_1to1_crop] Fetching OSM tiles z=${osmZoom} x=${tMinX}..${tMaxX} y=${tMinY}..${tMaxY} (${
        (tMaxX - tMinX + 1) * (tMaxY - tMinY + 1)
      } tiles)...`
    );
    const tileEntries = await fetchOsmTileGrid(osmZoom, tMinX, tMaxX, tMinY, tMaxY, tileCacheDir);

    // Composite exact 1:1 OSM crop (800x800) & side-by-side pair (1612x800) inside Playwright
    const { osmDataUrl, pairDataUrl } = await page.evaluate(
      async ({
        cropPx,
        dividerPx,
        z,
        tMinX,
        tMaxX,
        tMinY,
        tMaxY,
        cornersLatLon,
        tileEntries,
        crop3dDataUrl,
      }) => {
        function lon2t(lon, zoom) {
          return ((lon + 180.0) / 360.0) * Math.pow(2, zoom);
        }
        function lat2t(lat, zoom) {
          const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
          const rad = (clamped * Math.PI) / 180.0;
          return ((1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0) * Math.pow(2, zoom);
        }
        function loadImg(src) {
          return new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('Failed decoding image dataUrl'));
            im.src = src;
          });
        }

        const mosaicW = (tMaxX - tMinX + 1) * 256;
        const mosaicH = (tMaxY - tMinY + 1) * 256;
        const mosaic = document.createElement('canvas');
        mosaic.width = mosaicW;
        mosaic.height = mosaicH;
        const mctx = mosaic.getContext('2d');
        mctx.fillStyle = '#f2efe9';
        mctx.fillRect(0, 0, mosaicW, mosaicH);

        for (const item of tileEntries) {
          const im = await loadImg(item.dataUrl);
          mctx.drawImage(im, (item.tx - tMinX) * 256, (item.ty - tMinY) * 256, 256, 256);
        }

        const toMosaicPt = ([lat, lon]) => [
          (lon2t(lon, z) - tMinX) * 256.0,
          (lat2t(lat, z) - tMinY) * 256.0,
        ];

        const pNW = toMosaicPt(cornersLatLon.NW);
        const pNE = toMosaicPt(cornersLatLon.NE);
        const pSW = toMosaicPt(cornersLatLon.SW);

        // Forward affine map from output (u, v) in [0..cropPx]^2 to mosaic (mx, my):
        //   mx = a*u + c*v + e
        //   my = b*u + d*v + f
        const a = (pNE[0] - pNW[0]) / cropPx;
        const b = (pNE[1] - pNW[1]) / cropPx;
        const c = (pSW[0] - pNW[0]) / cropPx;
        const d = (pSW[1] - pNW[1]) / cropPx;
        const e = pNW[0];
        const f = pNW[1];
        const det = a * d - b * c;

        const osmCanvas = document.createElement('canvas');
        osmCanvas.width = cropPx;
        osmCanvas.height = cropPx;
        const octx = osmCanvas.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';

        // Invert 2x3 affine matrix so mosaic draws directly onto [0..cropPx]^2
        const invA = d / det;
        const invB = -b / det;
        const invC = -c / det;
        const invD = a / det;
        const invE = (c * f - d * e) / det;
        const invF = (b * e - a * f) / det;

        octx.save();
        octx.setTransform(invA, invB, invC, invD, invE, invF);
        octx.drawImage(mosaic, 0, 0);
        octx.restore();

        const img3d = await loadImg(crop3dDataUrl);
        const pairCanvas = document.createElement('canvas');
        pairCanvas.width = cropPx * 2 + dividerPx;
        pairCanvas.height = cropPx;
        const pctx = pairCanvas.getContext('2d');
        pctx.fillStyle = '#0f172a';
        pctx.fillRect(0, 0, pairCanvas.width, pairCanvas.height);
        pctx.drawImage(osmCanvas, 0, 0, cropPx, cropPx);
        pctx.drawImage(img3d, cropPx + dividerPx, 0, cropPx, cropPx);

        return {
          osmDataUrl: osmCanvas.toDataURL('image/png'),
          pairDataUrl: pairCanvas.toDataURL('image/png'),
        };
      },
      {
        cropPx: CROP_SIZE_PX,
        dividerPx: DIVIDER_PX,
        z: osmZoom,
        tMinX,
        tMaxX,
        tMinY,
        tMaxY,
        cornersLatLon: geom.cornersLatLon,
        tileEntries,
        crop3dDataUrl: captureResult.crop3dDataUrl,
      }
    );

    const path3d = path.join(opts.out, `${opts.name}_3d.png`);
    const pathOsm = path.join(opts.out, `${opts.name}_osm.png`);
    const pathPair = path.join(opts.out, `${opts.name}_pair.png`);
    const pathMeta = path.join(opts.out, `${opts.name}_meta.json`);

    fs.writeFileSync(path3d, dataUrlToBuffer(captureResult.crop3dDataUrl));
    fs.writeFileSync(pathOsm, dataUrlToBuffer(osmDataUrl));
    fs.writeFileSync(pathPair, dataUrlToBuffer(pairDataUrl));

    const rawOsmSummary = summarizeRawOsmElements(rawOsmElements);
    const meta = {
      name: opts.name,
      generatedAt: new Date().toISOString(),
      input: {
        lat: opts.lat,
        lon: opts.lon,
        spanKm: opts.span,
        rotDeg: opts.rot,
      },
      bounds: geom.bounds,
      fetchBbox: geom.fetchBbox,
      center: geom.center,
      spanKm: opts.span,
      plateMeters: {
        width: geom.plateWidthMeters,
        height: geom.plateHeightMeters,
      },
      osmRaster: {
        zoom: osmZoom,
        tilesCount: tileEntries.length,
        tileRange: { x: [tMinX, tMaxX], y: [tMinY, tMaxY] },
      },
      palette: {
        id: captureResult.activePalette,
        colors: captureResult.activeColors,
      },
      sceneData: captureResult.sceneStats,
      rawOsmDiagnostics: rawOsmSummary,
      meshTriangles: captureResult.meshTriangles,
      files: {
        crop3d: path3d,
        cropOsm: pathOsm,
        pair: pathPair,
        meta: pathMeta,
      },
    };

    fs.writeFileSync(pathMeta, JSON.stringify(meta, null, 2) + '\n', 'utf-8');

    console.log(
      JSON.stringify(
        {
          ok: true,
          name: opts.name,
          bounds: meta.bounds,
          osmZoom,
          totalTriangles: meta.meshTriangles.totalTriangles,
          buildings: meta.sceneData.buildings.total,
          roads: meta.sceneData.roads.totalWays,
          bridges:
            meta.sceneData.bridges.roadBridgeWaysCount +
            meta.sceneData.bridges.manMadeBridgePolygonsCount,
          waterPolys: meta.sceneData.water.waterPolygonsCount,
          waterLines: meta.sceneData.water.waterLinesCount,
          undergroundWaterwaysInRawOsm: rawOsmSummary.waterwaysWithTunnelCulvertOrCoveredCount,
          trees: meta.sceneData.greeneryAndTrees.treesCount,
          pair: pathPair,
          meta: pathMeta,
        },
        null,
        2
      )
    );

    await context.close();
  } finally {
    await browser.close();
    httpsAgent.destroy();
  }
}

main().catch((err) => {
  console.error('[compare_1to1_crop] ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
