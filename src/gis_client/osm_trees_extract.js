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

function collectOsmTreeNodeJS(el, pt, wantTrees, fetchHalfW, fetchHalfH, treeNodes) {
  if (wantTrees && el.tags && el.tags.natural === 'tree' && Math.abs(pt[0]) <= fetchHalfW + 0.5 && Math.abs(pt[1]) <= fetchHalfH + 0.5) {
    const hM = parseFloatTagJS(el.tags.height, 9.5);
    treeNodes.push([
      Math.round(pt[0] * 100) / 100,
      Math.round(pt[1] * 100) / 100,
      Math.round(Math.min(18.0, Math.max(5.0, hM)) * 10) / 10
    ]);
  }
}

function processOsmTreeRowWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (tags.natural === 'tree_row') {
    if (ctx.wantTrees) {
      const pts = nids.map(id => ctx.nodes.get(id)).filter(Boolean);
      const rowStepU = Math.max(0.45, 7.5 * ctx.metersToUnits);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const steps = Math.max(1, Math.floor(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / rowStepU));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const tx = p0[0] + (p1[0] - p0[0]) * t, ty = p0[1] + (p1[1] - p0[1]) * t;
          if (Math.abs(tx) <= ctx.fetchHalfW + 0.5 && Math.abs(ty) <= ctx.fetchHalfH + 0.5) {
            ctx.treeNodes.push([Math.round(tx * 100) / 100, Math.round(ty * 100) / 100, 9.0]);
          }
        }
      }
    }
    return true;
  }
  return false;
}

function populateParkTreesJS(wantTrees, treeNodes, greenPolys, metersToUnits, fetchHalfW, fetchHalfH) {
  const trees = [];
  if (!wantTrees) return trees;

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

  const nodeMinDistU = Math.max(0.24, 4.2 * metersToUnits);
  const nodeMinDistSq = nodeMinDistU * nodeMinDistU;
  const nodeCellSz = Math.max(0.45, nodeMinDistU * 1.4);
  for (const [tx, ty, th] of treeNodes) {
    if (trees.length >= 2600) break;
    if (canPlaceTree(tx, ty, nodeMinDistSq, nodeCellSz)) trees.push([tx, ty, th]);
  }

  const parkMinDistU = Math.max(0.42, 7.5 * metersToUnits);
  const parkMinDistSq = parkMinDistU * parkMinDistU;
  const parkCellSz = Math.max(0.65, parkMinDistU * 1.3);
  const minParkAreaU = Math.max(0.6, 800.0 * metersToUnits * metersToUnits);
  for (const gp of greenPolys) {
    if (['grass', 'meadow', 'pitch', 'playground', 'farmland', 'allotments', 'golf_course', 'village_green'].includes(gp.type)) continue;
    const area = Math.abs(polyAreaSignedJS(gp.outer));
    if (area < minParkAreaU) continue;
    const areaM2 = area / Math.max(1e-6, metersToUnits * metersToUnits);
    const isWood = ['forest', 'wood', 'scrub', 'nature_reserve'].includes(gp.type);
    const targetCount = Math.min(isWood ? 85 : 32, Math.max(2, Math.floor(areaM2 / (isWood ? 360.0 : 950.0))));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of gp.outer) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    minX = Math.max(-fetchHalfW + 0.5, minX); maxX = Math.min(fetchHalfW - 0.5, maxX);
    minY = Math.max(-fetchHalfH + 0.5, minY); maxY = Math.min(fetchHalfH - 0.5, maxY);
    if (minX >= maxX || minY >= maxY) continue;
    let added = 0;
    for (let k = 1; k <= targetCount * 5 && added < targetCount && trees.length < 2600; k++) {
      const px = minX + ((k * 0.6180339887) % 1) * (maxX - minX);
      const py = minY + ((k * 0.3819660113) % 1) * (maxY - minY);
      if (!pointInPolyLocal(px, py, gp.outer)) continue;
      if ((gp.holes || []).some(h => pointInPolyLocal(px, py, h))) continue;
      if (!canPlaceTree(px, py, parkMinDistSq, parkCellSz)) continue;
      trees.push([Math.round(px * 100) / 100, Math.round(py * 100) / 100, Math.round((7.5 + (k % 5) * 1.1) * 10) / 10]);
      added++;
    }
  }

  return trees;
}

function finalizeOsmTreesLayerJS(ctx) {
  return populateParkTreesJS(ctx.wantTrees, ctx.treeNodes, ctx.greenPolys, ctx.metersToUnits, ctx.fetchHalfW, ctx.fetchHalfH);
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
