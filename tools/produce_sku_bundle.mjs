#!/usr/bin/env node
'use strict';

/**
 * Canonical single-command SKU production orchestrator.
 *
 * Runs:
 *   1) Deterministic STL export + assembly_manifest.json + VAL-01..14 PASS gate
 *   2) Gate 3 Seam-Truth QA renders (full mode)
 *   3) Packshot renders (preview: 2 presets, full: 4 presets)
 *   4) 3x3 Chalk Detail Gallery renders (9 cells + details_3x3_grid.png)
 *   5) production_bundle_report.json with metrics, PNG paths, and QA checklist
 *
 * Pure ASCII module with strict JSDoc types.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { handleAuditSceneFidelity, handleExportMap3DStl, handleRenderMap3DView } from './mcp_map3d_inspector.mjs';
import { exportCitySku, loadCityCatalog, resolveCityFormatOverrides } from './export_city_sku.mjs';

const require = createRequire(import.meta.url);
const formatCatalogMod = require('../src/geometry/format_catalog.js');

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const RENDER_STUDIO_PATH = path.join(ROOT, 'studio_blender', 'render_studio.py');
const VALIDATE_ASSEMBLY_PATH = path.join(ROOT, 'calibration', 'validate_assembly.py');

/** @type {Record<string, string>} */
export const FORMAT_ALIAS_MAP = {
  single: 'single_a4_1x3',
  landscape: 'single_a4_landscape_3x1',
  triptych: 'triptych_a4_3x1',
  quartet: 'quartet_a4_2x2',
  square: 'square_150_2x2',
  square240: 'square_240_2x4',
  '50x70': 'flagship_50x70_3x9',
  custom: 'custom_grid',
};

/**
 * Resolves a friendly alias or catalog format ID into a canonical format_id.
 * @param {string|null|undefined} rawFormat
 * @returns {string}
 */
export function resolveBundleFormatId(rawFormat) {
  const clean = String(rawFormat || '').trim();
  if (!clean) return 'single_a4_1x3';
  const low = clean.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(FORMAT_ALIAS_MAP, low)) {
    return FORMAT_ALIAS_MAP[low];
  }
  if (formatCatalogMod && typeof formatCatalogMod.resolveFormatSpec === 'function') {
    const spec = formatCatalogMod.resolveFormatSpec(clean) || formatCatalogMod.resolveFormatSpec(low);
    if (spec && spec.format_id) return spec.format_id;
  }
  throw new Error(
    `Unknown format "${rawFormat}". Expected one of: single, landscape, triptych, quartet, square, square240, 50x70, custom, ` +
    'or exact catalog format_id.'
  );
}

/**
 * Prints CLI usage documentation to stdout.
 */
export function printProduceHelp() {
  const help = `
Map-to-3DPrint Canonical SKU Production Orchestrator

Usage:
  node tools/produce_sku_bundle.mjs --city <catalog_slug> [options]
  node tools/produce_sku_bundle.mjs --slug <slug> --title <title> --lat <deg> --lon <deg> --span <m> [options]

City / Coordinate Inputs:
  --city <slug>             Catalog slug from config/city_catalog.json
  --slug <slug>             Custom city slug (for custom coordinates)
  --title <title>           Custom plaque/display title
  --lat <deg>               Center latitude in decimal degrees
  --lon <deg>               Center longitude in decimal degrees
  --span <m>                Map span in meters
  --rot <deg>               Map rotation in degrees (default: 0)
  --z-scale <n>             Building Z multiplier (default: 1.0)
  --terrain-scale <n>       Terrain Z multiplier (default: 1.0)
  --dem-mode <mode>         flat | terrarium (default: terrarium online, flat offline)
  --water-cutout <bool>     true | false (default: true)

Format & Grid Options:
  --format <id>             single | landscape | triptych | quartet | square | square240 | 50x70 | custom
                            or exact catalog format_id (default: single_a4_1x3)
  --width-cm <cm>           Custom width in cm (for custom_grid)
  --height-cm <cm>          Custom height in cm (for custom_grid)
  --tile-cols <n>           Explicit tile columns (auto-tiled for Mono 4 if omitted)
  --tile-rows <n>           Explicit tile rows (auto-tiled for Mono 4 if omitted)
  --inter-frame-gap-mm <mm> Gap between multi-frame panels in mm (default: 0.0)

Pipeline & Render Options:
  --mode <scout|preview|full>
                            scout: fast software top-down + overview PNGs in <out>/renders/scout/ +
                            audit-scene + metric meterWidth x meterHeight coverage (seconds, before STL CSG)
                            preview: export + VAL-01..14 + 2 packshots + 3x3 chalk grid (24 samples)
                            full: export + VAL-01..14 + Gate 3 QA + 4 packshots + 3x3 chalk grid (default: full)
  --out-dir <dir>           Output directory (default: exports/<slug>_<formatId>)
  --samples <n>             Cycles samples (default: 24 for preview, 48 for full)
  --qa-samples <n>          Cycles samples for Gate 3 QA stills (default: min(24, samples))
  --skip-export             Reuse existing validated assembly_manifest.json in --out-dir
                            (standalone: --out-dir + --skip-export reads slug/title/format from manifest)
  --snapshot <path>         Explicit OSM snapshot JSON path
  --save-snapshot <path>    Save live-fetched OSM snapshot JSON path
  --dem-cache-dir <dir>     Local Terrarium DEM cache directory
  --blender-bin <path>      Explicit Blender executable path
  --offline                 Disallow remote OSM/Terrarium network fetches
  --quiet                   Reduce stderr progress logging
  --help, -h                Show this help message
`.trimStart();
  process.stdout.write(help);
}

/**
 * Parses a boolean CLI token supporting true/false/1/0/yes/no.
 * @param {string|boolean|undefined} val
 * @param {boolean} defaultVal
 * @returns {boolean}
 */
function parseBoolFlag(val, defaultVal) {
  if (val === undefined) return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'yes' || s === '') return true;
  throw new Error(`Invalid boolean flag value: "${val}"`);
}

/**
 * Parses argv into normalized orchestrator options.
 * @param {Array<string>} argv
 * @returns {object}
 */
export function parseProduceCliArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--help' || tok === '-h') {
      flags.help = true;
      continue;
    }
    if (!tok.startsWith('--')) continue;
    const eqIdx = tok.indexOf('=');
    let key;
    let val;
    if (eqIdx >= 0) {
      key = tok.slice(2, eqIdx);
      val = tok.slice(eqIdx + 1);
    } else {
      key = tok.slice(2);
      if (key.startsWith('no-')) {
        flags[key.slice(3)] = false;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        val = next;
        i++;
      } else {
        val = true;
      }
    }
    flags[key] = val;
  }

  const num = (k) => (flags[k] !== undefined && flags[k] !== true && flags[k] !== false)
    ? Number(flags[k])
    : undefined;

  const mode = String(flags.mode || 'full').trim().toLowerCase();
  if (mode !== 'scout' && mode !== 'preview' && mode !== 'full') {
    throw new Error(`Invalid --mode "${flags.mode}". Must be "scout", "preview", or "full".`);
  }
  const formatExplicit = Boolean(flags.format);
  const formatId = resolveBundleFormatId(flags.format || 'single_a4_1x3');
  const defaultSamples = mode === 'preview' ? 24 : 48;
  const samples = num('samples') !== undefined ? Math.max(1, Math.round(num('samples'))) : defaultSamples;
  const qaSamples = num('qa-samples') !== undefined ? Math.max(1, Math.round(num('qa-samples'))) : Math.min(24, samples);

  return {
    help: Boolean(flags.help),
    city: flags.city ? String(flags.city).trim() : null,
    slug: flags.slug ? String(flags.slug).trim() : null,
    title: flags.title ? String(flags.title).trim() : null,
    lat: num('lat'),
    lon: num('lon'),
    span: num('span'),
    rot: num('rot'),
    zScale: num('z-scale'),
    terrainScale: num('terrain-scale'),
    demMode: flags['dem-mode'] ? String(flags['dem-mode']).trim() : undefined,
    waterCutout: parseBoolFlag(flags['water-cutout'], true),
    formatId,
    formatExplicit,
    widthCm: num('width-cm'),
    heightCm: num('height-cm'),
    tileCols: num('tile-cols'),
    tileRows: num('tile-rows'),
    interFrameGapMm: num('inter-frame-gap-mm'),
    outDir: flags['out-dir'] ? String(flags['out-dir']).trim() : null,
    samples,
    qaSamples,
    skipExport: Boolean(flags['skip-export']),
    mode,
    snapshotPath: flags.snapshot ? String(flags.snapshot).trim() : null,
    saveSnapshotPath: flags['save-snapshot'] ? String(flags['save-snapshot']).trim() : null,
    demCacheDir: flags['dem-cache-dir'] ? String(flags['dem-cache-dir']).trim() : null,
    blenderBin: flags['blender-bin'] ? String(flags['blender-bin']).trim() : null,
    offline: Boolean(flags.offline),
    quiet: Boolean(flags.quiet),
  };
}

/**
 * Runs calibration/validate_assembly.py and returns parsed validation_report.json.
 * Throws if validation exits non-zero or verdict is not PASS.
 * @param {string} manifestPath
 * @param {boolean} quiet
 * @returns {object}
 */
function ensureValidatedAssembly(manifestPath, quiet) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing assembly_manifest.json at ${manifestPath}`);
  }
  const dir = path.dirname(manifestPath);
  const reportPath = path.join(dir, 'validation_report.json');
  const args = [VALIDATE_ASSEMBLY_PATH, manifestPath];
  if (quiet) args.push('--quiet');
  const proc = spawnSync('python3', args, { cwd: ROOT, encoding: 'utf8' });
  if (proc.status !== 0 || !fs.existsSync(reportPath)) {
    const errText = (proc.stderr || proc.stdout || `exit code ${proc.status}`).trim();
    throw new Error(`VAL-01..14 validation failed for ${manifestPath}: ${errText}`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.verdict !== 'PASS' || (report.summary && report.summary.blocking_failures > 0)) {
    throw new Error(`VAL-01..14 verdict is ${report.verdict}: ${(report.failures || []).join(' | ')}`);
  }
  return { reportPath, report };
}

/**
 * Executes studio_blender/render_studio.py synchronously and parses its render_manifest.json.
 * Throws on non-zero exit code.
 * @param {Array<string>} cliArgs
 * @param {string} outDir
 * @param {string} label
 * @param {boolean} quiet
 * @returns {object}
 */
function runRenderStudio(cliArgs, outDir, label, quiet) {
  fs.mkdirSync(outDir, { recursive: true });
  if (!quiet) {
    process.stderr.write(`[produce_sku_bundle] Rendering ${label} -> ${outDir}\n`);
  }
  const proc = spawnSync('python3', [RENDER_STUDIO_PATH, ...cliArgs, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    const tail = ((proc.stderr || '') + '\n' + (proc.stdout || '')).trim().slice(-2000);
    throw new Error(`Blender studio render failed (${label}, exit=${proc.status}):\n${tail}`);
  }
  const manifestFile = path.join(outDir, 'render_manifest.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`Missing render_manifest.json after ${label} render at ${manifestFile}`);
  }
  return JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
}

/**
 * Builds the structured visual QA checklist for production_bundle_report.json.
 * @param {object} renders
 * @param {string} formatId
 * @returns {Array<object>}
 */
function buildVisualQaChecklist(renders, formatId) {
  const qaFiles = (renders.qa || []).map((r) => r.path);
  const packFiles = (renders.packshots || []).map((r) => r.path);
  const gridFile = renders.details_3x3 ? renders.details_3x3.grid_png : null;
  const detailCells = renders.details_3x3 ? renders.details_3x3.cells.map((r) => r.path) : [];
  return [
    {
      id: 'QA-01',
      check: 'Hero landmark fidelity vs real-world silhouette and spire profile',
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: [...packFiles, ...(gridFile ? [gridFile] : [])],
    },
    {
      id: 'QA-02',
      check: 'Seam continuity across tiles (zero step, offset, or double-wall)',
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: qaFiles,
    },
    {
      id: 'QA-03',
      check: 'Outer perimeter and seam borders (no half-cut buildings, trees, or facade slivers)',
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: [...qaFiles, ...packFiles],
    },
    {
      id: 'QA-04',
      check: 'Water cutouts, shorelines, islands, and bridge clearance arches',
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: [...packFiles, ...(gridFile ? [gridFile] : [])],
    },
    {
      id: 'QA-05',
      check: `Frame and backing presentation matches ${formatId}`,
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: packFiles,
    },
    {
      id: 'QA-06',
      check: 'Underside DFM-06 chamfer, 8 mm skirt, and continuous 45-deg relief grooves',
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: qaFiles,
    },
    {
      id: 'QA-07',
      check: '3x3 chalk detail gallery cells 01..09 framing (zero border/slab intrusion)',
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: [...(gridFile ? [gridFile] : []), ...detailCells],
    },
    {
      id: 'QA-08',
      check: 'Roofs, courtyards, and stepped towers free of collapsed walls or floating stubs',
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: [...(gridFile ? [gridFile] : []), ...detailCells],
    },
    {
      id: 'QA-09',
      check: 'Packshot lighting, framing, and commercial contrast',
      status: 'PENDING_VISUAL_INSPECTION',
      files_to_inspect: packFiles,
    },
  ];
}

/**
 * Computes whether a validation_report.json tile entry is strictly watertight.
 * @param {object|null} tr
 * @returns {boolean|null}
 */
export function isTileReportWatertight(tr) {
  if (!tr) return null;
  const topo = tr.topo || null;
  return Boolean(
    tr.verdict === 'PASS' &&
    topo &&
    topo.open_edges === 0 &&
    topo.non_manifold_edges === 0 &&
    topo.degen === 0 &&
    topo.nan_inf === 0 &&
    (topo.bad_half_edges === undefined || topo.bad_half_edges === 0) &&
    (topo.non_manifold_verts === undefined || topo.non_manifold_verts === 0)
  );
}

/**
 * Resolves city snapshot path if cached under cache/osm_snapshots/.
 * @param {string} slug
 * @param {string|null} explicitSnapshot
 * @returns {string|null}
 */
function resolveCitySnapshotIfPresent(slug, explicitSnapshot) {
  if (explicitSnapshot) return path.resolve(explicitSnapshot);
  const p = path.join(ROOT, 'cache', 'osm_snapshots', `${slug}.json`);
  return fs.existsSync(p) ? p : null;
}

/**
 * Resolves automatic OSM snapshot cache paths for uncataloged custom-coordinate runs.
 * Stores snapshots under gitignored cache/osm_snapshots/ rather than inside --out-dir.
 * @param {{city?: string|null, slug: string, formatId: string, snapshotPath?: string|null, saveSnapshotPath?: string|null, cacheDir?: string}} params
 * @returns {{snapshotPath: string|null, saveSnapshotPath: string|null, autoCachePath: string|null}}
 */
export function resolveAutoCustomSnapshotPaths({
  city = null,
  slug,
  formatId,
  snapshotPath = null,
  saveSnapshotPath = null,
  cacheDir = path.join(ROOT, 'cache', 'osm_snapshots'),
}) {
  if (city) {
    return {
      snapshotPath: snapshotPath ? path.resolve(snapshotPath) : null,
      saveSnapshotPath: saveSnapshotPath ? path.resolve(saveSnapshotPath) : null,
      autoCachePath: null,
    };
  }
  if (snapshotPath) {
    return {
      snapshotPath: path.resolve(snapshotPath),
      saveSnapshotPath: saveSnapshotPath ? path.resolve(saveSnapshotPath) : null,
      autoCachePath: null,
    };
  }
  const safeSlug = String(slug || 'custom').replace(/[^A-Za-z0-9_-]+/g, '_');
  const safeFmt = String(formatId || 'single_a4_1x3').replace(/[^A-Za-z0-9_-]+/g, '_');
  const autoCachePath = path.join(path.resolve(cacheDir), `${safeSlug}_${safeFmt}_auto.json`);
  return {
    snapshotPath: fs.existsSync(autoCachePath) ? autoCachePath : null,
    saveSnapshotPath: saveSnapshotPath ? path.resolve(saveSnapshotPath) : autoCachePath,
    autoCachePath,
  };
}

/**
 * Runs fast software scout mode (top-down + overview renders + audit-scene + metric coverage).
 * @param {object} params
 * @returns {Promise<object>}
 */
async function runScoutMode({ opts, slug, title, formatId, catalogEntry, outDir }) {
  const scoutDir = path.join(outDir, 'renders', 'scout');
  fs.mkdirSync(scoutDir, { recursive: true });

  const buildSceneArgs = () => {
    if (opts.city && catalogEntry) {
      const resolvedCity = resolveCityFormatOverrides(catalogEntry, formatId, opts.span, outDir);
      const catalog = loadCityCatalog();
      const demCacheDir = opts.demCacheDir
        ? path.resolve(opts.demCacheDir)
        : path.join(ROOT, catalog.dem_cache_dir || 'cache/dem_terrarium');
      const snap = resolveCitySnapshotIfPresent(opts.city, opts.snapshotPath);
      return {
        citySlug: catalogEntry.city_slug,
        formatId: resolvedCity.formatId,
        lat: catalogEntry.lat,
        lon: catalogEntry.lon,
        spanMeters: resolvedCity.spanMeters,
        rotationDeg: catalogEntry.rotation_deg,
        zScale: catalogEntry.z_scale,
        terrainScale: catalogEntry.terrain_scale,
        waterCutout: catalogEntry.water_cutout !== false,
        demMode: catalogEntry.dem_mode || 'flat',
        demCacheDir,
        title: opts.title || catalogEntry.title,
        showFrame: false,
        offlineOnly: Boolean(opts.offline),
        ...(snap ? { snapshotPath: snap } : {}),
      };
    }
    const autoSnap = resolveAutoCustomSnapshotPaths({
      city: null,
      slug,
      formatId,
      snapshotPath: opts.snapshotPath,
      saveSnapshotPath: opts.saveSnapshotPath,
    });
    return {
      citySlug: slug,
      title,
      formatId,
      lat: opts.lat,
      lon: opts.lon,
      spanMeters: opts.span,
      rotationDeg: opts.rot ?? 0,
      zScale: opts.zScale ?? 1.0,
      terrainScale: opts.terrainScale ?? 1.0,
      demMode: opts.demMode,
      demCacheDir: opts.demCacheDir || path.join(ROOT, 'cache', 'dem_terrarium'),
      waterCutout: opts.waterCutout !== false,
      targetWidthCm: opts.widthCm,
      targetHeightCm: opts.heightCm,
      tileCols: opts.tileCols,
      tileRows: opts.tileRows,
      interFrameGapMm: opts.interFrameGapMm,
      snapshotPath: autoSnap.snapshotPath,
      saveSnapshotPath: autoSnap.saveSnapshotPath,
      offlineOnly: Boolean(opts.offline),
      showFrame: false,
    };
  };

  const topOutPath = path.join(scoutDir, 'scout_top_down.png');
  const overviewOutPath = path.join(scoutDir, 'scout_overview.png');
  const auditJsonPath = path.join(scoutDir, 'audit_scene.json');

  const topArgs = buildSceneArgs();
  const topRes = await handleRenderMap3DView({
    ...topArgs,
    camera: { preset: 'top' },
    width: 1000,
    height: 1000,
    ssaa: 1,
    outputPath: topOutPath,
  }, { silent: opts.quiet });

  const overviewArgs = buildSceneArgs();
  const overviewRes = await handleRenderMap3DView({
    ...overviewArgs,
    camera: { preset: 'overview' },
    width: 1200,
    height: 900,
    ssaa: 1,
    outputPath: overviewOutPath,
  }, { silent: opts.quiet });

  const auditArgs = buildSceneArgs();
  const auditRes = await handleAuditSceneFidelity({
    ...auditArgs,
    outputJsonPath: auditJsonPath,
  }, { silent: opts.quiet });

  const meterWidth = auditRes.meta ? auditRes.meta.meterWidth : topRes.meta.meterWidth;
  const meterHeight = auditRes.meta ? auditRes.meta.meterHeight : topRes.meta.meterHeight;
  if (!opts.quiet) {
    process.stderr.write(
      `[produce_sku_bundle:scout] ${slug} (${formatId}) ground coverage: ${meterWidth}m x ${meterHeight}m ` +
      `(span=${auditArgs.spanMeters}m, rot=${auditArgs.rotationDeg ?? 0}deg, ` +
      `floating=${auditRes.manifoldSummary ? auditRes.manifoldSummary.floatingBuildingsCount : 0})\n`
    );
  }

  const scoutReport = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: 'scout',
    slug,
    title,
    format_id: formatId,
    output_dir: outDir,
    span_m: auditArgs.spanMeters,
    rotation_deg: auditArgs.rotationDeg ?? 0,
    meterWidth,
    meterHeight,
    coverage_str: `${meterWidth}m x ${meterHeight}m`,
    meta: auditRes.meta || topRes.meta,
    manifoldSummary: auditRes.manifoldSummary || null,
    floatingBuildingIds: auditRes.floatingBuildingIds || [],
    renders: {
      top_down_png: topRes.outputPath,
      overview_png: overviewRes.outputPath,
      audit_json_path: auditJsonPath,
    },
  };
  const scoutReportPath = path.join(scoutDir, 'scout_report.json');
  fs.writeFileSync(scoutReportPath, JSON.stringify(scoutReport, null, 2));
  return { scoutReportPath, ...scoutReport };
}

/**
 * Resolves target slug, title, formatId, catalogEntry, and outDir from CLI opts
 * (supporting standalone --skip-export --out-dir via assembly_manifest.json).
 * @param {object} opts
 * @returns {{slug: string, title: string, formatId: string, catalogEntry: (object|null), outDir: string}}
 */
export function resolveProduceBundleTarget(opts) {
  let formatId = resolveBundleFormatId(opts.formatId || 'single_a4_1x3');
  let slug = opts.slug || null;
  let title = opts.title || null;
  let catalogEntry = null;
  let outDir = opts.outDir ? path.resolve(opts.outDir) : null;

  if (opts.skipExport && outDir && !opts.city && (!slug || !title || !Number.isFinite(opts.lat))) {
    const manifestCandidate = path.join(outDir, 'assembly_manifest.json');
    if (!fs.existsSync(manifestCandidate)) {
      throw new Error(`--skip-export requires an existing assembly_manifest.json at ${manifestCandidate}`);
    }
    const existingManifest = JSON.parse(fs.readFileSync(manifestCandidate, 'utf8'));
    const sp = existingManifest.source_params || {};
    slug = slug || existingManifest.city_slug || path.basename(outDir);
    title = title || sp.title || String(slug).toUpperCase();
    if (!opts.formatExplicit) {
      const manifestFmt = existingManifest.format_id || existingManifest.sku_id;
      if (manifestFmt) formatId = resolveBundleFormatId(manifestFmt);
    }
  } else if (opts.city) {
    const catalog = loadCityCatalog();
    catalogEntry = catalog.cities && catalog.cities[opts.city];
    if (!catalogEntry) {
      const valid = Object.keys(catalog.cities || {}).join(', ');
      throw new Error(`Unknown city slug "${opts.city}". Valid slugs: ${valid}`);
    }
    slug = catalogEntry.city_slug;
    title = opts.title || catalogEntry.title;
  } else {
    if (!slug || !title || !Number.isFinite(opts.lat) || !Number.isFinite(opts.lon) || !Number.isFinite(opts.span)) {
      throw new Error(
        'Either --city <slug>, custom coordinates (--slug, --title, --lat, --lon, --span), ' +
        'or --skip-export --out-dir <existing_export_dir> are required.'
      );
    }
  }

  if (!outDir) {
    outDir = path.join(ROOT, 'exports', `${slug}_${formatId}`);
  }
  return { slug, title, formatId, catalogEntry, outDir };
}

/**
 * Builds per-tile report metrics combining assembly_manifest.json and validation_report.json.
 * @param {object} asmManifest
 * @param {object} valReport
 * @returns {Array<object>}
 */
export function buildBundleTileMetrics(asmManifest, valReport) {
  return (asmManifest.tiles || []).map((t) => {
    const tr = (valReport && valReport.tiles && valReport.tiles[t.tile_id]) || null;
    const tris = tr
      ? (Number.isFinite(tr.triangles) ? tr.triangles : (tr.topo && Number.isFinite(tr.topo.triangles) ? tr.topo.triangles : 0))
      : 0;
    return {
      tile_id: t.tile_id,
      frame_id: t.frame_id,
      file: t.file,
      skipped_empty_water: Boolean(t.skipped_empty_water),
      byte_length: t.byte_length || 0,
      sha256: t.sha256 || null,
      stl_rotation_deg: t.stl_rotation_deg || 0,
      span_mm: tr ? tr.span_mm : null,
      z_max_mm: tr && tr.span_mm ? tr.span_mm[2] : null,
      volume_mm3: tr ? tr.volume_mm3 : 0,
      triangles: tris,
      watertight: isTileReportWatertight(tr),
      shells: tr && Array.isArray(tr.shells) ? tr.shells.length : 0,
    };
  });
}

/**
 * Executes the complete SKU production pipeline and writes production_bundle_report.json.
 * @param {object} opts
 * @returns {Promise<object>}
 */
export async function runProduceSkuBundle(opts) {
  const { slug, title, formatId, catalogEntry, outDir } = resolveProduceBundleTarget(opts);
  fs.mkdirSync(outDir, { recursive: true });

  if (opts.mode === 'scout') {
    return runScoutMode({ opts, slug, title, formatId, catalogEntry, outDir });
  }

  // Step 1: Export STLs + assembly_manifest.json + automatic VAL-01..14 validation
  if (!opts.skipExport) {
    if (!opts.quiet) {
      process.stderr.write(`[produce_sku_bundle] Step 1: Exporting ${slug} (${formatId}) -> ${outDir}\n`);
    }
    if (opts.city) {
      const resolvedCity = resolveCityFormatOverrides(catalogEntry, formatId, opts.span, outDir);
      await exportCitySku(opts.city, {
        formatId: resolvedCity.formatId,
        spanMeters: resolvedCity.spanMeters,
        outputDir: outDir,
        snapshotPath: opts.snapshotPath,
        demCacheDir: opts.demCacheDir,
        offlineOnly: opts.offline,
        silent: opts.quiet,
      });
    } else {
      const prefix = `Map3D_${String(title).replace(/[^A-Za-z0-9_-]+/g, '_')}`;
      const autoSnap = resolveAutoCustomSnapshotPaths({
        city: null,
        slug,
        formatId,
        snapshotPath: opts.snapshotPath,
        saveSnapshotPath: opts.saveSnapshotPath,
      });
      await handleExportMap3DStl({
        citySlug: slug,
        title,
        filePrefix: prefix,
        formatId,
        lat: opts.lat,
        lon: opts.lon,
        spanMeters: opts.span,
        rotationDeg: opts.rot ?? 0,
        zScale: opts.zScale ?? 1.0,
        terrainScale: opts.terrainScale ?? 1.0,
        demMode: opts.demMode,
        demCacheDir: opts.demCacheDir || path.join(ROOT, 'cache', 'dem_terrarium'),
        waterCutout: opts.waterCutout !== false,
        targetWidthCm: opts.widthCm,
        targetHeightCm: opts.heightCm,
        tileCols: opts.tileCols,
        tileRows: opts.tileRows,
        interFrameGapMm: opts.interFrameGapMm,
        snapshotPath: autoSnap.snapshotPath,
        saveSnapshotPath: autoSnap.saveSnapshotPath,
        offlineOnly: opts.offline,
        outputDir: outDir,
        showFrame: false,
      }, { silent: opts.quiet });
    }
  }

  const manifestPath = path.join(outDir, 'assembly_manifest.json');
  const { reportPath: valReportPath, report: valReport } = ensureValidatedAssembly(manifestPath, opts.quiet);
  const asmManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const commonBlenderFlags = [];
  if (opts.blenderBin) commonBlenderFlags.push('--blender-bin', opts.blenderBin);

  // Step 2: Gate 3 Seam-Truth QA (unless mode === 'preview')
  const qaRenders = [];
  if (opts.mode !== 'preview') {
    const qaOutDir = path.join(outDir, 'renders', 'qa');
    const qaManifest = runRenderStudio([
      '--manifest', manifestPath,
      '--env', '11_packshot_white',
      '--frame', 'none',
      '--preset', 'qa_seam_raking',
      '--preset', 'qa_top_down_grid',
      '--preset', 'qa_underside',
      '--aspect', '1:1',
      '--samples', String(opts.qaSamples),
      '--out', qaOutDir,
      ...commonBlenderFlags,
    ], qaOutDir, 'Gate 3 Seam-Truth QA', opts.quiet);
    for (const st of (qaManifest.stills || [])) {
      if (st && st.path) {
        if (!fs.existsSync(st.path)) throw new Error(`Missing QA PNG: ${st.path}`);
        qaRenders.push({ preset: st.preset, path: st.path });
      }
    }
  }

  // Step 3: Packshots
  const packOutDir = path.join(outDir, 'renders', 'packshots');
  const packPresets = opts.mode === 'preview'
    ? ['--preset', 'packshot_iso', '--preset', 'top_down']
    : ['--preset', 'packshot_iso', '--preset', 'top_down', '--preset', 'profile_low', '--preset', 'macro_skyline'];
  const packManifest = runRenderStudio([
    '--manifest', manifestPath,
    '--env', '11_packshot_white',
    '--frame', 'auto',
    ...packPresets,
    '--samples', String(opts.samples),
    '--out', packOutDir,
    ...commonBlenderFlags,
  ], packOutDir, `Packshots (${opts.mode})`, opts.quiet);
  const packRenders = [];
  for (const st of (packManifest.stills || [])) {
    if (st && st.path) {
      if (!fs.existsSync(st.path)) throw new Error(`Missing packshot PNG: ${st.path}`);
      packRenders.push({ preset: st.preset, path: st.path });
    }
  }

  // Step 4: 3x3 Chalk Detail Gallery
  const detailsOutDir = path.join(outDir, 'renders', 'details_3x3');
  const detailsManifest = runRenderStudio([
    '--manifest', manifestPath,
    '--env', '18_detail_chalk_gallery',
    '--frame', 'none',
    '--preset', 'detail_grid_3x3',
    '--aspect', '1:1',
    '--samples', String(opts.samples),
    '--out', detailsOutDir,
    ...commonBlenderFlags,
  ], detailsOutDir, '3x3 Chalk Detail Gallery', opts.quiet);
  const detailCells = [];
  for (const st of (detailsManifest.stills || [])) {
    if (st && st.path) {
      if (!fs.existsSync(st.path)) throw new Error(`Missing detail cell PNG: ${st.path}`);
      detailCells.push({ preset: st.preset, path: st.path });
    }
  }
  const gridPng = detailsManifest.detail_grid_3x3_path || path.join(detailsOutDir, 'details_3x3_grid.png');
  if (detailCells.length < 9) {
    throw new Error(`Expected 9 detail cell PNGs from detail_grid_3x3, got ${detailCells.length}`);
  }
  if (!fs.existsSync(gridPng)) {
    throw new Error(`Missing 3x3 mosaic PNG: ${gridPng}`);
  }

  // Step 5: Write production_bundle_report.json
  const tileMetrics = buildBundleTileMetrics(asmManifest, valReport);

  const allPngs = [
    ...qaRenders.map((r) => r.path),
    ...packRenders.map((r) => r.path),
    ...detailCells.map((r) => r.path),
    gridPng,
  ];
  const renders = {
    qa: qaRenders,
    packshots: packRenders,
    details_3x3: {
      cells: detailCells,
      grid_png: gridPng,
    },
    all_pngs: allPngs,
  };

  const bundleReport = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    slug,
    title,
    format_id: asmManifest.format_id || formatId,
    mode: opts.mode,
    samples: opts.samples,
    qa_samples: opts.qaSamples,
    output_dir: outDir,
    manifest_path: manifestPath,
    validation_report_path: valReportPath,
    validation: {
      verdict: valReport.verdict,
      blocking_failures: valReport.summary ? valReport.summary.blocking_failures : 0,
      warnings: valReport.summary ? valReport.summary.warnings : 0,
      tiles_checked: valReport.summary ? valReport.summary.tiles_checked : tileMetrics.filter((t) => !t.skipped_empty_water).length,
      seam_pairs_checked: valReport.summary ? valReport.summary.seam_pairs_checked : 0,
      corners_4way_checked: valReport.summary ? valReport.summary.corners_4way_checked : 0,
      master_volume_mm3: valReport.summary ? valReport.summary.master_volume_mm3 : asmManifest.master_volume_mm3,
      sum_tile_volume_mm3: valReport.summary ? valReport.summary.sum_tile_volume_mm3 : null,
      volume_diff_pct: valReport.summary ? valReport.summary.volume_diff_pct : null,
      failures: valReport.failures || [],
    },
    tiles: tileMetrics,
    seams: valReport.seams || [],
    renders,
    visual_qa_checklist: buildVisualQaChecklist(renders, asmManifest.format_id || formatId),
  };

  const bundleReportPath = path.join(outDir, 'production_bundle_report.json');
  fs.writeFileSync(bundleReportPath, JSON.stringify(bundleReport, null, 2));
  return { bundleReportPath, ...bundleReport };
}

async function main() {
  const opts = parseProduceCliArgs(process.argv.slice(2));
  if (opts.help) {
    printProduceHelp();
    process.exit(0);
  }
  const result = await runProduceSkuBundle(opts);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    process.stderr.write(`[produce_sku_bundle:error] ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}
