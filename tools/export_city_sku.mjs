#!/usr/bin/env node
'use strict';

/**
 * Canonical zero-bypass SKU exporter (config/city_catalog.json -> binary STLs +
 * assembly_manifest.json + automatic VAL-01..14 validation_report.json).
 *
 * Usage:
 *   node tools/export_city_sku.mjs --city paris_true_scale
 *   node tools/export_city_sku.mjs --all-top10
 *   node tools/export_city_sku.mjs --coupon
 *   node tools/export_city_sku.mjs --city paris_true_scale --snapshot <path.json> --offline
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { handleExportMap3DStl, resolveFriendlyFormatId } from './mcp_map3d_inspector.mjs';

const require = createRequire(import.meta.url);
const formatCatalogMod = require('../src/geometry/format_catalog.js');

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const CATALOG_PATH = path.join(ROOT, 'config', 'city_catalog.json');

/**
 * Loads config/city_catalog.json from disk.
 * @returns {object}
 */
export function loadCityCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

/**
 * Parses CLI flags into a normalized options object.
 * @param {Array<string>} argv
 * @returns {{city: string|null, allTop10: boolean, coupon: boolean, format: string|null, span: number|undefined, baseHeightMm: number|undefined, undersideReliefEnabled: boolean|undefined, outDir: string|null, snapshot: string|null, snapshotDir: string|null, demCacheDir: string|null, offline: boolean, quiet: boolean}}
 */
function parseArgs(argv) {
  const opts = {
    city: null,
    allTop10: false,
    coupon: false,
    format: null,
    span: undefined,
    baseHeightMm: undefined,
    undersideReliefEnabled: undefined,
    outDir: null,
    snapshot: null,
    snapshotDir: null,
    demCacheDir: null,
    offline: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--city' && argv[i + 1]) opts.city = argv[++i];
    else if (a === '--all-top10') opts.allTop10 = true;
    else if (a === '--coupon') opts.coupon = true;
    else if (a === '--format' && argv[i + 1]) opts.format = argv[++i];
    else if (a === '--span' && argv[i + 1]) opts.span = Number(argv[++i]);
    else if (a === '--base-height-mm' && argv[i + 1]) opts.baseHeightMm = Number(argv[++i]);
    else if (a === '--no-underside-relief') opts.undersideReliefEnabled = false;
    else if (a === '--underside-relief') opts.undersideReliefEnabled = true;
    else if (a === '--out-dir' && argv[i + 1]) opts.outDir = argv[++i];
    else if (a === '--snapshot' && argv[i + 1]) opts.snapshot = argv[++i];
    else if (a === '--snapshot-dir' && argv[i + 1]) opts.snapshotDir = argv[++i];
    else if (a === '--dem-cache-dir' && argv[i + 1]) opts.demCacheDir = argv[++i];
    else if (a === '--offline') opts.offline = true;
    else if (a === '--quiet') opts.quiet = true;
  }
  return opts;
}

/**
 * Resolves an optional local OSM snapshot path for a city slug.
 * @param {string} slug
 * @param {string|null} explicitSnapshot
 * @param {string|null} snapshotDir
 * @returns {string|null}
 */
function resolveSnapshotPath(slug, explicitSnapshot, snapshotDir) {
  if (explicitSnapshot) {
    const abs = path.resolve(explicitSnapshot);
    if (!fs.existsSync(abs)) throw new Error(`Snapshot file not found: ${abs}`);
    return abs;
  }
  const searchDirs = [];
  if (snapshotDir) searchDirs.push(path.resolve(snapshotDir));
  searchDirs.push(path.join(ROOT, 'cache', 'osm_snapshots'));
  const candidates = [
    `${slug}.json`,
    `${slug}_snapshot.json`,
    `${slug}_osm_snapshot.json`,
  ];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of candidates) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Computes effective output directory and scaled span_m when --format overrides entry.format_id.
 * @param {object} entry
 * @param {string|null|undefined} requestedFormat
 * @param {number|undefined} explicitSpanM
 * @param {string|null|undefined} explicitOutDir
 * @returns {{formatId: string, formatOverridden: boolean, outDir: string, spanMeters: number}}
 */
export function resolveCityFormatOverrides(entry, requestedFormat, explicitSpanM, explicitOutDir) {
  const defaultFormatId = resolveFriendlyFormatId(entry.format_id || 'single_a4_1x3') || 'single_a4_1x3';
  const formatId = requestedFormat
    ? (resolveFriendlyFormatId(requestedFormat) || requestedFormat)
    : defaultFormatId;
  const formatOverridden = Boolean(requestedFormat && formatId !== defaultFormatId);
  const outDir = explicitOutDir
    ? path.resolve(explicitOutDir)
    : (formatOverridden
        ? path.join(ROOT, 'exports', `${entry.city_slug}_${formatId}`)
        : path.join(ROOT, entry.output_dir));

  let spanMeters = Number(entry.span_m);
  if (Number.isFinite(explicitSpanM) && explicitSpanM > 0) {
    spanMeters = Number(explicitSpanM);
  } else if (formatOverridden) {
    const fmtSpec = formatCatalogMod && typeof formatCatalogMod.resolveFormatSpec === 'function'
      ? formatCatalogMod.resolveFormatSpec(formatId)
      : null;
    const entryFmtSpec = formatCatalogMod && typeof formatCatalogMod.resolveFormatSpec === 'function'
      ? formatCatalogMod.resolveFormatSpec(defaultFormatId)
      : null;
    const isEntryA4 = Boolean(
      (entryFmtSpec && Math.max(Number(entryFmtSpec.window_mm[0]), Number(entryFmtSpec.window_mm[1])) === 170) ||
      defaultFormatId.includes('a4')
    );
    if (isEntryA4 && fmtSpec && Array.isArray(fmtSpec.window_mm) && fmtSpec.window_mm.length >= 2) {
      const fmtMaxMm = Math.max(Number(fmtSpec.window_mm[0]), Number(fmtSpec.window_mm[1]));
      if (Number.isFinite(fmtMaxMm) && fmtMaxMm > 0) {
        spanMeters = entry.span_m * (fmtMaxMm / 170.0);
      }
    }
  }
  return { formatId, formatOverridden, outDir, spanMeters };
}

/**
 * Exports and validates a single catalog city SKU. Throws on any VAL-01..14 failure.
 * @param {string} citySlug
 * @param {object} [overrides]
 * @returns {Promise<object>}
 */
export async function exportCitySku(citySlug, overrides = {}) {
  const catalog = loadCityCatalog();
  const entry = catalog.cities && catalog.cities[citySlug];
  if (!entry) {
    const valid = Object.keys(catalog.cities || {}).join(', ');
    throw new Error(`Unknown city slug "${citySlug}". Valid slugs: ${valid}`);
  }
  const demCacheDir = overrides.demCacheDir
    ? path.resolve(overrides.demCacheDir)
    : path.join(ROOT, catalog.dem_cache_dir || 'cache/dem_terrarium');
  const { formatId, outDir, spanMeters } = resolveCityFormatOverrides(
    entry,
    overrides.formatId,
    overrides.spanMeters,
    overrides.outputDir
  );
  const snapshotPath = resolveSnapshotPath(citySlug, overrides.snapshotPath || null, overrides.snapshotDir || null);

  const exportArgs = {
    citySlug: entry.city_slug,
    formatId,
    lat: entry.lat,
    lon: entry.lon,
    spanMeters,
    rotationDeg: entry.rotation_deg,
    zScale: entry.z_scale,
    terrainScale: entry.terrain_scale,
    waterCutout: entry.water_cutout !== false,
    demMode: entry.dem_mode || 'flat',
    demCacheDir,
    title: entry.title,
    filePrefix: entry.file_prefix,
    outputDir: outDir,
    showFrame: false,
    offlineOnly: Boolean(overrides.offlineOnly),
  };
  if (overrides.baseHeightMm !== undefined && Number.isFinite(Number(overrides.baseHeightMm))) {
    exportArgs.baseHeightMm = Number(overrides.baseHeightMm);
  }
  if (typeof overrides.undersideReliefEnabled === 'boolean') {
    exportArgs.undersideReliefEnabled = overrides.undersideReliefEnabled;
  }
  if (snapshotPath) {
    exportArgs.snapshotPath = snapshotPath;
  } else if (!overrides.offlineOnly) {
    exportArgs.saveSnapshotPath = path.join(ROOT, 'cache', 'osm_snapshots', `${citySlug}.json`);
  }
  if (Array.isArray(overrides.osmElements)) exportArgs.osmElements = overrides.osmElements;

  return handleExportMap3DStl(exportArgs, { silent: Boolean(overrides.silent) });
}

/**
 * Exports and validates the canonical Paris 80x50 mm 1x2 seam calibration coupon.
 * @param {object} [overrides]
 * @returns {Promise<object>}
 */
export async function exportParisSeamCoupon(overrides = {}) {
  const catalog = loadCityCatalog();
  const c = catalog.coupons && catalog.coupons.paris_seam_coupon;
  if (!c) throw new Error('Missing coupons.paris_seam_coupon in config/city_catalog.json');
  const { loadCachedParisOsmElements } = await import(path.join(ROOT, 'calibration', 'generate_seam_coupon_stl.mjs'));
  const osmElements = loadCachedParisOsmElements();
  const outDir = overrides.outputDir
    ? path.resolve(overrides.outputDir)
    : path.join(ROOT, c.output_dir);
  const demCacheDir = path.join(ROOT, catalog.dem_cache_dir || 'cache/dem_terrarium');

  return handleExportMap3DStl({
    osmElements,
    citySlug: c.city_slug,
    lat: c.lat,
    lon: c.lon,
    spanMeters: c.span_m,
    rotationDeg: c.rotation_deg,
    targetWidthCm: c.target_width_cm,
    targetHeightCm: c.target_height_cm,
    tileCols: c.tile_cols,
    tileRows: c.tile_rows,
    solidBaseNoTunnels: c.solid_base_no_tunnels !== false,
    baseHeightMm: (overrides.baseHeightMm !== undefined && Number.isFinite(Number(overrides.baseHeightMm)))
      ? Number(overrides.baseHeightMm)
      : c.base_height_mm,
    undersideReliefEnabled: typeof overrides.undersideReliefEnabled === 'boolean'
      ? overrides.undersideReliefEnabled
      : undefined,
    waterCutout: c.water_cutout !== false,
    kerfMm: c.kerf_mm,
    bedSafeMarginMm: c.bed_safe_margin_mm,
    zScale: c.z_scale,
    terrainScale: c.terrain_scale,
    demMode: c.dem_mode || 'flat',
    demCacheDir,
    showFrame: false,
    title: c.title,
    filePrefix: c.file_prefix,
    outputDir: outDir,
    offlineOnly: true,
  }, { silent: Boolean(overrides.silent) });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.city && !opts.allTop10 && !opts.coupon) {
    process.stderr.write(
      'Usage: node tools/export_city_sku.mjs --city <slug> | --all-top10 | --coupon [--format <id>] [--span <m>] [--base-height-mm <mm>] [--no-underside-relief|--underside-relief] [--out-dir <dir>] [--snapshot <file>] [--offline]\n'
    );
    process.exit(2);
  }
  const results = [];
  if (opts.allTop10) {
    const catalog = loadCityCatalog();
    const slugs = Object.keys(catalog.cities || {}).filter((k) => catalog.cities[k].top10);
    for (const slug of slugs) {
      if (!opts.quiet) process.stderr.write(`\n[export_city_sku] Exporting ${slug}...\n`);
      const res = await exportCitySku(slug, {
        formatId: opts.format,
        spanMeters: opts.span,
        baseHeightMm: opts.baseHeightMm,
        undersideReliefEnabled: opts.undersideReliefEnabled,
        snapshotDir: opts.snapshotDir,
        demCacheDir: opts.demCacheDir,
        offlineOnly: opts.offline,
        silent: opts.quiet,
      });
      results.push({ slug, ...res });
    }
  }
  if (opts.city) {
    const res = await exportCitySku(opts.city, {
      formatId: opts.format,
      spanMeters: opts.span,
      baseHeightMm: opts.baseHeightMm,
      undersideReliefEnabled: opts.undersideReliefEnabled,
      outputDir: opts.outDir,
      snapshotPath: opts.snapshot,
      snapshotDir: opts.snapshotDir,
      demCacheDir: opts.demCacheDir,
      offlineOnly: opts.offline,
      silent: opts.quiet,
    });
    results.push({ slug: opts.city, ...res });
  }
  if (opts.coupon) {
    const res = await exportParisSeamCoupon({
      baseHeightMm: opts.baseHeightMm,
      undersideReliefEnabled: opts.undersideReliefEnabled,
      outputDir: opts.outDir,
      silent: opts.quiet,
    });
    results.push({ slug: 'paris_seam_coupon', ...res });
  }
  process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    process.stderr.write(`[export_city_sku:error] ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}
