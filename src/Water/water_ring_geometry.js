// ============================================================================
// src/Water/water_ring_geometry.js
// Shared 2D Polygon, Ring, Containment & Polyline Clipping Primitives
// ============================================================================

(function (root) {
  function simplifyRingJS(pts, tol = 0.015) {
    if (!pts || pts.length < 4) return pts || [];
    const out = [pts[0]], tolSq = tol * tol;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], last = out[out.length - 1];
      const dx = p[0] - last[0], dy = p[1] - last[1];
      if (dx * dx + dy * dy >= tolSq) out.push(p);
    }
    if (out.length >= 3 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out;
  }

  function stitchWayRingsJS(wayNodeLists) {
    const rings = [];
    const openSegs = (wayNodeLists || []).filter(w => w && w.length >= 2).map(w => w.slice());
    while (openSegs.length > 0) {
      let curr = openSegs.shift();
      if (curr[0] === curr[curr.length - 1]) {
        if (curr.length >= 4) rings.push(curr);
        continue;
      }
      let changed = true;
      while (changed && curr[0] !== curr[curr.length - 1]) {
        changed = false;
        for (let i = 0; i < openSegs.length; i++) {
          const seg = openSegs[i];
          let joined = null;
          if (seg[0] === curr[curr.length - 1]) joined = curr.concat(seg.slice(1));
          else if (seg[seg.length - 1] === curr[curr.length - 1]) joined = curr.concat(seg.slice(0, -1).reverse());
          else if (seg[seg.length - 1] === curr[0]) joined = seg.slice(0, -1).concat(curr);
          else if (seg[0] === curr[0]) joined = seg.slice(1).reverse().concat(curr);
          if (joined) { curr = joined; openSegs.splice(i, 1); changed = true; break; }
        }
      }
      if (curr.length >= 4) {
        if (curr[0] !== curr[curr.length - 1]) curr.push(curr[0]);
        rings.push(curr);
      }
    }
    return rings;
  }

  function polyAreaSignedJS(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      a += p1[0] * p2[1] - p2[0] * p1[1];
    }
    return a * 0.5;
  }

  function pointInPolyLocal(px, py, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function _waterPointInPolyJS(px, py, poly) {
    return pointInPolyLocal(px, py, poly);
  }

  function _waterRingAbsAreaJS(ring) {
    return (!ring || ring.length < 3) ? 0 : Math.abs(polyAreaSignedJS(ring));
  }

  function _waterPointToRingDistSqJS(px, py, ring) {
    let minD2 = Infinity;
    for (let i = 0, n = ring.length; i < n; i++) {
      const ax = ring[i][0], ay = ring[i][1], bx = ring[(i + 1) % n][0], by = ring[(i + 1) % n][1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      if (d2 < minD2) minD2 = d2;
    }
    return minD2;
  }

  function _waterRingProbePtJS(ring) {
    if (!ring || ring.length === 0) return [0, 0];
    let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i][0], y = ring[i][1];
      cx += x; cy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    cx /= ring.length; cy /= ring.length;
    let bestPt = null, bestD2 = -1;
    const consider = (px, py) => {
      if (!_waterPointInPolyJS(px, py, ring)) return;
      const d2 = _waterPointToRingDistSqJS(px, py, ring);
      if (d2 > bestD2) { bestD2 = d2; bestPt = [px, py]; }
    };
    consider(cx, cy);
    const steps = 7;
    for (let iy = 1; iy < steps; iy++) {
      const py = minY + (iy / steps) * (maxY - minY);
      for (let ix = 1; ix < steps; ix++) consider(minX + (ix / steps) * (maxX - minX), py);
    }
    if (!bestPt) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
        consider((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3);
      }
    }
    return bestPt || [ring[0][0], ring[0][1]];
  }

  function _waterRingsMatchSameLoopJS(rA, rB) {
    if (!rA || !rB || rA.length < 3 || rB.length < 3) return false;
    const aA = _waterRingAbsAreaJS(rA), aB = _waterRingAbsAreaJS(rB);
    if (aA <= 1e-5 || aB <= 1e-5 || (aA > aB ? aA / aB : aB / aA) > 1.18) return false;
    const pA = _waterRingProbePtJS(rA), pB = _waterRingProbePtJS(rB);
    return _waterPointInPolyJS(pA[0], pA[1], rB) && _waterPointInPolyJS(pB[0], pB[1], rA);
  }

  function _waterRingStrictlyInsideOuterJS(hole, outer) {
    if (!hole || hole.length < 3 || !outer || outer.length < 3) return false;
    const probe = _waterRingProbePtJS(hole);
    if (!_waterPointInPolyJS(probe[0], probe[1], outer)) return false;
    for (let i = 0; i < hole.length; i++) if (!_waterPointInPolyJS(hole[i][0], hole[i][1], outer)) return false;
    return true;
  }

  function _pickLoopProbePtJS(poly, Cx, Cy) {
    let best = poly[0], bestMargin = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], m = Math.min(Cx - Math.abs(p[0]), Cy - Math.abs(p[1]));
      if (m > bestMargin) { bestMargin = m; best = p; }
    }
    return best;
  }

  function _buildPureLoopEntriesJS(closedLoops, Cx, Cy) {
    if (closedLoops.length === 0) return { outerEntries: [], outerPolys: [], innerPolys: [] };
    const sorted = closedLoops.slice().sort((a, b) => b.area - a.area);
    const n = sorted.length, parent = new Int32Array(n).fill(-1), isShell = new Array(n).fill(false);
    const probes = sorted.map(l => _pickLoopProbePtJS(l.poly, Cx, Cy));
    for (let i = 0; i < n; i++) {
      for (let j = i - 1; j >= 0; j--) if (pointInPolyLocal(probes[i][0], probes[i][1], sorted[j].poly)) { parent[i] = j; break; }
      isShell[i] = parent[i] === -1 ? (sorted[i].role !== 'inner') : !isShell[parent[i]];
    }
    const outerEntries = [], innerPolys = [];
    for (let i = 0; i < n; i++) if (!isShell[i]) innerPolys.push(sorted[i].poly);
    for (let i = 0; i < n; i++) {
      if (!isShell[i]) continue;
      const holes = [];
      for (let j = i + 1; j < n; j++) if (parent[j] === i && !isShell[j]) holes.push(sorted[j].poly);
      outerEntries.push({ outer: sorted[i].poly, holes });
    }
    return { outerEntries, outerPolys: outerEntries.map(e => e.outer), innerPolys };
  }

  function _extractRoleChainsJS(wayNodeLists, role, nodesToPts, Cx, Cy, tol, closedLoops, openChains) {
    const segs = (wayNodeLists || []).filter(w => w && w.length >= 2).map(w => w.slice());
    while (segs.length > 0) {
      let curr = segs.shift(), changed = true;
      while (changed && curr[0] !== curr[curr.length - 1]) {
        changed = false;
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          let joined = null;
          if (seg[0] === curr[curr.length - 1]) joined = curr.concat(seg.slice(1));
          else if (seg[seg.length - 1] === curr[curr.length - 1]) joined = curr.concat(seg.slice(0, -1).reverse());
          else if (seg[seg.length - 1] === curr[0]) joined = seg.slice(0, -1).concat(curr);
          else if (seg[0] === curr[0]) joined = seg.slice(1).reverse().concat(curr);
          if (joined) { curr = joined; segs.splice(i, 1); changed = true; break; }
        }
      }
      if (curr[0] === curr[curr.length - 1]) {
        if (curr.length >= 4) {
          const pts = nodesToPts(curr, tol);
          if (pts.length >= 3) {
            let outIdx = -1;
            for (let k = 0; k < pts.length; k++) {
              if (Math.abs(pts[k][0]) > Cx - 0.02 || Math.abs(pts[k][1]) > Cy - 0.02) { outIdx = k; break; }
            }
            if (outIdx === -1) {
              const area = Math.abs(polyAreaSignedJS(pts));
              if (area > 0.003) closedLoops.push({ poly: pts, area, role });
            } else {
              openChains.push({ pts: pts.slice(outIdx).concat(pts.slice(0, outIdx + 1)), role });
            }
          }
        }
      } else if (curr.length >= 2) {
        const pts = nodesToPts(curr, tol);
        if (pts.length >= 2) openChains.push({ pts, role });
      }
    }
  }

  function _clipSegmentLiangBarsky(p0, p1, Cx, Cy) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    let t0 = 0.0, t1 = 1.0;
    const checks = [[-dx, p0[0] + Cx], [dx, Cx - p0[0]], [-dy, p0[1] + Cy], [dy, Cy - p0[1]]];
    for (let i = 0; i < 4; i++) {
      const p = checks[i][0], q = checks[i][1];
      if (Math.abs(p) < 1e-12) { if (q < 0) return null; }
      else {
        const r = q / p;
        if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
    }
    if (t0 > t1) return null;
    const clampPt = (t) => [Math.max(-Cx, Math.min(Cx, p0[0] + t * dx)), Math.max(-Cy, Math.min(Cy, p0[1] + t * dy))];
    return { a: clampPt(t0), b: clampPt(t1), entered: t0 > 1e-6, exited: t1 < 1.0 - 1e-6 };
  }

  function _clipPolylineToRectPieces(pts, Cx, Cy) {
    const pieces = [];
    let cur = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = _clipSegmentLiangBarsky(pts[i], pts[i + 1], Cx, Cy);
      if (!seg) { if (cur && cur.length >= 2) pieces.push(cur); cur = null; continue; }
      if (!cur || seg.entered) {
        if (cur && cur.length >= 2) pieces.push(cur);
        cur = [seg.a, seg.b];
      } else {
        const last = cur[cur.length - 1];
        if (Math.hypot(seg.b[0] - last[0], seg.b[1] - last[1]) > 1e-4) cur.push(seg.b);
      }
      if (seg.exited) { if (cur && cur.length >= 2) pieces.push(cur); cur = null; }
    }
    if (cur && cur.length >= 2) pieces.push(cur);
    return pieces;
  }

  function _segmentsProperOrTouchIntersectJS(p1, p2, p3, p4) {
    if (Math.max(p1[0], p2[0]) < Math.min(p3[0], p4[0]) - 1e-6 || Math.min(p1[0], p2[0]) > Math.max(p3[0], p4[0]) + 1e-6 ||
        Math.max(p1[1], p2[1]) < Math.min(p3[1], p4[1]) - 1e-6 || Math.min(p1[1], p2[1]) > Math.max(p3[1], p4[1]) + 1e-6) return false;
    const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const onSeg = (a, b, c) => (
      c[0] >= Math.min(a[0], b[0]) - 1e-7 && c[0] <= Math.max(a[0], b[0]) + 1e-7 &&
      c[1] >= Math.min(a[1], b[1]) - 1e-7 && c[1] <= Math.max(a[1], b[1]) + 1e-7
    );
    const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2), d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
    if (((d1 > 1e-8 && d2 < -1e-8) || (d1 < -1e-8 && d2 > 1e-8)) &&
        ((d3 > 1e-8 && d4 < -1e-8) || (d3 < -1e-8 && d4 > 1e-8))) return true;
    return (Math.abs(d1) <= 1e-8 && onSeg(p3, p4, p1)) || (Math.abs(d2) <= 1e-8 && onSeg(p3, p4, p2)) ||
           (Math.abs(d3) <= 1e-8 && onSeg(p1, p2, p3)) || (Math.abs(d4) <= 1e-8 && onSeg(p1, p2, p4));
  }

  function _bridgeSegHitsPolylinesJS(pA, pB, chainPtsList, skipChainA, skipChainB, closedLoops) {
    const abx = pB[0] - pA[0], aby = pB[1] - pA[1], abLen = Math.hypot(abx, aby);
    if (abLen < 1e-7) return false;
    const isCollinearBacktrack = (origin, otherEnd, dirX, dirY) => {
      const vx = otherEnd[0] - origin[0], vy = otherEnd[1] - origin[1], vLen = Math.hypot(vx, vy);
      if (vLen < 1e-7 || (vx * dirX + vy * dirY) <= 0) return false;
      return Math.abs(vx * dirY - vy * dirX) <= 1e-5 * abLen * vLen;
    };
    for (let ci = 0; ci < chainPtsList.length; ci++) {
      const pts = chainPtsList[ci];
      if (!pts || pts.length < 2) continue;
      for (let k = 0; k < pts.length - 1; k++) {
        const s0 = pts[k], s1 = pts[k + 1];
        if (ci === skipChainA) {
          if (Math.hypot(s0[0] - pA[0], s0[1] - pA[1]) < 1e-5) { if (isCollinearBacktrack(pA, s1, abx, aby)) return true; continue; }
          if (Math.hypot(s1[0] - pA[0], s1[1] - pA[1]) < 1e-5) { if (isCollinearBacktrack(pA, s0, abx, aby)) return true; continue; }
        }
        if (ci === skipChainB) {
          if (Math.hypot(s0[0] - pB[0], s0[1] - pB[1]) < 1e-5) { if (isCollinearBacktrack(pB, s1, -abx, -aby)) return true; continue; }
          if (Math.hypot(s1[0] - pB[0], s1[1] - pB[1]) < 1e-5) { if (isCollinearBacktrack(pB, s0, -abx, -aby)) return true; continue; }
        }
        if (_segmentsProperOrTouchIntersectJS(pA, pB, s0, s1)) return true;
      }
    }
    if (closedLoops) {
      for (let li = 0; li < closedLoops.length; li++) {
        const poly = closedLoops[li].poly || closedLoops[li];
        if (!poly || poly.length < 3) continue;
        for (let k = 0; k < poly.length; k++) if (_segmentsProperOrTouchIntersectJS(pA, pB, poly[k], poly[(k + 1) % poly.length])) return true;
      }
    }
    return false;
  }

  const exportsObj = {
    polyAreaSignedJS, simplifyRingJS, stitchWayRingsJS, pointInPolyLocal,
    _pickLoopProbePtJS, _buildPureLoopEntriesJS,
    _extractRoleChainsJS, _clipPolylineToRectPieces, _bridgeSegHitsPolylinesJS,
    _waterPointInPolyJS, _waterRingAbsAreaJS, _waterPointToRingDistSqJS,
    _waterRingProbePtJS, _waterRingsMatchSameLoopJS, _waterRingStrictlyInsideOuterJS
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
