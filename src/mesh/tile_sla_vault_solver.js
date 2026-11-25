// ============================================================================
// src/mesh/tile_sla_vault_solver.js
// SLA Anti-Suction Hollow Vault (45 deg Ribs + Per-Chamber >=2 Drains)
// & Per-Tile Manifold CSG Union for Watertight Binary .STL Export
// ============================================================================

(function (root) {
  function _getDeps() {
    const embossMod = (typeof require !== 'undefined')
      ? require('./tile_id_emboss.js')
      : root;
    const ventMod = (typeof buildGabledTunnelManifold === 'function' && typeof ventLargeBasePocketsUnderside === 'function')
      ? { buildGabledTunnelManifold, findShortestSolidVentRuns, ventLargeBasePocketsUnderside }
      : (typeof require !== 'undefined' ? require('./tile_msla_vent_builder.js') : root);
    return {
      core: (typeof trianglesToShellManifolds === 'function' && typeof clipperDiffPolys === 'function') ? root : require('../geometry/manifold_core.js'),
      poly: (typeof pointInPoly2D === 'function' && typeof signedArea2D === 'function') ? root : require('../geometry/polygon_2d.js'),
      cfgMod: (typeof resolveSceneScaleAndSpec === 'function' && typeof resolveTriangleTileId === 'function') ? root : require('../geometry/print_physics_config.js'),
      embossMod,
      ventMod,
    };
  }
  const _inPolyList = (poly, x, y, rings) => rings.some(r => poly.pointInPoly2D(x, y, r));
  const _inStructuredChamber = (poly, x, y, ch) => poly.pointInPoly2D(x, y, ch.outer) && !(ch.holes || []).some(h => poly.pointInPoly2D(x, y, h));

  function _buildDeepZones2D(core, ctx, tb, wallU, minColU) {
    const x0 = tb.minX + wallU, x1 = tb.maxX - wallU, y0 = tb.minY + wallU, y1 = tb.maxY - wallU;
    if (x1 <= x0 + 2 / ctx.scaleMm || y1 <= y0 + 2 / ctx.scaleMm) return [];
    const nx = 16, ny = 16, dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
    const rects = [];
    for (let r = 0; r < ny; r++) {
      const ry0 = y0 + r * dy, ry1 = ry0 + dy;
      let runStart = -1;
      for (let c = 0; c <= nx; c++) {
        let cellOk = false;
        if (c < nx) {
          const cx0 = x0 + c * dx, cx1 = cx0 + dx;
          cellOk = ctx.getTerrainZ((cx0 + cx1) * 0.5, (ry0 + ry1) * 0.5) >= minColU &&
                   ctx.getTerrainZ(cx0, ry0) >= minColU && ctx.getTerrainZ(cx1, ry0) >= minColU &&
                   ctx.getTerrainZ(cx1, ry1) >= minColU && ctx.getTerrainZ(cx0, ry1) >= minColU;
        }
        if (cellOk && runStart < 0) runStart = c;
        else if (!cellOk && runStart >= 0) {
          rects.push([[x0 + runStart * dx, ry0], [x0 + c * dx, ry0], [x0 + c * dx, ry1], [x0 + runStart * dx, ry1]]);
          runStart = -1;
        }
      }
    }
    return rects.length ? core.clipperUnionPolys(rects, 1e-5) : [];
  }

  function _subtractDiagonal45Ribs(core, poly, vault2D, tb, scaleMm, ribPitchU, ribThickU) {
    const gapU = Math.max(3.6 / scaleMm, ribPitchU * 0.34);
    const halfLen = (ribPitchU - gapU) * 0.5;
    if (halfLen <= ribThickU * 0.6 || vault2D.length === 0) return vault2D;
    const ribZone = core.clipperOffsetPolys(vault2D, -(ribThickU * 0.55 + 2.2 / scaleMm), 'Miter', 1e-5);
    if (ribZone.length === 0) return vault2D;

    const S = Math.SQRT1_2;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const [x, y] of [[tb.minX, tb.minY], [tb.maxX, tb.minY], [tb.maxX, tb.maxY], [tb.minX, tb.maxY]]) {
      const u = S * (x + y), v = S * (y - x);
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
    const uvToXY = (u, v) => [S * (u - v), S * (u + v)];
    const bars = [], ht = ribThickU * 0.5;
    for (let iu = Math.floor(uMin / ribPitchU); iu <= Math.ceil(uMax / ribPitchU); iu++) {
      for (let iv = Math.floor(vMin / ribPitchU); iv <= Math.ceil(vMax / ribPitchU); iv++) {
        const u0 = iu * ribPitchU, v0 = iv * ribPitchU;
        const [cx, cy] = uvToXY(u0, v0);
        if (!_inPolyList(poly, cx, cy, ribZone)) continue;
        bars.push([uvToXY(u0 - halfLen, v0 - ht), uvToXY(u0 + halfLen, v0 - ht), uvToXY(u0 + halfLen, v0 + ht), uvToXY(u0 - halfLen, v0 + ht)]);
        bars.push([uvToXY(u0 - ht, v0 - halfLen), uvToXY(u0 + ht, v0 - halfLen), uvToXY(u0 + ht, v0 + halfLen), uvToXY(u0 - ht, v0 + halfLen)]);
      }
    }
    return bars.length ? core.clipperDiffPolys(vault2D, core.clipperUnionPolys(bars, 1e-5), 1e-5) : vault2D;
  }

  function _findChamberDrains(ctx, terrainWater, poly, ch, tb, wallU, scaleMm, waterMarginRings2D, idPadRect) {
    const drainW = 3.6 / scaleMm, drainH = 1.55 / scaleMm;
    const minSurfZ = drainH + wallU * 0.45;
    const spanX = tb.maxX - tb.minX, spanY = tb.maxY - tb.minY;
    const marginCorner = wallU + drainW;
    const maxProbe = Math.min(Math.min(spanX, spanY) * 0.36, 26.0 / scaleMm);
    const stepEdge = Math.max(3.8 / scaleMm, Math.min(spanX, spanY) / 22);
    const sides = [
      { id: 'S', nx: 0, ny: 1, len: spanX, pt: (s) => [tb.minX + s, tb.minY] },
      { id: 'N', nx: 0, ny: -1, len: spanX, pt: (s) => [tb.minX + s, tb.maxY] },
      { id: 'W', nx: 1, ny: 0, len: spanY, pt: (s) => [tb.minX, tb.minY + s] },
      { id: 'E', nx: -1, ny: 0, len: spanY, pt: (s) => [tb.maxX, tb.minY + s] },
    ];
    const safePt = (x, y) => !terrainWater.isPointInWater(x, y) && ctx.getTerrainZ(x, y) >= minSurfZ &&
      (!idPadRect || !poly.pointInPoly2D(x, y, idPadRect)) && !_inPolyList(poly, x, y, waterMarginRings2D);

    const cands = [];
    for (const sd of sides) {
      if (sd.len <= marginCorner * 2.2) continue;
      for (let s = marginCorner; s <= sd.len - marginCorner; s += stepEdge) {
        const [ex, ey] = sd.pt(s);
        const px = -sd.ny * drainW * 0.48, py = sd.nx * drainW * 0.48;
        let pathOk = true, hitDist = -1;
        for (let d = 0.2 * wallU; d <= maxProbe; d += Math.max(0.6 / scaleMm, wallU * 0.4)) {
          const cx = ex + sd.nx * d, cy = ey + sd.ny * d;
          if (!safePt(cx, cy) || !safePt(cx + px, cy + py) || !safePt(cx - px, cy - py)) { pathOk = false; break; }
          if (_inStructuredChamber(poly, cx, cy, ch)) { hitDist = d + 1.2 / scaleMm; break; }
        }
        if (pathOk && hitDist > 0) {
          const tx = ex + sd.nx * hitDist, ty = ey + sd.ny * hitDist;
          const xMin = Math.min(ex - sd.nx * 0.15, tx) - Math.abs(sd.ny) * drainW * 0.5;
          const xMax = Math.max(ex - sd.nx * 0.15, tx) + Math.abs(sd.ny) * drainW * 0.5;
          const yMin = Math.min(ey - sd.ny * 0.15, ty) - Math.abs(sd.nx) * drainW * 0.5;
          const yMax = Math.max(ey - sd.ny * 0.15, ty) + Math.abs(sd.nx) * drainW * 0.5;
          cands.push({ side: sd.id, ex, ey, bounds: [xMin, xMax, yMin, yMax, -0.2, drainH] });
        }
      }
    }
    const chosen = [], minSep = 10.0 / scaleMm;
    const tryPick = (cand) => chosen.every(k => Math.hypot(k.ex - cand.ex, k.ey - cand.ey) >= minSep) && chosen.push(cand);
    for (const sid of ['S', 'N', 'W', 'E']) { const m = cands.find(c => c.side === sid); if (m) tryPick(m); }
    for (const c of cands) { if (chosen.length >= 4) break; tryPick(c); }
    return chosen;
  }

  function _ringBBox2D(ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i][0], y = ring[i][1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  }

  /**
   * Samples minimum dry terrain Z inside tb on a 20x20 grid.
   */
  function _sampleMinDryZU(ctx, terrainWater, tb) {
    const n = 20;
    let minDryZU = Infinity;
    for (let iy = 0; iy < n; iy++) {
      const gy = tb.minY + ((iy + 0.5) / n) * (tb.maxY - tb.minY);
      for (let ix = 0; ix < n; ix++) {
        const gx = tb.minX + ((ix + 0.5) / n) * (tb.maxX - tb.minX);
        if (terrainWater.isPointInWater(gx, gy)) continue;
        const z = ctx.getTerrainZ(gx, gy);
        if (Number.isFinite(z) && z < minDryZU) minDryZU = z;
      }
    }
    return Number.isFinite(minDryZU) ? minDryZU : ctx.zLandDatum;
  }

  /**
   * Plugs enclosed inland through-holes (< 45 mm^2) to eliminate Z=0 suction cups.
   * @param {object} core - manifold_core dependency bundle.
   * @param {object} poly - polygon_2d dependency bundle.
   * @param {object} mf - Manifold WASM module.
   * @param {object} outTile - tile Manifold solid.
   * @param {object} terrainWater - Layer-1 terrain/water object.
   * @param {object} tb - tile bounds record.
   * @param {number} scaleMm - millimeters per scene unit.
   * @param {number} minDryZU - minimum dry terrain Z in scene units.
   * @param {number} [baseBottomMm=2.35] - configured solid base thickness in millimeters.
   * @returns {{outTile: object, pluggedRings: Array<Array<Array<number>>>}}
   */
  function _plugInlandThroughHoles(core, poly, mf, outTile, terrainWater, tb, scaleMm, minDryZU, baseBottomMm = 2.35) {
    const pluggedRings = [];
    if (!outTile || outTile.numTri() === 0) return { outTile, pluggedRings };
    const safeBaseMm = (Number(baseBottomMm) > 0) ? Number(baseBottomMm) : 2.35;
    const zProbeU = 1.05 / scaleMm;
    const maxHoleAreaU2 = 45.0 / (scaleMm * scaleMm);
    const edgeTolU = 0.20 / scaleMm;
    const outOffU = 0.08 / scaleMm;
    const tileBB = outTile.boundingBox();
    const zPlugTopU = Math.min(
      Math.max(2.15, safeBaseMm - 0.20) / scaleMm,
      Math.max(1.25 / scaleMm, minDryZU - 0.25 / scaleMm),
      tileBB.max[2] - 0.10 / scaleMm
    );
    if (zPlugTopU <= 0.10 / scaleMm) return { outTile, pluggedRings };

    let s1 = null;
    let polys = [];
    try {
      s1 = outTile.slice(zProbeU);
      polys = s1.toPolygons();
    } finally {
      core.safeDeleteManifold(s1);
    }

    const plugs = [];
    for (const r of polys) {
      if (!r || r.length < 3) continue;
      const sa = poly.signedArea2D(r);
      if (sa >= 0 || Math.abs(sa) >= maxHoleAreaU2) continue;
      const [hx0, hy0, hx1, hy1] = _ringBBox2D(r);
      if (hx0 <= tb.minX + edgeTolU || hx1 >= tb.maxX - edgeTolU ||
          hy0 <= tb.minY + edgeTolU || hy1 >= tb.maxY - edgeTolU) {
        continue;
      }
      const ccw = r.slice().reverse();
      let csH = null;
      let csP = null;
      try {
        csH = mf.CrossSection.ofPolygons([ccw], 'Positive');
        csP = csH.offset(outOffU, 'Round');
        const plug = csP.isEmpty() ? null : csP.extrude(zPlugTopU);
        if (plug && plug.numTri() > 0) {
          plugs.push(plug);
          pluggedRings.push(ccw);
        } else {
          core.safeDeleteManifold(plug);
        }
      } catch (_) {
      } finally {
        core.safeDeleteManifold(csH);
        core.safeDeleteManifold(csP);
      }
    }

    if (plugs.length > 0) {
      const allPlugs = core.batchUnionManifolds(mf, plugs);
      const plugged = allPlugs ? outTile.add(allPlugs) : null;
      core.safeDeleteManifold(allPlugs);
      if (plugged && plugged.numTri() > 0) {
        if (outTile !== terrainWater.terrainManifold) core.safeDeleteManifold(outTile);
        outTile = plugged;
      } else {
        core.safeDeleteManifold(plugged);
      }
    }
    return { outTile, pluggedRings };
  }

  function _makeRectCS(mf, x0, y0, x1, y1) {
    return mf.CrossSection.ofPolygons([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], 'Positive');
  }

  /**
   * Extracts outward border extensions only where dry land meets each tile edge.
   */
  function _extractBorderDryExtensions(mf, landSafe, tb, scaleMm, extInsetU) {
    const bandHalfU = 0.15 / scaleMm;
    const inOverlapU = 0.60 / scaleMm;
    const outExtU = 8.0 / scaleMm;
    const minSpanU = 0.50 / scaleMm;
    const exts = [];

    const sides = [
      {
        axis: 1,
        strip: [tb.minX - bandHalfU, tb.minY + extInsetU, tb.minX + bandHalfU, tb.maxY - extInsetU],
        makeExt: (a0, a1) => [tb.minX - outExtU, a0, tb.minX + inOverlapU, a1],
      },
      {
        axis: 1,
        strip: [tb.maxX - bandHalfU, tb.minY + extInsetU, tb.maxX + bandHalfU, tb.maxY - extInsetU],
        makeExt: (a0, a1) => [tb.maxX - inOverlapU, a0, tb.maxX + outExtU, a1],
      },
      {
        axis: 0,
        strip: [tb.minX + extInsetU, tb.minY - bandHalfU, tb.maxX - extInsetU, tb.minY + bandHalfU],
        makeExt: (a0, a1) => [a0, tb.minY - outExtU, a1, tb.minY + inOverlapU],
      },
      {
        axis: 0,
        strip: [tb.minX + extInsetU, tb.maxY - bandHalfU, tb.maxX - extInsetU, tb.maxY + bandHalfU],
        makeExt: (a0, a1) => [a0, tb.maxY - inOverlapU, a1, tb.maxY + outExtU],
      },
    ];

    for (const sd of sides) {
      if (sd.strip[2] <= sd.strip[0] + 1e-5 || sd.strip[3] <= sd.strip[1] + 1e-5) continue;
      const bStrip = _makeRectCS(mf, sd.strip[0], sd.strip[1], sd.strip[2], sd.strip[3]);
      const bHit = landSafe.intersect(bStrip);
      bStrip.delete();
      if (bHit.isEmpty()) { bHit.delete(); continue; }
      const comps = bHit.decompose();
      bHit.delete();
      for (const comp of comps) {
        const cb = comp.bounds();
        comp.delete();
        const a0 = cb.min[sd.axis], a1 = cb.max[sd.axis];
        if (a1 - a0 < minSpanU) continue;
        const r = sd.makeExt(a0, a1);
        exts.push(_makeRectCS(mf, r[0], r[1], r[2], r[3]));
      }
    }
    return exts;
  }

  function _subtract1DIntervals(start, end, badIntervals) {
    if (!badIntervals || badIntervals.length === 0) return [[start, end]];
    const sorted = badIntervals.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    let cur = start;
    for (let i = 0; i < sorted.length; i++) {
      const b0 = sorted[i][0], b1 = sorted[i][1];
      if (b1 <= cur) continue;
      if (b0 > cur) out.push([cur, Math.min(end, b0)]);
      if (b1 > cur) cur = b1;
      if (cur >= end) break;
    }
    if (cur < end) out.push([cur, end]);
    return out;
  }

  function _extrudeGrooveGroup(core, mf, polys, zFlatMm, maxApexMm, dzMm, baseWMm, nSteps, scaleMm) {
    if (!polys || polys.length === 0) return null;
    const dzU = dzMm / scaleMm;
    const halfWMm = baseWMm * 0.5;
    const groupCS = mf.CrossSection.ofPolygons(polys, 'Positive');
    const tiers = [];
    try {
      for (let s = 0; s <= nSteps; s++) {
        if (halfWMm - s * dzMm <= 0.08) break;
        const z0Mm = (s === 0) ? -0.02 : (zFlatMm + (s - 1) * dzMm);
        const z1Mm = zFlatMm + s * dzMm;
        if (z0Mm >= maxApexMm) break;
        const z0CutMm = z0Mm - 0.01;
        const z1CutMm = Math.min(maxApexMm, z1Mm + (s < nSteps ? 0.01 : 0));
        if (z1CutMm <= z0CutMm + 0.005) break;
        const tierCS = (s === 0) ? groupCS : groupCS.offset(-s * dzU, 'Miter');
        if (tierCS.isEmpty()) {
          if (s > 0) tierCS.delete();
          break;
        }
        const hU = (z1CutMm - z0CutMm) / scaleMm;
        const raw = tierCS.extrude(hU);
        if (s > 0) tierCS.delete();
        const shifted = raw.translate([0, 0, z0CutMm / scaleMm]);
        raw.delete();
        if (shifted && shifted.numTri() > 0) tiers.push(shifted);
        else core.safeDeleteManifold(shifted);
      }
    } finally {
      groupCS.delete();
    }
    return tiers.length > 0 ? core.batchUnionManifolds(mf, tiers) : null;
  }

  /**
   * Builds open-ended 45-degree shallow anti-peel relief grooves on flat tiles.
   */
  function _buildShallowAntiPeelRelief(core, mf, outTile, tb, scaleMm, minDryZMm, pad) {
    const empty = { cutters: [], keptSegs: [] };
    if (!outTile || outTile.numTri() === 0) return empty;
    const spanXMm = (tb.maxX - tb.minX) * scaleMm;
    const spanYMm = (tb.maxY - tb.minY) * scaleMm;
    if (spanXMm < 28.0 || spanYMm < 28.0) return empty;

    const maxApexMm = Math.min(1.50, minDryZMm - 0.85);
    if (maxApexMm < 0.85) return empty;

    const s020 = outTile.slice(0.20 / scaleMm);
    if (s020.isEmpty() || s020.area() * scaleMm * scaleMm < 900.0) {
      s020.delete();
      return empty;
    }
    // Keep upper slice strictly below flat terrain top and above any hole plugs.
    const zUpperMm = Math.min(maxApexMm + 0.83, minDryZMm - 0.02);
    if (zUpperMm <= 0.25) {
      s020.delete();
      return empty;
    }
    const sUpper = outTile.slice(zUpperMm / scaleMm);
    const landSafe = s020.intersect(sUpper);
    s020.delete();
    sUpper.delete();
    if (landSafe.isEmpty()) {
      landSafe.delete();
      return empty;
    }

    const dzMm = 0.10;
    const zFlatEvenMm = Math.min(0.30, maxApexMm * 0.22);
    const zFlatOddMm = Math.max(0.20, zFlatEvenMm - 0.05);
    const nSteps = Math.max(5, Math.floor((maxApexMm - zFlatEvenMm) / dzMm + 1e-9));
    const baseWMm = Math.min(3.0, Math.max(2.0, 2 * nSteps * dzMm + 0.30));
    const pitchMm = baseWMm * 2.05;
    const halfWU = (baseWMm * 0.5) / scaleMm;
    const pitchU = pitchMm / scaleMm;

    const cornerAnchorU = 6.0 / scaleMm;
    const shoreMarginU = 2.6 / scaleMm;
    const extInsetU = Math.max(0.5 / scaleMm, cornerAnchorU - shoreMarginU);

    const exts = _extractBorderDryExtensions(mf, landSafe, tb, scaleMm, extInsetU);
    let extended = landSafe;
    for (const ext of exts) {
      const next = extended.add(ext);
      extended.delete();
      ext.delete();
      extended = next;
    }
    const shrunk = extended.offset(-shoreMarginU, 'Round');
    extended.delete();

    const padClipU = 0.5 / scaleMm;
    const tbClip = _makeRectCS(mf, tb.minX - padClipU, tb.minY - padClipU, tb.maxX + padClipU, tb.maxY + padClipU);
    let safeInterior = shrunk.intersect(tbClip);
    shrunk.delete();
    tbClip.delete();

    if (pad && pad.rect && !safeInterior.isEmpty()) {
      const [px0, py0, px1, py1] = _ringBBox2D(pad.rect);
      const padMarginU = 1.2 / scaleMm;
      const avoidCS = _makeRectCS(mf, px0 - padMarginU, py0 - padMarginU, px1 + padMarginU, py1 + padMarginU);
      const next = safeInterior.subtract(avoidCS);
      safeInterior.delete();
      avoidCS.delete();
      safeInterior = next;
    }
    if (safeInterior.isEmpty()) {
      safeInterior.delete();
      return empty;
    }

    const minLenU = 6.0 / scaleMm;
    const borderTolU = 0.20 / scaleMm;
    const outExtU = 2.2 / scaleMm;

    const sweepAxis = (alongY) => {
      const transMin = alongY ? tb.minX : tb.minY;
      const transMax = alongY ? tb.maxX : tb.maxY;
      const axisMin = alongY ? tb.minY : tb.minX;
      const axisMax = alongY ? tb.maxY : tb.maxX;
      const evenPolys = [];
      const oddPolys = [];
      const keptSegs = [];

      let gi = 0;
      for (let c = transMin + cornerAnchorU + halfWU; c <= transMax - cornerAnchorU - halfWU + 1e-6; c += pitchU, gi++) {
        const strip = alongY
          ? _makeRectCS(mf, c - halfWU, axisMin - padClipU, c + halfWU, axisMax + padClipU)
          : _makeRectCS(mf, axisMin - padClipU, c - halfWU, axisMax + padClipU, c + halfWU);
        const outside = strip.subtract(safeInterior);
        strip.delete();

        const bad = [];
        if (!outside.isEmpty()) {
          const oComps = outside.decompose();
          for (const oc of oComps) {
            const ob = oc.bounds();
            oc.delete();
            const o0 = alongY ? ob.min[1] : ob.min[0];
            const o1 = alongY ? ob.max[1] : ob.max[0];
            bad.push([o0 - 1e-5, o1 + 1e-5]);
          }
        }
        outside.delete();

        const good = _subtract1DIntervals(axisMin - padClipU, axisMax + padClipU, bad);
        for (const [s0, s1] of good) {
          const c0 = Math.max(s0, axisMin);
          const c1 = Math.min(s1, axisMax);
          if (c1 - c0 < minLenU) continue;
          const touchesLo = s0 <= axisMin + borderTolU;
          const touchesHi = s1 >= axisMax - borderTolU;
          if (!touchesLo && !touchesHi) continue;

          const ext0 = touchesLo ? (axisMin - outExtU) : c0;
          const ext1 = touchesHi ? (axisMax + outExtU) : c1;
          const rect = alongY
            ? [[c - halfWU, ext0], [c + halfWU, ext0], [c + halfWU, ext1], [c - halfWU, ext1]]
            : [[ext0, c - halfWU], [ext1, c - halfWU], [ext1, c + halfWU], [ext0, c + halfWU]];
          if (gi % 2 === 0) evenPolys.push(rect);
          else oddPolys.push(rect);

          keptSegs.push({
            alongY,
            cx: c,
            halfW: halfWU,
            minX: alongY ? (c - halfWU) : c0,
            maxX: alongY ? (c + halfWU) : c1,
            minY: alongY ? c0 : (c - halfWU),
            maxY: alongY ? c1 : (c + halfWU),
            touchesLo,
            touchesHi,
          });
        }
      }
      return { evenPolys, oddPolys, keptSegs };
    };

    const primaryAlongY = spanYMm <= spanXMm;
    let plan = sweepAxis(primaryAlongY);
    if (plan.keptSegs.length === 0) {
      const altPlan = sweepAxis(!primaryAlongY);
      if (altPlan.keptSegs.length > 0) plan = altPlan;
    }
    safeInterior.delete();

    const cutters = [];
    const evenCut = _extrudeGrooveGroup(core, mf, plan.evenPolys, zFlatEvenMm, maxApexMm, dzMm, baseWMm, nSteps, scaleMm);
    if (evenCut) cutters.push(evenCut);
    const oddCut = _extrudeGrooveGroup(core, mf, plan.oddPolys, zFlatOddMm, maxApexMm, dzMm, baseWMm, nSteps, scaleMm);
    if (oddCut) cutters.push(oddCut);
    return { cutters, keptSegs: plan.keptSegs };
  }

  function _closestPointOnRingEdges(px, py, ring) {
    let bestD2 = Infinity;
    let bestPt = ring[0];
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const l2 = vx * vx + vy * vy;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / l2)) : 0;
      const qx = a[0] + t * vx, qy = a[1] + t * vy;
      const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (d2 < bestD2) { bestD2 = d2; bestPt = [qx, qy]; }
    }
    return bestPt;
  }

  /**
   * Finds the shortest dry vent path from the ID underline to a groove, chamber, or open boundary.
   */
  function _computeShortestDryVentPath(ctx, terrainWater, poly, pad, uSpec, tb, scaleMm, markDepthU, keptGrooveSegs, keptDeepChambers, pluggedRings) {
    const ventHalfW = 0.55 / scaleMm;
    const minNeedZ = markDepthU + 0.72 / scaleMm;
    const stepU = Math.max(0.25 / scaleMm, ventHalfW * 0.65);
    const corrOffU = 0.40 / scaleMm;
    const glyphAvoid = [
      uSpec.xLeft - 0.25 / scaleMm,
      uSpec.xRight + 0.25 / scaleMm,
      uSpec.yBase + 0.50 / scaleMm,
      pad.cy + pad.glyphH * 0.5 + 0.45 / scaleMm,
    ];
    const inGlyphBox = (x, y) => x >= glyphAvoid[0] && x <= glyphAvoid[1] && y >= glyphAvoid[2] && y <= glyphAvoid[3];
    const inTile = (x, y) => x >= tb.minX && x <= tb.maxX && y >= tb.minY && y <= tb.maxY;
    const isPluggedWater = (x, y) => pluggedRings.some(r => poly.pointInPoly2D(x, y, r));
    const isDryPt = (x, y) => inTile(x, y) && !terrainWater.isPointInWater(x, y) && ctx.getTerrainZ(x, y) >= minNeedZ;
    const isOpenWaterOrBorder = (x, y) => (
      x <= tb.minX + 1e-4 || x >= tb.maxX - 1e-4 || y <= tb.minY + 1e-4 || y >= tb.maxY - 1e-4 ||
      (ctx.waterCutout && terrainWater.isPointInWater(x, y) && !isPluggedWater(x, y))
    );

    const checkDrySeg = (p0, p1, inGoalFn) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return false;
      const ux = dx / len, uy = dy / len;
      const nx = -uy * corrOffU, ny = ux * corrOffU;
      const nSteps = Math.max(2, Math.ceil(len / stepU));
      const sideOk = (sx, sy) => isDryPt(sx, sy) || (inGoalFn && inGoalFn(sx, sy));
      for (let i = 0; i <= nSteps; i++) {
        const t = i / nSteps;
        const x = p0[0] + dx * t, y = p0[1] + dy * t;
        if (inGlyphBox(x, y)) return false;
        if (inGoalFn && inGoalFn(x, y)) return true;
        if (!isDryPt(x, y)) return false;
        if (i > 0 && (!sideOk(x + nx, y + ny) || !sideOk(x - nx, y - ny))) return false;
      }
      return !inGoalFn;
    };

    const starts = [
      [[uSpec.xLeft, uSpec.yBase]],
      [[(uSpec.xLeft + pad.cx) * 0.5, uSpec.yBase]],
      [[pad.cx, uSpec.yBase]],
      [[(pad.cx + uSpec.xRight) * 0.5, uSpec.yBase]],
      [[uSpec.xRight, uSpec.yBase]],
    ];
    const bypassL = [uSpec.xLeft - 1.2 / scaleMm, uSpec.yBase];
    if (checkDrySeg([uSpec.xLeft, uSpec.yBase], bypassL, null)) starts.push([[uSpec.xLeft, uSpec.yBase], bypassL]);
    const bypassR = [uSpec.xRight + 1.2 / scaleMm, uSpec.yBase];
    if (checkDrySeg([uSpec.xRight, uSpec.yBase], bypassR, null)) starts.push([[uSpec.xRight, uSpec.yBase], bypassR]);

    const pathLen = (pts) => {
      let s = 0;
      for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      return s;
    };

    const runGridDijkstra = (goalFn, targetRefPtFn) => {
      const spanX = tb.maxX - tb.minX, spanY = tb.maxY - tb.minY;
      const maxCells = 48;
      const cellU = Math.max(1.1 / scaleMm, Math.max(spanX, spanY) / maxCells);
      const nx = Math.max(4, Math.min(maxCells, Math.round(spanX / cellU)));
      const ny = Math.max(4, Math.min(maxCells, Math.round(spanY / cellU)));
      const dx = spanX / nx, dy = spanY / ny;
      const cellXY = (ix, iy) => [tb.minX + (ix + 0.5) * dx, tb.minY + (iy + 0.5) * dy];
      const segHitsGoal = (p0, p1) => {
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const steps = Math.max(2, Math.ceil(len / stepU));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          if (goalFn(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)) return true;
        }
        return false;
      };
      const total = nx * ny;
      const dist = new Float64Array(total).fill(Infinity);
      const prev = new Int32Array(total).fill(-1);
      const visited = new Uint8Array(total);
      const open = [];

      for (const st of starts) {
        const last = st[st.length - 1];
        const ix = Math.max(0, Math.min(nx - 1, Math.floor((last[0] - tb.minX) / dx)));
        const iy = Math.max(0, Math.min(ny - 1, Math.floor((last[1] - tb.minY) / dy)));
        const idx = iy * nx + ix;
        const c = cellXY(ix, iy);
        if (!checkDrySeg(last, c, goalFn)) continue;
        const d0 = pathLen(st) + Math.hypot(c[0] - last[0], c[1] - last[1]);
        if (d0 < dist[idx]) {
          dist[idx] = d0;
          prev[idx] = -2 - starts.indexOf(st);
          open.push(idx);
        }
      }
      if (open.length === 0) return null;

      const dirs = [[1, 0, dx], [-1, 0, dx], [0, 1, dy], [0, -1, dy], [1, 1, Math.hypot(dx, dy)], [1, -1, Math.hypot(dx, dy)], [-1, 1, Math.hypot(dx, dy)], [-1, -1, Math.hypot(dx, dy)]];
      let goalIdx = -1;
      while (open.length > 0) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
        const cur = open[bi];
        open[bi] = open[open.length - 1];
        open.pop();
        if (visited[cur]) continue;
        visited[cur] = 1;
        const cx = cur % nx, cy = Math.floor(cur / nx);
        const cp = cellXY(cx, cy);
        if (goalFn(cp[0], cp[1])) { goalIdx = cur; break; }
        for (const [ox, oy, w] of dirs) {
          const tx = cx + ox, ty = cy + oy;
          if (tx < 0 || tx >= nx || ty < 0 || ty >= ny) continue;
          const nxt = ty * nx + tx;
          if (visited[nxt]) continue;
          const np = cellXY(tx, ty);
          const nIsGoal = goalFn(np[0], np[1]) || segHitsGoal(cp, np);
          if (!nIsGoal && (!isDryPt(np[0], np[1]) || inGlyphBox(np[0], np[1]))) continue;
          if (!checkDrySeg(cp, np, nIsGoal ? goalFn : null)) continue;
          const nd = dist[cur] + w;
          if (nd < dist[nxt]) {
            dist[nxt] = nd;
            prev[nxt] = cur;
            open.push(nxt);
          }
        }
      }
      if (goalIdx < 0) return null;
      const rev = [];
      let cur = goalIdx;
      while (cur >= 0) {
        rev.push(cellXY(cur % nx, Math.floor(cur / nx)));
        cur = prev[cur];
      }
      const stIdx = Math.max(0, -cur - 2);
      const raw = starts[stIdx].concat(rev.reverse());
      if (targetRefPtFn) {
        const anchorPt = raw.length >= 2 ? raw[raw.length - 2] : raw[raw.length - 1];
        const tp = targetRefPtFn(anchorPt[0], anchorPt[1]);
        if (tp) raw[raw.length - 1] = tp;
      }
      // Greedy line-of-sight smoothing to keep vent geometry minimal.
      const simp = [raw[0]];
      let i = 0;
      while (i < raw.length - 1) {
        let bestJ = i + 1;
        for (let j = raw.length - 1; j > i + 1; j--) {
          const isEnd = j === raw.length - 1;
          if (checkDrySeg(raw[i], raw[j], isEnd ? goalFn : null)) { bestJ = j; break; }
        }
        simp.push(raw[bestJ]);
        i = bestJ;
      }
      return simp;
    };

    // 1. Priority: nearest kept shallow relief groove segment
    if (keptGrooveSegs.length > 0) {
      let bestPts = null, bestLen = Infinity;
      const segTarget = (ax, ay, seg) => {
        const segLen = seg.alongY ? (seg.maxY - seg.minY) : (seg.maxX - seg.minX);
        const endInsetU = Math.min(segLen * 0.25, 0.85 / scaleMm);
        let tx, ty;
        if (seg.alongY) {
          const y0 = seg.touchesLo ? seg.minY : (seg.minY + endInsetU);
          const y1 = seg.touchesHi ? seg.maxY : (seg.maxY - endInsetU);
          tx = seg.cx;
          ty = Math.max(y0, Math.min(y1, ay));
        } else {
          const x0 = seg.touchesLo ? seg.minX : (seg.minX + endInsetU);
          const x1 = seg.touchesHi ? seg.maxX : (seg.maxX - endInsetU);
          tx = Math.max(x0, Math.min(x1, ax));
          ty = seg.cx;
        }
        const dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy);
        const over = 0.50 / scaleMm;
        const ex = d > 1e-6 ? (tx + (dx / d) * over) : tx;
        const ey = d > 1e-6 ? (ty + (dy / d) * over) : ty;
        return [ex, ey];
      };
      const inGroove = (x, y) => keptGrooveSegs.some(s => x >= s.minX && x <= s.maxX && y >= s.minY && y <= s.maxY);

      for (const st of starts) {
        const last = st[st.length - 1];
        for (const seg of keptGrooveSegs) {
          const tgt = segTarget(last[0], last[1], seg);
          const cand = st.concat([tgt]);
          const len = pathLen(cand);
          if (len >= bestLen) continue;
          if (checkDrySeg(last, tgt, inGroove)) { bestLen = len; bestPts = cand; }
        }
      }
      if (!bestPts) {
        bestPts = runGridDijkstra(inGroove, (x, y) => {
          let bestS = keptGrooveSegs[0], bd = Infinity;
          for (const seg of keptGrooveSegs) {
            const cx = Math.max(seg.minX, Math.min(seg.maxX, x));
            const cy = Math.max(seg.minY, Math.min(seg.maxY, y));
            const d = Math.hypot(cx - x, cy - y);
            if (d < bd) { bd = d; bestS = seg; }
          }
          return segTarget(x, y, bestS);
        });
      }
      if (bestPts) return [{ pts: bestPts, halfW: ventHalfW, squareEnd: true }];
    }

    // 2. Priority: nearest kept deep hollow vault chamber
    if (keptDeepChambers.length > 0) {
      let bestPts = null, bestLen = Infinity;
      const inChamber = (x, y) => keptDeepChambers.some(ch => _inStructuredChamber(poly, x, y, ch));
      for (const st of starts) {
        const last = st[st.length - 1];
        for (const ch of keptDeepChambers) {
          const rings = [ch.outer].concat(ch.holes || []);
          for (const rg of rings) {
            const bp = _closestPointOnRingEdges(last[0], last[1], rg);
            const dx = bp[0] - last[0], dy = bp[1] - last[1], d = Math.hypot(dx, dy);
            if (d < 1e-6) continue;
            const ex = bp[0] + (dx / d) * (0.80 / scaleMm);
            const ey = bp[1] + (dy / d) * (0.80 / scaleMm);
            if (!_inStructuredChamber(poly, ex, ey, ch)) continue;
            const cand = st.concat([[ex, ey]]);
            const len = pathLen(cand);
            if (len < bestLen && checkDrySeg(last, [ex, ey], inChamber)) {
              bestLen = len;
              bestPts = cand;
            }
          }
        }
      }
      if (!bestPts) bestPts = runGridDijkstra(inChamber, null);
      if (bestPts) return [{ pts: bestPts, halfW: ventHalfW, squareEnd: true }];
    }

    // 3. Priority: nearest open tile border or open cutout water boundary
    let bestPts = null, bestLen = Infinity;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (ctx.waterCutout) {
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        dirs.push([Math.cos(a), Math.sin(a)]);
      }
    }
    const maxSpan = Math.hypot(tb.maxX - tb.minX, tb.maxY - tb.minY) + 1.0 / scaleMm;
    const overU = 0.55 / scaleMm;
    for (const st of starts) {
      const last = st[st.length - 1];
      for (const [ux, uy] of dirs) {
        let hitPt = null;
        for (let d = stepU; d <= maxSpan; d += stepU) {
          const x = last[0] + ux * d, y = last[1] + uy * d;
          if (inGlyphBox(x, y)) break;
          if (x <= tb.minX || x >= tb.maxX || y <= tb.minY || y >= tb.maxY) {
            hitPt = [
              Math.max(tb.minX - overU, Math.min(tb.maxX + overU, x + ux * overU)),
              Math.max(tb.minY - overU, Math.min(tb.maxY + overU, y + uy * overU)),
            ];
            break;
          }
          if (ctx.waterCutout && terrainWater.isPointInWater(x, y)) {
            if (!isPluggedWater(x, y)) hitPt = [x + ux * overU, y + uy * overU];
            break;
          }
          if (ctx.getTerrainZ(x, y) < minNeedZ) break;
        }
        if (!hitPt) continue;
        const cand = st.concat([hitPt]);
        const len = pathLen(cand);
        if (len >= bestLen) continue;
        if (checkDrySeg(last, hitPt, isOpenWaterOrBorder)) { bestLen = len; bestPts = cand; }
      }
    }
    if (!bestPts) {
      bestPts = runGridDijkstra(isOpenWaterOrBorder, (x, y) => {
        const dL = Math.abs(x - tb.minX), dR = Math.abs(tb.maxX - x);
        const dB = Math.abs(y - tb.minY), dT = Math.abs(tb.maxY - y);
        const m = Math.min(dL, dR, dB, dT);
        if (m <= 1.6 / scaleMm) {
          if (m === dL) return [tb.minX - overU, y];
          if (m === dR) return [tb.maxX + overU, y];
          if (m === dB) return [x, tb.minY - overU];
          return [x, tb.maxY + overU];
        }
        return [x, y];
      });
    }
    return bestPts ? [{ pts: bestPts, halfW: ventHalfW, squareEnd: true }] : [];
  }

  function _dropFloatingSlivers(core, mf, outTile, terrainManifold, scaleMm) {
    if (!outTile || typeof outTile.decompose !== 'function') return outTile;
    try {
      const comps = outTile.decompose();
      if (!Array.isArray(comps) || comps.length <= 1) {
        if (Array.isArray(comps)) for (const c of comps) core.safeDeleteManifold(c);
        return outTile;
      }
      const grounded = [], floating = [];
      for (const c of comps) {
        if (!c || c.numTri() === 0) { core.safeDeleteManifold(c); continue; }
        if (c.boundingBox().min[2] <= 0.05 / scaleMm) grounded.push(c);
        else floating.push(c);
      }
      if (grounded.length > 0 && floating.length > 0) {
        for (const f of floating) core.safeDeleteManifold(f);
        const reunited = core.batchUnionManifolds(mf, grounded);
        if (reunited && reunited.numTri() > 0) {
          if (outTile !== terrainManifold) core.safeDeleteManifold(outTile);
          return reunited;
        }
        core.safeDeleteManifold(reunited);
      } else {
        for (const c of grounded) core.safeDeleteManifold(c);
        for (const c of floating) core.safeDeleteManifold(c);
      }
    } catch (_) {}
    return outTile;
  }

  /**
   * Carves optional SLA hollow vault, anti-peel relief grooves, and underside tile ID.
   * When ctx.solidBaseNoTunnels is true, keeps a 100% solid tunnel-free base with smooth
   * outer vertical walls and omits underside engraving so Z=0 stays flat and suction-free.
   * @param {object} ctx - 3-layer build context.
   * @param {object} terrainWater - Layer-1 terrain and water output.
   * @param {object} baseTile - clipped tile base Manifold.
   * @param {object} tb - tile bounds metadata.
   * @param {Array<Array<Array<number>>>} waterMarginRings2D - buffered water rings to keep solid.
   * @returns {object}
   */
  function carveTileHollowVaultAndId(ctx, terrainWater, baseTile, tb, waterMarginRings2D) {
    const { core, poly, embossMod } = _getDeps();
    const { mf, scaleMm, hollowBase } = ctx;
    const solidBaseNoTunnels = Boolean(ctx.solidBaseNoTunnels);
    const baseBottomMm = (Number(ctx.baseBottomMm) > 0) ? Number(ctx.baseBottomMm) : 2.35;
    if (!baseTile || baseTile.numTri() === 0) {
      return {
        baseTile, drainCount: 0, hollowChambersKept: 0, hollowChambersFilledSolid: 0,
        reliefGroovesCount: 0, ribPitchMm: 10.5, ribThickMm: 0, emboss: null,
      };
    }

    const minShellMm = (ctx.slaLaws && typeof ctx.slaLaws.minWallThicknessMm === 'function')
      ? Math.max(0.8, ctx.slaLaws.minWallThicknessMm(0))
      : 0.8;
    const rawWallMm = Number(ctx.hollowWallMm);
    const tShellMm = Math.max(minShellMm, (Number.isFinite(rawWallMm) && rawWallMm > 0) ? rawWallMm : 1.8), wallU = tShellMm / scaleMm;
    const minColU = (tShellMm + 2.0) / scaleMm, ribPitchMm = 10.5;
    const markDepthU = Math.max(0.68 / scaleMm, Math.min(wallU * 0.42, 0.82 / scaleMm));
    const minDryZU = _sampleMinDryZU(ctx, terrainWater, tb);
    const minDryZMm = minDryZU * scaleMm;

    let outTile = baseTile;
    let pluggedRings = [];

    const pad = solidBaseNoTunnels
      ? null
      : embossMod.findSafeIdPad(ctx, terrainWater, tb, scaleMm, markDepthU, 0.78 / scaleMm);
    const cutSolids = [];
    let drainCount = 0, hollowChambersKept = 0, hollowChambersFilledSolid = 0, reliefGroovesCount = 0;
    const keptDeepChambers = [];
    let keptGrooveSegs = [];
    const minWallMm = (ctx.slaLaws && ctx.slaLaws.minWallThicknessMm) ? ctx.slaLaws.minWallThicknessMm(tb.maxZMm || 20) : 1.0;
    const ribThickU = Math.max(1.25 / scaleMm, minWallMm / scaleMm);

    if (hollowBase && !solidBaseNoTunnels) {
      let vault2D = _buildDeepZones2D(core, ctx, tb, wallU, minColU);
      if (pad && vault2D.length) vault2D = core.clipperDiffPolys(vault2D, [pad.rect], 1e-5);
      if (waterMarginRings2D.length && vault2D.length) vault2D = core.clipperDiffPolys(vault2D, waterMarginRings2D, 1e-5);
      if (vault2D.length) vault2D = _subtractDiagonal45Ribs(core, poly, vault2D, tb, scaleMm, ribPitchMm / scaleMm, ribThickU);
      const chambers = core.ringsToOutersWithHoles(vault2D, 1e-5), minAreaU2 = 90.0 / (scaleMm * scaleMm);
      const keptSolids = [], drainBoxes = [];
      for (const ch of chambers) {
        if (Math.abs(poly.signedArea2D(ch.outer)) < minAreaU2) continue;
        const drains = _findChamberDrains(ctx, terrainWater, poly, ch, tb, wallU, scaleMm, waterMarginRings2D, pad ? pad.rect : null);
        if (drains.length < 2) { hollowChambersFilledSolid++; continue; }
        const cm = core.extrudeRingSolid(mf, ch.outer, ch.holes, -0.5, terrainWater.terrainManifold.boundingBox().max[2] + 5.0);
        if (!cm) continue;
        hollowChambersKept++; drainCount += drains.length; keptSolids.push(cm); keptDeepChambers.push(ch);
        for (const d of drains) { const db = core.boxManifoldFromBounds(mf, ...d.bounds); if (db) drainBoxes.push(db); }
      }
      if (keptSolids.length > 0) {
        const mask = core.batchUnionManifolds(mf, keptSolids), ceilRef = terrainWater.terrainManifold.translate([0, 0, -wallU]);
        const vaultCut = ceilRef.intersect(mask);
        core.safeDeleteManifold(ceilRef); core.safeDeleteManifold(mask);
        if (vaultCut && vaultCut.numTri() > 0) cutSolids.push(vaultCut); else core.safeDeleteManifold(vaultCut);
        for (const db of drainBoxes) cutSolids.push(db);
      } else for (const db of drainBoxes) core.safeDeleteManifold(db);

      if (hollowChambersKept === 0 && hollowChambersFilledSolid === 0) {
        const relief = _buildShallowAntiPeelRelief(core, mf, outTile, tb, scaleMm, minDryZMm, pad);
        for (const c of relief.cutters) cutSolids.push(c);
        keptGrooveSegs = relief.keptSegs;
        reliefGroovesCount = keptGrooveSegs.length;
      }
    }

    if (pad) {
      const labelStr = `${tb.label || 'R1C1'}^`;
      const uSpec = embossMod.computeLabelUnderlineSpec(labelStr, pad, scaleMm);
      const ventPaths = _computeShortestDryVentPath(
        ctx, terrainWater, poly, pad, uSpec, tb, scaleMm, markDepthU,
        keptGrooveSegs, keptDeepChambers, pluggedRings
      );
      const idSolids = embossMod.buildIdEngravingSolids(mf, labelStr, pad, scaleMm, markDepthU, ventPaths);
      for (const s of idSolids) cutSolids.push(s);
    }

    if (cutSolids.length > 0) {
      const fullCut = core.batchUnionManifolds(mf, cutSolids), carved = fullCut ? outTile.subtract(fullCut) : null;
      core.safeDeleteManifold(fullCut);
      if (carved && carved.numTri() > 0) {
        if (outTile !== terrainWater.terrainManifold) core.safeDeleteManifold(outTile);
        outTile = _dropFloatingSlivers(core, mf, carved, terrainWater.terrainManifold, scaleMm);
        if (typeof outTile.simplify === 'function') {
          try {
            const simp = outTile.simplify(6e-4);
            if (simp && simp.numTri() > 0) {
              if (outTile !== terrainWater.terrainManifold) core.safeDeleteManifold(outTile);
              outTile = simp;
            } else core.safeDeleteManifold(simp);
          } catch (_) {}
        }
      } else core.safeDeleteManifold(carved);
    }
    return {
      baseTile: outTile, drainCount, hollowChambersKept, hollowChambersFilledSolid,
      reliefGroovesCount, ribPitchMm, ribThickMm: ribThickU * scaleMm,
      emboss: pad ? { strokeWidthMm: pad.strokeW * scaleMm, carveDepthMm: markDepthU * scaleMm, minRoofClearanceMm: pad.minRoofClearanceMm } : null,
    };
  }

  function _plugPostUnionBasePockets(core, poly, mf, unified, uBB, scaleMm, baseBottomMm = 2.35) {
    const safeBaseMm = (Number(baseBottomMm) > 0) ? Number(baseBottomMm) : 2.35;
    const zProbeU = 1.05 / scaleMm;
    const zLowProbeU = 0.15 / scaleMm;
    const zPlugTopU = Math.min(safeBaseMm / scaleMm, uBB.max[2] - 0.10 / scaleMm);
    if (zPlugTopU <= 0.10 / scaleMm || uBB.max[2] <= zProbeU) return unified;

    const minVentHoleAreaU2 = 18.0 / (scaleMm * scaleMm);
    const maxHoleAreaU2 = 45.0 / (scaleMm * scaleMm);
    const minCapSlitAreaU2 = 0.40 / (scaleMm * scaleMm);
    const edgeTolU = 0.20 / scaleMm;
    const closeRadU = 0.26 / scaleMm;
    const outOffU = 0.26 / scaleMm;

    let s1 = null;
    let dil = null;
    let closed = null;
    let sLow = null;
    let dilLow = null;
    let closedLow = null;
    let cap105 = null;
    let capLow = null;
    let capThru = null;
    let polys = [];
    const rawLargeHoles = [];
    const capSlitComps = [];
    try {
      s1 = unified.slice(zProbeU);
      if (!s1.isEmpty()) {
        const rawPolys = s1.toPolygons();
        for (let i = 0; i < rawPolys.length; i++) {
          const rr = rawPolys[i];
          if (!rr || rr.length < 3) continue;
          const rsa = poly.signedArea2D(rr);
          if (rsa < -1e-7 && Math.abs(rsa) >= minVentHoleAreaU2) {
            rawLargeHoles.push({ ring: rr, bb: _ringBBox2D(rr) });
          }
        }
        dil = s1.offset(closeRadU, 'Round');
        if (!dil.isEmpty()) {
          closed = dil.offset(-closeRadU, 'Round');
          if (!closed.isEmpty()) {
            polys = closed.toPolygons();
            // Capture vertical through-base capillary slits (<= 2*closeRadU at both Z=0.15 and Z=1.05)
            // so narrow seawall/boardwalk cracks fuse solid (DFM-02 / VAL-02) without touching wide grooves.
            sLow = unified.slice(zLowProbeU);
            if (!sLow.isEmpty()) {
              dilLow = sLow.offset(closeRadU, 'Round');
              if (!dilLow.isEmpty()) {
                closedLow = dilLow.offset(-closeRadU, 'Round');
                if (!closedLow.isEmpty()) {
                  cap105 = closed.subtract(s1);
                  capLow = closedLow.subtract(sLow);
                  if (!cap105.isEmpty() && !capLow.isEmpty()) {
                    capThru = cap105.intersect(capLow);
                    if (!capThru.isEmpty()) {
                      const comps = capThru.decompose();
                      for (let ci = 0; ci < comps.length; ci++) {
                        const c = comps[ci];
                        const area = c.area();
                        if (area >= minCapSlitAreaU2 && area < maxHoleAreaU2) {
                          const cb = c.bounds();
                          if (cb.min[0] > uBB.min[0] + edgeTolU && cb.max[0] < uBB.max[0] - edgeTolU &&
                              cb.min[1] > uBB.min[1] + edgeTolU && cb.max[1] < uBB.max[1] - edgeTolU) {
                            capSlitComps.push(c);
                            continue;
                          }
                        }
                        core.safeDeleteManifold(c);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (_) {
      polys = [];
    } finally {
      core.safeDeleteManifold(s1);
      core.safeDeleteManifold(dil);
      core.safeDeleteManifold(closed);
      core.safeDeleteManifold(sLow);
      core.safeDeleteManifold(dilLow);
      core.safeDeleteManifold(closedLow);
      core.safeDeleteManifold(cap105);
      core.safeDeleteManifold(capLow);
      core.safeDeleteManifold(capThru);
    }

    const plugs = [];
    for (let ci = 0; ci < capSlitComps.length; ci++) {
      const comp = capSlitComps[ci];
      let csP = null;
      try {
        csP = comp.offset(0.08 / scaleMm, 'Round');
        const plug = csP.isEmpty() ? null : csP.extrude(zPlugTopU);
        if (plug && plug.numTri() > 0) plugs.push(plug);
        else core.safeDeleteManifold(plug);
      } catch (_) {
      } finally {
        core.safeDeleteManifold(csP);
        core.safeDeleteManifold(comp);
      }
    }
    let tileRectCS = null;
    try {
      tileRectCS = mf.CrossSection.ofPolygons([[[uBB.min[0], uBB.min[1]], [uBB.max[0], uBB.min[1]], [uBB.max[0], uBB.max[1]], [uBB.min[0], uBB.max[1]]]], 'Positive');
    } catch (_) {
      tileRectCS = null;
    }
    try {
      for (let i = 0; i < polys.length; i++) {
        const r = polys[i];
        if (!r || r.length < 3) continue;
        const sa = poly.signedArea2D(r);
        const absArea = Math.abs(sa);
        if (sa >= -1e-7 || absArea >= maxHoleAreaU2) continue;
        // Genuine enclosed basins >= 18 mm2 (already closed in raw s1 before capillary closing)
        // stay open on top and receive a hidden underside vent slot instead of being plugged solid.
        if (absArea >= minVentHoleAreaU2 && rawLargeHoles.length > 0) {
          const rbb = _ringBBox2D(r);
          const probe = _findInteriorPointInCS(poly, [r], { min: [rbb[0], rbb[1]], max: [rbb[2], rbb[3]] });
          const isGenuineBasin = probe && rawLargeHoles.some(rh =>
            probe[0] >= rh.bb[0] && probe[0] <= rh.bb[2] &&
            probe[1] >= rh.bb[1] && probe[1] <= rh.bb[3] &&
            poly.pointInPoly2D(probe[0], probe[1], rh.ring)
          );
          if (isGenuineBasin) continue;
        }
        const ccw = r.slice().reverse();
        let csH = null;
        let csP = null;
        let csClip = null;
        try {
          csH = mf.CrossSection.ofPolygons([ccw], 'Positive');
          csP = csH.offset(outOffU, 'Round');
          csClip = (tileRectCS && !csP.isEmpty()) ? csP.intersect(tileRectCS) : csP;
          const plug = (!csClip || csClip.isEmpty()) ? null : csClip.extrude(zPlugTopU);
          if (plug && plug.numTri() > 0) plugs.push(plug);
          else core.safeDeleteManifold(plug);
        } catch (_) {
        } finally {
          if (csClip && csClip !== csP) core.safeDeleteManifold(csClip);
          core.safeDeleteManifold(csH);
          core.safeDeleteManifold(csP);
        }
      }
    } finally {
      core.safeDeleteManifold(tileRectCS);
    }

    if (plugs.length === 0) return unified;
    const allPlugs = core.batchUnionManifolds(mf, plugs);
    const plugged = allPlugs ? unified.add(allPlugs) : null;
    core.safeDeleteManifold(allPlugs);
    if (plugged && plugged.numTri() > 0) {
      core.safeDeleteManifold(unified);
      return plugged;
    }
    core.safeDeleteManifold(plugged);
    return unified;
  }

  function _rasterizePolysToGrid(polys, nx, ny, ox, oy, stepU) {
    const grid = new Uint8Array(nx * ny);
    if (!polys || polys.length === 0) return grid;

    const rowSegs = Array.from({ length: ny }, () => []);
    const colSegs = Array.from({ length: nx }, () => []);
    const minSpanU = stepU * 0.02;

    for (let pi = 0; pi < polys.length; pi++) {
      const ring = polys[pi];
      if (!ring || ring.length < 3) continue;
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const ax = a[0], ay = a[1], bx = b[0], by = b[1];

        if (ay !== by) {
          const r0 = Math.max(0, Math.floor((Math.min(ay, by) - oy) / stepU - 0.5));
          const r1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) - oy) / stepU - 0.5));
          for (let r = r0; r <= r1; r++) {
            const yc = oy + (r + 0.5) * stepU;
            if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
              rowSegs[r].push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
            }
          }
        }

        if (ax !== bx) {
          const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - ox) / stepU - 0.5));
          const c1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) - ox) / stepU - 0.5));
          for (let c = c0; c <= c1; c++) {
            const xc = ox + (c + 0.5) * stepU;
            if ((ax <= xc && bx > xc) || (bx <= xc && ax > xc)) {
              colSegs[c].push(ay + ((xc - ax) * (by - ay)) / (bx - ax));
            }
          }
        }
      }
    }

    for (let r = 0; r < ny; r++) {
      const xs = rowSegs[r];
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const rowOff = r * nx;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = xs[k], x1 = xs[k + 1];
        const c0 = Math.max(0, Math.floor((x0 - ox) / stepU));
        const c1 = Math.min(nx - 1, Math.floor((x1 - ox) / stepU));
        let hit = false;
        for (let c = c0; c <= c1; c++) {
          const xc = ox + (c + 0.5) * stepU;
          if (x0 <= xc && xc <= x1) {
            grid[rowOff + c] = 1;
            hit = true;
          }
        }
        // Keep sub-cell solid walls 4-connected so exterior air cannot leak through.
        if (!hit && (x1 - x0) > minSpanU) {
          const midC = Math.max(0, Math.min(nx - 1, Math.round((0.5 * (x0 + x1) - ox) / stepU - 0.5)));
          grid[rowOff + midC] = 1;
        }
      }
    }

    for (let c = 0; c < nx; c++) {
      const ys = colSegs[c];
      if (ys.length < 2) continue;
      ys.sort((a, b) => a - b);
      for (let k = 0; k + 1 < ys.length; k += 2) {
        const y0 = ys[k], y1 = ys[k + 1];
        const r0 = Math.max(0, Math.floor((y0 - oy) / stepU));
        const r1 = Math.min(ny - 1, Math.floor((y1 - oy) / stepU));
        let hit = false;
        for (let r = r0; r <= r1; r++) {
          const yc = oy + (r + 0.5) * stepU;
          if (y0 <= yc && yc <= y1) {
            hit = true;
            break;
          }
        }
        if (!hit && (y1 - y0) > minSpanU) {
          const midR = Math.max(0, Math.min(ny - 1, Math.round((0.5 * (y0 + y1) - oy) / stepU - 0.5)));
          grid[midR * nx + c] = 1;
        }
      }
    }
    return grid;
  }

  /**
   * Exact cell-center scanline rasterizer matching validate_msla_stl.py slice_grid_2d.
   * Unlike _rasterizePolysToGrid, does not dilate sub-cell walls so narrow 0.35-0.55 mm
   * courtyard alleys stay open instead of pinching large cavities into hidden fragments.
   * @param {Array<Array<Array<number>>>} polys
   * @param {number} nx
   * @param {number} ny
   * @param {number} ox
   * @param {number} oy
   * @param {number} stepU
   * @returns {Uint8Array}
   */
  function _rasterizePolysCenterGrid(polys, nx, ny, ox, oy, stepU) {
    const grid = new Uint8Array(nx * ny);
    if (!polys || polys.length === 0) return grid;
    const rowSegs = Array.from({ length: ny }, () => []);
    for (let pi = 0; pi < polys.length; pi++) {
      const ring = polys[pi];
      if (!ring || ring.length < 3) continue;
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const ay = a[1], by = b[1];
        if (ay === by) continue;
        const r0 = Math.max(0, Math.floor((Math.min(ay, by) - oy) / stepU - 0.5));
        const r1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) - oy) / stepU - 0.5));
        for (let r = r0; r <= r1; r++) {
          const yc = oy + (r + 0.5) * stepU;
          if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
            rowSegs[r].push(a[0] + ((yc - ay) * (b[0] - a[0])) / (by - ay));
          }
        }
      }
    }
    for (let r = 0; r < ny; r++) {
      const xs = rowSegs[r];
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const rowOff = r * nx;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = xs[k], x1 = xs[k + 1];
        const c0 = Math.max(0, Math.floor((x0 - ox) / stepU));
        const c1 = Math.min(nx - 1, Math.floor((x1 - ox) / stepU));
        for (let c = c0; c <= c1; c++) {
          const xc = ox + (c + 0.5) * stepU;
          if (x0 <= xc && xc <= x1) grid[rowOff + c] = 1;
        }
      }
    }
    return grid;
  }

  function _sliceCrossSectionPolys(core, man, zU) {
    let cs = null;
    try {
      cs = man.slice(zU);
      return cs.isEmpty() ? [] : cs.toPolygons();
    } catch (_) {
      return [];
    } finally {
      core.safeDeleteManifold(cs);
    }
  }

  function _findShortestBermRuns(cavityCells, blocked, solidCur, extAir, nx, ny, ox, oy, stepU, scaleMm) {
    const total = nx * ny;
    const dist = new Int32Array(total);
    const parent = new Int32Array(total);
    const settled = new Uint8Array(total);
    dist.fill(0x3fffffff);
    parent.fill(-1);

    const cap = total * 4 + 16;
    const dq = new Int32Array(cap);
    let head = 0, tail = 0, seeded = 0;
    for (let i = 0; i < cavityCells.length; i++) {
      const idx = cavityCells[i];
      if (blocked[idx]) continue;
      dist[idx] = 0;
      dq[tail] = idx;
      tail = (tail + 1) % cap;
      seeded++;
    }
    if (seeded === 0) return [];

    const dirs = [1, -1, nx, -nx];
    let goalIdx = -1;
    while (head !== tail) {
      const cur = dq[head];
      head = (head + 1) % cap;
      if (settled[cur]) continue;
      settled[cur] = 1;
      if (extAir[cur]) {
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
        if (blocked[nxt] || settled[nxt]) continue;
        const w = solidCur[nxt] ? 1 : 0;
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
    const extU = 0.55 / scaleMm;
    const halfW = 0.58 / scaleMm;
    const runs = [];
    let i = 0;
    while (i < cellPath.length) {
      if (!solidCur[cellPath[i]]) { i++; continue; }
      const runStart = i;
      while (i < cellPath.length && solidCur[cellPath[i]]) i++;
      const runEnd = i - 1;
      const pts = [];
      if (runStart > 0) {
        const pAir = cellXY(cellPath[runStart - 1]);
        const pFirst = cellXY(cellPath[runStart]);
        const dx = pAir[0] - pFirst[0], dy = pAir[1] - pFirst[1];
        const d = Math.hypot(dx, dy);
        if (d > 1e-8) pts.push([pFirst[0] + (dx / d) * extU, pFirst[1] + (dy / d) * extU]);
      }
      for (let k = runStart; k <= runEnd; k++) pts.push(cellXY(cellPath[k]));
      if (runEnd + 1 < cellPath.length) {
        const pLast = cellXY(cellPath[runEnd]);
        const pAir = cellXY(cellPath[runEnd + 1]);
        const dx = pAir[0] - pLast[0], dy = pAir[1] - pLast[1];
        const d = Math.hypot(dx, dy);
        if (d > 1e-8) pts.push([pLast[0] + (dx / d) * extU, pLast[1] + (dy / d) * extU]);
      }
      if (pts.length >= 2) {
        const simp = [pts[0]];
        for (let k = 1; k + 1 < pts.length; k++) {
          const a = simp[simp.length - 1], b = pts[k], c = pts[k + 1];
          const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
          if (cross > 1e-7) simp.push(b);
        }
        simp.push(pts[pts.length - 1]);
        runs.push({ pts: simp, halfW });
      }
    }
    return runs;
  }

  function _ventUpperSealedCourtyards(core, poly, mf, unified, scaleMm, baseBottomMm = 2.35, ventMod = null) {
    const safeBaseMm = (Number(baseBottomMm) > 0) ? Number(baseBottomMm) : 2.35;
    const minHoleAreaU2 = 65.0 / (scaleMm * scaleMm);
    const minArchwayAreaU2 = 65.0 / (scaleMm * scaleMm);
    const initBB = unified.boundingBox();
    const maxZMm = initBB.max[2] * scaleMm;
    // Strictly ascending scan from base top up to +12.0 mm: dense 0.15-0.25 mm spacing
    // across the road-berm / shallow DEM zone (+0.05..+1.15 mm) then 0.50 mm steps aligned
    // with validator upper-story planes (+1.15, +1.65, +2.15...).
    const zListMm = [
      safeBaseMm + 0.05,
      safeBaseMm + 0.15,
      safeBaseMm + 0.30,
      safeBaseMm + 0.55,
      safeBaseMm + 0.65,
      safeBaseMm + 0.90,
    ];
    const zUpperLimitMm = Math.min(maxZMm - 0.40, safeBaseMm + 12.0);
    for (let zm = safeBaseMm + 1.15; zm <= zUpperLimitMm + 1e-6; zm += 0.50) {
      zListMm.push(zm);
    }
    const zSlabCheckMm = Math.max(1.85, safeBaseMm - 0.50);
    const zBaseTopCheckMm = Math.max(2.10, safeBaseMm - 0.15);
    const zBotFloorMm = Math.max(2.30, safeBaseMm - 0.05);

    const spanXMm = (initBB.max[0] - initBB.min[0]) * scaleMm;
    const spanYMm = (initBB.max[1] - initBB.min[1]) * scaleMm;
    // Match VAL-02 0.30 mm raster pitch exactly (never < 0.30 mm, which leaks through <=0.28 mm
    // cracks that VAL-02 treats as sealed) and align origin with validate_msla_stl.py (-2*step).
    const stepMm = Math.max(0.30, Math.max(spanXMm, spanYMm) / 800);
    const stepU = stepMm / scaleMm;
    const nx = Math.ceil((initBB.max[0] - initBB.min[0]) / stepU) + 4;
    const ny = Math.ceil((initBB.max[1] - initBB.min[1]) / stepU) + 4;
    const ox = initBB.min[0] - 2 * stepU;
    const oy = initBB.min[1] - 2 * stepU;
    const total = nx * ny;

    const phases = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
    const ventSeedByPhase = [null, null, null, null];
    let baseSeedPolysCache = null;
    const ensureVentSeedForPhase = (pi) => {
      if (ventSeedByPhase[pi] !== null) return ventSeedByPhase[pi];
      if (baseSeedPolysCache === null) {
        baseSeedPolysCache = {
          p115: _sliceCrossSectionPolys(core, unified, 1.15 / scaleMm),
          p185: _sliceCrossSectionPolys(core, unified, zSlabCheckMm / scaleMm),
          pTop: _sliceCrossSectionPolys(core, unified, zBaseTopCheckMm / scaleMm),
        };
      }
      const pOx = ox + phases[pi][0] * stepU;
      const pOy = oy + phases[pi][1] * stepU;
      const solid115 = _rasterizePolysCenterGrid(baseSeedPolysCache.p115, nx, ny, pOx, pOy, stepU);
      const solid185 = _rasterizePolysCenterGrid(baseSeedPolysCache.p185, nx, ny, pOx, pOy, stepU);
      const solidTop = _rasterizePolysCenterGrid(baseSeedPolysCache.pTop, nx, ny, pOx, pOy, stepU);
      const seed = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        if (!solid115[i] && !solid185[i] && !solidTop[i]) seed[i] = 1;
      }
      ventSeedByPhase[pi] = seed;
      return seed;
    };

    const minRasterCells = Math.max(6, Math.ceil(65.0 / (stepMm * stepMm)));

    for (let zi = 0; zi < zListMm.length; zi++) {
      const zMm = zListMm[zi];
      const curBB = unified.boundingBox();
      if (zMm >= curBB.max[2] * scaleMm - 0.15) continue;

      const lastExtAirByPhase = [null, null, null, null];
      for (let iter = 0; iter < 6; iter++) {
        let sCur = null;
        let polys = [];
        try {
          sCur = unified.slice(zMm / scaleMm);
          if (sCur && !sCur.isEmpty()) polys = sCur.toPolygons();
        } catch (_) {
          polys = [];
        } finally {
          core.safeDeleteManifold(sCur);
        }
        if (polys.length === 0) break;

        // Scan across all 4 half-cell grid phases so a phase shift between masterSolid and
        // an individual cut tile (VAL-02 0.30 mm grid) can never hide a sealed courtyard.
        let activePhase = -1;
        let solidCur = null;
        let extAir = null;
        let rasterPockets = [];
        for (let pi = 0; pi < phases.length; pi++) {
          const pOx = ox + phases[pi][0] * stepU;
          const pOy = oy + phases[pi][1] * stepU;
          const sGrid = _rasterizePolysCenterGrid(polys, nx, ny, pOx, pOy, stepU);
          const eAir = new Uint8Array(total);
          const q = new Int32Array(total);
          let qh = 0, qt = 0;
          if (!sGrid[0]) { eAir[0] = 1; q[qt++] = 0; }
          if (ventSeedByPhase[pi] !== null) {
            const vSeed = ventSeedByPhase[pi];
            for (let i = 0; i < total; i++) {
              if (vSeed[i] && !sGrid[i] && !eAir[i]) {
                eAir[i] = 1;
                q[qt++] = i;
              }
            }
          }
          while (qh < qt) {
            const cur = q[qh++];
            const cx = cur % nx, cy = (cur - cx) / nx;
            if (cx > 0 && !sGrid[cur - 1] && !eAir[cur - 1]) { eAir[cur - 1] = 1; q[qt++] = cur - 1; }
            if (cx + 1 < nx && !sGrid[cur + 1] && !eAir[cur + 1]) { eAir[cur + 1] = 1; q[qt++] = cur + 1; }
            if (cy > 0 && !sGrid[cur - nx] && !eAir[cur - nx]) { eAir[cur - nx] = 1; q[qt++] = cur - nx; }
            if (cy + 1 < ny && !sGrid[cur + nx] && !eAir[cur + nx]) { eAir[cur + nx] = 1; q[qt++] = cur + nx; }
          }
          let anyEncl = false;
          for (let i = 0; i < total; i++) {
            if (!sGrid[i] && !eAir[i]) { anyEncl = true; break; }
          }
          if (anyEncl && ventSeedByPhase[pi] === null) {
            const vSeed = ensureVentSeedForPhase(pi);
            let addedSeed = false;
            for (let i = 0; i < total; i++) {
              if (vSeed[i] && !sGrid[i] && !eAir[i]) {
                eAir[i] = 1;
                q[qt++] = i;
                addedSeed = true;
              }
            }
            if (addedSeed) {
              while (qh < qt) {
                const cur = q[qh++];
                const cx = cur % nx, cy = (cur - cx) / nx;
                if (cx > 0 && !sGrid[cur - 1] && !eAir[cur - 1]) { eAir[cur - 1] = 1; q[qt++] = cur - 1; }
                if (cx + 1 < nx && !sGrid[cur + 1] && !eAir[cur + 1]) { eAir[cur + 1] = 1; q[qt++] = cur + 1; }
                if (cy > 0 && !sGrid[cur - nx] && !eAir[cur - nx]) { eAir[cur - nx] = 1; q[qt++] = cur - nx; }
                if (cy + 1 < ny && !sGrid[cur + nx] && !eAir[cur + nx]) { eAir[cur + nx] = 1; q[qt++] = cur + nx; }
              }
            }
          }
          lastExtAirByPhase[pi] = eAir;
          if (!anyEncl) continue;

          const pocketSeen = new Uint8Array(total);
          const pFound = [];
          for (let i = 0; i < total; i++) {
            if (sGrid[i] || eAir[i] || pocketSeen[i]) continue;
            const cells = [];
            const stk = [i];
            pocketSeen[i] = 1;
            while (stk.length > 0) {
              const cur = stk.pop();
              cells.push(cur);
              const cx = cur % nx;
              const cy = (cur - cx) / nx;
              if (cx > 0 && !sGrid[cur - 1] && !eAir[cur - 1] && !pocketSeen[cur - 1]) { pocketSeen[cur - 1] = 1; stk.push(cur - 1); }
              if (cx + 1 < nx && !sGrid[cur + 1] && !eAir[cur + 1] && !pocketSeen[cur + 1]) { pocketSeen[cur + 1] = 1; stk.push(cur + 1); }
              if (cy > 0 && !sGrid[cur - nx] && !eAir[cur - nx] && !pocketSeen[cur - nx]) { pocketSeen[cur - nx] = 1; stk.push(cur - nx); }
              if (cy + 1 < ny && !sGrid[cur + nx] && !eAir[cur + nx] && !pocketSeen[cur + nx]) { pocketSeen[cur + nx] = 1; stk.push(cur + nx); }
            }
            if (cells.length >= minRasterCells) {
              pFound.push({ cells, areaU2: (cells.length * stepMm * stepMm) / (scaleMm * scaleMm) });
            }
          }
          if (pFound.length > 0) {
            activePhase = pi;
            solidCur = sGrid;
            extAir = eAir;
            rasterPockets = pFound;
            break;
          }
        }
        if (activePhase < 0 || rasterPockets.length === 0) break;

        const actOx = ox + phases[activePhase][0] * stepU;
        const actOy = oy + phases[activePhase][1] * stepU;
        let sHigh = null;
        let didCut = false;
        try {
          sHigh = unified.slice((zMm + 0.65) / scaleMm);
          const highPolys = sHigh.isEmpty() ? [] : sHigh.toPolygons();
          const blockedRaw = _rasterizePolysToGrid(highPolys, nx, ny, actOx, actOy, stepU);
          const blocked = new Uint8Array(total);
          for (let r = 0; r < ny; r++) {
            for (let c = 0; c < nx; c++) {
              if (!blockedRaw[r * nx + c]) continue;
              for (let dr = -1; dr <= 1; dr++) {
                const rr = r + dr;
                if (rr < 0 || rr >= ny) continue;
                for (let dc = -1; dc <= 1; dc++) {
                  const cc = c + dc;
                  if (cc >= 0 && cc < nx) blocked[rr * nx + cc] = 1;
                }
              }
            }
          }

          const allBermRuns = [];
          const allArchRuns = [];
          for (let hi = 0; hi < rasterPockets.length; hi++) {
            const pObj = rasterPockets[hi];
            const cavityCells = pObj.cells;
            if (cavityCells.length === 0) continue;

            const bermRuns = iter < 4
              ? _findShortestBermRuns(cavityCells, blocked, solidCur, extAir, nx, ny, actOx, actOy, stepU, scaleMm)
              : [];
            if (bermRuns.length > 0) {
              for (let i = 0; i < bermRuns.length; i++) allBermRuns.push(bermRuns[i]);
            } else if (pObj.areaU2 >= minArchwayAreaU2 && ventMod && typeof ventMod.findShortestSolidVentRuns === 'function') {
              // Courtyard enclosed 360 deg by taller buildings (or berm cut pinched by adjacent walls):
              // carve one street-level gabled pedestrian archway (1.70 mm wide, >= 45 deg crown).
              const archRuns = ventMod.findShortestSolidVentRuns(
                cavityCells, extAir, solidCur, nx, ny, actOx, actOy, stepU, scaleMm, 0.85
              );
              for (let i = 0; i < archRuns.length; i++) allArchRuns.push(archRuns[i]);
            }
          }

          if (allBermRuns.length === 0 && allArchRuns.length === 0) break;

          if (allBermRuns.length > 0) {
            const cutPolys = core.clipperBufferOpenPaths(allBermRuns, 'Round', 1e-6);
            if (cutPolys.length > 0) {
              let cutterCS = null;
              let exclCS = null;
              let rawCut = null;
              let shiftedCut = null;
              try {
                cutterCS = mf.CrossSection.ofPolygons(cutPolys, 'Positive');
                if (!sHigh.isEmpty()) {
                  exclCS = sHigh.offset(0.10 / scaleMm, 'Round');
                  if (!exclCS.isEmpty()) {
                    const nextCS = cutterCS.subtract(exclCS);
                    core.safeDeleteManifold(cutterCS);
                    cutterCS = nextCS;
                  }
                }
                if (!cutterCS.isEmpty()) {
                  const zBotU = Math.max(zBotFloorMm / scaleMm, (zMm - 0.35) / scaleMm);
                  const zTopU = (zMm + 0.65) / scaleMm;
                  if (zTopU > zBotU + 1e-5) {
                    rawCut = cutterCS.extrude(zTopU - zBotU);
                    shiftedCut = rawCut.translate([0, 0, zBotU]);
                    core.safeDeleteManifold(rawCut);
                    rawCut = null;
                    if (shiftedCut && shiftedCut.numTri() > 0) {
                      const carved = unified.subtract(shiftedCut);
                      if (carved && carved.numTri() > 0) {
                        core.safeDeleteManifold(unified);
                        unified = carved;
                        didCut = true;
                      } else {
                        core.safeDeleteManifold(carved);
                      }
                    }
                  }
                }
              } finally {
                core.safeDeleteManifold(cutterCS);
                core.safeDeleteManifold(exclCS);
                core.safeDeleteManifold(rawCut);
                core.safeDeleteManifold(shiftedCut);
              }
            }
          }

          if (allArchRuns.length > 0 && ventMod && typeof ventMod.buildGabledTunnelManifold === 'function') {
            const zBotU = Math.max(zBotFloorMm / scaleMm, (zMm - 0.35) / scaleMm);
            const zSpringU = (zMm + 0.70) / scaleMm;
            const gableRiseU = 0.95 / scaleMm;
            const archCut = ventMod.buildGabledTunnelManifold(core, mf, allArchRuns, zBotU, zSpringU, gableRiseU, scaleMm);
            if (archCut) {
              let carved = null;
              try {
                carved = unified.subtract(archCut);
              } catch (_) {
                carved = null;
              } finally {
                core.safeDeleteManifold(archCut);
              }
              if (carved && carved.numTri() > 0) {
                core.safeDeleteManifold(unified);
                unified = carved;
                didCut = true;
              } else {
                core.safeDeleteManifold(carved);
              }
            }
          }
        } catch (_) {
          break;
        } finally {
          core.safeDeleteManifold(sHigh);
        }
        if (!didCut) break;
      }
      for (let pi = 0; pi < phases.length; pi++) {
        if (lastExtAirByPhase[pi] !== null && ventSeedByPhase[pi] !== null) {
          ventSeedByPhase[pi] = lastExtAirByPhase[pi];
        }
      }
    }
    return unified;
  }

  function _isPointInsideCSPolys(poly, px, py, rings) {
    let inside = false;
    for (let i = 0; i < rings.length; i++) {
      if (poly.pointInPoly2D(px, py, rings[i])) inside = !inside;
    }
    return inside;
  }

  function _findInteriorPointInCS(poly, rings, bounds) {
    if (!rings || rings.length === 0) return null;
    const cx = 0.5 * (bounds.min[0] + bounds.max[0]);
    const cy = 0.5 * (bounds.min[1] + bounds.max[1]);
    if (_isPointInsideCSPolys(poly, cx, cy, rings)) return [cx, cy];

    const spanY = bounds.max[1] - bounds.min[1];
    if (spanY <= 1e-8) return null;
    const fracs = [0.5, 0.37, 0.63, 0.25, 0.75];
    let bestPt = null;
    let bestSpan = -1;
    for (let fi = 0; fi < fracs.length; fi++) {
      const sy = bounds.min[1] + spanY * fracs[fi];
      const xs = [];
      for (let ri = 0; ri < rings.length; ri++) {
        const ring = rings[ri];
        for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
          const yi = ring[i][1], yj = ring[j][1];
          if ((yi > sy) !== (yj > sy)) {
            xs.push(ring[i][0] + ((ring[j][0] - ring[i][0]) * (sy - yi)) / (yj - yi));
          }
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const span = xs[k + 1] - xs[k];
        if (span > bestSpan) {
          const mx = 0.5 * (xs[k] + xs[k + 1]);
          if (_isPointInsideCSPolys(poly, mx, sy, rings)) {
            bestSpan = span;
            bestPt = [mx, sy];
          }
        }
      }
    }
    return bestPt;
  }

  function _evalClusterBarycentricZ(poly, px, py, tris, fallbackZ) {
    let hitZ = Infinity;
    let foundHit = false;
    let bestDistSq = Infinity;
    let nearZ = fallbackZ;
    const pt = [px, py];

    for (let i = 0; i < tris.length; i++) {
      const { p0, p1, p2 } = tris[i];
      if (poly.pointInTri2D(px, py, p0[0], p0[1], p1[0], p1[1], p2[0], p2[1])) {
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1];
        const wx = px - p0[0], wy = py - p0[1];
        const denom = ux * vy - uy * vx;
        if (Math.abs(denom) > 1e-12) {
          const a = (wx * vy - wy * vx) / denom;
          const b = (ux * wy - uy * wx) / denom;
          const c = 1 - a - b;
          const z = Math.max(
            Math.min(p0[2], p1[2], p2[2]),
            Math.min(Math.max(p0[2], p1[2], p2[2]), c * p0[2] + a * p1[2] + b * p2[2])
          );
          if (z < hitZ) {
            hitZ = z;
            foundHit = true;
          }
        }
      }
      if (!foundHit) {
        const edges = [[p0, p1], [p1, p2], [p2, p0]];
        for (let ei = 0; ei < 3; ei++) {
          const a = edges[ei][0], b = edges[ei][1];
          const d2 = poly.pointToSegmentDistSq2D(pt, a, b);
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            const ex = b[0] - a[0], ey = b[1] - a[1];
            const l2 = ex * ex + ey * ey;
            const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - a[0]) * ex + (py - a[1]) * ey) / l2)) : 0;
            nearZ = a[2] + t * (b[2] - a[2]);
          }
        }
      }
    }
    return foundHit ? hitZ : nearZ;
  }

  function _makeCircleRing16(px, py, radius) {
    const ring = [];
    for (let k = 0; k < 16; k++) {
      const a = (k * 2 * Math.PI) / 16;
      ring.push([px + radius * Math.cos(a), py + radius * Math.sin(a)]);
    }
    return ring;
  }

  function _buildOverhangCSFromTris(core, poly, mf, tris, scaleMm) {
    const triPolys = [];
    for (let ti = 0; ti < tris.length; ti++) {
      const tr = tris[ti];
      if (tr.area2D <= 1e-9) continue;
      const r = [[tr.p0[0], tr.p0[1]], [tr.p1[0], tr.p1[1]], [tr.p2[0], tr.p2[1]]];
      if (poly.signedArea2D(r) < 0) r.reverse();
      triPolys.push(r);
    }
    if (triPolys.length === 0) return null;

    let rawCS = null;
    let dilCS = null;
    let outCS = null;
    try {
      rawCS = mf.CrossSection.ofPolygons(triPolys, 'Positive');
      if (!rawCS.isEmpty()) {
        dilCS = rawCS.offset(0.04 / scaleMm, 'Round');
        if (!dilCS.isEmpty()) outCS = dilCS.offset(-0.03 / scaleMm, 'Round');
      }
    } catch (_) {
      outCS = null;
    } finally {
      core.safeDeleteManifold(rawCS);
      core.safeDeleteManifold(dilCS);
    }
    if (!outCS || outCS.isEmpty()) {
      core.safeDeleteManifold(outCS);
      return null;
    }
    return outCS;
  }

  function _groundFlatOverhangPiers(core, poly, mf, unified, uBB, scaleMm, baseBottomMm = 2.35) {
    const safeBaseMm = (Number(baseBottomMm) > 0) ? Number(baseBottomMm) : 2.35;
    const mesh = unified.getMesh();
    const vp = mesh.vertProperties;
    const tv = mesh.triVerts;
    const np = mesh.numProp || 3;
    const nTri = Math.floor(tv.length / 3);
    // Keep overhang scan threshold <= 2.35 mm (strictly above <= 1.50 mm relief grooves) so
    // waterfront pier decks below a thickened 4.0 mm base still receive grounded piers (VAL-04).
    const zThreshU = Math.min(2.35, safeBaseMm) / scaleMm;
    const cands = [];
    const vertToCands = new Map();

    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3];
      const i1 = tv[t * 3 + 1];
      const i2 = tv[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      const b0 = i0 * np, b1 = i1 * np, b2 = i2 * np;
      const p0 = [vp[b0], vp[b0 + 1], vp[b0 + 2]];
      const p1 = [vp[b1], vp[b1 + 1], vp[b1 + 2]];
      const p2 = [vp[b2], vp[b2 + 1], vp[b2 + 2]];
      const minZ = Math.min(p0[2], p1[2], p2[2]);
      if (minZ <= zThreshU) continue;
      const maxZ = Math.max(p0[2], p1[2], p2[2]);

      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      const norm = Math.hypot(cx, cy, cz);
      if (norm < 1e-12 || (cz / norm) >= -0.80) continue;

      const ci = cands.length;
      cands.push({ p0, p1, p2, minZ, maxZ, area3D: 0.5 * norm, area2D: 0.5 * Math.abs(cz), verts: [i0, i1, i2] });
      for (const vi of [i0, i1, i2]) {
        let arr = vertToCands.get(vi);
        if (!arr) { arr = []; vertToCands.set(vi, arr); }
        arr.push(ci);
      }
    }
    if (cands.length === 0) return unified;

    const minClusterAreaU2 = 2.2 / (scaleMm * scaleMm);
    const seen = new Uint8Array(cands.length);
    const clusters = [];
    for (let i = 0; i < cands.length; i++) {
      if (seen[i]) continue;
      seen[i] = 1;
      const stack = [i];
      const tris = [];
      let totalArea = 0;
      let zLo = Infinity;
      let zHi = -Infinity;
      while (stack.length > 0) {
        const cur = stack.pop();
        const cObj = cands[cur];
        tris.push(cObj);
        totalArea += cObj.area3D;
        if (cObj.minZ < zLo) zLo = cObj.minZ;
        if (cObj.maxZ > zHi) zHi = cObj.maxZ;
        for (let k = 0; k < 3; k++) {
          const nbs = vertToCands.get(cObj.verts[k]);
          if (!nbs) continue;
          for (let ni = 0; ni < nbs.length; ni++) {
            const nb = nbs[ni];
            if (!seen[nb]) {
              seen[nb] = 1;
              stack.push(nb);
            }
          }
        }
      }
      if (totalArea >= minClusterAreaU2) {
        clusters.push({ tris, zLo, zHi });
      }
    }
    if (clusters.length === 0) return unified;

    const rSupU = 1.45 / scaleMm;
    const rPierU = 0.52 / scaleMm;
    const minSepU = 1.50 / scaleMm;
    const minStructHalfU = 0.22 / scaleMm;
    const minCompAreaU2 = 0.04 / (scaleMm * scaleMm);
    const padLocalU = rSupU + minStructHalfU + 1.2 / scaleMm;
    const zBandMinU = Math.min(2.55, safeBaseMm + 0.20) / scaleMm;
    const zBaseU = (uBB.min[2] < 0 && uBB.min[2] > -0.05 / scaleMm) ? uBB.min[2] : 0;
    const marginU = rPierU + 0.02 / scaleMm;
    const clampXY = (uBB.max[0] - uBB.min[0]) > rPierU * 3 && (uBB.max[1] - uBB.min[1]) > rPierU * 3;
    const belowCache = new Map();
    const newPiers = [];

    // Anchor dry-land piers on the roof plateau strictly above any <= 1.50 mm relief grooves.
    const roofLoMm = Math.max(1.75, safeBaseMm - 0.60);
    const roofHiMm = Math.max(2.10, safeBaseMm - 0.25);
    const roofCheckMm = Math.max(2.15, safeBaseMm - 0.20);
    let roofSafePolys = [];
    if (uBB.max[2] > (roofHiMm + 0.10) / scaleMm) {
      let s175 = null;
      let s210 = null;
      let roofInter = null;
      let roofEroded = null;
      try {
        s175 = unified.slice(roofLoMm / scaleMm);
        s210 = unified.slice(roofHiMm / scaleMm);
        if (!s175.isEmpty() && !s210.isEmpty()) {
          roofInter = s175.intersect(s210);
          if (!roofInter.isEmpty()) {
            roofEroded = roofInter.offset(-rPierU * 0.85, 'Round');
            if (!roofEroded.isEmpty()) roofSafePolys = roofEroded.toPolygons();
          }
        }
      } catch (_) {
        roofSafePolys = [];
      } finally {
        core.safeDeleteManifold(s175);
        core.safeDeleteManifold(s210);
        core.safeDeleteManifold(roofInter);
        core.safeDeleteManifold(roofEroded);
      }
    }

    try {
      const getBelowCS = (zSupU) => {
        const key = Math.round(zSupU * scaleMm * 20);
        if (belowCache.has(key)) return belowCache.get(key);
        let cs = null;
        try {
          cs = unified.slice(zSupU);
          if (cs.isEmpty()) {
            core.safeDeleteManifold(cs);
            cs = null;
          }
        } catch (_) {
          core.safeDeleteManifold(cs);
          cs = null;
        }
        belowCache.set(key, cs);
        return cs;
      };

      for (let ci = 0; ci < clusters.length; ci++) {
        const { tris, zLo, zHi } = clusters[ci];
        let bands;
        if ((zHi - zLo) * scaleMm > 0.20) {
          const byBin = new Map();
          for (let ti = 0; ti < tris.length; ti++) {
            const tr = tris[ti];
            const zBin = Math.floor((tr.minZ * scaleMm) / 0.20);
            let b = byBin.get(zBin);
            if (!b) {
              b = { zBin, tris: [], zLo: Infinity, zHi: -Infinity };
              byBin.set(zBin, b);
            }
            b.tris.push(tr);
            if (tr.minZ < b.zLo) b.zLo = tr.minZ;
            if (tr.maxZ > b.zHi) b.zHi = tr.maxZ;
          }
          bands = Array.from(byBin.values()).sort((a, b) => b.zBin - a.zBin);
        } else {
          bands = [{ tris, zLo, zHi, isSingleBand: true }];
        }

        const clusterPiers = [];
        for (let bi = 0; bi < bands.length; bi++) {
          const band = bands[bi];
          if (!band.isSingleBand && band.zLo <= zBandMinU) continue;
          const bandCS = _buildOverhangCSFromTris(core, poly, mf, band.tris, scaleMm);
          if (!bandCS) continue;

          const zSupU = Math.max(0.10 / scaleMm, band.zLo - 0.15 / scaleMm);
          const zSupNearU = Math.max(0.10 / scaleMm, band.zLo - 0.04 / scaleMm);
          const belowCS = getBelowCS(zSupU);
          const belowNearCS = getBelowCS(zSupNearU);
          let clipBox = null;
          let localBelowLo = null;
          let localBelow = null;
          let structuralBelow = null;
          let supportedZone = null;
          let unsup = null;
          try {
            if (belowCS && belowNearCS) {
              const bBounds = bandCS.bounds();
              clipBox = _makeRectCS(
                mf,
                bBounds.min[0] - padLocalU, bBounds.min[1] - padLocalU,
                bBounds.max[0] + padLocalU, bBounds.max[1] + padLocalU
              );
              localBelowLo = belowCS.intersect(clipBox);
              // Require continuous support up to zLo - 0.04 mm so a lower deck ending
              // with a thin air gap below an upper deck never masks an overhang (VAL-04).
              localBelow = (!localBelowLo.isEmpty()) ? localBelowLo.intersect(belowNearCS) : localBelowLo;
              // Drop < 0.44 mm hairline slivers before dilating support zones.
              if (!localBelow.isEmpty()) {
                structuralBelow = localBelow.offset(-minStructHalfU, 'Round');
              }
              if (structuralBelow && !structuralBelow.isEmpty()) {
                supportedZone = structuralBelow.offset(minStructHalfU + rSupU, 'Round');
                unsup = supportedZone.isEmpty() ? bandCS : bandCS.subtract(supportedZone);
              } else {
                unsup = bandCS;
              }
            } else {
              unsup = bandCS;
            }
          } catch (_) {
            unsup = null;
          } finally {
            if (unsup !== bandCS) core.safeDeleteManifold(bandCS);
            core.safeDeleteManifold(clipBox);
            if (localBelow && localBelow !== localBelowLo) core.safeDeleteManifold(localBelow);
            core.safeDeleteManifold(localBelowLo);
            core.safeDeleteManifold(structuralBelow);
            core.safeDeleteManifold(supportedZone);
          }

          // Subtract higher-band piers so a sloped ramp skips redundant close supports.
          if (unsup && !unsup.isEmpty() && clusterPiers.length > 0) {
            const priorDiskPolys = [];
            const minCapU = band.zLo - 0.10 / scaleMm;
            for (let pi = 0; pi < clusterPiers.length; pi++) {
              const cp = clusterPiers[pi];
              if (cp.zCapU >= minCapU) priorDiskPolys.push(_makeCircleRing16(cp.px, cp.py, rSupU));
            }
            if (priorDiskPolys.length > 0) {
              let priorCS = null;
              let nextUnsup = null;
              try {
                priorCS = mf.CrossSection.ofPolygons(priorDiskPolys, 'Positive');
                nextUnsup = unsup.subtract(priorCS);
              } catch (_) {
                nextUnsup = null;
              } finally {
                core.safeDeleteManifold(priorCS);
                core.safeDeleteManifold(unsup);
              }
              unsup = nextUnsup;
            }
          }

          for (let iter = 0; iter < 24 && unsup && !unsup.isEmpty(); iter++) {
            const uComps = unsup.decompose();
            uComps.sort((a, b) => b.area() - a.area());
            const iterDiskPolys = [];
            const iterCenters = [];

            for (let ui = 0; ui < uComps.length; ui++) {
              const uc = uComps[ui];
              if (uc.area() < minCompAreaU2) continue;
              const ucPolys = uc.toPolygons();
              const pt = _findInteriorPointInCS(poly, ucPolys, uc.bounds());
              if (!pt) continue;
              let cpx = pt[0], cpy = pt[1];
              if (clampXY) {
                cpx = Math.max(uBB.min[0] + marginU, Math.min(uBB.max[0] - marginU, cpx));
                cpy = Math.max(uBB.min[1] + marginU, Math.min(uBB.max[1] - marginU, cpy));
              }
              let tooClose = false;
              for (let k = 0; k < iterCenters.length; k++) {
                if (Math.hypot(cpx - iterCenters[k][0], cpy - iterCenters[k][1]) < minSepU) {
                  tooClose = true;
                  break;
                }
              }
              if (tooClose) continue;

              const zLocal = _evalClusterBarycentricZ(poly, cpx, cpy, band.tris, band.zLo);
              const zCapU = zLocal + 0.12 / scaleMm;
              const pierBotU = (roofSafePolys.length > 0 && _isPointInsideCSPolys(poly, cpx, cpy, roofSafePolys) && zCapU > roofCheckMm / scaleMm)
                ? (roofLoMm / scaleMm)
                : zBaseU;
              const hPier = zCapU - pierBotU;
              if (hPier > 0.10 / scaleMm) {
                let cyl = null;
                let pier = null;
                try {
                  cyl = mf.Manifold.cylinder(hPier, rPierU, rPierU, 16, false);
                  pier = cyl.translate([cpx, cpy, pierBotU]);
                } catch (_) {
                  pier = null;
                } finally {
                  core.safeDeleteManifold(cyl);
                }
                if (pier && pier.numTri() > 0) {
                  newPiers.push(pier);
                  iterCenters.push([cpx, cpy]);
                  clusterPiers.push({ px: cpx, py: cpy, zCapU });
                  iterDiskPolys.push(_makeCircleRing16(cpx, cpy, rSupU));
                } else {
                  core.safeDeleteManifold(pier);
                }
              }
            }
            for (let ui = 0; ui < uComps.length; ui++) core.safeDeleteManifold(uComps[ui]);
            if (iterDiskPolys.length === 0) break;

            let diskCS = null;
            let nextUnsup = null;
            try {
              diskCS = mf.CrossSection.ofPolygons(iterDiskPolys, 'Positive');
              nextUnsup = unsup.subtract(diskCS);
            } catch (_) {
              nextUnsup = null;
            } finally {
              core.safeDeleteManifold(diskCS);
              core.safeDeleteManifold(unsup);
            }
            unsup = nextUnsup;
          }
          core.safeDeleteManifold(unsup);
        }
      }
    } finally {
      for (const cs of belowCache.values()) core.safeDeleteManifold(cs);
    }

    if (newPiers.length === 0) return unified;
    const allPiers = core.batchUnionManifolds(mf, newPiers);
    const withPiers = allPiers ? unified.add(allPiers) : null;
    core.safeDeleteManifold(allPiers);
    if (withPiers && withPiers.numTri() > 0) {
      core.safeDeleteManifold(unified);
      return withPiers;
    }
    core.safeDeleteManifold(withPiers);
    return unified;
  }

  function _cleanupDetachedBorderSlivers(core, mf, unified, scaleMm, interiorCutPlanes = null) {
    if (!unified || typeof unified.decompose !== 'function') return unified;
    let comps;
    try {
      comps = unified.decompose();
    } catch (_) {
      return unified;
    }
    if (!Array.isArray(comps) || comps.length <= 1) {
      if (Array.isArray(comps)) {
        for (let i = 0; i < comps.length; i++) core.safeDeleteManifold(comps[i]);
      }
      return unified;
    }

    const meta = [];
    let maxVol = 0;
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      const vol = c.volume();
      const bb = c.boundingBox();
      if (vol > maxVol) maxVol = vol;
      meta.push({ c, vol, bb });
    }
    if (maxVol <= 500.0 / (scaleMm ** 3)) {
      for (let i = 0; i < meta.length; i++) core.safeDeleteManifold(meta[i].c);
      return unified;
    }

    const cutXsU = (interiorCutPlanes && Array.isArray(interiorCutPlanes.cutXsU)) ? interiorCutPlanes.cutXsU : [];
    const cutYsU = (interiorCutPlanes && Array.isArray(interiorCutPlanes.cutYsU)) ? interiorCutPlanes.cutYsU : [];
    const seamProtectTolU = 0.15 / scaleMm;
    const touchesInteriorSeam = (bb) => {
      for (let i = 0; i < cutXsU.length; i++) {
        const cx = cutXsU[i];
        if (Math.abs(bb.min[0] - cx) <= seamProtectTolU || Math.abs(bb.max[0] - cx) <= seamProtectTolU) return true;
      }
      for (let i = 0; i < cutYsU.length; i++) {
        const cy = cutYsU[i];
        if (Math.abs(bb.min[1] - cy) <= seamProtectTolU || Math.abs(bb.max[1] - cy) <= seamProtectTolU) return true;
      }
      return false;
    };

    const minZMax = 0.05 / scaleMm;
    const minVol = 2.5 / (scaleMm ** 3);
    const tinyLooseVolU3 = 12.0 / (scaleMm ** 3);
    const minSpan = 3.5 / scaleMm;
    const narrowPadMinU = 2.2 / scaleMm;
    const narrowPadMaxAreaU2 = 24.0 / (scaleMm * scaleMm);
    const isFullProductionPlate = maxVol > 5000.0 / (scaleMm ** 3);
    const kept = [];
    for (let i = 0; i < meta.length; i++) {
      const { c, vol, bb } = meta[i];
      const dx = bb.max[0] - bb.min[0];
      const dy = bb.max[1] - bb.min[1];
      const isFloating = bb.min[2] > minZMax;
      // Never delete any component (grounded or floating) touching an interior seam plane on
      // masterSolid; deleting one side creates a vertical cliff on the cut plane (VAL-09).
      if (touchesInteriorSeam(bb)) {
        kept.push(c);
        continue;
      }
      const isTinyBorderSliver = vol < minVol && Math.max(dx, dy) < minSpan;
      const isTinyLooseShell = vol < tinyLooseVolU3 && vol < maxVol * 0.005;
      const isLooseNarrowIsland = vol < maxVol * 0.01 && Math.min(dx, dy) < narrowPadMinU && (dx * dy) < narrowPadMaxAreaU2;
      let isCrumbIsland = false;
      if (isFullProductionPlate && !isFloating && vol < maxVol * 0.05) {
        const minWmm = Math.min(dx, dy) * scaleMm;
        let z0AreaMm2 = (dx * dy) * scaleMm * scaleMm;
        let s0 = null;
        try {
          s0 = c.slice(0.15 / scaleMm);
          z0AreaMm2 = (s0 && !s0.isEmpty()) ? (s0.area() * scaleMm * scaleMm) : 0;
        } catch (_) {
        } finally {
          core.safeDeleteManifold(s0);
        }
        if (z0AreaMm2 < 62.0 || minWmm < 5.15) {
          isCrumbIsland = true;
        }
      }
      const keep = !isFloating && !isTinyBorderSliver && !isTinyLooseShell && !isLooseNarrowIsland && !isCrumbIsland;
      if (keep) kept.push(c);
      else core.safeDeleteManifold(c);
    }

    if (kept.length === 0) return unified;
    if (kept.length === comps.length) {
      for (let i = 0; i < kept.length; i++) core.safeDeleteManifold(kept[i]);
      return unified;
    }

    const reunited = core.batchUnionManifolds(mf, kept);
    if (reunited && reunited.numTri() > 0) {
      core.safeDeleteManifold(unified);
      return reunited;
    }
    core.safeDeleteManifold(reunited);
    return unified;
  }

  function _applyPostUnionMslaPrintGuard(core, poly, mf, unified, scaleMm, isCutout, baseBottomMm = 2.35, ventMod = null, interiorSeams = null) {
    if (!unified || unified.numTri() === 0) return unified;
    let out = unified;
    if (isCutout === true) {
      out = _plugPostUnionBasePockets(core, poly, mf, out, out.boundingBox(), scaleMm, baseBottomMm);
      if (ventMod && typeof ventMod.ventLargeBasePocketsUnderside === 'function') {
        out = ventMod.ventLargeBasePocketsUnderside(
          core, poly, mf, out, out.boundingBox(), scaleMm, baseBottomMm, interiorSeams, _rasterizePolysToGrid
        );
      }
    }
    out = _ventUpperSealedCourtyards(core, poly, mf, out, scaleMm, baseBottomMm, ventMod);
    out = _groundFlatOverhangPiers(core, poly, mf, out, out.boundingBox(), scaleMm, baseBottomMm);
    out = _cleanupDetachedBorderSlivers(core, mf, out, scaleMm);
    return out;
  }

  function buildUnifiedTileTrianglesForStlCSG(state, layerFilter = 'all', tileIdFilter = -1) {
    if (layerFilter === 'all' && !Array.isArray(state)) {
      const cutterMod = (typeof buildMasterFrameUnifiedTilesForStl === 'function')
        ? { buildMasterFrameUnifiedTilesForStl }
        : (typeof require !== 'undefined' ? require('./tile_seam_cutter.js') : null);
      if (cutterMod && typeof cutterMod.buildMasterFrameUnifiedTilesForStl === 'function') {
        const selfDeps = {
          _plugInlandThroughHoles,
          _plugPostUnionBasePockets,
          _ventUpperSealedCourtyards,
          _groundFlatOverhangPiers,
          _cleanupDetachedBorderSlivers,
          _rasterizePolysToGrid,
          _sliceCrossSectionPolys,
          _applyPostUnionMslaPrintGuard,
        };
        return cutterMod.buildMasterFrameUnifiedTilesForStl(state, tileIdFilter, { vaultMod: selfDeps });
      }
    }
    const { core, poly, cfgMod, ventMod } = _getDeps();
    let filtered = [], scaleMm = 1, isCutout = false, baseBottomMm = 2.35, interiorSeams = null;
    if (Array.isArray(state)) {
      filtered = state;
    } else {
      const spec = cfgMod.resolveSceneScaleAndSpec(state, null);
      const { halfW, halfH } = spec;
      scaleMm = spec.scaleMm || 1;
      baseBottomMm = (cfgMod && typeof cfgMod.resolveBaseBottomMm === 'function')
        ? cfgMod.resolveBaseBottomMm(state, cfgMod.PRINT_PHYSICS_CONFIG)
        : 2.35;
      const tileCols = Math.max(1, (state && state.tileCols) || 1), tileRows = Math.max(1, (state && state.tileRows) || 1);
      if (tileIdFilter >= 0 && (tileCols > 1 || tileRows > 1)) {
        const tc = tileIdFilter % tileCols;
        const tr = Math.floor(tileIdFilter / tileCols);
        interiorSeams = {
          south: tr > 0,
          north: tr < tileRows - 1,
          west: tc > 0,
          east: tc < tileCols - 1,
        };
      }
      isCutout = Boolean(state && state.waterCutout);
      const keys = layerFilter === 'all'
        ? (isCutout ? ['base', 'greenery', 'roads', 'buildings', 'highlighted'] : ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'])
        : ((isCutout && layerFilter === 'water') ? [] : [layerFilter]);
      const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
      for (const k of keys) {
        if (layerFilter === 'all' && state && state.layerVisible) {
          if (k === 'greenery') {
            if (state.layerVisible.greenery === false && state.layerVisible.trees === false) continue;
          } else if (state.layerVisible[k] === false) continue;
        }
        for (const t of (meshesObj[k] || [])) {
          if (tileIdFilter >= 0 && cfgMod.resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) !== tileIdFilter) continue;
          filtered.push(t);
        }
      }
    }
    const mf = typeof core.getManifoldLib === 'function' ? core.getManifoldLib() : null;
    if (!mf || filtered.length === 0 || (layerFilter !== 'all' && !Array.isArray(state))) return filtered;
    const baseTris = filtered.filter(t => t.layerId === 1);
    const overTris = filtered.filter(t => t.layerId !== 1);
    const solids = core.trianglesToShellManifolds(mf, baseTris);
    for (const m of core.trianglesToShellManifolds(mf, overTris)) {
      const bb = m.boundingBox();
      if (bb.min[2] > 0.02) {
        const s = m.translate([0, 0, -Math.min(0.002, bb.min[2] * 0.1)]);
        core.safeDeleteManifold(m);
        solids.push(s);
      } else solids.push(m);
    }
    if (solids.length === 0) return filtered;
    let unified = solids.length === 1 ? solids[0] : core.batchUnionManifolds(mf, solids);
    if (!unified || unified.numTri() === 0) { core.safeDeleteManifold(unified); return []; }
    if (layerFilter === 'all' && !Array.isArray(state)) {
      const uBB = unified.boundingBox();
      const spanXMm = (uBB.max[0] - uBB.min[0]) * scaleMm;
      const spanYMm = (uBB.max[1] - uBB.min[1]) * scaleMm;
      if (uBB.min[2] <= 0.05 / scaleMm &&
          Math.max(spanXMm, spanYMm) >= 25.0 &&
          Math.min(spanXMm, spanYMm) >= 6.0) {
        unified = _applyPostUnionMslaPrintGuard(core, poly, mf, unified, scaleMm, isCutout, baseBottomMm, ventMod, interiorSeams);
        if (!unified || unified.numTri() === 0) { core.safeDeleteManifold(unified); return []; }
      }
    }
    const out = core.extractDePinchedStlTriangles(mf, unified, Math.max(0, tileIdFilter), scaleMm);
    core.safeDeleteManifold(unified);
    return out;
  }

  const exportsObj = {
    carveTileHollowVaultAndId, buildUnifiedTileTrianglesForStlCSG,
    unionTileTrianglesForStlCSG: buildUnifiedTileTrianglesForStlCSG,
    _plugInlandThroughHoles,
    _plugPostUnionBasePockets,
    _ventUpperSealedCourtyards,
    _groundFlatOverhangPiers,
    _cleanupDetachedBorderSlivers,
    _rasterizePolysToGrid,
    _sliceCrossSectionPolys,
    _applyPostUnionMslaPrintGuard,
  };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) {
    const emb = require('./tile_id_emboss.js');
    module.exports = { ...exportsObj, buildTileIdLabelPolys: emb.buildTileIdLabelPolys, _buildTileIdLabelPolys: emb.buildTileIdLabelPolys };
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
