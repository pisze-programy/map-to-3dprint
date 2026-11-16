// ============================================================================
// src/buildings/osm_buildings_extractor.js
// OSM S3DB Buildings Extractor (Relation Pass 1B, Multipolygons & Ways)
// ============================================================================

(function (root) {
  if (typeof require === 'function') {
    if (typeof root.SKIP_BUILDING_VALS_JS === 'undefined') Object.assign(root, require('./s3db_tag_parser.js'));
    if (typeof root.computeSolidInteriorPtJS !== 'function') Object.assign(root, require('./s3db_containment_2d.js'));
    if (typeof root.createS3DBClientCollector !== 'function') Object.assign(root, require('./s3db_client_matcher.js'));
  }

  function _bldPolyAreaAbsJS(pts) {
    if (!pts || pts.length < 3) return 0;
    if (typeof root.polyAreaSignedJS === 'function') return Math.abs(root.polyAreaSignedJS(pts));
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) * 0.5;
  }

  function _bldPointInPolyJS(px, py, poly) {
    if (!poly || poly.length < 3) return false;
    if (typeof root.pointInPolyLocal === 'function') return root.pointInPolyLocal(px, py, poly);
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

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
      const probePt = (typeof root.computeSolidInteriorPtJS === 'function') ? root.computeSolidInteriorPtJS(hole, []) : hole[0];
      let bestOuterIdx = -1, bestOuterArea = Infinity;
      for (let oi = 0; oi < outerPolys.length; oi++) {
        const oArea = outerAreas[oi];
        if (oArea <= hArea * 1.0001 || oArea >= bestOuterArea) continue;
        const [minX, minY, maxX, maxY] = outerBboxes[oi];
        if (probePt[0] < minX - 0.25 || probePt[0] > maxX + 0.25 || probePt[1] < minY - 0.25 || probePt[1] > maxY + 0.25) continue;
        const op = outerPolys[oi];
        let contained = _bldPointInPolyJS(probePt[0], probePt[1], op) || _bldPointInPolyJS(hole[0][0], hole[0][1], op);
        if (!contained) {
          const step = Math.max(1, Math.floor(hole.length / 8));
          let tested = 0, insideCnt = 0;
          for (let k = 0; k < hole.length; k += step) {
            const pA = hole[k], pB = hole[(k + 1) % hole.length];
            tested++;
            if (_bldPointInPolyJS((pA[0] + pB[0]) * 0.5, (pA[1] + pB[1]) * 0.5, op)) insideCnt++;
          }
          if (tested > 0 && insideCnt >= Math.ceil(tested * 0.6)) contained = true;
        }
        if (contained) { bestOuterArea = oArea; bestOuterIdx = oi; }
      }
      if (bestOuterIdx >= 0) holesPerOuter[bestOuterIdx].push(hole);
    }
    return holesPerOuter;
  }

  function collectOsmBuildingSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allBldCandidates) {
    if (wt.building && wn.length >= 4 && wn[0] === wn[wn.length - 1] && !isBrWay && !isTunWay) {
      const bVal = String(wt.building).toLowerCase(), mmVal = String(wt.man_made || '').toLowerCase();
      const locVal = String(wt.location || '').toLowerCase(), histVal = String(wt.historic || '').toLowerCase();
      if (
        !['pier', 'bridge', 'boathouse', 'houseboat', 'floating_home', 'roof', 'digester', 'ship', 'boat', 'vessel', 'barge'].includes(bVal) &&
        !['pier', 'bridge', 'breakwater', 'groyne', 'quay', 'jetty', 'wharf', 'dolphin'].includes(mmVal) &&
        !['underground', 'underwater', 'overwater'].includes(locVal) &&
        !['ship', 'wreck', 'aircraft'].includes(histVal) && !wt['seamark:type'] && wt.floating !== 'yes'
      ) {
        const p0 = nodes.get(wn[0]), pMid = nodes.get(wn[wn.length >> 1]) || p0;
        if (p0 && pMid) {
          const mx = (p0[0] + pMid[0]) * 0.5, my = (p0[1] + pMid[1]) * 0.5;
          if (Math.abs(mx) <= fetchHalfW && Math.abs(my) <= fetchHalfH) allBldCandidates.push([mx, my]);
        }
      }
      return true;
    }
    return false;
  }

  function _isEmptyRoleMemberPart(mTags) {
    if (!mTags) return false;
    const bp = String(mTags['building:part'] || '').toLowerCase().trim();
    return Boolean(bp && !root.SKIP_BUILDING_VALS_JS.has(bp) && !mTags.building);
  }

  function processOsmS3DBRelationsPass1BJS(ctx) {
    const { relations, ways, relById, stitchedRelPolys, nodesToPts, consumedRels, usedWays, s3db } = ctx;
    for (const rel of relations) {
      const tags = rel.tags || {}, members = rel.members || [];
      if (tags.type !== 'building' && !members.some(m => m.role === 'part' || m.role === 'outline')) continue;
      if (root.isUndergroundOrSkippedBuildingJS(tags) && !root.isGroupingOnlyContainerTagsJS(tags)) {
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
        } else if (role === 'outline' || role === 'outer') {
          if (m.type === 'way' && ways.has(m.ref)) outlineWays.push(m.ref);
          else if (m.type === 'relation' && relById.has(m.ref)) outlineRels.push(m.ref);
        } else if (role === '') {
          if (m.type === 'way' && ways.has(m.ref)) (_isEmptyRoleMemberPart(ways.get(m.ref).tags) ? partWays : outlineWays).push(m.ref);
          else if (m.type === 'relation' && relById.has(m.ref)) (_isEmptyRoleMemberPart(relById.get(m.ref).tags) ? partRels : outlineRels).push(m.ref);
        }
      }

      if (partWays.length === 0 && partRels.length === 0) continue;
      consumedRels.add(rel.id);
      let parentName = tags.name || tags['name:en'] || tags['name:pl'] || '';
      const emitRelMp = (rid, mTags, isPart) => {
        consumedRels.add(rid);
        const st = stitchedRelPolys.get(rid);
        if (!st) return;
        for (const wid of st.memberWayIds) usedWays.add(wid);
        const pairedHoles = pairMultipolygonHolesForOutersJS(st.outerPolys, st.innerPolys);
        for (let oi = 0; oi < st.outerPolys.length; oi++) s3db.registerCandidate(rid, mTags, st.outerPolys[oi], pairedHoles[oi] || [], isPart, rel.id, true);
      };

      for (const oWid of outlineWays) {
        usedWays.add(oWid);
        const wObj = ways.get(oWid), wTags = { ...tags, ...(wObj.tags || {}) }, wNids = wObj.nodes || [];
        if (wNids.length >= 4 && wNids[0] === wNids[wNids.length - 1]) {
          const pts = nodesToPts(wNids, 0.015);
          if (pts.length >= 3) {
            if (!parentName) parentName = wTags.name || wTags['name:en'] || '';
            s3db.registerCandidate(oWid, wTags, pts, [], false, rel.id, true);
          }
        }
      }
      for (const oRid of outlineRels) {
        const oTags = { ...tags, ...(relById.get(oRid).tags || {}) };
        if (!parentName) parentName = oTags.name || oTags['name:en'] || '';
        emitRelMp(oRid, oTags, false);
      }
      for (const pWid of partWays) {
        usedWays.add(pWid);
        const wObj = ways.get(pWid), wTags = { ...(wObj.tags || {}) }, wNids = wObj.nodes || [];
        if (!wTags.name && parentName) { wTags.name = parentName; wTags._nameInherited = true; }
        if (wNids.length >= 4 && wNids[0] === wNids[wNids.length - 1]) {
          const pts = nodesToPts(wNids, 0.015);
          if (pts.length >= 3) s3db.registerCandidate(pWid, wTags, pts, [], true, rel.id, true);
        }
      }
      for (const pRid of partRels) {
        const pTags = { ...(relById.get(pRid).tags || {}) };
        if (!pTags.name && parentName) { pTags.name = parentName; pTags._nameInherited = true; }
        emitRelMp(pRid, pTags, true);
      }
    }
  }

  function _classifyBuildingTags(tags) {
    const isBrSupport = typeof root.isBridgeSupportTagJS === 'function' ? root.isBridgeSupportTagJS(tags) : Boolean(tags && tags['bridge:support']);
    const isPierEl = typeof root.isOsmPierTagsJS === 'function' && root.isOsmPierTagsJS(tags);
    if (isBrSupport || isPierEl) return null;
    const hasBld = Boolean(tags.building && !root.SKIP_BUILDING_VALS_JS.has(String(tags.building).toLowerCase().trim()));
    const hasPart = Boolean(tags['building:part'] && !root.SKIP_BUILDING_VALS_JS.has(String(tags['building:part']).toLowerCase().trim()));
    const isWheel = typeof root.isObservationWheelTagsJS === 'function' && root.isObservationWheelTagsJS(tags) && !tags.highway && !tags.waterway && !tags.natural;
    const isGrouping = !hasBld && !hasPart && !isWheel && root.isGroupingOnlyContainerTagsJS(tags);
    if (!hasBld && !hasPart && !isWheel && !isGrouping) return null;
    return { hasBld, hasPart, isGrouping };
  }

  function processOsmBuildingMultipolygonJS(rel, tags, _raw, ctx) {
    const cls = _classifyBuildingTags(tags);
    if (!cls) return false;
    const st = ctx.stitchedRelPolys.get(rel.id);
    if (!st) return !cls.isGrouping;
    for (const wid of st.memberWayIds) {
      if (!cls.isGrouping || !ctx.ways || !ctx.ways.get(wid)?.tags?.['building:part']) ctx.usedWays.add(wid);
    }
    const pairedHoles = pairMultipolygonHolesForOutersJS(st.outerPolys, st.innerPolys);
    for (let oi = 0; oi < st.outerPolys.length; oi++) {
      ctx.s3db.registerCandidate(rel.id, tags, st.outerPolys[oi], pairedHoles[oi] || [], Boolean(cls.hasPart && !cls.hasBld), null, false, cls.isGrouping ? { isGroupingOnlyOutline: true } : null);
    }
    return !(cls.isGrouping && (tags.leisure || (tags.landuse && tags.landuse !== 'construction')));
  }

  function processOsmBuildingWayJS(wid, w, tags, nids, isClosed, ctx) {
    const cls = _classifyBuildingTags(tags);
    if (!cls || !isClosed) return false;
    if (!ctx.usedWays.has(wid)) {
      const pts = ctx.nodesToPts(nids, 0.015);
      if (pts.length >= 3) {
        ctx.s3db.registerCandidate(wid, tags, pts, [], Boolean(cls.hasPart && !cls.hasBld), null, false, cls.isGrouping ? { isGroupingOnlyOutline: true } : null);
      }
    }
    return !(cls.isGrouping && (tags.leisure || (tags.landuse && tags.landuse !== 'construction')));
  }

  function finalizeOsmBuildingsLayerJS(ctx) {
    let buildings = ctx.s3db.resolveAndEmitS3DBBuildings();
    if (ctx.minBldFootprintM > 0 && buildings.length > 0) {
      const minFootU = ctx.minBldFootprintM * ctx.metersToUnits;
      buildings = buildings.filter(b => {
        if (b.landmark || b.church || b.tower || b.part) return true;
        if (typeof root.computeMinAreaOBB2D === 'function' && b.outer && b.outer.length >= 3) {
          const obb = root.computeMinAreaOBB2D(b.outer);
          if (obb && obb.halfL > 0) return (obb.halfL * 2) >= minFootU;
        }
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

  const exportsObj = {
    _bldPolyAreaAbsJS, _bldPointInPolyJS, pairMultipolygonHolesForOutersJS,
    collectOsmBuildingSampleCandidateJS, processOsmS3DBRelationsPass1BJS,
    processOsmBuildingMultipolygonJS, processOsmBuildingWayJS, finalizeOsmBuildingsLayerJS,
  };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
