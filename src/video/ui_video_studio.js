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
    mapCenterLat: initialScene ? initialScene.center[0] : 48.1338,
    mapCenterLon: initialScene ? initialScene.center[1] : 11.5855,
    mapZoom: 15,
    cropRatio: (initialScene && initialScene._fetchedCropRatio) || 0.88,
    mapSpanMeters: (initialScene && initialScene.spanMeters) || 1291.3,
    bedSizeMm: 300,
    totalHeightMm: 300,
    targetWidthCm: 30,
    targetHeightCm: 30,
    tileCols: 1,
    tileRows: 1,
    zScale: 1.28,
    terrainScale: 1.15,

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

    elementVisible: { water: true, base: true, greenery: true, roads: true, buildings: true, highlighted: true },
    ghostHiddenLayers: false,

    paletteId: 'white',
    colors: { ...PALETTES[0].colors, water: '#161b24' },
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
  });

  const mapGisCtrl = createVideoMapGisController(vState, {
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

  function rebuildVideoSceneSlots() {
    if (!vState.sceneData) return;
    const activeSlots = vState.pinnedSlots.length > 0 ? vState.pinnedSlots : [orderCtrl.buildSlotDescriptorFromCurrent()];
    engine.uploadOrderSlots(activeSlots);
    orderCtrl.updateOrderSummaryUI(activeSlots);
    controlsCtrl.updateVideoLandmarkChips();
    renderCurrentPreviewFrame();
  }

  // Playback RAF Loop & Interactive Orbit
  let lastRafTs = 0;
  function tickPlayback(now) {
    requestAnimationFrame(tickPlayback);
    if (!vState.isActiveModule || vState.isRecording) { lastRafTs = now; return; }
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
  requestAnimationFrame(tickPlayback);

  let draggingCanvas = false, lastMouse = [0, 0];
  previewCanvas.addEventListener('mousedown', e => { draggingCanvas = true; lastMouse = [e.clientX, e.clientY]; });
  window.addEventListener('mousemove', e => {
    if (!draggingCanvas || !vState.isActiveModule) return;
    engine.userOrbitOffset.yaw += (e.clientX - lastMouse[0]) * 0.008;
    engine.userOrbitOffset.pitch = Math.max(-0.6, Math.min(0.8, engine.userOrbitOffset.pitch + (e.clientY - lastMouse[1]) * 0.008));
    lastMouse = [e.clientX, e.clientY];
    if (!vState.isPlaying) renderCurrentPreviewFrame();
  });
  window.addEventListener('mouseup', () => { draggingCanvas = false; });
  previewCanvas.addEventListener('wheel', e => {
    if (!vState.isActiveModule) return;
    e.preventDefault();
    engine.userOrbitOffset.zoomMult = Math.max(0.55, Math.min(1.75, engine.userOrbitOffset.zoomMult + e.deltaY * 0.0008));
    if (!vState.isPlaying) renderCurrentPreviewFrame();
  }, { passive: false });

  function syncFromMain3DConfigurator(resetSlots = false) {
    if (!bridge || !bridge.getState) return;
    const st = bridge.getState();
    if (!st || !st.sceneData) return;
    vState.sceneData = st.sceneData;
    vState.mapCenterLat = st.mapCenterLat;
    vState.mapCenterLon = st.mapCenterLon;
    vState.cropRatio = st.cropRatio || 0.88;
    vState.zScale = st.zScale || 1.25;
    vState.terrainScale = st.terrainScale || 1.15;
    vState.targetWidthCm = Math.round((st.bedSizeMm || 320) / 10);
    vState.targetHeightCm = Math.round((st.totalHeightMm || st.bedSizeMm || 320) / 10);
    vState.bedSizeMm = st.bedSizeMm || 320;
    vState.totalHeightMm = st.totalHeightMm || 320;
    vState.tileCols = st.tileCols || 1;
    vState.tileRows = st.tileRows || 1;
    vState.frameStyle = st.frameStyle || 'black';
    vState.title = st.plaqueText || st.sceneData.title || 'MÜNCHEN';
    if (st.layerVisible) vState.elementVisible = { ...st.layerVisible };
    if (resetSlots) vState.pinnedSlots = [];
    controlsCtrl.syncControlsFromState();
    rebuildVideoSceneSlots();
  }

  function activateModule(syncFrom3D = false) {
    vState.isActiveModule = true;
    if (syncFrom3D) syncFromMain3DConfigurator(false);
    else { controlsCtrl.syncControlsFromState(); rebuildVideoSceneSlots(); }
    vState.tNorm = 0.0;
    vState.isPlaying = true;
    syncPlayButtonUI();
    renderCurrentPreviewFrame();
  }

  function deactivateModule() { vState.isActiveModule = false; }

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
    loadPresetById: mapGisCtrl.loadPresetById,
    engine,
    vState
  };
}
