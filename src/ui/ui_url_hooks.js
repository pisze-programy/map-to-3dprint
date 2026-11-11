// ============================================================================
// src/ui/ui_url_hooks.js
// URL Query Parameter Hooks for Multi-Angle, Multi-City, Palette, Hover/Select
// & Video Studio Automated Inspection
// ============================================================================

async function applyMap3DUrlParams(ctx) {
  const {
    state, studio, videoStudio,
    fetchRealGISAndRender, applyPrinterProfile, rebuildModel3D, draw2DMap,
    handleSelectBuilding, renderPalettesUI, renderLayersUI,
    queryPlaceSuggestions, renderSuggestionsDropdown, switchToModule
  } = ctx;

  try {
    const params = new URLSearchParams(window.location.search);
    const placeInput = document.getElementById('placeSearchInput');
    const chkHollowBase = document.getElementById('chkHollowBase');
    const tileExplodeSlider = document.getElementById('tileExplodeSlider');
    const explodeSlider = document.getElementById('explodeSlider');
    const exportTileSelect = document.getElementById('exportTileSelect');

    const bboxStr = params.get('bbox');
    const titleStr = params.get('title') || 'KRAKÓW';
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
      state.tileCols = Math.max(1, Math.min(16, gc));
      state.tileRows = Math.max(1, Math.min(16, gr));
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
