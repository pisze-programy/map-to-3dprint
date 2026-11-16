// ============================================================================
// src/geometry/manifold_core.js
// Unified Dual-Runtime Geometry Kernel (Manifold 3.5.5 WASM + Clipper2 +
// Straight-Skeleton + Delatin + Earcut + Dual Scene/OSM Projection Helpers)
// ZERO external non-permissive deps, ZERO proper-noun heuristics.
// ============================================================================

(function (root) {
  function _tryRequireLocal(relPath) {
    try {
      let _req = (typeof require === 'function') ? require : null;
      if (!_req && typeof process !== 'undefined') {
        if (typeof process.getBuiltinModule === 'function') {
          const mod = process.getBuiltinModule('module');
          if (mod && typeof mod.createRequire === 'function') {
            _req = mod.createRequire(process.cwd() + '/src/geometry/manifold_core.js');
          }
        } else if (process.mainModule && typeof process.mainModule.require === 'function') {
          _req = process.mainModule.require.bind(process.mainModule);
        }
      }
      if (_req) return _req(relPath);
    } catch (_) {}
    return null;
  }

  function ensureVendorGlobals() {
    if (typeof root.__OSMTOGEOJSON__ === 'undefined' || typeof root.__CLIPPER2__ === 'undefined') {
      const vb = _tryRequireLocal('../vendor/vendor_bundle.js');
      if (vb) {
        if (vb.osmtogeojson) root.__OSMTOGEOJSON__ = vb.osmtogeojson;
        if (vb.Delatin) root.__DELATIN__ = vb.Delatin;
        if (vb.earcut) root.__EARCUT__ = vb.earcut;
        if (vb.fflate) root.__FFLATE__ = vb.fflate;
        if (vb.clipper2) root.__CLIPPER2__ = vb.clipper2;
        if (vb.straightSkeleton) root.__STRAIGHT_SKELETON__ = vb.straightSkeleton;
      }
    }
    if (typeof root.__getManifoldSync === 'undefined') {
      const mv = _tryRequireLocal('../vendor/manifold_vendor.js');
      if (mv) {
        if (mv.__ensureManifoldReady) root.__ensureManifoldReady = mv.__ensureManifoldReady;
        if (mv.__getManifoldSync) root.__getManifoldSync = mv.__getManifoldSync;
      }
    }
    if (typeof root.resolveSceneScaleAndSpec === 'undefined') {
      const cfg = _tryRequireLocal('./print_physics_config.js');
      if (cfg) Object.assign(root, cfg);
    }
    if (typeof root.SLA_PRINT_LAWS === 'undefined' || typeof root.MONO4_SPEC === 'undefined') {
      const laws = _tryRequireLocal('./sla_print_laws.js');
      if (laws) Object.assign(root, laws);
    }
  }

  function getManifoldLib() {
    ensureVendorGlobals();
    if (root.__MANIFOLD_LIB__) return root.__MANIFOLD_LIB__;
    if (typeof root.__getManifoldSync === 'function') {
      return root.__getManifoldSync();
    }
    throw new Error('Manifold WASM runtime not initialized (call await __ensureManifoldReady() first in browser)');
  }

  async function ensureManifoldLibAsync() {
    ensureVendorGlobals();
    if (root.__MANIFOLD_LIB__) return root.__MANIFOLD_LIB__;
    if (typeof root.__ensureManifoldReady === 'function') {
      return await root.__ensureManifoldReady();
    }
    return getManifoldLib();
  }

  function getVendorDeps() {
    ensureVendorGlobals();
    return {
      osmtogeojson: root.__OSMTOGEOJSON__,
      Delatin: root.__DELATIN__,
      earcut: root.__EARCUT__,
      fflate: root.__FFLATE__,
      Clipper2: root.__CLIPPER2__,
      StraightSkeleton: root.__STRAIGHT_SKELETON__,
    };
  }

  // --------------------------------------------------------------------------
  // Deterministic 2D Ring & Clipper2 (SCALE = 100000) Vector Topology Helpers
  // --------------------------------------------------------------------------
  const CLIPPER_SCALE = 100000;

  function signedArea2D(ring) {
    if (!ring || ring.length < 3) return 0;
    let s = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return 0.5 * s;
  }

  function ensureWinding(ring, wantCCW = true, minDist = 4e-4) {
    if (!Array.isArray(ring) || ring.length < 3) return [];
    const pts = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      if (pts.length === 0 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > minDist) {
        pts.push([p[0], p[1]]);
      }
    }
    if (pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= minDist) {
      pts.pop();
    }
    if (pts.length < 3) return [];
    const a = signedArea2D(pts);
    if (Math.abs(a) < 1e-7) return [];
    if (wantCCW === true && a < 0) pts.reverse();
    else if (wantCCW === false && a > 0) pts.reverse();
    return pts;
  }

  function toPath64(C2, ring, wantCCW = null) {
    const clean = ensureWinding(ring, wantCCW, 1e-4);
    if (clean.length < 3) return null;
    const p = [];
    for (let i = 0; i < clean.length; i++) {
      const x = Math.round(clean[i][0] * CLIPPER_SCALE);
      const y = Math.round(clean[i][1] * CLIPPER_SCALE);
      if (p.length === 0 || p[p.length - 1].x !== x || p[p.length - 1].y !== y) {
        p.push({ x, y });
      }
    }
    if (p.length >= 2 && p[0].x === p[p.length - 1].x && p[0].y === p[p.length - 1].y) {
      p.pop();
    }
    return p.length >= 3 ? p : null;
  }

  function fromPaths64(paths64, minAreaUnits = 1e-5) {
    if (!paths64) return [];
    const out = [];
    for (let i = 0; i < paths64.length; i++) {
      const p = paths64[i];
      if (!p || p.length < 3) continue;
      const ring = [];
      for (let j = 0; j < p.length; j++) {
        const pt = p[j];
        const x = Number(pt.x) / CLIPPER_SCALE;
        const y = Number(pt.y) / CLIPPER_SCALE;
        if (ring.length === 0 || Math.hypot(x - ring[ring.length - 1][0], y - ring[ring.length - 1][1]) > 4e-4) {
          ring.push([x, y]);
        }
      }
      if (ring.length >= 2 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) <= 4e-4) {
        ring.pop();
      }
      if (ring.length >= 3 && Math.abs(signedArea2D(ring)) >= minAreaUnits) {
        out.push(ring);
      }
    }
    return out;
  }

  function _runClipperOp(clipType, subjPolys, clipPolys = [], fillRuleName = 'NonZero', minArea = 1e-5) {
    const { Clipper2: C2 } = getVendorDeps();
    const subj = [];
    for (let i = 0; i < (subjPolys || []).length; i++) {
      const p = toPath64(C2, subjPolys[i], null);
      if (p) subj.push(p);
    }
    if (subj.length === 0) return [];
    const clip = [];
    for (let i = 0; i < (clipPolys || []).length; i++) {
      const p = toPath64(C2, clipPolys[i], null);
      if (p) clip.push(p);
    }
    const c = new C2.Clipper64();
    c.preserveCollinear = false;
    c.addPaths(subj, C2.PathType.Subject);
    if (clip.length > 0) c.addPaths(clip, C2.PathType.Clip);
    const sol = [];
    const fr = C2.FillRule[fillRuleName] !== undefined ? C2.FillRule[fillRuleName] : C2.FillRule.NonZero;
    c.execute(clipType, fr, sol);
    return fromPaths64(sol, minArea);
  }

  function clipperUnionPolys(polys, minArea = 1e-5) {
    if (!polys || polys.length === 0) return [];
    const { Clipper2: C2 } = getVendorDeps();
    return _runClipperOp(C2.ClipType.Union, polys, [], 'NonZero', minArea);
  }

  function clipperIntersectPolys(subjPolys, clipPolys, minArea = 1e-5) {
    if (!subjPolys || subjPolys.length === 0 || !clipPolys || clipPolys.length === 0) return [];
    const { Clipper2: C2 } = getVendorDeps();
    return _runClipperOp(C2.ClipType.Intersection, subjPolys, clipPolys, 'NonZero', minArea);
  }

  function clipperDiffPolys(subjPolys, clipPolys, minArea = 1e-5) {
    if (!subjPolys || subjPolys.length === 0) return [];
    if (!clipPolys || clipPolys.length === 0) return clipperUnionPolys(subjPolys, minArea);
    const { Clipper2: C2 } = getVendorDeps();
    return _runClipperOp(C2.ClipType.Difference, subjPolys, clipPolys, 'NonZero', minArea);
  }

  function clipperOffsetPolys(polys, delta, joinTypeName = 'Miter', minArea = 1e-5) {
    if (!polys || polys.length === 0) return [];
    const { Clipper2: C2 } = getVendorDeps();
    const paths = [];
    for (let i = 0; i < polys.length; i++) {
      const p = toPath64(C2, polys[i], true);
      if (p) paths.push(p);
    }
    if (paths.length === 0) return [];
    const jt = C2.JoinType[joinTypeName] || C2.JoinType.Miter;
    const arcTol = Math.max(80, Math.min(2500, Math.abs(delta) * CLIPPER_SCALE * 0.035));
    const sol = C2.inflatePaths(paths, delta * CLIPPER_SCALE, jt, C2.EndType.Polygon, 2.5, arcTol);
    return fromPaths64(sol, minArea);
  }

  function clipperBufferOpenPaths(linesAndWidths, joinTypeName = 'Round', minArea = 1e-5) {
    if (!linesAndWidths || linesAndWidths.length === 0) return [];
    const { Clipper2: C2 } = getVendorDeps();
    const allPolys = [];
    const jt = C2.JoinType[joinTypeName] || C2.JoinType.Round;
    for (let i = 0; i < linesAndWidths.length; i++) {
      const item = linesAndWidths[i];
      const pts = item.pts || item;
      const halfW = Math.max(0.01, Number(item.halfW || item.width * 0.5 || 0.35));
      if (!pts || pts.length < 2) continue;
      const path64 = [];
      for (let j = 0; j < pts.length; j++) {
        const pt = pts[j];
        if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
        const x = Math.round(pt[0] * CLIPPER_SCALE);
        const y = Math.round(pt[1] * CLIPPER_SCALE);
        if (path64.length === 0 || path64[path64.length - 1].x !== x || path64[path64.length - 1].y !== y) {
          path64.push({ x, y });
        }
      }
      if (path64.length < 2) continue;
      const arcTol = Math.max(80, Math.min(2500, halfW * CLIPPER_SCALE * 0.035));
      const sol = C2.inflatePaths([path64], halfW * CLIPPER_SCALE, jt, item.squareEnd ? C2.EndType.Square : C2.EndType.Round, 2.0, arcTol);
      const res = fromPaths64(sol, minArea);
      for (let r = 0; r < res.length; r++) allPolys.push(res[r]);
    }
    if (allPolys.length <= 1) return allPolys;
    return clipperUnionPolys(allPolys, minArea);
  }

  // Group Clipper2 Positive+Negative rings into [{ outer, holes }] via strictly-interior point containment
  function ringsToOutersWithHoles(rings, minArea = 1e-5) {
    const outers = [];
    const holes = [];
    const ringBBox = (poly) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const x = poly[i][0], y = poly[i][1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return [x0, y0, x1, y1];
    };
    for (let i = 0; i < (rings || []).length; i++) {
      const r = rings[i];
      if (!r || r.length < 3) continue;
      const a = signedArea2D(r);
      if (Math.abs(a) < minArea) continue;
      if (a > 0) outers.push({ outer: r, holes: [], area: a, bb: ringBBox(r) });
      else holes.push({ ring: r, area: Math.abs(a), bb: ringBBox(r) });
    }
    const ptInRing = (px, py, poly) => {
      let inside = false;
      for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
      }
      return inside;
    };
    // Computes a point guaranteed strictly inside `poly` (crucial for C-shaped / concave islands like Palm Crescent)
    const strictlyInteriorPt = (poly, bb) => {
      let cx = 0, cy = 0;
      for (let k = 0; k < poly.length; k++) { cx += poly[k][0]; cy += poly[k][1]; }
      cx /= poly.length; cy /= poly.length;
      if (ptInRing(cx, cy, poly)) return [cx, cy];

      const dy = bb[3] - bb[1];
      if (dy > 1e-9) {
        let bestMid = null, bestSpan = -1;
        for (const frac of [0.5, 0.37, 0.63, 0.25, 0.75]) {
          const sy = bb[1] + dy * frac;
          const xs = [];
          for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
            const yi = poly[i][1], yj = poly[j][1];
            if ((yi > sy) !== (yj > sy)) {
              xs.push(poly[i][0] + ((poly[j][0] - poly[i][0]) * (sy - yi)) / (yj - yi));
            }
          }
          xs.sort((a, b) => a - b);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const span = xs[k + 1] - xs[k];
            if (span > bestSpan) {
              const mx = (xs[k] + xs[k + 1]) * 0.5;
              if (ptInRing(mx, sy, poly)) { bestSpan = span; bestMid = [mx, sy]; }
            }
          }
        }
        if (bestMid) return bestMid;
      }

      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const dx = b[0] - a[0], edy = b[1] - a[1], len = Math.hypot(dx, edy);
        if (len < 1e-7) continue;
        const mx = (a[0] + b[0]) * 0.5, my = (a[1] + b[1]) * 0.5;
        const eps = Math.min(len * 0.15, 1e-3);
        const nx = -edy / len, ny = dx / len;
        if (ptInRing(mx + nx * eps, my + ny * eps, poly)) return [mx + nx * eps, my + ny * eps];
        if (ptInRing(mx - nx * eps, my - ny * eps, poly)) return [mx - nx * eps, my - ny * eps];
      }
      return [poly[0][0], poly[0][1]];
    };

    for (let hi = 0; hi < holes.length; hi++) {
      const h = holes[hi];
      const ip = strictlyInteriorPt(h.ring, h.bb);
      let best = null;
      for (let oi = 0; oi < outers.length; oi++) {
        const o = outers[oi];
        if (o.area <= h.area * 1.0001) continue;
        if (best && o.area >= best.area) continue;
        if (ip[0] < o.bb[0] - 1e-4 || ip[0] > o.bb[2] + 1e-4 || ip[1] < o.bb[1] - 1e-4 || ip[1] > o.bb[3] + 1e-4) continue;
        if (ptInRing(ip[0], ip[1], o.outer)) {
          best = o;
        }
      }
      if (best) best.holes.push(h.ring);
    }
    return outers.map(o => ({ outer: o.outer, holes: o.holes, area: o.area }));
  }

  // --------------------------------------------------------------------------
  // Manifold Construction, Boolean Batching & Triangle Soup Packing
  // --------------------------------------------------------------------------

  function safeDeleteManifold(m) {
    try {
      if (m && typeof m.delete === 'function' && (!m.isDeleted || !m.isDeleted())) {
        m.delete();
      }
    } catch (_) {}
  }

  function batchUnionManifolds(mf, list) {
    if (!list || list.length === 0) return null;
    if (list.length === 1) return list[0];
    // Balanced binary union tree prevents O(N^2) cascading boolean slowdown
    let cur = list.slice();
    while (cur.length > 1) {
      const next = [];
      for (let i = 0; i < cur.length; i += 8) {
        const chunk = cur.slice(i, i + 8);
        if (chunk.length === 1) {
          next.push(chunk[0]);
        } else {
          const u = mf.Manifold.union(chunk);
          for (let k = 0; k < chunk.length; k++) safeDeleteManifold(chunk[k]);
          next.push(u);
        }
      }
      cur = next;
    }
    return cur[0];
  }

  function extrudeRingSolid(mf, outer, holes, zMin, zMax) {
    if (!(zMax > zMin + 1e-5)) return null;
    const ccwOuter = ensureWinding(outer, true, 1e-4);
    if (ccwOuter.length < 3) return null;
    const polyList = [ccwOuter];
    for (let i = 0; i < (holes || []).length; i++) {
      const cwHole = ensureWinding(holes[i], false, 1e-4);
      if (cwHole.length >= 3) polyList.push(cwHole);
    }
    let cs = null;
    let man = null;
    try {
      cs = mf.CrossSection.ofPolygons(polyList, 'Positive');
      if (cs.isEmpty && cs.isEmpty()) return null;
      const h = zMax - zMin;
      man = cs.extrude(h);
      if (Math.abs(zMin) > 1e-7) {
        const shifted = man.translate([0, 0, zMin]);
        man.delete();
        man = shifted;
      }
      if (!man || (man.isEmpty && man.isEmpty()) || man.numTri() === 0) {
        safeDeleteManifold(man);
        return null;
      }
      return man;
    } catch (_) {
      safeDeleteManifold(man);
      return null;
    } finally {
      safeDeleteManifold(cs);
    }
  }

  function manifoldFromRawSoup(mf, positions, indices, mergeTol = 1e-5) {
    if (!positions || positions.length < 9 || !indices || indices.length < 3) return null;
    try {
      const mesh = new mf.Mesh({
        numProp: 3,
        vertProperties: positions instanceof Float32Array ? positions : new Float32Array(positions),
        triVerts: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
        tolerance: mergeTol,
      });
      mesh.merge();
      const man = new mf.Manifold(mesh);
      if (man.status() !== 'NoError' || man.numTri() === 0) {
        man.delete();
        return null;
      }
      return man;
    } catch (_) {
      return null;
    }
  }

  function trianglesToShellManifolds(mf, tris) {
    if (!mf || !Array.isArray(tris) || tris.length === 0) return [];
    const groups = new Map();
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const key = `${t.mBatch !== undefined ? t.mBatch : -1}|${t.layerId ?? 0}|${t.tileId ?? 0}|${t.shellId ?? 0}`;
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(t);
    }
    const solids = [];
    for (const gTris of groups.values()) {
      let man = null;
      const allBatch = gTris.every(t => t.mBatch !== undefined && t.vi0 !== undefined && t.vi1 !== undefined && t.vi2 !== undefined);
      if (allBatch) {
        const viToIdx = new Map();
        const pos = [];
        const idx = new Uint32Array(gTris.length * 3);
        let nIdx = 0;
        const regVert = (vi, v) => {
          let li = viToIdx.get(vi);
          if (li === undefined) {
            li = pos.length / 3;
            viToIdx.set(vi, li);
            pos.push(v[0], v[1], v[2]);
          }
          return li;
        };
        for (let i = 0; i < gTris.length; i++) {
          const t = gTris[i];
          const a = regVert(t.vi0, t.v0), b = regVert(t.vi1, t.v1), c = regVert(t.vi2, t.v2);
          if (a === b || b === c || c === a) continue;
          idx[nIdx++] = a; idx[nIdx++] = b; idx[nIdx++] = c;
        }
        if (nIdx >= 12) {
          try {
            const mesh = new mf.Mesh({
              numProp: 3,
              vertProperties: new Float32Array(pos),
              triVerts: nIdx === idx.length ? idx : idx.subarray(0, nIdx),
            });
            man = new mf.Manifold(mesh);
            if (man.status() !== 'NoError' || man.numTri() === 0) {
              safeDeleteManifold(man);
              man = null;
            }
          } catch (_) {
            safeDeleteManifold(man);
            man = null;
          }
        }
      }
      if (!man) {
        const vMap = new Map();
        const pos = [];
        const idx = [];
        const regPt = (p) => {
          const x = Math.fround(p[0]), y = Math.fround(p[1]), z = Math.fround(p[2]);
          const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
          let li = vMap.get(k);
          if (li === undefined) {
            li = pos.length / 3;
            vMap.set(k, li);
            pos.push(x, y, z);
          }
          return li;
        };
        for (let i = 0; i < gTris.length; i++) {
          const t = gTris[i];
          const a = regPt(t.v0), b = regPt(t.v1), c = regPt(t.v2);
          if (a === b || b === c || c === a) continue;
          idx.push(a, b, c);
        }
        if (idx.length >= 12) {
          man = manifoldFromRawSoup(mf, new Float32Array(pos), new Uint32Array(idx), 1e-4);
        }
      }
      if (man && man.numTri() > 0 && man.volume() > 1e-9) {
        solids.push(man);
      } else {
        safeDeleteManifold(man);
      }
    }
    return solids;
  }

  function boxManifoldFromBounds(mf, minX, maxX, minY, maxY, minZ, maxZ) {
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    if (dx <= 1e-5 || dy <= 1e-5 || dz <= 1e-5) return null;
    const raw = mf.Manifold.cube([dx, dy, dz], false);
    const shifted = raw.translate([minX, minY, minZ]);
    raw.delete();
    return shifted;
  }

  // Oriented box prism between two 3D points (for 3D struts, bridge cables, truss members, crane jibs)
  function beamManifoldBetween(mf, p0, p1, radius) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4 || radius < 1e-4) return null;
    const cyl = mf.Manifold.cylinder(len, radius, radius, 8, false);
    // Align +Z axis onto unit vector (dx, dy, dz) / len
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const pitchRad = Math.acos(Math.max(-1, Math.min(1, uz)));
    const pitchDeg = (pitchRad * 180) / Math.PI;
    const yawDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
    // Rotate around Y by pitchDeg (tilts +Z towards +X), then rotate around Z by yawDeg
    const r1 = cyl.rotate([0, pitchDeg, 0]);
    cyl.delete();
    const r2 = r1.rotate([0, 0, yawDeg]);
    r1.delete();
    const moved = r2.translate([p0[0], p0[1], p0[2]]);
    r2.delete();
    return moved;
  }

  let _nextManifoldBatchId = 0;

  function appendManifoldToTriangles(manifoldObj, outArr, layerId, buildingId = -1, tileId = 0, shellId = -1) {
    if (!manifoldObj) return 0;
    const numTri = manifoldObj.numTri();
    if (numTri <= 0) return 0;
    const m = manifoldObj.getMesh();
    const vp = m.vertProperties;
    const tv = m.triVerts;
    const np = m.numProp || 3;
    const nTri = Math.floor(tv.length / 3);
    if (nTri <= 0) return 0;

    const mBatch = ++_nextManifoldBatchId;
    let added = 0;
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3];
      const i1 = tv[t * 3 + 1];
      const i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;

      const b0 = i0 * np, b1 = i1 * np, b2 = i2 * np;
      const x0 = vp[b0], y0 = vp[b0 + 1], z0 = vp[b0 + 2];
      const x1 = vp[b1], y1 = vp[b1 + 1], z1 = vp[b1 + 2];
      const x2 = vp[b2], y2 = vp[b2 + 1], z2 = vp[b2 + 2];

      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
      const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl >= 1e-18 && Number.isFinite(nl)) {
        nx /= nl; ny /= nl; nz /= nl;
      } else {
        nx = 0; ny = 0; nz = 1;
      }

      outArr.push({
        v0: [x0, y0, z0],
        v1: [x1, y1, z1],
        v2: [x2, y2, z2],
        n: [nx, ny, nz],
        layerId,
        buildingId,
        tileId,
        shellId,
        mBatch,
        vi0: i0,
        vi1: i1,
        vi2: i2,
      });
      added++;
    }
    return added;
  }

  // Convert a Manifold to STL triangles while separating pinched/near-coincident vertices
  // so Float32 serialization preserves strict 0-open, 0-non-manifold, 0-degenerate topology.
  function extractDePinchedStlTriangles(mf, man, tid = 0, scaleMm = 1) {
    if (!man || man.numTri() === 0) return [];
    const scMm = Math.max(1e-4, Number(scaleMm) || 1);
    let src = man, ownsSrc = false;
    if (typeof man.simplify === 'function') {
      try {
        const tol = Math.max(1e-5, Math.min(1e-3, 0.0015 / scMm));
        const simp = man.simplify(tol);
        if (simp && simp.numTri() > 0) { src = simp; ownsSrc = true; }
        else safeDeleteManifold(simp);
      } catch (_) {}
    }
    const m = src.getMesh();
    const rawVp = m.vertProperties, tv = m.triVerts, np = m.numProp || 3;
    const nv = Math.floor(rawVp.length / np), nTri = Math.floor(tv.length / 3);
    const vp = new Float64Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      vp[v * 3] = rawVp[v * np];
      vp[v * 3 + 1] = rawVp[v * np + 1];
      vp[v * 3 + 2] = rawVp[v * np + 2];
    }

    const vNorm = new Float64Array(nv * 3);
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
      const a = i0 * 3, b = i1 * 3, c = i2 * 3;
      const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
      const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      vNorm[a] += nx; vNorm[a + 1] += ny; vNorm[a + 2] += nz;
      vNorm[b] += nx; vNorm[b + 1] += ny; vNorm[b + 2] += nz;
      vNorm[c] += nx; vNorm[c + 1] += ny; vNorm[c + 2] += nz;
    }

    const cellU = 0.001 / scMm, shiftU = 0.0015 / scMm;
    const minDistSq = (cellU * 0.5) * (cellU * 0.5);
    const grid = new Map();
    const cellKey = (x, y, z) => `${Math.floor(x / cellU)},${Math.floor(y / cellU)},${Math.floor(z / cellU)}`;
    const hasCloseVert = (x, y, z) => {
      const cx = Math.floor(x / cellU), cy = Math.floor(y / cellU), cz = Math.floor(z / cellU);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!list) continue;
            for (let k = 0; k < list.length; k++) {
              const oi = list[k] * 3;
              const ddx = x - vp[oi], ddy = y - vp[oi + 1], ddz = z - vp[oi + 2];
              if (ddx * ddx + ddy * ddy + ddz * ddz < minDistSq) return true;
            }
          }
        }
      }
      return false;
    };

    for (let v = 0; v < nv; v++) {
      const b = v * 3;
      let x = vp[b], y = vp[b + 1], z = vp[b + 2];
      const origZ = z;
      if (hasCloseVert(x, y, z)) {
        const nx = vNorm[b], ny = vNorm[b + 1], nz = vNorm[b + 2];
        const dirs = [[nx, ny, nz], [nx, ny, 0], [1, 0, 0], [0, 1, 0], [0, 0, origZ <= shiftU * 2 ? -1 : 1]];
        outer: for (let di = 0; di < dirs.length; di++) {
          let [dx, dy, dz] = dirs[di];
          const dl = Math.hypot(dx, dy, dz);
          if (dl < 1e-9) continue;
          dx /= dl; dy /= dl; dz /= dl;
          for (let step = 1; step <= 8; step++) {
            const tx = vp[b] - dx * shiftU * step;
            const ty = vp[b + 1] - dy * shiftU * step;
            const tz = vp[b + 2] - dz * shiftU * step;
            if (origZ >= 0 && tz < 0) continue;
            if (!hasCloseVert(tx, ty, tz)) { x = tx; y = ty; z = tz; break outer; }
          }
        }
        vp[b] = x; vp[b + 1] = y; vp[b + 2] = z;
      }
      const ck = cellKey(x, y, z);
      let arr = grid.get(ck);
      if (!arr) { arr = []; grid.set(ck, arr); }
      arr.push(v);
    }

    const out = [];
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3], i1 = tv[t * 3 + 1], i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      const b0 = i0 * 3, b1 = i1 * 3, b2 = i2 * 3;
      const x0 = vp[b0], y0 = vp[b0 + 1], z0 = vp[b0 + 2];
      const x1 = vp[b1], y1 = vp[b1 + 1], z1 = vp[b1 + 2];
      const x2 = vp[b2], y2 = vp[b2 + 1], z2 = vp[b2 + 2];
      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
      const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl >= 1e-18 && Number.isFinite(nl)) { nx /= nl; ny /= nl; nz /= nl; }
      else { nx = 0; ny = 0; nz = 1; }
      out.push({ v0: [x0, y0, z0], v1: [x1, y1, z1], v2: [x2, y2, z2], n: [nx, ny, nz], layerId: 1, buildingId: -1, tileId: tid, shellId: 1 });
    }
    if (ownsSrc) safeDeleteManifold(src);
    return out;
  }

  // Build standardized 3-Layer Build Context matching exact scene bounds & printer physics
  function createBuildContext(scene, state, options = {}) {
    ensureVendorGlobals();
    const mf = getManifoldLib();
    const cfg = root.PRINT_PHYSICS_CONFIG || {};
    const spec = (typeof root.resolveSceneScaleAndSpec === 'function')
      ? root.resolveSceneScaleAndSpec(state || {}, scene || {})
      : null;

    const halfW = (spec && spec.halfW) || (scene && scene.halfW) || 84.6;
    const halfH = (spec && spec.halfH) || (scene && scene.halfH) || 84.6;
    const totalWidthMm = (spec && spec.totalWidthMm) || (Number(state && state.bedSizeMm) || 320);
    const totalHeightMm = (spec && spec.totalHeightMm) || (Number(state && state.totalHeightMm) || totalWidthMm);
    const mToU = (spec && spec.mToU) || (scene && scene.metersToUnits) || (169.2 / 1200);
    const scaleMm = (spec && spec.scaleMm) || (Math.max(totalWidthMm, totalHeightMm) / (2 * Math.max(halfW, halfH)));
    const tileCols = Math.max(1, (state && state.tileCols) | 0 || 1);
    const tileRows = Math.max(1, (state && state.tileRows) | 0 || 1);
    const isResin = true;
    const printSpec = (spec && spec.printSpec) || {};
    const xyPixelMm = (printSpec && printSpec.xyPixelMm) || (root.MONO4_SPEC && root.MONO4_SPEC.xyPixelMm) || 0.017;
    const supportlessMode = Boolean(state && state.supportlessMode);
    const slaLaws = root.SLA_PRINT_LAWS || (typeof SLA_PRINT_LAWS !== 'undefined' ? SLA_PRINT_LAWS : null);
    const defKerfMm = printSpec.defaultKerfMm !== undefined ? printSpec.defaultKerfMm : 0.08;
    const rawKerfMm = (state && state.kerfMm !== undefined) ? Number(state.kerfMm) : defKerfMm;
    const halfKerfMm = (tileCols > 1 || tileRows > 1) ? Math.max(0, rawKerfMm * 0.5) : 0.0;
    const kerfUnits = halfKerfMm / scaleMm;

    const tileBounds = [];
    const colSpan = (2 * halfW) / tileCols;
    const rowSpan = (2 * halfH) / tileRows;
    for (let tr = 0; tr < tileRows; tr++) {
      const northRow = tileRows - tr;
      const rawMinY = -halfH + tr * rowSpan;
      const rawMaxY = (tr === tileRows - 1) ? halfH : (-halfH + (tr + 1) * rowSpan);
      for (let tc = 0; tc < tileCols; tc++) {
        const colNum = tc + 1;
        const rawMinX = -halfW + tc * colSpan;
        const rawMaxX = (tc === tileCols - 1) ? halfW : (-halfW + (tc + 1) * colSpan);
        const minX = rawMinX + (tc > 0 ? kerfUnits : 0);
        const maxX = rawMaxX - (tc < tileCols - 1 ? kerfUnits : 0);
        const minY = rawMinY + (tr > 0 ? kerfUnits : 0);
        const maxY = rawMaxY - (tr < tileRows - 1 ? kerfUnits : 0);
        tileBounds.push({
          tileId: tr * tileCols + tc,
          tr,
          tc,
          northRow,
          colNum,
          label: `R${northRow}C${colNum}`,
          rawMinX, rawMaxX, rawMinY, rawMaxY,
          minX, maxX, minY, maxY,
        });
      }
    }

    const mono4Cfg = cfg.photonMono4 || {};
    const bedZMm = Number(state && state.bedZ) || mono4Cfg.bedZMm || 165.0;
    const zCapLimitMm = Math.max(10.0, bedZMm - (mono4Cfg.safeMarginZMm || 2.0));
    const zScale = Math.max(0.1, Number((state && state.zScale) ?? 1.25));
    const terrainScale = Math.max(0.1, Number((state && state.terrainScale) ?? 1.15));
    const waterCutout = Boolean(state && state.waterCutout);
    const hollowBase = Boolean(state && state.hollowBase);
    const hollowWallMm = Math.max(0.8, Number((state && state.hollowWallMm) ?? 1.8));
    const isExport = Boolean((options && options.isExport) || (state && state.isExport));
    const minFeatureMm = (printSpec && printSpec.minFeatureMm) || 0.12;
    const minPrintU = Math.max(minFeatureMm / scaleMm, 0.22 / scaleMm);
    const quantizeZUnits = (spec && spec.quantizeZUnits) ? spec.quantizeZUnits : ((z) => z);

    // Exact toBed coordinate mapping matching terrain_masks.js
    const baseCrop = (scene && scene._fetchedCropRatio) || 1.0;
    const cropBounds = (root.OSM_METRIC_CONFIG && root.OSM_METRIC_CONFIG.cropRatioBounds) || [0.22, 1.0];
    const reqCrop = (state && typeof state.cropRatio === 'number' && Number.isFinite(state.cropRatio))
      ? state.cropRatio : 0.88;
    const effectiveCrop = Math.min(cropBounds[1], Math.max(cropBounds[0], reqCrop / baseCrop));
    const cropCX = (Number(state && state.cropCenterX) || 0) * halfW;
    const cropCY = (Number(state && state.cropCenterY) || 0) * halfH;
    const scaleToBed = 1.0 / effectiveCrop;
    const toBed = (pt) => [(pt[0] - cropCX) * scaleToBed, (pt[1] - cropCY) * scaleToBed];

    // DEM elevation mapper + continuous bilinear grid lookup in rotated/cropped bed coordinates
    const dem = (scene && scene.dem) || { gridSize: 8, minElev: 0, maxElev: 0, grid: [[0, 0], [0, 0]] };
    const demGrid = Array.isArray(dem.grid) && dem.grid.length > 0 ? dem.grid : [[0, 0], [0, 0]];
    const demRows = demGrid.length;
    const demCols = Array.isArray(demGrid[0]) ? demGrid[0].length : 2;
    const demHalfU = (scene && scene._demHalfUnits) || Math.max(halfW + 0.4, halfH + 0.4);
    const hasAppliedRot = Boolean(scene && typeof scene._appliedRotationDeg === 'number');
    const rotDeg = hasAppliedRot
      ? scene._appliedRotationDeg
      : Number((scene && scene._appliedRotDeg) ?? (state && state.mapRotationDeg) ?? 0);
    const padW = halfW + 0.4;
    const padH = halfH + 0.4;
    const demResampled = hasAppliedRot && (
      rotDeg !== 0 || Math.abs(demHalfU - padW) > 0.5 || Math.abs(demHalfU - padH) > 0.5
    );
    const demSpanX = demResampled ? padW : demHalfU;
    const demSpanY = demResampled ? padH : demHalfU;

    const allElevs = [];
    for (let r = 0; r < demRows; r++) {
      for (let c = 0; c < demCols; c++) {
        const v = Number(demGrid[r][c]);
        if (Number.isFinite(v)) allElevs.push(v);
      }
    }
    allElevs.sort((a, b) => a - b);
    const rawMin = allElevs.length ? allElevs[0] : 0;
    const rawMax = allElevs.length ? allElevs[allElevs.length - 1] : 0;
    const p05 = allElevs.length ? allElevs[Math.floor(allElevs.length * 0.05)] : 0;
    const hasMarineOrWater = Boolean(
      (scene && scene._hasMarineTags) ||
      (scene && scene.waterPolys && scene.waterPolys.length > 0) ||
      (scene && scene.waterLines && scene.waterLines.length > 0)
    );
    const clampFloorM = (rawMin < -3.0 && rawMax > 1.5 && hasMarineOrWater)
      ? Math.max(-2.0, Math.min(0.0, p05 > -3.0 ? p05 : -1.5))
      : rawMin;
    const effMinElev = Math.max(clampFloorM, rawMin);
    const elevReliefM = Math.max(0, rawMax - effMinElev);

    const sampleDemElevM = (bx, by) => {
      if (!Number.isFinite(bx) || !Number.isFinite(by)) return effMinElev;
      // Uncrop bed XY back into rotated scene XY
      const sx = bx * effectiveCrop + cropCX;
      const sy = by * effectiveCrop + cropCY;
      let ux = sx, uy = sy;
      if (!hasAppliedRot && rotDeg !== 0) {
        const rad = (-rotDeg * Math.PI) / 180.0;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);
        ux = sx * cosR - sy * sinR;
        uy = sx * sinR + sy * cosR;
      }
      // Note: dem.grid[0] is SOUTH (-demSpanY), dem.grid[demRows-1] is NORTH (+demSpanY)
      const fx = Math.max(0, Math.min(1, (ux + demSpanX) / (2 * demSpanX))) * (demCols - 1);
      const fy = Math.max(0, Math.min(1, (uy + demSpanY) / (2 * demSpanY))) * (demRows - 1);
      const c0 = Math.floor(fx), r0 = Math.floor(fy);
      const c1 = Math.min(demCols - 1, c0 + 1), r1 = Math.min(demRows - 1, r0 + 1);
      const tx = fx - c0, ty = fy - r0;
      const clampM = (v) => Math.max(effMinElev, Number.isFinite(v) ? v : effMinElev);
      const e00 = clampM(demGrid[r0][c0]), e10 = clampM(demGrid[r0][c1]);
      const e01 = clampM(demGrid[r1][c0]), e11 = clampM(demGrid[r1][c1]);
      return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
    };

    const baseBottomMm = cfg.baseBottomMm || 2.35;
    const deepWaterMm = cfg.deepWaterMm || 1.68;
    const subWaterMm = cfg.subWaterMm || 1.30;
    const drainVaultMm = cfg.drainVaultMm || 0.70;
    const zLandDatum = baseBottomMm / scaleMm;
    const baseThickU = zLandDatum;
    // Scale relief physically, clamping softly only when mountains would consume >42% of Z build height
    const maxTerrainUnits = (zCapLimitMm * 0.42) / scaleMm;
    const rawRelToUnits = mToU * terrainScale;
    const effTerrainMult = (elevReliefM * rawRelToUnits > maxTerrainUnits && elevReliefM > 1e-3)
      ? (maxTerrainUnits / (elevReliefM * rawRelToUnits))
      : 1.0;

    const elevToZ = (elevM) => zLandDatum + Math.max(0, elevM - effMinElev) * rawRelToUnits * effTerrainMult;
    const zWaterTop = deepWaterMm / scaleMm;
    const zWaterCarveFloor = waterCutout ? 0.0 : (subWaterMm / scaleMm);
    const zDrainVault = drainVaultMm / scaleMm;

    // Coordinate converter for raw OSM lat/lon elements -> exact current bed XY
    const centerLat = (scene && Array.isArray(scene.center) && scene.center[0]) || 0;
    const centerLon = (scene && Array.isArray(scene.center) && scene.center[1]) || 0;
    const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180.0));
    const rawMToU = (scene && scene.metersToUnits) || mToU;
    const rotRad = (rotDeg * Math.PI) / 180.0;
    const cosRot = Math.cos(rotRad), sinRot = Math.sin(rotRad);
    const latLonToScene = (lat, lon) => {
      const xm = (lon - centerLon) * 111320.0 * cosLat;
      const ym = (lat - centerLat) * 111320.0;
      const ux = xm * rawMToU;
      const uy = ym * rawMToU;
      const rx = rotDeg === 0 ? ux : (ux * cosRot - uy * sinRot);
      const ry = rotDeg === 0 ? uy : (ux * sinRot + uy * cosRot);
      return toBed([rx, ry]);
    };

    const pickIdMap = new Map();
    let nextPickId = 1;
    const allocPickId = (info = null) => {
      const id = nextPickId++;
      if (info) {
        pickIdMap.set(id, {
          ...info,
          id: info.id !== undefined ? info.id : info.buildingId,
        });
      }
      return id;
    };

    return {
      mf,
      scene,
      state: state || {},
      options,
      spec,
      cfg,
      halfW,
      halfH,
      totalWidthMm,
      totalHeightMm,
      mToU,
      rawMToU,
      scaleMm,
      minPrintU,
      tileCols,
      tileRows,
      tileBounds,
      bedZMm,
      zCapLimitMm,
      maxZUnits: zCapLimitMm / scaleMm,
      zScale,
      terrainScale,
      kerfMm: rawKerfMm,
      kerfUnits,
      effectiveCrop,
      cropCX,
      cropCY,
      scaleToBed,
      toBed,
      waterCutout,
      hollowBase,
      hollowWallMm,
      isExport,
      isResin,
      xyPixelMm,
      supportlessMode,
      slaLaws,
      rotDeg,
      baseThickU,
      baseBottomZ: 0.0,
      zLandDatum,
      zWaterTop,
      zSubWater: zWaterCarveFloor,
      zWaterCarveFloor,
      zDrainVault,
      effMinElev,
      rawMaxElev: rawMax,
      elevReliefM,
      sampleDemElevM,
      elevToZ,
      getTerrainZ: (x, y) => elevToZ(sampleDemElevM(x, y)),
      latLonToScene,
      quantizeZUnits,
      pickIdMap,
      allocPickId,
      audit: {
        osmElements: (scene && scene.osmElements) || [],
        preparedList: [],
        s3dbAllFinalBuildings: [],
        bridgeAudits: [],
        archetypeCounts: {},
        invariants: null,
      },
    };
  }

  const exportsObj = {
    getManifoldLib,
    ensureManifoldLibAsync,
    getVendorDeps,
    CLIPPER_SCALE,
    signedArea2D,
    ensureWinding,
    clipperUnionPolys,
    clipperIntersectPolys,
    clipperDiffPolys,
    clipperOffsetPolys,
    clipperBufferOpenPaths,
    ringsToOutersWithHoles,
    safeDeleteManifold,
    batchUnionManifolds,
    extrudeRingSolid,
    manifoldFromRawSoup,
    trianglesToShellManifolds,
    boxManifoldFromBounds,
    beamManifoldBetween,
    appendManifoldToTriangles,
    extractDePinchedStlTriangles,
    createBuildContext,
  };

  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
