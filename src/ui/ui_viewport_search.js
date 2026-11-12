// ============================================================================
// src/ui/ui_viewport_search.js
// 3D Viewport Orbit/Pan/Zoom, Exact 16-Bit PickID Hover/Click Selection,
// 2D Slippy Map Drag/Rotation & Photon Komoot Place Autocomplete
// ============================================================================

const _placeQueryCache = new Map();
const _inflightPlaceQueries = new Map();
let _photonBrowserCooldownUntil = 0;

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
    const streetLine = [props.street, props.housenumber].filter(Boolean).join(' ').trim();
    const name = String(props.name || streetLine || props.city || props.locality || fallbackQuery || '').trim();
    if (!name) continue;
    const seenSub = new Set([name.toLowerCase()]);
    const subParts = [];
    for (const rawPart of [streetLine, props.city, props.locality, props.state, props.country]) {
      if (!rawPart) continue;
      for (const seg of String(rawPart).split(',')) {
        const clean = seg.trim();
        const key = clean.toLowerCase();
        if (clean && !seenSub.has(key)) {
          seenSub.add(key);
          subParts.push(clean);
        }
      }
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
      const arcUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=${Math.max(limit * 2, 10)}&outFields=PlaceName,Place_addr,Type,Country,Region,City,ShortLabel&SingleLine=${encodeURIComponent(q)}`;
      const arcData = await _fetchJsonWithTimeout(arcUrl, 3200);
      const candidates = (arcData && Array.isArray(arcData.candidates)) ? arcData.candidates : [];
      if (candidates.length > 0) {
        const features = candidates.map(c => {
          const loc = (c && c.location) || {};
          const attrs = (c && c.attributes) || {};
          const placeAddr = String(attrs.Place_addr || c.address || '').trim();
          const name = String(attrs.PlaceName || attrs.ShortLabel || (placeAddr.split(',')[0] || q)).trim();
          return {
            type: 'Feature',
            properties: {
              name,
              street: placeAddr,
              city: attrs.City || '',
              state: attrs.Region || '',
              country: attrs.Country || '',
              osm_value: String(attrs.Type || 'miejsce').toLowerCase()
            },
            geometry: { type: 'Point', coordinates: [loc.x, loc.y] }
          };
        });
        const deduped = [];
        for (const it of _mapGeoJsonPlaceFeatures({ features }, q)) {
          if (!deduped.some(p => p.name.toLowerCase() === it.name.toLowerCase() && Math.abs(p.lat - it.lat) < 0.0025 && Math.abs(p.lon - it.lon) < 0.0025)) {
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
      const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${limit}&language=pl&format=json`;
      const omData = await _fetchJsonWithTimeout(omUrl, 2800);
      const results = (omData && Array.isArray(omData.results)) ? omData.results : [];
      if (results.length > 0) {
        const features = results.map(r => ({
          type: 'Feature',
          properties: {
            name: r.name || q,
            city: r.admin2 || '',
            state: r.admin1 || '',
            country: r.country || r.country_code || '',
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

  // 1. 3D Viewport (Orbit, Pan, Zoom, Exact 16-bit PickID Hover & Shift+Click)
  let isDragging3D = false, isPanning3D = false;
  let lastX = 0, lastY = 0, downPos = [0, 0];

  canvas3d.addEventListener('mousedown', e => {
    isDragging3D = true;
    isPanning3D = (e.button === 2 || e.button === 1);
    lastX = e.clientX; lastY = e.clientY;
    downPos = [e.clientX, e.clientY];
    state.autoRotate = false;
  });

  window.addEventListener('mousemove', e => {
    if (isDragging3D) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (isPanning3D) {
        const ps = 0.20;
        studio.camera.target[0] -= dx * ps * Math.cos(studio.camera.yaw);
        studio.camera.target[1] -= dx * ps * Math.sin(studio.camera.yaw);
        studio.camera.target[2] += dy * ps;
      } else {
        studio.camera.yaw += dx * 0.008;
        studio.camera.pitch = Math.max(-1.25, Math.min(1.50, studio.camera.pitch + dy * 0.008));
      }
      return;
    }
  });

  window.addEventListener('mouseup', e => {
    if (isDragging3D) {
      if (typeof scheduleSaveActiveConfig === 'function') {
        scheduleSaveActiveConfig(state, 200);
      }
    }
    isDragging3D = false;
    isPanning3D = false;
  });

  canvas3d.addEventListener('contextmenu', e => e.preventDefault());
  canvas3d.addEventListener('wheel', e => {
    e.preventDefault();
    studio.camera.distance = Math.max(22, Math.min(480, studio.camera.distance + e.deltaY * 0.16));
    if (typeof scheduleSaveActiveConfig === 'function') {
      scheduleSaveActiveConfig(state, 250);
    }
  }, { passive: false });

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
