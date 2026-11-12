// ============================================================================
// src/gis_client/osm_buildings_extract.js
// OSM S3DB Buildings Extractor (Relation Pass 1B, Multipolygon Outer/Inner Pairing,
// Standalone Building Ways & Minimum Footprint Filtering)
// ============================================================================

if (typeof SKIP_BUILDING_VALS_JS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}

function _bldPolyAreaAbsJS(pts) {
  if (!pts || pts.length < 3) return 0;
  if (typeof polyAreaSignedJS === 'function') return Math.abs(polyAreaSignedJS(pts));
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) * 0.5;
}

function _bldPointInPolyJS(px, py, poly) {
  if (!poly || poly.length < 3) return false;
  if (typeof pointInPolyLocal === 'function') return pointInPolyLocal(px, py, poly);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Pairs each inner hole ring exclusively with its minimal-area enclosing outer ring.
// Handles multi-outer multipolygons AND islands-inside-courtyard-holes cleanly.
function pairMultipolygonHolesForOutersJS(outerPolys, innerPolys) {
  if (!outerPolys || outerPolys.length === 0) return [];
  const holesPerOuter = outerPolys.map(() => []);
  if (!innerPolys || innerPolys.length === 0) return holesPerOuter;

  const outerAreas = outerPolys.map(op => _bldPolyAreaAbsJS(op));
  const outerBboxes = outerPolys.map(op => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < op.length; i++) {
      const p = op[i];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
  });

  for (let hi = 0; hi < innerPolys.length; hi++) {
    const hole = innerPolys[hi];
    if (!hole || hole.length < 3) continue;
    const hArea = _bldPolyAreaAbsJS(hole);
    if (hArea < 1e-6) continue;

    const probePt = (typeof computeSolidInteriorPtJS === 'function')
      ? computeSolidInteriorPtJS(hole, [])
      : hole[0];

    let bestOuterIdx = -1;
    let bestOuterArea = Infinity;

    for (let oi = 0; oi < outerPolys.length; oi++) {
      const oArea = outerAreas[oi];
      if (oArea <= hArea * 1.0001 || oArea >= bestOuterArea) continue;
      const [minX, minY, maxX, maxY] = outerBboxes[oi];
      if (probePt[0] < minX - 0.25 || probePt[0] > maxX + 0.25 || probePt[1] < minY - 0.25 || probePt[1] > maxY + 0.25) continue;

      const op = outerPolys[oi];
      let contained = _bldPointInPolyJS(probePt[0], probePt[1], op) || _bldPointInPolyJS(hole[0][0], hole[0][1], op);
      if (!contained) {
        // Fallback when hole[0] shares a node or grazes a simplified outer edge: check sampled edge midpoints
        const step = Math.max(1, Math.floor(hole.length / 8));
        let tested = 0, insideCnt = 0;
        for (let k = 0; k < hole.length; k += step) {
          const pA = hole[k], pB = hole[(k + 1) % hole.length];
          tested++;
          if (_bldPointInPolyJS((pA[0] + pB[0]) * 0.5, (pA[1] + pB[1]) * 0.5, op)) insideCnt++;
        }
        if (tested > 0 && insideCnt >= Math.ceil(tested * 0.6)) contained = true;
      }

      if (contained) {
        bestOuterArea = oArea;
        bestOuterIdx = oi;
      }
    }

    if (bestOuterIdx >= 0) {
      holesPerOuter[bestOuterIdx].push(hole);
    }
  }

  return holesPerOuter;
}

function collectOsmBuildingSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allBldCandidates) {
  if (wt.building && wn.length >= 4 && wn[0] === wn[wn.length - 1] && !isBrWay && !isTunWay) {
    const bVal = String(wt.building).toLowerCase();
    const mmVal = String(wt.man_made || '').toLowerCase();
    const locVal = String(wt.location || '').toLowerCase();
    const histVal = String(wt.historic || '').toLowerCase();
    if (
      !['pier', 'bridge', 'boathouse', 'houseboat', 'floating_home', 'roof', 'digester', 'ship', 'boat', 'vessel', 'barge'].includes(bVal) &&
      !['pier', 'bridge', 'breakwater', 'groyne', 'quay', 'jetty', 'wharf', 'dolphin'].includes(mmVal) &&
      !['underground', 'underwater', 'overwater'].includes(locVal) &&
      !['ship', 'wreck', 'aircraft'].includes(histVal) &&
      !wt['seamark:type'] &&
      wt.floating !== 'yes'
    ) {
      const p0 = nodes.get(wn[0]);
      const pMid = nodes.get(wn[wn.length >> 1]) || p0;
      if (p0 && pMid) {
        const mx = (p0[0] + pMid[0]) * 0.5;
        const my = (p0[1] + pMid[1]) * 0.5;
        if (Math.abs(mx) <= fetchHalfW && Math.abs(my) <= fetchHalfH) {
          allBldCandidates.push([mx, my]);
        }
      }
    }
    return true;
  }
  return false;
}

function processOsmS3DBRelationsPass1BJS(ctx) {
  const { relations, ways, relById, stitchedRelPolys, nodesToPts, consumedRels, usedWays, s3db } = ctx;

  for (const rel of relations) {
    const tags = rel.tags || {};
    const members = rel.members || [];
    const hasPartOrOutline = members.some(m => m.role === 'part' || m.role === 'outline');
    if (tags.type === 'building' || hasPartOrOutline) {
      if (isUndergroundOrSkippedBuildingJS(tags)) {
        consumedRels.add(rel.id);
        for (const m of members) {
          if (m.type === 'way') usedWays.add(m.ref);
          else if (m.type === 'relation') consumedRels.add(m.ref);
        }
        continue;
      }
      const partWays = [], partRels = [], outlineWays = [], outlineRels = [];
      for (const m of members) {
        const role = m.role || '';
        if (role === 'part') {
          if (m.type === 'way' && ways.has(m.ref)) partWays.push(m.ref);
          else if (m.type === 'relation' && relById.has(m.ref)) partRels.push(m.ref);
        } else if (role === 'outline' || role === 'outer' || role === '') {
          if (m.type === 'way' && ways.has(m.ref)) outlineWays.push(m.ref);
          else if (m.type === 'relation' && relById.has(m.ref)) outlineRels.push(m.ref);
        }
      }

      if (partWays.length > 0 || partRels.length > 0) {
        consumedRels.add(rel.id);
        let parentName = tags.name || tags['name:en'] || tags['name:pl'] || '';
        for (const oWid of outlineWays) {
          usedWays.add(oWid);
          const wObj = ways.get(oWid);
          const wTags = { ...tags, ...(wObj.tags || {}) };
          const wNids = wObj.nodes || [];
          if (wNids.length >= 4 && wNids[0] === wNids[wNids.length - 1]) {
            const pts = nodesToPts(wNids, 0.015);
            if (pts.length >= 3) {
              if (!parentName) parentName = wTags.name || wTags['name:en'] || '';
              s3db.registerCandidate(oWid, wTags, pts, [], false, rel.id, true);
            }
          }
        }
        for (const oRid of outlineRels) {
          consumedRels.add(oRid);
          const oRel = relById.get(oRid);
          const oTags = { ...tags, ...(oRel.tags || {}) };
          if (!parentName) parentName = oTags.name || oTags['name:en'] || '';
          const st = stitchedRelPolys.get(oRid);
          if (st) {
            for (const wid of st.memberWayIds) usedWays.add(wid);
            const pairedHoles = pairMultipolygonHolesForOutersJS(st.outerPolys, st.innerPolys);
            for (let oi = 0; oi < st.outerPolys.length; oi++) {
              s3db.registerCandidate(oRid, oTags, st.outerPolys[oi], pairedHoles[oi] || [], false, rel.id, true);
            }
          }
        }
        for (const pWid of partWays) {
          usedWays.add(pWid);
          const wObj = ways.get(pWid);
          const wTags = { ...(wObj.tags || {}) };
          if (!wTags.name && parentName) wTags.name = parentName;
          const wNids = wObj.nodes || [];
          if (wNids.length >= 4 && wNids[0] === wNids[wNids.length - 1]) {
            const pts = nodesToPts(wNids, 0.015);
            if (pts.length >= 3) s3db.registerCandidate(pWid, wTags, pts, [], true, rel.id, true);
          }
        }
        for (const pRid of partRels) {
          consumedRels.add(pRid);
          const pRel = relById.get(pRid);
          const pTags = { ...(pRel.tags || {}) };
          if (!pTags.name && parentName) pTags.name = parentName;
          const st = stitchedRelPolys.get(pRid);
          if (st) {
            for (const wid of st.memberWayIds) usedWays.add(wid);
            const pairedHoles = pairMultipolygonHolesForOutersJS(st.outerPolys, st.innerPolys);
            for (let oi = 0; oi < st.outerPolys.length; oi++) {
              s3db.registerCandidate(pRid, pTags, st.outerPolys[oi], pairedHoles[oi] || [], true, rel.id, true);
            }
          }
        }
      }
    }
  }
}

function processOsmBuildingMultipolygonJS(rel, tags, _raw, ctx) {
  const hasBld = tags.building && !SKIP_BUILDING_VALS_JS.has(String(tags.building).toLowerCase());
  const hasPart = tags['building:part'] && !SKIP_BUILDING_VALS_JS.has(String(tags['building:part']).toLowerCase());
  if (!hasBld && !hasPart) return false;

  const st = ctx.stitchedRelPolys.get(rel.id);
  if (!st) return true;
  for (const wid of st.memberWayIds) ctx.usedWays.add(wid);
  const isPart = Boolean(hasPart && !hasBld);
  const pairedHoles = pairMultipolygonHolesForOutersJS(st.outerPolys, st.innerPolys);
  for (let oi = 0; oi < st.outerPolys.length; oi++) {
    ctx.s3db.registerCandidate(rel.id, tags, st.outerPolys[oi], pairedHoles[oi] || [], isPart, null, false);
  }
  return true;
}

function processOsmBuildingWayJS(wid, w, tags, nids, isClosed, ctx) {
  const hasBld = tags.building && !SKIP_BUILDING_VALS_JS.has(String(tags.building).toLowerCase());
  const hasPart = tags['building:part'] && !SKIP_BUILDING_VALS_JS.has(String(tags['building:part']).toLowerCase());
  if ((hasBld || hasPart) && isClosed) {
    if (!ctx.usedWays.has(wid)) {
      const pts = ctx.nodesToPts(nids, 0.015);
      if (pts.length >= 3) {
        ctx.s3db.registerCandidate(wid, tags, pts, [], Boolean(hasPart && !hasBld), null, false);
      }
    }
    return true;
  }
  return false;
}

function finalizeOsmBuildingsLayerJS(ctx) {
  let buildings = ctx.s3db.resolveAndEmitS3DBBuildings();
  if (ctx.minBldFootprintM > 0 && buildings.length > 0) {
    const minFootU = ctx.minBldFootprintM * ctx.metersToUnits;
    buildings = buildings.filter(b => {
      if (b.landmark || b.church || b.tower || b.part) return true;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of (b.outer || [])) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      return Math.max(maxX - minX, maxY - minY) >= minFootU;
    });
    for (let i = 0; i < buildings.length; i++) buildings[i].id = i + 1;
  }
  return buildings;
}

if (typeof window !== 'undefined') {
  window.pairMultipolygonHolesForOutersJS = pairMultipolygonHolesForOutersJS;
  window.collectOsmBuildingSampleCandidateJS = collectOsmBuildingSampleCandidateJS;
  window.processOsmS3DBRelationsPass1BJS = processOsmS3DBRelationsPass1BJS;
  window.processOsmBuildingMultipolygonJS = processOsmBuildingMultipolygonJS;
  window.processOsmBuildingWayJS = processOsmBuildingWayJS;
  window.finalizeOsmBuildingsLayerJS = finalizeOsmBuildingsLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pairMultipolygonHolesForOutersJS,
    collectOsmBuildingSampleCandidateJS,
    processOsmS3DBRelationsPass1BJS,
    processOsmBuildingMultipolygonJS,
    processOsmBuildingWayJS,
    finalizeOsmBuildingsLayerJS
  };
}
