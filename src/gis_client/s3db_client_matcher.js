// ============================================================================
// src/gis_client/s3db_client_matcher.js
// Client-Side Simple 3D Buildings (S3DB) Tag Parser, Spatial Parent-Part
// Matcher & Coverage-Aware Outline Suppressor (Matching gis/s3db_models.py)
// ============================================================================

if (typeof OSM_METRIC_CONFIG === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('../geometry/print_physics_config.js')); } catch (_) {}
}

const ROOF_SHAPES_NORM = {
  flat: 'flat', gabled: 'gabled', gable: 'gabled', saltbox: 'gabled', basilical: 'gabled',
  hipped: 'hipped', hip: 'hipped', 'half-hipped': 'hipped', side_hipped: 'hipped',
  pyramidal: 'pyramidal', pyramid: 'pyramidal',
  skillion: 'skillion', shed: 'skillion', lean_to: 'skillion',
  round: 'round', round_gabled: 'round', barrel: 'round',
  dome: 'dome', onion: 'onion', cone: 'cone', conical: 'cone',
  mansard: 'mansard', quadruple_saltbox: 'mansard',
  gambrel: 'gambrel', double_saltbox: 'gambrel'
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

const WHEEL_ATTRACTION_VALS_JS = new Set(['big_wheel', 'observation_wheel', 'ferris_wheel']);

function isObservationWheelTagsJS(tags) {
  if (!tags) return false;
  const attr = String(tags.attraction || '').toLowerCase().trim();
  const tt = String(tags['tower:type'] || '').toLowerCase().trim();
  const ride = String(tags.amusement_ride || '').toLowerCase().trim();
  const bpart = String(tags['building:part'] || '').toLowerCase().trim();
  const bldg = String(tags.building || '').toLowerCase().trim();
  return Boolean(
    WHEEL_ATTRACTION_VALS_JS.has(attr) ||
    tt === 'observation_wheel' ||
    WHEEL_ATTRACTION_VALS_JS.has(ride) ||
    bpart === 'ferris_wheel' ||
    bpart === 'observation_wheel' ||
    bldg === 'ferris_wheel' ||
    bldg === 'observation_wheel'
  );
}

function hasAllNegativeLevelJS(tags) {
  if (!tags || tags.level === undefined || tags.level === null || tags.level === '') return false;
  const nums = String(tags.level)
    .split(/[;,]/)
    .map(s => parseFloat(s.trim().replace(',', '.')))
    .filter(Number.isFinite);
  return nums.length > 0 && nums.every(v => v < 0);
}

function isUndergroundOrSkippedBuildingJS(tags) {
  if (!tags) return true;
  if (tags.location === 'underground' || tags.location === 'underwater') return true;
  if (['yes', 'building_passage', 'culvert'].includes(tags.tunnel)) return true;
  const bVal = String(tags.building || '').toLowerCase().trim();
  const bpVal = String(tags['building:part'] || '').toLowerCase().trim();
  const indoorVal = String(tags.indoor || '').toLowerCase().trim();
  if (['room', 'corridor', 'area', 'level'].includes(indoorVal)) return true;
  if (indoorVal === 'yes' && !tags['roof:shape'] && bVal !== 'roof' && bpVal !== 'roof') return true;
  if (hasAllNegativeLevelJS(tags)) return true;
  if (SKIP_BUILDING_VALS_JS.has(bVal) && (!bpVal || SKIP_BUILDING_VALS_JS.has(bpVal))) return true;
  if (!bVal && SKIP_BUILDING_VALS_JS.has(bpVal)) return true;
  if (bVal === 'bridge' && tags.min_height === undefined && tags['building:min_level'] === undefined) return true;
  const layerVal = parseFloatTagJS(tags.layer, 0) || 0;
  if ((bpVal === 'elevator' || tags.highway === 'elevator' || tags.elevator === 'yes') &&
      (indoorVal === 'yes' || layerVal < 0 || (!bVal && !tags.height && !tags['building:height']))) {
    return true;
  }
  const bLevels = parseFloatTagJS(tags['building:levels'], null);
  if (bLevels !== null && bLevels <= 0 &&
      tags.height === undefined && tags['building:height'] === undefined &&
      tags.est_height === undefined && !tags['roof:shape']) {
    return true;
  }
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

const HISTORIC_ARCH_RE_JS = /\b(gothic|baroque|renaissance|romanesque|medieval|timber|half-timbered|classic|neoclassic|neogothic|historic|tudor|victorian|georgian|wilhelminian|gruenderzeit)\b/i;
const TRAD_PITCHED_ROOFS_JS = new Set(['gabled', 'gable', 'half-hipped', 'hipped', 'hip', 'gambrel', 'mansard', 'saltbox', 'double_saltbox', 'quadruple_saltbox', 'pyramidal']);
const CIVIC_TRAD_TYPES_JS = new Set(['government', 'townhall', 'cathedral', 'church', 'chapel', 'castle', 'palace', 'civic', 'public', 'synagogue', 'monastery']);

function computeRingRadialCircularityJS(outer, minX, maxX, minY, maxY, cx, cy) {
  if (!outer || outer.length < 10) return { rCv: 1.0, isoperimetric: 0 };
  let perim = 0;
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const a = outer[i], b = outer[(i + 1) % n];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const area = Math.abs(_polyAreaSignedS3DB(outer));
  const isoperimetric = perim > 1e-6 ? (4.0 * Math.PI * area) / (perim * perim) : 0;
  const evalCv = (mx, my) => {
    let sumR = 0;
    const rs = new Array(n);
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(outer[i][0] - mx, outer[i][1] - my);
      rs[i] = r;
      sumR += r;
    }
    const meanR = sumR / n;
    if (meanR <= 1e-6) return 1.0;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const d = rs[i] - meanR;
      varSum += d * d;
    }
    return Math.sqrt(varSum / n) / meanR;
  };
  const bx = (minX + maxX) * 0.5, by = (minY + maxY) * 0.5;
  return { rCv: Math.min(evalCv(bx, by), evalCv(cx, cy)), isoperimetric };
}

function isHistoricAnchorTagsJS(tags, areaM2) {
  if (!tags) return false;
  const histVal = String(tags.historic || '').toLowerCase().trim();
  if (histVal && !['memorial', 'monument', 'archaeological_site', 'ruins', 'wayside_cross', 'wayside_shrine'].includes(histVal)) {
    return true;
  }
  const startYear = tags.start_date ? parseInt(String(tags.start_date), 10) : NaN;
  if (Number.isFinite(startYear) && startYear > 0 && startYear < 1945) return true;
  if (tags['building:material'] === 'timber_framing') return true;
  if (HISTORIC_ARCH_RE_JS.test(String(tags['building:architecture'] || ''))) return true;
  const rs = String(tags['roof:shape'] || '').toLowerCase().trim();
  if (rs && TRAD_PITCHED_ROOFS_JS.has(rs) && areaM2 <= 650.0) return true;
  return false;
}

function createS3DBClientCollector(halfW, halfH, metersToUnits) {
  const candidateParents = [];
  const candidateParts = [];
  const buildings = [];
  let _contextState = null;

  function computeRecordMetricsM(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const mToU = Math.max(1e-4, metersToUnits);
    let rawMinSpanM = Math.min(maxX - minX, maxY - minY) / mToU;
    let rawMaxSpanM = Math.max(maxX - minX, maxY - minY) / mToU;
    if (typeof computeMinAreaOBB2D === 'function' && pts.length >= 3) {
      const obb = computeMinAreaOBB2D(pts);
      if (obb && obb.halfL > 0) {
        rawMinSpanM = (obb.halfW * 2) / mToU;
        rawMaxSpanM = (obb.halfL * 2) / mToU;
      }
    }
    const areaU = Math.abs(_polyAreaSignedS3DB(pts));
    const areaM2 = areaU / (mToU * mToU);
    return { minX, maxX, minY, maxY, rawMinSpanM, rawMaxSpanM, areaU, areaM2 };
  }

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
    const _minLvlM = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.minLevelHeightM : 3.5;
    if (minH === 0 && minLvl > 0) minH = minLvl * _minLvlM;

    const archType = isObservationWheelTagsJS(tags) ? 'ferris_wheel' : null;
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
      archType,
      isFerrisWheel: archType === 'ferris_wheel',
      hasParts: false,
      partCount: 0,
      groundPartCount: 0,
      allParts: [],
      groundParts: [],
      groundPartHeights: [],
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

  function addBuildingRecord(osmId, tags, outer, holes, groupId = null, isPart = false, parentHeightHint = null, maxDefaultHeightCap = null) {
    if (outer.length < 3) return;
    let sx = 0, sy = 0;
    for (const p of outer) {
      sx += p[0]; sy += p[1];
    }
    const cx = sx / outer.length, cy = sy / outer.length;
    if (Math.abs(cx) > halfW + 4.0 || Math.abs(cy) > halfH + 4.0) return;

    const mToU = Math.max(1e-4, metersToUnits);
    const { minX, maxX, minY, maxY, rawMinSpanM, rawMaxSpanM, areaU, areaM2 } = computeRecordMetricsM(outer);
    const minSpanM = Math.max(1.5, rawMinSpanM);
    const maxSpanM = rawMaxSpanM;
    const wingHalfU = (typeof computeCharacteristicWingHalfWidth2D === 'function')
      ? computeCharacteristicWingHalfWidth2D(outer, holes || [])
      : (minSpanM * mToU * 0.5);
    const wingSpanM = Math.max(1.5, (wingHalfU * 2.0) / mToU);
    const effPitchSpanM = Math.min(minSpanM, wingSpanM);

    const archType = tags._archTypeOverride || (isObservationWheelTagsJS(tags) ? 'ferris_wheel' : null);
    const isFerrisWheel = archType === 'ferris_wheel';
    const btype = String(tags.building || tags['building:part'] || (isFerrisWheel ? 'observation_wheel' : 'yes')).toLowerCase().trim();
    let name = tags.name || tags['name:en'] || tags['name:pl'] || tags['addr:housename'] || '';
    if (/[\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(name) && tags['name:en']) name = tags['name:en'];
    if (!name && tags['addr:street']) name = `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim();

    const levels = parseFloatTagJS(tags['building:levels'], null);
    const hPrimary = parseFloatTagJS(tags.height, null);
    const hBldTag = hPrimary !== null ? hPrimary : parseFloatTagJS(tags['building:height'], null);
    const explicitH = hBldTag !== null ? hBldTag : parseFloatTagJS(tags.est_height, null);
    let h = explicitH;
    let minH = isFerrisWheel ? 0.0 : (parseFloatTagJS(tags.min_height, 0.0) || 0.0);
    const minLevel = parseFloatTagJS(tags['building:min_level'], 0.0) || 0.0;
    const _minLvlM = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.minLevelHeightM : 3.5;
    if (!isFerrisWheel && minH === 0.0 && minLevel > 0) minH = minLevel * _minLvlM;

    // Skip thin floating horizontal ornamental crossbars on towers/spires (e.g. cross arms at minH >= 15m)
    if (isPart && minH >= 15.0 && explicitH !== null &&
        (explicitH - minH) > 0 && (explicitH - minH) <= 1.5 &&
        rawMaxSpanM <= 4.0 && rawMinSpanM <= 1.6) {
      return;
    }

    const isChurch = btype === 'church' || btype === 'cathedral' || btype === 'chapel' || btype === 'basilica' ||
      tags.amenity === 'place_of_worship' || tags.historic === 'church' || tags.historic === 'cathedral';
    const isTower = btype === 'tower' || btype === 'bell_tower' || btype === 'water_tower' ||
      ['tower', 'chimney', 'lighthouse'].includes(tags.man_made) || Boolean(tags['tower:type']) || isFerrisWheel;

    const circ = computeRingRadialCircularityJS(outer, minX, maxX, minY, maxY, cx, cy);
    const aspect = rawMaxSpanM / Math.max(0.5, rawMinSpanM);
    const isCircularDrumShape = outer.length >= 10 && circ.rCv <= 0.065 && circ.isoperimetric >= 0.86 &&
      aspect <= 1.20 && rawMinSpanM >= 8.0 && rawMaxSpanM <= 34.0;

    let isRotundaDrum = false;
    if (isPart && !isTower && !isFerrisWheel && h === null && levels === null && isCircularDrumShape) {
      const grpSpanM = (_contextState && groupId !== null && _contextState.groupMaxSpanM.get(groupId)) || 0;
      const hasLargerComplex = grpSpanM >= rawMaxSpanM * 1.8 ||
        Boolean(_contextState && _contextState.hasLargerComplexNear(cx, cy, rawMaxSpanM * 1.8));
      if (hasLargerComplex) isRotundaDrum = true;
    }

    const rawRoof = String(tags['roof:shape'] || '').toLowerCase().trim();
    const hasExplicitRoofH = Boolean(tags['roof:height'] !== undefined || tags['roof:levels'] !== undefined);
    let roof = rawRoof ? (ROOF_SHAPES_NORM[rawRoof] || 'flat') : ((isChurch && !isPart && areaU > 6.0) ? 'gabled' : 'flat');
    const roofOrient = String(tags['roof:orientation'] || '').toLowerCase().trim() === 'across' ? 'across' : 'along';
    const roofDir = parseRoofDirectionJS(tags);

    const startMatch = tags.start_date ? String(tags.start_date).match(/\b(1[0-9]{3})\b/) : null;
    const startYear = startMatch ? parseInt(startMatch[1], 10) : NaN;
    const histTag = String(tags.historic || '').toLowerCase().trim();
    const isExplicitHistoric = Boolean(histTag && !['memorial', 'monument', 'archaeological_site', 'ruins'].includes(histTag)) ||
      (Number.isFinite(startYear) && startYear > 0 && startYear < 1945) ||
      tags['building:material'] === 'timber_framing' ||
      HISTORIC_ARCH_RE_JS.test(String(tags['building:architecture'] || ''));

    const isNonTradType = [
      'industrial', 'warehouse', 'hangar', 'commercial', 'office', 'retail_park', 'supermarket',
      'parking', 'garages', 'garage', 'roof', 'shed', 'kiosk', 'containers', 'bridge',
      'train_station', 'transportation', 'hospital', 'university'
    ].includes(btype);

    const isPitchEligibleType = ![
      'industrial', 'warehouse', 'hangar', 'parking', 'garages', 'garage', 'roof', 'shed',
      'kiosk', 'containers', 'bridge', 'train_station', 'transportation'
    ].includes(btype);

    const isFinialPinnacle = isPart && !rawRoof && !isFerrisWheel && rawMaxSpanM <= 2.2 && (explicitH || 0) >= 18.0 &&
      (['gold', 'copper', 'metal', 'bronze'].includes(String(tags['building:material'] || '').toLowerCase()) || rawMinSpanM <= 1.2);

    const isCivicPitchCandidate = !isPart && !rawRoof && !isTower && !isFerrisWheel &&
      (isExplicitHistoric || CIVIC_TRAD_TYPES_JS.has(btype) || tags.amenity === 'townhall' || tags.amenity === 'place_of_worship') &&
      isPitchEligibleType &&
      ((isExplicitHistoric || tags.amenity === 'townhall' || isChurch)
        ? ((rawMinSpanM <= 36.0 && areaM2 <= 3200.0) || (wingSpanM <= 56.0 && rawMinSpanM <= 88.0 && areaM2 <= 9500.0) || (isExplicitHistoric && holes && holes.length > 0 && wingSpanM <= 38.0 && rawMinSpanM <= 140.0 && areaM2 <= 15000.0))
        : (rawMinSpanM <= 32.0 && areaM2 <= 1800.0 && (explicitH === null || explicitH <= 32.0) && (levels === null || levels <= 7)));

    const isHistoricOriel = isPart && !rawRoof && !isFerrisWheel && btype === 'oriel' && isExplicitHistoric && rawMaxSpanM <= 8.0;

    const isHistoricPartTurret = isPart && !rawRoof && !isFerrisWheel && !isFinialPinnacle && !isRotundaDrum && !isHistoricOriel &&
      minH <= 0.5 && isExplicitHistoric && isPitchEligibleType &&
      rawMaxSpanM <= 12.0 && aspect <= 1.35 && (isTower || btype === 'yes' || btype === 'turret' || btype === 'tower');

    const isHistoricWingPart = isPart && !rawRoof && !isTower && !isFerrisWheel && !isHistoricOriel &&
      minH <= 0.5 && isExplicitHistoric && isPitchEligibleType && !isNonTradType && !isHistoricPartTurret &&
      wingSpanM <= 38.0 && rawMinSpanM <= 78.0 && areaM2 >= 20.0 && areaM2 <= 9500.0 &&
      (explicitH === null || explicitH <= 36.0) && (levels === null || levels <= 8);

    const nearHistCount = (!isPart && !rawRoof && !isTower && !isFerrisWheel && !isCivicPitchCandidate && _contextState)
      ? _contextState.countHistoricAnchorsNear(cx, cy, 95.0 * mToU)
      : 0;
    const isOldTownPlot = !isPart && !rawRoof && !isTower && !isFerrisWheel && !isNonTradType &&
      areaM2 >= 22.0 && areaM2 <= 540.0 && rawMinSpanM >= 4.0 && rawMinSpanM <= 17.5 && rawMaxSpanM <= 38.0 &&
      (levels === null || levels <= 6) && (explicitH === null || explicitH <= 26.0) &&
      nearHistCount >= 3;

    // Infer roofs for finials, rotundas, historic spires, historic civic halls & old-town quarters
    if (isFinialPinnacle) {
      roof = 'cone';
    } else if (isRotundaDrum && !rawRoof) {
      roof = 'cone';
    } else if (!rawRoof && (isTower || isHistoricPartTurret) && !isFerrisWheel && rawMaxSpanM <= 16.0) {
      const tType = String(tags['tower:type'] || '').toLowerCase().trim();
      const histArch = HISTORIC_ARCH_RE_JS.test(String(tags['building:architecture'] || ''));
      if (isHistoricPartTurret || isExplicitHistoric || histArch || ['bell_tower', 'defensive', 'church', 'watchtower'].includes(tType) || btype === 'bell_tower') {
        roof = (circ.rCv <= 0.08 && outer.length >= 10) ? 'cone' : 'pyramidal';
      }
    } else if ((isCivicPitchCandidate || isHistoricWingPart || isHistoricOriel || isOldTownPlot) && !rawRoof && roof === 'flat') {
      roof = (isHistoricOriel || areaM2 > 900.0 || rawMinSpanM > 20.0 || (holes && holes.length > 0)) ? 'hipped' : 'gabled';
    }

    let roofH = 0.0;
    const _lvlH = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.levelHeightM : 3.5;
    const _roofLvlH = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.roofLevelHeightM : 3.0;
    if (roof !== 'flat') {
      const roofHTag = parseFloatTagJS(tags['roof:height'], null);
      const roofLvlTag = parseFloatTagJS(tags['roof:levels'], null);
      if (roofHTag !== null) roofH = roofHTag;
      else if (roofLvlTag !== null) roofH = roofLvlTag * _roofLvlH;
      else if (isFinialPinnacle) roofH = Math.min(Math.max(1.8, rawMinSpanM * 2.2), Math.max(2.0, ((explicitH || 20) - minH) * 0.45));
      else if (isRotundaDrum) roofH = Math.round(Math.max(2.0, minSpanM * 0.14) * 10) / 10;
      else if ((isTower || isHistoricPartTurret) && (roof === 'cone' || roof === 'pyramidal')) roofH = Math.min(Math.max(4.0, minSpanM * 1.15), 11.0);
      else if (isHistoricOriel) roofH = Math.min(Math.max(1.2, effPitchSpanM * 0.65), 3.2);
      else if (isCivicPitchCandidate || isHistoricWingPart || isOldTownPlot) roofH = Math.round(Math.min(Math.max(3.6, effPitchSpanM * 0.52), 8.5) * 10) / 10;
      else roofH = Math.min(effPitchSpanM * 0.42, 10.0);
    }

    const heightSource = explicitH !== null ? 'explicit_height' : (levels !== null ? 'levels' : 'estimated_default');

    if (h === null) {
      if (isFerrisWheel) {
        h = Math.max(115.0, Math.min(280.0, maxSpanM * 0.98));
      } else if (levels !== null) {
        h = levels * _lvlH + roofH;
      } else if (isPart) {
        let baseEst;
        if (isRotundaDrum) {
          baseEst = Math.max(20.0, Math.min(25.0, minSpanM * 1.15));
        } else if (rawMaxSpanM >= 35.0 || areaM2 >= 500.0 || aspect >= 2.2) {
          baseEst = Math.min(12.5, Math.max(7.5, minSpanM * 0.65));
        } else {
          baseEst = Math.min(18.0, Math.max(5.5, minSpanM * 1.45));
        }
        if (parentHeightHint !== null && !isRotundaDrum) baseEst = Math.min(baseEst, parentHeightHint * 0.65);
        h = baseEst + roofH;
      } else if (isChurch) {
        h = 26.0 + roofH;
      } else if (isTower) {
        const tType = String(tags['tower:type'] || '').toLowerCase().trim();
        let baseTowerH;
        if (tType === 'communication' || tType === 'observation') {
          baseTowerH = Math.min(65.0, Math.max(28.0, minSpanM * 4.5));
        } else if (tType === 'bell_tower' || btype === 'bell_tower') {
          baseTowerH = Math.min(35.0, Math.max(18.0, minSpanM * 3.4));
        } else if (tType === 'defensive' || histTag === 'tower' || histTag === 'city_gate' || histTag === 'castle_wall') {
          baseTowerH = Math.min(22.0, Math.max(12.0, minSpanM * 2.7));
        } else {
          baseTowerH = Math.min(28.0, Math.max(14.0, minSpanM * 3.0));
        }
        h = baseTowerH + roofH;
      } else {
        const deltaH = 0;
        const effAreaM2 = areaM2 > 0 ? areaM2 : (areaU / Math.max(1e-6, mToU * mToU));
        const museumLargeAreaM2 = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.museumLargeAreaM2 : 14000;
        const commercialLargeAreaM2 = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.commercialLargeAreaM2 : 420;
        const genericLargeAreaM2 = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.genericLargeAreaM2 : 310;
        let baseEst;
        if ((isExplicitHistoric || isOldTownPlot) && CIVIC_TRAD_TYPES_JS.has(btype)) {
          baseEst = Math.min(14.5, Math.max(11.0, rawMinSpanM * 1.02)) + deltaH * 0.7;
        } else if (isOldTownPlot && !['hotel', 'university'].includes(btype)) {
          baseEst = Math.min(14.0, Math.max(9.5, rawMinSpanM * 1.05)) + deltaH;
        } else if (['public', 'civic', 'museum', 'university', 'palace', 'government', 'train_station', 'hotel'].includes(btype)) {
          baseEst = (btype === 'museum' && effAreaM2 > museumLargeAreaM2 ? 14.5 : 21.0) + deltaH;
        } else if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow'].includes(btype)) {
          baseEst = 8.5 + deltaH;
        } else if (['apartments', 'residential', 'commercial', 'office', 'retail'].includes(btype)) {
          baseEst = (effAreaM2 > commercialLargeAreaM2 ? 18.5 : 14.5) + deltaH;
        } else if (['garage', 'shed', 'hut', 'kiosk', 'roof', 'service', 'toilets', 'boathouse', 'allotment_house', 'transformer_tower'].includes(btype)) {
          baseEst = 4.0;
        } else {
          baseEst = (effAreaM2 > genericLargeAreaM2 ? 16.5 : 12.0) + deltaH;
        }
        if (maxDefaultHeightCap !== null && maxDefaultHeightCap >= 6.0) {
          baseEst = Math.min(baseEst, maxDefaultHeightCap);
        }
        h = Math.max(3.5, baseEst) + roofH;
      }
    }

    if (minH >= h - 0.5) {
      minH = (explicitH !== null && h > 12.0) ? Math.max(0.0, h - 2.0) : 0.0;
    }

    if (roof !== 'flat') {
      const availH = Math.max(0.0, h - minH - 0.8);
      if (['dome', 'onion', 'cone', 'pyramidal', 'round'].includes(roof)) {
        roofH = Math.min(roofH, availH, Math.max(minSpanM * 1.15, 3.0));
      } else if (hasExplicitRoofH || isCivicPitchCandidate || isOldTownPlot) {
        roofH = Math.min(roofH, availH, h * 0.55, minSpanM * 0.62);
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
      levels: levels !== null ? Math.max(1, Math.round(levels)) : Math.max(1, Math.round(Math.max(3.0, h - roofH) / _lvlH)),
      roof,
      roofH: Math.round(roofH * 10) / 10,
      roofOrient,
      hasExplicitRoofH,
      isRotundaDrum,
      heightSource,
      part: Boolean(isPart && !isFerrisWheel),
      isOutline: false,
      archType: archType || null,
      church: isChurch,
      tower: isTower,
      landmark: Boolean(tags.name || tags.wikidata || tags.heritage || isChurch || isTower || isFerrisWheel),
      isLandmark: isFerrisWheel
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
      for (const parent of sortedParentsByMinX) {
        const [parMinX, parMinY, parMaxX, parMaxY] = parent.bbox;
        if (parMinX > pMaxX + 0.12) break;
        if (pMinX > parMaxX + 0.12 || pMinY > parMaxY + 0.12 || pMaxY < parMinY - 0.12) continue;
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

      const _lvlHM = (typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.levelHeightM : 3.5;
      for (const ep of enclosingParents) {
        ep.hasParts = true;
        ep.partCount++;
        ep.partsAreaSum += part.netArea;
        const ptH = parseFloatTagJS(part.tags.height, null)
          ?? parseFloatTagJS(part.tags['building:height'], null)
          ?? parseFloatTagJS(part.tags.est_height, null);
        const ptLvls = parseFloatTagJS(part.tags['building:levels'], null);
        const partKnownH = ptH !== null ? ptH : (ptLvls !== null ? ptLvls * _lvlHM : null);
        ep.allParts.push({ outer: part.pts, holes: part.holes, h: partKnownH, minH: part.minH, part });
        if (part.minH <= 3.5) {
          ep.groundPartsAreaSum += part.netArea;
          ep.groundPartCount++;
          ep.groundParts.push({ outer: part.pts, holes: part.holes });
          if (partKnownH !== null) ep.groundPartHeights.push(partKnownH);
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
          if (parLvls !== null) parH = parLvls * _lvlHM;
        }
        part.parentHeightHint = parH;
      } else if (part.groupId === null) {
        part.groupId = part.wid;
      }
    }

    const calcUnionCov = (parent, partsArr) => {
      if (!partsArr || partsArr.length === 0) return 0;
      if (typeof computeGroundPartsUnionCoverage2D === 'function') {
        return computeGroundPartsUnionCoverage2D(parent.pts, parent.holes, partsArr, _pointInPolyS3DB);
      }
      // Standalone Node fallback when polygon_2d.js is not loaded globally
      const [minX, minY, maxX, maxY] = parent.bbox;
      const sx = maxX - minX, sy = maxY - minY;
      if (sx <= 1e-6 || sy <= 1e-6) return 0;
      let inParent = 0, covered = 0;
      for (let iy = 0; iy < 14; iy++) {
        const py = minY + ((iy + 0.5) / 14) * sy;
        for (let ix = 0; ix < 14; ix++) {
          const px = minX + ((ix + 0.5) / 14) * sx;
          if (!_pointInPolyS3DB(px, py, parent.pts)) continue;
          if (parent.holes && parent.holes.some(h => _pointInPolyS3DB(px, py, h))) continue;
          inParent++;
          if (partsArr.some(gp => _pointInPolyS3DB(px, py, gp.outer) && !(gp.holes && gp.holes.some(h => _pointInPolyS3DB(px, py, h))))) {
            covered++;
          }
        }
      }
      return inParent > 0 ? covered / inParent : 0;
    };

    // Consolidate Ferris Wheel complexes globally across parents & parts so twin OSM geometries emit strictly ONE wheel
    const uPerM = (metersToUnits && metersToUnits > 0) ? metersToUnits : 0.125;
    const extractExplicitH = (tags, fallbackH) => {
      if (!tags) return fallbackH || null;
      const h1 = parseFloatTagJS(tags.height, null);
      if (h1 !== null) return h1;
      const h2 = parseFloatTagJS(tags['building:height'], null);
      if (h2 !== null) return h2;
      const h3 = parseFloatTagJS(tags.est_height, null);
      if (h3 !== null) return h3;
      const lvls = parseFloatTagJS(tags['building:levels'], null);
      if (lvls !== null) return lvls * ((typeof OSM_METRIC_CONFIG !== 'undefined') ? OSM_METRIC_CONFIG.levelHeightM : 3.5);
      return fallbackH || null;
    };
    const bboxOfPts = pts => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const px = pts[i][0], py = pts[i][1];
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      return [minX, minY, maxX, maxY];
    };
    const bboxOverlapsPad = (a, b, pad) =>
      a[0] <= b[2] + pad && a[2] >= b[0] - pad && a[1] <= b[3] + pad && a[3] >= b[1] - pad;
    const calcWheelMetrics = (pts, tags) => {
      const bbox = bboxOfPts(pts);
      const dx = Math.max(1e-4, bbox[2] - bbox[0]);
      const dy = Math.max(1e-4, bbox[3] - bbox[1]);
      let cx = (bbox[0] + bbox[2]) * 0.5;
      let cy = (bbox[1] + bbox[3]) * 0.5;
      let majorSpan = Math.max(dx, dy);
      let minorSpan = Math.min(dx, dy);
      if (typeof computeMinAreaOBB2D === 'function' && pts.length >= 3) {
        const obb = computeMinAreaOBB2D(pts);
        if (obb && obb.halfL > 0) {
          cx = obb.cx;
          cy = obb.cy;
          majorSpan = Math.max(1e-4, obb.halfL * 2);
          minorSpan = Math.max(1e-4, obb.halfW * 2);
        }
      }
      const attr = String((tags && tags.attraction) || '').toLowerCase().trim();
      const tt = String((tags && tags['tower:type']) || '').toLowerCase().trim();
      const ride = String((tags && tags.amusement_ride) || '').toLowerCase().trim();
      const explicitlyTagged = WHEEL_ATTRACTION_VALS_JS.has(attr) || tt === 'observation_wheel' || WHEEL_ATTRACTION_VALS_JS.has(ride);
      return {
        bbox, cx, cy, majorSpan, minorSpan,
        aspect: majorSpan / Math.max(minorSpan, 1e-4),
        explicitlyTagged
      };
    };

    const wheelCandidates = [];
    const wheelGroupIds = new Set();
    for (const parent of candidateParents) {
      if (!parent.isFerrisWheel) continue;
      if (parent.groupId !== null) wheelGroupIds.add(parent.groupId);
      if (parent.wid !== null && parent.wid !== undefined && parent.fromBuildingRel) wheelGroupIds.add(parent.wid);
      for (const ap of parent.allParts) {
        if (ap.part) ap.part._suppressedByWheel = true;
      }
      wheelCandidates.push({
        rec: parent,
        isParent: true,
        ...calcWheelMetrics(parent.pts, parent.tags),
        hVal: extractExplicitH(parent.tags, parent.parentHeightHint)
      });
    }
    for (const part of candidateParts) {
      if (!part.isFerrisWheel) continue;
      if (part.groupId !== null) wheelGroupIds.add(part.groupId);
      wheelCandidates.push({
        rec: part,
        isParent: false,
        ...calcWheelMetrics(part.pts, part.tags),
        hVal: extractExplicitH(part.tags, part.parentHeightHint)
      });
    }

    const emittedWheelComplexes = [];
    if (wheelCandidates.length > 0) {
      const nW = wheelCandidates.length;
      const uf = new Int32Array(nW);
      for (let i = 0; i < nW; i++) uf[i] = i;
      const findW = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
      const unionW = (a, b) => { const ra = findW(a), rb = findW(b); if (ra !== rb) uf[rb] = ra; };

      const mergeDistFloor = 95 * uPerM;
      const mergePad = 15 * uPerM;
      for (let i = 0; i < nW; i++) {
        const wi = wheelCandidates[i];
        for (let j = i + 1; j < nW; j++) {
          const wj = wheelCandidates[j];
          const sameGid = wi.rec.groupId !== null && wi.rec.groupId === wj.rec.groupId;
          const dist = Math.hypot(wi.cx - wj.cx, wi.cy - wj.cy);
          const distLim = Math.max(mergeDistFloor, 0.95 * Math.max(wi.majorSpan, wj.majorSpan));
          if (sameGid || dist <= distLim || bboxOverlapsPad(wi.bbox, wj.bbox, mergePad)) {
            unionW(i, j);
          }
        }
      }

      const compMap = new Map();
      for (let i = 0; i < nW; i++) {
        const r = findW(i);
        if (!compMap.has(r)) compMap.set(r, []);
        compMap.get(r).push(wheelCandidates[i]);
      }

      const auxOverlapPad = 6 * uPerM;
      for (const comp of compMap.values()) {
        let maxMajorSpan = 0;
        let maxWheelH = 0;
        let bestExplicitName = '';
        const complexBbox = [Infinity, Infinity, -Infinity, -Infinity];
        const compGids = new Set();

        for (const w of comp) {
          w.rec._wheelConsumed = true;
          if (w.majorSpan > maxMajorSpan) maxMajorSpan = w.majorSpan;
          if (w.hVal && w.hVal > maxWheelH) maxWheelH = w.hVal;
          if (w.rec.allParts) {
            for (const ap of w.rec.allParts) {
              if (ap.part) ap.part._suppressedByWheel = true;
              if (ap.h && ap.h > maxWheelH) maxWheelH = ap.h;
            }
          }
          if (!bestExplicitName && w.rec.tags && !w.rec.tags._nameInherited) {
            bestExplicitName = w.rec.tags.name || w.rec.tags['name:en'] || w.rec.tags['name:pl'] || '';
          }
          if (w.rec.groupId !== null) compGids.add(w.rec.groupId);
          complexBbox[0] = Math.min(complexBbox[0], w.bbox[0]);
          complexBbox[1] = Math.min(complexBbox[1], w.bbox[1]);
          complexBbox[2] = Math.max(complexBbox[2], w.bbox[2]);
          complexBbox[3] = Math.max(complexBbox[3], w.bbox[3]);
        }

        // Harvest heights from overlapping/grouped auxiliary parts or outlines before suppressing them
        for (const p of candidateParts) {
          const inGid = p.groupId !== null && compGids.has(p.groupId);
          const overlaps = bboxOverlapsPad(p.bbox, complexBbox, auxOverlapPad);
          if (inGid || (overlaps && (p.minH > 3.0 || (extractExplicitH(p.tags, 0) || 0) > 25.0))) {
            const ph = extractExplicitH(p.tags, p.parentHeightHint);
            if (ph && ph > maxWheelH) maxWheelH = ph;
          }
        }
        for (const par of candidateParents) {
          const inGid = par.groupId !== null && compGids.has(par.groupId);
          const overlaps = bboxOverlapsPad(par.bbox, complexBbox, auxOverlapPad);
          if (inGid || (overlaps && (extractExplicitH(par.tags, 0) || 0) > 25.0)) {
            const ph = extractExplicitH(par.tags, par.parentHeightHint);
            if (ph && ph > maxWheelH) maxWheelH = ph;
          }
        }

        const eligible = comp.filter(w => w.majorSpan >= 0.65 * maxMajorSpan);
        const pool = eligible.length > 0 ? eligible : comp;
        const scoreWheel = w =>
          (w.explicitlyTagged ? 1000 : 0) +
          Math.min(w.aspect, 30) * 20 +
          (w.isParent ? 1 : 0);
        pool.sort((a, b) => scoreWheel(b) - scoreWheel(a));
        const bestWheel = pool[0];

        const wTags = { ...bestWheel.rec.tags, _archTypeOverride: 'ferris_wheel' };
        if (bestExplicitName && (!wTags.name || wTags._nameInherited)) {
          wTags.name = bestExplicitName;
          delete wTags._nameInherited;
        }
        if (maxWheelH > 0) wTags.height = String(maxWheelH);
        const wGid = bestWheel.rec.groupId !== null ? bestWheel.rec.groupId : bestWheel.rec.wid;
        addBuildingRecord(bestWheel.rec.wid, wTags, bestWheel.rec.pts, bestWheel.rec.holes, wGid, false, bestWheel.rec.parentHeightHint, null);
        emittedWheelComplexes.push({ bbox: complexBbox, gids: compGids });
      }
    }

    const isWheelSuppressedAux = rec => {
      if (rec._wheelConsumed || rec._suppressedByWheel) return true;
      if (rec.groupId !== null && wheelGroupIds.has(rec.groupId)) return true;
      if (emittedWheelComplexes.length === 0) return false;
      const tags = rec.tags || {};
      const hVal = extractExplicitH(tags, rec.parentHeightHint) || 0;
      if (!((rec.minH || 0) > 3.0 || hVal > 25.0)) return false;
      const pad = 6 * uPerM;
      for (const wc of emittedWheelComplexes) {
        if (bboxOverlapsPad(rec.bbox, wc.bbox, pad)) return true;
      }
      return false;
    };

    const buildSpatialContext = () => {
      const mToU = Math.max(1e-4, metersToUnits);
      const cellU = Math.max(1e-3, 80.0 * mToU);
      const histCells = new Map();
      const groupMaxSpanM = new Map();
      const largeComplexes = [];

      const indexRec = (rec) => {
        const metrics = computeRecordMetricsM(rec.pts);
        const gid = rec.groupId;
        if (gid !== null && gid !== undefined) {
          const prev = groupMaxSpanM.get(gid) || 0;
          if (metrics.rawMaxSpanM > prev) groupMaxSpanM.set(gid, metrics.rawMaxSpanM);
        }
        if (metrics.rawMaxSpanM >= 35.0 || metrics.areaM2 >= 500.0) {
          largeComplexes.push({ bbox: rec.bbox, maxSpanM: metrics.rawMaxSpanM });
        }
        if ((!rec.isPart || rec.tags['roof:shape']) && isHistoricAnchorTagsJS(rec.tags, metrics.areaM2)) {
          const gx = Math.floor(rec.cx / cellU);
          const gy = Math.floor(rec.cy / cellU);
          const key = `${gx}_${gy}`;
          let arr = histCells.get(key);
          if (!arr) histCells.set(key, arr = []);
          arr.push([rec.cx, rec.cy]);
        }
      };

      for (const par of candidateParents) indexRec(par);
      for (const pt of candidateParts) indexRec(pt);

      const countHistoricAnchorsNear = (cx, cy, radiusScene) => {
        const r = Math.max(1e-4, radiusScene);
        const rSq = r * r;
        const gMinX = Math.floor((cx - r) / cellU);
        const gMaxX = Math.floor((cx + r) / cellU);
        const gMinY = Math.floor((cy - r) / cellU);
        const gMaxY = Math.floor((cy + r) / cellU);
        let cnt = 0;
        for (let gy = gMinY; gy <= gMaxY; gy++) {
          for (let gx = gMinX; gx <= gMaxX; gx++) {
            const arr = histCells.get(`${gx}_${gy}`);
            if (!arr) continue;
            for (let k = 0; k < arr.length; k++) {
              const dx = arr[k][0] - cx, dy = arr[k][1] - cy;
              const dSq = dx * dx + dy * dy;
              if (dSq > 1e-6 && dSq <= rSq) cnt++;
            }
          }
        }
        return cnt;
      };

      const padU = 25.0 * mToU;
      const hasLargerComplexNear = (cx, cy, minReqSpanM) => {
        for (let i = 0; i < largeComplexes.length; i++) {
          const lc = largeComplexes[i];
          if (lc.maxSpanM < minReqSpanM) continue;
          const b = lc.bbox;
          if (cx >= b[0] - padU && cx <= b[2] + padU && cy >= b[1] - padU && cy <= b[3] + padU) {
            return true;
          }
        }
        return false;
      };

      return { groupMaxSpanM, countHistoricAnchorsNear, hasLargerComplexNear };
    };

    _contextState = buildSpatialContext();

    for (const part of candidateParts) {
      if (isWheelSuppressedAux(part)) {
        part._suppressedByWheel = true;
        continue;
      }
      addBuildingRecord(part.wid, part.tags, part.pts, part.holes, part.groupId, true, part.parentHeightHint);
    }

    for (const parent of candidateParents) {
      if (isWheelSuppressedAux(parent)) continue;
      let suppress = false;
      let maxDefaultHeightCap = null;
      if (parent.hasParts) {
        if (parent.fromBuildingRel && parent.partCount >= 1) {
          suppress = true;
        } else {
          const groundCov = parent.groundParts.length > 0 ? calcUnionCov(parent, parent.groundParts) : 0;
          const allCov = parent.partCount >= 2 ? calcUnionCov(parent, parent.allParts) : groundCov;
          if (groundCov >= 0.78 || allCov >= 0.72) {
            suppress = true;
          } else if (groundCov > 0 && parent.groundPartHeights.length > 0) {
            const sortedH = parent.groundPartHeights.slice().sort((a, b) => a - b);
            const medH = sortedH[Math.floor(sortedH.length / 2)];
            if (medH >= 6.0) maxDefaultHeightCap = medH;
          }
        }
      }
      if (!suppress) {
        addBuildingRecord(parent.wid, parent.tags, parent.pts, parent.holes, parent.groupId || parent.wid, false, null, maxDefaultHeightCap);
      }
    }

    for (let i = 0; i < buildings.length; i++) buildings[i].id = i + 1;
    return buildings;
  }

  return { registerCandidate, addBuildingRecord, resolveAndEmitS3DBBuildings, buildings };
}

if (typeof window !== 'undefined') {
  window.isObservationWheelTagsJS = isObservationWheelTagsJS;
  window.computeSolidInteriorPtJS = computeSolidInteriorPtJS;
  window.createS3DBClientCollector = createS3DBClientCollector;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SKIP_BUILDING_VALS_JS,
    parseFloatTagJS,
    parseRoofDirectionJS,
    isObservationWheelTagsJS,
    isUndergroundOrSkippedBuildingJS,
    computeSolidInteriorPtJS,
    createS3DBClientCollector
  };
}
