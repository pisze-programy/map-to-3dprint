// ============================================================================
// src/ui/ui_viewport_search.js
// 2D Slippy Map Drag/Rotation & Multi-Provider Place Search/Autocomplete
// ============================================================================

if (typeof bindStudioCameraControls === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./ui_camera_controls.js'));
}

const _placeQueryCache = new Map();
const _inflightPlaceQueries = new Map();
let _photonBrowserCooldownUntil = 0;

const _ISO_COUNTRY_RAW =
  'ABW:AW:Aruba|AFG:AF:Afghanistan|AGO:AO:Angola|AIA:AI:Anguilla|ALA:AX:Åland Islands|' +
  'ALB:AL:Albania|AND:AD:Andorra|ARE:AE:United Arab Emirates|ARG:AR:Argentina|' +
  'ARM:AM:Armenia|ASM:AS:American Samoa|ATA:AQ:Antarctica|' +
  'ATF:TF:French Southern Territories|ATG:AG:Antigua & Barbuda|AUS:AU:Australia|' +
  'AUT:AT:Austria|AZE:AZ:Azerbaijan|BDI:BI:Burundi|BEL:BE:Belgium|BEN:BJ:Benin|' +
  'BES:BQ:Caribbean Netherlands|BFA:BF:Burkina Faso|BGD:BD:Bangladesh|BGR:BG:Bulgaria|' +
  'BHR:BH:Bahrain|BHS:BS:Bahamas|BIH:BA:Bosnia and Herzegovina|BLM:BL:St. Barthélemy|' +
  'BLR:BY:Belarus|BLZ:BZ:Belize|BMU:BM:Bermuda|BOL:BO:Bolivia|BRA:BR:Brazil|' +
  'BRB:BB:Barbados|BRN:BN:Brunei|BTN:BT:Bhutan|BVT:BV:Bouvet Island|BWA:BW:Botswana|' +
  'CAF:CF:Central African Republic|CAN:CA:Canada|CCK:CC:Cocos (Keeling) Islands|' +
  "CHE:CH:Switzerland|CHL:CL:Chile|CHN:CN:China|CIV:CI:Côte d'Ivoire|CMR:CM:Cameroon|" +
  'COD:CD:Congo - Kinshasa|COG:CG:Congo - Brazzaville|COK:CK:Cook Islands|' +
  'COL:CO:Colombia|COM:KM:Comoros|CPV:CV:Cape Verde|CRI:CR:Costa Rica|CUB:CU:Cuba|' +
  'CUW:CW:Curaçao|CXR:CX:Christmas Island|CYM:KY:Cayman Islands|CYP:CY:Cyprus|' +
  'CZE:CZ:Czechia|DEU:DE:Germany|DJI:DJ:Djibouti|DMA:DM:Dominica|DNK:DK:Denmark|' +
  'DOM:DO:Dominican Republic|DZA:DZ:Algeria|ECU:EC:Ecuador|EGY:EG:Egypt|ERI:ER:Eritrea|' +
  'ESH:EH:Western Sahara|ESP:ES:Spain|EST:EE:Estonia|ETH:ET:Ethiopia|FIN:FI:Finland|' +
  'FJI:FJ:Fiji|FLK:FK:Falkland Islands|FRA:FR:France|FRO:FO:Faroe Islands|' +
  'FSM:FM:Micronesia|GAB:GA:Gabon|GBR:GB:United Kingdom|GEO:GE:Georgia|GGY:GG:Guernsey|' +
  'GHA:GH:Ghana|GIB:GI:Gibraltar|GIN:GN:Guinea|GLP:GP:Guadeloupe|GMB:GM:Gambia|' +
  'GNB:GW:Guinea-Bissau|GNQ:GQ:Equatorial Guinea|GRC:GR:Greece|GRD:GD:Grenada|' +
  'GRL:GL:Greenland|GTM:GT:Guatemala|GUF:GF:French Guiana|GUM:GU:Guam|GUY:GY:Guyana|' +
  'HKG:HK:Hong Kong|HMD:HM:Heard & McDonald Islands|HND:HN:Honduras|HRV:HR:Croatia|' +
  'HTI:HT:Haiti|HUN:HU:Hungary|IDN:ID:Indonesia|IMN:IM:Isle of Man|IND:IN:India|' +
  'IOT:IO:British Indian Ocean Territory|IRL:IE:Ireland|IRN:IR:Iran|IRQ:IQ:Iraq|' +
  'ISL:IS:Iceland|ISR:IL:Israel|ITA:IT:Italy|JAM:JM:Jamaica|JEY:JE:Jersey|JOR:JO:Jordan|' +
  'JPN:JP:Japan|KAZ:KZ:Kazakhstan|KEN:KE:Kenya|KGZ:KG:Kyrgyzstan|KHM:KH:Cambodia|' +
  'KIR:KI:Kiribati|KNA:KN:St. Kitts & Nevis|KOR:KR:South Korea|KWT:KW:Kuwait|' +
  'LAO:LA:Laos|LBN:LB:Lebanon|LBR:LR:Liberia|LBY:LY:Libya|LCA:LC:St. Lucia|' +
  'LIE:LI:Liechtenstein|LKA:LK:Sri Lanka|LSO:LS:Lesotho|LTU:LT:Lithuania|' +
  'LUX:LU:Luxembourg|LVA:LV:Latvia|MAC:MO:Macao|MAF:MF:St. Martin|MAR:MA:Morocco|' +
  'MCO:MC:Monaco|MDA:MD:Moldova|MDG:MG:Madagascar|MDV:MV:Maldives|MEX:MX:Mexico|' +
  'MHL:MH:Marshall Islands|MKD:MK:North Macedonia|MLI:ML:Mali|MLT:MT:Malta|' +
  'MMR:MM:Myanmar|MNE:ME:Montenegro|MNG:MN:Mongolia|MNP:MP:Northern Mariana Islands|' +
  'MOZ:MZ:Mozambique|MRT:MR:Mauritania|MSR:MS:Montserrat|MTQ:MQ:Martinique|' +
  'MUS:MU:Mauritius|MWI:MW:Malawi|MYS:MY:Malaysia|MYT:YT:Mayotte|NAM:NA:Namibia|' +
  'NCL:NC:New Caledonia|NER:NE:Niger|NFK:NF:Norfolk Island|NGA:NG:Nigeria|' +
  'NIC:NI:Nicaragua|NIU:NU:Niue|NLD:NL:Netherlands|NOR:NO:Norway|NPL:NP:Nepal|' +
  'NRU:NR:Nauru|NZL:NZ:New Zealand|OMN:OM:Oman|PAK:PK:Pakistan|PAN:PA:Panama|' +
  'PCN:PN:Pitcairn Islands|PER:PE:Peru|PHL:PH:Philippines|PLW:PW:Palau|' +
  'PNG:PG:Papua New Guinea|POL:PL:Poland|PRI:PR:Puerto Rico|PRK:KP:North Korea|' +
  'PRT:PT:Portugal|PRY:PY:Paraguay|PSE:PS:Palestine|PYF:PF:French Polynesia|' +
  'QAT:QA:Qatar|REU:RE:Réunion|ROU:RO:Romania|RUS:RU:Russia|RWA:RW:Rwanda|' +
  'SAU:SA:Saudi Arabia|SDN:SD:Sudan|SEN:SN:Senegal|SGP:SG:Singapore|' +
  'SGS:GS:South Georgia & South Sandwich Islands|SHN:SH:St. Helena|' +
  'SJM:SJ:Svalbard & Jan Mayen|SLB:SB:Solomon Islands|SLE:SL:Sierra Leone|' +
  'SLV:SV:El Salvador|SMR:SM:San Marino|SOM:SO:Somalia|SPM:PM:St. Pierre & Miquelon|' +
  'SRB:RS:Serbia|SSD:SS:South Sudan|STP:ST:São Tomé & Príncipe|SUR:SR:Suriname|' +
  'SVK:SK:Slovakia|SVN:SI:Slovenia|SWE:SE:Sweden|SWZ:SZ:Eswatini|SXM:SX:Sint Maarten|' +
  'SYC:SC:Seychelles|SYR:SY:Syria|TCA:TC:Turks & Caicos Islands|TCD:TD:Chad|TGO:TG:Togo|' +
  'THA:TH:Thailand|TJK:TJ:Tajikistan|TKL:TK:Tokelau|TKM:TM:Turkmenistan|' +
  'TLS:TL:Timor-Leste|TON:TO:Tonga|TTO:TT:Trinidad & Tobago|TUN:TN:Tunisia|' +
  'TUR:TR:Turkey|TUV:TV:Tuvalu|TWN:TW:Taiwan|TZA:TZ:Tanzania|UGA:UG:Uganda|' +
  'UKR:UA:Ukraine|UMI:UM:U.S. Outlying Islands|URY:UY:Uruguay|USA:US:United States|' +
  'UZB:UZ:Uzbekistan|VAT:VA:Vatican City|VCT:VC:St. Vincent & Grenadines|' +
  'VEN:VE:Venezuela|VGB:VG:British Virgin Islands|VIR:VI:U.S. Virgin Islands|' +
  'VNM:VN:Vietnam|VUT:VU:Vanuatu|WLF:WF:Wallis & Futuna|WSM:WS:Samoa|XKX:XK:Kosovo|' +
  'YEM:YE:Yemen|ZAF:ZA:South Africa|ZMB:ZM:Zambia|ZWE:ZW:Zimbabwe|' +
  'ASC:AC:Ascension Island|TAA:TA:Tristan da Cunha|DGA:DG:Diego Garcia|' +
  'UAE:AE:United Arab Emirates|ROM:RO:Romania|ZAR:CD:Congo - Kinshasa|BUR:MM:Myanmar|' +
  'TMP:TL:Timor-Leste|SCG:RS:Serbia|YUG:RS:Serbia|SUN:RU:Russia|ANT:CW:Curaçao';

const _ISO3_TO_ISO2 = new Map();
const _ISO2_FALLBACK_EN = new Map([
  ['UK', 'United Kingdom'],
  ['EL', 'Greece'],
  ['IC', 'Canary Islands'],
  ['EA', 'Ceuta & Melilla']
]);
for (const row of _ISO_COUNTRY_RAW.split('|')) {
  const idx1 = row.indexOf(':');
  const idx2 = row.indexOf(':', idx1 + 1);
  if (idx1 > 0 && idx2 > idx1) {
    const a3 = row.slice(0, idx1);
    const a2 = row.slice(idx1 + 1, idx2);
    const fullName = row.slice(idx2 + 1);
    _ISO3_TO_ISO2.set(a3, a2);
    if (!_ISO2_FALLBACK_EN.has(a2)) _ISO2_FALLBACK_EN.set(a2, fullName);
  }
}

let _enRegionDisplayNames = null;
try {
  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    _enRegionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  }
} catch (_) {}

function _resolveIsoCountryCode(rawCode) {
  const upper = String(rawCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(upper)) return '';
  let alpha2 = '';
  if (upper.length === 3) {
    alpha2 = _ISO3_TO_ISO2.get(upper) || '';
  } else {
    const normalized2 = upper === 'UK' ? 'GB' : (upper === 'EL' ? 'GR' : upper);
    if (_ISO2_FALLBACK_EN.has(normalized2)) alpha2 = normalized2;
  }
  if (!alpha2) return '';
  if (_enRegionDisplayNames) {
    try {
      const intlName = _enRegionDisplayNames.of(alpha2);
      if (
        intlName &&
        intlName.toUpperCase() !== alpha2 &&
        intlName.toUpperCase() !== upper &&
        !/unknown region/i.test(intlName)
      ) {
        return intlName;
      }
    } catch (_) {}
  }
  return _ISO2_FALLBACK_EN.get(alpha2) || '';
}

function _resolveFullCountryName(rawCountry, rawCountryCode) {
  const c = String(rawCountry || '').trim();
  const cc = String(rawCountryCode || '').trim();
  if (c) {
    if (/^[A-Za-z]{2,3}$/.test(c)) {
      return _resolveIsoCountryCode(c) || _resolveIsoCountryCode(cc);
    }
    return c;
  }
  if (cc) {
    if (/^[A-Za-z]{2,3}$/.test(cc)) {
      return _resolveIsoCountryCode(cc);
    }
    return cc;
  }
  return '';
}

function _parseDirectPlaceCoordinates(q) {
  const m = String(q || '').match(/^\s*([NSns])?\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*[,;\s]+\s*([EWew])?\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*$/);
  if (!m) return null;
  let lat = parseFloat(m[2]);
  let lon = parseFloat(m[4]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (m[1] && m[1].toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[3] && m[3].toUpperCase() === 'W') lon = -Math.abs(lon);
  if (lat < -85 || lat > 85 || lon < -180 || lon > 180) return null;
  return [{
    name: `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`,
    sub: 'Współrzędne geograficzne, WGS84',
    kind: 'coordinates',
    lat,
    lon
  }];
}

function _normPlaceToken(val) {
  return String(val || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function _mapGeoJsonPlaceFeatures(data, fallbackQuery) {
  const features = (data && Array.isArray(data.features)) ? data.features : [];
  const out = [];
  for (const f of features) {
    const props = (f && f.properties) || {};
    const coords = f && f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
    if (!coords || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const rawStreet = String(props.street || '').trim();
    const rawHouse = String(props.housenumber || '').trim();
    const streetLine = (rawStreet && rawHouse && !rawStreet.includes(rawHouse))
      ? `${rawStreet} ${rawHouse}`.trim()
      : (rawStreet || rawHouse);

    const countryName = _resolveFullCountryName(
      props.CntryName || props.country,
      props.countrycode || props.country_code || props.Country
    );
    const name = String(props.name || streetLine || props.city || props.locality || fallbackQuery || '').trim();
    if (!name) continue;

    const seenSub = new Set([_normPlaceToken(name)]);
    const subParts = [];
    const rawHierarchy = [
      streetLine,
      props.postcode,
      props.district,
      props.suburb,
      props.locality,
      props.city,
      props.county,
      props.subregion,
      props.state,
      countryName
    ];
    for (const rawPart of rawHierarchy) {
      if (!rawPart) continue;
      for (const seg of String(rawPart).split(',')) {
        let clean = seg.trim();
        if (!clean) continue;
        if (/^[A-Z]{3}$/.test(clean) && _ISO3_TO_ISO2.has(clean)) {
          clean = _resolveIsoCountryCode(clean);
          if (!clean) continue;
        }
        const key = _normPlaceToken(clean);
        if (key && !seenSub.has(key)) {
          seenSub.add(key);
          subParts.push(clean);
        }
      }
    }
    if (subParts.length === 0 && countryName) {
      subParts.push(countryName);
    }
    out.push({
      name,
      sub: subParts.join(', '),
      kind: props.osm_value || props.type || 'miejsce',
      lat,
      lon
    });
  }
  return out;
}

async function _fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function queryMap3DPlaces(rawQuery, limit = 6) {
  const q = String(rawQuery || '').trim();
  if (!q || q.length < 2) return [];

  const directCoords = _parseDirectPlaceCoordinates(q);
  if (directCoords) return directCoords;

  const cacheKey = `${q.toLowerCase()}|${limit}`;
  const now = Date.now();
  const cached = _placeQueryCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.items.slice();
  }

  if (_inflightPlaceQueries.has(cacheKey)) {
    return _inflightPlaceQueries.get(cacheKey);
  }

  const runPromise = (async () => {
    const isHttp = typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol);

    // 1. Primary on HTTP(S): same-origin multi-provider /api/geocode proxy (zero cross-origin hangs)
    if (isHttp) {
      try {
        const apiData = await _fetchJsonWithTimeout(
          `/api/geocode?q=${encodeURIComponent(q)}&limit=${limit}`,
          4500
        );
        const items = _mapGeoJsonPlaceFeatures(apiData, q);
        if (items.length > 0 || (apiData && Array.isArray(apiData.features))) {
          _placeQueryCache.set(cacheKey, { items, expires: Date.now() + 300000 });
          return items.slice(0, limit);
        }
      } catch (_) {
        // Static hosting or local server unreachable -> proceed to CORS-enabled browser geocoders
      }
    }

    // 2. Direct browser CORS fallback #1: ArcGIS World Geocoder (cities, street addresses, POIs)
    try {
      const arcOutFields = 'PlaceName,Place_addr,Type,Country,CntryName,Subregion,Region,City,District,Nbrhd,Postal,StAddr,ShortLabel,LongLabel';
      const arcUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=${Math.max(limit * 2, 10)}&outFields=${arcOutFields}&langCode=ENG&SingleLine=${encodeURIComponent(q)}`;
      const arcData = await _fetchJsonWithTimeout(arcUrl, 3200);
      const candidates = (arcData && Array.isArray(arcData.candidates)) ? arcData.candidates : [];
      if (candidates.length > 0) {
        const features = candidates.map(c => {
          const loc = (c && c.location) || {};
          const attrs = (c && c.attributes) || {};
          const placeAddr = String(attrs.Place_addr || c.address || '').trim();
          const stAddr = String(attrs.StAddr || '').trim();
          const name = String(attrs.PlaceName || attrs.ShortLabel || stAddr || (placeAddr.split(',')[0] || q)).trim();
          const districtParts = [attrs.Nbrhd, attrs.District].map(v => String(v || '').trim()).filter(Boolean);
          return {
            type: 'Feature',
            properties: {
              name,
              street: stAddr || placeAddr,
              postcode: attrs.Postal || '',
              district: districtParts.join(', '),
              city: attrs.City || '',
              county: attrs.Subregion || '',
              state: attrs.Region || '',
              country: attrs.CntryName || '',
              countrycode: attrs.Country || '',
              osm_value: String(attrs.Type || 'miejsce').toLowerCase()
            },
            geometry: { type: 'Point', coordinates: [loc.x, loc.y] }
          };
        });
        const adminKinds = new Set(['state or province', 'county', 'country', 'administrative']);
        const deduped = [];
        for (const it of _mapGeoJsonPlaceFeatures({ features }, q)) {
          const isDup = deduped.some(p => {
            if (_normPlaceToken(p.name) !== _normPlaceToken(it.name)) return false;
            if (Math.abs(p.lat - it.lat) < 0.0025 && Math.abs(p.lon - it.lon) < 0.0025) return true;
            return (
              adminKinds.has(String(it.kind || '').toLowerCase()) &&
              _normPlaceToken(p.sub) === _normPlaceToken(it.sub) &&
              Math.abs(p.lat - it.lat) < 0.55 &&
              Math.abs(p.lon - it.lon) < 0.55
            );
          });
          if (!isDup) {
            deduped.push(it);
            if (deduped.length >= limit) break;
          }
        }
        if (deduped.length > 0) {
          _placeQueryCache.set(cacheKey, { items: deduped, expires: Date.now() + 300000 });
          return deduped;
        }
      }
    } catch (_) {}

    // 3. Direct browser CORS fallback #2: Open-Meteo Worldwide Geocoding
    try {
      const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${limit}&language=en&format=json`;
      const omData = await _fetchJsonWithTimeout(omUrl, 2800);
      const results = (omData && Array.isArray(omData.results)) ? omData.results : [];
      if (results.length > 0) {
        const features = results.map(r => ({
          type: 'Feature',
          properties: {
            name: r.name || q,
            district: r.admin3 || '',
            city: r.admin2 || '',
            state: r.admin1 || '',
            country: r.country || '',
            country_code: r.country_code || '',
            osm_value: String(r.feature_code || 'city').toLowerCase()
          },
          geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }
        }));
        const items = _mapGeoJsonPlaceFeatures({ features }, q).slice(0, limit);
        if (items.length > 0) {
          _placeQueryCache.set(cacheKey, { items, expires: Date.now() + 300000 });
          return items;
        }
      }
    } catch (_) {}

    // 4. Direct browser CORS fallback #3: Photon Komoot (with 60s cooldown when hanging)
    if (Date.now() >= _photonBrowserCooldownUntil) {
      try {
        const phData = await _fetchJsonWithTimeout(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}`,
          2200
        );
        const items = _mapGeoJsonPlaceFeatures(phData, q).slice(0, limit);
        if (items.length > 0) {
          _placeQueryCache.set(cacheKey, { items, expires: Date.now() + 300000 });
        }
        return items;
      } catch (_) {
        _photonBrowserCooldownUntil = Date.now() + 60000;
      }
    }

    return [];
  })();

  _inflightPlaceQueries.set(cacheKey, runPromise);
  try {
    return await runPromise;
  } finally {
    _inflightPlaceQueries.delete(cacheKey);
  }
}

if (typeof window !== 'undefined') {
  window.queryMap3DPlaces = queryMap3DPlaces;
}

function choose2DZoomForSpan(spanMeters) {
  const s = Number(spanMeters) || 1200;
  if (s <= 850) return 15;
  if (s <= 1800) return 14;
  if (s <= 3600) return 13;
  if (s <= 7500) return 12;
  if (s <= 16000) return 11;
  if (s <= 32000) return 10;
  return 9;
}

function bindViewportAndSearchControls(ctx) {
  const {
    canvas3d, canvas2d, studio, state,
    draw2DMap, handleSelectBuilding, setMapRotationDeg,
    scheduleRebuildModel3D, rebuildModel3D, fetchRealGISAndRender
  } = ctx;

  // 1. 3D Viewport Camera Controls (delegated to ui_camera_controls.js)
  if (typeof bindStudioCameraControls === 'function') {
    bindStudioCameraControls(ctx);
  }

  // 2. 2D Slippy Map Panning, Zooming & Rotation Handle
  let isDragging2D = false, isRotating2D = false;
  let drag2DStart = [0, 0];

  canvas2d.addEventListener('mousedown', e => {
    const rect = canvas2d.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const rh = state._rotHandleScreen;
    if (rh && Math.hypot(mx - rh.x, my - rh.y) <= 13) {
      isRotating2D = true;
      return;
    }
    isDragging2D = true;
    drag2DStart = [e.clientX, e.clientY];
  });

  window.addEventListener('mousemove', e => {
    if (isRotating2D) {
      const rect = canvas2d.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const rh = state._rotHandleScreen || { fcx: rect.width * 0.5, fcy: rect.height * 0.5 };
      const angleDeg = Math.round(Math.atan2(mx - rh.fcx, -(my - rh.fcy)) * 180 / Math.PI);
      setMapRotationDeg(angleDeg, false);
      return;
    }
    if (!isDragging2D) return;
    const dx = e.clientX - drag2DStart[0], dy = e.clientY - drag2DStart[1];
    drag2DStart = [e.clientX, e.clientY];

    const z = Math.round(state.mapZoom);
    const cxTile = lon2tileF(state.mapCenterLon, z) - dx / 256.0;
    const cyTile = lat2tileF(state.mapCenterLat, z) - dy / 256.0;
    state.mapCenterLon = Math.max(-179.9, Math.min(179.9, tileF2lon(cxTile, z)));
    state.mapCenterLat = Math.max(-80.0, Math.min(80.0, tileF2lat(cyTile, z)));
    state.lastFetchBbox = null;
    state.lastFetchTitle = null;
    draw2DMap();
  });

  window.addEventListener('mouseup', () => {
    if (isRotating2D) {
      isRotating2D = false;
      if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
    }
    if (isDragging2D) {
      if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
    }
    isDragging2D = false;
  });

  canvas2d.addEventListener('wheel', e => {
    e.preventDefault();
    state.mapZoom = Math.max(3, Math.min(16, state.mapZoom + (e.deltaY < 0 ? 1 : -1)));
    draw2DMap();
    if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 250);
  }, { passive: false });

  document.getElementById('btnZoomIn2D').addEventListener('click', () => {
    state.mapZoom = Math.min(16, state.mapZoom + 1);
    draw2DMap();
    if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 250);
  });
  document.getElementById('btnZoomOut2D').addEventListener('click', () => {
    state.mapZoom = Math.max(3, state.mapZoom - 1);
    draw2DMap();
    if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 250);
  });

  // 3. Multi-Provider Place & Address Search + Autocomplete
  const placeInput = document.getElementById('placeSearchInput');
  const suggestionsBox = document.getElementById('searchSuggestionsDropdown');
  let searchDebounceTimer = null;
  let latestSearchSeq = 0;

  async function queryPlaceSuggestions(q) {
    if (!q || q.trim().length < 2) {
      suggestionsBox.classList.add('hidden');
      return [];
    }
    return queryMap3DPlaces(q, 6);
  }

  function jumpToLatLon(lat, lon, shortTitle, regionDesc) {
    state.mapCenterLat = lat;
    state.mapCenterLon = lon;
    state.mapZoom = choose2DZoomForSpan(state.mapSpanMeters);
    state.plaqueText = shortTitle;
    state.regionLabel = regionDesc;
    state.lastFetchBbox = null;
    state.lastFetchTitle = null;
    const pInput = document.getElementById('plaqueTextInput');
    if (pInput) pInput.value = shortTitle;
    const regBadge = document.getElementById('currentRegionBadge');
    if (regBadge && regionDesc) regBadge.textContent = regionDesc;
    draw2DMap();
    if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
  }

  function renderSuggestionsDropdown(items) {
    if (!items || items.length === 0) {
      suggestionsBox.classList.add('hidden');
      suggestionsBox.innerHTML = '';
      return;
    }
    suggestionsBox.innerHTML = '';
    items.forEach(item => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'w-full text-left px-3 py-2 hover:bg-blue-500/15 transition flex items-center justify-between gap-2';
      row.innerHTML = `
        <div class="min-w-0">
          <div class="text-xs font-bold text-[var(--foreground)] truncate">${escapeHtml(item.name)}</div>
          <div class="text-xs text-[var(--muted-foreground)] truncate">${escapeHtml(item.sub || 'Świat')}</div>
        </div>
        <span class="text-xs font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 shrink-0">${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°</span>
      `;
      row.addEventListener('click', () => {
        clearTimeout(searchDebounceTimer);
        latestSearchSeq++;
        suggestionsBox.classList.add('hidden');
        placeInput.value = `${item.name}${item.sub ? ', ' + item.sub : ''}`;
        jumpToLatLon(item.lat, item.lon, item.name.toUpperCase().slice(0, 20), `${item.sub || 'Świat'} • ${item.name}`);
      });
      suggestionsBox.appendChild(row);
    });
    suggestionsBox.classList.remove('hidden');
  }

  placeInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const seq = ++latestSearchSeq;
    const q = placeInput.value.trim();
    if (q.length < 2) {
      suggestionsBox.classList.add('hidden');
      suggestionsBox.innerHTML = '';
      return;
    }
    searchDebounceTimer = setTimeout(async () => {
      const items = await queryPlaceSuggestions(q);
      if (seq !== latestSearchSeq) return;
      renderSuggestionsDropdown(items);
    }, 180);
  });

  document.addEventListener('click', e => {
    const target = e && e.target;
    const inInput = typeof safeClosest === 'function' ? safeClosest(target, '#placeSearchInput') : (placeInput && typeof placeInput.contains === 'function' && placeInput.contains(target));
    const inDropdown = typeof safeClosest === 'function' ? safeClosest(target, '#searchSuggestionsDropdown') : (suggestionsBox && typeof suggestionsBox.contains === 'function' && suggestionsBox.contains(target));
    if (!inInput && !inDropdown) {
      suggestionsBox.classList.add('hidden');
    }
  });

  async function searchPlaceAndFetch() {
    clearTimeout(searchDebounceTimer);
    latestSearchSeq++;
    const q = (placeInput ? placeInput.value : '').trim();
    if (!q) return;
    suggestionsBox.classList.add('hidden');
    const btn = document.getElementById('btnSearchPlace');
    if (btn) btn.textContent = '...';
    try {
      const items = await queryPlaceSuggestions(q);
      if (items.length > 0) {
        const best = items[0];
        jumpToLatLon(best.lat, best.lon, best.name.toUpperCase().slice(0, 20), `${best.sub || 'Świat'} • ${best.name}`);
      }
    } catch (err) {
      console.warn('Search place error:', err);
    } finally {
      if (btn) btn.textContent = 'Szukaj';
    }
  }

  document.getElementById('btnSearchPlace').addEventListener('click', searchPlaceAndFetch);
  placeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); searchPlaceAndFetch(); }
  });

  return { queryPlaceSuggestions, renderSuggestionsDropdown };
}
