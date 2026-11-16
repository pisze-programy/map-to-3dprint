// ============================================================================
// src/gis_client/s3db_relation_helper.js
// Hole-Aware S3DB Geometric Containment, Interior Point & Wheel Consolidation
// ============================================================================

if (typeof parseOsmLengthMetersJS === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('./s3db_unit_parser.js')); } catch (_) {}
}
if (typeof computeMinAreaOBB2D === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('../geometry/obb_medial_2d.js')); } catch (_) {}
}

function _polyAreaSignedS3DB(pts) {
  if (!pts || pts.length < 3) return 0;
  if (typeof polyAreaSignedJS === 'function') return polyAreaSignedJS(pts);
  let area = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area * 0.5;
}

function _pointInPolyS3DB(px, py, poly) {
  if (!poly || poly.length < 3) return false;
  if (typeof pointInPolyLocal === 'function') return pointInPolyLocal(px, py, poly);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

function _pointInAnyHoleS3DB(px, py, holes) {
  if (!holes || !holes.length) return false;
  for (let h = 0; h < holes.length; h++) {
    if (holes[h] && holes[h].length >= 3 && _pointInPolyS3DB(px, py, holes[h])) return true;
  }
  return false;
}

function _minBoundaryDistSqS3DB(px, py, outerPts, holesPts) {
  let minDSq = Infinity;
  const checkRing = (ring) => {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
      const dSq = (px - (a[0] + t * dx)) ** 2 + (py - (a[1] + t * dy)) ** 2;
      if (dSq < minDSq) minDSq = dSq;
    }
  };
  checkRing(outerPts);
  for (const h of (holesPts || [])) if (h && h.length >= 3) checkRing(h);
  return minDSq;
}

function computeSolidInteriorPtJS(outerPts, holesPts) {
  if (!outerPts || outerPts.length === 0) return [0, 0];
  let sx = 0, sy = 0, minY = Infinity, maxY = -Infinity;
  for (const p of outerPts) { sx += p[0]; sy += p[1]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const cx = sx / outerPts.length, cy = sy / outerPts.length;
  const holes = (holesPts || []).filter(h => h && h.length >= 3);
  if (_pointInPolyS3DB(cx, cy, outerPts) && !_pointInAnyHoleS3DB(cx, cy, holes) && _minBoundaryDistSqS3DB(cx, cy, outerPts, holes) > 1e-6) {
    return [cx, cy];
  }
  const ys = [];
  for (const p of outerPts) ys.push(p[1]);
  for (const h of holes) for (const p of h) ys.push(p[1]);
  ys.sort((a, b) => a - b);
  const yMids = [];
  for (let i = 0; i < ys.length - 1; i++) if (ys[i + 1] - ys[i] > 1e-5) yMids.push((ys[i] + ys[i + 1]) * 0.5);
  if (maxY - minY > 1e-5) for (let k = 1; k <= 7; k++) yMids.push(minY + (maxY - minY) * (k / 8));
  const scanYs = yMids.length <= 28 ? yMids : Array.from({ length: 28 }, (_, idx) => yMids[Math.floor((idx * yMids.length) / 28)]);

  let bestPt = null, bestScore = -1;
  const collectHits = (ring, yScan, xs) => {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      if ((a[1] > yScan) !== (b[1] > yScan)) xs.push(a[0] + (yScan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
  };
  for (const yScan of scanYs) {
    const xs = [];
    collectHits(outerPts, yScan, xs);
    for (const h of holes) collectHits(h, yScan, xs);
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k < xs.length - 1; k++) {
      const w = xs[k + 1] - xs[k];
      if (w <= 1e-5) continue;
      const xm = (xs[k] + xs[k + 1]) * 0.5;
      if (_pointInPolyS3DB(xm, yScan, outerPts) && !_pointInAnyHoleS3DB(xm, yScan, holes)) {
        const score = Math.min(w * 0.5, Math.sqrt(_minBoundaryDistSqS3DB(xm, yScan, outerPts, holes)));
        if (score > bestScore) { bestScore = score; bestPt = [xm, yScan]; }
      }
    }
  }
  if (bestPt) return bestPt;
  const sign = _polyAreaSignedS3DB(outerPts) >= 0 ? 1 : -1;
  for (let i = 0, n = outerPts.length; i < n; i++) {
    const a = outerPts[i], b = outerPts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len > 1e-5) {
      const step = Math.min(1e-3, len * 0.05);
      const px = (a[0] + b[0]) * 0.5 + (-dy / len) * sign * step, py = (a[1] + b[1]) * 0.5 + (dx / len) * sign * step;
      if (_pointInPolyS3DB(px, py, outerPts) && !_pointInAnyHoleS3DB(px, py, holes)) return [px, py];
    }
  }
  return [outerPts[0][0], outerPts[0][1]];
}

function computeRecordMetricsM(pts, mToU) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  const effMToU = Math.max(1e-4, mToU);
  let rawMinSpanM = Math.min(maxX - minX, maxY - minY) / effMToU;
  let rawMaxSpanM = Math.max(maxX - minX, maxY - minY) / effMToU;
  if (typeof computeMinAreaOBB2D === 'function' && pts.length >= 3) {
    const obb = computeMinAreaOBB2D(pts);
    if (obb && obb.halfL > 0) {
      rawMinSpanM = (obb.halfW * 2) / effMToU;
      rawMaxSpanM = (obb.halfL * 2) / effMToU;
    }
  }
  const areaU = Math.abs(_polyAreaSignedS3DB(pts));
  return { minX, maxX, minY, maxY, rawMinSpanM, rawMaxSpanM, areaU, areaM2: areaU / (effMToU * effMToU) };
}

function isPartEnclosedByParentS3DB(part, parent) {
  const [pix, piy] = part.interiorPt;
  if (_pointInAnyHoleS3DB(pix, piy, parent.holes)) return false;
  if (_pointInPolyS3DB(pix, piy, parent.pts)) return true;
  let inCnt = 0, totalSamples = 0;
  const pts = part.pts, nPts = pts.length;
  for (let k = 0; k < nPts; k++) {
    const a = pts[k], b = pts[(k + 1) % nPts];
    const samples = [
      [a[0] + (pix - a[0]) * 1e-3, a[1] + (piy - a[1]) * 1e-3],
      [(a[0] + b[0]) * 0.5 + (pix - (a[0] + b[0]) * 0.5) * 1e-3, (a[1] + b[1]) * 0.5 + (piy - (a[1] + b[1]) * 0.5) * 1e-3],
    ];
    for (const [sx, sy] of samples) {
      totalSamples++;
      if (_pointInPolyS3DB(sx, sy, parent.pts) && !_pointInAnyHoleS3DB(sx, sy, parent.holes)) inCnt++;
    }
  }
  return totalSamples > 0 && inCnt >= totalSamples * 0.55;
}

function consolidateWheelComplexesS3DB(candidateParents, candidateParts, metersToUnits, addBuildingRecord) {
  const uPerM = (metersToUnits && metersToUnits > 0) ? metersToUnits : 0.125;
  const lvlH = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.levelHeightM : 3.5;
  const extractH = (tags, fallbackH) => {
    if (!tags) return fallbackH || null;
    const hVal = parseOsmLengthMetersJS(tags.height, null) ?? parseOsmLengthMetersJS(tags['building:height'], null) ?? parseOsmLengthMetersJS(tags.est_height, null);
    if (hVal !== null) return hVal;
    const lvls = parseFloatTagJS(tags['building:levels'], null);
    return lvls !== null ? lvls * lvlH : (fallbackH || null);
  };
  const overlapsPad = (a, b, pad) => a[0] <= b[2] + pad && a[2] >= b[0] - pad && a[1] <= b[3] + pad && a[3] >= b[1] - pad;
  const wheelCandidates = [], wheelGroupIds = new Set();

  const pushCand = (rec, isParent) => {
    if (!rec.isFerrisWheel) return;
    if (rec.groupId !== null) wheelGroupIds.add(rec.groupId);
    if (isParent) {
      if (rec.wid != null && rec.fromBuildingRel) wheelGroupIds.add(rec.wid);
      for (const ap of rec.allParts) if (ap.part) ap.part._suppressedByWheel = true;
    }
    const dx = Math.max(1e-4, rec.bbox[2] - rec.bbox[0]), dy = Math.max(1e-4, rec.bbox[3] - rec.bbox[1]);
    let cx = (rec.bbox[0] + rec.bbox[2]) * 0.5, cy = (rec.bbox[1] + rec.bbox[3]) * 0.5, major = Math.max(dx, dy), minor = Math.min(dx, dy);
    if (typeof computeMinAreaOBB2D === 'function' && rec.pts.length >= 3) {
      const obb = computeMinAreaOBB2D(rec.pts);
      if (obb && obb.halfL > 0) { cx = obb.cx; cy = obb.cy; major = Math.max(1e-4, obb.halfL * 2); minor = Math.max(1e-4, obb.halfW * 2); }
    }
    const tags = rec.tags || {};
    const exp = WHEEL_ATTRACTION_VALS_JS.has(String(tags.attraction || '').toLowerCase().trim()) ||
      String(tags['tower:type'] || '').toLowerCase().trim() === 'observation_wheel' ||
      WHEEL_ATTRACTION_VALS_JS.has(String(tags.amusement_ride || '').toLowerCase().trim());
    wheelCandidates.push({ rec, isParent, bbox: rec.bbox, cx, cy, majorSpan: major, aspect: major / Math.max(minor, 1e-4), explicitlyTagged: exp, hVal: extractH(rec.tags, rec.parentHeightHint) });
  };
  for (const p of candidateParents) pushCand(p, true);
  for (const p of candidateParts) pushCand(p, false);

  const emittedWheelComplexes = [];
  if (wheelCandidates.length > 0) {
    const nW = wheelCandidates.length, uf = Int32Array.from({ length: nW }, (_, i) => i);
    const findW = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    for (let i = 0; i < nW; i++) for (let j = i + 1; j < nW; j++) {
      const wi = wheelCandidates[i], wj = wheelCandidates[j];
      const sameGid = wi.rec.groupId !== null && wi.rec.groupId === wj.rec.groupId;
      if (sameGid || Math.hypot(wi.cx - wj.cx, wi.cy - wj.cy) <= Math.max(95 * uPerM, 0.95 * Math.max(wi.majorSpan, wj.majorSpan)) || overlapsPad(wi.bbox, wj.bbox, 15 * uPerM)) {
        const ra = findW(i), rb = findW(j); if (ra !== rb) uf[rb] = ra;
      }
    }
    const compMap = new Map();
    for (let i = 0; i < nW; i++) { const r = findW(i); if (!compMap.has(r)) compMap.set(r, []); compMap.get(r).push(wheelCandidates[i]); }
    for (const comp of compMap.values()) {
      let maxMajor = 0, maxH = 0, bestName = '';
      const cbox = [Infinity, Infinity, -Infinity, -Infinity], gids = new Set();
      for (const w of comp) {
        w.rec._wheelConsumed = true;
        if (w.majorSpan > maxMajor) maxMajor = w.majorSpan;
        if (w.hVal && w.hVal > maxH) maxH = w.hVal;
        if (w.rec.allParts) for (const ap of w.rec.allParts) { if (ap.part) ap.part._suppressedByWheel = true; if (ap.h && ap.h > maxH) maxH = ap.h; }
        if (!bestName && w.rec.tags && !w.rec.tags._nameInherited) bestName = w.rec.tags.name || w.rec.tags['name:en'] || w.rec.tags['name:pl'] || '';
        if (w.rec.groupId !== null) gids.add(w.rec.groupId);
        cbox[0] = Math.min(cbox[0], w.bbox[0]); cbox[1] = Math.min(cbox[1], w.bbox[1]);
        cbox[2] = Math.max(cbox[2], w.bbox[2]); cbox[3] = Math.max(cbox[3], w.bbox[3]);
      }
      for (const r of [...candidateParts, ...candidateParents]) {
        if ((r.groupId !== null && gids.has(r.groupId)) || (overlapsPad(r.bbox, cbox, 6 * uPerM) && (r.minH > 3.0 || (extractH(r.tags, 0) || 0) > 25.0))) {
          maxH = Math.max(maxH, extractH(r.tags, r.parentHeightHint) || 0);
        }
      }
      const pool = comp.filter(w => w.majorSpan >= 0.65 * maxMajor);
      const chosen = (pool.length ? pool : comp).sort((a, b) => ((b.explicitlyTagged ? 1000 : 0) + Math.min(b.aspect, 30) * 20 + (b.isParent ? 1 : 0)) - ((a.explicitlyTagged ? 1000 : 0) + Math.min(a.aspect, 30) * 20 + (a.isParent ? 1 : 0)))[0];
      const wTags = { ...chosen.rec.tags, _archTypeOverride: 'ferris_wheel' };
      if (bestName && (!wTags.name || wTags._nameInherited)) { wTags.name = bestName; delete wTags._nameInherited; }
      if (maxH > 0) wTags.height = String(maxH);
      addBuildingRecord(chosen.rec.wid, wTags, chosen.rec.pts, chosen.rec.holes, chosen.rec.groupId ?? chosen.rec.wid, false, chosen.rec.parentHeightHint, null);
      emittedWheelComplexes.push({ bbox: cbox, gids });
    }
  }
  return (rec) => {
    if (rec._wheelConsumed || rec._suppressedByWheel || (rec.groupId !== null && wheelGroupIds.has(rec.groupId))) return true;
    return emittedWheelComplexes.some(wc => (rec.groupId !== null && wc.gids.has(rec.groupId)) || (overlapsPad(rec.bbox, wc.bbox, 6 * uPerM) && (rec.minH > 3.0 || (extractH(rec.tags, 0) || 0) > 25.0)));
  };
}

const _s3dbRelExports = {
  _polyAreaSignedS3DB, _pointInPolyS3DB, _pointInAnyHoleS3DB, _minBoundaryDistSqS3DB,
  computeSolidInteriorPtJS, computeRecordMetricsM, isPartEnclosedByParentS3DB, consolidateWheelComplexesS3DB,
};
if (typeof window !== 'undefined') Object.assign(window, _s3dbRelExports);
if (typeof module !== 'undefined' && module.exports) module.exports = _s3dbRelExports;
