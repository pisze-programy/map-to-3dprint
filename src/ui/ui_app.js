// ============================================================================
// src/ui/ui_app.js
// Main Application Orchestrator: State, 3D Model Rebuild, Live GIS Fetch,
// Video Studio Switcher & Animation Loop
// ============================================================================

function initMap3DApp(initialScene) {
  if (typeof installFastGeometryHooks === 'function') installFastGeometryHooks();
  if (initialScene && !initialScene._fetchedCropRatio) initialScene._fetchedCropRatio = 0.88;
  if (initialScene && typeof ensureUnrotatedSceneSnapshot === 'function') ensureUnrotatedSceneSnapshot(initialScene);

  const state = {
    mapCenterLat: initialScene ? initialScene.center[0] : 48.1338,
    mapCenterLon: initialScene ? initialScene.center[1] : 11.5855,
    mapZoom: 14,
    plaqueText: initialScene ? initialScene.title : 'MÜNCHEN',
    printerProfileId: 'mono4_custom',
    bedSizeMm: 500,
    totalHeightMm: 500,
    targetWidthCm: 50,
    targetHeightCm: 50,
    kerfMm: 0.08,
    exportFrame: false,
    mapSpanMeters: 1200,
    mapRotationDeg: 0,
    tileCols: 4,
    tileRows: 6,
    tileExplode: 0.0,
    isResin: true,
    layerHeightMm: 0.05,
    hollowBase: true,
    hollowWallMm: 1.8,
    exportTileFilter: 'all',
    printMetrics: null,
    cropRatio: 0.88,
    cropCenterX: 0.0,
    cropCenterY: 0.0,
    explodeFactor: 0.0,
    zScale: 1.25,
    terrainScale: 1.15,
    waterSteps: 3,
    sunAngleDeg: 132,
    showFrame: true,
    showLayerLines: true,
    studioBg: true,
    frameStyle: 'black',
    autoRotate: false,
    activePalette: 'studio',
    colors: { ...(PALETTES.find(p => p.id === 'studio') || PALETTES[0]).colors },
    layerVisible: {
      water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true
    },
    sceneData: initialScene,
    selectedBuildingId: null,
    selectedBuildingIds: new Set(),
    hoveredBuildingId: null,
    userClickedBuilding: false,
    layerMeshes: {},
    buildingBounds: [],
    pickIdMap: new Map(),
    totalTriangles: 0
  };

  const canvas3d = document.getElementById('view3dCanvas');
  const studio = createWebGLStudio(canvas3d, state);
  studio.camera.yaw = -0.48;
  studio.camera.pitch = 0.50;
  studio.camera.distance = 274;
  studio.camera.target = [2, 5, 3.2];

  const canvas2d = document.getElementById('map2dCanvas');
  const ctx2d = canvas2d.getContext('2d');
  const osmTileCache = {};

  const { getSelectionBBox, draw2DMap } = createMap2DController(canvas2d, ctx2d, osmTileCache, state);
  const {
    renderPalettesUI, renderLayersUI, getActiveTargetBuildings,
    updateInspectorUI, handleSelectBuilding, updateLandmarkChips,
    updateTileSelectorOptions, updateStatsUI
  } = createUIPanelsController(state, draw2DMap, rebuildModel3D);

  function rebuildModel3D() {
    if (state.sceneData && typeof applySceneRotation === 'function') {
      applySceneRotation(state.sceneData, state.mapRotationDeg || 0);
    }
    const res = buildComplete3DModel(state.sceneData, state);
    state.layerMeshes = res.meshes;
    state.buildingBounds = res.buildingBounds;
    state.totalTriangles = res.totalTriangles;
    state.printMetrics = res.printMetrics || null;
    if (res.pickIdMap) state.pickIdMap = res.pickIdMap;

    studio.uploadMeshes(state.layerMeshes);
    updateTileSelectorOptions();
    updateStatsUI();
    updateLandmarkChips();
    updateInspectorUI();
  }

  let activeGisAbortCtrl = null;
  const btnCancelGis = document.getElementById('btnCancelGisFetch');
  if (btnCancelGis) {
    btnCancelGis.addEventListener('click', () => {
      if (activeGisAbortCtrl) activeGisAbortCtrl.abort();
    });
  }

  function applyLoadedSceneToState(scene, isPartial = false) {
    if (!scene) return;
    scene._fetchedCropRatio = 0.88;
    state.cropRatio = 0.88;
    if (typeof ensureUnrotatedSceneSnapshot === 'function') ensureUnrotatedSceneSnapshot(scene);
    if (typeof applySceneRotation === 'function') applySceneRotation(scene, state.mapRotationDeg || 0);
    state.sceneData = scene;
    if (!isPartial && scene.center) {
      state.mapCenterLat = scene.center[0];
      state.mapCenterLon = scene.center[1];
    }
    state.cropCenterX = 0;
    state.cropCenterY = 0;
    state.selectedBuildingIds.clear();
    state.hoveredBuildingId = null;
    state.userClickedBuilding = false;
    const firstLandmark = (scene.buildings || []).find(b => b.church || b.landmark) || (scene.buildings || [])[0];
    state.selectedBuildingId = firstLandmark ? firstLandmark.id : null;
    draw2DMap();
    rebuildModel3D();
  }

  async function fetchRealGISAndRender(customBBox, titleHint, regionLabel) {
    const btn = document.getElementById('btnRender3D');
    const statusOverlay = document.getElementById('loadingOverlay3D');
    const statusText = document.getElementById('loadingStatusText');
    const subText = document.getElementById('loadingSubText');
    const progBar = document.getElementById('loadingProgressBar');
    const regBadge = document.getElementById('currentRegionBadge');

    if (activeGisAbortCtrl) { try { activeGisAbortCtrl.abort(); } catch (_) {} }
    const abortCtrl = new AbortController();
    activeGisAbortCtrl = abortCtrl;

    const selBox = getSelectionBBox();
    const [south, west, north, east] = customBBox || [
      selBox.fetchSouth !== undefined ? selBox.fetchSouth : selBox.south,
      selBox.fetchWest !== undefined ? selBox.fetchWest : selBox.west,
      selBox.fetchNorth !== undefined ? selBox.fetchNorth : selBox.north,
      selBox.fetchEast !== undefined ? selBox.fetchEast : selBox.east
    ];
    const title = titleHint || state.plaqueText || 'MAP3D';
    if (regBadge && regionLabel) regBadge.textContent = regionLabel;

    if (statusOverlay) statusOverlay.classList.remove('hidden');
    if (progBar) progBar.style.width = '10%';
    if (statusText) statusText.textContent = `Pobieranie danych GIS + DEM dla ${title} (${(state.mapSpanMeters / 1000).toFixed(2)} km)...`;
    if (subText) subText.textContent = `Strumieniowe pobieranie sektorów Overpass API + adaptacyjny model wysokościowy AWS Terrarium`;
    if (btn) btn.disabled = true;

    try {
      const scene = (typeof fetchChunkedGISInBrowser === 'function')
        ? await fetchChunkedGISInBrowser(south, west, north, east, title, {
            signal: abortCtrl.signal,
            onProgress: (info) => {
              if (progBar && info.pct !== undefined) progBar.style.width = `${Math.max(8, Math.min(100, info.pct))}%`;
              if (statusText && info.statusText) statusText.textContent = info.statusText;
            },
            onPartialScene: (partialScene, loaded, total) => {
              if (subText) subText.textContent = `Wyrenderowano podgląd częściowy (${loaded}/${total} sektorów) — trwa dogrywanie reszty...`;
              applyLoadedSceneToState(partialScene, true);
            }
          })
        : await fetchRealGISInBrowser(south, west, north, east, title);

      if (scene) {
        scene.spanMeters = Math.round(state.mapSpanMeters || scene.spanMeters || 1200);
        applyLoadedSceneToState(scene, false);
        const errBanner = document.getElementById('gisErrorBanner');
        if (errBanner) errBanner.classList.add('hidden');
      }
    } catch (err) {
      if (!abortCtrl.signal.aborted) {
        console.warn('GIS Fetch error:', err);
        const errBanner = document.getElementById('gisErrorBanner');
        const errText = document.getElementById('gisErrorText');
        if (errBanner && errText) {
          errText.textContent = `Nie udało się pobrać nowego kadru GIS (${err && err.message ? err.message : 'Timeout Overpass'}). Wyświetlam ostatni model.`;
          errBanner.classList.remove('hidden');
        }
        rebuildModel3D();
      }
    } finally {
      if (activeGisAbortCtrl === abortCtrl) {
        activeGisAbortCtrl = null;
        if (statusOverlay) statusOverlay.classList.add('hidden');
        if (btn) btn.disabled = false;
      }
    }
  }

  let sliderRebuildTimer = null;
  function scheduleRebuildModel3D() {
    clearTimeout(sliderRebuildTimer);
    sliderRebuildTimer = setTimeout(rebuildModel3D, 80);
  }

  function setMapSpanKm(km, shouldRebuild3D = false) {
    const clampedKm = Math.min(12.0, Math.max(0.4, Number(km) || 1.2));
    state.mapSpanMeters = Math.round(clampedKm * 1000);
    state.mapZoom = choose2DZoomForSpan(state.mapSpanMeters);
    const sc = state.sceneData;
    const baseCrop = (sc && sc._fetchedCropRatio) || 0.88;
    const loadedSpanM = (sc && sc.spanMeters) || 1200;
    state.cropRatio = Math.min(baseCrop, Math.max(0.22, (state.mapSpanMeters / loadedSpanM) * baseCrop));
    updateStatsUI();
    draw2DMap();
    if (shouldRebuild3D) rebuildModel3D();
  }

  function setMapRotationDeg(deg, shouldRebuild3D = false) {
    state.mapRotationDeg = typeof normalizeRotationDeg === 'function'
      ? normalizeRotationDeg(deg)
      : Math.max(-180, Math.min(180, Math.round(Number(deg) || 0)));
    updateStatsUI();
    draw2DMap();
    if (shouldRebuild3D) rebuildModel3D();
  }

  const { queryPlaceSuggestions, renderSuggestionsDropdown } = bindViewportAndSearchControls({
    canvas3d, canvas2d, studio, state,
    draw2DMap, handleSelectBuilding, setMapRotationDeg,
    scheduleRebuildModel3D, rebuildModel3D, fetchRealGISAndRender
  });

  const { applyPrinterProfile } = bindStudioPanelControls({
    state, studio,
    draw2DMap, rebuildModel3D, scheduleRebuildModel3D,
    setMapSpanKm, setMapRotationDeg, fetchRealGISAndRender,
    renderLayersUI, getActiveTargetBuildings,
    updateStatsUI, updateLandmarkChips, updateInspectorUI
  });

  renderPalettesUI();
  renderLayersUI();
  if (state.sceneData && state.sceneData.buildings && state.sceneData.buildings.length > 0) {
    const lukas = state.sceneData.buildings.find(b => b.name.includes('Lukas')) || state.sceneData.buildings[0];
    state.selectedBuildingId = lukas ? lukas.id : null;
  }
  draw2DMap();
  rebuildModel3D();
  window.addEventListener('resize', draw2DMap);

  const videoStudio = (typeof initVideoStudioModule === 'function')
    ? initVideoStudioModule({ getState: () => state, getSceneData: () => state.sceneData })
    : null;

  const printRoot = document.getElementById('print3dStudioRoot');
  const videoRoot = document.getElementById('videoStudioRoot');
  const printHeaderCtrls = document.getElementById('printHeaderControls');
  const btnTab3D = document.getElementById('btnSwitchTo3DPrint');
  const btnTabVideo = document.getElementById('btnSwitchToVideoStudio');

  function switchToModule(mode, skipSync = false) {
    const isVideo = (mode === 'video');
    if (printRoot) printRoot.classList.toggle('hidden', isVideo);
    if (videoRoot) videoRoot.classList.toggle('hidden', !isVideo);
    if (printHeaderCtrls) printHeaderCtrls.classList.toggle('hidden', isVideo);
    if (btnTab3D && btnTabVideo) {
      btnTab3D.className = isVideo
        ? 'px-2.5 py-1 rounded-md text-[var(--foreground)] hover:bg-blue-500/15 font-semibold text-xs transition flex items-center gap-1'
        : 'px-2.5 py-1 rounded-md bg-blue-600 text-white font-semibold text-xs transition flex items-center gap-1';
      btnTabVideo.className = isVideo
        ? 'px-2.5 py-1 rounded-md bg-indigo-600 text-white font-semibold text-xs transition flex items-center gap-1 shadow-sm'
        : 'px-2.5 py-1 rounded-md text-[var(--foreground)] hover:bg-blue-500/15 font-semibold text-xs transition flex items-center gap-1';
    }
    if (videoStudio) {
      if (isVideo) videoStudio.activateModule(!skipSync);
      else { videoStudio.deactivateModule(); draw2DMap(); studio.render(true); }
    }
  }

  if (btnTab3D) btnTab3D.addEventListener('click', () => switchToModule('3d'));
  if (btnTabVideo) btnTabVideo.addEventListener('click', () => switchToModule('video'));

  window.__map3d = {
    state, studio, rebuildModel3D, draw2DMap, handleSelectBuilding,
    fetchRealGISAndRender, applyPrinterProfile, renderPalettesUI, renderLayersUI
  };

  window.__map3dUrlReady = applyMap3DUrlParams({
    state, studio, videoStudio,
    fetchRealGISAndRender, applyPrinterProfile, rebuildModel3D, draw2DMap,
    handleSelectBuilding, renderPalettesUI, renderLayersUI,
    queryPlaceSuggestions, renderSuggestionsDropdown, switchToModule
  }).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  function animate() {
    if (!videoStudio || !videoStudio.vState.isActiveModule) {
      if (state.autoRotate) studio.camera.yaw += 0.004;
      studio.render();
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
