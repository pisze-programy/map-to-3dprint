// ============================================================================
// src/buildings/s3db_outline_suppressor.js
// S3DB Parent Outline Suppression Solver & Orphan Multi-Tier Part Clustering
// ============================================================================

(function (root) {
  if (typeof root.parseOsmLengthMetersJS !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./s3db_tag_parser.js'));
  }
  if (typeof root._pointInPolyS3DB !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./s3db_containment_2d.js'));
  }
  if (typeof root.computeGroundPartsUnionCoverage2D !== 'function' && typeof require === 'function') {
    try { Object.assign(root, require('../geometry/polygon_2d.js')); } catch (_) {}
  }

  function _fallbackPartsCoverageS3DB(outer, holes, partEntries) {
    if (!outer || outer.length < 3 || !partEntries || partEntries.length === 0) return 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of outer) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const dx = maxX - minX, dy = maxY - minY;
    if (dx < 1e-8 || dy < 1e-8) return 0;
    const N = 14;
    let parentHits = 0, coveredHits = 0;
    for (let iy = 0; iy < N; iy++) {
      const py = minY + ((iy + 0.5) / N) * dy;
      for (let ix = 0; ix < N; ix++) {
        const px = minX + ((ix + 0.5) / N) * dx;
        if (!root._pointInPolyS3DB(px, py, outer) || root._pointInAnyHoleS3DB(px, py, holes)) continue;
        parentHits++;
        for (const pe of partEntries) {
          const po = pe.outer || (pe.part && pe.part.pts);
          const ph = pe.holes || (pe.part && pe.part.holes);
          if (po && root._pointInPolyS3DB(px, py, po) && !root._pointInAnyHoleS3DB(px, py, ph)) {
            coveredHits++;
            break;
          }
        }
      }
    }
    return parentHits > 0 ? (coveredHits / parentHits) : 0;
  }

  function _computeMedianGroundCap(groundPartHeights) {
    if (!groundPartHeights || groundPartHeights.length === 0) return null;
    const sortedH = groundPartHeights.slice().sort((a, b) => a - b);
    const medH = sortedH[sortedH.length >> 1];
    return medH >= 6.0 ? medH : null;
  }

  function _resolvePartHeightM(pe, lvlHM) {
    if (pe && Number.isFinite(pe.h) && pe.h > 0) return pe.h;
    const p = (pe && pe.part) ? pe.part : pe;
    const tags = (p && p.tags) || {};
    const expH = root.parseOsmLengthMetersJS(tags.height, null)
      ?? root.parseOsmLengthMetersJS(tags['building:height'], null)
      ?? root.parseOsmLengthMetersJS(tags.est_height, null);
    if (expH !== null && expH > 0) return expH;
    const lvls = root.parseFloatTagJS(tags['building:levels'], null);
    if (lvls !== null && lvls > 0) return lvls * lvlHM;
    const roofH = root.parseOsmLengthMetersJS(tags['roof:height'], null);
    const minH = Number((pe && pe.minH !== undefined) ? pe.minH : (p && p.minH)) || 0;
    if (roofH !== null && roofH > 0) return minH + roofH;
    return minH > 0 ? (minH + 8.0) : 10.0;
  }

  function evaluateParentOutlineSuppressionS3DB(parent, evalCov) {
    if (!parent) return { suppress: false, maxDefaultHeightCap: null };
    if (parent.isGroupingOnlyOutline) return { suppress: true, maxDefaultHeightCap: null };
    if (!parent.hasParts || parent.partCount < 1) return { suppress: false, maxDefaultHeightCap: null };

    const tags = parent.tags || {};
    const bpRaw = String(tags['building:part'] || '').toLowerCase().trim();
    const skipSet = root.SKIP_BUILDING_VALS_JS || new Set(['no', 'none', 'construction']);
    const hasExplicitPartNo = bpRaw === 'no' || bpRaw === 'none';
    const hasExplicitPartYes = Boolean(bpRaw && !hasExplicitPartNo && !skipSet.has(bpRaw));

    if (hasExplicitPartNo) return { suppress: true, maxDefaultHeightCap: null };
    if (parent.fromBuildingRel && !hasExplicitPartYes) return { suppress: true, maxDefaultHeightCap: null };

    const lvlHM = (typeof root.OSM_METRIC_CONFIG !== 'undefined' && root.OSM_METRIC_CONFIG.levelHeightM) || 3.5;
    const parExpH = root.parseOsmLengthMetersJS(tags.height, null)
      ?? root.parseOsmLengthMetersJS(tags['building:height'], null)
      ?? root.parseOsmLengthMetersJS(tags.est_height, null);
    const parLvls = parExpH === null ? root.parseFloatTagJS(tags['building:levels'], null) : null;
    const parH = parExpH !== null ? parExpH : (parLvls !== null ? parLvls * lvlHM : 18.0);

    const covFn = typeof evalCov === 'function'
      ? evalCov
      : ((outer, holes, list) => (typeof root.computeGroundPartsUnionCoverage2D === 'function'
        ? root.computeGroundPartsUnionCoverage2D(outer, holes, list)
        : _fallbackPartsCoverageS3DB(outer, holes, list)));

    const groundParts = parent.groundParts || [];
    const allParts = parent.allParts || [];
    const groundCov = groundParts.length > 0 ? covFn(parent.pts, parent.holes, groundParts) : 0;
    const allCov = (parent.partCount >= 2 || groundParts.length === 0)
      ? covFn(parent.pts, parent.holes, allParts)
      : groundCov;

    let maxPartH = 0, minGroundPartH = Infinity, minElevatedMinH = Infinity;
    for (let i = 0; i < allParts.length; i++) {
      const pe = allParts[i];
      const p = (pe && pe.part) ? pe.part : pe;
      const pMinH = Number((pe && pe.minH !== undefined) ? pe.minH : (p && p.minH)) || 0;
      const ph = _resolvePartHeightM(pe, lvlHM);
      if (ph > maxPartH) maxPartH = ph;
      if (pMinH <= 1.5) {
        if (ph > 1.5 && ph < minGroundPartH) minGroundPartH = ph;
      } else if (pMinH < minElevatedMinH) {
        minElevatedMinH = pMinH;
      }
    }
    const hasElevatedTier = Number.isFinite(minElevatedMinH);

    if (hasExplicitPartYes) {
      if (groundCov >= 0.78 || (groundCov >= 0.68 && (parH >= maxPartH * 0.80 || minGroundPartH <= parH * 1.08))) {
        return { suppress: true, maxDefaultHeightCap: null };
      }
      return { suppress: false, maxDefaultHeightCap: null };
    }

    if (groundParts.length === 0) {
      if (allCov >= 0.68 && minElevatedMinH < parH * 0.58) {
        return { suppress: true, maxDefaultHeightCap: null };
      }
      return { suppress: false, maxDefaultHeightCap: null };
    }

    if ((parExpH !== null || parLvls !== null) && parH >= 28.0 && maxPartH < 75.0 && maxPartH < parH * 0.42) {
      return { suppress: false, maxDefaultHeightCap: null };
    }

    if (parH <= 22.0 && minGroundPartH > parH * 1.30 && groundCov < 0.75) {
      return { suppress: false, maxDefaultHeightCap: null };
    }

    if (groundCov >= 0.62 || (parent.partCount >= 2 && allCov >= 0.62)) {
      return { suppress: true, maxDefaultHeightCap: null };
    }

    if ((parExpH !== null || parLvls !== null) && parH >= 40.0 && parH >= maxPartH * 0.70 &&
        parent.partCount >= 2 && allCov >= 0.35) {
      return { suppress: true, maxDefaultHeightCap: null };
    }

    return {
      suppress: false,
      maxDefaultHeightCap: groundCov > 0 ? _computeMedianGroundCap(parent.groundPartHeights) : null,
    };
  }

  function _orphanPartsOverlap2D(a, b) {
    const [aix, aiy] = a.interiorPt || root.computeSolidInteriorPtJS(a.pts, a.holes);
    const [bix, biy] = b.interiorPt || root.computeSolidInteriorPtJS(b.pts, b.holes);
    if (root._pointInPolyS3DB(aix, aiy, b.pts) && !root._pointInAnyHoleS3DB(aix, aiy, b.holes)) return true;
    if (root._pointInPolyS3DB(bix, biy, a.pts) && !root._pointInAnyHoleS3DB(bix, biy, a.holes)) return true;
    if (root.isPartEnclosedByParentS3DB(a, b) || root.isPartEnclosedByParentS3DB(b, a)) return true;
    for (let i = 0; i < a.pts.length; i++) {
      const pt = a.pts[i];
      if (root._pointInPolyS3DB(pt[0], pt[1], b.pts) && !root._pointInAnyHoleS3DB(pt[0], pt[1], b.holes)) return true;
    }
    for (let i = 0; i < b.pts.length; i++) {
      const pt = b.pts[i];
      if (root._pointInPolyS3DB(pt[0], pt[1], a.pts) && !root._pointInAnyHoleS3DB(pt[0], pt[1], a.holes)) return true;
    }
    return false;
  }

  function groupOrphanBuildingPartsS3DB(candidateParts) {
    if (!Array.isArray(candidateParts) || candidateParts.length < 2) return;
    const orphans = [];
    for (let i = 0; i < candidateParts.length; i++) {
      const p = candidateParts[i];
      if (p && p._hadParent === false && p.groupId === p.wid && p.pts && p.pts.length >= 3) orphans.push(p);
    }
    const n = orphans.length;
    if (n < 2) return;

    const CELL = 4.0;
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const [x0, y0, x1, y1] = orphans[i].bbox;
      const gx0 = Math.floor(x0 / CELL), gx1 = Math.floor(x1 / CELL);
      const gy0 = Math.floor(y0 / CELL), gy1 = Math.floor(y1 / CELL);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const ck = `${gx}:${gy}`;
          let bucket = grid.get(ck);
          if (!bucket) { bucket = []; grid.set(ck, bucket); }
          bucket.push(i);
        }
      }
    }

    const uf = Int32Array.from({ length: n }, (_, i) => i);
    const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const seen = new Int32Array(n);
    let stamp = 0;

    for (let i = 0; i < n; i++) {
      const a = orphans[i];
      const [ax0, ay0, ax1, ay1] = a.bbox;
      const gx0 = Math.floor(ax0 / CELL), gx1 = Math.floor(ax1 / CELL);
      const gy0 = Math.floor(ay0 / CELL), gy1 = Math.floor(ay1 / CELL);
      const tok = ++stamp;
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const bucket = grid.get(`${gx}:${gy}`);
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const j = bucket[bi];
            if (j <= i || seen[j] === tok) continue;
            seen[j] = tok;
            const b = orphans[j];
            if (ax0 > b.bbox[2] + 0.05 || ax1 < b.bbox[0] - 0.05 || ay0 > b.bbox[3] + 0.05 || ay1 < b.bbox[1] - 0.05) continue;
            if (_orphanPartsOverlap2D(a, b)) {
              const ra = find(i), rb = find(j);
              if (ra !== rb) uf[rb] = ra;
            }
          }
        }
      }
    }

    const comps = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let list = comps.get(r);
      if (!list) { list = []; comps.set(r, list); }
      list.push(orphans[i]);
    }
    for (const members of comps.values()) {
      if (members.length < 2) continue;
      const anchor = members.reduce((best, cur) => (((cur.minH || 0) <= 1.5 && (best.minH || 0) > 1.5) || (cur.area > best.area && ((cur.minH || 0) <= 1.5) === ((best.minH || 0) <= 1.5)) ? cur : best), members[0]);
      const sharedGid = anchor.wid;
      let bestName = '';
      for (const m of members) {
        const nm = m.tags && !m.tags._nameInherited ? (m.tags.name || m.tags['name:en'] || m.tags['name:pl'] || '') : '';
        if (nm) { bestName = nm; break; }
      }
      for (const m of members) {
        m.groupId = sharedGid;
        if (bestName && m.tags && !m.tags.name) {
          m.tags.name = bestName;
          m.tags._nameInherited = true;
        }
      }
    }
  }

  const exportsObj = {
    _fallbackPartsCoverageS3DB,
    evaluateParentOutlineSuppressionS3DB,
    groupOrphanBuildingPartsS3DB,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
