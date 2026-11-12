// ============================================================================
// src/mesh/features_trees.js
// Organic 3D Tree Crowns Layer (LoD Visibility, Clearance Validation & Tile Clipping)
// ============================================================================

if (typeof addTreeCrown3D === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_primitives.js'));
}
if (typeof appendShellClippedToTiles === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./mesh_tile_append.js'));
}

function _meshTreeIsFootpathRoad(rd) {
  if (!rd) return false;
  if (rd.isPath) return true;
  const rtype = rd.hwy || rd.type || rd.rtype || '';
  return (
    rtype === 'footway' || rtype === 'path' || rtype === 'steps' ||
    rtype === 'cycleway' || rtype === 'bridleway' || rtype === 'track' || rtype === 'corridor'
  );
}

function _meshTreeSignedArea2D(ring) {
  let area = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return area * 0.5;
}

function _meshTreeRingBBox(ring) {
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

function _meshTreePointInRing(px, py, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function _meshTreeInPolyWithHoles(px, py, polyRec) {
  const bb = polyRec.bbox;
  if (px < bb[0] || px > bb[2] || py < bb[1] || py > bb[3]) return false;
  if (!_meshTreePointInRing(px, py, polyRec.outer)) return false;
  const holes = polyRec.holes;
  if (holes && holes.length > 0) {
    for (let i = 0; i < holes.length; i++) {
      if (holes[i].length >= 3 && _meshTreePointInRing(px, py, holes[i])) return false;
    }
  }
  return true;
}

function _meshTreePointToSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _meshTreeDistToRing(px, py, ring) {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = _meshTreePointToSegDist(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
    if (d < best) best = d;
  }
  return best;
}

function _meshTreePreparePlacementEnv(scene, ctx, baseInfo, state, bandAssigner) {
  const lv = state.layerVisible || state.layers;
  const greenVisible = !lv || lv.greenery !== false;
  const roadsVisible = !lv || lv.roads !== false;

  const {
    halfW, halfH,
    toBed, sampleMaskIdx,
    waterMask, greenMask, roadAndBldMask,
    thresholds, gHeight, rHeight
  } = ctx;

  const scaleMm = ctx.scaleMm || 1.89;
  const scaleToBed = ctx.scaleToBed || 1.0;
  const pxPerUnit = ctx.pxPerUnit || ((ctx.MASK_RES_X && ctx.spanW) ? (ctx.MASK_RES_X / ctx.spanW) : 4.2);
  const mToU = ctx.mToU || ((scene.metersToUnits || 0.14) * scaleToBed);
  const shoreDist = ctx.shoreDist || null;
  const bldMask = ctx.bldMask || roadAndBldMask;
  const majorRoadMask = ctx.majorRoadMask || null;
  const parkPathOnGreenMask = ctx.parkPathOnGreenMask || null;
  const parkPathOnGroundMask = ctx.parkPathOnGroundMask || null;
  const baseBottomZ = (typeof ctx.baseBottomZ === 'number')
    ? ctx.baseBottomZ
    : ((thresholds && thresholds.length > 0) ? thresholds[0] : 0);
  const rawStepU = (typeof ctx.stepUnits === 'number' && ctx.stepUnits > 0)
    ? ctx.stepUnits
    : ((thresholds && thresholds.length > 1) ? Math.abs(thresholds[1] - thresholds[0]) : 0.45);
  const maxHollowSafeStepU = Math.min(rawStepU * 1.08, 0.70 / scaleMm);

  const getSurfZ = (baseInfo && typeof baseInfo.getActualPrintedSurfaceMinZ === 'function')
    ? baseInfo.getActualPrintedSurfaceMinZ
    : ((bx, by) => {
        if (waterMask && waterMask[sampleMaskIdx(bx, by)]) return baseBottomZ - 1.0;
        if (typeof ctx.getStepIdxForVal === 'function' && typeof ctx.sampleRawTerrainGridZ === 'function') {
          const k = ctx.getStepIdxForVal(ctx.sampleRawTerrainGridZ(bx, by));
          return k < 0 ? (baseBottomZ - 1.0) : thresholds[k];
        }
        return baseBottomZ;
      });

  const CELL = 4.0;
  const motorSegGrid = new Map();
  const bridgeSegGrid = new Map();
  const pedSegGrid = new Map();
  const exclPolyGrid = new Map();
  const bldPolyGrid = new Map();
  const plazaPolys = [];

  const insertSeg = (grid, seg, pad) => {
    const minX = Math.min(seg[0], seg[2]) - pad, maxX = Math.max(seg[0], seg[2]) + pad;
    const minY = Math.min(seg[1], seg[3]) - pad, maxY = Math.max(seg[1], seg[3]) + pad;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const y0 = Math.floor(minY / CELL), y1 = Math.floor(maxY / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx}_${gy}`;
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(seg);
      }
    }
  };

  const insertPoly = (grid, rec, pad) => {
    const bb = rec.bbox;
    const x0 = Math.floor((bb[0] - pad) / CELL), x1 = Math.floor((bb[2] + pad) / CELL);
    const y0 = Math.floor((bb[1] - pad) / CELL), y1 = Math.floor((bb[3] + pad) / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx}_${gy}`;
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(rec);
      }
    }
  };

  const toBedRing = (ring) => {
    const out = new Array(ring.length);
    for (let i = 0; i < ring.length; i++) out[i] = toBed(ring[i]);
    return out;
  };

  // Pedestrian squares / plazas (scene.roadPolys)
  for (const rp of (scene.roadPolys || [])) {
    if (!rp || !rp.outer || rp.outer.length < 3) continue;
    const outer = toBedRing(rp.outer);
    const holes = (rp.holes || []).filter(h => h && h.length >= 3).map(toBedRing);
    plazaPolys.push({ outer, holes, bbox: _meshTreeRingBBox(outer) });
  }

  // Buildings (respecting courtyard holes)
  const bldRecs = [];
  for (const b of (scene.buildings || [])) {
    if (!b || !b.outer || b.outer.length < 3) continue;
    const outer = toBedRing(b.outer);
    const holes = (b.holes || []).filter(h => h && h.length >= 3).map(toBedRing);
    const rec = { outer, holes, bbox: _meshTreeRingBBox(outer) };
    bldRecs.push(rec);
    insertPoly(bldPolyGrid, rec, 0.75);
  }

  // Bridges, piers, and explicit shingle/shoal polygons
  const rawExclLists = [scene.bridgePolys, scene.pierPolys, scene.shinglePolys];
  for (let li = 0; li < rawExclLists.length; li++) {
    const list = rawExclLists[li];
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (!p || !p.outer || p.outer.length < 3) continue;
      const outer = toBedRing(p.outer);
      const holes = (p.holes || []).filter(h => h && h.length >= 3).map(toBedRing);
      insertPoly(exclPolyGrid, { outer, holes, bbox: _meshTreeRingBBox(outer) }, 0.75);
    }
  }

  // Detect small barren river gravel/shingle holes inside waterPolys (< 6500 m², 0 greenery, 0 buildings, 0 ground roads)
  const bedGreenRecs = (scene.greenPolys || scene.greeneryPolys || [])
    .filter(gp => gp && gp.outer && gp.outer.length >= 3)
    .map(gp => {
      const outer = toBedRing(gp.outer);
      return { outer, bbox: _meshTreeRingBBox(outer) };
    });
  const bedGroundRoadPts = [];
  for (const rd of (scene.roads || [])) {
    if (!rd || rd.bridge || !rd.pts) continue;
    for (let i = 0; i < rd.pts.length; i++) bedGroundRoadPts.push(toBed(rd.pts[i]));
  }

  for (const wp of (scene.waterPolys || [])) {
    if (!wp || !wp.holes || wp.holes.length === 0) continue;
    for (const rawHole of wp.holes) {
      if (!rawHole || rawHole.length < 3) continue;
      const hole = toBedRing(rawHole);
      const areaM2 = Math.abs(_meshTreeSignedArea2D(hole)) / Math.max(1e-8, mToU * mToU);
      if (areaM2 >= 6500) continue;
      const hBB = _meshTreeRingBBox(hole);
      let cx = 0, cy = 0;
      for (let i = 0; i < hole.length; i++) { cx += hole[i][0]; cy += hole[i][1]; }
      cx /= hole.length; cy /= hole.length;

      let hasDryFeature = false;
      for (let i = 0; i < bedGreenRecs.length && !hasDryFeature; i++) {
        const g = bedGreenRecs[i];
        if (g.bbox[2] < hBB[0] || g.bbox[0] > hBB[2] || g.bbox[3] < hBB[1] || g.bbox[1] > hBB[3]) continue;
        if (_meshTreePointInRing(cx, cy, g.outer) || g.outer.some(pt => _meshTreePointInRing(pt[0], pt[1], hole))) {
          hasDryFeature = true;
        }
      }
      for (let i = 0; i < bldRecs.length && !hasDryFeature; i++) {
        const b = bldRecs[i];
        if (b.bbox[2] < hBB[0] || b.bbox[0] > hBB[2] || b.bbox[3] < hBB[1] || b.bbox[1] > hBB[3]) continue;
        if (b.outer.some(pt => _meshTreePointInRing(pt[0], pt[1], hole))) hasDryFeature = true;
      }
      for (let i = 0; i < plazaPolys.length && !hasDryFeature; i++) {
        const rp = plazaPolys[i];
        if (rp.bbox[2] < hBB[0] || rp.bbox[0] > hBB[2] || rp.bbox[3] < hBB[1] || rp.bbox[1] > hBB[3]) continue;
        if (_meshTreePointInRing(cx, cy, rp.outer) || rp.outer.some(pt => _meshTreePointInRing(pt[0], pt[1], hole))) {
          hasDryFeature = true;
        }
      }
      for (let i = 0; i < bedGroundRoadPts.length && !hasDryFeature; i++) {
        const pt = bedGroundRoadPts[i];
        if (pt[0] >= hBB[0] && pt[0] <= hBB[2] && pt[1] >= hBB[1] && pt[1] <= hBB[3] && _meshTreePointInRing(pt[0], pt[1], hole)) {
          hasDryFeature = true;
        }
      }
      if (!hasDryFeature) {
        insertPoly(exclPolyGrid, { outer: hole, holes: [], bbox: hBB }, 0.75);
      }
    }
  }

  // Linear roads, bridges, piers, and pedestrian streets
  const hasVectorRoadData = Boolean(
    (scene.roads && scene.roads.length > 0) || (scene.roadPolys && scene.roadPolys.length > 0)
  );
  for (const rd of (scene.roads || [])) {
    const pts = rd && rd.pts;
    if (!pts || pts.length < 2) continue;
    const rtype = rd.hwy || rd.type || rd.rtype || '';
    const isBridge = Boolean(rd.bridge || rtype === 'bridge' || rtype === 'pier' || rtype === 'breakwater' || rtype === 'groyne');
    if (isBridge) {
      const brHalfW = Math.max((rd.width || 0.9) * 0.52 * scaleToBed, 0.26 / scaleMm);
      let prev = toBed(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        const curr = toBed(pts[i]);
        insertSeg(bridgeSegGrid, [prev[0], prev[1], curr[0], curr[1], brHalfW], brHalfW + 0.75);
        prev = curr;
      }
      continue;
    }
    if (_meshTreeIsFootpathRoad(rd)) continue;
    if (rtype === 'pedestrian') {
      const minWUnits = Math.max((rd.width || 0.8) * 0.90 * scaleToBed, 0.40 / scaleMm);
      const pedHalfW = Math.max((1.6 / pxPerUnit), minWUnits * 0.65);
      let prev = toBed(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        const curr = toBed(pts[i]);
        insertSeg(pedSegGrid, [prev[0], prev[1], curr[0], curr[1], pedHalfW], pedHalfW + 0.65);
        prev = curr;
      }
      continue;
    }
    const minWUnits = Math.max((rd.width || 1.0) * 0.90 * scaleToBed, 0.40 / scaleMm);
    const minRoadPx = (rtype === 'service' || rtype === 'living_street') ? 2.1 : 2.6;
    const motorHalfW = Math.max((minRoadPx * 0.48) / pxPerUnit, minWUnits * 0.5);
    let prev = toBed(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const curr = toBed(pts[i]);
      insertSeg(motorSegGrid, [prev[0], prev[1], curr[0], curr[1], motorHalfW], motorHalfW + 0.75);
      prev = curr;
    }
  }

  for (const pl of (scene.pierLines || [])) {
    const pts = pl && pl.pts;
    if (!pts || pts.length < 2) continue;
    const pierHalfW = Math.max((pl.width || 0.6) * 0.52 * scaleToBed, 0.24 / scaleMm);
    let prev = toBed(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const curr = toBed(pts[i]);
      insertSeg(bridgeSegGrid, [prev[0], prev[1], curr[0], curr[1], pierHalfW], pierHalfW + 0.75);
      prev = curr;
    }
  }

  const placedGrid = new Map();
  let placedCount = 0;

  return {
    state,
    greenVisible,
    roadsVisible,
    halfW,
    halfH,
    mToU,
    scaleMm,
    pxPerUnit,
    toBed,
    sampleMaskIdx,
    waterMask,
    shoreDist,
    greenMask,
    bldMask,
    majorRoadMask,
    parkPathOnGreenMask,
    parkPathOnGroundMask,
    roadAndBldMask,
    hasVectorRoadData,
    thresholds,
    gHeight,
    rHeight,
    baseBottomZ,
    maxHollowSafeStepU,
    getSurfZ,
    pixelBandIdx: bandAssigner.pixelBandIdx,
    printedSurfaceState: bandAssigner.printedSurfaceState,
    sampleMSIdx: bandAssigner.sampleMSIdx,
    CELL,
    motorSegGrid,
    bridgeSegGrid,
    pedSegGrid,
    exclPolyGrid,
    bldPolyGrid,
    plazaPolys,
    placedGrid,
    getPlacedCount: () => placedCount,
    recordPlacedTree: (bx, by, r) => {
      placedCount++;
      const k = `${Math.floor(bx / 1.2)}_${Math.floor(by / 1.2)}`;
      let arr = placedGrid.get(k);
      if (!arr) { arr = []; placedGrid.set(k, arr); }
      arr.push([bx, by, r]);
    }
  };
}

function _meshTreeTryEmitSingleTree(tr, idx, env, ctx, meshes, allocShellId) {
  if (!tr || tr.length < 2) return false;
  const [bx, by] = env.toBed([tr[0], tr[1]]);

  const realRadiusM = 3.2 + (idx % 5) * 0.55;
  const osmH = (Number(tr[2]) > 2.0) ? Number(tr[2]) : (6.0 + (idx % 6) * 0.75);
  const desiredR = Math.max(0.24, Math.min(0.44, Math.max(realRadiusM * env.mToU * 1.30, 0.75 / env.scaleMm)));
  const minCompactR = Math.max(0.20, Math.min(desiredR, 0.48 / env.scaleMm));
  const baseTreeH = Math.max(0.30, Math.min(0.64, Math.max(osmH * env.mToU * 1.15, 0.92 / env.scaleMm) * (env.state.zScale || 1.0)));

  const minEdgePad = Math.max(0.55, minCompactR * 1.12);
  if (bx < -env.halfW + minEdgePad || bx > env.halfW - minEdgePad || by < -env.halfH + minEdgePad || by > env.halfH - minEdgePad) {
    return false;
  }

  const mIdx = env.sampleMaskIdx(bx, by);
  if (env.waterMask[mIdx] || env.bldMask[mIdx]) return false;
  if (env.parkPathOnGreenMask && env.parkPathOnGreenMask[mIdx]) return false;
  if (env.parkPathOnGroundMask && env.parkPathOnGroundMask[mIdx]) return false;
  if (env.shoreDist && env.shoreDist[mIdx] < minCompactR * 1.05 * env.pxPerUnit + 0.8) return false;

  const zCenter = env.getSurfZ(bx, by);
  if (!(zCenter >= env.baseBottomZ - 1e-4)) return false;

  const cellKey = `${Math.floor(bx / env.CELL)}_${Math.floor(by / env.CELL)}`;

  // 1. Strict exclusion from bridges, piers, shingle/shoal bars, and barren river holes
  let minExclClear = Infinity;
  const exclPolys = env.exclPolyGrid.get(cellKey);
  if (exclPolys) {
    for (let i = 0; i < exclPolys.length; i++) {
      const ep = exclPolys[i];
      if (_meshTreeInPolyWithHoles(bx, by, ep)) return false;
      const dOut = _meshTreeDistToRing(bx, by, ep.outer);
      if (dOut < minExclClear) minExclClear = dOut;
      for (let h = 0; h < ep.holes.length; h++) {
        const dH = _meshTreeDistToRing(bx, by, ep.holes[h]);
        if (dH < minExclClear) minExclClear = dH;
      }
    }
  }
  const brSegs = env.bridgeSegGrid.get(cellKey);
  if (brSegs) {
    for (let i = 0; i < brSegs.length; i++) {
      const s = brSegs[i];
      const clear = _meshTreePointToSegDist(bx, by, s[0], s[1], s[2], s[3]) - s[4];
      if (clear < minExclClear) minExclClear = clear;
    }
  }
  if (minExclClear < minCompactR * 1.05 + 0.03) return false;

  // 2. Strict exclusion from building footprints & walls (preserving open courtyards)
  let minBldClear = Infinity;
  const bldPolys = env.bldPolyGrid.get(cellKey);
  if (bldPolys) {
    for (let i = 0; i < bldPolys.length; i++) {
      const bp = bldPolys[i];
      if (_meshTreeInPolyWithHoles(bx, by, bp)) return false;
      const dOut = _meshTreeDistToRing(bx, by, bp.outer);
      if (dOut < minBldClear) minBldClear = dOut;
      for (let h = 0; h < bp.holes.length; h++) {
        const dH = _meshTreeDistToRing(bx, by, bp.holes[h]);
        if (dH < minBldClear) minBldClear = dH;
      }
    }
  }
  if (minBldClear < minCompactR * 1.05 + 0.02) return false;

  // 3. Strict exclusion from motor roadway & railway carriageways
  let minMotorClear = Infinity;
  const motorSegs = env.motorSegGrid.get(cellKey);
  if (motorSegs) {
    for (let i = 0; i < motorSegs.length; i++) {
      const s = motorSegs[i];
      const clear = _meshTreePointToSegDist(bx, by, s[0], s[1], s[2], s[3]) - s[4];
      if (clear < minMotorClear) minMotorClear = clear;
    }
  }
  if (minMotorClear < minCompactR * 1.05 + 0.025) return false;

  // Check whether tree sits on a pedestrian square (roadPolys) or highway=pedestrian promenade
  let inPedestrianDomain = false;
  for (let i = 0; i < env.plazaPolys.length; i++) {
    if (_meshTreeInPolyWithHoles(bx, by, env.plazaPolys[i])) {
      inPedestrianDomain = true;
      break;
    }
  }
  if (!inPedestrianDomain) {
    const pedSegs = env.pedSegGrid.get(cellKey);
    if (pedSegs) {
      for (let i = 0; i < pedSegs.length; i++) {
        const s = pedSegs[i];
        if (_meshTreePointToSegDist(bx, by, s[0], s[1], s[2], s[3]) <= s[4] + 0.12) {
          inPedestrianDomain = true;
          break;
        }
      }
    }
  }
  if (!inPedestrianDomain && env.majorRoadMask && env.majorRoadMask[mIdx]) {
    return false;
  }
  if (!env.hasVectorRoadData && env.roadAndBldMask && env.roadAndBldMask[mIdx]) {
    return false;
  }

  // Compute maximum geometrically valid crown radius in [minCompactR, desiredR]
  let maxGeomR = desiredR;
  if (env.shoreDist) {
    maxGeomR = Math.min(maxGeomR, (env.shoreDist[mIdx] - 0.805) / (1.05 * env.pxPerUnit));
  }
  maxGeomR = Math.min(
    maxGeomR,
    (minExclClear - 0.03) / 1.05,
    (minBldClear - 0.02) / 1.05,
    (minMotorClear - 0.025) / 1.05,
    (env.halfW - 0.38 - Math.abs(bx)) / 1.05,
    (env.halfH - 0.38 - Math.abs(by)) / 1.05
  );
  if (maxGeomR < minCompactR) return false;

  const msCenter = env.sampleMSIdx(bx, by);
  const kCenter = env.pixelBandIdx[msCenter];
  const surfState = env.printedSurfaceState[msCenter];
  const rot = (((bx * 12.9898 + by * 78.233) % 1) + 1) % 1 * Math.PI * 2;
  const maxStepSpanU = Math.min(env.maxHollowSafeStepU, baseTreeH * 0.85);
  const shoreExtraU = env.shoreDist ? 0 : (0.82 / env.pxPerUnit);

  const candidateRadii = [maxGeomR];
  if (maxGeomR - minCompactR > 0.03) {
    candidateRadii.push((maxGeomR + minCompactR) * 0.5, minCompactR);
  } else if (maxGeomR > minCompactR + 1e-4) {
    candidateRadii.push(minCompactR);
  }

  const pCellX = Math.floor(bx / 1.2), pCellY = Math.floor(by / 1.2);

  for (let ri = 0; ri < candidateRadii.length; ri++) {
    const r = candidateRadii[ri];
    if (env.shoreDist && env.shoreDist[mIdx] < r * 1.05 * env.pxPerUnit + 0.8) continue;

    // Inter-tree crown spacing check via O(1) spatial grid
    let collided = false;
    for (let dx = -1; dx <= 1 && !collided; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = env.placedGrid.get(`${pCellX + dx}_${pCellY + dy}`);
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const pt = list[j];
          if (Math.hypot(bx - pt[0], by - pt[1]) < (r + pt[2]) * 0.92) {
            collided = true;
            break;
          }
        }
      }
    }
    if (collided) continue;

    // Exact 25-point verification across addTreeCrown3D base octagon vertices, midpoints, inner core & outer envelope
    let crownValid = true;
    let zSurfMin = zCenter;
    let zSurfMax = zCenter;
    let allOnLawn = (kCenter >= 0 && surfState === 1);
    let anyGreen = Boolean(env.greenMask && env.greenMask[mIdx]);
    let anyRoadSurface = Boolean(env.majorRoadMask && env.majorRoadMask[mIdx]);

    const vx = new Float64Array(8);
    const vy = new Float64Array(8);
    for (let i = 0; i < 8; i++) {
      const ang = rot + (i / 8) * Math.PI * 2;
      const wobble = 1.0 + 0.05 * Math.sin(ang * 3.0 + bx * 2.1);
      const rv = r * wobble;
      vx[i] = bx + Math.cos(ang) * rv;
      vy[i] = by + Math.sin(ang) * rv;
    }

    for (let i = 0; i < 8; i++) {
      const next = (i + 1) & 7;
      const ang = rot + (i / 8) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);

      // (a) Exact wobbled base vertex
      const pvx = vx[i], pvy = vy[i];
      // (b) Exact base octagon edge midpoint
      const pmx = (pvx + vx[next]) * 0.5, pmy = (pvy + vy[next]) * 0.5;
      // (c) Inner trunk-core sample (0.42 * r)
      const pix = bx + ca * (r * 0.42), piy = by + sa * (r * 0.42);
      // (d) Max outer wobble envelope sample (1.05 * r + fallback shore margin if shoreDist absent)
      const pex = bx + ca * (r * 1.05 + shoreExtraU), pey = by + sa * (r * 1.05 + shoreExtraU);

      const mV = env.sampleMaskIdx(pvx, pvy);
      const mM = env.sampleMaskIdx(pmx, pmy);
      const mI = env.sampleMaskIdx(pix, piy);
      const mE = env.sampleMaskIdx(pex, pey);

      if (env.waterMask[mV] || env.waterMask[mM] || env.waterMask[mI] || env.waterMask[mE]) {
        crownValid = false; break;
      }
      if (env.shoreDist && (env.shoreDist[mV] < 0.85 || env.shoreDist[mM] < 0.85 || env.shoreDist[mE] < 0.85)) {
        crownValid = false; break;
      }
      if (env.bldMask[mV] || env.bldMask[mM] || env.bldMask[mI] || env.bldMask[mE]) {
        crownValid = false; break;
      }
      if ((env.parkPathOnGreenMask && env.parkPathOnGreenMask[mI]) || (env.parkPathOnGroundMask && env.parkPathOnGroundMask[mI])) {
        crownValid = false; break;
      }
      if (!inPedestrianDomain && !env.hasVectorRoadData) {
        if (env.majorRoadMask && env.majorRoadMask[mI]) { crownValid = false; break; }
        if (env.roadAndBldMask && env.roadAndBldMask[mI]) { crownValid = false; break; }
      }

      const zV = env.getSurfZ(pvx, pvy);
      const zM = env.getSurfZ(pmx, pmy);
      const zI = env.getSurfZ(pix, piy);
      if (!(zV >= env.baseBottomZ - 1e-4) || !(zM >= env.baseBottomZ - 1e-4) || !(zI >= env.baseBottomZ - 1e-4)) {
        crownValid = false; break;
      }
      if (zV < zSurfMin) zSurfMin = zV;
      if (zM < zSurfMin) zSurfMin = zM;
      if (zI < zSurfMin) zSurfMin = zI;
      if (zV > zSurfMax) zSurfMax = zV;
      if (zM > zSurfMax) zSurfMax = zM;
      if (zI > zSurfMax) zSurfMax = zI;
      if (zSurfMax - zSurfMin > maxStepSpanU) {
        crownValid = false; break;
      }

      if (allOnLawn) {
        const msV = env.sampleMSIdx(pvx, pvy);
        const msM = env.sampleMSIdx(pmx, pmy);
        if (env.pixelBandIdx[msV] !== kCenter || env.printedSurfaceState[msV] !== 1 ||
            env.pixelBandIdx[msM] !== kCenter || env.printedSurfaceState[msM] !== 1) {
          allOnLawn = false;
        }
      }
      if (env.greenMask && (env.greenMask[mV] || env.greenMask[mM])) anyGreen = true;
      if (env.majorRoadMask && (env.majorRoadMask[mV] || env.majorRoadMask[mM])) anyRoadSurface = true;
    }

    if (!crownValid) continue;

    env.recordPlacedTree(bx, by, r);

    const isFlatBand = (zSurfMax - zSurfMin) <= 1e-4;
    const onPrintedLawn = Boolean(
      env.greenVisible &&
      isFlatBand &&
      kCenter >= 0 &&
      allOnLawn &&
      Math.abs(env.thresholds[kCenter] - zSurfMin) <= 1e-3
    );
    const zGround = onPrintedLawn ? (zSurfMin + env.gHeight) : zSurfMin;
    const stepEmbedH = Math.max(0, zSurfMax - zSurfMin);
    let coverExtraH = 0;
    if (!onPrintedLawn) {
      if (env.greenVisible && (anyGreen || surfState === 1 || surfState === 0)) {
        coverExtraH = Math.max(coverExtraH, env.gHeight || 0);
      }
      if (env.roadsVisible && (anyRoadSurface || inPedestrianDomain)) {
        coverExtraH = Math.max(coverExtraH, env.rHeight || 0);
      }
    }
    const effTreeHeight = baseTreeH + stepEmbedH + coverExtraH;

    const treeShell = [];
    addTreeCrown3D(bx, by, zGround, r, effTreeHeight, 2, treeShell, 0, allocShellId());
    appendShellClippedToTiles(treeShell, ctx, meshes.greenery);
    return true;
  }

  return false;
}

function isTreesLayerVisible(scene, state) {
  const lv = state.layerVisible || state.layers;
  const lod = (state && state.lodSettings) || {};
  const spanKm = Number(state.spanKm) || (Number(state.mapSpanMeters) / 1000) || ((scene.spanMeters || 1200) / 1000);
  const allDetailsFilter = (lod.minBuildingFootprintM === 0 || lod.minBuildingMeters === 0 || state.minFeatureSizeMeters === 0 || state.minBuildingMeters === 0);
  const defaultTreeKm = allDetailsFilter ? 6.0 : 4.5;
  const treeThresholdKm = (lod.treeThresholdKm !== undefined)
    ? Number(lod.treeThresholdKm)
    : (lod.treeMaxSpanKm !== undefined ? Number(lod.treeMaxSpanKm) : defaultTreeKm);
  const userEnableTrees = (lod.enableTrees !== undefined) ? Boolean(lod.enableTrees) : true;
  const allowTreesByScale = spanKm <= treeThresholdKm;
  return (!lv || lv.trees !== false) && userEnableTrees && allowTreesByScale;
}

function emitTreesLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner) {
  if (!isTreesLayerVisible(scene, state)) return;
  const treeList = scene.trees || [];
  if (treeList.length === 0) return;

  const env = _meshTreePreparePlacementEnv(scene, ctx, baseInfo, state, bandAssigner);
  for (let idx = 0; idx < treeList.length; idx++) {
    _meshTreeTryEmitSingleTree(treeList[idx], idx, env, ctx, meshes, allocShellId);
  }
}

async function emitTreesLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker = null) {
  if (!isTreesLayerVisible(scene, state)) return;
  const treeList = scene.trees || [];
  if (treeList.length === 0) return;

  const env = _meshTreePreparePlacementEnv(scene, ctx, baseInfo, state, bandAssigner);
  const totalTrees = Math.max(1, treeList.length);

  for (let idx = 0; idx < treeList.length; idx++) {
    if ((idx & 31) === 0) {
      if (yieldCtrl) {
        yieldCtrl.checkCancellation();
        await yieldCtrl.yieldIfNeeded();
      }
      if (progressTracker && progressTracker.onProgress) {
        const treeFrac = 0.90 + (idx / totalTrees) * 0.10;
        const pct = 42 + Math.min(12, Math.round(treeFrac * 12));
        if (pct > (progressTracker.lastReportedPct || 0)) {
          progressTracker.lastReportedPct = pct;
          progressTracker.onProgress(
            pct,
            `Etap 2/5: Osadzanie koron drzew 3D (${idx + 1}/${totalTrees})...`,
            `Organiczne korony drzew (${env.getPlacedCount()} posadzonych)`
          );
        }
      }
    }
    _meshTreeTryEmitSingleTree(treeList[idx], idx, env, ctx, meshes, allocShellId);
  }
}

function emitTreesLayer(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl = null, progressTracker = null) {
  if (yieldCtrl) {
    return emitTreesLayerAsync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner, yieldCtrl, progressTracker);
  }
  return emitTreesLayerSync(scene, ctx, baseInfo, state, meshes, allocShellId, bandAssigner);
}

if (typeof window !== 'undefined') {
  window.isTreesLayerVisible = isTreesLayerVisible;
  window.emitTreesLayer = emitTreesLayer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isTreesLayerVisible,
    emitTreesLayerSync,
    emitTreesLayerAsync,
    emitTreesLayer
  };
}
