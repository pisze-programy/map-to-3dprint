// ============================================================================
// src/gis_client/s3db_client_matcher.js
// Pure S3DB Relation/Part Matcher & Unconditional Outline Suppressor
// ============================================================================

if (typeof OSM_METRIC_CONFIG === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('../geometry/print_physics_config.js')); } catch (_) {}
}
if (typeof parseOsmLengthMetersJS === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('./s3db_unit_parser.js')); } catch (_) {}
}
if (typeof computeSolidInteriorPtJS === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('./s3db_relation_helper.js')); } catch (_) {}
}
if (typeof computeGroundPartsUnionCoverage2D === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('../geometry/polygon_2d.js')); } catch (_) {}
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
      if (!_pointInPolyS3DB(px, py, outer) || _pointInAnyHoleS3DB(px, py, holes)) continue;
      parentHits++;
      for (const pe of partEntries) {
        const po = pe.outer || (pe.part && pe.part.pts);
        const ph = pe.holes || (pe.part && pe.part.holes);
        if (po && _pointInPolyS3DB(px, py, po) && !_pointInAnyHoleS3DB(px, py, ph)) {
          coveredHits++;
          break;
        }
      }
    }
  }
  return parentHits > 0 ? (coveredHits / parentHits) : 0;
}

function createS3DBClientCollector(halfW, halfH, metersToUnits) {
  const candidateParents = [];
  const candidateParts = [];
  const buildings = [];

  function registerCandidate(osmId, tags, outerPts, holesPts, isPart, groupId = null, fromBldRel = false) {
    if (outerPts.length < 3 || isUndergroundOrSkippedBuildingJS(tags)) return;
    let sx = 0, sy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of outerPts) {
      sx += p[0]; sy += p[1];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const cx = sx / outerPts.length, cy = sy / outerPts.length;
    const validHoles = (holesPts || []).filter(h => Array.isArray(h) && h.length >= 3 && _pointInPolyS3DB(...computeSolidInteriorPtJS(h, []), outerPts));
    const interiorPt = computeSolidInteriorPtJS(outerPts, validHoles);
    if (Math.min(Math.abs(cx), Math.abs(interiorPt[0])) > halfW + 4.0 ||
        Math.min(Math.abs(cy), Math.abs(interiorPt[1])) > halfH + 4.0) return;

    const outerArea = Math.abs(_polyAreaSignedS3DB(outerPts));
    const holesArea = validHoles.reduce((acc, h) => acc + Math.abs(_polyAreaSignedS3DB(h)), 0);
    const netArea = Math.max(1e-4, outerArea - holesArea);
    let minH = parseOsmLengthMetersJS(tags.min_height, 0) || 0;
    const minLvl = parseFloatTagJS(tags['building:min_level'], 0) || 0;
    const minLvlM = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.minLevelHeightM : 3.5;
    if (minH === 0 && minLvl > 0) minH = minLvl * minLvlM;

    const archType = isObservationWheelTagsJS(tags) ? 'ferris_wheel' : null;
    const rec = {
      wid: osmId, tags: { ...tags }, pts: outerPts, holes: validHoles, cx, cy, interiorPt,
      bbox: [minX, minY, maxX, maxY], area: outerArea, netArea, minH,
      archType, isFerrisWheel: archType === 'ferris_wheel',
      hasParts: false, partCount: 0, allParts: [], groundParts: [], groundPartHeights: [],
      fromBuildingRel: Boolean(fromBldRel), groupId, parentHeightHint: null, isPart: Boolean(isPart),
    };
    if (isPart) candidateParts.push(rec);
    else candidateParents.push(rec);
  }

  function addBuildingRecord(osmId, tags, outer, holes, groupId = null, isPart = false, parentHeightHint = null, fromBldRel = false, maxDefaultHeightCap = null) {
    if (!outer || outer.length < 3) return;
    let sx = 0, sy = 0;
    for (const p of outer) { sx += p[0]; sy += p[1]; }
    const cx = sx / outer.length, cy = sy / outer.length;
    if (Math.abs(cx) > halfW + 4.0 || Math.abs(cy) > halfH + 4.0) return;

    const mToU = Math.max(1e-4, metersToUnits);
    const { rawMinSpanM, rawMaxSpanM, areaU, areaM2 } = computeRecordMetricsM(outer, mToU);
    const minSpanM = Math.max(1.5, rawMinSpanM);
    const maxSpanM = rawMaxSpanM;
    const wingHalfU = (typeof computeCharacteristicWingHalfWidth2D === 'function')
      ? computeCharacteristicWingHalfWidth2D(outer, holes || []) : (minSpanM * mToU * 0.5);
    const effPitchSpanM = Math.min(minSpanM, Math.max(1.5, (wingHalfU * 2.0) / mToU));

    const archType = tags._archTypeOverride || (isObservationWheelTagsJS(tags) ? 'ferris_wheel' : null);
    const isFerrisWheel = archType === 'ferris_wheel';
    const btype = String(tags.building || tags['building:part'] || (isFerrisWheel ? 'observation_wheel' : 'yes')).toLowerCase().trim();
    let name = tags.name || tags['name:en'] || tags['name:pl'] || tags['addr:housename'] || '';
    if (/[\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(name) && tags['name:en']) name = tags['name:en'];
    if (!name && tags['addr:street']) name = `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim();

    const cfg = typeof OSM_METRIC_CONFIG !== 'undefined' ? OSM_METRIC_CONFIG : {};
    const lvlH = cfg.levelHeightM || 3.5;
    const roofLvlH = cfg.roofLevelHeightM || 3.0;
    const minLvlM = cfg.minLevelHeightM || 3.5;

    const levels = parseFloatTagJS(tags['building:levels'], null);
    const explicitH = parseOsmLengthMetersJS(tags.height, null)
      ?? parseOsmLengthMetersJS(tags['building:height'], null)
      ?? parseOsmLengthMetersJS(tags.est_height, null);
    let h = explicitH;
    let minH = isFerrisWheel ? 0.0 : (parseOsmLengthMetersJS(tags.min_height, 0.0) || 0.0);
    const minLevel = parseFloatTagJS(tags['building:min_level'], 0.0) || 0.0;
    if (!isFerrisWheel && minH === 0.0 && minLevel > 0) minH = minLevel * minLvlM;

    if (isPart && minH >= 15.0 && explicitH !== null && (explicitH - minH) > 0 && (explicitH - minH) <= 1.5 && rawMaxSpanM <= 4.0 && rawMinSpanM <= 1.6) {
      return;
    }

    const isChurch = ['church', 'cathedral', 'chapel', 'basilica'].includes(btype) ||
      tags.amenity === 'place_of_worship' || ['church', 'cathedral'].includes(String(tags.historic || '').toLowerCase());
    const isTower = ['tower', 'bell_tower', 'water_tower'].includes(btype) ||
      ['tower', 'chimney', 'lighthouse'].includes(tags.man_made) || Boolean(tags['tower:type']) || isFerrisWheel;

    const rawRoof = tags['roof:shape'];
    const roof = rawRoof ? normalizeRoofShapeS3DB(rawRoof) : 'flat';
    const roofOrient = String(tags['roof:orientation'] || '').toLowerCase().trim() === 'across' ? 'across' : 'along';
    const roofDir = parseRoofDirectionJS(tags);
    const eleM = parseOsmLengthMetersJS(tags.ele, null);

    const roofHTag = parseOsmLengthMetersJS(tags['roof:height'], null);
    const roofLvlTag = parseFloatTagJS(tags['roof:levels'], null);
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
        h = estimateDefaultHeightM({
          isFerrisWheel, isPart, isChurch, isTower, btype, rawMinSpanM, rawMaxSpanM, minSpanM, maxSpanM,
          areaM2: areaM2 > 0 ? areaM2 : (areaU / Math.max(1e-6, mToU * mToU)), parentHeightHint, tags, roofH, cfg,
        });
        if (maxDefaultHeightCap !== null && maxDefaultHeightCap > 0) {
          h = Math.min(h, maxDefaultHeightCap);
        }
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
    };
    if (roofDir !== null) rec.roofDir = roofDir;
    buildings.push(rec);
  }

  function resolveAndEmitS3DBBuildings() {
    const parentByGroup = new Map();
    for (const par of candidateParents) {
      if (par.groupId !== null) {
        if (!parentByGroup.has(par.groupId)) parentByGroup.set(par.groupId, []);
        parentByGroup.get(par.groupId).push(par);
      }
    }
    const sortedParentsByMinX = candidateParents.slice().sort((a, b) => a.bbox[0] - b.bbox[0]);
    for (const part of candidateParts) {
      let bestParent = null;
      const enclosingParents = [];
      const [pix, piy] = part.interiorPt;
      const [pMinX, pMinY, pMaxX, pMaxY] = part.bbox;
      if (part.groupId !== null && parentByGroup.has(part.groupId)) {
        const cands = parentByGroup.get(part.groupId);
        const overlapping = cands.filter(p => !(pMinX > p.bbox[2] + 0.25 || pMaxX < p.bbox[0] - 0.25 || pMinY > p.bbox[3] + 0.25 || pMaxY < p.bbox[1] - 0.25) && !_pointInAnyHoleS3DB(pix, piy, p.holes));
        const useCands = overlapping.length > 0 ? overlapping : cands;
        enclosingParents.push(...useCands);
        bestParent = useCands.reduce((b, p) => (Math.abs(p.interiorPt[0] - pix) + Math.abs(p.interiorPt[1] - piy) < Math.abs(b.interiorPt[0] - pix) + Math.abs(b.interiorPt[1] - piy) ? p : b), useCands[0]);
      }
      let bestArea = Infinity;
      for (const parent of sortedParentsByMinX) {
        const [parMinX, parMinY, parMaxX, parMaxY] = parent.bbox;
        if (parMinX > pMaxX + 0.12) break;
        if (pMinX > parMaxX + 0.12 || pMinY > parMaxY + 0.12 || pMaxY < parMinY - 0.12) continue;
        if (isPartEnclosedByParentS3DB(part, parent)) {
          if (!enclosingParents.includes(parent)) enclosingParents.push(parent);
          if (!bestParent || (part.groupId === null && parent.area < bestArea)) { bestArea = parent.area; bestParent = parent; }
        }
      }
      const lvlHM = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.levelHeightM : 3.5;
      const partRef = { outer: part.pts, holes: part.holes, part };
      const pExplicitH = parseOsmLengthMetersJS(part.tags.height, null) ?? parseOsmLengthMetersJS(part.tags['building:height'], null);
      const pLvls = pExplicitH === null ? parseFloatTagJS(part.tags['building:levels'], null) : null;
      const partEstH = pExplicitH !== null ? pExplicitH : (pLvls !== null ? pLvls * lvlHM : null);
      for (const ep of enclosingParents) {
        ep.hasParts = true;
        ep.partCount++;
        ep.allParts.push(partRef);
        if ((part.minH || 0) <= 0.5) {
          ep.groundParts.push(partRef);
          if (partEstH !== null && partEstH > 0) ep.groundPartHeights.push(partEstH);
        }
      }
      if (bestParent) {
        if (part.groupId === null) part.groupId = bestParent.groupId || bestParent.wid;
        for (const ep of enclosingParents) if (ep.groupId === null) ep.groupId = part.groupId;
        if (!part.tags.name) {
          for (const ep of enclosingParents.slice().sort((a, b) => b.area - a.area)) {
            const nm = ep.tags.name || ep.tags['name:en'] || ep.tags['name:pl'];
            if (nm) { part.tags.name = nm; break; }
          }
        }
        const parH = parseOsmLengthMetersJS(bestParent.tags.height, null);
        const parLvls = parH === null ? parseFloatTagJS(bestParent.tags['building:levels'], null) : null;
        part.parentHeightHint = parH !== null ? parH : (parLvls !== null ? parLvls * lvlHM : null);
        const pTc = bestParent.tags['tower:construction'] || enclosingParents.map(e => e.tags && e.tags['tower:construction']).find(Boolean);
        if ((pTc === 'lattice' || pTc === 'guyed_lattice') && !part.tags['tower:construction']) part.parentTowerConstruction = pTc;
      } else if (part.groupId === null) {
        part.groupId = part.wid;
      }
    }

    const isWheelSuppressedAux = consolidateWheelComplexesS3DB(candidateParents, candidateParts, metersToUnits, addBuildingRecord);
    for (const part of candidateParts) {
      if (isWheelSuppressedAux(part)) { part._suppressedByWheel = true; continue; }
      const t = part.tags, dH = (parseOsmLengthMetersJS(t.height, 0) || 0) - (parseOsmLengthMetersJS(t.min_height, 0) || 0);
      const inheritLat = part.parentTowerConstruction && !t['tower:construction'] && !t.amenity && !t.shop && !t.office && !t.tourism && t.covered !== 'yes' && (t.wall === 'no' || t['building:part'] === 'roof' || dH >= 12.0);
      addBuildingRecord(part.wid, inheritLat ? Object.assign({}, t, { 'tower:construction': part.parentTowerConstruction }) : t, part.pts, part.holes, part.groupId, true, part.parentHeightHint, part.fromBuildingRel);
    }
    const evalCov = (outer, holes, list) => (typeof computeGroundPartsUnionCoverage2D === 'function')
      ? computeGroundPartsUnionCoverage2D(outer, holes, list)
      : _fallbackPartsCoverageS3DB(outer, holes, list);

    for (const parent of candidateParents) {
      if (isWheelSuppressedAux(parent)) continue;
      let maxDefaultHeightCap = null;
      if (parent.hasParts && parent.partCount >= 1) {
        // Explicit OSM type=building relation role=outline is strictly a grouping container
        if (parent.fromBuildingRel) continue;
        // Standalone spatial outline (podium/hotel wing): suppress when parts cover >=78% of ground,
        // >=72% total across >=2 parts, or >=58% in a complete >=3-part cantilevered S3DB stack (ground + elevated upper part)
        const groundCov = parent.groundParts.length > 0 ? evalCov(parent.pts, parent.holes, parent.groundParts) : 0;
        const allCov = parent.partCount >= 2 ? evalCov(parent.pts, parent.holes, parent.allParts) : groundCov;
        const hasCantileverStack = parent.partCount >= 3 &&
          parent.groundParts.length >= 1 &&
          parent.allParts.some(pe => pe && pe.part && (pe.part.minH || 0) > 0.5);
        if (groundCov >= 0.78 || (parent.partCount >= 2 && allCov >= 0.72) || (hasCantileverStack && allCov >= 0.58)) continue;
        if (groundCov > 0 && parent.groundPartHeights.length > 0) {
          const sortedH = parent.groundPartHeights.slice().sort((a, b) => a - b);
          const medH = sortedH[sortedH.length >> 1];
          if (medH >= 6.0) maxDefaultHeightCap = medH;
        }
      }
      addBuildingRecord(parent.wid, parent.tags, parent.pts, parent.holes, parent.groupId || parent.wid, false, null, parent.fromBuildingRel, maxDefaultHeightCap);
    }
    for (let i = 0; i < buildings.length; i++) buildings[i].id = i + 1;
    return buildings;
  }

  return { registerCandidate, addBuildingRecord, resolveAndEmitS3DBBuildings, buildings };
}

const _s3dbMatcherExports = {
  ...(typeof require !== 'undefined' ? (() => {
    try { return { ...require('./s3db_unit_parser.js'), ...require('./s3db_relation_helper.js') }; } catch (_) { return {}; }
  })() : {}),
  createS3DBClientCollector,
};
if (typeof computeSolidInteriorPtJS !== 'undefined') _s3dbMatcherExports.computeSolidInteriorPtJS = computeSolidInteriorPtJS;
if (typeof isObservationWheelTagsJS !== 'undefined') _s3dbMatcherExports.isObservationWheelTagsJS = isObservationWheelTagsJS;
if (typeof SKIP_BUILDING_VALS_JS !== 'undefined') _s3dbMatcherExports.SKIP_BUILDING_VALS_JS = SKIP_BUILDING_VALS_JS;
if (typeof parseFloatTagJS !== 'undefined') _s3dbMatcherExports.parseFloatTagJS = parseFloatTagJS;
if (typeof parseOsmLengthMetersJS !== 'undefined') _s3dbMatcherExports.parseOsmLengthMetersJS = parseOsmLengthMetersJS;
if (typeof parseRoofDirectionJS !== 'undefined') _s3dbMatcherExports.parseRoofDirectionJS = parseRoofDirectionJS;
if (typeof isUndergroundOrSkippedBuildingJS !== 'undefined') _s3dbMatcherExports.isUndergroundOrSkippedBuildingJS = isUndergroundOrSkippedBuildingJS;
if (typeof window !== 'undefined') {
  window.createS3DBClientCollector = createS3DBClientCollector;
  if (_s3dbMatcherExports.isObservationWheelTagsJS) window.isObservationWheelTagsJS = _s3dbMatcherExports.isObservationWheelTagsJS;
  if (_s3dbMatcherExports.computeSolidInteriorPtJS) window.computeSolidInteriorPtJS = _s3dbMatcherExports.computeSolidInteriorPtJS;
}
if (typeof module !== 'undefined' && module.exports) module.exports = _s3dbMatcherExports;
