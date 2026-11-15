// ============================================================================
// src/geometry/sla_print_laws.js
// Physical MSLA Manufacturing Laws & Hardware Contract for Anycubic Photon Mono 4
// Single source of truth for pixel pitch, cure walls, anti-capillary gaps,
// spire saturation, overhang limits, support angle & print-time estimation.
// ============================================================================

/**
 * Hardware and resin print parameters for Anycubic Photon Mono 4 (17 um XY, 50 um Z).
 */
const MONO4_SPEC = Object.freeze({
  name: 'Anycubic Photon Mono 4',
  xyPixelMm: 0.017,
  layerHeightMm: 0.05,
  bedWidthMm: 153.45,
  bedDepthMm: 87.05,
  bedHeightMm: 165.0,
  exposurePerLayerSec: 2.3,
  liftRetractSec: 4.5,
  secPerLayer: 6.8,
  densityGPerCm3: 1.15,
  drainHoleMinMm: 1.4,
  minTileMarginMm: 1.0
});

function _clampedLinearMm(floorMm, baseMm, slope, extentMm) {
  const n = Number(extentMm);
  const safeExtent = (Number.isFinite(n) && n > 0) ? n : 0;
  return Math.max(floorMm, baseMm + slope * safeExtent);
}

/**
 * Minimum cured MSLA wall thickness (mm) required to resist peel forces at heightMm.
 */
function minWallThicknessMm(heightMm) {
  return _clampedLinearMm(0.45, 0.35, 0.025, heightMm);
}

/**
 * Minimum strut / cable / lattice bar diameter (mm) for a given unsupported spanMm.
 */
function minStrutDiameterMm(spanMm) {
  return _clampedLinearMm(0.48, 0.38, 0.035, spanMm);
}

/**
 * Minimum vertical pin / spire / finial diameter (mm) for a given protrusionMm.
 */
function minPinDiameterMm(protrusionMm) {
  return _clampedLinearMm(0.65, 0.45, 0.08, protrusionMm);
}

/**
 * Smoothly saturates tall spire protrusions above a building body via tanh so
 * ultra-tall needles remain printable without dominating total Mono 4 Z print time.
 */
function capSpireProtrusionMm(rawDeltaMm, bodyHeightMm) {
  const raw = Number(rawDeltaMm);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const body = Number(bodyHeightMm);
  const safeBody = Number.isFinite(body) ? Math.max(4.0, body) : 4.0;
  const maxDeltaMm = Math.max(1.5, Math.min(4.5, 0.22 * safeBody));
  return maxDeltaMm * Math.tanh(raw / maxDeltaMm);
}

/**
 * Resolves capillary resin-trap gaps between adjacent features:
 * gaps < 0.5 * minGapMm fuse to 0 (solid), otherwise expand to >= minGapMm.
 */
function resolveAntiCapillaryGapMm(rawGapMm, minGapMm = 0.48) {
  const raw = Number(rawGapMm);
  const parsedMin = Number(minGapMm);
  const minGap = (Number.isFinite(parsedMin) && parsedMin > 0) ? parsedMin : 0.48;
  if (!Number.isFinite(raw) || raw <= 0 || raw < minGap * 0.5) return 0;
  return Math.max(minGap, raw);
}

/**
 * Maximum horizontal unsupported overhang per layer step (mm) for a given layer height.
 */
function maxUnsupportedOverhangMm(layerHeightMm = 0.05) {
  const lh = Number(layerHeightMm);
  const safeLh = (Number.isFinite(lh) && lh > 0) ? Math.max(0.02, lh) : MONO4_SPEC.layerHeightMm;
  return Math.max(0.35, Math.min(0.60, 0.45 * (0.05 / safeLh)));
}

/**
 * Minimum self-supporting overhang angle (deg from horizontal): 40 deg in supportless mode, 0 otherwise.
 */
function requiredSupportAngleDeg(supportlessMode) {
  return supportlessMode ? 40 : 0;
}

/**
 * Estimates Anycubic Photon Mono 4 print duration in minutes for model height maxZMm.
 */
function estimateMono4PrintMinutes(maxZMm) {
  const z = Number(maxZMm);
  const safeZ = (Number.isFinite(z) && z > 0) ? z : 0;
  return Math.max(1, Math.ceil((safeZ / MONO4_SPEC.layerHeightMm) * MONO4_SPEC.secPerLayer / 60));
}

const SLA_PRINT_LAWS = Object.freeze({
  MONO4_SPEC,
  minWallThicknessMm,
  minStrutDiameterMm,
  minPinDiameterMm,
  capSpireProtrusionMm,
  resolveAntiCapillaryGapMm,
  maxUnsupportedOverhangMm,
  requiredSupportAngleDeg,
  estimateMono4PrintMinutes
});

if (typeof window !== 'undefined') {
  window.MONO4_SPEC = MONO4_SPEC;
  window.SLA_PRINT_LAWS = SLA_PRINT_LAWS;
  window.minWallThicknessMm = minWallThicknessMm;
  window.minStrutDiameterMm = minStrutDiameterMm;
  window.minPinDiameterMm = minPinDiameterMm;
  window.capSpireProtrusionMm = capSpireProtrusionMm;
  window.resolveAntiCapillaryGapMm = resolveAntiCapillaryGapMm;
  window.maxUnsupportedOverhangMm = maxUnsupportedOverhangMm;
  window.requiredSupportAngleDeg = requiredSupportAngleDeg;
  window.estimateMono4PrintMinutes = estimateMono4PrintMinutes;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MONO4_SPEC,
    SLA_PRINT_LAWS,
    minWallThicknessMm,
    minStrutDiameterMm,
    minPinDiameterMm,
    capSpireProtrusionMm,
    resolveAntiCapillaryGapMm,
    maxUnsupportedOverhangMm,
    requiredSupportAngleDeg,
    estimateMono4PrintMinutes
  };
}
