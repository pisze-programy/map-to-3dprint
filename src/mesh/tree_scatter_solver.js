// ============================================================================
// src/mesh/tree_scatter_solver.js
// Deterministic Tree & Tree-Row Scattering Outside Buildings, Roads, Water & Bridges
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

  function _bboxOfRing(ring) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
  }

  function buildTreesArchetypeList(mf, ctx, scene, terrainWater, buildingFootprints2D) {
    const { halfW, halfH, toBed, latLonToScene, scaleMm, mToU, zScale, scaleToBed, minPrintU } = ctx;
    const treePts = [];
    const seenKeys = new Set();

    const blockedPolys2D = buildingFootprints2D.slice();
    for (const bp of (scene && scene.bridgePolys) || []) {
      if (!bp || !bp.outer || bp.outer.length < 3) continue;
      const oBed = bp.outer.map(toBed);
      blockedPolys2D.push({ outer: oBed, bb: _bboxOfRing(oBed) });
    }

    const isInsideBlocked = (bx, by) => {
      for (let i = 0; i < blockedPolys2D.length; i++) {
        const bp = blockedPolys2D[i];
        if (bx < bp.bb[0] || bx > bp.bb[2] || by < bp.bb[1] || by > bp.bb[3]) continue;
        if (_ptInRing2D(bx, by, bp.outer)) return true;
      }
      return false;
    };

    const pushTreePt = (bx, by, h_m) => {
      if (!Number.isFinite(bx) || !Number.isFinite(by)) return;
      if (Math.abs(bx) > halfW - 0.1 || Math.abs(by) > halfH - 0.1) return;
      const key = `${Math.round(bx * 20)},${Math.round(by * 20)}`;
      if (seenKeys.has(key)) return;
      if (terrainWater && (terrainWater.isPointInWater(bx, by) || terrainWater.isPointOnRoad(bx, by))) return;
      if (isInsideBlocked(bx, by)) return;
      seenKeys.add(key);
      treePts.push([bx, by, h_m || 7.5]);
    };

    for (const t of (scene && scene.trees) || []) {
      if (!t) continue;
      let tx, ty, th = 7.5;
      if (Array.isArray(t) || typeof t[0] === 'number') {
        if (t.length < 2) continue;
        tx = t[0]; ty = t[1]; th = Number(t[2]) || 7.5;
      } else if (typeof t === 'object' && t.x !== undefined && t.y !== undefined) {
        tx = t.x; ty = t.y; th = Number(t.height !== undefined ? t.height : (t.h !== undefined ? t.h : 7.5)) || 7.5;
      } else {
        continue;
      }
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      const [bx, by] = toBed([tx, ty]);
      pushTreePt(bx, by, th);
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
            pushTreePt(bx, by, Number(el.tags.height) || 7.5);
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
              pushTreePt(bx, by, Number(el.tags.height) || 7.0);
            }
          }
        }
      }
    }

    // Deterministic sub-sampling keeps dense urban parks bounded without layout drift
    const maxTrees = 1200;
    const step = treePts.length > maxTrees ? (treePts.length / maxTrees) : 1;
    const treeSolids = [];
    const emitCount = treePts.length > maxTrees ? maxTrees : treePts.length;

    for (let idx = 0; idx < emitCount; idx++) {
      const src = treePts[Math.floor(idx * step)];
      const [bx, by, hM] = src;
      const zGround = terrainWater && typeof terrainWater.getSurfaceZ === 'function'
        ? terrainWater.getSurfaceZ(bx, by)
        : ctx.getTerrainZ(bx, by);
      const hU = Math.max(0.85 / scaleMm, Math.min(3.5 / scaleMm, hM * mToU * zScale * scaleToBed));
      const crownR = Math.max(minPrintU * 0.9, Math.min(hU * 0.42, 0.85 / scaleMm));
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
