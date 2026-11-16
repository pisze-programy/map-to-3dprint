// ============================================================================
// src/buildings/s3db_client_matcher.js
// Spatial O(N) S3DB Parent/Part Collector, Record Builder & Complex Resolver
// ============================================================================

(function (root) {
  if (typeof require === 'function') {
    if (typeof root.OSM_METRIC_CONFIG === 'undefined') { try { Object.assign(root, require('../geometry/print_physics_config.js')); } catch (_) {} }
    if (typeof root.parseOsmLengthMetersJS !== 'function') Object.assign(root, require('./s3db_tag_parser.js'));
    if (typeof root.computeSolidInteriorPtJS !== 'function') Object.assign(root, require('./s3db_containment_2d.js'));
    if (typeof root.consolidateWheelComplexesS3DB !== 'function') Object.assign(root, require('./s3db_wheel_consolidator.js'));
    if (typeof root.evaluateParentOutlineSuppressionS3DB !== 'function') Object.assign(root, require('./s3db_outline_suppressor.js'));
    if (typeof root.computeGroundPartsUnionCoverage2D !== 'function') { try { Object.assign(root, require('../geometry/polygon_2d.js')); } catch (_) {} }
  }

  function createS3DBClientCollector(halfW, halfH, metersToUnits) {
    const candidateParents = [], candidateParts = [], buildings = [];

    function registerCandidate(osmId, tags, outerPts, holesPts, isPart, groupId = null, fromBldRel = false, opts = null) {
      if (!outerPts || outerPts.length < 3) return;
      const isGroupingOnly = Boolean((opts && opts.isGroupingOnlyOutline) || (!isPart && root.isGroupingOnlyContainerTagsJS(tags)));
      if (!isGroupingOnly && root.isUndergroundOrSkippedBuildingJS(tags)) return;

      let sx = 0, sy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of outerPts) {
        sx += p[0]; sy += p[1];
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
      const cx = sx / outerPts.length, cy = sy / outerPts.length;
      const validHoles = (holesPts || []).filter(h => Array.isArray(h) && h.length >= 3 && root._pointInPolyS3DB(...root.computeSolidInteriorPtJS(h, []), outerPts));
      const interiorPt = root.computeSolidInteriorPtJS(outerPts, validHoles);
      if (Math.min(Math.abs(cx), Math.abs(interiorPt[0])) > halfW + 4.0 ||
          Math.min(Math.abs(cy), Math.abs(interiorPt[1])) > halfH + 4.0) return;

      const outerArea = Math.abs(root._polyAreaSignedS3DB(outerPts));
      const holesArea = validHoles.reduce((acc, h) => acc + Math.abs(root._polyAreaSignedS3DB(h)), 0);
      let minH = root.parseOsmLengthMetersJS(tags && tags.min_height, 0) || 0;
      const minLvl = root.parseFloatTagJS(tags && tags['building:min_level'], 0) || 0;
      const minLvlM = (typeof root.OSM_METRIC_CONFIG !== 'undefined') ? root.OSM_METRIC_CONFIG.minLevelHeightM : 3.5;
      if (minH === 0 && minLvl > 0) minH = minLvl * minLvlM;

      const archType = (!isGroupingOnly && root.isObservationWheelTagsJS(tags)) ? 'ferris_wheel' : null;
      const rec = {
        wid: osmId, tags: { ...(tags || {}) }, pts: outerPts, holes: validHoles, cx, cy, interiorPt,
        bbox: [minX, minY, maxX, maxY], area: outerArea, netArea: Math.max(1e-4, outerArea - holesArea), minH,
        archType, isFerrisWheel: archType === 'ferris_wheel', isGroupingOnlyOutline: isGroupingOnly,
        hasParts: false, partCount: 0, allParts: [], groundParts: [], groundPartHeights: [],
        fromBuildingRel: Boolean(fromBldRel), groupId, parentHeightHint: null, isPart: Boolean(isPart), _hadParent: false,
      };
      if (isPart) candidateParts.push(rec); else candidateParents.push(rec);
    }

    function addBuildingRecord(osmId, tags, outer, holes, groupId = null, isPart = false, parentHeightHint = null, fromBldRel = false, maxDefaultHeightCap = null) {
      if (!outer || outer.length < 3) return;
      let sx = 0, sy = 0;
      for (const p of outer) { sx += p[0]; sy += p[1]; }
      const cx = sx / outer.length, cy = sy / outer.length;
      if (Math.abs(cx) > halfW + 4.0 || Math.abs(cy) > halfH + 4.0) return;

      const mToU = Math.max(1e-4, metersToUnits);
      const { rawMinSpanM, rawMaxSpanM, areaU, areaM2 } = root.computeRecordMetricsM(outer, mToU);
      const minSpanM = Math.max(1.5, rawMinSpanM), maxSpanM = rawMaxSpanM;
      const wingHalfU = (typeof root.computeCharacteristicWingHalfWidth2D === 'function')
        ? root.computeCharacteristicWingHalfWidth2D(outer, holes || []) : (minSpanM * mToU * 0.5);
      const effPitchSpanM = Math.min(minSpanM, Math.max(1.5, (wingHalfU * 2.0) / mToU));

      const archType = tags._archTypeOverride || (root.isObservationWheelTagsJS(tags) ? 'ferris_wheel' : null);
      const isFerrisWheel = archType === 'ferris_wheel';
      const btype = String(tags.building || tags['building:part'] || (isFerrisWheel ? 'observation_wheel' : 'yes')).toLowerCase().trim();
      let name = tags.name || tags['name:en'] || tags['name:pl'] || tags['addr:housename'] || '';
      if (/[\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(name) && tags['name:en']) name = tags['name:en'];
      if (!name && tags['addr:street']) name = `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim();

      const cfg = typeof root.OSM_METRIC_CONFIG !== 'undefined' ? root.OSM_METRIC_CONFIG : {};
      const lvlH = cfg.levelHeightM || 3.5, roofLvlH = cfg.roofLevelHeightM || 3.0, minLvlM = cfg.minLevelHeightM || 3.5;
      const levels = root.parseFloatTagJS(tags['building:levels'], null);
      const explicitH = root.parseOsmLengthMetersJS(tags.height, null)
        ?? root.parseOsmLengthMetersJS(tags['building:height'], null)
        ?? root.parseOsmLengthMetersJS(tags.est_height, null);
      let h = explicitH, minH = isFerrisWheel ? 0.0 : (root.parseOsmLengthMetersJS(tags.min_height, 0.0) || 0.0);
      const minLevel = root.parseFloatTagJS(tags['building:min_level'], 0.0) || 0.0;
      if (!isFerrisWheel && minH === 0.0 && minLevel > 0) minH = minLevel * minLvlM;

      if (isPart && minH >= 15.0 && explicitH !== null && (explicitH - minH) > 0 && (explicitH - minH) <= 1.5 && rawMaxSpanM <= 4.0 && rawMinSpanM <= 1.6) return;

      const isChurch = ['church', 'cathedral', 'chapel', 'basilica'].includes(btype) ||
        tags.amenity === 'place_of_worship' || ['church', 'cathedral'].includes(String(tags.historic || '').toLowerCase());
      const isTower = ['tower', 'bell_tower', 'water_tower'].includes(btype) ||
        ['tower', 'chimney', 'lighthouse'].includes(tags.man_made) || Boolean(tags['tower:type']) || isFerrisWheel;

      const roof = tags['roof:shape'] ? root.normalizeRoofShapeS3DB(tags['roof:shape']) : 'flat';
      const roofOrient = String(tags['roof:orientation'] || '').toLowerCase().trim() === 'across' ? 'across' : 'along';
      const roofDir = root.parseRoofDirectionJS(tags), eleM = root.parseOsmLengthMetersJS(tags.ele, null);
      const roofHTag = root.parseOsmLengthMetersJS(tags['roof:height'], null), roofLvlTag = root.parseFloatTagJS(tags['roof:levels'], null);
      const hasExplicitRoofH = roofHTag !== null || roofLvlTag !== null;
      let roofH = 0.0;
      if (roof !== 'flat') {
        if (roofHTag !== null) roofH = Math.max(0.0, roofHTag);
        else if (roofLvlTag !== null) roofH = Math.max(0.0, roofLvlTag * roofLvlH);
        else if (roof === 'cone' || roof === 'pyramidal' || roof === 'dome' || roof === 'onion') roofH = Math.min(Math.max(3.5, minSpanM * 0.85), 11.0);
        else roofH = Math.min(effPitchSpanM * 0.42, 10.0);
      }

      const heightSource = explicitH !== null ? 'explicit_height' : (levels !== null ? 'levels' : 'estimated_default');
      if (h === null) {
        if (!isFerrisWheel && levels !== null) h = levels * lvlH + roofH;
        else {
          const deltaEst = root.estimateDefaultHeightM({
            isFerrisWheel, isPart, isChurch, isTower, btype, rawMinSpanM, rawMaxSpanM, minSpanM, maxSpanM,
            areaM2: areaM2 > 0 ? areaM2 : (areaU / Math.max(1e-6, mToU * mToU)), parentHeightHint, tags, roofH, cfg,
          });
          if (isPart && minH > 0 && deltaEst <= minH + 2.0) h = minH + Math.max(3.5, Math.min(18.0, deltaEst));
          else h = (maxDefaultHeightCap !== null && maxDefaultHeightCap > 0) ? Math.min(deltaEst, maxDefaultHeightCap) : deltaEst;
        }
      }
      if (minH >= h - 0.5) minH = (explicitH !== null && h > 12.0) ? Math.max(0.0, h - 2.0) : 0.0;
      if (roof !== 'flat') {
        const availH = Math.max(0.0, h - minH - 0.1);
        roofH = hasExplicitRoofH ? Math.min(roofH, availH) : Math.min(roofH, availH, h * 0.55);
      }

      const rec = {
        id: buildings.length + 1, osmId, groupId: groupId !== null ? groupId : osmId,
        name: name || (isChurch ? `Church #${osmId}` : (isPart ? `Part #${osmId}` : `Building #${osmId}`)),
        btype, cx: Math.round(cx * 100) / 100, cy: Math.round(cy * 100) / 100, outer, holes,
        h: Math.round(h * 10) / 10, minH: Math.round(minH * 10) / 10, ele: eleM,
        levels: levels !== null ? Math.max(1, Math.round(levels)) : Math.max(1, Math.round(Math.max(3.0, h - roofH) / lvlH)),
        roof, roofH: Math.round(roofH * 10) / 10, roofOrient, hasExplicitRoofH, heightSource,
        part: Boolean(isPart && !isFerrisWheel), fromBuildingRel: Boolean(fromBldRel), isOutline: false,
        archType: archType || null, church: isChurch, tower: isTower,
        towerConstruction: tags['tower:construction'] ? String(tags['tower:construction']).toLowerCase().trim() : null,
        parentHeightM: (parentHeightHint !== null && parentHeightHint !== undefined) ? Math.round(parentHeightHint * 10) / 10 : null,
        landmark: Boolean(tags.name || tags.wikidata || tags.heritage || isChurch || isTower || isFerrisWheel),
        isLandmark: isFerrisWheel,
        isVessel: Boolean(/^(ship|boat|houseboat|floating_home|barge|boathouse)$/.test(btype) || tags.historic === 'ship' || tags['ship:type'] || tags.floating === 'yes' || tags.platform === 'floating' || (tags.ferry === 'yes' && tags.public_transport === 'platform')),
      };
      if (roofDir !== null) rec.roofDir = roofDir;
      buildings.push(rec);
    }

    function resolveAndEmitS3DBBuildings() {
      const lvlHM = (typeof root.OSM_METRIC_CONFIG !== 'undefined' && root.OSM_METRIC_CONFIG.levelHeightM) || 3.5;
      const estTagH = (tags) => {
        const eh = root.parseOsmLengthMetersJS(tags.height, null) ?? root.parseOsmLengthMetersJS(tags['building:height'], null) ?? root.parseOsmLengthMetersJS(tags.est_height, null);
        if (eh !== null) return eh;
        const lv = root.parseFloatTagJS(tags['building:levels'], null);
        return lv !== null ? lv * lvlHM : null;
      };

      const parentByGroup = new Map();
      for (const par of candidateParents) if (par.groupId !== null) {
        if (!parentByGroup.has(par.groupId)) parentByGroup.set(par.groupId, []);
        parentByGroup.get(par.groupId).push(par);
      }
      const sortedParents = candidateParents.slice().sort((a, b) => a.bbox[0] - b.bbox[0]);
      const PAR_CELL = 4.0, parentSpatialGrid = new Map();
      for (let pi = 0; pi < sortedParents.length; pi++) {
        const par = sortedParents[pi]; par._sortIdx = pi;
        const [x0, y0, x1, y1] = par.bbox;
        for (let gx = Math.floor(x0 / PAR_CELL), gx1 = Math.floor(x1 / PAR_CELL); gx <= gx1; gx++) {
          for (let gy = Math.floor(y0 / PAR_CELL), gy1 = Math.floor(y1 / PAR_CELL); gy <= gy1; gy++) {
            const ck = `${gx}:${gy}`;
            let bkt = parentSpatialGrid.get(ck);
            if (!bkt) { bkt = []; parentSpatialGrid.set(ck, bkt); }
            bkt.push(par);
          }
        }
      }
      const parSeenStamp = new Int32Array(sortedParents.length);
      let parStamp = 0;
      const queryNearParents = (minX, minY, maxX, maxY) => {
        const res = [], tok = ++parStamp;
        for (let gx = Math.floor((minX - 0.12) / PAR_CELL), gx1 = Math.floor((maxX + 0.12) / PAR_CELL); gx <= gx1; gx++) {
          for (let gy = Math.floor((minY - 0.12) / PAR_CELL), gy1 = Math.floor((maxY + 0.12) / PAR_CELL); gy <= gy1; gy++) {
            const bkt = parentSpatialGrid.get(`${gx}:${gy}`);
            if (!bkt) continue;
            for (let bi = 0; bi < bkt.length; bi++) {
              const par = bkt[bi];
              if (parSeenStamp[par._sortIdx] === tok) continue;
              parSeenStamp[par._sortIdx] = tok;
              if (par.bbox[0] > maxX + 0.12 || minX > par.bbox[2] + 0.12 || minY > par.bbox[3] + 0.12 || maxY < par.bbox[1] - 0.12) continue;
              res.push(par);
            }
          }
        }
        if (res.length > 1) res.sort((a, b) => a._sortIdx - b._sortIdx);
        return res;
      };

      for (const child of candidateParents) {
        if (child.isGroupingOnlyOutline) continue;
        const bpRaw = String((child.tags && child.tags['building:part']) || '').toLowerCase().trim();
        if (!bpRaw || bpRaw === 'no' || bpRaw === 'none' || root.SKIP_BUILDING_VALS_JS.has(bpRaw)) continue;
        const childEstH = estTagH(child.tags);
        const childRef = { outer: child.pts, holes: child.holes, part: child, h: childEstH, minH: child.minH || 0 };
        for (const ep of queryNearParents(child.bbox[0], child.bbox[1], child.bbox[2], child.bbox[3])) {
          if (ep === child || ep.area <= child.area * 1.15 || !root.isPartEnclosedByParentS3DB(child, ep)) continue;
          ep.hasParts = true; ep.partCount++; ep.allParts.push(childRef);
          if ((child.minH || 0) <= 1.5) { ep.groundParts.push(childRef); if (childEstH !== null && childEstH > 0) ep.groundPartHeights.push(childEstH); }
          const sharedGid = ep.groupId || child.groupId || ep.wid;
          if (ep.groupId === null) ep.groupId = sharedGid;
          child.groupId = sharedGid;
          const nm = !child.tags.name && (ep.tags.name || ep.tags['name:en'] || ep.tags['name:pl']);
          if (nm) { child.tags.name = nm; child.tags._nameInherited = true; }
        }
      }

      for (const part of candidateParts) {
        let bestParent = null, bestArea = Infinity;
        const enclosingParents = [], [pix, piy] = part.interiorPt, [pMinX, pMinY, pMaxX, pMaxY] = part.bbox;
        if (part.groupId !== null && parentByGroup.has(part.groupId)) {
          const cands = parentByGroup.get(part.groupId);
          const ov = cands.filter(p => !(pMinX > p.bbox[2] + 0.25 || pMaxX < p.bbox[0] - 0.25 || pMinY > p.bbox[3] + 0.25 || pMaxY < p.bbox[1] - 0.25) && !root._pointInAnyHoleS3DB(pix, piy, p.holes));
          const useCands = ov.length > 0 ? ov : cands;
          enclosingParents.push(...useCands);
          bestParent = useCands.reduce((b, p) => (Math.abs(p.interiorPt[0] - pix) + Math.abs(p.interiorPt[1] - piy) < Math.abs(b.interiorPt[0] - pix) + Math.abs(b.interiorPt[1] - piy) ? p : b), useCands[0]);
        }
        for (const parent of queryNearParents(pMinX, pMinY, pMaxX, pMaxY)) {
          if (root.isPartEnclosedByParentS3DB(part, parent)) {
            if (!enclosingParents.includes(parent)) enclosingParents.push(parent);
            if (!bestParent || (part.groupId === null && parent.area < bestArea)) { bestArea = parent.area; bestParent = parent; }
          }
        }
        const partEstH = estTagH(part.tags), partRef = { outer: part.pts, holes: part.holes, part, h: partEstH, minH: part.minH || 0 };
        for (const ep of enclosingParents) {
          ep.hasParts = true; ep.partCount++; ep.allParts.push(partRef);
          if ((part.minH || 0) <= 1.5) { ep.groundParts.push(partRef); if (partEstH !== null && partEstH > 0) ep.groundPartHeights.push(partEstH); }
        }
        if (bestParent) {
          part._hadParent = true;
          const outerEp = enclosingParents.reduce((a, b) => (b.area > a.area ? b : a), bestParent);
          if (part.groupId === null) part.groupId = outerEp.groupId || bestParent.groupId || outerEp.wid;
          for (const ep of enclosingParents) if (ep.groupId === null) ep.groupId = part.groupId;
          if (!part.tags.name) {
            for (const ep of enclosingParents.slice().sort((a, b) => b.area - a.area)) {
              const nm = ep.tags.name || ep.tags['name:en'] || ep.tags['name:pl'];
              if (nm) { part.tags.name = nm; part.tags._nameInherited = true; break; }
            }
          }
          part.parentHeightHint = estTagH(bestParent.tags);
          const pTc = bestParent.tags['tower:construction'] || enclosingParents.map(e => e.tags && e.tags['tower:construction']).find(Boolean);
          if ((pTc === 'lattice' || pTc === 'guyed_lattice') && !part.tags['tower:construction']) part.parentTowerConstruction = pTc;
        } else if (part.groupId === null) part.groupId = part.wid;
      }

      root.groupOrphanBuildingPartsS3DB(candidateParts);
      const isWheelSuppressedAux = root.consolidateWheelComplexesS3DB(candidateParents, candidateParts, metersToUnits, addBuildingRecord);
      for (const part of candidateParts) {
        if (isWheelSuppressedAux(part)) { part._suppressedByWheel = true; continue; }
        const t = part.tags, dH = (root.parseOsmLengthMetersJS(t.height, 0) || 0) - (root.parseOsmLengthMetersJS(t.min_height, 0) || 0);
        const inheritLat = part.parentTowerConstruction && !t['tower:construction'] && !t.amenity && !t.shop && !t.office && !t.tourism && t.covered !== 'yes' && (t.wall === 'no' || t['building:part'] === 'roof' || dH >= 12.0);
        addBuildingRecord(part.wid, inheritLat ? Object.assign({}, t, { 'tower:construction': part.parentTowerConstruction }) : t, part.pts, part.holes, part.groupId, true, part.parentHeightHint, part.fromBuildingRel);
      }

      const evalCov = (outer, holes, list) => (typeof root.computeGroundPartsUnionCoverage2D === 'function')
        ? root.computeGroundPartsUnionCoverage2D(outer, holes, list)
        : root._fallbackPartsCoverageS3DB(outer, holes, list);
      for (const parent of candidateParents) {
        if (isWheelSuppressedAux(parent)) continue;
        const { suppress, maxDefaultHeightCap } = root.evaluateParentOutlineSuppressionS3DB(parent, evalCov);
        if (!suppress) addBuildingRecord(parent.wid, parent.tags, parent.pts, parent.holes, parent.groupId || parent.wid, false, null, parent.fromBuildingRel, maxDefaultHeightCap);
      }
      for (let i = 0; i < buildings.length; i++) buildings[i].id = i + 1;
      return buildings;
    }

    return { registerCandidate, addBuildingRecord, resolveAndEmitS3DBBuildings, buildings };
  }

  const exportsObj = { createS3DBClientCollector };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
