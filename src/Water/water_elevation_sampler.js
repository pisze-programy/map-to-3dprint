// ============================================================================
// src/Water/water_elevation_sampler.js
// 2D/3D Water Polygon Containment, Shoreline Distance & Terrain DEM Z Sampler
// ============================================================================

(function (root) {
  function _waterRingBBox(ring) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i][0], y = ring[i][1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
  }

  function _ptInRingLocal(px, py, poly) {
    let inside = false;
    for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  function _probeRingInteriorPt(poly) {
    if (!poly || poly.length < 3) return [0, 0];
    let cx = 0, cy = 0, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      cx += poly[i][0]; cy += poly[i][1];
      if (poly[i][1] < y0) y0 = poly[i][1];
      if (poly[i][1] > y1) y1 = poly[i][1];
    }
    cx /= poly.length; cy /= poly.length;
    if (_ptInRingLocal(cx, cy, poly)) return [cx, cy];
    const dy = y1 - y0;
    if (dy > 1e-9) {
      let bestMid = null, bestSpan = -1;
      for (const frac of [0.5, 0.37, 0.63, 0.25, 0.75]) {
        const sy = y0 + dy * frac, xs = [];
        for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
          const yi = poly[i][1], yj = poly[j][1];
          if ((yi > sy) !== (yj > sy)) xs.push(poly[i][0] + ((poly[j][0] - poly[i][0]) * (sy - yi)) / (yj - yi));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const span = xs[k + 1] - xs[k];
          if (span > bestSpan) {
            const mx = (xs[k] + xs[k + 1]) * 0.5;
            if (_ptInRingLocal(mx, sy, poly)) { bestSpan = span; bestMid = [mx, sy]; }
          }
        }
      }
      if (bestMid) return bestMid;
    }
    return [poly[0][0], poly[0][1]];
  }

  function _distSqToRingLocal(px, py, ring) {
    let best = Infinity;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const ax = ring[j][0], ay = ring[j][1], dx = ring[i][0] - ax, dy = ring[i][1] - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      if (d2 < best) best = d2;
    }
    return best;
  }

  function _ptInWaterEntryLocal(px, py, entry) {
    const bb = entry.bb || _waterRingBBox(entry.outer);
    if (px < bb[0] - 1e-9 || px > bb[2] + 1e-9 || py < bb[1] - 1e-9 || py > bb[3] + 1e-9) return false;
    if (!_ptInRingLocal(px, py, entry.outer)) return false;
    const holes = entry.holes || [];
    for (let h = 0; h < holes.length; h++) {
      if (_ptInRingLocal(px, py, holes[h])) return false;
    }
    return true;
  }

  function _distToWaterEntryLocal(px, py, entry) {
    if (_ptInWaterEntryLocal(px, py, entry)) return 0;
    let bestD2 = _distSqToRingLocal(px, py, entry.outer);
    const holes = entry.holes || [];
    for (let h = 0; h < holes.length; h++) {
      const d2 = _distSqToRingLocal(px, py, holes[h]);
      if (d2 < bestD2) bestD2 = d2;
    }
    return Math.sqrt(bestD2);
  }

  function _isPointNearWaterEntry(px, py, entry, maxDist) {
    const bb = entry.bb || _waterRingBBox(entry.outer);
    if (px < bb[0] - maxDist || px > bb[2] + maxDist || py < bb[1] - maxDist || py > bb[3] + maxDist) return false;
    if (_ptInWaterEntryLocal(px, py, entry)) return true;
    if (maxDist <= 0) return false;
    const maxD2 = maxDist * maxDist;
    if (_distSqToRingLocal(px, py, entry.outer) <= maxD2) return true;
    const holes = entry.holes || [];
    for (let h = 0; h < holes.length; h++) {
      if (_distSqToRingLocal(px, py, holes[h]) <= maxD2) return true;
    }
    return false;
  }

  function _computeMinWaterTerrainZ(ctx, wp, bb) {
    const effBB = bb || _waterRingBBox(wp.outer);
    let minZ = Infinity;
    const sampleXY = (x, y) => {
      const z = ctx.getTerrainZ(x, y);
      if (z < minZ) minZ = z;
    };
    const holes = wp.holes || [];
    const allRings = [wp.outer, ...holes];
    for (let r = 0; r < allRings.length; r++) {
      const ring = allRings[r];
      if (!ring || ring.length < 3) continue;
      const n = ring.length, vStride = n > 512 ? Math.max(1, Math.floor(n / 512)) : 1;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if (i % vStride === 0) sampleXY(a[0], a[1]);
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen > 3.0) {
          const steps = Math.min(64, Math.ceil(segLen / 3.0));
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            sampleXY(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
          }
        }
      }
    }
    const probe = _probeRingInteriorPt(wp.outer);
    if (_ptInWaterEntryLocal(probe[0], probe[1], { outer: wp.outer, holes, bb: effBB })) sampleXY(probe[0], probe[1]);

    const spanX = effBB[2] - effBB[0], spanY = effBB[3] - effBB[1], nSlices = 16;
    if (spanY > 1e-6) {
      for (let s = 0; s < nSlices; s++) {
        const sy = effBB[1] + spanY * ((s + 0.5) / nSlices), xs = [];
        for (let r = 0; r < allRings.length; r++) {
          const ring = allRings[r];
          for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
            const yi = ring[i][1], yj = ring[j][1];
            if ((yi > sy) !== (yj > sy)) xs.push(ring[i][0] + ((ring[j][0] - ring[i][0]) * (sy - yi)) / (yj - yi));
          }
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = xs[k], w = xs[k + 1] - x0;
          if (w <= 1e-6) continue;
          const sub = Math.max(1, Math.min(16, Math.ceil(w / 4.0)));
          for (let m = 0; m < sub; m++) sampleXY(x0 + w * ((m + 0.5) / sub), sy);
        }
      }
    }
    if (spanX > 1e-6) {
      for (let s = 0; s < nSlices; s++) {
        const sx = effBB[0] + spanX * ((s + 0.5) / nSlices), ys = [];
        for (let r = 0; r < allRings.length; r++) {
          const ring = allRings[r];
          for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
            const xi = ring[i][0], xj = ring[j][0];
            if ((xi > sx) !== (xj > sx)) ys.push(ring[i][1] + ((ring[j][1] - ring[i][1]) * (sx - xi)) / (xj - xi));
          }
        }
        ys.sort((a, b) => a - b);
        for (let k = 0; k + 1 < ys.length; k += 2) {
          const y0 = ys[k], h = ys[k + 1] - y0;
          if (h <= 1e-6) continue;
          const sub = Math.max(1, Math.min(16, Math.ceil(h / 4.0)));
          for (let m = 0; m < sub; m++) sampleXY(sx, y0 + h * ((m + 0.5) / sub));
        }
      }
    }
    return Number.isFinite(minZ) ? minZ : ctx.zLandDatum;
  }

  function _classifyFlatWaterPolys(ctx, polys2D) {
    const { scaleMm } = ctx;
    const elThreshold = Math.max(ctx.zWaterTop + 1.2 / scaleMm, ctx.zLandDatum + 0.8 / scaleMm);
    const out = [];
    for (const wp of (polys2D || [])) {
      if (!wp || !wp.outer || wp.outer.length < 3) continue;
      const holes = wp.holes || [], bb = _waterRingBBox(wp.outer);
      let minTerrainZ = ctx.zLandDatum, isEl = false;
      if (ctx.elevReliefM > 2.0) {
        minTerrainZ = _computeMinWaterTerrainZ(ctx, wp, bb);
        isEl = minTerrainZ > elThreshold;
      }
      const topZ = isEl ? Math.max(ctx.zWaterTop, minTerrainZ - 0.25 / scaleMm) : ctx.zWaterTop;
      const flrZ = isEl ? Math.max(ctx.zWaterCarveFloor, topZ - 0.45 / scaleMm) : ctx.zWaterCarveFloor;
      out.push({ outer: wp.outer, holes, bb, minTerrainZ, isEl, topZ, flrZ });
    }
    return out;
  }

  const exportsObj = {
    _waterRingBBox,
    _ptInRingLocal,
    _probeRingInteriorPt,
    _distSqToRingLocal,
    _ptInWaterEntryLocal,
    _distToWaterEntryLocal,
    _isPointNearWaterEntry,
    _computeMinWaterTerrainZ,
    _classifyFlatWaterPolys
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
