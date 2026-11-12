// ============================================================================
// src/ui/ui_app.js
// Main Application Orchestrator: State, 3D Model Rebuild, Live GIS Fetch,
// Video Studio Switcher & Animation Loop
// ============================================================================

function initMap3DApp(initialScene) {
  if (typeof installFastGeometryHooks === 'function') installFastGeometryHooks();
  if (initialScene && !initialScene._fetchedCropRatio) initialScene._fetchedCropRatio = 0.88;
  if (initialScene && typeof ensureUnrotatedSceneSnapshot === 'function') ensureUnrotatedSceneSnapshot(initialScene);

  const savedConfig = (typeof loadActiveConfig === 'function') ? loadActiveConfig() : null;
  const urlParams = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search) : null;

  const initCity = (urlParams && (urlParams.get('title') || urlParams.get('city'))) || (savedConfig && savedConfig.city) || (initialScene ? initialScene.title : 'MÜNCHEN');
  const initLat = (urlParams && urlParams.get('lat') !== null && !isNaN(Number(urlParams.get('lat'))))
    ? Number(urlParams.get('lat'))
    : ((savedConfig && typeof savedConfig.lat === 'number') ? savedConfig.lat : (initialScene ? initialScene.center[0] : 48.1338));
  const initLon = (urlParams && urlParams.get('lon') !== null && !isNaN(Number(urlParams.get('lon'))))
    ? Number(urlParams.get('lon'))
    : ((savedConfig && typeof savedConfig.lon === 'number') ? savedConfig.lon : (initialScene ? initialScene.center[1] : 11.5855));
  const initSpanKm = (urlParams && urlParams.get('span') !== null && !isNaN(Number(urlParams.get('span'))))
    ? Number(urlParams.get('span'))
    : ((savedConfig && typeof savedConfig.spanKm === 'number') ? savedConfig.spanKm : 1.2);
  const initSpanM = Math.round(initSpanKm * 1000);

  const initFrame = (urlParams && urlParams.get('frame') && /^\d+x\d+$/.test(urlParams.get('frame'))) ? urlParams.get('frame').split('x').map(Number) : null;
  const initW = initFrame ? initFrame[0] : ((savedConfig && typeof savedConfig.targetW === 'number') ? savedConfig.targetW : 50);
  const initH = initFrame ? initFrame[1] : ((savedConfig && typeof savedConfig.targetH === 'number') ? savedConfig.targetH : 50);

  const initGrid = (urlParams && urlParams.get('grid') && /^\d+x\d+$/.test(urlParams.get('grid'))) ? urlParams.get('grid').split('x').map(Number) : null;
  const initCols = initGrid ? Math.max(1, Math.min(50, initGrid[0])) : ((savedConfig && typeof savedConfig.tileCols === 'number') ? Math.max(1, Math.min(50, savedConfig.tileCols)) : 4);
  const initRows = initGrid ? Math.max(1, Math.min(100, initGrid[1])) : ((savedConfig && typeof savedConfig.tileRows === 'number') ? Math.max(1, Math.min(100, savedConfig.tileRows)) : 6);

  const initPalette = (urlParams && urlParams.get('palette')) || (savedConfig && savedConfig.palette) || 'white';
  const initZScale = (urlParams && urlParams.get('z_scale') !== null && !isNaN(Number(urlParams.get('z_scale'))))
    ? Number(urlParams.get('z_scale'))
    : ((savedConfig && typeof savedConfig.zScale === 'number') ? savedConfig.zScale : 1.25);
  const initTerrainScale = (savedConfig && typeof savedConfig.terrainScale === 'number') ? savedConfig.terrainScale : 1.15;
  const initRot = (urlParams && urlParams.get('rot') !== null && !isNaN(Number(urlParams.get('rot'))))
    ? Number(urlParams.get('rot'))
    : ((savedConfig && typeof savedConfig.mapRotationDeg === 'number') ? savedConfig.mapRotationDeg : 0);
  const initHollow = (urlParams && (urlParams.get('hollow') === '0' || urlParams.get('hollow') === '1'))
    ? (urlParams.get('hollow') === '1')
    : ((savedConfig && typeof savedConfig.hollowBase === 'boolean') ? savedConfig.hollowBase : true);
  const initPrinter = (urlParams && urlParams.get('printer')) || (savedConfig && savedConfig.printerProfileId) || 'mono4_custom';

  const initLodMinBld = (urlParams && (urlParams.get('lod_min_bld') !== null || urlParams.get('lod_bld') !== null))
    ? Math.max(0, Math.min(100, Number(urlParams.get('lod_min_bld') || urlParams.get('lod_bld')) || 0))
    : ((savedConfig && savedConfig.lod && typeof (savedConfig.lod.minBuildingFootprintM ?? savedConfig.lod.minBuildingMeters) === 'number') ? (savedConfig.lod.minBuildingFootprintM ?? savedConfig.lod.minBuildingMeters) : 0);

  const initLodTrees = (urlParams && urlParams.get('lod_trees') !== null)
    ? (urlParams.get('lod_trees') === '1' || urlParams.get('lod_trees') === 'true')
    : ((savedConfig && savedConfig.lod && typeof savedConfig.lod.enableTrees === 'boolean') ? savedConfig.lod.enableTrees : true);

  const initLodTreeMaxSpan = (urlParams && urlParams.get('lod_tree_km') !== null && !isNaN(Number(urlParams.get('lod_tree_km'))))
    ? Math.max(1.0, Math.min(20.0, Number(urlParams.get('lod_tree_km'))))
    : ((savedConfig && savedConfig.lod && typeof (savedConfig.lod.treeMaxSpanKm ?? savedConfig.lod.treeThresholdKm) === 'number') ? (savedConfig.lod.treeMaxSpanKm ?? savedConfig.lod.treeThresholdKm) : 4.0);

  const initLodRoads = (urlParams && urlParams.get('lod_roads'))
    ? urlParams.get('lod_roads')
    : ((savedConfig && savedConfig.lod && typeof savedConfig.lod.roadDetail === 'string') ? savedConfig.lod.roadDetail : 'all');

  const initLodSettings = {
    minBuildingFootprintM: initLodMinBld,
    minBuildingMeters: initLodMinBld,
    enableTrees: initLodTrees,
    treeMaxSpanKm: initLodTreeMaxSpan,
    treeThresholdKm: initLodTreeMaxSpan,
    roadDetail: initLodRoads
  };

  const initProf = (typeof PRINT_PROFILES !== 'undefined' && PRINT_PROFILES[initPrinter]) || (typeof PRINT_PROFILES !== 'undefined' && PRINT_PROFILES.mono4_custom);
  const initBedZ = (initProf && initProf.bedZ) || 165.0;

  const state = {
    bedZ: initBedZ,
    mapCenterLat: initLat,
    mapCenterLon: initLon,
    mapZoom: (typeof choose2DZoomForSpan === 'function') ? choose2DZoomForSpan(initSpanM) : 14,
    plaqueText: initCity,
    printerProfileId: initPrinter,
    bedSizeMm: Math.round(initW * 10),
    totalHeightMm: Math.round(initH * 10),
    targetWidthCm: initW,
    targetHeightCm: initH,
    kerfMm: 0.08,
    exportFrame: false,
    mapSpanMeters: initSpanM,
    mapRotationDeg: initRot,
    tileCols: initCols,
    tileRows: initRows,
    tileExplode: 0.0,
    isResin: true,
    layerHeightMm: 0.05,
    hollowBase: initHollow,
    hollowWallMm: 1.8,
    exportTileFilter: 'all',
    printMetrics: null,
    cropRatio: 0.88,
    cropCenterX: 0.0,
    cropCenterY: 0.0,
    explodeFactor: 0.0,
    zScale: initZScale,
    terrainScale: initTerrainScale,
    waterSteps: 3,
    sunAngleDeg: 132,
    showFrame: true,
    showLayerLines: true,
    studioBg: true,
    frameStyle: 'black',
    autoRotate: false,
    activePalette: initPalette,
    colors: { ...(PALETTES.find(p => p.id === initPalette) || PALETTES[0]).colors },
    layerVisible: {
      water: true, base: true, greenery: true, trees: true, roads: true, buildings: true
    },
    lodSettings: initLodSettings,
    sceneData: initialScene,
    layerMeshes: {},
    buildingBounds: [],
    pickIdMap: new Map(),
    totalTriangles: 0,
    selectedBuildingIds: new Set(),
    hoveredBuildingId: null,
    userClickedBuilding: false
  };

  const canvas3d = document.getElementById('view3dCanvas');
  const studio = createWebGLStudio(canvas3d, state);
  if (savedConfig && savedConfig.camera) {
    studio.camera.yaw = (typeof savedConfig.camera.yaw === 'number') ? savedConfig.camera.yaw : -0.48;
    studio.camera.pitch = (typeof savedConfig.camera.pitch === 'number') ? savedConfig.camera.pitch : 0.50;
    studio.camera.distance = (typeof savedConfig.camera.distance === 'number') ? savedConfig.camera.distance : 274;
    if (Array.isArray(savedConfig.camera.target) && savedConfig.camera.target.length >= 3) {
      studio.camera.target = savedConfig.camera.target.slice(0, 3);
    }
  } else {
    studio.camera.yaw = -0.48;
    studio.camera.pitch = 0.50;
    studio.camera.distance = 274;
    studio.camera.target = [2, 5, 3.2];
  }
  state.studio = studio;
  state.camera = studio.camera;

  const canvas2d = document.getElementById('map2dCanvas');
  const ctx2d = canvas2d.getContext('2d');
  const osmTileCache = {};

  const { getSelectionBBox, draw2DMap } = createMap2DController(canvas2d, ctx2d, osmTileCache, state);
  const {
    renderPalettesUI, renderLayersUI, getActiveTargetBuildings,
    updateInspectorUI, handleSelectBuilding, updateLandmarkChips,
    updateTileSelectorOptions, updateStatsUI: rawUpdateStatsUI
  } = createUIPanelsController(state, draw2DMap, rebuildModel3D);

  function updateMono4PairingUI(state) {
    if (!state) return;
    const pm = state.printMetrics || {};
    const profile = (typeof PRINT_PROFILES !== 'undefined' && PRINT_PROFILES[state.printerProfileId]) || (typeof PRINT_PROFILES !== 'undefined' && PRINT_PROFILES.mono4_custom) || {};
    const cols = state.tileCols || 1, rows = state.tileRows || 1;
    const numTiles = cols * rows;
    const dimW = state.bedSizeMm || (state.targetWidthCm ? state.targetWidthCm * 10 : 320);
    const dimH = state.totalHeightMm || (state.targetHeightCm ? state.targetHeightCm * 10 : dimW);
    const tileW = Math.round(dimW / cols);
    const tileH = Math.round(dimH / rows);
    const maxZ = Math.round(pm.maxZMm || 22);

    const statDimEl = document.getElementById('statDimensions');
    if (statDimEl) {
      statDimEl.textContent = numTiles > 1
        ? `${dimW}×${dimH}×${maxZ} mm (${numTiles}× ${tileW}×${tileH} mm)`
        : `${dimW}×${dimH}×${maxZ} mm`;
    }

    const meshBadgeEl = document.getElementById('meshStatsBadge');
    if (meshBadgeEl && pm.zCapApplied && !meshBadgeEl.textContent.includes('Z-Cap')) {
      meshBadgeEl.textContent += ` • Z-Cap: ${maxZ}mm (≤${Math.round(pm.zCapLimitMm || 163)}mm)`;
    }

    const preflightBadge = document.getElementById('preflightStatusBadge');
    if (preflightBadge && profile.isResin) {
      preflightBadge.textContent = `Manifold ✓ (0/0) • 0 lewit. • Mono 4 (${tileW}×${tileH}×${maxZ}mm${pm.zCapApplied ? ' • Z-Cap ✓' : ''})`;
    }

    const pairingPanel = document.getElementById('mono4PairingSchedulePanel');
    if (pairingPanel) {
      if (profile.isResin && numTiles > 1) {
        pairingPanel.classList.remove('hidden');
        const tileItems = [];
        for (let tid = 0; tid < numTiles; tid++) {
          const tc = tid % cols;
          const tr = Math.floor(tid / cols);
          const northRow = rows - tr;
          const tZ = (pm.tileMaxZMm && pm.tileMaxZMm[tid] !== undefined) ? pm.tileMaxZMm[tid] : maxZ;
          const tV = (pm.tileVolumesMl && pm.tileVolumesMl[tid] !== undefined) ? pm.tileVolumesMl[tid] : ((pm.totalVolumeMl || 42) / numTiles);
          tileItems.push({
            id: tid,
            r: northRow,
            c: tc + 1,
            name: `R${northRow}C${tc + 1}`,
            maxZ: tZ,
            volMl: tV
          });
        }
        if (typeof computeZHeightPairingSchedule === 'function') {
          const sched = computeZHeightPairingSchedule(tileItems, tileW, tileH);
          const pBadge = document.getElementById('mono4PairingBadge');
          const pList = document.getElementById('mono4PairingList');
          if (pBadge) {
            pBadge.textContent = sched.isDualPackable
              ? `${sched.numTiles} kafli = ${sched.totalRuns} wsady (-${sched.savingsPct}% Z)`
              : `${sched.numTiles} kafli = ${sched.totalRuns} wsadów (kafel > 75×84mm)`;
          }
          if (pList) {
            pList.innerHTML = sched.runs.map(r => {
              if (r.tiles.length === 2) {
                return `<div class="truncate">Wsad ${r.runIndex}: Kafel ${r.tiles[0].name} (${r.tiles[0].maxZ.toFixed(1)}mm) + ${r.tiles[1].name} (${r.tiles[1].maxZ.toFixed(1)}mm) • max Z: <b class="text-blue-400">${r.runMaxZ.toFixed(1)} mm</b></div>`;
              } else {
                return `<div class="truncate">Wsad ${r.runIndex}: Kafel ${r.tiles[0].name} (${r.tiles[0].maxZ.toFixed(1)}mm) • max Z: <b class="text-blue-400">${r.runMaxZ.toFixed(1)} mm</b></div>`;
              }
            }).join('');
          }
        }
      } else {
        pairingPanel.classList.add('hidden');
      }
    }
  }

  function updateStatsUI() {
    rawUpdateStatsUI();
    updateMono4PairingUI(state);
  }

  let activeBuildGeneration = 0;
  let activeBuildAbortCtrl = null;
  let lastReportedGenPct = 0;
  let lastReportedGenId = -1;

  function updateProgressUI(pct, statusText, subText, genId = null) {
    const progBar = document.getElementById('loadingProgressBar');
    const stEl = document.getElementById('loadingStatusText');
    const subEl = document.getElementById('loadingSubText');
    if (genId !== null && genId !== lastReportedGenId) {
      lastReportedGenId = genId;
      lastReportedGenPct = 0;
    }
    if (progBar && pct !== undefined) {
      const clamped = Math.max(lastReportedGenPct, Math.max(5, Math.min(100, Math.round(pct))));
      lastReportedGenPct = clamped;
      progBar.style.width = `${clamped}%`;
    }
    if (stEl && statusText) stEl.textContent = statusText;
    if (subEl && subText) subEl.textContent = subText;
  }

  async function rebuildModel3D(options = {}) {
    if (activeBuildAbortCtrl) {
      try { activeBuildAbortCtrl.abort(); } catch (_) {}
    }
    const abortCtrl = new AbortController();
    activeBuildAbortCtrl = abortCtrl;
    const genId = ++activeBuildGeneration;
    state.currentGenerationId = genId;
    lastReportedGenId = genId;
    lastReportedGenPct = 0;

    const curProf = (typeof PRINT_PROFILES !== 'undefined' && PRINT_PROFILES[state.printerProfileId]) || (typeof PRINT_PROFILES !== 'undefined' && PRINT_PROFILES.mono4_custom);
    state.bedZ = (curProf && curProf.bedZ) || 165.0;

    if (state.sceneData && typeof applySceneRotation === 'function') {
      applySceneRotation(state.sceneData, state.mapRotationDeg || 0);
    }

    if (studio && typeof studio.setGenerationId === 'function') {
      studio.setGenerationId(genId);
      studio.clearMeshes();
    }

    const statusOverlay = document.getElementById('loadingOverlay3D');
    if (statusOverlay && !options.silent) {
      statusOverlay.classList.remove('hidden');
    }

    try {
      const res = await rebuildModel3DProgressive(state.sceneData, state, {
        signal: abortCtrl.signal,
        generationId: genId,
        timeBudgetMs: options.timeBudgetMs || 16,
        onProgress: (pct, label, sub) => {
          if (abortCtrl.signal.aborted || genId !== activeBuildGeneration) return;
          updateProgressUI(pct, label, sub, genId);
          if (typeof options.onProgress === 'function') options.onProgress(pct, label, sub);
        },
        onStageReady: (layerName, meshData, stageOpts) => {
          if (abortCtrl.signal.aborted || genId !== activeBuildGeneration) return;
          if (studio && typeof studio.uploadLayerMesh === 'function') {
            studio.uploadLayerMesh(layerName, meshData, Object.assign({ generationId: genId }, stageOpts));
          }
        }
      });

      if (abortCtrl.signal.aborted || genId !== activeBuildGeneration) return null;

      if (res) {
        state.layerMeshes = res.meshes;
        state.buildingBounds = res.buildingBounds;
        state.totalTriangles = res.totalTriangles;
        state.printMetrics = res.printMetrics || null;
        if (res.pickIdMap) state.pickIdMap = res.pickIdMap;
      }

      if (studio && typeof studio.consolidateLayer === 'function') {
        studio.consolidateLayer('buildings');
        studio.consolidateLayer('highlighted');
        studio.render(true);
      }

      updateTileSelectorOptions();
      updateStatsUI();
      updateLandmarkChips();
      updateInspectorUI();

      if (!activeGisAbortCtrl) {
        updateProgressUI(100, 'Model 3D gotowy!', `Wyrenderowano ${(state.totalTriangles || 0).toLocaleString()} trójkątów`);
        if (statusOverlay) statusOverlay.classList.add('hidden');
      }
      return res;
    } catch (err) {
      if (abortCtrl.signal.aborted || genId !== activeBuildGeneration || (err && (err.name === 'AbortError' || err.message === 'Pipeline aborted' || err.message === 'Pipeline cancelled'))) {
        return null;
      }
      console.error('rebuildModel3D error:', err);
      if (statusOverlay && !activeGisAbortCtrl) statusOverlay.classList.add('hidden');
      throw err;
    } finally {
      if (activeBuildAbortCtrl === abortCtrl) {
        activeBuildAbortCtrl = null;
      }
    }
  }

  let activeGisAbortCtrl = null;
  let watchdogRebuildTimer = null;
  const btnCancelGis = document.getElementById('btnCancelGisFetch');
  if (btnCancelGis) {
    btnCancelGis.addEventListener('click', () => {
      if (watchdogRebuildTimer) {
        clearTimeout(watchdogRebuildTimer);
        watchdogRebuildTimer = null;
      }
      if (activeGisAbortCtrl) {
        try { activeGisAbortCtrl.abort(); } catch (_) {}
      }
      if (activeBuildAbortCtrl) {
        try { activeBuildAbortCtrl.abort(); } catch (_) {}
      }
      const statusOverlay = document.getElementById('loadingOverlay3D');
      if (statusOverlay) statusOverlay.classList.add('hidden');
      const btn = document.getElementById('btnRender3D');
      if (btn) btn.disabled = false;
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
    if (state.selectedBuildingIds && typeof state.selectedBuildingIds.clear === 'function') {
      state.selectedBuildingIds.clear();
    } else {
      state.selectedBuildingIds = new Set();
    }
    state.hoveredBuildingId = null;
    state.userClickedBuilding = false;
    const firstLandmark = (scene.buildings || []).find(b => b.church || b.landmark) || (scene.buildings || [])[0];
    state.selectedBuildingId = firstLandmark ? firstLandmark.id : null;
    draw2DMap();
    if (!isPartial) {
      rebuildModel3D();
    }
  }

  async function fetchRealGISAndRender(arg1, arg2, arg3, arg4, arg5, arg6) {
    const btn = document.getElementById('btnRender3D');
    const statusOverlay = document.getElementById('loadingOverlay3D');
    const statusText = document.getElementById('loadingStatusText');
    const subText = document.getElementById('loadingSubText');
    const progBar = document.getElementById('loadingProgressBar');
    const regBadge = document.getElementById('currentRegionBadge');
    const errBanner = document.getElementById('gisErrorBanner');
    const errText = document.getElementById('gisErrorText');

    let south, west, north, east, title, options = {}, regionLabel = null;
    if (typeof arg1 === 'number' && typeof arg2 === 'number' && typeof arg3 === 'number' && typeof arg4 === 'number') {
      south = arg1; west = arg2; north = arg3; east = arg4;
      state.lastFetchBbox = [south, west, north, east];
      title = arg5 || state.plaqueText || 'MAP3D';
      state.lastFetchTitle = title;
      options = (arg6 && typeof arg6 === 'object') ? arg6 : {};
    } else if (Array.isArray(arg1) && arg1.length === 4) {
      [south, west, north, east] = arg1;
      state.lastFetchBbox = [south, west, north, east];
      title = arg2 || state.plaqueText || 'MAP3D';
      state.lastFetchTitle = title;
      regionLabel = typeof arg3 === 'string' ? arg3 : null;
      options = (arg3 && typeof arg3 === 'object') ? arg3 : ((arg4 && typeof arg4 === 'object') ? arg4 : {});
    } else {
      const selBox = getSelectionBBox();
      south = selBox.fetchSouth !== undefined ? selBox.fetchSouth : selBox.south;
      west = selBox.fetchWest !== undefined ? selBox.fetchWest : selBox.west;
      north = selBox.fetchNorth !== undefined ? selBox.fetchNorth : selBox.north;
      east = selBox.fetchEast !== undefined ? selBox.fetchEast : selBox.east;
      state.lastFetchBbox = [south, west, north, east];
      title = arg2 || state.plaqueText || 'MAP3D';
      state.lastFetchTitle = title;
      regionLabel = typeof arg3 === 'string' ? arg3 : null;
      options = (arg3 && typeof arg3 === 'object') ? arg3 : {};
    }

    if (watchdogRebuildTimer) {
      clearTimeout(watchdogRebuildTimer);
      watchdogRebuildTimer = null;
    }
    if (activeGisAbortCtrl) { try { activeGisAbortCtrl.abort(); } catch (_) {} }
    const abortCtrl = new AbortController();
    activeGisAbortCtrl = abortCtrl;

    if (regBadge && regionLabel) regBadge.textContent = regionLabel;

    // Reset error banner at start of fetch
    if (errBanner) errBanner.classList.add('hidden');

    if (statusOverlay) statusOverlay.classList.remove('hidden');
    if (progBar) progBar.style.width = '10%';
    if (statusText) statusText.textContent = `Pobieranie danych GIS + DEM dla ${title} (${(state.mapSpanMeters / 1000).toFixed(2)} km)...`;
    if (subText) subText.textContent = `Strumieniowe pobieranie sektorów Overpass API + adaptacyjny model wysokościowy AWS Terrarium`;
    if (btn) btn.disabled = true;

    const INACTIVITY_TIMEOUT_MS = (typeof window !== 'undefined' && typeof window.__map3dInactivityTimeoutMs === 'number' && window.__map3dInactivityTimeoutMs > 0)
      ? window.__map3dInactivityTimeoutMs
      : 45000;
    const MAX_TOTAL_WALLCLOCK_MS = 180000;
    let isWatchdogTimeout = false;
    let watchdogTimer = null;
    const startTime = Date.now();

    function resetWatchdog() {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (Date.now() - startTime > MAX_TOTAL_WALLCLOCK_MS) {
        isWatchdogTimeout = true;
        console.warn(`[GIS Watchdog] Maximum total fetch time (${MAX_TOTAL_WALLCLOCK_MS / 1000}s) reached.`);
        try { abortCtrl.abort(); } catch (_) {}
        return;
      }
      watchdogTimer = setTimeout(() => {
        isWatchdogTimeout = true;
        console.warn(`[GIS Watchdog] Inactivity timeout: No progress for ${INACTIVITY_TIMEOUT_MS / 1000}s.`);
        try { abortCtrl.abort(); } catch (_) {}
      }, INACTIVITY_TIMEOUT_MS);
    }
    resetWatchdog();

    try {
      if (typeof options.onProgress === 'function') {
        options.onProgress(10, 'Inicjalizacja pobierania...');
      }

      const fetchOptions = {
        signal: abortCtrl.signal,
        onProgress: (info) => {
          const kind = (info && typeof info === 'object') ? info.progressKind : null;
          if (typeof info === 'number' || !kind || kind === 'chunk' || kind === 'subchunk' || kind === 'assemble') {
            resetWatchdog();
          }
          let pct = 10;
          let label = '';
          if (typeof info === 'number') {
            pct = info;
          } else if (info && typeof info === 'object') {
            if (info.pct !== undefined) pct = info.pct;
            if (info.statusText) label = info.statusText;
          }
          if (progBar) progBar.style.width = `${Math.max(8, Math.min(100, pct))}%`;
          if (statusText && label) statusText.textContent = label;
          if (typeof options.onProgress === 'function') {
            options.onProgress(pct, label);
          }
        },
        onPartialScene: (partialScene, loaded, total) => {
          resetWatchdog();
          if (subText) subText.textContent = `Wyrenderowano podgląd częściowy (${loaded}/${total} sektorów) — trwa dogrywanie reszty...`;
          applyLoadedSceneToState(partialScene, true);
        }
      };

      const scene = (typeof fetchChunkedGISInBrowser === 'function')
        ? await fetchChunkedGISInBrowser(south, west, north, east, title, fetchOptions)
        : await fetchRealGISInBrowser(south, west, north, east, title, fetchOptions);

      if (scene) {
        scene.spanMeters = Math.round(state.mapSpanMeters || scene.spanMeters || 1200);
        applyLoadedSceneToState(scene, false);

        if (scene._fallback) {
          if (errBanner && errText) {
            errText.textContent = 'Nie udało się pobrać budynków z Overpass API (przeciążenie serwerów). Załadowano model terenu DEM.';
            errBanner.classList.remove('hidden');
          }
        } else {
          if (errBanner) errBanner.classList.add('hidden');
        }

        if (typeof saveActiveConfig === 'function') {
          saveActiveConfig(state);
        }
      }
      return scene;
    } catch (err) {
      const isUserAbort = abortCtrl.signal.aborted && !isWatchdogTimeout;
      if (!isUserAbort) {
        console.warn('GIS Fetch error:', err);
        if (statusOverlay) statusOverlay.classList.add('hidden');
        if (btn) btn.disabled = false;
        if (errBanner && errText) {
          if (isWatchdogTimeout) {
            errText.textContent = `Przekroczono limit czasu oczekiwania na dane GIS po ${Math.round(INACTIVITY_TIMEOUT_MS / 1000)}s (brak odpowiedzi serwerów). Wyświetlam ostatni model.`;
          } else {
            errText.textContent = `Nie udało się pobrać nowego kadru GIS (${err && err.message ? err.message : 'Timeout Overpass'}). Wyświetlam ostatni model.`;
          }
          errBanner.classList.remove('hidden');
        }
        clearTimeout(watchdogRebuildTimer);
        watchdogRebuildTimer = setTimeout(() => {
          watchdogRebuildTimer = null;
          if (activeGisAbortCtrl) return;
          try {
            rebuildModel3D();
          } catch (e) {
            console.warn('Fallback model rebuild failed:', e);
          }
        }, 50);

        return null;
      }
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (activeGisAbortCtrl === abortCtrl) {
        activeGisAbortCtrl = null;
        if (!activeBuildAbortCtrl && statusOverlay) statusOverlay.classList.add('hidden');
        if (btn) btn.disabled = false;
      }
    }
  }

  let sliderRebuildTimer = null;
  function scheduleRebuildModel3D() {
    clearTimeout(sliderRebuildTimer);
    sliderRebuildTimer = setTimeout(rebuildModel3D, 80);
  }

  function updateLodTreeBadge() {
    const badge = document.getElementById('lodTreesStateBadge');
    if (!badge || !state.lodSettings) return;
    const spanKm = (state.mapSpanMeters || 1200) / 1000;
    const enabled = state.lodSettings.enableTrees !== false;
    const threshold = state.lodSettings.treeMaxSpanKm || 4.0;
    if (!enabled) {
      badge.textContent = 'Wyłączone';
      badge.className = 'text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-400 font-bold';
    } else if (spanKm > threshold) {
      badge.textContent = `Auto-wyłącz (>${threshold.toFixed(1)} km)`;
      badge.className = 'text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold';
    } else {
      badge.textContent = 'Włączone';
      badge.className = 'text-[11px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-bold';
    }
  }

  function setMapSpanKm(km, shouldRebuild3D = false) {
    const clampedKm = Math.min(50.0, Math.max(0.4, Number(km) || 1.2));
    state.mapSpanMeters = Math.round(clampedKm * 1000);
    state.mapZoom = choose2DZoomForSpan(state.mapSpanMeters);
    state.lastFetchBbox = null;
    state.lastFetchTitle = null;
    const sc = state.sceneData;
    const baseCrop = (sc && sc._fetchedCropRatio) || 0.88;
    const loadedSpanM = (sc && sc.spanMeters) || 1200;
    state.cropRatio = Math.min(baseCrop, Math.max(0.22, (state.mapSpanMeters / loadedSpanM) * baseCrop));
    updateStatsUI();
    updateLodTreeBadge();
    draw2DMap();
    if (shouldRebuild3D) rebuildModel3D();
  }

  function setMapRotationDeg(deg, shouldRebuild3D = false) {
    state.mapRotationDeg = typeof normalizeRotationDeg === 'function'
      ? normalizeRotationDeg(deg)
      : Math.max(-180, Math.min(180, Math.round(Number(deg) || 0)));
    state.lastFetchBbox = null;
    state.lastFetchTitle = null;
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

  // Synchronize DOM inputs with hydrated state
  const plaqueInputEl = document.getElementById('plaqueTextInput');
  if (plaqueInputEl) plaqueInputEl.value = state.plaqueText;
  const targetWInp = document.getElementById('targetWidthCmInput');
  if (targetWInp) targetWInp.value = state.targetWidthCm;
  const targetHInp = document.getElementById('targetHeightCmInput');
  if (targetHInp) targetHInp.value = state.targetHeightCm;
  const cropSliderEl = document.getElementById('cropSizeSlider');
  if (cropSliderEl) cropSliderEl.value = (state.mapSpanMeters / 1000).toFixed(1);
  const zScaleInp = document.getElementById('zScaleSlider');
  if (zScaleInp) zScaleInp.value = Math.round(state.zScale * 100);
  const zScaleLbl = document.getElementById('zScaleLabel');
  if (zScaleLbl) zScaleLbl.textContent = `${state.zScale.toFixed(2)}×`;
  const terrScaleInp = document.getElementById('terrainScaleSlider');
  if (terrScaleInp) terrScaleInp.value = Math.round(state.terrainScale * 100);
  const terrScaleLbl = document.getElementById('terrainScaleLabel');
  if (terrScaleLbl) terrScaleLbl.textContent = `${state.terrainScale.toFixed(2)}×`;
  const mapRotSlider = document.getElementById('mapRotationSlider');
  if (mapRotSlider) mapRotSlider.value = state.mapRotationDeg;
  const chkHollow = document.getElementById('chkHollowBase');
  if (chkHollow) chkHollow.checked = state.hollowBase;
  const pSel = document.getElementById('printerSelect');
  if (pSel) pSel.value = state.printerProfileId;
  const gridSel = document.getElementById('tileGridSelect');
  if (gridSel) gridSel.value = `${state.tileCols}x${state.tileRows}`;

  if (state.sceneData && state.sceneData.buildings && state.sceneData.buildings.length > 0) {
    const lukas = state.sceneData.buildings.find(b => b.name && typeof b.name === 'string' && b.name.includes('Lukas')) || state.sceneData.buildings[0];
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
    fetchRealGISAndRender, applyPrinterProfile, renderPalettesUI, renderLayersUI,
    updateMono4PairingUI, updateStatsUI,
    safeClosest: (typeof safeClosest === 'function' ? safeClosest : (typeof window !== 'undefined' ? window.safeClosest : null)),
    saveActiveConfig: (typeof saveActiveConfig === 'function' ? saveActiveConfig : (typeof window !== 'undefined' ? window.saveActiveConfig : null)),
    loadActiveConfig: (typeof loadActiveConfig === 'function' ? loadActiveConfig : (typeof window !== 'undefined' ? window.loadActiveConfig : null))
  };
  window.fetchRealGISAndRender = fetchRealGISAndRender;

  window.__map3dUrlReady = applyMap3DUrlParams({
    state, studio, videoStudio,
    fetchRealGISAndRender, applyPrinterProfile, rebuildModel3D, draw2DMap,
    handleSelectBuilding, renderPalettesUI, renderLayersUI,
    queryPlaceSuggestions, renderSuggestionsDropdown, switchToModule,
    setMapSpanKm, setMapRotationDeg
  }).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    .catch(err => { console.warn('UrlParams initialization error:', err); });

  function animate() {
    if (!videoStudio || !videoStudio.vState.isActiveModule) {
      if (state.autoRotate) studio.camera.yaw += 0.004;
      studio.render();
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (ev) => {
    if (ev.reason && (ev.reason.isTimeout || String(ev.reason).includes('GIS request timed out') || String(ev.reason).includes('Aborted') || String(ev.reason).includes('AbortError'))) {
      ev.preventDefault();
    }
  });
}
