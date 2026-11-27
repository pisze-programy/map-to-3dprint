// Bed safe area (DFM-11): tiles must fit 153.45 x 87.05 mm minus the margin on every side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cfg = require('../src/geometry/print_physics_config.js');
const ui = require('../src/geometry/print_profiles.js');

test('default safe area is 4.0 mm per side', () => {
  const sa = cfg.resolveMono4SafeArea(null);
  assert.equal(sa.marginMm, 4.0);
  assert.ok(Math.abs(sa.maxWMm - 145.45) < 1e-9);
  assert.ok(Math.abs(sa.maxHMm - 79.05) < 1e-9);
  assert.ok(Math.abs(sa.dualMaxWMm - 68.725) < 1e-9);
});

test('margin is clamped and read from state', () => {
  assert.equal(cfg.resolveMono4SafeArea({ bedSafeMarginMm: 2.5 }).marginMm, 2.5);
  assert.equal(cfg.resolveMono4SafeArea({ bedSafeMarginMm: -3 }).marginMm, 0);
  assert.equal(cfg.resolveMono4SafeArea({ bedSafeMarginMm: 99 }).marginMm, 10);
});

test('every computed grid tile fits the safe area', () => {
  for (const margin of [2.5, 3, 4, 5]) {
    const state = { bedSafeMarginMm: margin };
    const sa = cfg.resolveMono4SafeArea(state);
    for (const [w, h] of [[130, 180], [150, 150], [296, 296], [320, 320], [500, 700], [1290, 790], [75, 84]]) {
      const g = ui.computeOptimalMono4GridForState(state, w, h);
      const tw = w / g.cols, th = h / g.rows;
      const fits = (tw <= sa.maxWMm + 1e-6 && th <= sa.maxHMm + 1e-6) || (th <= sa.maxWMm + 1e-6 && tw <= sa.maxHMm + 1e-6);
      assert.ok(fits, `margin ${margin}: ${w}x${h} -> ${g.cols}x${g.rows} tile ${tw.toFixed(2)}x${th.toFixed(2)}`);
      assert.ok(ui.checkTileFitsMono4(tw, th, 22, state));
    }
  }
});

test('13 x 18 cm frame needs 3 tiles at the default margin', () => {
  const g = ui.computeOptimalMono4GridForState({ bedSafeMarginMm: 4 }, 130, 180);
  assert.equal(g.cols * g.rows, 3);
});

test('fixed presets fit the Mono 4 safe area cleanly', () => {
  const st = { bedSafeMarginMm: 4 };
  assert.deepEqual(ui.resolveMono4ProfileGrid(ui.PRINT_PROFILES.mono4_75x84_1x1, st), { cols: 1, rows: 1 });
  for (const id of [
    'mono4_a4_passepartout_12x17_1x3',
    'single_a4_landscape_3x1',
    'triptych_a4_3x1',
    'quartet_a4_2x2',
    'square_150_2x2',
    'square_240_2x4',
    'flagship_50x70_3x9',
  ]) {
    const prof = ui.PRINT_PROFILES[id];
    assert.ok(prof, `Missing catalog profile ${id}`);
    const g = ui.resolveMono4ProfileGrid(prof, st);
    assert.equal(g.cols, prof.cols, `${id} cols preserved`);
    assert.equal(g.rows, prof.rows, `${id} rows preserved`);
    assert.ok(ui.checkTileFitsMono4(prof.totalWidthMm / g.cols, prof.totalHeightMm / g.rows, 22, st), `${id} tile must fit Mono 4 safe bed`);
  }
});

test('dual packing keeps the 8 mm FEP gap inside the safe area', () => {
  const st = { bedSafeMarginMm: 4 };
  assert.equal(ui.checkTileDualPackableMono4(68, 79, st), true);
  assert.equal(ui.checkTileDualPackableMono4(75, 84, st), false);
});

test('single 1x1 Mono 4 preset fits 1x1 cleanly for every margin option', () => {
  for (const margin of [2.5, 3, 4, 5]) {
    const st = { bedSafeMarginMm: margin };
    const sa = cfg.resolveMono4SafeArea(st);
    const wMm = Math.floor(sa.maxWMm);
    const hMm = Math.floor(sa.maxHMm);
    const g = ui.computeOptimalMono4GridForState(st, wMm, hMm);
    assert.equal(g.cols, 1, `margin ${margin}: expected cols=1`);
    assert.equal(g.rows, 1, `margin ${margin}: expected rows=1`);
    assert.equal(ui.checkTileFitsMono4(wMm, hMm, 22, st), true);
  }
});

test('A4 Passe-Partout 12x17 cm (1x3) preset resolves to 3 tiles of 120x56.67 mm with 4.0 mm solid base and 4.0 mm margin', () => {
  const prof = ui.PRINT_PROFILES.mono4_a4_passepartout_12x17_1x3;
  assert.ok(prof, 'Expected mono4_a4_passepartout_12x17_1x3 profile');
  assert.strictEqual(ui.PRINT_PROFILES.mono4_a4_passepartout_12x17_2x1, prof, 'Legacy 2x1 alias must point to 1x3 profile');
  assert.equal(prof.totalWidthMm, 120);
  assert.equal(prof.totalHeightMm, 170);
  assert.equal(prof.cols, 1);
  assert.equal(prof.rows, 3);
  assert.equal(prof.solidBaseNoTunnels, true);
  assert.equal(prof.baseHeightMm, 4.0);
  assert.equal(prof.bedSafeMarginMm, 4.0);

  const st = { bedSafeMarginMm: prof.bedSafeMarginMm };
  const sa = cfg.resolveMono4SafeArea(st);
  const tileHMm = 170 / 3;
  assert.ok(120 <= sa.maxWMm + 1e-6 && tileHMm <= sa.maxHMm + 1e-6, `120x${tileHMm.toFixed(2)} must fit ${sa.maxWMm}x${sa.maxHMm}`);
  assert.equal(ui.checkTileFitsMono4(120, tileHMm, 95, st), true);
  assert.deepEqual(ui.resolveMono4ProfileGrid(prof, st), { cols: 1, rows: 3 });
  assert.deepEqual(ui.resolveMono4ProfileGrid(prof, null), { cols: 1, rows: 3 });

  assert.equal(cfg.resolveBaseBottomMm(null), 2.35);
  assert.equal(cfg.resolveBaseBottomMm({ solidBaseNoTunnels: true }), 4.0);
  assert.equal(cfg.resolveBaseBottomMm({ solidBaseNoTunnels: true, baseHeightMm: 4.5 }), 4.5);
  assert.equal(cfg.resolveBaseBottomMm({ baseBottomMm: 3.5 }), 3.5);
  assert.equal(cfg.PRINT_PHYSICS_CONFIG.roadHeightMm, 0.567);
});

test('underside relief toggle and shallow pond floor resolve deterministically by base thickness', () => {
  assert.equal(cfg.resolveUndersideReliefEnabled({ solidBaseNoTunnels: true, baseHeightMm: 4.0 }), true);
  assert.equal(cfg.resolveUndersideReliefEnabled({ solidBaseNoTunnels: true, baseHeightMm: 2.0 }), false);
  assert.equal(cfg.resolveUndersideReliefEnabled({ solidBaseNoTunnels: true, baseHeightMm: 2.6 }), false);
  assert.equal(cfg.resolveUndersideReliefEnabled({ solidBaseNoTunnels: true, baseHeightMm: 2.65 }), true);
  assert.equal(cfg.resolveUndersideReliefEnabled({ solidBaseNoTunnels: true, baseHeightMm: 4.0, undersideReliefEnabled: false }), false);
  assert.equal(cfg.resolveUndersideReliefEnabled({ solidBaseNoTunnels: true, baseHeightMm: 2.0, undersideReliefEnabled: true }), true);
  assert.equal(cfg.resolveUndersideReliefEnabled({ solidBaseNoTunnels: false, baseHeightMm: 4.0 }), false);

  // 4.0 mm grooved base preserves exact 2.20 mm floor above 1.50 mm relief ceiling
  assert.ok(Math.abs(cfg.resolveShallowPondMinFloorMm(4.0, true, 1.50) - 2.20) < 1e-9);
  // 2.0 mm smooth base keeps pond floor well below 2.0 mm so 0.40 mm recess stays visible (1.60 mm)
  assert.ok(Math.abs(cfg.resolveShallowPondMinFloorMm(2.0, false, 1.50) - 1.20) < 1e-9);
  // 1.8 mm minimum base still keeps >= 1.00 mm floor under 0.40 mm recess (1.40 mm)
  assert.ok(Math.abs(cfg.resolveShallowPondMinFloorMm(1.8, false, 1.50) - 1.00) < 1e-9);
});

test('underside vent profile preserves >= 0.50 mm roof for >= 2.0 mm bases and stays below shallow ponds', () => {
  const ventMod = require('../src/mesh/tile_msla_vent_builder.js');
  for (const baseMm of [1.80, 1.90, 2.00, 2.15, 2.20, 2.25, 2.35, 2.60, 3.00, 4.00]) {
    const p = ventMod.resolveUndersideVentProfileMm(baseMm);
    const apexMm = p.zSpringMm + p.gableRiseMm;
    const roofMm = baseMm - apexMm;
    const minRoof = baseMm >= 2.00 ? 0.50 : 0.45;
    assert.ok(roofMm >= minRoof - 1e-6, `base=${baseMm}: roof=${roofMm.toFixed(3)} < ${minRoof}`);
    assert.ok(apexMm >= 1.35 - 1e-6, `base=${baseMm}: apex=${apexMm.toFixed(3)} < 1.35 (VAL-03 clearance)`);
    assert.ok(p.gableRiseMm >= p.ventHalfWidthMm - 0.16, `base=${baseMm}: gable slope too shallow`);
    if (baseMm >= 2.00) {
      assert.ok(apexMm <= baseMm - 0.40 + 1e-6, `base=${baseMm}: apex=${apexMm.toFixed(3)} breaches 0.40 mm shallow pond`);
    }
  }
});
