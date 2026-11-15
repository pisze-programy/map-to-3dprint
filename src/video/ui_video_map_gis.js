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

  function updateRotationBadgeUI() {
    const badge = document.getElementById('vidRotBadge');
    if (!badge) return;
    const deg = Number(vState.mapRotationDeg) || 0;
    badge.textContent = (typeof formatRotationBadgeText === 'function')
      ? formatRotationBadgeText(deg)
      : `↻ ${deg}°`;
  }

  function computePresetFetchBBox(preset) {
    const lat = Number(preset.lat);
    const lon = Number(preset.lon);
    const baseSpan = Number(preset.spanMeters) || 1291;
    const totalW = Number(vState.bedSizeMm) || (Number(vState.targetWidthCm || 30) * 10);
    const totalH = Number(vState.totalHeightMm) || (Number(vState.targetHeightCm || 30) * 10);
    const maxDim = Math.max(totalW, totalH) || 300;
    const halfMx = (baseSpan * (totalW / maxDim)) * 0.5;
    const halfMy = (baseSpan * (totalH / maxDim)) * 0.5;
    const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180.0));
    const rotDeg = Number(vState.mapRotationDeg) || 0;
    const rad = Math.abs(rotDeg) * Math.PI / 180.0;
    const envPad = 1.045;
    const envHalfMx = (halfMx * Math.abs(Math.cos(rad)) + halfMy * Math.abs(Math.sin(rad))) * envPad;
    const envHalfMy = (halfMx * Math.abs(Math.sin(rad)) + halfMy * Math.abs(Math.cos(rad))) * envPad;
    const dLat = envHalfMy / 111320.0;
    const dLon = envHalfMx / (111320.0 * cosLat);
    return {
      south: lat - dLat,
      west: lon - dLon,
      north: lat + dLat,
      east: lon + dLon,
      targetSpanMeters: baseSpan,
      targetWidthMm: totalW,
      targetHeightMm: totalH,
      rotationDeg: rotDeg
    };
  }

  async function fetchSceneByBBox(south, west, north, east, title, extraOptions = {}) {
    const spanMeters = (extraOptions && Number(extraOptions.targetSpanMeters) > 0)
      ? Number(extraOptions.targetSpanMeters)
      : (Number(vState.mapSpanMeters) || 1291);
    const targetW = (extraOptions && Number(extraOptions.targetWidthMm) > 0)
      ? Number(extraOptions.targetWidthMm)
      : (Number(vState.bedSizeMm) || ((vState.targetWidthCm || 30) * 10));
    const targetH = (extraOptions && Number(extraOptions.targetHeightMm) > 0)
      ? Number(extraOptions.targetHeightMm)
      : (Number(vState.totalHeightMm) || ((vState.targetHeightCm || 30) * 10));
    const rotDeg = (extraOptions && typeof extraOptions.rotationDeg === 'number')
      ? extraOptions.rotationDeg
      : (Number(vState.mapRotationDeg) || 0);

    const fetchOptions = {
      targetSpanMeters: spanMeters,
      targetWidthMm: targetW,
      targetHeightMm: targetH,
      rotationDeg: rotDeg,
      isResin: vState.isResin !== false,
      xyPixelMm: Number(vState.xyPixelMm) || 0.05,
      lodSettings: vState.lodSettings ? { ...vState.lodSettings } : undefined,
      onProgress: (info) => {
        const loadingTxt = document.getElementById('vidLoadingText');
        if (loadingTxt && info && typeof info === 'object' && info.statusText) {
          loadingTxt.textContent = info.statusText;
        }
      }
    };

    if (typeof fetchChunkedGISInBrowser === 'function') {
      return await fetchChunkedGISInBrowser(south, west, north, east, title, fetchOptions);
    }
    return await fetchRealGISInBrowser(south, west, north, east, title, fetchOptions);
  }

  function applyLoadedScene(scene, customTitle, customSub) {
    if (!scene) return;
    if (!scene._fetchedCropRatio) scene._fetchedCropRatio = 0.88;

    if (typeof applySceneRotation === 'function') {
      const canonHalfU = (typeof SCENE_CANONICAL_HALF_UNITS !== 'undefined') ? SCENE_CANONICAL_HALF_UNITS : 84.6;
      const defBed = (typeof DEFAULT_BED_SIZE_MM !== 'undefined') ? DEFAULT_BED_SIZE_MM : 320;
      const dimW = Number(vState.bedSizeMm) || (vState.targetWidthCm ? vState.targetWidthCm * 10 : defBed);
      const dimH = Number(vState.totalHeightMm) || (vState.targetHeightCm ? vState.targetHeightCm * 10 : dimW);
      const maxDim = Math.max(dimW, dimH) || defBed;
      applySceneRotation(
        scene,
        Number(vState.mapRotationDeg) || 0,
        canonHalfU * (dimW / maxDim),
        canonHalfU * (dimH / maxDim)
      );
    }

    vState.sceneData = scene;
    if (Array.isArray(scene.center) && scene.center.length >= 2) {
      vState.mapCenterLat = scene.center[0];
      vState.mapCenterLon = scene.center[1];
    }
    vState.mapSpanMeters = scene.spanMeters || vState.mapSpanMeters || 1291.3;
    vState.cropRatio = scene._fetchedCropRatio;
    vState.title = (customTitle || scene.title || 'MAP3D').toUpperCase().slice(0, 22);
    if (customSub !== undefined) vState.subtitle = customSub;

    // Preserve shared sceneData immutability: keep Video Studio highlight selection in vState
    const preHighlighted = (scene.buildings || []).filter(b => b.highlighted).map(b => b.id);
    if (preHighlighted.length > 0) {
      vState.highlightedBuildingIds = preHighlighted;
      vState.userClickedHighlight = true;
    } else {
      vState.highlightedBuildingIds = [];
      vState.userClickedHighlight = false;
    }

    const tInp = document.getElementById('vidTitleInput');
    const sInp = document.getElementById('vidSubtitleInput');
    if (tInp) tInp.value = vState.title;
    if (sInp) sInp.value = vState.subtitle;

    updateRotationBadgeUI();
    draw2DMap();
    vState.pinnedSlots = [];
    vState.tNorm = 0.0;
    vState.isPlaying = true;
    hooks.onSceneLoaded();
  }

  async function getOrFetchCachedPresetScene(preset) {
    if (!preset) return null;
    const mainSt = (hooks && typeof hooks.getMainState === 'function') ? hooks.getMainState() : null;
    if (mainSt && mainSt.sceneData && Array.isArray(mainSt.sceneData.center)) {
      const mLat = mainSt.sceneData.center[0];
      const mLon = mainSt.sceneData.center[1];
      const cosLat = Math.max(0.2, Math.cos(preset.lat * Math.PI / 180.0));
      const distM = Math.hypot((mLat - preset.lat) * 111320.0, (mLon - preset.lon) * 111320.0 * cosLat);
      const mSpan = Number(mainSt.sceneData.spanMeters) || 1200;
      const pSpan = Number(preset.spanMeters) || 1291;
      if (distM < 150 && Math.abs(mSpan - pSpan) / Math.max(1, pSpan) <= 0.20) {
        return mainSt.sceneData;
      }
    }

    const totalW = Number(vState.bedSizeMm) || ((vState.targetWidthCm || 30) * 10);
    const totalH = Number(vState.totalHeightMm) || ((vState.targetHeightCm || 30) * 10);
    const rotDeg = Number(vState.mapRotationDeg) || 0;
    const lodTree = (vState.lodSettings && vState.lodSettings.treeMaxSpanKm) || 4.0;
    const cacheKey = `${preset.id}_${totalW}x${totalH}_r${rotDeg}_res${vState.isResin !== false ? 1 : 0}_t${lodTree}`;
    let scene = sceneJsonCache.get(cacheKey);

    if (!scene && preset.id === 'munich' && typeof INITIAL_REAL_SCENE !== 'undefined' && INITIAL_REAL_SCENE && rotDeg === 0) {
      scene = INITIAL_REAL_SCENE;
    }

    if (!scene) {
      const pb = computePresetFetchBBox(preset);
      scene = await fetchSceneByBBox(pb.south, pb.west, pb.north, pb.east, preset.title, {
        targetSpanMeters: pb.targetSpanMeters,
        targetWidthMm: pb.targetWidthMm,
        targetHeightMm: pb.targetHeightMm,
        rotationDeg: pb.rotationDeg
      });
      if (scene) {
        scene.spanMeters = Math.round(pb.targetSpanMeters || scene.spanMeters || 1291);
        sceneJsonCache.set(cacheKey, scene);
      }
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
    } catch (err) {
      console.warn('[Video Studio] Preset load error:', err);
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
      btn.addEventListener('click', () => {
        loadCachedOrLiveScene(p).catch(() => {});
      });
      box.appendChild(btn);
    });
  }

  async function doPlaceQuery(q) {
    if (!q || q.trim().length < 2) return [];
    if (typeof queryMap3DPlaces === 'function') {
      return queryMap3DPlaces(q, 5);
    }
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&limit=5`);
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
    const selBox = mapCtrl.getSelectedBBoxLatLon();
    const fSouth = selBox.fetchSouth !== undefined ? selBox.fetchSouth : selBox[0];
    const fWest = selBox.fetchWest !== undefined ? selBox.fetchWest : selBox[1];
    const fNorth = selBox.fetchNorth !== undefined ? selBox.fetchNorth : selBox[2];
    const fEast = selBox.fetchEast !== undefined ? selBox.fetchEast : selBox[3];
    const title = titleHint || vState.title || 'CUSTOM';
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (loadingTxt) loadingTxt.textContent = `Pobieranie danych GIS (OSM + AWS Terrarium DEM) dla ${title}...`;
    try {
      const sc = await fetchSceneByBBox(fSouth, fWest, fNorth, fEast, title, {
        targetSpanMeters: selBox.targetSpanMeters || vState.mapSpanMeters,
        targetWidthMm: selBox.targetWidthMm || ((vState.targetWidthCm || 30) * 10),
        targetHeightMm: selBox.targetHeightMm || ((vState.targetHeightCm || 30) * 10),
        rotationDeg: selBox.rotationDeg !== undefined ? selBox.rotationDeg : (vState.mapRotationDeg || 0)
      });
      if (sc) {
        sc.spanMeters = Math.round(selBox.targetSpanMeters || sc.spanMeters || 1291);
        applyLoadedScene(sc, title, subHint !== undefined ? subHint : vState.subtitle);
      }
    } catch (err) {
      console.warn('Video GIS fetch error:', err);
    } finally {
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  function applyVideoRotation(rotDeg, rebuildScene = false) {
    const normDeg = (typeof normalizeRotationDeg === 'function')
      ? normalizeRotationDeg(rotDeg)
      : (Number(rotDeg) || 0);
    vState.mapRotationDeg = normDeg;
    updateRotationBadgeUI();
    draw2DMap();
    if (rebuildScene && vState.sceneData) {
      if (typeof applySceneRotation === 'function') {
        const canonHalfU = (typeof SCENE_CANONICAL_HALF_UNITS !== 'undefined') ? SCENE_CANONICAL_HALF_UNITS : 84.6;
        const defBed = (typeof DEFAULT_BED_SIZE_MM !== 'undefined') ? DEFAULT_BED_SIZE_MM : 320;
        const dimW = Number(vState.bedSizeMm) || (vState.targetWidthCm ? vState.targetWidthCm * 10 : defBed);
        const dimH = Number(vState.totalHeightMm) || (vState.targetHeightCm ? vState.targetHeightCm * 10 : dimW);
        const maxDim = Math.max(dimW, dimH) || defBed;
        applySceneRotation(vState.sceneData, normDeg, canonHalfU * (dimW / maxDim), canonHalfU * (dimH / maxDim));
      }
      vState.pinnedSlots = [];
      hooks.onSceneLoaded();
    }
  }

  function bindMapAndSearchControls() {
    if (vidMapCanvas && mapCtrl) {
      let drag2d = false, isRotating2D = false, didRotate2D = false, start2d = [0, 0];
      vidMapCanvas.addEventListener('mousedown', e => {
        const rect = vidMapCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const rh = vState._rotHandleScreen;
        if (rh && Math.hypot(mx - rh.x, my - rh.y) <= 13) {
          isRotating2D = true;
          didRotate2D = false;
          return;
        }
        drag2d = true;
        start2d = [e.clientX, e.clientY];
      });
      window.addEventListener('mousemove', e => {
        if (isRotating2D && vState.isActiveModule) {
          const rect = vidMapCanvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const rh = vState._rotHandleScreen || { fcx: rect.width * 0.5, fcy: rect.height * 0.5 };
          const angleDeg = Math.round(Math.atan2(mx - rh.fcx, -(my - rh.fcy)) * 180 / Math.PI);
          didRotate2D = true;
          applyVideoRotation(angleDeg, false);
          return;
        }
        if (!drag2d || !vState.isActiveModule) return;
        const dx = e.clientX - start2d[0], dy = e.clientY - start2d[1];
        start2d = [e.clientX, e.clientY];
        const z = Math.round(vState.mapZoom);
        vState.mapCenterLon = Math.max(-179.9, Math.min(179.9, tileF2lon(lon2tileF(vState.mapCenterLon, z) - dx / 256.0, z)));
        vState.mapCenterLat = Math.max(-80.0, Math.min(80.0, tileF2lat(lat2tileF(vState.mapCenterLat, z) - dy / 256.0, z)));
        draw2DMap();
      });
      window.addEventListener('mouseup', () => {
        drag2d = false;
        if (isRotating2D) {
          isRotating2D = false;
          if (didRotate2D) applyVideoRotation(vState.mapRotationDeg, true);
          didRotate2D = false;
        }
      });
      vidMapCanvas.addEventListener('wheel', e => {
        e.preventDefault();
        vState.mapZoom = Math.max(3, Math.min(19, vState.mapZoom + (e.deltaY < 0 ? 1 : -1)));
        draw2DMap();
      }, { passive: false });

      const zIn = document.getElementById('btnVidZoomIn2D');
      const zOut = document.getElementById('btnVidZoomOut2D');
      if (zIn) zIn.addEventListener('click', () => { vState.mapZoom = Math.min(19, vState.mapZoom + 1); draw2DMap(); });
      if (zOut) zOut.addEventListener('click', () => { vState.mapZoom = Math.max(3, vState.mapZoom - 1); draw2DMap(); });
    }

    const rotBadge = document.getElementById('vidRotBadge');
    if (rotBadge) {
      rotBadge.addEventListener('click', () => applyVideoRotation(0, true));
    }

    document.querySelectorAll('[data-vid-span-km]').forEach(btn => {
      btn.addEventListener('click', () => {
        const km = parseFloat(btn.getAttribute('data-vid-span-km')) || 1.2;
        vState.mapSpanMeters = km * 1000;
        vState.cropRatio = 0.88;
        if (typeof choose2DZoomForSpan === 'function') {
          vState.mapZoom = Math.min(19, choose2DZoomForSpan(vState.mapSpanMeters));
        }
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
              vState.mapZoom = (typeof choose2DZoomForSpan === 'function')
                ? Math.min(19, choose2DZoomForSpan(vState.mapSpanMeters || 1200))
                : 15;
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
          vState.mapZoom = (typeof choose2DZoomForSpan === 'function')
            ? Math.min(19, choose2DZoomForSpan(vState.mapSpanMeters || 1200))
            : 15;
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
    getOrFetchCachedPresetScene,
    triggerFetchCurrentVideoBBox,
    updateRotationBadgeUI
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createVideoMapGisController };
}
