// ============================================================================
// src/ui/ui_controls_bind.js
// UI Controls Binding: Frame/Grid/Mono4 Dimensions, Explode Sliders, Printer
// Profiles, Multi-Select Inspector Actions, Camera Presets & STL/3MF Exports
// ============================================================================

function bindStudioPanelControls(ctx) {
  const {
    state, studio,
    draw2DMap, rebuildModel3D, scheduleRebuildModel3D,
    setMapSpanKm, setMapRotationDeg, fetchRealGISAndRender,
    renderLayersUI, getActiveTargetBuildings,
    updateStatsUI, updateLandmarkChips, updateInspectorUI
  } = ctx;

  const btnRender = document.getElementById('btnRender3D');
  if (btnRender) {
    btnRender.addEventListener('click', () => {
      fetchRealGISAndRender(null, state.plaqueText).catch(() => {});
    });
  }
  const btnRetryGis = document.getElementById('btnRetryGis');
  if (btnRetryGis) {
    btnRetryGis.addEventListener('click', () => {
      fetchRealGISAndRender(null, state.plaqueText).catch(() => {});
    });
  }

  const cropSizeSlider = document.getElementById('cropSizeSlider');
  if (cropSizeSlider) {
    cropSizeSlider.addEventListener('input', e => {
      setMapSpanKm(parseFloat(e.target.value) || 1.2, false);
      if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 200);
    });
    cropSizeSlider.addEventListener('change', e => {
      setMapSpanKm(parseFloat(e.target.value) || 1.2, false);
      if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
    });
  }
  document.querySelectorAll('[data-span-km]').forEach(btn => {
    btn.addEventListener('click', e => {
      const b = (typeof safeClosest === 'function' ? safeClosest(e && e.target, '[data-span-km]') : null) || btn;
      const km = parseFloat(b.getAttribute('data-span-km'));
      if (km) {
        setMapSpanKm(km, false);
        if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
      }
    });
  });

  const mapRotationSlider = document.getElementById('mapRotationSlider');
  if (mapRotationSlider) {
    mapRotationSlider.addEventListener('input', e => {
      setMapRotationDeg(parseFloat(e.target.value) || 0, false);
      if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 200);
    });
    mapRotationSlider.addEventListener('change', e => {
      setMapRotationDeg(parseFloat(e.target.value) || 0, false);
      if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
    });
  }
  document.querySelectorAll('[data-rot-deg]').forEach(btn => {
    btn.addEventListener('click', e => {
      const b = (typeof safeClosest === 'function' ? safeClosest(e && e.target, '[data-rot-deg]') : null) || btn;
      setMapRotationDeg(parseFloat(b.getAttribute('data-rot-deg')) || 0, false);
      if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
    });
  });

  const targetWidthCmInput = document.getElementById('targetWidthCmInput');
  const targetHeightCmInput = document.getElementById('targetHeightCmInput');
  function handleTargetDimensionChange() {
    const wVal = Math.max(8, Math.min(150, parseFloat(targetWidthCmInput ? targetWidthCmInput.value : 32) || 32));
    const hVal = Math.max(8, Math.min(150, parseFloat(targetHeightCmInput ? targetHeightCmInput.value : 32) || 32));
    state.targetWidthCm = wVal;
    state.targetHeightCm = hVal;
    state.bedSizeMm = Math.round(wVal * 10);
    state.totalHeightMm = Math.round(hVal * 10);
    const prof = PRINT_PROFILES[state.printerProfileId] || PRINT_PROFILES.fdm_330_1x1;
    if (prof.isResin) {
      const optGrid = computeOptimalMono4Grid(state.bedSizeMm, state.totalHeightMm);
      state.tileCols = optGrid.cols;
      state.tileRows = optGrid.rows;
    }
    draw2DMap();
    if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
  }
  if (targetWidthCmInput) targetWidthCmInput.addEventListener('change', handleTargetDimensionChange);
  if (targetHeightCmInput) targetHeightCmInput.addEventListener('change', handleTargetDimensionChange);
  document.querySelectorAll('[data-frame-size]').forEach(btn => {
    btn.addEventListener('click', e => {
      const b = (typeof safeClosest === 'function' ? safeClosest(e && e.target, '[data-frame-size]') : null) || btn;
      const [w, h] = b.getAttribute('data-frame-size').split('x').map(v => parseInt(v, 10));
      if (targetWidthCmInput) targetWidthCmInput.value = w;
      if (targetHeightCmInput) targetHeightCmInput.value = h;
      handleTargetDimensionChange();
    });
  });

  const btnAutoFitMono4 = document.getElementById('btnAutoFitMono4');
  if (btnAutoFitMono4) {
    btnAutoFitMono4.addEventListener('click', () => {
      const opt = computeOptimalMono4Grid(state.bedSizeMm || 320, state.totalHeightMm || 320);
      state.tileCols = opt.cols;
      state.tileRows = opt.rows;
      draw2DMap();
    });
  }

  const kerfMmInput = document.getElementById('kerfMmInput');
  if (kerfMmInput) kerfMmInput.addEventListener('change', e => { state.kerfMm = Math.max(0, Math.min(1.0, parseFloat(e.target.value) || 0.08)); rebuildModel3D(); });
  const chkExportFrame = document.getElementById('chkExportFrame');
  if (chkExportFrame) chkExportFrame.addEventListener('change', e => { state.exportFrame = e.target.checked; });

  const explodeSlider = document.getElementById('explodeSlider');
  const tileExplodeSlider = document.getElementById('tileExplodeSlider');
  explodeSlider.addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    state.explodeFactor = val / 100;
    document.getElementById('explodeValueLabel').textContent = `${val}%`;
    document.getElementById('explodedLegendOverlay').classList.toggle('hidden', val < 8);
  });
  document.getElementById('btnQuickExplode').addEventListener('click', () => {
    const target = state.explodeFactor > 0.2 ? 0 : 75;
    explodeSlider.value = target;
    state.explodeFactor = target / 100;
    document.getElementById('explodeValueLabel').textContent = `${target}%`;
    document.getElementById('explodedLegendOverlay').classList.toggle('hidden', target < 8);
    if (target > 0) studio.camera.pitch = 0.42;
  });

  const tileGridSelect = document.getElementById('tileGridSelect');
  if (tileGridSelect) {
    tileGridSelect.addEventListener('change', e => {
      const [cStr, rStr] = (e.target.value || '1x1').split('x');
      state.tileCols = Math.max(1, Math.min(50, parseInt(cStr, 10) || 1));
      state.tileRows = Math.max(1, Math.min(100, parseInt(rStr, 10) || 1));
      state.exportTileFilter = 'all';
      if (state.tileCols === 1 && state.tileRows === 1) {
        state.tileExplode = 0;
        if (tileExplodeSlider) tileExplodeSlider.value = 0;
        const lbl = document.getElementById('tileExplodeValueLabel');
        if (lbl) lbl.textContent = '0%';
      }
      draw2DMap();
      rebuildModel3D();
      if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
    });
  }

  if (tileExplodeSlider) {
    tileExplodeSlider.addEventListener('input', e => {
      const val = parseInt(e.target.value, 10);
      if ((state.tileCols || 1) === 1 && (state.tileRows || 1) === 1 && val > 0) {
        const prof = PRINT_PROFILES[state.printerProfileId] || PRINT_PROFILES.fdm_330_1x1;
        state.tileCols = 2; state.tileRows = prof.isResin ? 3 : 2;
        draw2DMap(); rebuildModel3D();
      }
      state.tileExplode = val / 100;
      const lbl = document.getElementById('tileExplodeValueLabel');
      if (lbl) lbl.textContent = `${val}%`;
    });
  }

  const btnQuickTileExplode = document.getElementById('btnQuickTileExplode');
  if (btnQuickTileExplode) {
    btnQuickTileExplode.addEventListener('click', () => {
      if ((state.tileCols || 1) === 1 && (state.tileRows || 1) === 1) {
        const prof = PRINT_PROFILES[state.printerProfileId] || PRINT_PROFILES.fdm_330_1x1;
        state.tileCols = 2; state.tileRows = prof.isResin ? 3 : 2;
        draw2DMap(); rebuildModel3D();
      }
      const target = state.tileExplode > 0.15 ? 0 : 65;
      if (tileExplodeSlider) tileExplodeSlider.value = target;
      state.tileExplode = target / 100;
      const lbl = document.getElementById('tileExplodeValueLabel');
      if (lbl) lbl.textContent = `${target}%`;
      if (target > 0) { studio.camera.pitch = 0.62; studio.camera.distance = 295; }
    });
  }

  function applyPrinterProfile(profileId) {
    const prof = PRINT_PROFILES[profileId] || PRINT_PROFILES.mono4_custom || PRINT_PROFILES.fdm_330_1x1;
    state.printerProfileId = prof.id;
    if (prof.isCustomMono4) {
      const curW = state.targetWidthCm || Math.round(prof.totalWidthMm / 10) || 50;
      const curH = state.targetHeightCm || Math.round(prof.totalHeightMm / 10) || 50;
      state.targetWidthCm = curW; state.targetHeightCm = curH;
      state.bedSizeMm = curW * 10; state.totalHeightMm = curH * 10;
      const opt = computeOptimalMono4Grid(state.bedSizeMm, state.totalHeightMm);
      state.tileCols = opt.cols; state.tileRows = opt.rows;
    } else {
      state.bedSizeMm = prof.totalWidthMm; state.totalHeightMm = prof.totalHeightMm;
      state.targetWidthCm = Math.round(prof.totalWidthMm / 10); state.targetHeightCm = Math.round(prof.totalHeightMm / 10);
      state.tileCols = prof.cols; state.tileRows = prof.rows;
    }
    state.exportTileFilter = 'all';
    state.isResin = !!prof.isResin;
    state.layerHeightMm = prof.isResin ? 0.05 : 0.20;
    state.hollowBase = !!prof.isResin;
    const chkH = document.getElementById('chkHollowBase');
    if (chkH) chkH.checked = state.hollowBase;
    if (state.tileCols === 1 && state.tileRows === 1) {
      state.tileExplode = 0;
      if (tileExplodeSlider) tileExplodeSlider.value = 0;
      const lbl = document.getElementById('tileExplodeValueLabel');
      if (lbl) lbl.textContent = '0%';
    }
    draw2DMap();
    rebuildModel3D();
    if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
  }

  // LoD Filter Controls Binding
  const lodMinBuildingSlider = document.getElementById('lodMinBuildingSizeSlider');
  const lodMinBuildingLabel = document.getElementById('lodMinBuildingSizeLabel');
  if (lodMinBuildingSlider) {
    if (state.lodSettings && typeof state.lodSettings.minBuildingFootprintM === 'number') {
      lodMinBuildingSlider.value = state.lodSettings.minBuildingFootprintM;
      if (lodMinBuildingLabel) {
        lodMinBuildingLabel.textContent = state.lodSettings.minBuildingFootprintM === 0
          ? '0 m (Wszystkie)'
          : `${state.lodSettings.minBuildingFootprintM} m`;
      }
    }
    lodMinBuildingSlider.addEventListener('input', e => {
      const val = parseInt(e.target.value, 10) || 0;
      if (lodMinBuildingLabel) {
        lodMinBuildingLabel.textContent = val === 0 ? '0 m (Wszystkie)' : `${val} m`;
      }
      if (!state.lodSettings) state.lodSettings = {};
      state.lodSettings.minBuildingFootprintM = val;
      if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 200);
    });
  }

  const lodEnableTreesCheck = document.getElementById('lodEnableTreesCheck');
  const lodTreesStateBadge = document.getElementById('lodTreesStateBadge');
  const lodTreeThresholdSlider = document.getElementById('lodTreeThresholdSlider');
  const lodTreeThresholdLabel = document.getElementById('lodTreeThresholdLabel');

  function updateLodTreeBadge() {
    if (!lodTreesStateBadge || !state.lodSettings) return;
    const spanKm = (state.mapSpanMeters || 1200) / 1000;
    const enabled = state.lodSettings.enableTrees !== false;
    const threshold = state.lodSettings.treeMaxSpanKm || 4.0;
    if (!enabled) {
      lodTreesStateBadge.textContent = 'Wyłączone';
      lodTreesStateBadge.className = 'text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-400 font-bold';
    } else if (spanKm > threshold) {
      lodTreesStateBadge.textContent = `Auto-wyłącz (>${threshold.toFixed(1)} km)`;
      lodTreesStateBadge.className = 'text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold';
    } else {
      lodTreesStateBadge.textContent = 'Włączone';
      lodTreesStateBadge.className = 'text-[11px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-bold';
    }
  }

  if (lodEnableTreesCheck) {
    if (state.lodSettings) lodEnableTreesCheck.checked = state.lodSettings.enableTrees !== false;
    lodEnableTreesCheck.addEventListener('change', e => {
      if (!state.lodSettings) state.lodSettings = {};
      state.lodSettings.enableTrees = e.target.checked;
      updateLodTreeBadge();
      if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 200);
    });
  }

  if (lodTreeThresholdSlider) {
    if (state.lodSettings && typeof state.lodSettings.treeMaxSpanKm === 'number') {
      lodTreeThresholdSlider.value = state.lodSettings.treeMaxSpanKm;
      if (lodTreeThresholdLabel) lodTreeThresholdLabel.textContent = `${state.lodSettings.treeMaxSpanKm.toFixed(1)} km`;
    }
    lodTreeThresholdSlider.addEventListener('input', e => {
      const val = parseFloat(e.target.value) || 4.0;
      if (lodTreeThresholdLabel) lodTreeThresholdLabel.textContent = `${val.toFixed(1)} km`;
      if (!state.lodSettings) state.lodSettings = {};
      state.lodSettings.treeMaxSpanKm = val;
      updateLodTreeBadge();
      if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 200);
    });
  }

  const lodRoadDetailSelect = document.getElementById('lodRoadDetailSelect');
  if (lodRoadDetailSelect) {
    if (state.lodSettings && state.lodSettings.roadDetail) {
      lodRoadDetailSelect.value = state.lodSettings.roadDetail;
    }
    lodRoadDetailSelect.addEventListener('change', e => {
      if (!state.lodSettings) state.lodSettings = {};
      state.lodSettings.roadDetail = e.target.value;
      if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 200);
    });
  }
  updateLodTreeBadge();

  const btnHlToggle = document.getElementById('btnToggleHighlight');
  if (btnHlToggle) {
    btnHlToggle.addEventListener('click', () => {
      const targets = getActiveTargetBuildings();
      if (!targets.length) return;
      const newState = !targets[0].highlighted;
      targets.forEach(b => { b.highlighted = newState; });
      draw2DMap();
      if (typeof fastSwapHighlightedBuildings === 'function' && fastSwapHighlightedBuildings(state)) {
        studio.uploadMeshes(state.layerMeshes);
        updateStatsUI(); updateLandmarkChips(); updateInspectorUI();
      } else {
        rebuildModel3D();
      }
    });
  }

  const btnHideBld = document.getElementById('btnToggleHideBuilding');
  if (btnHideBld) {
    btnHideBld.addEventListener('click', () => {
      const targets = getActiveTargetBuildings();
      if (!targets.length) return;
      const newState = !targets[0].hidden;
      targets.forEach(b => { b.hidden = newState; });
      draw2DMap();
      rebuildModel3D();
    });
  }

  const inspHMult = document.getElementById('inspHeightMultiplier');
  if (inspHMult) {
    inspHMult.addEventListener('input', e => {
      const targets = getActiveTargetBuildings();
      if (!targets.length) return;
      const mult = parseInt(e.target.value, 10) / 100;
      targets.forEach(b => { b.heightMult = mult; });
      const lbl = document.getElementById('inspHeightMultLabel');
      if (lbl) lbl.textContent = `${e.target.value}%`;
      scheduleRebuildModel3D();
    });
  }

  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const b = (typeof safeClosest === 'function' ? safeClosest(e && e.target, '.cam-btn') : null) || btn;
      const mode = b.getAttribute('data-cam');
      state.autoRotate = false;
      if (mode === 'studio') {
        studio.camera.yaw = -0.48; studio.camera.pitch = 0.50; studio.camera.distance = 274; studio.camera.target = [2, 5, 3.2];
      } else if (mode === 'top') {
        studio.camera.yaw = 0; studio.camera.pitch = 1.51; studio.camera.distance = 250; studio.camera.target = [0, 0, 2.0];
      } else if (mode === 'side') {
        studio.camera.yaw = -0.45; studio.camera.pitch = 0.26; studio.camera.distance = 265;
        if (state.explodeFactor < 0.3) {
          explodeSlider.value = 65; state.explodeFactor = 0.65;
          document.getElementById('explodeValueLabel').textContent = '65%';
          document.getElementById('explodedLegendOverlay').classList.remove('hidden');
        }
      } else if (mode === 'tiles') {
        if ((state.tileCols || 1) === 1 && (state.tileRows || 1) === 1) {
          applyPrinterProfile('mono4_252_2x3');
          const pSel = document.getElementById('printerSelect');
          if (pSel) pSel.value = 'mono4_252_2x3';
        }
        state.tileExplode = 0.62;
        if (tileExplodeSlider) tileExplodeSlider.value = 62;
        const lbl = document.getElementById('tileExplodeValueLabel');
        if (lbl) lbl.textContent = '62%';
        studio.camera.yaw = -0.38; studio.camera.pitch = 0.64; studio.camera.distance = 298; studio.camera.target = [0, 0, 2.5];
      } else if (mode === 'bottom') {
        studio.camera.yaw = -0.42; studio.camera.pitch = -0.68; studio.camera.distance = 255; studio.camera.target = [0, 0, 1.0];
      }
      if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
    });
  });

  document.getElementById('btnAutoRotate').addEventListener('click', () => { state.autoRotate = !state.autoRotate; });
  document.getElementById('zScaleSlider').addEventListener('input', e => {
    state.zScale = parseInt(e.target.value, 10) / 100;
    document.getElementById('zScaleLabel').textContent = `${state.zScale.toFixed(2)}×`;
    scheduleRebuildModel3D();
    if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 200);
  });
  document.getElementById('terrainScaleSlider').addEventListener('input', e => {
    state.terrainScale = parseInt(e.target.value, 10) / 100;
    document.getElementById('terrainScaleLabel').textContent = `${state.terrainScale.toFixed(2)}×`;
    scheduleRebuildModel3D();
    if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 200);
  });
  document.getElementById('sunAngleSlider').addEventListener('input', e => { state.sunAngleDeg = parseInt(e.target.value, 10); });
  document.getElementById('chkShowFrame').addEventListener('change', e => { state.showFrame = e.target.checked; });
  document.getElementById('chkStudioBg').addEventListener('change', e => { state.studioBg = e.target.checked; });
  document.getElementById('frameStyleSelect').addEventListener('change', e => { state.frameStyle = e.target.value; });
  document.getElementById('plaqueTextInput').addEventListener('input', e => {
    state.plaqueText = e.target.value || 'MAP3D';
    if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 300);
  });
  document.getElementById('printerSelect').addEventListener('change', e => applyPrinterProfile(e.target.value));

  const chkHollowBase = document.getElementById('chkHollowBase');
  if (chkHollowBase) {
    chkHollowBase.addEventListener('change', e => {
      state.hollowBase = e.target.checked;
      rebuildModel3D();
      if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
    });
  }
  const exportTileSelect = document.getElementById('exportTileSelect');
  if (exportTileSelect) exportTileSelect.addEventListener('change', e => { state.exportTileFilter = e.target.value; draw2DMap(); });

  document.getElementById('btnShowAllLayers').addEventListener('click', () => {
    Object.keys(state.layerVisible).forEach(k => { state.layerVisible[k] = true; });
    renderLayersUI(); updateStatsUI(); rebuildModel3D();
  });

  document.getElementById('btnExport3MF').addEventListener('click', () => exportMultiColor3MF(state));
  document.getElementById('btnExportSTL').addEventListener('click', () => exportBinarySTL(state, 'all'));
  document.getElementById('btnExportLayerSTL').addEventListener('click', () => {
    exportBinarySTL(state, document.getElementById('singleLayerStlSelect').value);
  });

  return { applyPrinterProfile };
}
