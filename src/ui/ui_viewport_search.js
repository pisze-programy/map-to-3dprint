// ============================================================================
// src/ui/ui_viewport_search.js
// 3D Viewport Orbit/Pan/Zoom, Exact 16-Bit PickID Hover/Click Selection,
// 2D Slippy Map Drag/Rotation & Photon Komoot Place Autocomplete
// ============================================================================

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

  // 3. Photon Komoot Place Search & Autocomplete
  const placeInput = document.getElementById('placeSearchInput');
  const suggestionsBox = document.getElementById('searchSuggestionsDropdown');
  let searchDebounceTimer = null;

  async function queryPlaceSuggestions(q) {
    if (!q || q.length < 2) {
      suggestionsBox.classList.add('hidden');
      return [];
    }
    const mapPhotonFeatures = (data) => (data && Array.isArray(data.features) ? data.features : []).map(f => {
      const props = f.properties || {};
      const coords = (f.geometry && f.geometry.coordinates) || [11.5855, 48.1338];
      return {
        name: props.name || props.city || props.locality || q,
        sub: [props.state, props.country].filter(Boolean).join(', '),
        kind: props.osm_value || props.type || 'miejsce',
        lat: coords[1],
        lon: coords[0]
      };
    });
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 6000);
      try {
        const resp = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6`, { signal: ctrl.signal });
        if (!resp.ok) throw new Error('Photon status ' + resp.status);
        const data = await resp.json();
        return mapPhotonFeatures(data);
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      const isHttp = typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol);
      if (isHttp) {
        try {
          const fb = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
          if (fb.ok) {
            const fbData = await fb.json();
            return mapPhotonFeatures(fbData);
          }
        } catch (_) {}
      }
      console.warn('Autocomplete fallback:', e);
      return [];
    }
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
    const q = placeInput.value.trim();
    if (q.length < 2) { suggestionsBox.classList.add('hidden'); return; }
    searchDebounceTimer = setTimeout(async () => {
      renderSuggestionsDropdown(await queryPlaceSuggestions(q));
    }, 200);
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
