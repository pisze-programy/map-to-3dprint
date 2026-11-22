// Bed safe area (DFM-11): tiles must fit 153.45 x 87.05 mm minus the margin on every side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cfg = require('../src/geometry/print_physics_config.js');
const ui = require('../src/ui/ui_config.js');

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

test('fixed presets are re-gridded only when their tiles leave the safe area', () => {
  const st = { bedSafeMarginMm: 4 };
  assert.deepEqual(ui.resolveMono4ProfileGrid(ui.PRINT_PROFILES.mono4_75x84_1x1, st), { cols: 1, rows: 1 });
  assert.deepEqual(ui.resolveMono4ProfileGrid(ui.PRINT_PROFILES.mono4_150x168_2x2, st), { cols: 2, rows: 2 });
  const g150 = ui.resolveMono4ProfileGrid(ui.PRINT_PROFILES.mono4_150_1x2, st);
  assert.ok(ui.checkTileFitsMono4(150 / g150.cols, 150 / g150.rows, 22, st));
  const g296 = ui.resolveMono4ProfileGrid(ui.PRINT_PROFILES.mono4_296_2x4, st);
  assert.ok(ui.checkTileFitsMono4(296 / g296.cols, 296 / g296.rows, 22, st));
});

test('dual packing keeps the 8 mm FEP gap inside the safe area', () => {
  const st = { bedSafeMarginMm: 4 };
  assert.equal(ui.checkTileDualPackableMono4(68, 79, st), true);
  assert.equal(ui.checkTileDualPackableMono4(75, 84, st), false);
});
