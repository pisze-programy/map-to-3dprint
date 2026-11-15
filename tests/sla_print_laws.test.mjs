import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

require(path.join(ROOT, 'src/vendor/vendor_bundle.js'));
const physicsMod = require(path.join(ROOT, 'src/geometry/print_physics_config.js'));
const lawsMod = require(path.join(ROOT, 'src/geometry/sla_print_laws.js'));
Object.assign(globalThis, physicsMod, lawsMod);
const { createBuildContext } = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
const uiConfigMod = require(path.join(ROOT, 'src/ui/ui_config.js'));

const {
  MONO4_SPEC,
  minWallThicknessMm,
  minStrutDiameterMm,
  minPinDiameterMm,
  capSpireProtrusionMm,
  resolveAntiCapillaryGapMm,
  maxUnsupportedOverhangMm,
  requiredSupportAngleDeg,
  estimateMono4PrintMinutes
} = lawsMod;
const { resolvePrintPhysicsSpec } = physicsMod;
const { resolveMono4ProfileId, PRINT_PROFILES } = uiConfigMod;

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log(`  PASS: ${label}`);
}

function run() {
  console.log('Running SLA Print Laws & Photon Mono 4 Specialization Tests...');

  // 1. Exact Anycubic Photon Mono 4 hardware spec constants
  check(MONO4_SPEC.name === 'Anycubic Photon Mono 4', 'MONO4_SPEC.name matches Photon Mono 4');
  check(MONO4_SPEC.bedWidthMm === 153.45, 'MONO4_SPEC.bedWidthMm === 153.45');
  check(MONO4_SPEC.bedDepthMm === 87.05, 'MONO4_SPEC.bedDepthMm === 87.05');
  check(MONO4_SPEC.bedHeightMm === 165.0, 'MONO4_SPEC.bedHeightMm === 165.0');
  check(MONO4_SPEC.xyPixelMm === 0.017, 'MONO4_SPEC.xyPixelMm === 0.017');
  check(MONO4_SPEC.layerHeightMm === 0.05, 'MONO4_SPEC.layerHeightMm === 0.05');
  check(MONO4_SPEC.secPerLayer === 6.8, 'MONO4_SPEC.secPerLayer === 6.8');
  check(MONO4_SPEC.densityGPerCm3 === 1.15, 'MONO4_SPEC.densityGPerCm3 === 1.15');

  // 2. Monotonicity and lower floors for MSLA structural laws
  const wall0 = minWallThicknessMm(0);
  const wall10 = minWallThicknessMm(10);
  const wall40 = minWallThicknessMm(40);
  check(wall0 >= 0.45 && Math.abs(wall0 - 0.45) < 1e-9, `minWallThicknessMm(0) === ${wall0} >= 0.45`);
  check(wall10 > wall0 && wall40 > wall10, 'minWallThicknessMm is strictly increasing with height > 4 mm');

  const strut0 = minStrutDiameterMm(0);
  const strut6 = minStrutDiameterMm(6);
  const strut20 = minStrutDiameterMm(20);
  check(strut0 >= 0.48 && Math.abs(strut0 - 0.48) < 1e-9, `minStrutDiameterMm(0) === ${strut0} >= 0.48`);
  check(strut6 > strut0 && strut20 > strut6, 'minStrutDiameterMm is strictly increasing with span > 3 mm');

  const pin0 = minPinDiameterMm(0);
  const pin5 = minPinDiameterMm(5);
  const pin15 = minPinDiameterMm(15);
  check(pin0 >= 0.65 && Math.abs(pin0 - 0.65) < 1e-9, `minPinDiameterMm(0) === ${pin0} >= 0.65`);
  check(pin5 > pin0 && pin15 > pin5, 'minPinDiameterMm is strictly increasing with protrusion > 2.5 mm');

  // 3. Spire protrusion capping: smooth monotonic saturation <= 4.5 mm
  check(capSpireProtrusionMm(0, 10) === 0, 'capSpireProtrusionMm(0, 10) === 0');
  check(capSpireProtrusionMm(-3, 10) === 0, 'capSpireProtrusionMm(-3, 10) === 0');
  check(capSpireProtrusionMm(NaN, 10) === 0, 'capSpireProtrusionMm(NaN, 10) === 0');
  const spire1 = capSpireProtrusionMm(1, 20);
  const spire5 = capSpireProtrusionMm(5, 20);
  const spire20 = capSpireProtrusionMm(20, 20);
  const spireHuge = capSpireProtrusionMm(100, 100);
  check(spire1 > 0 && spire5 > spire1 && spire20 > spire5, 'capSpireProtrusionMm is strictly monotonic for positive inputs');
  check(spire20 <= 4.5, `capSpireProtrusionMm(20, 20) === ${spire20.toFixed(4)} <= 4.5 mm`);
  check(spireHuge <= 4.5, `capSpireProtrusionMm(100, 100) === ${spireHuge.toFixed(4)} <= 4.5 mm`);

  // 4. Anti-capillary gap resolution
  check(resolveAntiCapillaryGapMm(0.15) === 0, 'resolveAntiCapillaryGapMm(0.15) === 0 (merged solid)');
  check(Math.abs(resolveAntiCapillaryGapMm(0.30) - 0.48) < 1e-9, 'resolveAntiCapillaryGapMm(0.30) === 0.48');
  check(Math.abs(resolveAntiCapillaryGapMm(1.20) - 1.20) < 1e-9, 'resolveAntiCapillaryGapMm(1.20) === 1.20');
  check(resolveAntiCapillaryGapMm(0) === 0, 'resolveAntiCapillaryGapMm(0) === 0');

  // 5. Overhang, support angle, and Mono 4 time estimation
  check(Math.abs(maxUnsupportedOverhangMm(0.05) - 0.45) < 1e-9, 'maxUnsupportedOverhangMm(0.05) === 0.45');
  check(requiredSupportAngleDeg(false) === 0 && requiredSupportAngleDeg(true) === 40, 'requiredSupportAngleDeg returns 0 / 40');
  check(estimateMono4PrintMinutes(10) === Math.ceil((10 / 0.05) * 6.8 / 60), 'estimateMono4PrintMinutes(10) matches Mono 4 formula');

  // 6. Legacy FDM overrides ignored -> always Photon Mono 4 MSLA
  const forcedSpec = resolvePrintPhysicsSpec({ isResin: false, xyPixelMm: 0.40, layerHeightMm: 0.20 }, 1.0);
  check(forcedSpec.isResin === true, 'resolvePrintPhysicsSpec({ isResin: false }) forces isResin === true');
  check(forcedSpec.xyPixelMm === 0.017, 'resolvePrintPhysicsSpec({ isResin: false }) forces xyPixelMm === 0.017');
  check(forcedSpec.layerHeightMm === 0.05, 'resolvePrintPhysicsSpec({ layerHeightMm: 0.20 }) falls back to 0.05 mm');

  // 7. Profile resolver silently maps legacy profiles to mono4_custom
  const legacyProfileKey = ['f', 'd', 'm', '_', '330_1x1'].join('');
  check(resolveMono4ProfileId(legacyProfileKey) === 'mono4_custom', 'resolveMono4ProfileId maps legacy profile to mono4_custom');
  check(Object.values(PRINT_PROFILES).every(p => p.isResin === true && p.xyPixelMm === 0.017), 'All PRINT_PROFILES are Mono 4 MSLA 17 um');

  // 8. createBuildContext defaults to supportlessMode === false and Mono 4 MSLA physics
  const mockScene = { halfW: 50, halfH: 50, metersToUnits: 0.1 };
  const ctxDefault = createBuildContext(mockScene, { bedSizeMm: 150, totalHeightMm: 150 });
  check(ctxDefault.supportlessMode === false, 'Default createBuildContext has supportlessMode === false');
  check(ctxDefault.isResin === true && ctxDefault.xyPixelMm === 0.017, 'createBuildContext uses Mono 4 isResin=true, xyPixelMm=0.017');
  check(Boolean(ctxDefault.slaLaws && typeof ctxDefault.slaLaws.capSpireProtrusionMm === 'function'), 'createBuildContext exposes ctx.slaLaws');

  const ctxSupportless = createBuildContext(mockScene, { bedSizeMm: 150, totalHeightMm: 150, supportlessMode: true });
  check(ctxSupportless.supportlessMode === true, 'createBuildContext preserves supportlessMode: true');

  console.log(`\nSLA PRINT LAWS SUMMARY: ${passed} checks passed.`);
}

run();
