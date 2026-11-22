// ============================================================================
// src/mesh/tile_id_emboss.js
// Legible Z=0 Underside Vector Stroke Glyphs (R1C1^) & Dry Safe-Pad Finder
// ============================================================================

(function (root) {
  function _getDeps() {
    const core = (typeof extrudeRingSolid === 'function' && typeof clipperBufferOpenPaths === 'function')
      ? root : (typeof require !== 'undefined' ? require('../geometry/manifold_core.js') : root);
    const poly = (typeof pointInPoly2D === 'function')
      ? root : (typeof require !== 'undefined' ? require('../geometry/polygon_2d.js') : root);
    return { core, poly };
  }

  const _GLYPHS = {
    '0': [[[0,0],[1,0],[1,1.6],[0,1.6],[0,0]]],
    '1': [[[0.5,0],[0.5,1.6]]],
    '2': [[[0,1.6],[1,1.6],[1,0.8],[0,0.8],[0,0],[1,0]]],
    '3': [[[0,1.6],[1,1.6],[1,0],[0,0]],[[0.2,0.8],[1,0.8]]],
    '4': [[[0,1.6],[0,0.8],[1,0.8]],[[1,1.6],[1,0]]],
    '5': [[[1,1.6],[0,1.6],[0,0.8],[1,0.8],[1,0],[0,0]]],
    '6': [[[1,1.6],[0,1.6],[0,0],[1,0],[1,0.8],[0,0.8]]],
    '7': [[[0,1.6],[1,1.6],[1,0]]],
    '8': [[[0,0],[1,0],[1,1.6],[0,1.6],[0,0]],[[0,0.8],[1,0.8]]],
    '9': [[[0,0],[1,0],[1,1.6],[0,1.6],[0,0.8],[1,0.8]]],
    'R': [[[0,0],[0,1.6],[0.9,1.6],[0.9,0.85],[0,0.85]],[[0.35,0.85],[1.0,0]]],
    'C': [[[1,1.6],[0,1.6],[0,0],[1,0]]],
    '^': [[[0.5,0],[0.5,1.6]],[[0.15,1.15],[0.5,1.6],[0.85,1.15]]],
  };

  function buildTileIdLabelPolys(labelStr, cx, cy, glyphH, scaleMm = 1.0) {
    const strokes = [];
    const chars = String(labelStr || 'R1C1^').split('');
    const gw = glyphH * 0.62;
    const strokeW = Math.max(0.72 / Math.max(1e-4, scaleMm), glyphH * 0.16);
    const gap = Math.max(strokeW * 1.45, glyphH * 0.34);
    const totalW = chars.length * gw + Math.max(0, chars.length - 1) * gap;
    // Viewer faces underside (-Z) with North (+Y) up => +X is left, -X is right.
    let curX = cx + totalW * 0.5 - gw;
    const baseY = cy - glyphH * 0.5;

    for (let ci = 0; ci < chars.length; ci++) {
      const g = _GLYPHS[chars[ci]];
      if (g) {
        for (let s = 0; s < g.length; s++) {
          const pts = g[s].map(([px, py]) => [curX + (1.0 - px) * gw, baseY + (py / 1.6) * glyphH]);
          strokes.push({ pts, halfW: strokeW * 0.5, squareEnd: true });
        }
      }
      curX -= gw + gap;
    }
    strokes.strokeW = strokeW;
    return strokes;
  }

  function findSafeIdPad(ctx, terrainWater, tb, scaleMm, markDepthU, minRoofU) {
    const spanX = tb.maxX - tb.minX, spanY = tb.maxY - tb.minY;
    const label = `${tb.label || 'R1C1'}^`;
    let glyphH = Math.max(4.6 / scaleMm, Math.min(5.8 / scaleMm, spanX * 0.095));
    const estW = (gh) => {
      const sw = Math.max(0.72 / scaleMm, gh * 0.16);
      return label.length * gh * 0.62 + (label.length - 1) * Math.max(sw * 1.45, gh * 0.34);
    };
    const maxW = spanX * 0.72;
    if (estW(glyphH) > maxW) glyphH = Math.max(2.6 / scaleMm, glyphH * (maxW / Math.max(1e-4, estW(glyphH))));

    const strokes = buildTileIdLabelPolys(label, 0, 0, glyphH, scaleMm);
    const padHalfW = estW(glyphH) * 0.5 + 1.6 / scaleMm;
    const padHalfH = glyphH * 0.5 + 1.4 / scaleMm;
    const minNeedZ = markDepthU + minRoofU;

    for (const fx of [0.5, 0.28, 0.72, 0.4, 0.6]) {
      for (const fy of [0.5, 0.28, 0.72, 0.4, 0.6]) {
        const cx = tb.minX + fx * spanX, cy = tb.minY + fy * spanY;
        if (cx - padHalfW < tb.minX + 0.8 / scaleMm || cx + padHalfW > tb.maxX - 0.8 / scaleMm ||
            cy - padHalfH < tb.minY + 0.8 / scaleMm || cy + padHalfH > tb.maxY - 0.8 / scaleMm) continue;
        const pts = [[cx, cy], [cx - padHalfW, cy - padHalfH], [cx + padHalfW, cy - padHalfH],
          [cx + padHalfW, cy + padHalfH], [cx - padHalfW, cy + padHalfH]];
        let ok = true, minZ = Infinity;
        for (const [px, py] of pts) {
          const z = ctx.getTerrainZ(px, py);
          if (terrainWater.isPointInWater(px, py) || z < minNeedZ) { ok = false; break; }
          if (z < minZ) minZ = z;
        }
        if (ok) {
          return {
            cx, cy, glyphH, strokeW: strokes.strokeW,
            rect: pts.slice(1),
            minRoofClearanceMm: (minZ - markDepthU) * scaleMm,
          };
        }
      }
    }
    return null;
  }

  /**
   * Computes exact baseline underline span linking all tile ID glyphs.
   */
  function computeLabelUnderlineSpec(label, pad, scaleMm) {
    const safeScale = Math.max(1e-4, Number(scaleMm) || 1.0);
    const labelStrokes = buildTileIdLabelPolys(label, pad.cx, pad.cy, pad.glyphH, safeScale);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < labelStrokes.length; i++) {
      const pts = labelStrokes[i].pts;
      for (let j = 0; j < pts.length; j++) {
        if (pts[j][0] < minX) minX = pts[j][0];
        if (pts[j][0] > maxX) maxX = pts[j][0];
      }
    }
    const yBase = pad.cy - pad.glyphH * 0.5;
    const overlapU = 0.20 / safeScale;
    const xLeft = Number.isFinite(minX) ? (minX - overlapU) : (pad.cx - pad.glyphH);
    const xRight = Number.isFinite(maxX) ? (maxX + overlapU) : (pad.cx + pad.glyphH);
    return {
      labelStrokes,
      xLeft,
      xRight,
      yBase,
      halfW: 0.48 / safeScale,
    };
  }

  /**
   * Builds 3D solid cutters for the tile ID glyphs, baseline bar, and vent paths.
   */
  function buildIdEngravingSolids(mf, label, pad, scaleMm, markDepthU, ventPaths = []) {
    const { core } = _getDeps();
    const uSpec = computeLabelUnderlineSpec(label, pad, scaleMm);
    // Connect every glyph bottom stroke into one shared baseline channel.
    const underline = {
      pts: [[uSpec.xLeft, uSpec.yBase], [uSpec.xRight, uSpec.yBase]],
      halfW: uSpec.halfW,
      squareEnd: true,
    };
    let gRings = core.clipperBufferOpenPaths(
      uSpec.labelStrokes.concat([underline]),
      'Miter', 1e-4
    );
    if (Array.isArray(ventPaths) && ventPaths.length > 0) {
      const vRings = core.clipperBufferOpenPaths(ventPaths, 'Round', 1e-4);
      if (vRings.length > 0) {
        gRings = gRings.length > 0 ? core.clipperUnionPolys(gRings, 1e-4, vRings) : vRings;
      }
    }
    const grouped = core.ringsToOutersWithHoles(gRings, 1e-5);
    const solids = [];
    for (const item of grouped) {
      const gm = core.extrudeRingSolid(mf, item.outer, item.holes, -0.15, markDepthU);
      if (gm) solids.push(gm);
    }
    return solids;
  }

  const exportsObj = {
    buildTileIdLabelPolys, _buildTileIdLabelPolys: buildTileIdLabelPolys,
    findSafeIdPad, computeLabelUnderlineSpec, buildIdEngravingSolids,
  };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
