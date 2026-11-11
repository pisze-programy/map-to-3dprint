// ============================================================================
// src/geometry/marching_squares_2d.js
// Software Rasterizer Fallback, Chamfer-Euclidean 2D Distance Transform,
// Shrinkage-Free Taubin Smoothing & Exact Closed Marching-Squares Extractor
// ============================================================================

if (typeof signedArea2D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./polygon_2d.js'), require('./obb_medial_2d.js'));
}

function createSoftwareMaskCanvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  let paths = [];
  let currentPath = [];
  let curLineWidth = 1;
  return {
    width, height,
    getContext: () => ({
      get lineWidth() { return curLineWidth; },
      set lineWidth(v) { curLineWidth = v; },
      fillStyle: '#fff',
      strokeStyle: '#fff',
      lineCap: 'round',
      lineJoin: 'round',
      clearRect() { data.fill(0); },
      beginPath() { paths = []; currentPath = []; },
      moveTo(x, y) { currentPath = [[x, y]]; paths.push(currentPath); },
      lineTo(x, y) { currentPath.push([x, y]); },
      closePath() { if (currentPath.length > 2) currentPath.push([currentPath[0][0], currentPath[0][1]]); },
      fill() {
        const edges = [];
        for (const p of paths) {
          for (let i = 0; i < p.length - 1; i++) {
            const y0 = p[i][1], y1 = p[i + 1][1];
            if (y0 === y1) continue;
            edges.push({
              x0: p[i][0], y0,
              x1: p[i + 1][0], y1,
              minY: Math.min(y0, y1),
              maxY: Math.max(y0, y1),
              dxDy: (p[i + 1][0] - p[i][0]) / (y1 - y0)
            });
          }
        }
        for (let y = 0; y < height; y++) {
          const sy = y + 0.5;
          const xs = [];
          for (let i = 0; i < edges.length; i++) {
            const e = edges[i];
            if (sy >= e.minY && sy < e.maxY) {
              xs.push(e.x0 + (sy - e.y0) * e.dxDy);
            }
          }
          xs.sort((a, b) => a - b);
          for (let i = 0; i < xs.length; i += 2) {
            if (i + 1 >= xs.length) break;
            const xStart = Math.max(0, Math.ceil(xs[i]));
            const xEnd = Math.min(width - 1, Math.floor(xs[i + 1]));
            for (let x = xStart; x <= xEnd; x++) {
              data[(y * width + x) * 4 + 3] = 255;
            }
          }
        }
      },
      stroke() {
        const r = Math.max(0.5, curLineWidth * 0.5);
        const r2 = r * r;
        for (const p of paths) {
          for (let i = 0; i < p.length - 1; i++) {
            const x0 = p[i][0], y0 = p[i][1];
            const x1 = p[i + 1][0], y1 = p[i + 1][1];
            const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r));
            const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + r));
            const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r));
            const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + r));
            const dx = x1 - x0, dy = y1 - y0;
            const l2 = dx * dx + dy * dy;
            for (let y = minY; y <= maxY; y++) {
              for (let x = minX; x <= maxX; x++) {
                let d2;
                if (l2 < 1e-6) {
                  d2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
                } else {
                  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
                  const px = x0 + t * dx, py = y0 + t * dy;
                  d2 = (x - px) * (x - px) + (y - py) * (y - py);
                }
                if (d2 <= r2) {
                  data[(y * width + x) * 4 + 3] = 255;
                }
              }
            }
          }
        }
      },
      getImageData() { return { data }; }
    })
  };
}

function computeEuclideanDistGrid(binaryMask, w, h, distInside) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const active = binaryMask[i] !== 0;
    d[i] = (distInside ? active : !active) ? INF : 0.0;
  }
  const SQRT2 = 1.41421356;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      let best = d[idx];
      if (best === 0.0) continue;
      if (x > 0) best = Math.min(best, d[idx - 1] + 1.0);
      if (y > 0) {
        best = Math.min(best, d[idx - w] + 1.0);
        if (x > 0) best = Math.min(best, d[idx - w - 1] + SQRT2);
        if (x < w - 1) best = Math.min(best, d[idx - w + 1] + SQRT2);
      }
      d[idx] = best;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const idx = row + x;
      let best = d[idx];
      if (best === 0.0) continue;
      if (x < w - 1) best = Math.min(best, d[idx + 1] + 1.0);
      if (y < h - 1) {
        best = Math.min(best, d[idx + w] + 1.0);
        if (x < w - 1) best = Math.min(best, d[idx + w + 1] + SQRT2);
        if (x > 0) best = Math.min(best, d[idx + w - 1] + SQRT2);
      }
      d[idx] = best;
    }
  }
  return d;
}

function smoothClosedRingTaubin2D(pts, passes = 3, maxDisp = 0.5, pinBox = null) {
  const n = pts.length;
  if (n < 5) return pts;
  let cur = pts.map(p => [p[0], p[1]]);
  const rampDist = Math.max(1e-4, maxDisp * 2.1);
  const ptCap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!pinBox) {
      ptCap[i] = maxDisp;
      continue;
    }
    const dSeam = Math.min(
      Math.abs(pts[i][0] - pinBox.x0),
      Math.abs(pts[i][0] - pinBox.x1),
      Math.abs(pts[i][1] - pinBox.y0),
      Math.abs(pts[i][1] - pinBox.y1)
    );
    ptCap[i] = dSeam < 1e-5 ? 0.0 : maxDisp * Math.min(1.0, dSeam / rampDist);
  }
  const stepRing = (src, weight) => {
    const dst = new Array(n);
    for (let i = 0; i < n; i++) {
      const cap = ptCap[i];
      if (cap <= 0.0) {
        dst[i] = [pts[i][0], pts[i][1]];
        continue;
      }
      const prev = src[(i + n - 1) % n];
      const curr = src[i];
      const next = src[(i + 1) % n];
      const lx = (prev[0] + next[0]) * 0.5 - curr[0];
      const ly = (prev[1] + next[1]) * 0.5 - curr[1];
      let nx = curr[0] + weight * lx;
      let ny = curr[1] + weight * ly;
      const disp = Math.hypot(nx - pts[i][0], ny - pts[i][1]);
      if (disp > cap) {
        const s = cap / disp;
        nx = pts[i][0] + (nx - pts[i][0]) * s;
        ny = pts[i][1] + (ny - pts[i][1]) * s;
      }
      dst[i] = [nx, ny];
    }
    return dst;
  };
  for (let p = 0; p < passes; p++) {
    cur = stepRing(cur, 0.44);
    cur = stepRing(cur, -0.46);
  }
  return cur;
}

function extractMarchingSquaresPatchCore2D(vals, subNx, subNy, pxMin, pxMax, pyMin, pyMax, dx, dy, spanIx, spanIy, threshold, minArea, pinBox) {
  const vOffset = subNx * subNy;
  const edgePts = new Map();
  const nextEdge = new Map();
  const clampX = u => pxMin + Math.max(0, Math.min(spanIx, u)) * dx;
  const clampY = v => pyMin + Math.max(0, Math.min(spanIy, v)) * dy;

  const getHEdge = (ix, iy) => {
    const id = iy * subNx + ix;
    if (!edgePts.has(id)) {
      const v0 = vals[id], v1 = vals[id + 1];
      const t = Math.max(0.001, Math.min(0.999, (threshold - v0) / ((v1 - v0) || 1e-9)));
      edgePts.set(id, [clampX(ix + t - 1), clampY(iy - 1)]);
    }
    return id;
  };
  const getVEdge = (ix, iy) => {
    const id = vOffset + iy * subNx + ix;
    if (!edgePts.has(id)) {
      const i0 = iy * subNx + ix, i1 = (iy + 1) * subNx + ix;
      const v0 = vals[i0], v1 = vals[i1];
      const t = Math.max(0.001, Math.min(0.999, (threshold - v0) / ((v1 - v0) || 1e-9)));
      edgePts.set(id, [clampX(ix - 1), clampY(iy + t - 1)]);
    }
    return id;
  };

  for (let iy = 0; iy < subNy - 1; iy++) {
    const r0 = iy * subNx, r1 = (iy + 1) * subNx;
    for (let ix = 0; ix < subNx - 1; ix++) {
      const v0 = vals[r0 + ix], v1 = vals[r0 + ix + 1], v2 = vals[r1 + ix + 1], v3 = vals[r1 + ix];
      const mask = (v0 > threshold ? 1 : 0) | (v1 > threshold ? 2 : 0) | (v2 > threshold ? 4 : 0) | (v3 > threshold ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      switch (mask) {
        case 1: nextEdge.set(getHEdge(ix, iy), getVEdge(ix, iy)); break;
        case 2: nextEdge.set(getVEdge(ix + 1, iy), getHEdge(ix, iy)); break;
        case 3: nextEdge.set(getVEdge(ix + 1, iy), getVEdge(ix, iy)); break;
        case 4: nextEdge.set(getHEdge(ix, iy + 1), getVEdge(ix + 1, iy)); break;
        case 5: {
          if (0.25 * (v0 + v1 + v2 + v3) > threshold) {
            nextEdge.set(getHEdge(ix, iy), getVEdge(ix + 1, iy));
            nextEdge.set(getHEdge(ix, iy + 1), getVEdge(ix, iy));
          } else {
            nextEdge.set(getHEdge(ix, iy), getVEdge(ix, iy));
            nextEdge.set(getHEdge(ix, iy + 1), getVEdge(ix + 1, iy));
          }
          break;
        }
        case 6: nextEdge.set(getHEdge(ix, iy + 1), getHEdge(ix, iy)); break;
        case 7: nextEdge.set(getHEdge(ix, iy + 1), getVEdge(ix, iy)); break;
        case 8: nextEdge.set(getVEdge(ix, iy), getHEdge(ix, iy + 1)); break;
        case 9: nextEdge.set(getHEdge(ix, iy), getHEdge(ix, iy + 1)); break;
        case 10: {
          if (0.25 * (v0 + v1 + v2 + v3) > threshold) {
            nextEdge.set(getVEdge(ix + 1, iy), getHEdge(ix, iy + 1));
            nextEdge.set(getVEdge(ix, iy), getHEdge(ix, iy));
          } else {
            nextEdge.set(getVEdge(ix + 1, iy), getHEdge(ix, iy));
            nextEdge.set(getVEdge(ix, iy), getHEdge(ix, iy + 1));
          }
          break;
        }
        case 11: nextEdge.set(getVEdge(ix + 1, iy), getHEdge(ix, iy + 1)); break;
        case 12: nextEdge.set(getVEdge(ix, iy), getVEdge(ix + 1, iy)); break;
        case 13: nextEdge.set(getHEdge(ix, iy), getVEdge(ix + 1, iy)); break;
        case 14: nextEdge.set(getVEdge(ix, iy), getHEdge(ix, iy)); break;
      }
    }
  }

  const visited = new Set();
  const maxSmoothDisp = Math.max(dx, dy) * 0.85;
  const outers = [];
  const holes = [];

  for (const startId of nextEdge.keys()) {
    if (visited.has(startId)) continue;
    const rawRing = [];
    let cur = startId;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      rawRing.push(edgePts.get(cur));
      cur = nextEdge.get(cur);
    }
    if (rawRing.length < 3) continue;
    const rawArea = signedArea2D(rawRing);
    if (Math.abs(rawArea) < minArea) continue;
    const isOuter = rawArea > 0;

    const smoothed = smoothClosedRingTaubin2D(rawRing, 3, maxSmoothDisp, pinBox);
    let cleaned = cleanPolygonRing(smoothed, isOuter);
    if (cleaned.length < 3 || Math.abs(signedArea2D(cleaned)) < minArea * 0.5 || !isSimplePolygon(cleaned)) {
      cleaned = cleanPolygonRing(rawRing, isOuter);
      if (cleaned.length < 3 || Math.abs(signedArea2D(cleaned)) < minArea * 0.5 || !isSimplePolygon(cleaned)) continue;
    }

    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (let i = 0; i < cleaned.length; i++) {
      const p = cleaned[i];
      if (p[0] < bMinX) bMinX = p[0]; if (p[0] > bMaxX) bMaxX = p[0];
      if (p[1] < bMinY) bMinY = p[1]; if (p[1] > bMaxY) bMaxY = p[1];
    }
    const obj = { ring: cleaned, area: Math.abs(signedArea2D(cleaned)), minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY, holes: [] };
    if (isOuter) outers.push(obj);
    else holes.push(obj);
  }

  for (let hi = 0; hi < holes.length; hi++) {
    const h = holes[hi], hp = h.ring[0];
    let bestOuter = null, bestArea = Infinity;
    for (let oi = 0; oi < outers.length; oi++) {
      const o = outers[oi];
      if (o.area <= h.area || hp[0] < o.minX || hp[0] > o.maxX || hp[1] < o.minY || hp[1] > o.maxY) continue;
      if (pointInPoly2D(hp[0], hp[1], o.ring) && o.area < bestArea) {
        bestArea = o.area;
        bestOuter = o;
      }
    }
    if (bestOuter) bestOuter.holes.push(h.ring);
  }
  return outers;
}

function extractMarchingSquaresPolygons2D(valsInput, nx, ny, xMin, xMax, yMin, yMax, threshold = 0.5, minArea = 0.015) {
  const valsGlobal = new Float32Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    const isBorderY = (iy === 0 || iy === ny - 1);
    const row = iy * nx;
    for (let ix = 0; ix < nx; ix++) {
      if (isBorderY || ix === 0 || ix === nx - 1) {
        valsGlobal[row + ix] = 0.0;
      } else {
        let v = valsInput[row + ix];
        if (Math.abs(v - threshold) < 1e-5) v = threshold + 1.5e-5;
        valsGlobal[row + ix] = v;
      }
    }
  }

  const dx = (xMax - xMin) / (nx - 1);
  const dy = (yMax - yMin) / (ny - 1);
  const nSplitX = nx > 260 ? 8 : 1;
  const nSplitY = ny > 260 ? 8 : 1;
  const allOuters = [];

  for (let py = 0; py < nSplitY; py++) {
    const iy0 = Math.floor((ny - 1) * py / nSplitY);
    const iy1 = Math.floor((ny - 1) * (py + 1) / nSplitY);
    const spanIy = iy1 - iy0;
    const subNy = spanIy + 3;
    const pyMin = yMin + iy0 * dy, pyMax = yMin + iy1 * dy;

    for (let px = 0; px < nSplitX; px++) {
      const ix0 = Math.floor((nx - 1) * px / nSplitX);
      const ix1 = Math.floor((nx - 1) * (px + 1) / nSplitX);
      const spanIx = ix1 - ix0;

      let hasActive = false;
      for (let ly = 0; ly <= spanIy && !hasActive; ly++) {
        const gRow = (iy0 + ly) * nx + ix0;
        for (let lx = 0; lx <= spanIx; lx++) {
          if (valsGlobal[gRow + lx] > threshold) { hasActive = true; break; }
        }
      }
      if (!hasActive) continue;

      const subNx = spanIx + 3;
      const subVals = new Float32Array(subNx * subNy);
      for (let ly = 0; ly <= spanIy; ly++) {
        const gRow = (iy0 + ly) * nx + ix0;
        const sRow = (ly + 1) * subNx + 1;
        for (let lx = 0; lx <= spanIx; lx++) subVals[sRow + lx] = valsGlobal[gRow + lx];
      }

      const pxMin = xMin + ix0 * dx, pxMax = xMin + ix1 * dx;
      const pinBox = (nSplitX > 1 || nSplitY > 1)
        ? {
            x0: px > 0 ? pxMin : -1e9,
            x1: px < nSplitX - 1 ? pxMax : 1e9,
            y0: py > 0 ? pyMin : -1e9,
            y1: py < nSplitY - 1 ? pyMax : 1e9
          }
        : null;
      const patchOuters = extractMarchingSquaresPatchCore2D(
        subVals, subNx, subNy, pxMin, pxMax, pyMin, pyMax, dx, dy, spanIx, spanIy, threshold, minArea, pinBox
      );
      for (let i = 0; i < patchOuters.length; i++) allOuters.push(patchOuters[i]);
    }
  }
  return allOuters;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createSoftwareMaskCanvas,
    computeEuclideanDistGrid,
    smoothClosedRingTaubin2D,
    extractMarchingSquaresPolygons2D
  };
}
