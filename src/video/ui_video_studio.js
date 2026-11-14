// ============================================================================
// src/video/ui_video_studio.js
// Main Coordinator for the Browser Video Preview & Framed Order Demo Studio.
// Manages Studio State, Playback RAF Loop, Interactive Orbit, 3D Configurator
// Sync, and Sub-Controller Composition.
// ============================================================================

function initVideoStudioModule(bridge) {
  const rootEl = document.getElementById('videoStudioRoot');
  const previewCanvas = document.getElementById('videoPreviewCanvas');
  if (!rootEl || !previewCanvas) return null;

  const engine = createVideoPreviewEngine(previewCanvas);
  const initialScene = (bridge && bridge.getSceneData && bridge.getSceneData()) || (typeof INITIAL_REAL_SCENE !== 'undefined' ? INITIAL_REAL_SCENE : null);
  const defaultPalette = (typeof PALETTES !== 'undefined' && Array.isArray(PALETTES))
    ? (PALETTES.find(p => p.id === 'white') || PALETTES[0])
    : { id: 'white', colors: { water: '#3b82f6', base: '#e2e8f0', greenery: '#4ade80', trees: '#15803d', roads: '#f8fafc', buildings: '#ffffff' } };

  const vState = {
    isActiveModule: false,
    isPlaying: true,
    isLooping: true,
    isRecording: false,
    tNorm: 0.0,
    durationSec: 8.5,
    fps: 30,
    aspectPreset: '16x9_720',

    sceneData: initialScene,
    mapCenterLat: (initialScene && Array.isArray(initialScene.center)) ? initialScene.center[0] : ((initialScene && initialScene.lat) || 48.1338),
    mapCenterLon: (initialScene && Array.isArray(initialScene.center)) ? initialScene.center[1] : ((initialScene && initialScene.lon) || 11.5855),
    mapZoom: 15,
    cropRatio: (initialScene && initialScene._fetchedCropRatio) || 0.88,
    cropCenterX: 0,
    cropCenterY: 0,
    mapSpanMeters: (initialScene && initialScene.spanMeters) || 1291.3,
    mapRotationDeg: 0,
    bedSizeMm: 300,
    totalHeightMm: 300,
    targetWidthCm: 30,
    targetHeightCm: 30,
    tileCols: 1,
    tileRows: 1,
    zScale: 1.28,
    terrainScale: 1.15,
    isResin: true,
    xyPixelMm: 0.05,
    layerHeightMm: 0.05,
    bedZ: 200,
    printerProfileId: 'mono4_custom',
    hollowBase: true,
    waterCutout: false,
    lodSettings: { enableTrees: true, treeMaxSpanKm: 4.0, minBuildingFootprintM: 0, roadDetail: 'all' },
    highlightedBuildingIds: [],
    userClickedHighlight: false,

    storyboard: 'hero',
    waveMode: 'none',
    styleTransition: 'wire_to_studio',
    easing: 'cubic',
    frameAnimMode: 'z_drop',
    bgTheme: 'dark_to_white',
    showTelemetry: true,
    showWhipPan: true,
    showOrderHud: true,
    sunAngleDeg: 132,

    elementVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true },
    ghostHiddenLayers: false,

    paletteId: defaultPalette.id,
    colors: { ...defaultPalette.colors },
    frameStyle: 'black',
    matStyle: 'none',
    backingStyle: 'obsidian',
    showFrameProduct: true,
    showPlaque: true,
    showGlass: true,
    title: initialScene ? (initialScene.title || 'MÜNCHEN') : 'MÜNCHEN',
    subtitle: 'ARCHITECTURAL 3D EDITION',

    pinnedSlots: [],
    lastModelMetrics: null,
    recordedVideoUrl: null,
    recordedVideoExt: 'webm'
  };

  function getAnimConfig() {
    const asp = VIDEO_ASPECT_CONFIGS[vState.aspectPreset] || VIDEO_ASPECT_CONFIGS['16x9_720'];
    const numItems = Math.max(1, vState.pinnedSlots.length || 1);
    const unitEur = computeVideoItemPriceEur({
      widthCm: vState.targetWidthCm,
      heightCm: vState.targetHeightCm,
      paletteId: vState.paletteId,
      matStyle: vState.matStyle,
      showGlass: vState.showGlass,
      frameStyle: vState.frameStyle
    });
    const totalEur = vState.pinnedSlots.length > 0
      ? vState.pinnedSlots.reduce((acc, s) => acc + computeVideoItemPriceEur(s), 0)
      : unitEur;

    return {
      storyboard: vState.storyboard,
      waveMode: vState.waveMode,
      styleTransition: vState.styleTransition,
      easing: vState.easing,
      frameAnimMode: vState.frameAnimMode,
      bgTheme: vState.bgTheme,
      showTelemetry: vState.showTelemetry,
      showWhipPan: vState.showWhipPan,
      showOrderHud: vState.showOrderHud,
      showFrameProduct: vState.showFrameProduct,
      sunAngleDeg: vState.sunAngleDeg,
      durationSec: vState.durationSec,
      fps: vState.fps,
      exportWidth: asp.w,
      exportHeight: asp.h,
      dimensionsLabel: `${vState.targetWidthCm}×${vState.targetHeightCm} cm`,
      priceLabel: `${totalEur} € (${Math.round(totalEur * 4.3)} zł) • ${numItems > 1 ? numItems + ' elem.' : 'Demo Zamówienia'}`
    };
  }

  function updateTimelineLabelsUI() {
    const scrub = document.getElementById('vidTimelineScrubber');
    const timeLbl = document.getElementById('vidTimecodeBadge');
    const phaseLbl = document.getElementById('vidPhaseBadge');
    if (scrub && document.activeElement !== scrub) scrub.value = Math.round(vState.tNorm * 1000);
    if (timeLbl) timeLbl.textContent = `${(vState.tNorm * vState.durationSec).toFixed(2)}s / ${vState.durationSec.toFixed(1)}s`;
    if (!phaseLbl) return;

    const t = vState.tNorm;
    let phase = 'Obrót 360° + Ruchome Cienie Słoneczne';
    if (vState.storyboard === 'hero') {
      if (vState.showTelemetry && t < 0.13) phase = 'Faza 1/5 • Strumień Telemetrii GIS (UTM)';
      else if (vState.showWhipPan && t < 0.36) phase = 'Faza 2/5 • Kadrowanie 2D & Motion Blur';
      else if (t < 0.66) phase = 'Faza 3/5 • Ekstruzja 2D→3D & Montaż Ramy CAD';
      else if (t < 0.83) phase = 'Faza 4/5 • Przejście Shadera Wireframe → Studio';
      else phase = 'Faza 5/5 • Gotowy Produkt w Ramie (Packshot)';
    } else if (vState.storyboard === 'layer_build') {
      phase = t < 0.72 ? `Budowa Warstw Druku 3D (${Math.min(6, Math.floor(t / 0.12) + 1)}/6)` : (t < 0.88 ? 'Montaż Ramy Galeryjnej i Graweru' : 'Finał • Gotowe Zamówienie');
    } else if (vState.storyboard === 'laser_scan_morph') {
      phase = t < 0.68 ? 'Skanowanie Laserowe 2D → Relief 3D' : 'Oprawa w Ramę i Szybę Akrylową';
    } else if (vState.storyboard === 'exploded_snap') {
      phase = t < 0.66 ? 'Składanie Warstw Z i Kafli Druku' : 'Zatrzaśnięcie Listew Ramy 45°';
    }
    phaseLbl.textContent = phase;
  }

  function renderCurrentPreviewFrame() {
    if (!vState.isActiveModule || vState.isRecording) return;
    const asp = VIDEO_ASPECT_CONFIGS[vState.aspectPreset] || VIDEO_ASPECT_CONFIGS['16x9_720'];
    const wrap = document.getElementById('videoCanvasAspectWrap');
    if (wrap) wrap.style.aspectRatio = asp.cssAspect;
    const scale = Math.min(1.0, 1280 / Math.max(asp.w, asp.h));
    engine.renderFrameAt(vState.tNorm, getAnimConfig(), Math.round(asp.w * scale), Math.round(asp.h * scale));
    updateTimelineLabelsUI();
  }

  function syncPlayButtonUI() {
    const btn = document.getElementById('btnVidPlayPause');
    if (btn) btn.innerHTML = vState.isPlaying ? '⏸ Pauza' : '▶ Odtwórz';
  }

  const orderCtrl = createVideoOrderDemoController(vState, engine, previewCanvas, {
    rebuildSlots: rebuildVideoSceneSlots,
    renderPreview: renderCurrentPreviewFrame,
    getAnimConfig
  }, bridge);

  const mapGisCtrl = createVideoMapGisController(vState, {
    getMainState: () => (bridge && bridge.getState ? bridge.getState() : null),
    onSceneLoaded: () => {
      syncPlayButtonUI();
      rebuildVideoSceneSlots();
    }
  });

  const controlsCtrl = createVideoControlsController(vState, engine, previewCanvas, {
    rebuildSlots: rebuildVideoSceneSlots,
    renderPreview: renderCurrentPreviewFrame,
    syncPlayButtonUI,
    updateTimelineLabelsUI,
    getAnimConfig,
    draw2DMap: () => mapGisCtrl.draw2DMap(),
    syncFrom3D: (resetSlots) => syncFromMain3DConfigurator(resetSlots)
  });

  let slotBuildGen = 0;
  function applyBuiltSlots(activeSlots) {
    engine.uploadOrderSlots(activeSlots);
    orderCtrl.updateOrderSummaryUI(activeSlots);
    controlsCtrl.updateVideoLandmarkChips();
    renderCurrentPreviewFrame();
  }

  function rebuildVideoSceneSlots() {
    const gen = ++slotBuildGen;
    if (vState.pinnedSlots.length > 0) {
      applyBuiltSlots(vState.pinnedSlots);
      return Promise.resolve(vState.pinnedSlots);
    }
    if (!vState.sceneData) {
      const emptySlot = orderCtrl.buildSlotDescriptorFromCurrent({ sceneData: null });
      applyBuiltSlots([emptySlot]);
      return Promise.resolve([emptySlot]);
    }
    if (orderCtrl.canFastBuildCurrentSlot()) {
      const fastSlot = orderCtrl.buildSlotDescriptorFromCurrent();
      applyBuiltSlots([fastSlot]);
      return Promise.resolve([fastSlot]);
    }
    const loadingEl = document.getElementById('vidLoadingOverlay');
    const loadingTxt = document.getElementById('vidLoadingText');
    const alreadyBusy = loadingEl && !loadingEl.classList.contains('hidden');
    if (loadingEl && !alreadyBusy) loadingEl.classList.remove('hidden');
    if (loadingTxt && !alreadyBusy) loadingTxt.textContent = `Budowanie geometrii SLA (${vState.title || 'MAP3D'})...`;
    return orderCtrl.buildSlotDescriptorAsync()
      .then(slot => {
        if (gen !== slotBuildGen) return null;
        applyBuiltSlots([slot]);
        return [slot];
      })
      .finally(() => {
        if (gen === slotBuildGen && loadingEl && !alreadyBusy) loadingEl.classList.add('hidden');
      });
  }

  // Playback RAF Loop & Interactive Orbit
  let lastRafTs = 0;
  let rafId = 0;
  function schedulePlaybackTick() {
    if (!rafId && vState.isActiveModule && typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(tickPlayback);
    }
  }
  function tickPlayback(now) {
    rafId = 0;
    if (!vState.isActiveModule) { lastRafTs = 0; return; }
    schedulePlaybackTick();
    if (vState.isRecording) { lastRafTs = now; return; }
    if (!lastRafTs) lastRafTs = now;
    const dt = Math.min(0.1, (now - lastRafTs) / 1000);
    lastRafTs = now;
    if (vState.isPlaying) {
      vState.tNorm += dt / Math.max(2.0, vState.durationSec);
      if (vState.tNorm >= 1.0) {
        if (vState.isLooping) vState.tNorm %= 1.0;
        else { vState.tNorm = 1.0; vState.isPlaying = false; syncPlayButtonUI(); }
      }
      renderCurrentPreviewFrame();
    }
  }

  let draggingCanvas = false, lastMouse = [0, 0];
  previewCanvas.addEventListener('mousedown', e => { draggingCanvas = true; lastMouse = [e.clientX, e.clientY]; });
  window.addEventListener('mousemove', e => {
    if (!draggingCanvas || !vState.isActiveModule) return;
    engine.userOrbitOffset.yaw += (e.clientX - lastMouse[0]) * 0.008;
    engine.userOrbitOffset.pitch = Math.max(-0.65, Math.min(1.02, engine.userOrbitOffset.pitch + (e.clientY - lastMouse[1]) * 0.008));
    lastMouse = [e.clientX, e.clientY];
    if (!vState.isPlaying) renderCurrentPreviewFrame();
  });
  window.addEventListener('mouseup', () => { draggingCanvas = false; });
  previewCanvas.addEventListener('wheel', e => {
    if (!vState.isActiveModule) return;
    e.preventDefault();
    engine.userOrbitOffset.zoomMult = Math.max(0.14, Math.min(2.20, engine.userOrbitOffset.zoomMult + e.deltaY * 0.0008));
    if (!vState.isPlaying) renderCurrentPreviewFrame();
  }, { passive: false });

  function syncFromMain3DConfigurator(resetSlots = false) {
    if (!bridge || !bridge.getState) return;
    const st = bridge.getState();
    if (!st) return;

    vState.mapCenterLat = st.mapCenterLat !== undefined ? st.mapCenterLat : vState.mapCenterLat;
    vState.mapCenterLon = st.mapCenterLon !== undefined ? st.mapCenterLon : vState.mapCenterLon;
    if (st.mapZoom !== undefined) vState.mapZoom = st.mapZoom;
    vState.mapSpanMeters = Number(st.mapSpanMeters) || (st.sceneData && st.sceneData.spanMeters) || vState.mapSpanMeters;
    vState.cropRatio = st.cropRatio || 0.88;
    vState.cropCenterX = Number(st.cropCenterX) || 0;
    vState.cropCenterY = Number(st.cropCenterY) || 0;
    vState.zScale = st.zScale !== undefined ? st.zScale : 1.25;
    vState.terrainScale = st.terrainScale !== undefined ? st.terrainScale : 1.15;
    vState.bedSizeMm = st.bedSizeMm || (st.targetWidthCm ? st.targetWidthCm * 10 : 320);
    vState.totalHeightMm = st.totalHeightMm || (st.targetHeightCm ? st.targetHeightCm * 10 : vState.bedSizeMm);
    vState.targetWidthCm = Math.round(vState.bedSizeMm / 10);
    vState.targetHeightCm = Math.round(vState.totalHeightMm / 10);
    vState.tileCols = st.tileCols || 1;
    vState.tileRows = st.tileRows || 1;
    vState.isResin = st.isResin !== undefined ? Boolean(st.isResin) : true;
    vState.xyPixelMm = Number(st.xyPixelMm) || 0.05;
    vState.layerHeightMm = Number(st.layerHeightMm) || 0.05;
    vState.bedZ = Number(st.bedZ) || 200;
    if (st.printerProfileId) vState.printerProfileId = st.printerProfileId;
    vState.hollowBase = st.hollowBase !== undefined ? Boolean(st.hollowBase) : vState.hollowBase;
    vState.waterCutout = Boolean(st.waterCutout);
    if (vState.waterCutout && vState.backingStyle === 'white') {
      vState.backingStyle = 'obsidian';
    }
    vState.mapRotationDeg = Number(st.mapRotationDeg) || 0;
    if (st.lodSettings) vState.lodSettings = { ...st.lodSettings };

    if (st.activePalette) vState.paletteId = st.activePalette;
    if (st.colors) vState.colors = { ...st.colors };
    vState.frameStyle = st.frameStyle || 'black';
    vState.title = st.plaqueText || (st.sceneData && st.sceneData.title) || vState.title || 'MÜNCHEN';

    if (st.layerVisible) {
      const treesVis = typeof isTreesLayerVisible === 'function'
        ? isTreesLayerVisible(st.sceneData || vState.sceneData || {}, st)
        : (st.layerVisible.trees !== undefined ? Boolean(st.layerVisible.trees) : Boolean(st.layerVisible.greenery));
      vState.elementVisible = {
        ...vState.elementVisible,
        ...st.layerVisible,
        trees: treesVis
      };
    }

    if (st.sceneData) {
      vState.sceneData = st.sceneData;
      const hlIds = (st.sceneData.buildings || []).filter(b => b.highlighted).map(b => b.id);
      vState.highlightedBuildingIds = hlIds;
      vState.userClickedHighlight = Boolean((st.colors && st.colors.highlighted) || hlIds.length > 0);
    } else {
      vState.sceneData = null;
      vState.highlightedBuildingIds = [];
      vState.userClickedHighlight = false;
    }

    if (resetSlots) vState.pinnedSlots = [];
    mapGisCtrl.updateRotationBadgeUI();
    controlsCtrl.syncControlsFromState();
    rebuildVideoSceneSlots();
  }

  let autoFetchStarted = false;
  function activateModule(syncFrom3D = false) {
    vState.isActiveModule = true;
    if (syncFrom3D) syncFromMain3DConfigurator(false);
    else { mapGisCtrl.updateRotationBadgeUI(); controlsCtrl.syncControlsFromState(); rebuildVideoSceneSlots(); }
    if (!vState.sceneData && !autoFetchStarted) {
      autoFetchStarted = true;
      mapGisCtrl.triggerFetchCurrentVideoBBox(vState.title || 'MÜNCHEN');
    }
    vState.tNorm = 0.0;
    vState.isPlaying = true;
    syncPlayButtonUI();
    renderCurrentPreviewFrame();
    schedulePlaybackTick();
  }

  function deactivateModule() {
    vState.isActiveModule = false;
    lastRafTs = 0;
    if (rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
    }
    rafId = 0;
  }

  mapGisCtrl.renderPresetButtons();
  controlsCtrl.renderElementTogglesUI();
  mapGisCtrl.bindMapAndSearchControls();
  orderCtrl.bindSetAndOrderControls(mapGisCtrl.getOrFetchCachedPresetScene);
  controlsCtrl.bindStudioControls();

  return {
    activateModule,
    deactivateModule,
    syncFromMain3DConfigurator,
    syncControlsFromState: controlsCtrl.syncControlsFromState,
    rebuildVideoSceneSlots,
    loadPresetById: mapGisCtrl.loadPresetById,
    engine,
    vState
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initVideoStudioModule };
}
