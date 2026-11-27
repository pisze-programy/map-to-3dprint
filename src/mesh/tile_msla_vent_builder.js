// ============================================================================
// src/mesh/tile_msla_vent_builder.js
// Self-Supporting Gabled Archway Cutters & Hidden Underside Base Basin Vents
// ============================================================================

(function (root) {
  /**
   * Computes a self-supporting >= 45 deg gabled tunnel Manifold along 2D path runs.
   * Lower vertical jambs span [zBotU, zSpringU], topped by a 4-tier narrowing gable crown
   * up to zSpringU + gableRiseU so overhang angles stay >= 45 deg (zero VAL-04 overhang).
   * @param {object} core - manifold_core dependency bundle.
   * @param {object} mf - Manifold WASM module.
   * @param {Array<{pts: Array<Array<number>>, halfW: number}>} runs
   * @param {number} zBotU
   * @param {number} zSpringU
   * @param {number} gableRiseU
   * @param {number} scaleMm
   * @returns {object|null}
   */
  function buildGabledTunnelManifold(core, mf, runs, zBotU, zSpringU, gableRiseU, scaleMm) {
    if (!runs || runs.length === 0 || zSpringU <= zBotU + 1e-5) return null;
    const tiers = [];
    const zOvU = 0.03 / scaleMm;

    const pushTier = (halfWScale, z0, z1) => {
      if (z1 <= z0 + 1e-5) return;
      const scaled = runs.map(r => ({ pts: r.pts, halfW: Math.max(0.14 / scaleMm, r.halfW * halfWScale) }));
      const polys = core.clipperBufferOpenPaths(scaled, 'Round', 1e-6);
      if (!polys || polys.length === 0) return;
      let cs = null;
      let raw = null;
      let shifted = null;
      try {
        cs = mf.CrossSection.ofPolygons(polys, 'Positive');
        if (!cs.isEmpty()) {
          raw = cs.extrude(z1 - z0);
          shifted = raw.translate([0, 0, z0]);
          if (shifted && shifted.numTri() > 0) {
            tiers.push(shifted);
            shifted = null;
          }
        }
      } catch (_) {
      } finally {
        core.safeDeleteManifold(cs);
        core.safeDeleteManifold(raw);
        core.safeDeleteManifold(shifted);
      }
    };

    pushTier(1.0, zBotU, zSpringU + zOvU);
    if (gableRiseU > 0.05 / scaleMm) {
      const fracs = [0.78, 0.56, 0.34, 0.14];
      const dz = gableRiseU / fracs.length;
      for (let i = 0; i < fracs.length; i++) {
        const tz0 = zSpringU + i * dz - zOvU * 0.5;
        const tz1 = zSpringU + (i + 1) * dz + (i + 1 < fracs.length ? zOvU : 0);
        pushTier(fracs[i], tz0, tz1);
      }
    }
    if (tiers.length === 0) return null;
    return tiers.length === 1 ? tiers[0] : core.batchUnionManifolds(mf, tiers);
  }

  /**
   * Shortest 0-1 BFS path through solid base from sealed basin cells to preferred goal cells.
   * @param {Array<number>} seedCells
   * @param {Uint8Array} goalMask
   * @param {Uint8Array} solidGrid
   * @param {number} nx
   * @param {number} ny
   * @param {number} ox
   * @param {number} oy
   * @param {number} stepU
   * @param {number} scaleMm
   * @param {number} halfWMm
   * @returns {Array<{pts: Array<Array<number>>, halfW: number}>}
   */
  function findShortestSolidVentRuns(seedCells, goalMask, solidGrid, nx, ny, ox, oy, stepU, scaleMm, halfWMm) {
    const total = nx * ny;
    const dist = new Int32Array(total);
    const parent = new Int32Array(total);
    const settled = new Uint8Array(total);
    dist.fill(0x3fffffff);
    parent.fill(-1);

    const cap = total * 4 + 16;
    const dq = new Int32Array(cap);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < seedCells.length; i++) {
      const idx = seedCells[i];
      dist[idx] = 0;
      dq[tail] = idx;
      tail = (tail + 1) % cap;
    }
    if (head === tail) return [];

    const dirs = [1, -1, nx, -nx];
    let goalIdx = -1;
    while (head !== tail) {
      const cur = dq[head];
      head = (head + 1) % cap;
      if (settled[cur]) continue;
      settled[cur] = 1;
      if (goalMask[cur]) {
        goalIdx = cur;
        break;
      }
      const cx = cur % nx;
      const cy = (cur - cx) / nx;
      const curD = dist[cur];
      for (let di = 0; di < 4; di++) {
        if (di === 0 && cx + 1 >= nx) continue;
        if (di === 1 && cx <= 0) continue;
        if (di === 2 && cy + 1 >= ny) continue;
        if (di === 3 && cy <= 0) continue;
        const nxt = cur + dirs[di];
        if (settled[nxt]) continue;
        const w = solidGrid[nxt] ? 1 : 0;
        const nd = curD + w;
        if (nd < dist[nxt]) {
          dist[nxt] = nd;
          parent[nxt] = cur;
          if (w === 0) {
            head = (head - 1 + cap) % cap;
            dq[head] = nxt;
          } else {
            dq[tail] = nxt;
            tail = (tail + 1) % cap;
          }
        }
      }
    }
    if (goalIdx < 0) return [];

    const cellPath = [];
    for (let p = goalIdx; p >= 0; p = parent[p]) cellPath.push(p);
    cellPath.reverse();

    const cellXY = (idx) => {
      const cx = idx % nx;
      const cy = (idx - cx) / nx;
      return [ox + (cx + 0.5) * stepU, oy + (cy + 0.5) * stepU];
    };
    const extU = Math.max(0.85 / scaleMm, stepU * 1.15);
    const halfW = halfWMm / scaleMm;
    const runs = [];
    let i = 0;
    while (i < cellPath.length) {
      if (!solidGrid[cellPath[i]]) { i++; continue; }
      const runStart = i;
      while (i < cellPath.length && solidGrid[cellPath[i]]) i++;
      const runEnd = i - 1;
      const pts = [];
      if (runStart > 0) {
        const pAir = cellXY(cellPath[runStart - 1]);
        const pFirst = cellXY(cellPath[runStart]);
        const dx = pAir[0] - pFirst[0];
        const dy = pAir[1] - pFirst[1];
        const d = Math.hypot(dx, dy);
        if (d > 1e-8) pts.push([pFirst[0] + (dx / d) * extU, pFirst[1] + (dy / d) * extU]);
      }
      for (let k = runStart; k <= runEnd; k++) pts.push(cellXY(cellPath[k]));
      if (runEnd + 1 < cellPath.length) {
        const pLast = cellXY(cellPath[runEnd]);
        const pAir = cellXY(cellPath[runEnd + 1]);
        const dx = pAir[0] - pLast[0];
        const dy = pAir[1] - pLast[1];
        const d = Math.hypot(dx, dy);
        if (d > 1e-8) pts.push([pLast[0] + (dx / d) * extU, pLast[1] + (dy / d) * extU]);
      } else if (runEnd === cellPath.length - 1 && runEnd > 0) {
        // Terminated on a solid interior seam plane: extend across the cut plane so both
        // seam faces match symmetrically (VAL-09) and open cleanly into interior air.
        const pPrev = cellXY(cellPath[runEnd - 1]);
        const pLast = cellXY(cellPath[runEnd]);
        const dx = pLast[0] - pPrev[0];
        const dy = pLast[1] - pPrev[1];
        const d = Math.hypot(dx, dy);
        if (d > 1e-8) pts.push([pLast[0] + (dx / d) * extU, pLast[1] + (dy / d) * extU]);
      }
      if (pts.length >= 2) {
        const simp = [pts[0]];
        for (let k = 1; k + 1 < pts.length; k++) {
          const a = simp[simp.length - 1];
          const b = pts[k];
          const c = pts[k + 1];
          const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
          if (cross > 1e-7) simp.push(b);
        }
        simp.push(pts[pts.length - 1]);
        runs.push({ pts: simp, halfW });
      }
    }
    return runs;
  }

  /**
   * Computes self-supporting gabled underside vent dimensions for the given base thickness.
   * Guarantees >= 0.50 mm solid roof above tunnel apex for bases >= 2.00 mm (>= 0.45 mm for
   * 1.80..1.99 mm), 45 deg gable roof slope, and open slot clearance at Z = 1.15 mm (VAL-03).
   * @param {number} safeBaseMm
   * @returns {{ventHalfWidthMm: number, zSpringMm: number, gableRiseMm: number}}
   */
  function resolveUndersideVentProfileMm(safeBaseMm) {
    if (safeBaseMm >= 2.65) {
      const zSpringMm = Math.min(1.38, Math.max(1.22, safeBaseMm - 1.65));
      const gableRiseMm = Math.min(1.05, Math.max(0.75, safeBaseMm - zSpringMm - 0.55));
      return { ventHalfWidthMm: 0.90, zSpringMm, gableRiseMm };
    }
    const minRoofMm = safeBaseMm >= 2.00 ? 0.50 : 0.45;
    const maxApexMm = Math.max(1.35, safeBaseMm - minRoofMm);
    const ventHalfWidthMm = safeBaseMm >= 2.35 ? 0.85 : (safeBaseMm >= 2.00 ? 0.70 : 0.60);
    const gableRiseMm = ventHalfWidthMm;
    const zSpringMm = Math.max(0.65, maxApexMm - gableRiseMm);
    return { ventHalfWidthMm, zSpringMm, gableRiseMm };
  }

  /**
   * Carves hidden underside vent slots (Z=0..apex, >= 45 deg gable roof closing >= 0.50 mm
   * below baseBottomMm for >= 2.00 mm bases) for large enclosed water-cutout basins (>= 18 mm^2)
   * so top-down black water cutouts remain 100% crisp while eliminating Z=0..1.15 suction cups.
   * Prefers routing to open exterior water or interior tile seam planes (never outer frame).
   * @param {object} core
   * @param {object} poly
   * @param {object} mf
   * @param {object} unified
   * @param {object} uBB
   * @param {number} scaleMm
   * @param {number} baseBottomMm
   * @param {{south?: boolean, north?: boolean, west?: boolean, east?: boolean, cutXsU?: Array<number>, cutYsU?: Array<number>}|null} [interiorSeams]
   * @param {Function} rasterizeFn
   * @returns {object}
   */
  function ventLargeBasePocketsUnderside(core, poly, mf, unified, uBB, scaleMm, baseBottomMm, interiorSeams, rasterizeFn) {
    const safeBaseMm = (Number(baseBottomMm) > 0) ? Number(baseBottomMm) : 2.35;
    if (safeBaseMm < 1.8 || !unified || unified.numTri() === 0) return unified;
    const ventProfile = resolveUndersideVentProfileMm(safeBaseMm);
    const ventHalfWidthMm = ventProfile.ventHalfWidthMm;
    const zProbeU = 1.05 / scaleMm;
    if (uBB.max[2] <= zProbeU) return unified;

    const minHoleAreaU2 = 18.0 / (scaleMm * scaleMm);
    const closeRadU = 0.22 / scaleMm;
    let s1 = null;
    let dil = null;
    let closed = null;
    let polys = [];
    try {
      s1 = unified.slice(zProbeU);
      if (!s1.isEmpty()) {
        dil = s1.offset(closeRadU, 'Round');
        if (!dil.isEmpty()) {
          closed = dil.offset(-closeRadU, 'Round');
          if (!closed.isEmpty()) polys = closed.toPolygons();
        }
      }
    } catch (_) {
      polys = [];
    } finally {
      core.safeDeleteManifold(s1);
      core.safeDeleteManifold(dil);
      core.safeDeleteManifold(closed);
    }
    if (polys.length === 0) return unified;

    const largeHoles = [];
    for (let i = 0; i < polys.length; i++) {
      const r = polys[i];
      if (!r || r.length < 3) continue;
      const sa = poly.signedArea2D(r);
      if (sa < -1e-7 && Math.abs(sa) >= minHoleAreaU2) largeHoles.push(r);
    }
    if (largeHoles.length === 0) return unified;

    const spanXMm = (uBB.max[0] - uBB.min[0]) * scaleMm;
    const spanYMm = (uBB.max[1] - uBB.min[1]) * scaleMm;
    const stepMm = Math.max(0.55, Math.max(spanXMm, spanYMm) / 240);
    const stepU = stepMm / scaleMm;
    const nx = Math.ceil((uBB.max[0] - uBB.min[0]) / stepU) + 2;
    const ny = Math.ceil((uBB.max[1] - uBB.min[1]) / stepU) + 2;
    const ox = uBB.min[0] - stepU;
    const oy = uBB.min[1] - stepU;
    const total = nx * ny;

    const solidGrid = rasterizeFn(polys, nx, ny, ox, oy, stepU);
    const extAir = new Uint8Array(total);
    const q = new Int32Array(total);
    let qh = 0;
    let qt = 0;
    if (!solidGrid[0]) { extAir[0] = 1; q[qt++] = 0; }
    while (qh < qt) {
      const cur = q[qh++];
      const cx = cur % nx;
      const cy = (cur - cx) / nx;
      if (cx > 0 && !solidGrid[cur - 1] && !extAir[cur - 1]) { extAir[cur - 1] = 1; q[qt++] = cur - 1; }
      if (cx + 1 < nx && !solidGrid[cur + 1] && !extAir[cur + 1]) { extAir[cur + 1] = 1; q[qt++] = cur + 1; }
      if (cy > 0 && !solidGrid[cur - nx] && !extAir[cur - nx]) { extAir[cur - nx] = 1; q[qt++] = cur - nx; }
      if (cy + 1 < ny && !solidGrid[cur + nx] && !extAir[cur + nx]) { extAir[cur + nx] = 1; q[qt++] = cur + nx; }
    }

    // Compute exact base-level XY bounds from the Z=1.05 mm slice (not full 3D uBB, which
    // can be inflated by overhanging trees/buildings beyond the outer passe-partout wall).
    let baseMinX = Infinity, baseMaxX = -Infinity, baseMinY = Infinity, baseMaxY = -Infinity;
    for (let i = 0; i < polys.length; i++) {
      const r = polys[i];
      if (!r) continue;
      for (let k = 0; k < r.length; k++) {
        const px = r[k][0], py = r[k][1];
        if (px < baseMinX) baseMinX = px;
        if (px > baseMaxX) baseMaxX = px;
        if (py < baseMinY) baseMinY = py;
        if (py > baseMaxY) baseMaxY = py;
      }
    }
    if (!Number.isFinite(baseMinX)) {
      baseMinX = uBB.min[0]; baseMaxX = uBB.max[0];
      baseMinY = uBB.min[1]; baseMaxY = uBB.max[1];
    }

    // Prefer open exterior water strictly inside the base footprint OR interior tile seam faces/cut planes
    // so outer A4 passe-partout perimeter walls remain 100% unbroken whenever possible.
    const seams = interiorSeams || {};
    const cutXsU = Array.isArray(seams.cutXsU) ? seams.cutXsU : [];
    const cutYsU = Array.isArray(seams.cutYsU) ? seams.cutYsU : [];
    const prefGoal = new Uint8Array(total);
    let prefCount = 0;
    const innerPadU = 1.50 / scaleMm;
    const outerSkirtPadU = Math.min(8.0, Math.min(spanXMm, spanYMm) * 0.2) / scaleMm;
    const cutBandU = 0.65 * stepU;
    for (let r = 0; r < ny; r++) {
      const cy = oy + (r + 0.5) * stepU;
      const rowOff = r * nx;
      for (let c = 0; c < nx; c++) {
        const idx = rowOff + c;
        const cx = ox + (c + 0.5) * stepU;
        if (extAir[idx]) {
          const insideWater = cx > baseMinX + innerPadU && cx < baseMaxX - innerPadU &&
                              cy > baseMinY + innerPadU && cy < baseMaxY - innerPadU;
          const onInteriorSeam =
            (seams.south && cy <= baseMinY + 0.25 * stepU && cx > baseMinX + innerPadU && cx < baseMaxX - innerPadU) ||
            (seams.north && cy >= baseMaxY - 0.25 * stepU && cx > baseMinX + innerPadU && cx < baseMaxX - innerPadU) ||
            (seams.west && cx <= baseMinX + 0.25 * stepU && cy > baseMinY + innerPadU && cy < baseMaxY - innerPadU) ||
            (seams.east && cx >= baseMaxX - 0.25 * stepU && cy > baseMinY + innerPadU && cy < baseMaxY - innerPadU);
          if (insideWater || onInteriorSeam) {
            prefGoal[idx] = 1;
            prefCount++;
            continue;
          }
        }
        if (cutXsU.length > 0 && cy > baseMinY + outerSkirtPadU && cy < baseMaxY - outerSkirtPadU) {
          for (let ci = 0; ci < cutXsU.length; ci++) {
            if (Math.abs(cx - cutXsU[ci]) <= cutBandU) {
              prefGoal[idx] = 1;
              prefCount++;
              break;
            }
          }
        }
        if (!prefGoal[idx] && cutYsU.length > 0 && cx > baseMinX + outerSkirtPadU && cx < baseMaxX - outerSkirtPadU) {
          for (let ci = 0; ci < cutYsU.length; ci++) {
            if (Math.abs(cy - cutYsU[ci]) <= cutBandU) {
              prefGoal[idx] = 1;
              prefCount++;
              break;
            }
          }
        }
      }
    }

    const goalMask = prefCount > 0 ? prefGoal : extAir;
    const allRuns = [];
    for (let hi = 0; hi < largeHoles.length; hi++) {
      const ring = largeHoles[hi];
      let hx0 = Infinity, hy0 = Infinity, hx1 = -Infinity, hy1 = -Infinity;
      for (let k = 0; k < ring.length; k++) {
        if (ring[k][0] < hx0) hx0 = ring[k][0];
        if (ring[k][0] > hx1) hx1 = ring[k][0];
        if (ring[k][1] < hy0) hy0 = ring[k][1];
        if (ring[k][1] > hy1) hy1 = ring[k][1];
      }
      const c0 = Math.max(1, Math.floor((hx0 - ox) / stepU));
      const c1 = Math.min(nx - 2, Math.ceil((hx1 - ox) / stepU));
      const r0 = Math.max(1, Math.floor((hy0 - oy) / stepU));
      const r1 = Math.min(ny - 2, Math.ceil((hy1 - oy) / stepU));
      const seeds = [];
      for (let r = r0; r <= r1; r++) {
        const cy = oy + (r + 0.5) * stepU;
        const rowOff = r * nx;
        for (let c = c0; c <= c1; c++) {
          const idx = rowOff + c;
          if (solidGrid[idx] || extAir[idx]) continue;
          const cx = ox + (c + 0.5) * stepU;
          if (poly.pointInPoly2D(cx, cy, ring)) seeds.push(idx);
        }
      }
      if (seeds.length === 0) continue;
      // If the enclosed basin already intersects an interior tile cut plane (goalMask),
      // cutting into tiles opens it directly onto the interior seam with zero vent tunnel needed.
      let alreadyTouchesGoal = false;
      for (let si = 0; si < seeds.length; si++) {
        if (goalMask[seeds[si]]) {
          alreadyTouchesGoal = true;
          break;
        }
      }
      if (alreadyTouchesGoal) continue;
      let runs = findShortestSolidVentRuns(seeds, goalMask, solidGrid, nx, ny, ox, oy, stepU, scaleMm, ventHalfWidthMm);
      if (runs.length === 0 && goalMask !== extAir) {
        runs = findShortestSolidVentRuns(seeds, extAir, solidGrid, nx, ny, ox, oy, stepU, scaleMm, ventHalfWidthMm);
      }
      for (let k = 0; k < runs.length; k++) allRuns.push(runs[k]);
    }

    if (allRuns.length === 0) return unified;
    const zSpringMm = ventProfile.zSpringMm;
    const gableRiseMm = ventProfile.gableRiseMm;
    const cutter = buildGabledTunnelManifold(
      core, mf, allRuns, -0.15 / scaleMm, zSpringMm / scaleMm, gableRiseMm / scaleMm, scaleMm
    );
    if (!cutter) return unified;
    let carved = null;
    try {
      carved = unified.subtract(cutter);
    } catch (_) {
      carved = null;
    } finally {
      core.safeDeleteManifold(cutter);
    }
    if (carved && carved.numTri() > 0) {
      core.safeDeleteManifold(unified);
      return carved;
    }
    core.safeDeleteManifold(carved);
    return unified;
  }

  const exportsObj = {
    buildGabledTunnelManifold,
    findShortestSolidVentRuns,
    resolveUndersideVentProfileMm,
    ventLargeBasePocketsUnderside,
  };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
