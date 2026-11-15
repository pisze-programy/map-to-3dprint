// ============================================================================
// src/gis_client/s3db_unit_parser.js
// Pure OSM Simple 3D Buildings (S3DB) Unit, 17-Roof Schema & Direction Parser
// ============================================================================

const OSM_17_ROOF_SHAPES_JS = [
  'flat', 'gabled', 'hipped', 'pyramidal', 'dome', 'onion', 'round',
  'skillion', 'mansard', 'gambrel', 'half-hipped', 'saltbox', 'butterfly',
  'sawtooth', 'cone', 'quadruple_saltbox', 'side_hipped',
];

const ROOF_SHAPES_NORM = {
  flat: 'flat', none: 'flat',
  gabled: 'gabled', gable: 'gabled', basilical: 'gabled',
  hipped: 'hipped', hip: 'hipped',
  pyramidal: 'pyramidal', pyramid: 'pyramidal',
  dome: 'dome',
  onion: 'onion',
  round: 'round', round_gabled: 'round', barrel: 'round', arched: 'round', cylindrical: 'round',
  skillion: 'skillion', shed: 'skillion', lean_to: 'skillion', 'lean-to': 'skillion', monopitch: 'skillion',
  mansard: 'mansard',
  gambrel: 'gambrel',
  'half-hipped': 'half-hipped', half_hipped: 'half-hipped', half_hip: 'half-hipped', clipped_gable: 'half-hipped',
  saltbox: 'saltbox',
  butterfly: 'butterfly', v: 'butterfly', inverted_gable: 'butterfly',
  sawtooth: 'sawtooth', 'saw-tooth': 'sawtooth', saw_tooth: 'sawtooth',
  cone: 'cone', conical: 'cone', spire: 'cone',
  quadruple_saltbox: 'quadruple_saltbox', 'quadruple-saltbox': 'quadruple_saltbox',
  side_hipped: 'side_hipped', 'side-hipped': 'side_hipped',
  stepped: 'stepped',
};

const CARDINAL_DEG_JS = {
  N: 0, NORTH: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, EAST: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SOUTH: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WEST: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

const SKIP_BUILDING_VALS_JS = new Set([
  'no', 'none', 'construction', 'proposed', 'demolished', 'razed', 'ruins', 'abandoned', 'underground',
]);

const WHEEL_ATTRACTION_VALS_JS = new Set(['big_wheel', 'observation_wheel', 'ferris_wheel']);

function normalizeRoofShapeS3DB(rawRoof) {
  const key = String(rawRoof || 'flat').toLowerCase().trim().replace(/\s+/g, '_');
  if (ROOF_SHAPES_NORM[key]) return ROOF_SHAPES_NORM[key];
  const hyphenKey = key.replace(/_/g, '-');
  if (ROOF_SHAPES_NORM[hyphenKey]) return ROOF_SHAPES_NORM[hyphenKey];
  return 'flat';
}

function parseFloatTagJS(val, fallback = null) {
  if (val === undefined || val === null || val === '') return fallback;
  const head = String(val).split(';')[0].replace(',', '.');
  const m = head.match(/[-+]?\d*\.?\d+/);
  if (!m) return fallback;
  const num = parseFloat(m[0]);
  return Number.isFinite(num) ? num : fallback;
}

function parseOsmLengthMetersJS(val, fallback = null) {
  if (val === undefined || val === null || val === '') return fallback;
  const raw = String(val).split(';')[0].trim().replace(/,/g, '.');
  if (!raw) return fallback;

  const ftInMatch = raw.match(/^\s*([-+]?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*([-+]?\d+(?:\.\d+)?)?\s*(?:"|in|inch|inches)?\s*$/i);
  if (ftInMatch) {
    const sign = ftInMatch[1].startsWith('-') ? -1 : 1;
    const ft = Math.abs(parseFloat(ftInMatch[1]));
    const inches = ftInMatch[2] !== undefined ? Math.abs(parseFloat(ftInMatch[2])) : 0;
    const meters = sign * (ft * 0.3048 + inches * 0.0254);
    return Number.isFinite(meters) ? meters : fallback;
  }

  const m = raw.match(/^\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*([a-zA-Z'"]*)\s*$/);
  if (!m) return parseFloatTagJS(raw, fallback);
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return fallback;

  const unit = (m[2] || '').toLowerCase();
  if (!unit || unit === 'm' || unit === 'meter' || unit === 'meters' || unit === 'metre' || unit === 'metres') return num;
  if (unit === 'km' || unit === 'kilometer' || unit === 'kilometers') return num * 1000.0;
  if (unit === 'cm' || unit === 'centimeter' || unit === 'centimeters') return num * 0.01;
  if (unit === 'mm' || unit === 'millimeter' || unit === 'millimeters') return num * 0.001;
  if (unit === 'yd' || unit === 'yard' || unit === 'yards') return num * 0.9144;
  if (unit === 'ft' || unit === 'feet' || unit === 'foot' || unit === "'") return num * 0.3048;
  if (unit === 'in' || unit === 'inch' || unit === 'inches' || unit === '"') return num * 0.0254;
  return num;
}

function parseRoofDirectionJS(tags) {
  if (!tags) return null;
  const rawSrc = (tags['roof:direction'] !== undefined && tags['roof:direction'] !== null && tags['roof:direction'] !== '')
    ? tags['roof:direction']
    : tags['roof:slope:direction'];
  const raw = (rawSrc !== undefined && rawSrc !== null) ? String(rawSrc).split(';')[0].trim().toUpperCase() : '';
  if (!raw) return null;
  if (CARDINAL_DEG_JS[raw] !== undefined) return CARDINAL_DEG_JS[raw];
  const val = parseFloatTagJS(raw, null);
  return val !== null ? Math.round(((val % 360) + 360) % 360 * 10) / 10 : null;
}

// Compass roof:direction azimuth points DOWNHILL (0=N/+Y, 90=E/+X).
// Ridge axis axU runs strictly PERPENDICULAR (+90 deg CCW from downhill) so
// uphill axis axV = (-sin(dir), -cos(dir)) places vMax uphill and vMin downhill.
function resolveRoofAxesFromDirectionDeg(dirDeg, rotDeg = 0) {
  const effDeg = (((dirDeg - (Number(rotDeg) || 0)) % 360) + 360) % 360;
  const effRad = (effDeg * Math.PI) / 180.0;
  const sinD = Math.sin(effRad);
  const cosD = Math.cos(effRad);
  const downhillVec = [sinD, cosD];
  const uphillVec = [-sinD, -cosD];
  const ridgeVec = [-cosD, sinD];
  const ridgeThetaRad = Math.atan2(ridgeVec[1], ridgeVec[0]);
  return { effectiveDownhillDeg: effDeg, downhillVec, uphillVec, ridgeVec, ridgeThetaRad };
}

function isObservationWheelTagsJS(tags) {
  if (!tags) return false;
  const attr = String(tags.attraction || '').toLowerCase().trim();
  const tt = String(tags['tower:type'] || '').toLowerCase().trim();
  const ride = String(tags.amusement_ride || '').toLowerCase().trim();
  const bpart = String(tags['building:part'] || '').toLowerCase().trim();
  const bldg = String(tags.building || '').toLowerCase().trim();
  return Boolean(
    WHEEL_ATTRACTION_VALS_JS.has(attr) || tt === 'observation_wheel' ||
    WHEEL_ATTRACTION_VALS_JS.has(ride) || bpart === 'ferris_wheel' ||
    bpart === 'observation_wheel' || bldg === 'ferris_wheel' || bldg === 'observation_wheel'
  );
}

function hasAllNegativeLevelJS(tags) {
  if (!tags || tags.level === undefined || tags.level === null || tags.level === '') return false;
  const nums = String(tags.level).split(/[;,]/).map(s => parseFloat(s.trim().replace(',', '.'))).filter(Number.isFinite);
  return nums.length > 0 && nums.every(v => v < 0);
}

function isBridgeSupportTagJS(tags) {
  if (!tags || tags['bridge:support'] === undefined || tags['bridge:support'] === null) return false;
  const v = String(tags['bridge:support']).toLowerCase().trim();
  return Boolean(v && v !== 'no' && v !== 'false');
}

function isUndergroundOrSkippedBuildingJS(tags) {
  if (!tags) return true;
  if (isBridgeSupportTagJS(tags)) return true;
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
  return false;
}

function estimateDefaultHeightM({ isFerrisWheel, isPart, isChurch, isTower, btype, rawMinSpanM, rawMaxSpanM, minSpanM, maxSpanM, areaM2, parentHeightHint, tags, roofH, cfg }) {
  if (isFerrisWheel) return Math.max(115.0, Math.min(280.0, maxSpanM * 0.98));
  if (isPart) {
    const aspect = rawMaxSpanM / Math.max(0.5, rawMinSpanM);
    let baseEst = (rawMaxSpanM >= 35.0 || areaM2 >= 500.0 || aspect >= 2.2)
      ? Math.min(12.5, Math.max(7.5, minSpanM * 0.65))
      : Math.min(18.0, Math.max(5.5, minSpanM * 1.45));
    if (parentHeightHint !== null) baseEst = Math.min(baseEst, parentHeightHint * 0.65);
    return baseEst + roofH;
  }
  if (isChurch) return 26.0 + roofH;
  if (isTower) {
    const tType = String((tags && tags['tower:type']) || '').toLowerCase().trim();
    const mult = (tType === 'communication' || tType === 'observation') ? [28, 65, 4.5] : (tType === 'bell_tower' || btype === 'bell_tower' ? [18, 35, 3.4] : [14, 28, 3.0]);
    return Math.min(mult[1], Math.max(mult[0], minSpanM * mult[2])) + roofH;
  }
  let baseEst;
  if (['public', 'civic', 'museum', 'university', 'palace', 'government', 'train_station', 'hotel'].includes(btype)) {
    baseEst = (btype === 'museum' && areaM2 > (cfg.museumLargeAreaM2 || 14000)) ? 14.5 : 21.0;
  } else if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow'].includes(btype)) baseEst = 8.5;
  else if (['apartments', 'residential', 'commercial', 'office', 'retail'].includes(btype)) {
    baseEst = areaM2 > (cfg.commercialLargeAreaM2 || 420) ? 18.5 : 14.5;
  } else if (['garage', 'shed', 'hut', 'kiosk', 'roof', 'service', 'toilets', 'boathouse', 'allotment_house', 'transformer_tower'].includes(btype)) baseEst = 4.0;
  else baseEst = areaM2 > (cfg.genericLargeAreaM2 || 310) ? 16.5 : 12.0;
  return Math.max(3.5, baseEst) + roofH;
}

const _s3dbParserExports = {
  OSM_17_ROOF_SHAPES_JS,
  ROOF_SHAPES_NORM,
  CARDINAL_DEG_JS,
  SKIP_BUILDING_VALS_JS,
  WHEEL_ATTRACTION_VALS_JS,
  normalizeRoofShapeS3DB,
  parseFloatTagJS,
  parseOsmLengthMetersJS,
  parseRoofDirectionJS,
  resolveRoofAxesFromDirectionDeg,
  isObservationWheelTagsJS,
  hasAllNegativeLevelJS,
  isBridgeSupportTagJS,
  isUndergroundOrSkippedBuildingJS,
  estimateDefaultHeightM,
};

if (typeof window !== 'undefined') Object.assign(window, _s3dbParserExports);
if (typeof module !== 'undefined' && module.exports) module.exports = _s3dbParserExports;
