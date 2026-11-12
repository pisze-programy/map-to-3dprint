// ============================================================================
// src/gis_client/osm_buildings_extract.js
// OSM S3DB Buildings Extractor (Relation Pass 1B, Multipolygon Outer/Inner Pairing,
// Standalone Building Ways & Minimum Footprint Filtering)
// ============================================================================

if (typeof SKIP_BUILDING_VALS_JS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
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
            for (const op of st.outerPolys) s3db.registerCandidate(oRid, oTags, op, st.innerPolys, false, rel.id, true);
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
            for (const op of st.outerPolys) s3db.registerCandidate(pRid, pTags, op, st.innerPolys, true, rel.id, true);
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
  for (const op of st.outerPolys) {
    ctx.s3db.registerCandidate(rel.id, tags, op, st.innerPolys, isPart, null, false);
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
  window.collectOsmBuildingSampleCandidateJS = collectOsmBuildingSampleCandidateJS;
  window.processOsmS3DBRelationsPass1BJS = processOsmS3DBRelationsPass1BJS;
  window.processOsmBuildingMultipolygonJS = processOsmBuildingMultipolygonJS;
  window.processOsmBuildingWayJS = processOsmBuildingWayJS;
  window.finalizeOsmBuildingsLayerJS = finalizeOsmBuildingsLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    collectOsmBuildingSampleCandidateJS,
    processOsmS3DBRelationsPass1BJS,
    processOsmBuildingMultipolygonJS,
    processOsmBuildingWayJS,
    finalizeOsmBuildingsLayerJS
  };
}
