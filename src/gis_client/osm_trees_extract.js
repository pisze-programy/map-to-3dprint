// ============================================================================
// src/gis_client/osm_trees_extract.js
// OSM Trees Extractor (Individual Tree Nodes, Tree Rows & Park/Forest Grove Seeding)
// ============================================================================

if (typeof pointInPolyLocal === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./overpass_dem_fetch.js'));
}
if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}

const _OSM_TREE_BARREN_NATURALS = new Set([
  'shingle', 'shoal', 'mud', 'bare_rock', 'reef', 'glacier'
]);
const _OSM_TREE_BARREN_WETLANDS = new Set([
  'tidalflat', 'mud', 'reedbed', 'saltmarsh'
]);
const _OSM_TREE_BARREN_MANMADE = new Set([
  'pier', 'breakwater', 'groyne'
]);
const _OSM_TREE_BARREN_WATERWAY = new Set([
  'dam', 'weir', 'dock', 'boatyard', 'lock_gate'
]);
const _OSM_TREE_NON_SCATTER_GREEN = new Set([
  'grass', 'meadow', 'grassland', 'heath', 'pitch', 'playground',
  'farmland', 'vineyard', 'allotments', 'golf_course'
]);
const _OSM_TREE_WOOD_TYPES = new Set([
  'forest', 'wood', 'scrub', 'nature_reserve', 'orchard'
]);
const _OSM_TREE_PATH_HWY = new Set([
  'footway', 'path', 'steps', 'cycleway', 'bridleway', 'track', 'corridor', 'pedestrian'
]);

function _osmTreeIsFalseLike(val) {
  return !val || ['no', 'false', '0', 'none'].includes(String(val).toLowerCase().trim());
}

function _osmTreeIsSkippedTag(tags) {
  if (!tags) return true;
  if (!_osmTreeIsFalseLike(tags.indoor)) return true;
  if (!_osmTreeIsFalseLike(tags.tunnel)) return true;
  if (!_osmTreeIsFalseLike(tags.bridge)) return true;
  if (String(tags.covered || '').toLowerCase() === 'yes') return true;
  const loc = String(tags.location || '').toLowerCase().trim();
  if (loc === 'underground' || loc === 'underwater' || loc === 'indoor' || loc === 'roof' || loc === 'bridge') {
    return true;
  }
  const layerVal = parseFloatTagJS(tags.layer, 0) || 0;
  if (layerVal < -0.1) return true;
  return false;
}

function _osmTreeIsBarrenAreaTags(tags) {
  if (!tags) return false;
  return (
    _OSM_TREE_BARREN_NATURALS.has(tags.natural) ||
    _OSM_TREE_BARREN_WETLANDS.has(tags.wetland) ||
    _OSM_TREE_BARREN_MANMADE.has(tags.man_made) ||
    _OSM_TREE_BARREN_WATERWAY.has(tags.waterway)
  );
}

function _osmTreeEffectiveWantTrees(ctx) {
  if (!ctx) return false;
  const lod = ctx.lodSettings || null;
  const spanKm = (Number(ctx.effectiveSpanM) || 1200) / 1000.0;
  if (lod) {
    if (lod.enableTrees === false) return false;
    const maxKm = (lod.treeThresholdKm !== undefined)
      ? Number(lod.treeThresholdKm)
      : (lod.treeMaxSpanKm !== undefined ? Number(lod.treeMaxSpanKm) : 4.5);
    return spanKm <= maxKm;
  }
  return Boolean(ctx.wantTrees || spanKm <= 4.5);
}

function _osmTreePointToSegSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx, qy = ay + t * dy;
  return (px - qx) * (px - qx) + (py - qy) * (py - qy);
}

function _osmTreeRingBBox(ring) {
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

function _osmTreeDistToRingSq(px, py, ring) {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d2 = _osmTreePointToSegSq(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
    if (d2 < best) best = d2;
  }
  return best;
}

function _osmTreeInPolyWithHoles(px, py, polyRec) {
  const bb = polyRec.bbox;
  if (px < bb[0] || px > bb[2] || py < bb[1] || py > bb[3]) return false;
  if (!pointInPolyLocal(px, py, polyRec.outer)) return false;
  const holes = polyRec.holes;
  if (holes && holes.length > 0) {
    for (let i = 0; i < holes.length; i++) {
      if (holes[i].length >= 3 && pointInPolyLocal(px, py, holes[i])) return false;
    }
  }
  return true;
}

function _osmTreeBuildExclusionChecker(ctx) {
  if (!ctx) return null;
  const mToU = ctx.metersToUnits || 0.14;
  const CELL = 4.5;

  const polyGrid = new Map();
  const segGrid = new Map();

  const insertPolyGrid = (rec, pad) => {
    const bb = rec.bbox;
    const x0 = Math.floor((bb[0] - pad) / CELL), x1 = Math.floor((bb[2] + pad) / CELL);
    const y0 = Math.floor((bb[1] - pad) / CELL), y1 = Math.floor((bb[3] + pad) / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx}_${gy}`;
        let arr = polyGrid.get(k);
        if (!arr) { arr = []; polyGrid.set(k, arr); }
        arr.push(rec);
      }
    }
  };

  const insertSegGrid = (seg, pad) => {
    const minX = Math.min(seg[0], seg[2]) - pad, maxX = Math.max(seg[0], seg[2]) + pad;
    const minY = Math.min(seg[1], seg[3]) - pad, maxY = Math.max(seg[1], seg[3]) + pad;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const y0 = Math.floor(minY / CELL), y1 = Math.floor(maxY / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx}_${gy}`;
        let arr = segGrid.get(k);
        if (!arr) { arr = []; segGrid.set(k, arr); }
        arr.push(seg);
      }
    }
  };

  const shoreClearExplicit = Math.max(0.24, 2.8 * mToU);
  const shoreClearScatter = Math.max(0.32, 3.6 * mToU);
  const barrenClearExplicit = Math.max(0.22, 2.4 * mToU);
  const barrenClearScatter = Math.max(0.28, 3.0 * mToU);
  const bldClearExplicit = Math.max(0.10, 1.0 * mToU);
  const bldClearScatter = Math.max(0.20, 2.2 * mToU);

  const greenRecs = (ctx.greenPolys || []).filter(gp => gp && gp.outer && gp.outer.length >= 3).map(gp => ({
    outer: gp.outer,
    bbox: _osmTreeRingBBox(gp.outer)
  }));
  const bldList = (ctx.s3db && Array.isArray(ctx.s3db.buildings)) ? ctx.s3db.buildings : (ctx.buildings || []);
  const bldRecs = bldList.filter(b => b && b.outer && b.outer.length >= 3).map(b => ({
    kind: 'bld',
    outer: b.outer,
    holes: b.holes || [],
    bbox: _osmTreeRingBBox(b.outer)
  }));
  for (let i = 0; i < bldRecs.length; i++) {
    insertPolyGrid(bldRecs[i], bldClearScatter);
  }

  // Water polygons + detection of small barren un-vegetated river gravel/shingle holes
  for (const wp of (ctx.waterPolys || [])) {
    if (!wp || !wp.outer || wp.outer.length < 3) continue;
    const wRec = {
      kind: 'water',
      outer: wp.outer,
      holes: wp.holes || [],
      bbox: _osmTreeRingBBox(wp.outer)
    };
    insertPolyGrid(wRec, shoreClearScatter);

    for (const h of (wp.holes || [])) {
      if (!h || h.length < 3) continue;
      const areaM2 = Math.abs(polyAreaSignedJS(h)) / Math.max(1e-8, mToU * mToU);
      if (areaM2 >= 6500) continue;
      const hBB = _osmTreeRingBBox(h);
      let cx = 0, cy = 0;
      for (let i = 0; i < h.length; i++) { cx += h[i][0]; cy += h[i][1]; }
      cx /= h.length; cy /= h.length;

      let hasFeature = false;
      for (let i = 0; i < greenRecs.length && !hasFeature; i++) {
        const g = greenRecs[i];
        if (g.bbox[2] < hBB[0] || g.bbox[0] > hBB[2] || g.bbox[3] < hBB[1] || g.bbox[1] > hBB[3]) continue;
        if (pointInPolyLocal(cx, cy, g.outer) || g.outer.some(p => pointInPolyLocal(p[0], p[1], h))) hasFeature = true;
      }
      for (let i = 0; i < bldRecs.length && !hasFeature; i++) {
        const b = bldRecs[i];
        if (b.bbox[2] < hBB[0] || b.bbox[0] > hBB[2] || b.bbox[3] < hBB[1] || b.bbox[1] > hBB[3]) continue;
        if (b.outer.some(p => pointInPolyLocal(p[0], p[1], h))) hasFeature = true;
      }
      for (const rd of (ctx.roads || [])) {
        if (hasFeature) break;
        if (rd.bridge || !rd.pts) continue;
        if (rd.pts.some(p => p[0] >= hBB[0] && p[0] <= hBB[2] && p[1] >= hBB[1] && p[1] <= hBB[3] && pointInPolyLocal(p[0], p[1], h))) {
          hasFeature = true;
        }
      }
      if (!hasFeature) {
        insertPolyGrid({ kind: 'barren', outer: h, holes: [], bbox: hBB }, barrenClearScatter);
      }
    }
  }

  // Bridges & piers polygons
  for (const bp of (ctx.bridgePolys || [])) {
    if (bp && bp.outer && bp.outer.length >= 3) {
      insertPolyGrid({ kind: 'barren', outer: bp.outer, holes: bp.holes || [], bbox: _osmTreeRingBBox(bp.outer) }, barrenClearScatter);
    }
  }
  for (const pp of (ctx.pierPolys || [])) {
    if (pp && pp.outer && pp.outer.length >= 3) {
      insertPolyGrid({ kind: 'barren', outer: pp.outer, holes: pp.holes || [], bbox: _osmTreeRingBBox(pp.outer) }, barrenClearScatter);
    }
  }

  // Explicit OSM natural=shingle|shoal|mud|bare_rock & wetland=tidalflat|mud|reedbed & pier/dam ways/relations
  if (ctx.relations && ctx.stitchedRelPolys) {
    for (const rel of ctx.relations) {
      if (!_osmTreeIsBarrenAreaTags(rel.tags)) continue;
      const st = ctx.stitchedRelPolys.get(rel.id);
      if (!st) continue;
      for (const op of (st.outerPolys || [])) {
        if (op.length >= 3) {
          insertPolyGrid({ kind: 'barren', outer: op, holes: st.innerPolys || [], bbox: _osmTreeRingBBox(op) }, barrenClearScatter);
        }
      }
    }
  }
  if (ctx.ways && typeof ctx.nodesToPts === 'function') {
    for (const w of ctx.ways.values()) {
      const tags = w.tags || {};
      if (!_osmTreeIsBarrenAreaTags(tags)) continue;
      const nids = w.nodes || [];
      if (nids.length < 2) continue;
      const isClosed = nids.length >= 4 && nids[0] === nids[nids.length - 1];
      const pts = ctx.nodesToPts(nids, 0.02);
      if (isClosed && pts.length >= 3) {
        insertPolyGrid({ kind: 'barren', outer: pts, holes: [], bbox: _osmTreeRingBBox(pts) }, barrenClearScatter);
      } else if (!isClosed && pts.length >= 2) {
        const hw = Math.max(0.22, parseFloatTagJS(tags.width, 4.0) * 0.5 * mToU);
        for (let i = 0; i < pts.length - 1; i++) {
          insertSegGrid([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw + barrenClearExplicit, hw + barrenClearScatter], hw + barrenClearScatter);
        }
      }
    }
  }

  // Linear waterLines, bridges, piers, motor roadways, and footpaths
  for (const wl of (ctx.waterLines || [])) {
    const pts = wl && wl.pts;
    if (!pts || pts.length < 2) continue;
    const hw = (wl.width || 0.4) * 0.5;
    for (let i = 0; i < pts.length - 1; i++) {
      insertSegGrid([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw + shoreClearExplicit, hw + shoreClearScatter], hw + shoreClearScatter);
    }
  }
  for (const pl of (ctx.pierLines || [])) {
    const pts = pl && pl.pts;
    if (!pts || pts.length < 2) continue;
    const hw = (pl.width || 0.4) * 0.5;
    for (let i = 0; i < pts.length - 1; i++) {
      insertSegGrid([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], hw + barrenClearExplicit, hw + barrenClearScatter], hw + barrenClearScatter);
    }
  }
  const motorPadExplicit = Math.max(0.08, 0.85 * mToU);
  const motorPadScatter = Math.max(0.22, 2.4 * mToU);
  const pathPadScatter = Math.max(0.12, 1.2 * mToU);
  for (const rd of (ctx.roads || [])) {
    const pts = rd && rd.pts;
    if (!pts || pts.length < 2) continue;
    const hw = (rd.width || 0.5) * 0.5;
    const isBridge = Boolean(rd.bridge || ['bridge', 'pier', 'breakwater', 'groyne'].includes(rd.hwy));
    const isPathOrPed = Boolean(rd.isPath || _OSM_TREE_PATH_HWY.has(rd.hwy));
    let rExplicit = 0, rScatter = 0;
    if (isBridge) {
      rExplicit = hw + barrenClearExplicit;
      rScatter = hw + barrenClearScatter;
    } else if (!isPathOrPed) {
      rExplicit = hw + motorPadExplicit;
      rScatter = hw + motorPadScatter;
    } else {
      rExplicit = -1; // explicit street/promenade trees allowed next to paths/pedestrian malls
      rScatter = hw + pathPadScatter;
    }
    const maxPad = Math.max(rExplicit, rScatter);
    if (maxPad <= 0) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      insertSegGrid([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rExplicit, rScatter], maxPad);
    }
  }

  let queryStamp = 1;
  const polyStamp = new WeakMap();
  const segStamp = new WeakMap();

  return function isExcludedPoint(px, py, isExplicit) {
    queryStamp = (queryStamp + 1) | 0;
    if (queryStamp <= 0) queryStamp = 1;
    const stamp = queryStamp;
    const kCell = `${Math.floor(px / CELL)}_${Math.floor(py / CELL)}`;

    const polys = polyGrid.get(kCell);
    if (polys) {
      const wClearSq = (isExplicit ? shoreClearExplicit : shoreClearScatter) ** 2;
      const barClearSq = (isExplicit ? barrenClearExplicit : barrenClearScatter) ** 2;
      const bldClearSq = (isExplicit ? bldClearExplicit : bldClearScatter) ** 2;
      for (let i = 0; i < polys.length; i++) {
        const rec = polys[i];
        if (polyStamp.get(rec) === stamp) continue;
        polyStamp.set(rec, stamp);
        if (_osmTreeInPolyWithHoles(px, py, rec)) return true;

        const clearSq = rec.kind === 'water' ? wClearSq : (rec.kind === 'barren' ? barClearSq : bldClearSq);
        const clearR = rec.kind === 'water'
          ? (isExplicit ? shoreClearExplicit : shoreClearScatter)
          : (rec.kind === 'barren' ? (isExplicit ? barrenClearExplicit : barrenClearScatter) : (isExplicit ? bldClearExplicit : bldClearScatter));
        const bb = rec.bbox;
        if (px < bb[0] - clearR || px > bb[2] + clearR || py < bb[1] - clearR || py > bb[3] + clearR) continue;
        if (_osmTreeDistToRingSq(px, py, rec.outer) < clearSq) return true;
        if (rec.holes && rec.holes.length > 0) {
          for (let h = 0; h < rec.holes.length; h++) {
            if (rec.holes[h].length >= 3 && _osmTreeDistToRingSq(px, py, rec.holes[h]) < clearSq) return true;
          }
        }
      }
    }

    const segs = segGrid.get(kCell);
    if (segs) {
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (segStamp.get(seg) === stamp) continue;
        segStamp.set(seg, stamp);
        const rad = isExplicit ? seg[4] : seg[5];
        if (rad <= 0) continue;
        if (_osmTreePointToSegSq(px, py, seg[0], seg[1], seg[2], seg[3]) < rad * rad) return true;
      }
    }
    return false;
  };
}

function collectOsmTreeNodeJS(el, pt, wantTrees, fetchHalfW, fetchHalfH, treeNodes) {
  if (!wantTrees || !el || !el.tags || el.tags.natural !== 'tree') return;
  if (Math.abs(pt[0]) > fetchHalfW + 0.5 || Math.abs(pt[1]) > fetchHalfH + 0.5) return;
  if (_osmTreeIsSkippedTag(el.tags)) return;

  let hM = parseFloatTagJS(el.tags.height, null);
  if (hM === null || hM <= 0) {
    const crownM = parseFloatTagJS(el.tags.diameter_crown || el.tags['crown:diameter'], null);
    hM = (crownM !== null && crownM > 1.0) ? Math.max(5.5, crownM * 1.45) : 9.2;
  }
  treeNodes.push([
    Math.round(pt[0] * 100) / 100,
    Math.round(pt[1] * 100) / 100,
    Math.round(Math.min(18.0, Math.max(4.5, hM)) * 10) / 10
  ]);
}

function processOsmTreeRowWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (tags.natural === 'tree_row') {
    if (_osmTreeEffectiveWantTrees(ctx) && !_osmTreeIsSkippedTag(tags)) {
      const pts = nids.map(id => ctx.nodes.get(id)).filter(Boolean);
      const spacingM = Math.min(12.0, Math.max(5.0, parseFloatTagJS(tags.spacing, 7.0) || 7.0));
      const rowStepU = Math.max(0.38, spacingM * ctx.metersToUnits);
      const rowHeightM = Math.round(Math.min(18.0, Math.max(4.5, parseFloatTagJS(tags.height, 8.8) || 8.8)) * 10) / 10;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (segLen < 1e-4) continue;
        const steps = Math.max(1, Math.round(segLen / rowStepU));
        const startS = (i === 0) ? 0 : 1;
        for (let s = startS; s <= steps; s++) {
          const t = s / steps;
          const tx = p0[0] + (p1[0] - p0[0]) * t;
          const ty = p0[1] + (p1[1] - p0[1]) * t;
          if (Math.abs(tx) <= ctx.fetchHalfW + 0.5 && Math.abs(ty) <= ctx.fetchHalfH + 0.5) {
            ctx.treeNodes.push([Math.round(tx * 100) / 100, Math.round(ty * 100) / 100, rowHeightM]);
          }
        }
      }
    }
    return true;
  }
  return false;
}

function populateParkTreesJS(wantTrees, treeNodes, greenPolys, metersToUnits, fetchHalfW, fetchHalfH, isExcludedPoint = null) {
  const trees = [];
  if (!wantTrees) return trees;

  const MAX_TREES = 3200;
  const treeBuckets = new Map();
  const canPlaceTree = (tx, ty, minDistSq, cellSz) => {
    const bx = Math.floor(tx / cellSz), by = Math.floor(ty / cellSz);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = treeBuckets.get(`${bx + dx}_${by + dy}`);
        if (!list) continue;
        for (const [ox, oy] of list) {
          if ((tx - ox) * (tx - ox) + (ty - oy) * (ty - oy) < minDistSq) return false;
        }
      }
    }
    const key = `${bx}_${by}`;
    if (!treeBuckets.has(key)) treeBuckets.set(key, []);
    treeBuckets.get(key).push([tx, ty]);
    return true;
  };

  // Pass 1: Explicit OSM natural=tree & natural=tree_row alignments (priority over scatter)
  const nodeMinDistU = Math.max(0.22, 3.8 * metersToUnits);
  const nodeMinDistSq = nodeMinDistU * nodeMinDistU;
  const nodeCellSz = Math.max(0.42, nodeMinDistU * 1.4);
  for (const tr of (treeNodes || [])) {
    if (trees.length >= MAX_TREES) break;
    const tx = tr[0], ty = tr[1], th = tr[2];
    if (isExcludedPoint && isExcludedPoint(tx, ty, true)) continue;
    if (canPlaceTree(tx, ty, nodeMinDistSq, nodeCellSz)) {
      trees.push([tx, ty, th]);
    }
  }

  // Pass 2: Deterministic Halton scatter inside eligible parks, gardens, orchards & woods
  const parkMinDistU = Math.max(0.38, 7.2 * metersToUnits);
  const parkMinDistSq = parkMinDistU * parkMinDistU;
  const parkCellSz = Math.max(0.58, parkMinDistU * 1.3);
  const minParkAreaU = Math.max(0.28, 420.0 * metersToUnits * metersToUnits);
  const greenEdgeInsetSq = (Math.max(0.16, 1.8 * metersToUnits)) ** 2;

  for (const gp of (greenPolys || [])) {
    if (!gp || !gp.outer || gp.outer.length < 3) continue;
    if (_OSM_TREE_NON_SCATTER_GREEN.has(gp.type)) continue;
    const outerArea = Math.abs(polyAreaSignedJS(gp.outer));
    let holesArea = 0;
    for (const h of (gp.holes || [])) {
      if (h && h.length >= 3) holesArea += Math.abs(polyAreaSignedJS(h));
    }
    const area = Math.max(0, outerArea - holesArea);
    if (area < minParkAreaU) continue;

    const areaM2 = area / Math.max(1e-8, metersToUnits * metersToUnits);
    const isWood = _OSM_TREE_WOOD_TYPES.has(gp.type);
    const targetCount = Math.min(
      isWood ? 110 : 42,
      Math.max(1, Math.floor(areaM2 / (isWood ? 340.0 : 820.0)))
    );

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of gp.outer) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    minX = Math.max(-fetchHalfW + 0.5, minX);
    maxX = Math.min(fetchHalfW - 0.5, maxX);
    minY = Math.max(-fetchHalfH + 0.5, minY);
    maxY = Math.min(fetchHalfH - 0.5, maxY);
    if (minX >= maxX || minY >= maxY) continue;

    let added = 0;
    const maxAttempts = Math.min(900, targetCount * 12);
    for (let k = 1; k <= maxAttempts && added < targetCount && trees.length < MAX_TREES; k++) {
      const px = minX + ((k * 0.6180339887) % 1) * (maxX - minX);
      const py = minY + ((k * 0.3819660113) % 1) * (maxY - minY);
      if (!pointInPolyLocal(px, py, gp.outer)) continue;
      if ((gp.holes || []).some(h => h.length >= 3 && pointInPolyLocal(px, py, h))) continue;
      if (_osmTreeDistToRingSq(px, py, gp.outer) < greenEdgeInsetSq) continue;
      if ((gp.holes || []).some(h => h.length >= 3 && _osmTreeDistToRingSq(px, py, h) < greenEdgeInsetSq)) continue;
      if (isExcludedPoint && isExcludedPoint(px, py, false)) continue;
      if (!canPlaceTree(px, py, parkMinDistSq, parkCellSz)) continue;
      trees.push([
        Math.round(px * 100) / 100,
        Math.round(py * 100) / 100,
        Math.round((7.5 + (k % 5) * 1.1) * 10) / 10
      ]);
      added++;
    }
  }

  return trees;
}

function finalizeOsmTreesLayerJS(ctx) {
  const allowTrees = _osmTreeEffectiveWantTrees(ctx);
  if (!allowTrees) return [];
  const exclusionChecker = _osmTreeBuildExclusionChecker(ctx);
  return populateParkTreesJS(
    true,
    ctx.treeNodes,
    ctx.greenPolys,
    ctx.metersToUnits,
    ctx.fetchHalfW,
    ctx.fetchHalfH,
    exclusionChecker
  );
}

if (typeof window !== 'undefined') {
  window.collectOsmTreeNodeJS = collectOsmTreeNodeJS;
  window.processOsmTreeRowWayJS = processOsmTreeRowWayJS;
  window.populateParkTreesJS = populateParkTreesJS;
  window.finalizeOsmTreesLayerJS = finalizeOsmTreesLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    collectOsmTreeNodeJS,
    processOsmTreeRowWayJS,
    populateParkTreesJS,
    finalizeOsmTreesLayerJS
  };
}
