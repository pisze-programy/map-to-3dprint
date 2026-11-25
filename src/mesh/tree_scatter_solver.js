// ============================================================================
// src/mesh/tree_scatter_solver.js
// Deterministic Tree & Tree-Row Scattering with Courtyard Holes, Shoreline/Wall/Road
// Crown Clearance & Crown-Radius Spatial Collision
// ============================================================================

(function (root) {
  function _ptInRing2D(px, py, ring) {
    let inside = false;
    for (let k = 0, n = ring.length, j = n - 1; k < n; j = k++) {
      const xi = ring[k][0], yi = ring[k][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function _ptInSolidPoly(px, py, bp) {
    if (px < bp.bb[0] || px > bp.bb[2] || py < bp.bb[1] || py > bp.bb[3]) return false;
    if (!_ptInRing2D(px, py, bp.outer)) return false;
    const holes = bp.holes;
    if (holes && holes.length > 0) {
      for (let i = 0; i < holes.length; i++) {
        if (holes[i] && holes[i].length >= 3 && _ptInRing2D(px, py, holes[i])) return false;
      }
    }
    return true;
  }

  function _bboxOfRing(ring) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
  }

  function _ptSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function _isFootpathRoad(rd) {
    if (!rd) return false;
    if (rd.isPath) return true;
    const rtype = String(rd.hwy || rd.type || rd.rtype || '').toLowerCase();
    return (
      rtype === 'footway' || rtype === 'path' || rtype === 'steps' ||
      rtype === 'cycleway' || rtype === 'bridleway' || rtype === 'track' || rtype === 'corridor'
    );
  }

  function _areTreesAllowed(ctx, scene) {
    const st = (ctx && ctx.state) || {};
    const lv = st.layerVisible || st.layers;
    if (lv && lv.trees === false) return false;
    const lod = st.lodSettings;
    if (lod) {
      if (lod.enableTrees === false) return false;
      const maxKm = lod.treeThresholdKm !== undefined
        ? Number(lod.treeThresholdKm)
        : (lod.treeMaxSpanKm !== undefined ? Number(lod.treeMaxSpanKm) : null);
      if (Number.isFinite(maxKm) && maxKm > 0) {
        const rawSpanM = Number(st.mapSpanMeters) || Number(scene && scene.spanMeters) || 1200;
        const effSpanKm = (rawSpanM * (ctx.effectiveCrop || 1.0)) / 1000.0;
        if (effSpanKm > maxKm + 1e-6) return false;
      }
    }
    return true;
  }

  function buildTreesArchetypeList(mf, ctx, scene, terrainWater, buildingFootprints2D) {
    if (!_areTreesAllowed(ctx, scene)) return [];
    const { halfW, halfH, toBed, latLonToScene, scaleMm, mToU, zScale, scaleToBed, minPrintU, waterCutout } = ctx;

    const CELL = 4.0;
    const polyGrid = new Map();
    const wallSegGrid = new Map();
    const waterSegGrid = new Map();
    const roadSegGrid = new Map();

    const insertGridItem = (grid, minX, minY, maxX, maxY, pad, item) => {
      const x0 = Math.max(-64, Math.floor((minX - pad) / CELL));
      const x1 = Math.min(64, Math.floor((maxX + pad) / CELL));
      const y0 = Math.max(-64, Math.floor((minY - pad) / CELL));
      const y1 = Math.min(64, Math.floor((maxY + pad) / CELL));
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const k = `${gx}_${gy}`;
          let arr = grid.get(k);
          if (!arr) { arr = []; grid.set(k, arr); }
          arr.push(item);
        }
      }
    };

    const indexRingSegs = (grid, ring, extraR, pad) => {
      if (!ring || ring.length < 2) return;
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        const seg = [a[0], a[1], b[0], b[1], extraR];
        insertGridItem(grid, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), pad, seg);
      }
    };

    const maxCrownSearchU = Math.max(1.2, (0.85 + 0.45) / scaleMm);
    const blockedPolys2D = [];
    for (const bf of (buildingFootprints2D || [])) {
      if (!bf || !bf.outer || bf.outer.length < 3) continue;
      if ((bf.minH || 0) < 8.0) {
        blockedPolys2D.push(bf);
        insertGridItem(polyGrid, bf.bb[0], bf.bb[1], bf.bb[2], bf.bb[3], maxCrownSearchU, bf);
        indexRingSegs(wallSegGrid, bf.outer, 0, maxCrownSearchU);
        for (const h of (bf.holes || [])) indexRingSegs(wallSegGrid, h, 0, maxCrownSearchU);
      }
    }

    for (const srcList of [(scene && scene.bridgePolys) || [], (scene && scene.pierPolys) || []]) {
      for (const bp of srcList) {
        if (!bp || bp._inBridgePolys || !bp.outer || bp.outer.length < 3) continue;
        const oBed = bp.outer.map(toBed);
        const hBed = (bp.holes || []).filter(h => h && h.length >= 3).map(h => h.map(toBed));
        const rec = { outer: oBed, holes: hBed, bb: _bboxOfRing(oBed) };
        blockedPolys2D.push(rec);
        insertGridItem(polyGrid, rec.bb[0], rec.bb[1], rec.bb[2], rec.bb[3], maxCrownSearchU, rec);
        indexRingSegs(wallSegGrid, oBed, 0, maxCrownSearchU);
        for (const h of hBed) indexRingSegs(wallSegGrid, h, 0, maxCrownSearchU);
      }
    }

    if (terrainWater && Array.isArray(terrainWater.waterMaskPolys2D)) {
      for (const wp of terrainWater.waterMaskPolys2D) {
        if (!wp || !wp.outer || wp.outer.length < 3) continue;
        indexRingSegs(waterSegGrid, wp.outer, 0, maxCrownSearchU);
        for (const h of (wp.holes || [])) indexRingSegs(waterSegGrid, h, 0, maxCrownSearchU);
      }
    }

    for (const rd of (scene && scene.roads) || []) {
      if (!rd || !rd.pts || rd.pts.length < 2) continue;
      const isBr = Boolean(rd.bridge || rd.isBridge || rd.man_made);
      if (!isBr && _isFootpathRoad(rd)) continue;
      if (!isBr && String(rd.hwy || '').toLowerCase() === 'pedestrian') continue;
      const halfW_u = Math.max(minPrintU * 0.42, ((rd.width || 0.8) * 0.5) * scaleToBed);
      let prev = toBed(rd.pts[0]);
      for (let i = 1; i < rd.pts.length; i++) {
        const curr = toBed(rd.pts[i]);
        const seg = [prev[0], prev[1], curr[0], curr[1], halfW_u];
        insertGridItem(roadSegGrid, Math.min(prev[0], curr[0]), Math.min(prev[1], curr[1]), Math.max(prev[0], curr[0]), Math.max(prev[1], curr[1]), halfW_u + maxCrownSearchU, seg);
        prev = curr;
      }
    }
    for (const pl of (scene && scene.pierLines) || []) {
      if (!pl || !pl.pts || pl.pts.length < 2) continue;
      const halfW_u = Math.max(minPrintU * 0.5, ((pl.width || 0.7) * 0.5) * scaleToBed);
      let prev = toBed(pl.pts[0]);
      for (let i = 1; i < pl.pts.length; i++) {
        const curr = toBed(pl.pts[i]);
        const seg = [prev[0], prev[1], curr[0], curr[1], halfW_u];
        insertGridItem(roadSegGrid, Math.min(prev[0], curr[0]), Math.min(prev[1], curr[1]), Math.max(prev[0], curr[0]), Math.max(prev[1], curr[1]), halfW_u + maxCrownSearchU, seg);
        prev = curr;
      }
    }

    const isInsideBlockedAt = (px, py) => {
      const list = polyGrid.get(`${Math.floor(px / CELL)}_${Math.floor(py / CELL)}`);
      if (!list) return false;
      for (let i = 0; i < list.length; i++) {
        if (_ptInSolidPoly(px, py, list[i])) return true;
      }
      return false;
    };

    const minSegClearance = (grid, px, py) => {
      const list = grid.get(`${Math.floor(px / CELL)}_${Math.floor(py / CELL)}`);
      if (!list) return Infinity;
      let best = Infinity;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const c = _ptSegDist(px, py, s[0], s[1], s[2], s[3]) - s[4];
        if (c < best) best = c;
      }
      return best;
    };

    const shorePadU = (waterCutout ? 0.26 : 0.12) / scaleMm;
    const wallPadU = 0.06 / scaleMm;
    const roadPadU = 0.06 / scaleMm;
    const borderPadU = 0.20 / scaleMm;
    const PCELL = Math.max(1.2, (1.8 / scaleMm));
    const placedGrid = new Map();
    const placedTrees = [];
    const MAX_TREES = 25000;

    const cutXs = Array.isArray(ctx && ctx.cutXs) ? ctx.cutXs : [];
    const cutYs = Array.isArray(ctx && ctx.cutYs) ? ctx.cutYs : [];
    const seamBasePadU = 0.15 / scaleMm;
    const minCutDist = (planes, val) => {
      let best = Infinity;
      for (let i = 0; i < planes.length; i++) {
        const d = Math.abs(val - planes[i]);
        if (d < best) best = d;
      }
      return best;
    };

    const tryAcceptTree = (bx, by, h_m, explicitCrownM = 0) => {
      if (placedTrees.length >= MAX_TREES) return;
      if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
      const hM = Number(h_m) > 0 ? Number(h_m) : 7.5;
      const hU = Math.max(0.85 / scaleMm, Math.min(3.5 / scaleMm, hM * mToU * zScale * scaleToBed));
      const baseDesiredR = explicitCrownM > 0
        ? Math.max(minPrintU * 0.9, Math.min(explicitCrownM * mToU * scaleToBed, 0.85 / scaleMm))
        : Math.max(minPrintU * 0.9, Math.min(hU * 0.42, 0.85 / scaleMm));
      const minCompactR = Math.max(minPrintU * 0.65, Math.min(baseDesiredR, 0.28 / scaleMm));

      if (Math.abs(bx) > halfW - (minCompactR + borderPadU) || Math.abs(by) > halfH - (minCompactR + borderPadU)) return;
      if (terrainWater && (terrainWater.isPointInWater(bx, by) || terrainWater.isPointOnRoad(bx, by))) return;
      if (isInsideBlockedAt(bx, by)) return;

      const minWaterD = minSegClearance(waterSegGrid, bx, by);
      const minWallD = minSegClearance(wallSegGrid, bx, by);
      const minRoadD = minSegClearance(roadSegGrid, bx, by);
      const minSeamDX = minCutDist(cutXs, bx);
      const minSeamDY = minCutDist(cutYs, by);

      const maxGeomR = Math.min(
        baseDesiredR,
        (minWaterD - shorePadU) / 1.04,
        (minWallD - wallPadU) / 1.02,
        (minRoadD - roadPadU) / 1.02,
        (halfW - borderPadU - Math.abs(bx)) / 1.02,
        (halfH - borderPadU - Math.abs(by)) / 1.02,
        (minSeamDX - seamBasePadU) / 1.04,
        (minSeamDY - seamBasePadU) / 1.04
      );
      if (maxGeomR < minCompactR) return;

      const candRadii = [maxGeomR];
      if (maxGeomR - minCompactR > 0.03) candRadii.push((maxGeomR + minCompactR) * 0.5, minCompactR);
      else if (maxGeomR > minCompactR + 1e-4) candRadii.push(minCompactR);

      const gx = Math.floor(bx / PCELL), gy = Math.floor(by / PCELL);
      for (let ri = 0; ri < candRadii.length; ri++) {
        const r = candRadii[ri];
        let collided = false;
        for (let dx = -1; dx <= 1 && !collided; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cell = placedGrid.get(`${gx + dx}_${gy + dy}`);
            if (!cell) continue;
            for (let j = 0; j < cell.length; j++) {
              const o = cell[j];
              if (Math.hypot(bx - o[0], by - o[1]) < (r + o[2]) * 0.72) { collided = true; break; }
            }
          }
        }
        if (collided) continue;

        let envOk = true;
        const envR = r * 1.04 + (waterCutout ? 0.14 / scaleMm : 0.04 / scaleMm);
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) * 0.25;
          const px = bx + Math.cos(a) * envR, py = by + Math.sin(a) * envR;
          if ((terrainWater && terrainWater.isPointInWater(px, py)) || isInsideBlockedAt(px, py)) {
            envOk = false;
            break;
          }
        }
        if (!envOk) continue;

        const key = `${gx}_${gy}`;
        let bucket = placedGrid.get(key);
        if (!bucket) { bucket = []; placedGrid.set(key, bucket); }
        bucket.push([bx, by, r]);
        placedTrees.push([bx, by, hU, r]);
        return;
      }
    };

    for (const t of (scene && scene.trees) || []) {
      if (!t) continue;
      let tx, ty, th = 7.5, crM = 0;
      if (Array.isArray(t) || typeof t[0] === 'number') {
        if (t.length < 2) continue;
        tx = t[0]; ty = t[1]; th = Number(t[2]) || 7.5;
      } else if (typeof t === 'object' && t.x !== undefined && t.y !== undefined) {
        tx = t.x; ty = t.y;
        th = Number(t.height !== undefined ? t.height : (t.h !== undefined ? t.h : 7.5)) || 7.5;
        crM = Number(t.crownRadius || 0) || 0;
      } else {
        continue;
      }
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      const [bx, by] = toBed([tx, ty]);
      tryAcceptTree(bx, by, th, crM);
    }

    const els = (scene && scene.osmElements) || [];
    if (els.length > 0 && ((scene && scene.trees) || []).length === 0) {
      const nodeMap = new Map();
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.type === 'node') {
          nodeMap.set(el.id, el);
          if (el.tags && el.tags.natural === 'tree') {
            const [bx, by] = latLonToScene(el.lat, el.lon);
            tryAcceptTree(bx, by, Number(el.tags.height) || 7.5, 0);
          }
        }
      }
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.type === 'way' && el.tags && el.tags.natural === 'tree_row' && el.nodes) {
          for (const nid of el.nodes) {
            const n = nodeMap.get(nid);
            if (n) {
              const [bx, by] = latLonToScene(n.lat, n.lon);
              tryAcceptTree(bx, by, Number(el.tags.height) || 7.0, 0);
            }
          }
        }
      }
    }

    const greenEmitted = !ctx.state || !ctx.state.layerVisible || ctx.state.layerVisible.greenery !== false;
    const treeSolids = [];
    for (let idx = 0; idx < placedTrees.length; idx++) {
      const [bx, by, hU, crownR] = placedTrees[idx];
      let zGround = terrainWater && typeof terrainWater.getSurfaceZ === 'function'
        ? terrainWater.getSurfaceZ(bx, by)
        : ctx.getTerrainZ(bx, by);
      if (!greenEmitted && terrainWater && terrainWater.isPointInGreen && terrainWater.isPointInGreen(bx, by) && !terrainWater.isPointOnRoad(bx, by)) {
        zGround -= (terrainWater.hGreenU || 0);
      }
      const trunkR = Math.max(minPrintU * 0.35, crownR * 0.28);
      const trunkH = hU * 0.38;
      const crownH = hU * 0.72;

      const trunk = mf.Manifold.cylinder(trunkH + 0.15 / scaleMm, trunkR, trunkR * 0.82, 6, false)
        .translate([bx, by, Math.max(0.05 / scaleMm, zGround - 0.15 / scaleMm)]);
      const crown = mf.Manifold.cylinder(crownH, crownR, crownR * 0.08, 6, false)
        .translate([bx, by, zGround + trunkH - 0.02 / scaleMm]);
      const tree = trunk.add(crown);
      trunk.delete(); crown.delete();
      treeSolids.push({ shellId: idx + 1, manifold: tree });
    }
    return treeSolids;
  }

  const exportsObj = { buildTreesArchetypeList };
  Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
