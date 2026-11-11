// ============================================================================
// src/video/ui_video_map_gis.js
// 2D Slippy Map Fragment Selector, Live Photon Place Search, Cached Preset
// Loader & Live GIS Fetcher for the Video Preview Studio Module.
// ============================================================================

function createVideoMapGisController(vState, hooks) {
  const sceneJsonCache = new Map();
  const vidMapCanvas = document.getElementById('vidMap2dCanvas');
  const vidMapCtx = vidMapCanvas ? vidMapCanvas.getContext('2d') : null;
  const vidTileCache = {};
  const mapCtrl = (vidMapCanvas && vidMapCtx)
    ? createMap2DController(vidMapCanvas, vidMapCtx, vidTileCache, vState)
    : null;

  function draw2DMap() {
    if (mapCtrl) mapCtrl.draw2DMap();
  }

  async function fetchSceneByBBox(south, west, north, east, title) {
    const qs = `south=${south.toFixed(4)}&west=${west.toFixed(4)}&north=${north.toFixed(4)}&east=${east.toFixed(4)}&title=${encodeURIComponent(title)}`;
    try {
      const resp = await fetch(`/api/gis?${qs}`);
      if (resp.ok) {
        const d = await resp.json();
        if (d && Array.isArray(d.buildings)) return d;
      }
    } catch (_) {}
    return await fetchRealGISInBrowser(south, west, north, east, title);
  }

  function applyLoadedScene(scene, customTitle, customSub) {
    if (!scene) return;
    if (!scene._fetchedCropRatio) scene._fetchedCropRatio = 0.88;
    vState.sceneData = scene;
    vState.mapCenterLat = scene.center[0];
    vState.mapCenterLon = scene.center[1];
    vState.mapSpanMeters = scene.spanMeters || 1291.3;
    vState.cropRatio = scene._fetchedCropRatio;
    vState.title = (customTitle || scene.title || 'MAP3D').toUpperCase().slice(0, 22);
    if (customSub !== undefined) vState.subtitle = customSub;

    const hasHl = (scene.buildings || []).some(b => b.highlighted);
    if (!hasHl && scene.buildings && scene.buildings.length > 0) {
      const sorted = [...scene.buildings].sort((a, b) => (b.h || 0) - (a.h || 0));
      if (sorted[0] && (sorted[0].h >= 65 || sorted[0].landmark)) {
        sorted[0].highlighted = true;
      }
    }

    const tInp = document.getElementById('vidTitleInput');
    const sInp = document.getElementById('vidSubtitleInput');
    if (tInp) tInp.value = vState.title;
    if (sInp) sInp.value = vState.subtitle;

    draw2DMap();
    vState.pinnedSlots = [];
    vState.tNorm = 0.0;
    vState.isPlaying = true;
    hooks.onSceneLoaded();
  }

  async function getOrFetchCachedPresetScene(preset) {
    let scene = sceneJsonCache.get(preset.cacheUrl);
    if (!scene && preset.cacheUrl) {
      try {
        const resp = await fetch(preset.cacheUrl);
        if (resp.ok) {
          scene = await resp.json();
          sceneJsonCache.set(preset.cacheUrl, scene);
        }
      } catch (_) {}
    }
    if (!scene && preset.bbox) {
      const [s, w, n, e] = preset.bbox;
      scene = await fetchSceneByBBox(s, w, n, e, preset.title);
    }
    return scene;
  }

  async function loadCachedOrLiveScene(preset) {
    const loadingEl = document.getElementById('vidLoadingOverlay');
    const loadingTxt = document.getElementById('vidLoadingText');
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (loadingTxt) loadingTxt.textContent = `Ładowanie sceny 3D: ${preset.title}...`;
    try {
      const scene = await getOrFetchCachedPresetScene(preset);
      if (scene) applyLoadedScene(scene, preset.title, preset.subtitle || '');
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  async function loadPresetById(presetId) {
    const found = VIDEO_CACHED_PRESETS.find(x => x.id === presetId);
    if (!found) return false;
    await loadCachedOrLiveScene(found);
    return true;
  }

  function renderPresetButtons() {
    const box = document.getElementById('vidQuickPresetsContainer');
    if (!box) return;
    box.innerHTML = '';
    VIDEO_CACHED_PRESETS.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'px-2 py-1 rounded-md bg-[var(--background)] border border-[var(--border)] hover:border-blue-500 text-[11px] font-medium transition truncate text-left';
      btn.textContent = p.label;
      btn.addEventListener('click', () => loadCachedOrLiveScene(p));
      box.appendChild(btn);
    });
  }

  async function doPlaceQuery(q) {
    if (!q || q.length < 2) return [];
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`);
      if (!r.ok) return [];
      const d = await r.json();
      return (d.features || []).map(f => {
        const p = f.properties || {};
        const c = (f.geometry && f.geometry.coordinates) || [11.5855, 48.1338];
        return { name: p.name || p.city || q, sub: [p.state, p.country].filter(Boolean).join(', '), lat: c[1], lon: c[0] };
      });
    } catch (_) {
      return [];
    }
  }

  async function triggerFetchCurrentVideoBBox(titleHint, subHint) {
    if (!mapCtrl) return;
    const loadingEl = document.getElementById('vidLoadingOverlay');
    const loadingTxt = document.getElementById('vidLoadingText');
    const [south, west, north, east] = mapCtrl.getSelectedBBoxLatLon();
    const title = titleHint || vState.title || 'CUSTOM';
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (loadingTxt) loadingTxt.textContent = `Pobieranie danych GIS (OSM + AWS Terrarium DEM) dla ${title}...`;
    try {
      const sc = await fetchSceneByBBox(south, west, north, east, title);
      if (sc) applyLoadedScene(sc, title, subHint !== undefined ? subHint : vState.subtitle);
    } catch (err) {
      console.warn('Video GIS fetch error:', err);
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  function bindMapAndSearchControls() {
    if (vidMapCanvas && mapCtrl) {
      let drag2d = false, start2d = [0, 0];
      vidMapCanvas.addEventListener('mousedown', e => { drag2d = true; start2d = [e.clientX, e.clientY]; });
      window.addEventListener('mousemove', e => {
        if (!drag2d || !vState.isActiveModule) return;
        const dx = e.clientX - start2d[0], dy = e.clientY - start2d[1];
        start2d = [e.clientX, e.clientY];
        const z = Math.round(vState.mapZoom);
        vState.mapCenterLon = Math.max(-179.9, Math.min(179.9, tileF2lon(lon2tileF(vState.mapCenterLon, z) - dx / 256.0, z)));
        vState.mapCenterLat = Math.max(-80.0, Math.min(80.0, tileF2lat(lat2tileF(vState.mapCenterLat, z) - dy / 256.0, z)));
        draw2DMap();
      });
      window.addEventListener('mouseup', () => { drag2d = false; });
      vidMapCanvas.addEventListener('wheel', e => {
        e.preventDefault();
        vState.mapZoom = Math.max(3, Math.min(16, vState.mapZoom + (e.deltaY < 0 ? 1 : -1)));
        draw2DMap();
      }, { passive: false });

      const zIn = document.getElementById('btnVidZoomIn2D');
      const zOut = document.getElementById('btnVidZoomOut2D');
      if (zIn) zIn.addEventListener('click', () => { vState.mapZoom = Math.min(16, vState.mapZoom + 1); draw2DMap(); });
      if (zOut) zOut.addEventListener('click', () => { vState.mapZoom = Math.max(3, vState.mapZoom - 1); draw2DMap(); });
    }

    document.querySelectorAll('[data-vid-span-km]').forEach(btn => {
      btn.addEventListener('click', () => {
        const km = parseFloat(btn.getAttribute('data-vid-span-km')) || 1.2;
        vState.mapSpanMeters = km * 1000;
        vState.cropRatio = 0.88;
        const lbl = document.getElementById('vidSpanBadge');
        if (lbl) lbl.textContent = `${km.toFixed(1)} km`;
        draw2DMap();
      });
    });

    const searchInp = document.getElementById('vidPlaceSearchInput');
    const searchBtn = document.getElementById('btnVidSearchPlace');
    const dropBox = document.getElementById('vidSearchDropdown');
    let searchTimer = null;

    if (searchInp && dropBox) {
      searchInp.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = searchInp.value.trim();
        if (q.length < 2) { dropBox.classList.add('hidden'); return; }
        searchTimer = setTimeout(async () => {
          const items = await doPlaceQuery(q);
          if (!items.length) { dropBox.classList.add('hidden'); return; }
          dropBox.innerHTML = '';
          items.forEach(it => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'w-full text-left px-2.5 py-1.5 hover:bg-blue-500/15 text-xs flex items-center justify-between gap-2';
            b.innerHTML = `<span class="font-semibold truncate">${escapeHtml(it.name)} <span class="text-[var(--muted-foreground)] font-normal">${escapeHtml(it.sub)}</span></span><span class="font-mono text-[10px] text-blue-400">${it.lat.toFixed(2)}°</span>`;
            b.addEventListener('click', async () => {
              dropBox.classList.add('hidden');
              searchInp.value = it.name;
              vState.mapCenterLat = it.lat;
              vState.mapCenterLon = it.lon;
              vState.mapZoom = 15;
              draw2DMap();
              await triggerFetchCurrentVideoBBox(it.name.toUpperCase().slice(0, 20), (it.sub || 'CUSTOM EDITION').toUpperCase().slice(0, 32));
            });
            dropBox.appendChild(b);
          });
          dropBox.classList.remove('hidden');
        }, 220);
      });
    }

    if (searchBtn && searchInp) {
      searchBtn.addEventListener('click', async () => {
        const items = await doPlaceQuery(searchInp.value.trim());
        if (items.length > 0) {
          if (dropBox) dropBox.classList.add('hidden');
          vState.mapCenterLat = items[0].lat;
          vState.mapCenterLon = items[0].lon;
          vState.mapZoom = 15;
          draw2DMap();
          await triggerFetchCurrentVideoBBox(items[0].name.toUpperCase().slice(0, 20), (items[0].sub || 'CUSTOM 3D').toUpperCase().slice(0, 32));
        }
      });
    }

    const btnFetchGis = document.getElementById('btnVidFetchGis');
    if (btnFetchGis) btnFetchGis.addEventListener('click', () => triggerFetchCurrentVideoBBox(vState.title));
  }

  return {
    draw2DMap,
    renderPresetButtons,
    bindMapAndSearchControls,
    loadPresetById,
    getOrFetchCachedPresetScene
  };
}
