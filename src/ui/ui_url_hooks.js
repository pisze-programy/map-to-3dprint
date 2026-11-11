// ============================================================================
// src/ui/ui_url_hooks.js
// URL Query Parameter Hooks & Active Settings Persistence (Feature 15 R4)
// ============================================================================

const STORAGE_KEY_ACTIVE_CONFIG = 'map3d_active_config';
let saveConfigTimer = null;

function saveActiveConfig(state) {
  if (!state || typeof state !== 'object') return null;

  try {
    const cam = (state && state.camera) ||
      (state && state.studio && state.studio.camera) ||
      (typeof window !== 'undefined' && window.__map3d && window.__map3d.studio && window.__map3d.studio.camera);

    const spanM = Number(state.mapSpanMeters) || 1200;
    const spanKm = Math.round((spanM / 1000) * 100) / 100;

    const targetW = Number(state.targetWidthCm) || Math.round((Number(state.bedSizeMm) || 500) / 10) || 50;
    const targetH = Number(state.targetHeightCm) || Math.round((Number(state.totalHeightMm) || 500) / 10) || 50;

    const config = {
      city: (state.plaqueText && String(state.plaqueText).trim()) || 'MÜNCHEN',
      lat: (typeof state.mapCenterLat === 'number' && Number.isFinite(state.mapCenterLat)) ? state.mapCenterLat : 48.1338,
      lon: (typeof state.mapCenterLon === 'number' && Number.isFinite(state.mapCenterLon)) ? state.mapCenterLon : 11.5855,
      spanKm: spanKm,
      targetW: targetW,
      targetH: targetH,
      tileCols: Math.max(1, Math.min(50, Math.round(Number(state.tileCols)) || 4)),
      tileRows: Math.max(1, Math.min(100, Math.round(Number(state.tileRows)) || 6)),
      palette: state.activePalette || 'white',
      lod: state.lodSettings ? { ...state.lodSettings } : undefined,
      zScale: typeof state.zScale === 'number' ? Number(state.zScale.toFixed(2)) : 1.25,
      terrainScale: typeof state.terrainScale === 'number' ? Number(state.terrainScale.toFixed(2)) : 1.15,
      mapRotationDeg: typeof state.mapRotationDeg === 'number' ? Math.round(state.mapRotationDeg) : 0,
      hollowBase: typeof state.hollowBase === 'boolean' ? state.hollowBase : true,
      printerProfileId: state.printerProfileId || 'mono4_custom',
      camera: cam ? {
        yaw: typeof cam.yaw === 'number' ? Number(cam.yaw.toFixed(4)) : -0.48,
        pitch: typeof cam.pitch === 'number' ? Number(cam.pitch.toFixed(4)) : 0.50,
        distance: typeof cam.distance === 'number' ? Number(cam.distance.toFixed(1)) : 274,
        target: Array.isArray(cam.target) ? cam.target.slice(0, 3).map(v => Number(Number(v).toFixed(2))) : [2, 5, 3.2]
      } : {
        yaw: -0.48,
        pitch: 0.50,
        distance: 274,
        target: [2, 5, 3.2]
      }
    };

    // 1. Serialize to localStorage['map3d_active_config']
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_KEY_ACTIVE_CONFIG, JSON.stringify(config));
      } catch (storageErr) {
        console.warn('localStorage write error:', storageErr);
      }
    }

    // 2. Synchronize URL query parameters via replaceState
    updateUrlQueryParams(config);

    return config;
  } catch (err) {
    console.warn('saveActiveConfig error:', err);
    return null;
  }
}

function scheduleSaveActiveConfig(state, delayMs = 200) {
  if (saveConfigTimer) clearTimeout(saveConfigTimer);
  saveConfigTimer = setTimeout(() => {
    saveConfigTimer = null;
    saveActiveConfig(state);
  }, delayMs);
}

function loadActiveConfig() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY_ACTIVE_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const sanitized = {};
    if (parsed.city && typeof parsed.city === 'string' && parsed.city.trim().length > 0) {
      sanitized.city = parsed.city.trim();
    }
    if (typeof parsed.lat === 'number' && Number.isFinite(parsed.lat) && parsed.lat >= -85 && parsed.lat <= 85) {
      sanitized.lat = parsed.lat;
    }
    if (typeof parsed.lon === 'number' && Number.isFinite(parsed.lon) && parsed.lon >= -180 && parsed.lon <= 180) {
      sanitized.lon = parsed.lon;
    }
    if (typeof parsed.spanKm === 'number' && Number.isFinite(parsed.spanKm) && parsed.spanKm > 0) {
      sanitized.spanKm = parsed.spanKm;
    }
    if (typeof parsed.targetW === 'number' && Number.isFinite(parsed.targetW) && parsed.targetW >= 8 && parsed.targetW <= 150) {
      sanitized.targetW = parsed.targetW;
    }
    if (typeof parsed.targetH === 'number' && Number.isFinite(parsed.targetH) && parsed.targetH >= 8 && parsed.targetH <= 150) {
      sanitized.targetH = parsed.targetH;
    }
    if (typeof parsed.tileCols === 'number' && Number.isFinite(parsed.tileCols) && parsed.tileCols >= 1 && parsed.tileCols <= 50) {
      sanitized.tileCols = Math.round(parsed.tileCols);
    }
    if (typeof parsed.tileRows === 'number' && Number.isFinite(parsed.tileRows) && parsed.tileRows >= 1 && parsed.tileRows <= 100) {
      sanitized.tileRows = Math.round(parsed.tileRows);
    }
    if (typeof parsed.palette === 'string' && parsed.palette.trim().length > 0) {
      sanitized.palette = parsed.palette.trim();
    }
    if (typeof parsed.zScale === 'number' && Number.isFinite(parsed.zScale) && parsed.zScale > 0) {
      sanitized.zScale = parsed.zScale;
    }
    if (typeof parsed.terrainScale === 'number' && Number.isFinite(parsed.terrainScale) && parsed.terrainScale > 0) {
      sanitized.terrainScale = parsed.terrainScale;
    }
    if (typeof parsed.mapRotationDeg === 'number' && Number.isFinite(parsed.mapRotationDeg)) {
      sanitized.mapRotationDeg = parsed.mapRotationDeg;
    }
    if (typeof parsed.hollowBase === 'boolean') {
      sanitized.hollowBase = parsed.hollowBase;
    }
    if (typeof parsed.printerProfileId === 'string' && parsed.printerProfileId.trim().length > 0) {
      sanitized.printerProfileId = parsed.printerProfileId.trim();
    }
    if (parsed.camera && typeof parsed.camera === 'object' && !Array.isArray(parsed.camera)) {
      const c = parsed.camera;
      const hasYaw = typeof c.yaw === 'number' && Number.isFinite(c.yaw);
      const hasPitch = typeof c.pitch === 'number' && Number.isFinite(c.pitch);
      const hasDist = typeof c.distance === 'number' && Number.isFinite(c.distance);
      const hasTarget = Array.isArray(c.target) && c.target.length >= 3 && c.target.slice(0, 3).every(n => Number.isFinite(Number(n)));
      if (hasYaw || hasPitch || hasDist || hasTarget) {
        sanitized.camera = {
          yaw: hasYaw ? c.yaw : (Number(c.yaw) || -0.48),
          pitch: hasPitch ? c.pitch : (Number(c.pitch) || 0.50),
          distance: hasDist ? c.distance : (Number(c.distance) || 274),
          target: hasTarget ? c.target.slice(0, 3).map(Number) : [2, 5, 3.2]
        };
      }
    }
    if (parsed.lod && typeof parsed.lod === 'object') {
      sanitized.lod = {
        minBuildingFootprintM: typeof parsed.lod.minBuildingFootprintM === 'number' ? parsed.lod.minBuildingFootprintM : 0,
        enableTrees: typeof parsed.lod.enableTrees === 'boolean' ? parsed.lod.enableTrees : true,
        treeMaxSpanKm: typeof parsed.lod.treeMaxSpanKm === 'number' ? parsed.lod.treeMaxSpanKm : 4.0,
        roadDetail: typeof parsed.lod.roadDetail === 'string' ? parsed.lod.roadDetail : 'all'
      };
    }

    if (Object.keys(sanitized).length === 0) return null;
    return sanitized;
  } catch (e) {
    console.warn('loadActiveConfig error:', e);
    return null;
  }
}

function updateUrlQueryParams(cfg) {
  try {
    if (typeof window === 'undefined' || !window.location || !window.history || !window.history.replaceState) {
      return;
    }
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const currentMode = params.get('mode');

    if (cfg.city) params.set('title', cfg.city);
    if (typeof cfg.lat === 'number' && typeof cfg.lon === 'number') {
      params.set('lat', cfg.lat.toFixed(4));
      params.set('lon', cfg.lon.toFixed(4));
    }
    if (typeof cfg.spanKm === 'number') {
      params.set('span', cfg.spanKm.toFixed(2));
    }
    if (cfg.palette) params.set('palette', cfg.palette);
    if (cfg.printerProfileId) params.set('printer', cfg.printerProfileId);
    if (typeof cfg.tileCols === 'number' && typeof cfg.tileRows === 'number') {
      params.set('grid', `${cfg.tileCols}x${cfg.tileRows}`);
    }
    if (typeof cfg.targetW === 'number' && typeof cfg.targetH === 'number') {
      params.set('frame', `${cfg.targetW}x${cfg.targetH}`);
    }
    if (typeof cfg.hollowBase === 'boolean') {
      params.set('hollow', cfg.hollowBase ? '1' : '0');
    }
    if (typeof cfg.zScale === 'number') {
      params.set('z_scale', cfg.zScale.toFixed(2));
    }
    if (typeof cfg.mapRotationDeg === 'number' && cfg.mapRotationDeg !== 0) {
      params.set('rot', Math.round(cfg.mapRotationDeg).toString());
    } else {
      params.delete('rot');
    }
    if (cfg.camera && typeof cfg.camera.yaw === 'number') {
      const camStr = `${cfg.camera.yaw.toFixed(3)},${cfg.camera.pitch.toFixed(3)},${cfg.camera.distance.toFixed(1)},${cfg.camera.target.join(',')}`;
      params.set('cam_custom', camStr);
    }
    if (cfg.lod) {
      if (typeof cfg.lod.minBuildingFootprintM === 'number' && cfg.lod.minBuildingFootprintM > 0) {
        params.set('lod_bld', cfg.lod.minBuildingFootprintM.toString());
      } else {
        params.delete('lod_bld');
      }
      if (typeof cfg.lod.enableTrees === 'boolean') {
        params.set('lod_trees', cfg.lod.enableTrees ? '1' : '0');
      }
      if (typeof cfg.lod.treeMaxSpanKm === 'number') {
        params.set('lod_tree_km', cfg.lod.treeMaxSpanKm.toFixed(1));
      }
      if (cfg.lod.roadDetail && cfg.lod.roadDetail !== 'all') {
        params.set('lod_roads', cfg.lod.roadDetail);
      } else {
        params.delete('lod_roads');
      }
    }
    if (currentMode) params.set('mode', currentMode);

    const newSearch = params.toString();
    const newPath = url.pathname + (newSearch ? '?' + newSearch : '') + url.hash;
    window.history.replaceState(null, '', newPath);
  } catch (e) {
    console.warn('replaceState error:', e);
  }
}

async function applyMap3DUrlParams(ctx) {
  const {
    state, studio, videoStudio,
    fetchRealGISAndRender, applyPrinterProfile, rebuildModel3D, draw2DMap,
    handleSelectBuilding, renderPalettesUI, renderLayersUI,
    queryPlaceSuggestions, renderSuggestionsDropdown, switchToModule,
    setMapSpanKm, setMapRotationDeg
  } = ctx;

  try {
    const params = new URLSearchParams(window.location.search);
    const placeInput = document.getElementById('placeSearchInput');
    const chkHollowBase = document.getElementById('chkHollowBase');
    const tileExplodeSlider = document.getElementById('tileExplodeSlider');
    const explodeSlider = document.getElementById('explodeSlider');
    const exportTileSelect = document.getElementById('exportTileSelect');

    const bboxStr = params.get('bbox');
    const titleStr = params.get('title') || (state ? state.plaqueText : 'KRAKÓW');
    const regionStr = params.get('region') || '';
    if (bboxStr) {
      const parts = bboxStr.split(',').map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        if (placeInput && regionStr) placeInput.value = regionStr;
        const pInput = document.getElementById('plaqueTextInput');
        if (pInput) pInput.value = titleStr;
        state.plaqueText = titleStr;
        await fetchRealGISAndRender(parts, titleStr, regionStr);
      }
    } else {
      // Check if lat/lon in URL or hydrated state differs from bundled sceneData center
      const latParam = params.get('lat');
      const lonParam = params.get('lon');
      const spanParam = params.get('span');
      if (latParam && lonParam && !isNaN(Number(latParam)) && !isNaN(Number(lonParam))) {
        state.mapCenterLat = Number(latParam);
        state.mapCenterLon = Number(lonParam);
        if (spanParam && !isNaN(Number(spanParam))) {
          if (typeof setMapSpanKm === 'function') setMapSpanKm(Number(spanParam), false);
          else state.mapSpanMeters = Math.round(Number(spanParam) * 1000);
        }
        await fetchRealGISAndRender(null, titleStr, regionStr);
      } else if (state && state.sceneData && state.sceneData.center) {
        const dLat = Math.abs(state.mapCenterLat - state.sceneData.center[0]);
        const dLon = Math.abs(state.mapCenterLon - state.sceneData.center[1]);
        if (dLat > 0.01 || dLon > 0.01) {
          await fetchRealGISAndRender(null, state.plaqueText || titleStr, regionStr);
        }
      }
    }

    const zScaleParam = params.get('z_scale');
    if (zScaleParam && !isNaN(Number(zScaleParam))) {
      state.zScale = Number(zScaleParam);
      const zInp = document.getElementById('zScaleSlider');
      if (zInp) zInp.value = Math.round(state.zScale * 100);
      const zLbl = document.getElementById('zScaleLabel');
      if (zLbl) zLbl.textContent = `${state.zScale.toFixed(2)}×`;
      rebuildModel3D();
    }

    const rotParam = params.get('rot');
    if (rotParam && !isNaN(Number(rotParam))) {
      const rotVal = Number(rotParam);
      if (typeof setMapRotationDeg === 'function') {
        setMapRotationDeg(rotVal, true);
      } else {
        state.mapRotationDeg = rotVal;
        draw2DMap();
        rebuildModel3D();
      }
      const rotInp = document.getElementById('mapRotationSlider');
      if (rotInp) rotInp.value = rotVal;
    }

    const searchQ = params.get('search');
    if (searchQ && placeInput) {
      placeInput.value = searchQ;
      const items = await queryPlaceSuggestions(searchQ);
      renderSuggestionsDropdown(items);
    }

    const palParam = params.get('palette');
    if (palParam && params.get('mode') !== 'video') {
      const pal = PALETTES.find(p => p.id === palParam);
      if (pal) {
        state.activePalette = pal.id;
        state.colors = { ...pal.colors };
        renderPalettesUI();
        renderLayersUI();
        studio.render(true);
      }
    }

    const printerParam = params.get('printer');
    if (printerParam && PRINT_PROFILES[printerParam]) {
      const pSel = document.getElementById('printerSelect');
      if (pSel) pSel.value = printerParam;
      applyPrinterProfile(printerParam);
    }

    const gridParam = params.get('grid');
    if (gridParam && /^\d+x\d+$/.test(gridParam)) {
      const [gc, gr] = gridParam.split('x').map(Number);
      state.tileCols = Math.max(1, Math.min(50, gc));
      state.tileRows = Math.max(1, Math.min(100, gr));
      draw2DMap();
      rebuildModel3D();
    }

    const hollowParam = params.get('hollow');
    if (hollowParam === '0' || hollowParam === '1') {
      state.hollowBase = (hollowParam === '1');
      if (chkHollowBase) chkHollowBase.checked = state.hollowBase;
      rebuildModel3D();
    }

    const tileExplodeParam = params.get('tile_explode');
    if (tileExplodeParam !== null) {
      const tev = parseInt(tileExplodeParam, 10) || 0;
      state.tileExplode = tev / 100;
      if (tileExplodeSlider) tileExplodeSlider.value = tev;
      const lbl = document.getElementById('tileExplodeValueLabel');
      if (lbl) lbl.textContent = `${tev}%`;
    }

    const tileParam = params.get('tile');
    if (tileParam !== null && exportTileSelect) {
      state.exportTileFilter = tileParam;
      exportTileSelect.value = tileParam;
      draw2DMap();
    }

    const multi = params.get('multi');
    if (multi === '1' && state.sceneData && state.sceneData.buildings) {
      const blds = state.sceneData.buildings;
      const targets = blds.filter(b => b.name && (
        b.name.includes('Sandomierska') || b.name.includes('Wawel') ||
        b.name.includes('Katedra') || b.name.includes('Lukas') || b.landmark
      ));
      const seenPids = new Set();
      const uniqueTargets = [];
      for (const t of targets) {
        const pid = t._pickId || t.id;
        if (!seenPids.has(pid)) {
          seenPids.add(pid);
          uniqueTargets.push(t);
          if (uniqueTargets.length >= 3) break;
        }
      }
      uniqueTargets.forEach((t, idx) => handleSelectBuilding(t, idx > 0));
      if (uniqueTargets.length > 0) {
        const pid0 = uniqueTargets[0]._pickId || uniqueTargets[0].id;
        const info0 = state.pickIdMap && state.pickIdMap.get(pid0);
        const members0 = (info0 && info0.buildings) || [uniqueTargets[0]];
        members0.forEach(m => { m.highlighted = true; });
        rebuildModel3D();
      }
    }

    const selectOsm = params.get('select_osm');
    if (selectOsm && state.sceneData && state.sceneData.buildings) {
      const targetOsm = Number(selectOsm);
      const found = state.sceneData.buildings.find(b => b.osmId === targetOsm || b.groupId === targetOsm);
      if (found) handleSelectBuilding(found, false);
    }

    const hoverOsm = params.get('hover_osm');
    if (hoverOsm && state.sceneData && state.sceneData.buildings) {
      const targetOsm = Number(hoverOsm);
      const found = state.sceneData.buildings.find(b => b.osmId === targetOsm || b.groupId === targetOsm);
      if (found && found._pickId) {
        const pid = found._pickId;
        state.hoveredBuildingId = pid;
        const tooltip = document.getElementById('hoverTooltip');
        if (tooltip) {
          const info = (state.pickIdMap && state.pickIdMap.get(pid)) || null;
          const dispName = (info && info.name) || found.name || `Budynek OSM #${found.osmId || found.id}`;
          const dispH = Math.round((info && info.maxH) || found.h || 10);
          const dispLvls = Math.max(1, found.levels || Math.round(dispH / 3.5));
          const partsNote = (info && info.buildings && info.buildings.length > 1) ? ` • ${info.buildings.length} brył` : '';
          tooltip.classList.remove('hidden');
          tooltip.style.left = '54%';
          tooltip.style.top = '58%';
          tooltip.innerHTML = `<strong>${escapeHtml(dispName)}</strong><br/><span class="text-blue-300 font-mono">Wysokość: ${dispH}m (${dispLvls} p.)${partsNote} • Klik: zaznacz • Shift+Klik: dodaj</span>`;
        }
      }
    }

    const cam = params.get('cam');
    if (cam) state.autoRotate = false;
    if (cam === 'top') {
      studio.camera.yaw = 0; studio.camera.pitch = 1.51; studio.camera.distance = 248;
      studio.camera.target = [0, 0, 2.0];
    } else if (cam === 'low') {
      studio.camera.yaw = -0.58; studio.camera.pitch = 0.22; studio.camera.distance = 175;
      studio.camera.target = [0, -10, 5.0];
    } else if (cam === 'closeup') {
      studio.camera.yaw = 0.32; studio.camera.pitch = 0.25; studio.camera.distance = 135;
      studio.camera.target = [-12, -25, 4.5];
    } else if (cam === 'exploded') {
      studio.camera.yaw = -0.45; studio.camera.pitch = 0.34; studio.camera.distance = 265;
      if (explodeSlider) explodeSlider.value = 70;
      state.explodeFactor = 0.70;
      document.getElementById('explodeValueLabel').textContent = '70%';
      document.getElementById('explodedLegendOverlay').classList.remove('hidden');
    } else if (cam === 'tiles') {
      studio.camera.yaw = -0.38; studio.camera.pitch = 0.64; studio.camera.distance = 298;
      studio.camera.target = [0, 0, 2.5];
    } else if (cam === 'bottom') {
      studio.camera.yaw = -0.42; studio.camera.pitch = -0.68; studio.camera.distance = 248;
      studio.camera.target = [0, 0, 1.0];
    }

    const camCustom = params.get('cam_custom');
    if (camCustom) {
      state.autoRotate = false;
      const cp = camCustom.split(',').map(Number);
      if (cp.length >= 6 && cp.every(n => Number.isFinite(n))) {
        studio.camera.yaw = cp[0];
        studio.camera.pitch = cp[1];
        studio.camera.distance = cp[2];
        studio.camera.target = [cp[3], cp[4], cp[5]];
      }
    }

    if (window.MAP3D_STANDALONE_VIDEO_MODULE || params.get('mode') === 'video') {
      switchToModule('video', true);
      if (videoStudio) {
        const vPreset = params.get('preset') || (window.MAP3D_STANDALONE_VIDEO_MODULE ? 'dubai' : null);
        if (vPreset) await videoStudio.loadPresetById(vPreset);
        if (params.get('storyboard')) videoStudio.vState.storyboard = params.get('storyboard');
        if (params.get('wave')) videoStudio.vState.waveMode = params.get('wave');
        if (params.get('mat')) videoStudio.vState.matStyle = params.get('mat');
        if (params.get('frame')) videoStudio.vState.frameStyle = params.get('frame');
        if (params.get('palette')) {
          const pal = PALETTES.find(x => x.id === params.get('palette'));
          if (pal) {
            videoStudio.vState.paletteId = pal.id;
            videoStudio.vState.colors = { ...pal.colors };
            if (pal.id === 'white') videoStudio.vState.colors.water = '#161b24';
          }
        }
        videoStudio.syncControlsFromState();
        if (params.get('triptych') === 'layers') {
          const b = document.getElementById('btnVidLayerTriptych');
          if (b) b.click();
        } else {
          videoStudio.activateModule(false);
        }
        if (params.get('t') !== null) {
          videoStudio.vState.isPlaying = false;
          videoStudio.vState.tNorm = Math.max(0, Math.min(1, parseFloat(params.get('t')) || 0));
          const scrub = document.getElementById('vidTimelineScrubber');
          if (scrub) {
            scrub.value = Math.round(videoStudio.vState.tNorm * 1000);
            scrub.dispatchEvent(new Event('input'));
          }
        }
        if (params.get('order_modal') === '1') {
          const bm = document.getElementById('btnVidOpenOrderDemo');
          if (bm) bm.click();
        }
      }
    }
  } catch (e) {
    console.warn('URL param error:', e);
  }
}

if (typeof window !== 'undefined') {
  window.saveActiveConfig = saveActiveConfig;
  window.loadActiveConfig = loadActiveConfig;
  window.scheduleSaveActiveConfig = scheduleSaveActiveConfig;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STORAGE_KEY_ACTIVE_CONFIG,
    saveActiveConfig,
    loadActiveConfig,
    scheduleSaveActiveConfig,
    applyMap3DUrlParams
  };
}
