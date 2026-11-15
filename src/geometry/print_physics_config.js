// ============================================================================
// src/geometry/print_physics_config.js
// Central Canonical Scene-Unit, Print Physics & Metric Config Contract
// Single source of truth shared across GIS, Mesh, Render, UI, Video & Export.
// ============================================================================

const SCENE_CANONICAL_SPAN_UNITS = 169.2;
const SCENE_CANONICAL_HALF_UNITS = 84.6;
const DEFAULT_BED_SIZE_MM = 320.0;

const PRINT_PHYSICS_CONFIG = Object.freeze({
  canonicalSpanUnits: SCENE_CANONICAL_SPAN_UNITS,
  canonicalHalfUnits: SCENE_CANONICAL_HALF_UNITS,
  defaultBedSizeMm: DEFAULT_BED_SIZE_MM,
  photonMono4: Object.freeze({
    bedXMm: 153.45,
    bedYMm: 87.05,
    bedZMm: 165.0,
    safeMarginZMm: 2.0,
    frameSplitMaxMm: 148.0,
    safeGridMaxWMm: 150.0,
    safeGridMaxHMm: 85.0,
    dualPackMaxWMm: 75.45
  }),
  resin: Object.freeze({
    xyPixelMm: 0.017,
    layerHeightMm: 0.05,
    minFeatureMm: 0.12,
    minChannelMm: 0.48,
    dpSimplifyMm: 0.017,
    defaultKerfMm: 0.08,
    densityGPerMl: 1.15
  }),
  // Physical layer heights & tolerances in millimeters
  baseBottomMm: 2.35,
  deepWaterMm: 1.68,
  subWaterMm: 1.30,
  drainVaultMm: 0.70,
  greeneryHeightMm: 0.454,
  roadHeightMm: 0.567,
  footpathHeightMm: 0.303,
  bridgeDeckMinMm: 0.719,
  defaultFrameWidthMm: 12.0,
  frameInnerGapMm: 0.47,
  frameSkirtDepthMm: 1.6,
  frameLipAboveBaseMm: 1.1,
  minCutoutIsletMm2: 6.0
});

const OSM_METRIC_CONFIG = Object.freeze({
  levelHeightM: 3.5,
  minLevelHeightM: 3.5,
  roofLevelHeightM: 3.0,
  museumLargeAreaM2: 14000,
  commercialLargeAreaM2: 420,
  genericLargeAreaM2: 310,
  cropRatioBounds: Object.freeze([0.22, 1.0])
});

function _resolveSlaLawsRef() {
  if (typeof SLA_PRINT_LAWS !== 'undefined') return SLA_PRINT_LAWS;
  if (typeof globalThis !== 'undefined' && globalThis.SLA_PRINT_LAWS) return globalThis.SLA_PRINT_LAWS;
  if (typeof window !== 'undefined' && window.SLA_PRINT_LAWS) return window.SLA_PRINT_LAWS;
  if (typeof require === 'function') {
    try { return require('./sla_print_laws.js'); } catch (_) {}
  }
  return null;
}

function resolvePrintPhysicsSpec(state, scaleMm) {
  const isResin = true;
  const profile = PRINT_PHYSICS_CONFIG.resin;
  const laws = _resolveSlaLawsRef();
  const monoSpec = (laws && laws.MONO4_SPEC) || null;
  const effScale = Math.max(0.25, Number(scaleMm) || (DEFAULT_BED_SIZE_MM / SCENE_CANONICAL_SPAN_UNITS));
  const xyPixelMm = (monoSpec && monoSpec.xyPixelMm) || profile.xyPixelMm;
  const rawLayerH = state && Number(state.layerHeightMm);
  const layerHeightMm = (Number.isFinite(rawLayerH) && rawLayerH > 0 && rawLayerH <= 0.10)
    ? rawLayerH
    : ((monoSpec && monoSpec.layerHeightMm) || profile.layerHeightMm);
  const minWallMm = (laws && typeof laws.minWallThicknessMm === 'function') ? laws.minWallThicknessMm(0) : 0.45;
  const minStrutMm = (laws && typeof laws.minStrutDiameterMm === 'function') ? laws.minStrutDiameterMm(0) : 0.48;
  const minPinMm = (laws && typeof laws.minPinDiameterMm === 'function') ? laws.minPinDiameterMm(0) : 0.65;
  const minAntiCapillaryGapMm = (laws && typeof laws.resolveAntiCapillaryGapMm === 'function')
    ? laws.resolveAntiCapillaryGapMm(0.48)
    : 0.48;
  const maxOverhangMm = (laws && typeof laws.maxUnsupportedOverhangMm === 'function')
    ? laws.maxUnsupportedOverhangMm(layerHeightMm)
    : 0.45;
  const minFeatureMm = Math.max(profile.minFeatureMm, xyPixelMm * 7.0);
  const minChannelMm = Math.max(minAntiCapillaryGapMm, xyPixelMm * 28.0);
  const dpSimplifyMm = Math.max(profile.dpSimplifyMm, xyPixelMm);
  const defaultKerfMm = profile.defaultKerfMm;
  return {
    isResin,
    printerName: (monoSpec && monoSpec.name) || 'Anycubic Photon Mono 4',
    xyPixelMm,
    layerHeightMm,
    minFeatureMm,
    minChannelMm,
    dpSimplifyMm,
    defaultKerfMm,
    densityGPerMl: (monoSpec && monoSpec.densityGPerCm3) || profile.densityGPerMl,
    minWallMm,
    minStrutMm,
    minPinMm,
    minAntiCapillaryGapMm,
    maxOverhangMm,
    drainHoleMinMm: (monoSpec && monoSpec.drainHoleMinMm) || 1.4,
    minTileMarginMm: (monoSpec && monoSpec.minTileMarginMm) || 1.0,
    minFeatureUnits: minFeatureMm / effScale,
    minChannelUnits: minChannelMm / effScale,
    dpSimplifyUnits: dpSimplifyMm / effScale
  };
}

function resolveSceneScaleAndSpec(state, scene) {
  const s = state || {};
  const sc = scene || {};
  const totalWidthMm = (Number(s.bedSizeMm) > 0 ? Number(s.bedSizeMm) : 0) ||
    (Number(s.targetWidthMm) > 0 ? Number(s.targetWidthMm) : 0) ||
    (Number(s.targetWidthCm) > 0 ? Number(s.targetWidthCm) * 10 : 0) ||
    DEFAULT_BED_SIZE_MM;
  const totalHeightMm = (Number(s.totalHeightMm) > 0 ? Number(s.totalHeightMm) : 0) ||
    (Number(s.targetHeightMm) > 0 ? Number(s.targetHeightMm) : 0) ||
    (Number(s.targetHeightCm) > 0 ? Number(s.targetHeightCm) * 10 : 0) ||
    totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / SCENE_CANONICAL_SPAN_UNITS;
  const mmPerUnit = scaleMm;
  const unitsPerMm = 1.0 / scaleMm;
  const halfW = SCENE_CANONICAL_HALF_UNITS * (totalWidthMm / maxDimMm);
  const halfH = SCENE_CANONICAL_HALF_UNITS * (totalHeightMm / maxDimMm);
  const mToU = (Number(sc.metersToUnits) > 0)
    ? Number(sc.metersToUnits)
    : (Number(s.mapSpanMeters) > 0 ? (SCENE_CANONICAL_SPAN_UNITS / Number(s.mapSpanMeters)) : (SCENE_CANONICAL_SPAN_UNITS / 1200));
  const printSpec = resolvePrintPhysicsSpec(s, scaleMm);
  const layerHeightMm = printSpec.layerHeightMm;
  const quantizeZUnits = (uVal) => {
    const mm = uVal * mmPerUnit;
    const qMm = Math.max(layerHeightMm, Math.round(mm / layerHeightMm) * layerHeightMm);
    return qMm / mmPerUnit;
  };
  return {
    totalWidthMm,
    totalHeightMm,
    maxDimMm,
    scaleMm,
    mmPerUnit,
    unitsPerMm,
    halfW,
    halfH,
    mToU,
    printSpec,
    quantizeZUnits
  };
}

function resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) {
  if (t && t.tileId !== undefined && t.tileId !== null && t.tileId >= 0) {
    return t.tileId;
  }
  const cols = Math.max(1, tileCols | 0);
  const rows = Math.max(1, tileRows | 0);
  if (cols <= 1 && rows <= 1) return 0;
  if (!t || !t.v0 || !t.v1 || !t.v2) return 0;
  const cx = (t.v0[0] + t.v1[0] + t.v2[0]) / 3;
  const cy = (t.v0[1] + t.v1[1] + t.v2[1]) / 3;
  const hw = halfW > 0 ? halfW : SCENE_CANONICAL_HALF_UNITS;
  const hh = halfH > 0 ? halfH : SCENE_CANONICAL_HALF_UNITS;
  const tc = Math.min(cols - 1, Math.max(0, Math.floor(((cx + hw) / (2 * hw)) * cols)));
  const tr = Math.min(rows - 1, Math.max(0, Math.floor(((cy + hh) / (2 * hh)) * rows)));
  return tr * cols + tc;
}

if (typeof window !== 'undefined') {
  window.SCENE_CANONICAL_SPAN_UNITS = SCENE_CANONICAL_SPAN_UNITS;
  window.SCENE_CANONICAL_HALF_UNITS = SCENE_CANONICAL_HALF_UNITS;
  window.DEFAULT_BED_SIZE_MM = DEFAULT_BED_SIZE_MM;
  window.PRINT_PHYSICS_CONFIG = PRINT_PHYSICS_CONFIG;
  window.OSM_METRIC_CONFIG = OSM_METRIC_CONFIG;
  window.resolvePrintPhysicsSpec = resolvePrintPhysicsSpec;
  window.resolveSceneScaleAndSpec = resolveSceneScaleAndSpec;
  window.resolveTriangleTileId = resolveTriangleTileId;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCENE_CANONICAL_SPAN_UNITS,
    SCENE_CANONICAL_HALF_UNITS,
    DEFAULT_BED_SIZE_MM,
    PRINT_PHYSICS_CONFIG,
    OSM_METRIC_CONFIG,
    resolvePrintPhysicsSpec,
    resolveSceneScaleAndSpec,
    resolveTriangleTileId
  };
}
