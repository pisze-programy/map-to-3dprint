// Standalone unit tests for STL manifold hygiene in extractDePinchedStlTriangles.
// Verifies grounded floating-shell filtering (VAL-05), Float32 collinearity repair (VAL-01),
// and preservation of elevated non-grounded assemblies.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const mv = require(path.join(ROOT, 'src/vendor/manifold_vendor.js'));
const core = require(path.join(ROOT, 'src/geometry/manifold_core.js'));
const stlMod = require(path.join(ROOT, 'src/export/stl_writer.js'));

function auditBinaryStlRound4(bytes) {
  assert.ok(bytes instanceof Uint8Array && bytes.byteLength >= 84, 'STL smaller than 84 bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nTris = view.getUint32(80, true);
  assert.equal(bytes.byteLength, 84 + nTris * 50, 'STL byteLength mismatch');

  const rawTris = [];
  let zFloor = Infinity;
  let nanInf = 0;
  for (let i = 0; i < nTris; i++) {
    const base = 84 + i * 50;
    const pts = [];
    for (let k = 0; k < 4; k++) {
      const off = base + k * 12;
      const x = view.getFloat32(off, true);
      const y = view.getFloat32(off + 4, true);
      const z = view.getFloat32(off + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nanInf++;
      if (k > 0) {
        pts.push([x, y, z]);
        if (z < zFloor) zFloor = z;
      }
    }
    rawTris.push(pts);
  }
  if (!Number.isFinite(zFloor)) zFloor = 0;

  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const undir = new Map();
  const dir = new Map();
  const vTris = new Map();
  const triKeys = [];
  let degen = 0;
  let le1e9 = 0;

  for (let i = 0; i < rawTris.length; i++) {
    const rp = rawTris[i].map((p) => [r4(p[0]), r4(p[1]), r4(p[2] - zFloor)]);
    const pk = rp.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`);
    triKeys.push(pk);

    const ux = rp[1][0] - rp[0][0], uy = rp[1][1] - rp[0][1], uz = rp[1][2] - rp[0][2];
    const vx = rp[2][0] - rp[0][0], vy = rp[2][1] - rp[0][1], vz = rp[2][2] - rp[0][2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const len2 = cx * cx + cy * cy + cz * cz;
    const area2 = Math.sqrt(len2);
    if (area2 < 1e-8 || pk[0] === pk[1] || pk[1] === pk[2] || pk[2] === pk[0]) degen++;
    if (len2 <= 1e-9) le1e9++;

    for (let k = 0; k < 3; k++) {
      const a = pk[k];
      const b = pk[(k + 1) % 3];
      const uk = a < b ? `${a}|${b}` : `${b}|${a}`;
      undir.set(uk, (undir.get(uk) || 0) + 1);
      const dk = `${a}|${b}`;
      dir.set(dk, (dir.get(dk) || 0) + 1);
      let vt = vTris.get(a);
      if (!vt) { vt = []; vTris.set(a, vt); }
      vt.push(i);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const c of undir.values()) {
    if (c === 1) openEdges++;
    else if (c > 2) nonManifoldEdges++;
  }

  let badHalfEdges = 0;
  for (const [k, c] of dir.entries()) {
    const [a, b] = k.split('|');
    if (c !== 1 || dir.get(`${b}|${a}`) !== 1) badHalfEdges++;
  }

  let nonManifoldVerts = 0;
  for (const [v, tlist] of vTris.entries()) {
    const adj = new Map();
    for (const ti of tlist) {
      const others = triKeys[ti].filter((p) => p !== v);
      if (others.length !== 2) continue;
      if (!adj.has(others[0])) adj.set(others[0], []);
      if (!adj.has(others[1])) adj.set(others[1], []);
      adj.get(others[0]).push(others[1]);
      adj.get(others[1]).push(others[0]);
    }
    if (adj.size === 0) continue;
    const seen = new Set();
    const stack = [adj.keys().next().value];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nb of adj.get(cur)) stack.push(nb);
    }
    let badDeg = false;
    for (const nbs of adj.values()) {
      if (nbs.length !== 2) { badDeg = true; break; }
    }
    if (seen.size !== adj.size || badDeg) nonManifoldVerts++;
  }

  const visited = new Uint8Array(rawTris.length);
  const shells = [];
  for (let i = 0; i < rawTris.length; i++) {
    if (visited[i]) continue;
    const q = [i];
    visited[i] = 1;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let triCount = 0;
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      triCount++;
      for (const p of rawTris[cur]) {
        if (p[2] < minZ) minZ = p[2];
        if (p[2] > maxZ) maxZ = p[2];
      }
      for (const pk of triKeys[cur]) {
        for (const nb of (vTris.get(pk) || [])) {
          if (!visited[nb]) { visited[nb] = 1; q.push(nb); }
        }
      }
    }
    shells.push({ triCount, minZ, maxZ });
  }

  return {
    nTris,
    zFloor: r4(zFloor),
    nanInf,
    degen,
    le1e9,
    openEdges,
    nonManifoldEdges,
    badHalfEdges,
    nonManifoldVerts,
    components: shells.length,
    shells,
  };
}

function minTriangleAltitudeMm(man, scMm) {
  const m = man.getMesh();
  const vp = m.vertProperties;
  const tv = m.triVerts;
  const np = m.numProp || 3;
  let minAlt = Infinity;
  for (let t = 0; t < tv.length / 3; t++) {
    const i0 = tv[t * 3] * np;
    const i1 = tv[t * 3 + 1] * np;
    const i2 = tv[t * 3 + 2] * np;
    const ux = (vp[i1] - vp[i0]) * scMm, uy = (vp[i1 + 1] - vp[i0 + 1]) * scMm, uz = (vp[i1 + 2] - vp[i0 + 2]) * scMm;
    const vx = (vp[i2] - vp[i0]) * scMm, vy = (vp[i2 + 1] - vp[i0 + 1]) * scMm, vz = (vp[i2 + 2] - vp[i0 + 2]) * scMm;
    const wx = (vp[i2] - vp[i1]) * scMm, wy = (vp[i2 + 1] - vp[i1 + 1]) * scMm, wz = (vp[i2 + 2] - vp[i1 + 2]) * scMm;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area2 = Math.hypot(cx, cy, cz);
    const maxE = Math.sqrt(Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz));
    if (maxE > 0) minAlt = Math.min(minAlt, area2 / maxE);
  }
  return minAlt;
}

test('VAL-05: grounded base drops disconnected floating micro-shell at scaleMm=2.0 with rotation', async () => {
  const mf = await mv.__ensureManifoldReady();
  const scaleMm = 2.0;
  // Base cube: 10 x 10 x 3 mm (Z = 0..1.5 scene units).
  const baseCube = mf.Manifold.cube([5, 5, 1.5], false);
  // Disconnected floating micro-cube: 0.6 x 0.6 x 0.3 mm at Z = 2.5..2.8 mm (1.25..1.4 scene units).
  const floatCube = mf.Manifold.cube([0.3, 0.3, 0.15], false).translate([8, 8, 1.25]);
  const combined = baseCube.add(floatCube);
  baseCube.delete();
  floatCube.delete();

  const preComps = combined.decompose();
  assert.equal(preComps.length, 2, 'Input manifold must have 2 disconnected components');
  for (const c of preComps) c.delete();

  const tris = core.extractDePinchedStlTriangles(mf, combined, 0, scaleMm);
  combined.delete();

  assert.equal(tris.length, 12, 'Floating micro-cube triangles must be removed');
  const bytes = stlMod.buildSTLBytesFromTriangles(tris, 2, 2, scaleMm, 25, 25, {}, true, 0);
  const audit = auditBinaryStlRound4(bytes);

  assert.equal(audit.nanInf, 0);
  assert.equal(audit.components, 1);
  assert.equal(audit.shells.filter((s) => s.minZ > 0.05).length, 0);
  assert.ok(Math.abs(audit.shells[0].minZ) <= 1e-4);
  assert.ok(Math.abs(audit.shells[0].maxZ - 3.0) <= 1e-3);
  assert.equal(audit.openEdges, 0);
  assert.equal(audit.nonManifoldEdges, 0);
  assert.equal(audit.badHalfEdges, 0);
  assert.equal(audit.nonManifoldVerts, 0);
  assert.equal(audit.degen, 0);
});

test('VAL-01: near-collinear sliver at Mono 4 scaleMm passes Float32 and round(4) audit', async () => {
  const mf = await mv.__ensureManifoldReady();
  const scaleMm = 145 / 169.2;

  // Create a stepped solid with a 1e-5 degree misalignment that produces a ~6e-7 mm sliver.
  const baseBlock = mf.Manifold.cube([20, 20, 5], false);
  const upperBlock = mf.Manifold.cube([10, 10, 5], false)
    .rotate([0, 0, 1e-5])
    .translate([10, 1e-6 / scaleMm, 5]);
  const sliverMan = mf.Manifold.union([baseBlock, upperBlock]);
  baseBlock.delete();
  upperBlock.delete();

  // Confirm the simplified Manifold still retains the near-collinear ~1e-6 mm sliver before repair.
  const tol = Math.max(1e-5, Math.min(1e-3, 0.0015 / scaleMm));
  const postSimp = sliverMan.simplify(tol);
  const preAltMm = minTriangleAltitudeMm(postSimp, scaleMm);
  postSimp.delete();
  assert.ok(preAltMm < 1e-5, `Expected near-collinear sliver < 1e-5 mm after simplify, got ${preAltMm}`);

  const tris = core.extractDePinchedStlTriangles(mf, sliverMan, 0, scaleMm);
  sliverMan.delete();

  const bytes = stlMod.buildSTLBytesFromTriangles(tris, 84.6, 84.6, scaleMm, 145, 145, {}, true, 0);
  const audit = auditBinaryStlRound4(bytes);

  assert.equal(audit.nanInf, 0);
  assert.equal(audit.zFloor, 0);
  assert.equal(audit.degen, 0);
  assert.equal(audit.le1e9, 0);
  assert.equal(audit.openEdges, 0);
  assert.equal(audit.nonManifoldEdges, 0);
  assert.equal(audit.badHalfEdges, 0);
  assert.equal(audit.nonManifoldVerts, 0);
  assert.equal(audit.components, 1);
});

test('VAL-05: elevated non-grounded assembly (Z=5..10 mm) is preserved when no Z=0 geometry exists', async () => {
  const mf = await mv.__ensureManifoldReady();
  const scaleMm = 1.0;
  const elevatedA = mf.Manifold.cube([4, 4, 5], false).translate([0, 0, 5]);
  const elevatedB = mf.Manifold.cube([2, 2, 2], false).translate([10, 10, 7]);
  const man = elevatedA.add(elevatedB);
  elevatedA.delete();
  elevatedB.delete();

  const tris = core.extractDePinchedStlTriangles(mf, man, 0, scaleMm);
  man.delete();

  assert.equal(tris.length, 24, 'All triangles of elevated non-grounded components must be kept');
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of tris) {
    for (const p of [t.v0, t.v1, t.v2]) {
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }
  }
  assert.ok(Math.abs(minZ - 5.0) <= 1e-4, `Expected minZ near 5.0, got ${minZ}`);
  assert.ok(Math.abs(maxZ - 10.0) <= 1e-4, `Expected maxZ near 10.0, got ${maxZ}`);

  const bytes = stlMod.buildSTLBytesFromTriangles(tris, 10, 10, scaleMm, 40, 40, {}, false, 0);
  const audit = auditBinaryStlRound4(bytes);
  assert.equal(audit.components, 2);
  assert.equal(audit.degen, 0);
  assert.equal(audit.openEdges, 0);
  assert.equal(audit.nonManifoldEdges, 0);
  assert.equal(audit.badHalfEdges, 0);
  assert.equal(audit.nonManifoldVerts, 0);
});

test('VAL-01: pinched edge between touching cubes is separated to zero non-manifold edges/vertices', async () => {
  const mf = await mv.__ensureManifoldReady();
  const scaleMm = 145 / 169.2;
  const c1 = mf.Manifold.cube([5, 5, 5], false);
  const c2 = mf.Manifold.cube([5, 5, 5], false).translate([5, 5, 0]);
  const pinched = c1.add(c2);
  c1.delete();
  c2.delete();

  const tris = core.extractDePinchedStlTriangles(mf, pinched, 0, scaleMm);
  pinched.delete();

  const bytes = stlMod.buildSTLBytesFromTriangles(tris, 84.6, 84.6, scaleMm, 145, 145, {}, true, 0);
  const audit = auditBinaryStlRound4(bytes);
  assert.equal(audit.nTris, 24);
  assert.equal(audit.nanInf, 0);
  assert.equal(audit.degen, 0);
  assert.equal(audit.le1e9, 0);
  assert.equal(audit.openEdges, 0);
  assert.equal(audit.nonManifoldEdges, 0);
  assert.equal(audit.badHalfEdges, 0);
  assert.equal(audit.nonManifoldVerts, 0);
});

