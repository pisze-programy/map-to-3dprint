// ============================================================================
// src/buildings/s3db_wheel_consolidator.js
// Observation Wheel Complex Union-Find Consolidation & Auxiliary Part Filter
// ============================================================================

(function (root) {
  if (typeof root.parseOsmLengthMetersJS !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./s3db_tag_parser.js'));
  }
  if (typeof root.computeMinAreaOBB2D !== 'function' && typeof require === 'function') {
    try { Object.assign(root, require('../geometry/obb_medial_2d.js')); } catch (_) {}
  }

  function consolidateWheelComplexesS3DB(candidateParents, candidateParts, metersToUnits, addBuildingRecord) {
    const uPerM = (metersToUnits && metersToUnits > 0) ? metersToUnits : 0.125;
    const lvlH = (typeof root.OSM_METRIC_CONFIG !== 'undefined' && root.OSM_METRIC_CONFIG.levelHeightM) || 3.5;
    const wheelAttrSet = root.WHEEL_ATTRACTION_VALS_JS || new Set(['big_wheel', 'observation_wheel', 'ferris_wheel']);
    const parseLen = root.parseOsmLengthMetersJS;
    const parseFlt = root.parseFloatTagJS;

    const extractH = (tags, fallbackH) => {
      if (!tags) return fallbackH || null;
      const hVal = parseLen(tags.height, null) ?? parseLen(tags['building:height'], null) ?? parseLen(tags.est_height, null);
      if (hVal !== null) return hVal;
      const lvls = parseFlt(tags['building:levels'], null);
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
      let cx = (rec.bbox[0] + rec.bbox[2]) * 0.5, cy = (rec.bbox[1] + rec.bbox[3]) * 0.5;
      let major = Math.max(dx, dy), minor = Math.min(dx, dy);
      if (typeof root.computeMinAreaOBB2D === 'function' && rec.pts.length >= 3) {
        const obb = root.computeMinAreaOBB2D(rec.pts);
        if (obb && obb.halfL > 0) {
          cx = obb.cx; cy = obb.cy;
          major = Math.max(1e-4, obb.halfL * 2);
          minor = Math.max(1e-4, obb.halfW * 2);
        }
      }
      const tags = rec.tags || {};
      const exp = wheelAttrSet.has(String(tags.attraction || '').toLowerCase().trim()) ||
        String(tags['tower:type'] || '').toLowerCase().trim() === 'observation_wheel' ||
        wheelAttrSet.has(String(tags.amusement_ride || '').toLowerCase().trim());
      wheelCandidates.push({
        rec, isParent, bbox: rec.bbox, cx, cy, majorSpan: major,
        aspect: major / Math.max(minor, 1e-4), explicitlyTagged: exp,
        hVal: extractH(rec.tags, rec.parentHeightHint),
      });
    };
    for (const p of candidateParents) pushCand(p, true);
    for (const p of candidateParts) pushCand(p, false);

    const emittedWheelComplexes = [];
    if (wheelCandidates.length > 0) {
      const nW = wheelCandidates.length, uf = Int32Array.from({ length: nW }, (_, i) => i);
      const findW = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
      for (let i = 0; i < nW; i++) {
        for (let j = i + 1; j < nW; j++) {
          const wi = wheelCandidates[i], wj = wheelCandidates[j];
          const sameGid = wi.rec.groupId !== null && wi.rec.groupId === wj.rec.groupId;
          if (sameGid ||
              Math.hypot(wi.cx - wj.cx, wi.cy - wj.cy) <= Math.max(95 * uPerM, 0.95 * Math.max(wi.majorSpan, wj.majorSpan)) ||
              overlapsPad(wi.bbox, wj.bbox, 15 * uPerM)) {
            const ra = findW(i), rb = findW(j);
            if (ra !== rb) uf[rb] = ra;
          }
        }
      }
      const compMap = new Map();
      for (let i = 0; i < nW; i++) {
        const r = findW(i);
        if (!compMap.has(r)) compMap.set(r, []);
        compMap.get(r).push(wheelCandidates[i]);
      }
      for (const comp of compMap.values()) {
        let maxMajor = 0, maxH = 0, bestName = '';
        const cbox = [Infinity, Infinity, -Infinity, -Infinity], gids = new Set();
        for (const w of comp) {
          w.rec._wheelConsumed = true;
          if (w.majorSpan > maxMajor) maxMajor = w.majorSpan;
          if (w.hVal && w.hVal > maxH) maxH = w.hVal;
          if (w.rec.allParts) {
            for (const ap of w.rec.allParts) {
              if (ap.part) ap.part._suppressedByWheel = true;
              if (ap.h && ap.h > maxH) maxH = ap.h;
            }
          }
          if (!bestName && w.rec.tags && !w.rec.tags._nameInherited) {
            bestName = w.rec.tags.name || w.rec.tags['name:en'] || w.rec.tags['name:pl'] || '';
          }
          if (w.rec.groupId !== null) gids.add(w.rec.groupId);
          cbox[0] = Math.min(cbox[0], w.bbox[0]); cbox[1] = Math.min(cbox[1], w.bbox[1]);
          cbox[2] = Math.max(cbox[2], w.bbox[2]); cbox[3] = Math.max(cbox[3], w.bbox[3]);
        }
        for (const r of [...candidateParts, ...candidateParents]) {
          if ((r.groupId !== null && gids.has(r.groupId)) ||
              (overlapsPad(r.bbox, cbox, 6 * uPerM) && (r.minH > 3.0 || (extractH(r.tags, 0) || 0) > 25.0))) {
            maxH = Math.max(maxH, extractH(r.tags, r.parentHeightHint) || 0);
          }
        }
        const pool = comp.filter(w => w.majorSpan >= 0.65 * maxMajor);
        const scoreW = w => (w.explicitlyTagged ? 1000 : 0) + Math.min(w.aspect, 30) * 20 + (w.isParent ? 1 : 0);
        const chosen = (pool.length ? pool : comp).sort((a, b) => scoreW(b) - scoreW(a))[0];
        const wTags = { ...chosen.rec.tags, _archTypeOverride: 'ferris_wheel' };
        if (bestName && (!wTags.name || wTags._nameInherited)) {
          wTags.name = bestName;
          delete wTags._nameInherited;
        }
        if (maxH > 0) wTags.height = String(maxH);
        addBuildingRecord(chosen.rec.wid, wTags, chosen.rec.pts, chosen.rec.holes, chosen.rec.groupId ?? chosen.rec.wid, false, chosen.rec.parentHeightHint, null);
        emittedWheelComplexes.push({ bbox: cbox, gids });
      }
    }
    return (rec) => {
      if (rec._wheelConsumed || rec._suppressedByWheel || (rec.groupId !== null && wheelGroupIds.has(rec.groupId))) return true;
      return emittedWheelComplexes.some(wc => (rec.groupId !== null && wc.gids.has(rec.groupId)) ||
        (overlapsPad(rec.bbox, wc.bbox, 6 * uPerM) && (rec.minH > 3.0 || (extractH(rec.tags, 0) || 0) > 25.0)));
    };
  }

  const exportsObj = { consolidateWheelComplexesS3DB };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
