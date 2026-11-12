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
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function _minBoundaryDistSqS3DB(px, py, outerPts, holesPts) {
  let minDSq = Infinity;
  const checkRing = (ring) => {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 1e-12 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq)) : 0;
      const qx = a[0] + t * dx, qy = a[1] + t * dy;
      const dSq = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (dSq < minDSq) minDSq = dSq;
    }
  };
  checkRing(outerPts);
  if (holesPts) {
    for (let h = 0; h < holesPts.length; h++) {
      if (holesPts[h] && holesPts[h].length >= 3) checkRing(holesPts[h]);
    }
  }
  return minDSq;
}

// Guaranteed solid interior point strictly inside outerPts and strictly outside all holesPts
// (handles O-shaped courtyard rings, U/C/L-shaped wings, and concave footprints).
function computeSolidInteriorPtJS(outerPts, holesPts) {
  if (!outerPts || outerPts.length === 0) return [0, 0];
  let sx = 0, sy = 0, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < outerPts.length; i++) {
    const p = outerPts[i];
    sx += p[0]; sy += p[1];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const cx = sx / outerPts.length, cy = sy / outerPts.length;
  const holes = (holesPts || []).filter(h => h && h.length >= 3);
  const inAnyHole = (px, py) => {
    for (let h = 0; h < holes.length; h++) {
      if (_pointInPolyS3DB(px, py, holes[h])) return true;
    }
    return false;
  };

  if (_pointInPolyS3DB(cx, cy, outerPts) && !inAnyHole(cx, cy) && _minBoundaryDistSqS3DB(cx, cy, outerPts, holes) > 1e-6) {
    return [cx, cy];
  }

  // Collect candidate horizontal scanline Y-levels from sorted vertex Y intervals
  const ys = [];
  for (let i = 0; i < outerPts.length; i++) ys.push(outerPts[i][1]);
  for (let h = 0; h < holes.length; h++) {
    for (let i = 0; i < holes[h].length; i++) ys.push(holes[h][i][1]);
  }
  ys.sort((a, b) => a - b);

  const yMids = [];
  for (let i = 0; i < ys.length - 1; i++) {
    if (ys[i + 1] - ys[i] > 1e-5) yMids.push((ys[i] + ys[i + 1]) * 0.5);
  }
  if (maxY - minY > 1e-5) {
    for (let k = 1; k <= 7; k++) yMids.push(minY + (maxY - minY) * (k / 8));
  }

  const maxScans = 28;
  const scanYs = yMids.length <= maxScans
    ? yMids
    : Array.from({ length: maxScans }, (_, idx) => yMids[Math.floor((idx * yMids.length) / maxScans)]);

  let bestPt = null;
  let bestScore = -1;

  const collectHits = (ring, yScan, xs) => {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      if ((a[1] > yScan) !== (b[1] > yScan)) {
        xs.push(a[0] + (yScan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
  };

  for (let si = 0; si < scanYs.length; si++) {
    const yScan = scanYs[si];
    const xs = [];
    collectHits(outerPts, yScan, xs);
    for (let h = 0; h < holes.length; h++) collectHits(holes[h], yScan, xs);
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);

    for (let k = 0; k < xs.length - 1; k++) {
      const w = xs[k + 1] - xs[k];
      if (w <= 1e-5) continue;
      const xm = (xs[k] + xs[k + 1]) * 0.5;
      if (_pointInPolyS3DB(xm, yScan, outerPts) && !inAnyHole(xm, yScan)) {
        const clr = Math.sqrt(_minBoundaryDistSqS3DB(xm, yScan, outerPts, holes));
        const score = Math.min(w * 0.5, clr);
        if (score > bestScore) {
          bestScore = score;
          bestPt = [xm, yScan];
        }
      }
    }
  }

  if (bestPt) return bestPt;

  // Fallback for ultra-thin degenerate sliver: step slightly inward from longest outer edge midpoint
  const sign = _polyAreaSignedS3DB(outerPts) >= 0 ? 1 : -1;
  for (let i = 0, n = outerPts.length; i < n; i++) {
    const a = outerPts[i], b = outerPts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-5) {
      const nx = (-dy / len) * sign, ny = (dx / len) * sign;
      const px = (a[0] + b[0]) * 0.5 + nx * Math.min(1e-3, len * 0.05);
      const py = (a[1] + b[1]) * 0.5 + ny * Math.min(1e-3, len * 0.05);
      if (_pointInPolyS3DB(px, py, outerPts) && !inAnyHole(px, py)) return [px, py];
    }
  }
  return [outerPts[0][0], outerPts[0][1]];
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

    const validHoles = (holesPts || []).filter(h => {
      if (!Array.isArray(h) || h.length < 3) return false;
      const hip = computeSolidInteriorPtJS(h, []);
      return _pointInPolyS3DB(hip[0], hip[1], outerPts);
    });
    const interiorPt = computeSolidInteriorPtJS(outerPts, validHoles);

    if (Math.min(Math.abs(cx), Math.abs(interiorPt[0])) > halfW + 4.0 ||
        Math.min(Math.abs(cy), Math.abs(interiorPt[1])) > halfH + 4.0) return;

    const outerArea = Math.abs(_polyAreaSignedS3DB(outerPts));
    const holesArea = validHoles.reduce((acc, h) => acc + Math.abs(_polyAreaSignedS3DB(h)), 0);
    const netArea = Math.max(1e-4, outerArea - holesArea);
    let minH = parseFloatTagJS(tags.min_height, 0) || 0;
    const minLvl = parseFloatTagJS(tags['building:min_level'], 0) || 0;
    if (minH === 0 && minLvl > 0) minH = minLvl * 3.3;

    const rec = {
      wid: osmId,
      tags: { ...tags },
      pts: outerPts,
      holes: validHoles,
      cx, cy,
      interiorPt,
      bbox: [minX, minY, maxX, maxY],
      area: outerArea,
      netArea,
      minH,
      hasParts: false,
      partCount: 0,
      groundPartCount: 0,
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
      const [pix, piy] = part.interiorPt;
      const [pMinX, pMinY, pMaxX, pMaxY] = part.bbox;

      if (part.groupId !== null && parentByGroup.has(part.groupId)) {
        const cands = parentByGroup.get(part.groupId);
        const overlappingCands = cands.filter(p => {
          const [parMinX, parMinY, parMaxX, parMaxY] = p.bbox;
          if (pMinX > parMaxX + 0.25 || pMaxX < parMinX - 0.25 || pMinY > parMaxY + 0.25 || pMaxY < parMinY - 0.25) return false;
          return !p.holes.some(h => h.length >= 3 && _pointInPolyS3DB(pix, piy, h));
        });
        const useCands = overlappingCands.length > 0 ? overlappingCands : cands;
        enclosingParents.push(...useCands);
        bestParent = useCands.reduce((best, p) => (
          Math.abs(p.interiorPt[0] - pix) + Math.abs(p.interiorPt[1] - piy) <
          Math.abs(best.interiorPt[0] - pix) + Math.abs(best.interiorPt[1] - piy) ? p : best
        ), useCands[0]);
      }

      let bestArea = Infinity;
      for (const parent of candidateParents) {
        const [parMinX, parMinY, parMaxX, parMaxY] = parent.bbox;
        if (pMinX > parMaxX + 0.12 || pMaxX < parMinX - 0.12 || pMinY > parMaxY + 0.12 || pMaxY < parMinY - 0.12) continue;
        const inHole = parent.holes.some(h => h.length >= 3 && _pointInPolyS3DB(pix, piy, h));
        let enclosed = false;
        if (!inHole && _pointInPolyS3DB(pix, piy, parent.pts)) {
          enclosed = true;
        } else if (!inHole) {
          // Sample vertices & edge midpoints nudged slightly toward solid interiorPt so perimeter
          // wings sharing exact boundary edges with parent outlines reliably register as enclosed.
          let inCnt = 0, totalSamples = 0;
          const nPts = part.pts.length;
          for (let k = 0; k < nPts; k++) {
            const a = part.pts[k], b = part.pts[(k + 1) % nPts];
            const vx = a[0] + (pix - a[0]) * 1e-3, vy = a[1] + (piy - a[1]) * 1e-3;
            totalSamples++;
            if (_pointInPolyS3DB(vx, vy, parent.pts) && !parent.holes.some(h => h.length >= 3 && _pointInPolyS3DB(vx, vy, h))) {
              inCnt++;
            }
            const mx0 = (a[0] + b[0]) * 0.5, my0 = (a[1] + b[1]) * 0.5;
            const mx = mx0 + (pix - mx0) * 1e-3, my = my0 + (piy - my0) * 1e-3;
            totalSamples++;
            if (_pointInPolyS3DB(mx, my, parent.pts) && !parent.holes.some(h => h.length >= 3 && _pointInPolyS3DB(mx, my, h))) {
              inCnt++;
            }
          }
          if (totalSamples > 0 && inCnt >= totalSamples * 0.55) enclosed = true;
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
        if (part.minH <= 3.5) {
          ep.groundPartsAreaSum += part.netArea;
          ep.groundPartCount++;
        }
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
        const relOutlineDefined = parent.fromBuildingRel && (groundCov >= 0.12 || totalCov >= 0.15);
        const holelessMultiWing = parent.holes.length === 0 && parent.groundPartCount >= 2 && groundCov >= 0.16;
        if (groundCov >= 0.28 || totalCov >= 0.34 || relOutlineDefined || holelessMultiWing) suppress = true;
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

if (typeof window !== 'undefined') {
  window.computeSolidInteriorPtJS = computeSolidInteriorPtJS;
  window.createS3DBClientCollector = createS3DBClientCollector;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SKIP_BUILDING_VALS_JS,
    parseFloatTagJS,
    parseRoofDirectionJS,
    isUndergroundOrSkippedBuildingJS,
    computeSolidInteriorPtJS,
    createS3DBClientCollector
  };
}
