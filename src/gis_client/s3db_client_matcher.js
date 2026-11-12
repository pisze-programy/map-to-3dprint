// ============================================================================
// src/gis_client/s3db_client_matcher.js
// Client-Side Simple 3D Buildings (S3DB) Tag Parser, Spatial Parent-Part
// Matcher & Coverage-Aware Outline Suppressor (Matching gis/s3db_models.py)
// ============================================================================

const ROOF_SHAPES_NORM = {
  flat: 'flat', gabled: 'gabled', gable: 'gabled', hipped: 'hipped', hip: 'hipped',
  'half-hipped': 'hipped', pyramidal: 'pyramidal', pyramid: 'pyramidal',
  skillion: 'skillion', shed: 'skillion', lean_to: 'skillion', dome: 'dome', round: 'dome',
  onion: 'onion', cone: 'cone', conical: 'cone', mansard: 'mansard', gambrel: 'gambrel'
};

const CARDINAL_DEG_JS = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5
};

const SKIP_BUILDING_VALS_JS = new Set([
  'no', 'none', 'construction', 'proposed', 'demolished', 'razed', 'ruins', 'abandoned', 'underground'
]);

function parseFloatTagJS(val, fallback = null) {
  if (val === undefined || val === null || val === '') return fallback;
  const m = String(val).replace(',', '.').match(/[-+]?\d*\.?\d+/);
  if (!m) return fallback;
  const num = parseFloat(m[0]);
  return Number.isFinite(num) ? num : fallback;
}

function parseRoofDirectionJS(tags) {
  const raw = String(tags['roof:direction'] || tags['roof:slope:direction'] || '').trim().toUpperCase();
  if (!raw) return null;
  if (CARDINAL_DEG_JS[raw] !== undefined) return CARDINAL_DEG_JS[raw];
  const val = parseFloatTagJS(raw, null);
  return val !== null ? Math.round(((val % 360) + 360) % 360 * 10) / 10 : null;
}

function isUndergroundOrSkippedBuildingJS(tags) {
  if (!tags) return true;
  if (tags.location === 'underground' || tags.location === 'underwater') return true;
  if (['yes', 'building_passage', 'culvert'].includes(tags.tunnel)) return true;
  if (['room', 'corridor', 'area', 'level'].includes(tags.indoor)) return true;
  const bVal = String(tags.building || '').toLowerCase().trim();
  const bpVal = String(tags['building:part'] || '').toLowerCase().trim();
  if (SKIP_BUILDING_VALS_JS.has(bVal) && (!bpVal || SKIP_BUILDING_VALS_JS.has(bpVal))) return true;
  if (!bVal && SKIP_BUILDING_VALS_JS.has(bpVal)) return true;
  if (bVal === 'bridge' && tags.min_height === undefined && tags['building:min_level'] === undefined) return true;
  const layerVal = parseFloatTagJS(tags.layer, 0) || 0;
  if (layerVal < -0.5 && tags.height === undefined && tags['building:levels'] === undefined) return true;
  return false;
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
    if (Math.abs(cx) > halfW + 4.0 || Math.abs(cy) > halfH + 4.0) return;

    const outerArea = Math.abs(polyAreaSignedJS(outerPts));
    const holesArea = (holesPts || []).reduce((acc, h) => acc + (h.length >= 3 ? Math.abs(polyAreaSignedJS(h)) : 0), 0);
    const netArea = Math.max(1e-4, outerArea - holesArea);
    let minH = parseFloatTagJS(tags.min_height, 0) || 0;
    const minLvl = parseFloatTagJS(tags['building:min_level'], 0) || 0;
    if (minH === 0 && minLvl > 0) minH = minLvl * 3.3;

    const rec = {
      wid: osmId,
      tags: { ...tags },
      pts: outerPts,
      holes: holesPts || [],
      cx, cy,
      bbox: [minX, minY, maxX, maxY],
      area: outerArea,
      netArea,
      minH,
      hasParts: false,
      partCount: 0,
      partsAreaSum: 0,
      groundPartsAreaSum: 0,
      fromBuildingRel: fromBldRel,
      groupId,
      parentHeightHint: null,
      isPart: Boolean(isPart)
    };
    if (isPart) candidateParts.push(rec);
    else candidateParents.push(rec);
  }

  function addBuildingRecord(osmId, tags, outer, holes, groupId = null, isPart = false, parentHeightHint = null) {
    if (outer.length < 3) return;
    let sx = 0, sy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of outer) {
      sx += p[0]; sy += p[1];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const cx = sx / outer.length, cy = sy / outer.length;
    if (Math.abs(cx) > halfW + 4.0 || Math.abs(cy) > halfH + 4.0) return;

    const spanXM = (maxX - minX) / Math.max(1e-4, metersToUnits);
    const spanYM = (maxY - minY) / Math.max(1e-4, metersToUnits);
    const minSpanM = Math.max(1.5, Math.min(spanXM, spanYM));
    const areaU = Math.abs(polyAreaSignedJS(outer));

    const btype = tags.building || tags['building:part'] || 'yes';
    let name = tags.name || tags['name:en'] || tags['name:pl'] || tags['addr:housename'] || '';
    if (/[\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(name) && tags['name:en']) name = tags['name:en'];
    if (!name && tags['addr:street']) name = `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim();

    const levels = parseFloatTagJS(tags['building:levels'], null);
    const explicitH = parseFloatTagJS(tags.height, null);
    let h = explicitH;
    let minH = parseFloatTagJS(tags.min_height, 0.0) || 0.0;
    const minLevel = parseFloatTagJS(tags['building:min_level'], 0.0) || 0.0;
    if (minH === 0.0 && minLevel > 0) minH = minLevel * 3.3;

    const isChurch = btype === 'church' || btype === 'cathedral' || btype === 'chapel' ||
      tags.amenity === 'place_of_worship' ||
      (!isPart && /(kirche|kościół|bazylika|katedra|church|cathedral)/i.test(name));
    const isTower = btype === 'tower' || btype === 'bell_tower' || btype === 'water_tower' ||
      ['tower', 'chimney', 'lighthouse'].includes(tags.man_made) || Boolean(tags['tower:type']);

    const rawRoof = String(tags['roof:shape'] || '').toLowerCase().trim();
    let roof = rawRoof ? (ROOF_SHAPES_NORM[rawRoof] || 'flat') : ((isChurch && !isPart && areaU > 6.0) ? 'gabled' : 'flat');
    const roofOrient = String(tags['roof:orientation'] || '').toLowerCase().trim() === 'across' ? 'across' : 'along';
    const roofDir = parseRoofDirectionJS(tags);

    let roofH = 0.0;
    if (roof !== 'flat') {
      const roofHTag = parseFloatTagJS(tags['roof:height'], null);
      const roofLvlTag = parseFloatTagJS(tags['roof:levels'], null);
      if (roofHTag !== null) roofH = roofHTag;
      else if (roofLvlTag !== null) roofH = roofLvlTag * 3.1;
      else roofH = Math.min(minSpanM * 0.42, 10.0);
    }

    if (h === null) {
      if (levels !== null) {
        h = levels * 3.55 + roofH;
      } else if (isPart) {
        let baseEst = Math.min(18.0, Math.max(5.5, minSpanM * 1.45));
        if (parentHeightHint !== null) baseEst = Math.min(baseEst, parentHeightHint * 0.65);
        h = baseEst + roofH;
      } else if (isChurch) {
        h = 26.0 + roofH;
      } else if (isTower) {
        h = 44.0 + roofH;
      } else if (['public', 'civic', 'museum', 'university', 'palace', 'government', 'train_station', 'hotel'].includes(btype)) {
        h = (btype === 'museum' && areaU > 250.0 ? 14.5 : 21.0) + roofH;
      } else if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow'].includes(btype)) {
        h = 8.5 + roofH;
      } else if (['apartments', 'residential', 'commercial', 'office', 'retail'].includes(btype)) {
        h = (areaU > 7.5 ? 18.5 : 14.5) + roofH;
      } else if (['garage', 'shed', 'hut', 'kiosk', 'roof', 'service', 'toilets', 'boathouse', 'allotment_house', 'transformer_tower'].includes(btype)) {
        h = 4.0 + roofH;
      } else {
        h = (areaU > 5.5 ? 16.5 : 12.0) + roofH;
      }
    }

    if (minH >= h - 0.5) {
      minH = (explicitH !== null && h > 12.0) ? Math.max(0.0, h - 2.0) : 0.0;
    }

    if (roof !== 'flat') {
      const availH = Math.max(0.0, h - minH - 0.8);
      if (['dome', 'onion', 'cone', 'pyramidal'].includes(roof)) {
        roofH = Math.min(roofH, availH, Math.max(minSpanM * 1.15, 3.0));
      } else {
        roofH = Math.min(roofH, availH, h * 0.45, minSpanM * 0.55);
      }
    }

    const rec = {
      id: buildings.length + 1,
      osmId,
      groupId: groupId !== null ? groupId : osmId,
      name: name || (isChurch ? `Kościół #${osmId}` : (isPart ? `Część #${osmId}` : `Budynek OSM #${osmId}`)),
      btype,
      cx: Math.round(cx * 100) / 100,
      cy: Math.round(cy * 100) / 100,
      outer,
      holes,
      h: Math.round(h * 10) / 10,
      minH: Math.round(minH * 10) / 10,
      levels: levels !== null ? Math.max(1, Math.round(levels)) : Math.max(1, Math.round(Math.max(3.0, h - roofH) / 3.5)),
      roof,
      roofH: Math.round(roofH * 10) / 10,
      roofOrient,
      part: Boolean(isPart),
      isOutline: false,
      church: isChurch,
      tower: isTower,
      landmark: Boolean(tags.name || tags.wikidata || tags.heritage || isChurch || isTower)
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

    for (const part of candidateParts) {
      let bestParent = null;
      const enclosingParents = [];
      if (part.groupId !== null && parentByGroup.has(part.groupId)) {
        const cands = parentByGroup.get(part.groupId);
        enclosingParents.push(...cands);
        bestParent = cands.reduce((best, p) => (
          Math.abs(p.cx - part.cx) + Math.abs(p.cy - part.cy) < Math.abs(best.cx - part.cx) + Math.abs(best.cy - part.cy) ? p : best
        ), cands[0]);
      }
      let bestArea = Infinity;
      const [pMinX, pMinY, pMaxX, pMaxY] = part.bbox;
      for (const parent of candidateParents) {
        const [parMinX, parMinY, parMaxX, parMaxY] = parent.bbox;
        if (pMinX > parMaxX + 0.12 || pMaxX < parMinX - 0.12 || pMinY > parMaxY + 0.12 || pMaxY < parMinY - 0.12) continue;
        const inHole = parent.holes.some(h => pointInPolyLocal(part.cx, part.cy, h));
        let enclosed = false;
        if (!inHole && pointInPolyLocal(part.cx, part.cy, parent.pts)) {
          enclosed = true;
        } else {
          let inCnt = 0;
          for (const pt of part.pts) {
            if (pointInPolyLocal(pt[0], pt[1], parent.pts) && !parent.holes.some(h => pointInPolyLocal(pt[0], pt[1], h))) inCnt++;
          }
          if (inCnt >= part.pts.length * 0.55) enclosed = true;
        }
        if (enclosed) {
          if (!enclosingParents.includes(parent)) enclosingParents.push(parent);
          if (!bestParent || (part.groupId === null && parent.area < bestArea)) {
            bestArea = parent.area;
            bestParent = parent;
          }
        }
      }

      for (const ep of enclosingParents) {
        ep.hasParts = true;
        ep.partCount++;
        ep.partsAreaSum += part.netArea;
        if (part.minH <= 3.5) ep.groundPartsAreaSum += part.netArea;
      }

      if (bestParent) {
        if (part.groupId === null) part.groupId = bestParent.groupId || bestParent.wid;
        for (const ep of enclosingParents) {
          if (ep.groupId === null) ep.groupId = part.groupId;
        }
        if (!part.tags.name) {
          for (const ep of enclosingParents.slice().sort((a, b) => b.area - a.area)) {
            const nm = ep.tags.name || ep.tags['name:en'] || ep.tags['name:pl'];
            if (nm) { part.tags.name = nm; break; }
          }
        }
        let parH = parseFloatTagJS(bestParent.tags.height, null);
        if (parH === null) {
          const parLvls = parseFloatTagJS(bestParent.tags['building:levels'], null);
          if (parLvls !== null) parH = parLvls * 3.55;
        }
        part.parentHeightHint = parH;
      } else if (part.groupId === null) {
        part.groupId = part.wid;
      }
    }

    for (const part of candidateParts) {
      addBuildingRecord(part.wid, part.tags, part.pts, part.holes, part.groupId, true, part.parentHeightHint);
    }
    for (const parent of candidateParents) {
      let suppress = false;
      if (parent.hasParts) {
        const groundCov = parent.groundPartsAreaSum / Math.max(1e-4, parent.netArea);
        const totalCov = parent.partsAreaSum / Math.max(1e-4, parent.netArea);
        if (groundCov >= 0.30 || totalCov >= 0.35 || (parent.fromBuildingRel && totalCov >= 0.25)) suppress = true;
      }
      if (!suppress) {
        addBuildingRecord(parent.wid, parent.tags, parent.pts, parent.holes, parent.groupId || parent.wid, false);
      }
    }

    for (let i = 0; i < buildings.length; i++) buildings[i].id = i + 1;
    return buildings;
  }

  return { registerCandidate, addBuildingRecord, resolveAndEmitS3DBBuildings, buildings };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SKIP_BUILDING_VALS_JS,
    parseFloatTagJS,
    parseRoofDirectionJS,
    isUndergroundOrSkippedBuildingJS,
    createS3DBClientCollector
  };
}
