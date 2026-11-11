// ============================================================================
// src/ui_panels.js
// Palettes, Layers, Multi-Select Building Inspector, Landmark Chips & Print Stats UI
// ============================================================================

function toColorHex(col, defaultHex = '#ffffff') {
  if (!col) return defaultHex;
  if (typeof col === 'string') {
    let s = col.trim();
    if (s.startsWith('#')) {
      if (s.length === 7) return s.toLowerCase();
      if (s.length === 4) {
        return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
      }
    }
    if (/^[0-9a-fA-F]{6}$/.test(s)) {
      return ('#' + s).toLowerCase();
    }
    if (s.startsWith('rgb')) {
      const m = s.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3) {
        const r = Math.min(255, Math.max(0, Math.round(parseFloat(m[0]))));
        const g = Math.min(255, Math.max(0, Math.round(parseFloat(m[1]))));
        const b = Math.min(255, Math.max(0, Math.round(parseFloat(m[2]))));
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
      }
    }
    return defaultHex;
  }
  if (Array.isArray(col) && col.length >= 3) {
    let [r, g, b] = col;
    if (r <= 1.0 && g <= 1.0 && b <= 1.0 && (r > 0 || g > 0 || b > 0)) {
      r = Math.round(r * 255);
      g = Math.round(g * 255);
      b = Math.round(b * 255);
    } else {
      r = Math.round(r);
      g = Math.round(g);
      b = Math.round(b);
    }
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  return defaultHex;
}

function createUIPanelsController(state, draw2DMap, onRebuildNeeded) {
  function renderPalettesUI() {
    const container = document.getElementById('paletteButtonsContainer');
    if (!container) return;
    container.innerHTML = '';
    PALETTES.forEach(p => {
      const btn = document.createElement('button');
      const active = state.activePalette === p.id;
      btn.className = `p-2 rounded-lg border text-left transition flex flex-col gap-1 ${
        active ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--border)] bg-[var(--background)] hover:opacity-85'
      }`;
      const swatches = Object.values(p.colors)
        .map(c => `<span class="w-3.5 h-3.5 rounded-sm border border-black/25 inline-block" style="background:${toColorHex(c)}"></span>`)
        .join('');
      btn.innerHTML = `
        <div class="text-xs font-semibold text-[var(--foreground)] truncate">${p.name}</div>
        <div class="flex items-center gap-1">${swatches}</div>
      `;
      btn.addEventListener('click', () => {
        state.activePalette = p.id;
        state.colors = {};
        for (const [k, v] of Object.entries(p.colors)) {
          state.colors[k] = toColorHex(v);
        }
        renderPalettesUI();
        renderLayersUI();
        if (onRebuildNeeded) onRebuildNeeded();
      });
      container.appendChild(btn);
    });
  }

  function renderLayersUI() {
    const container = document.getElementById('layersListContainer');
    if (!container) return;
    container.innerHTML = '';
    LAYERS_META.forEach(m => {
      const row = document.createElement('div');
      row.className = 'bg-[var(--background)] border border-[var(--border)] rounded-lg p-1.5 flex items-center justify-between gap-2';
      const isVis = state.layerVisible[m.key] !== false;
      const rawVal = state.colors[m.key] || state.colors.greenery || '#488e52';
      const colVal = toColorHex(rawVal, '#488e52');
      row.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          <input type="checkbox" data-layer-vis="${m.key}" ${isVis ? 'checked' : ''} class="rounded cursor-pointer" />
          <input type="color" data-layer-col="${m.key}" value="${colVal}" class="w-6 h-6 rounded cursor-pointer shrink-0" />
          <div class="min-w-0">
            <div class="text-xs font-semibold text-[var(--foreground)] truncate">${m.name}</div>
            <div class="text-xs text-[var(--muted-foreground)] font-mono">${m.extruder} • ${m.zDesc}</div>
          </div>
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('[data-layer-vis]').forEach(chk => {
      chk.addEventListener('change', e => {
        const k = e.target.getAttribute('data-layer-vis');
        state.layerVisible[k] = e.target.checked;
        updateStatsUI();
        if (onRebuildNeeded) onRebuildNeeded();
      });
    });

    container.querySelectorAll('[data-layer-col]').forEach(inp => {
      inp.addEventListener('input', e => {
        const k = e.target.getAttribute('data-layer-col');
        state.colors[k] = toColorHex(e.target.value);
        if (k === 'greenery' && !state.colors.trees) {
          state.colors.trees = toColorHex(e.target.value);
        }
        state.activePalette = 'custom';
        renderPalettesUI();
        if (onRebuildNeeded) onRebuildNeeded();
      });
    });
  }

  function getActiveTargetBuildings() {
    const scene = state.sceneData;
    if (!scene || !scene.buildings) return [];
    const targetGroupIds = new Set(state.selectedBuildingIds);
    if (targetGroupIds.size === 0 && state.selectedBuildingId) {
      targetGroupIds.add(state.selectedBuildingId);
    }
    const result = [];
    const seen = new Set();
    targetGroupIds.forEach(gid => {
      const members = (state.groupIdMap && state.groupIdMap.get(gid)) ||
        scene.buildings.filter(x => x.id === gid || x.groupId === gid || x.osmId === gid || x._groupId === gid);
      members.forEach(m => {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          result.push(m);
        }
      });
    });
    return result;
  }

  function updateInspectorUI() {
    const scene = state.sceneData;
    if (!scene) return;
    const hlCount = (scene.buildings || []).filter(b => b.highlighted && !b.hidden).length;
    const selCount = state.selectedBuildingIds.size || (state.selectedBuildingId ? 1 : 0);
    document.getElementById('highlightedCountBadge').textContent =
      selCount > 1 ? `Zaznaczone: ${selCount} • Wyróżnione: ${hlCount}` : `Wyróżnione: ${hlCount}`;

    const activeBlds = getActiveTargetBuildings();
    const b = activeBlds[0] || (scene.buildings || []).find(x => x.id === state.selectedBuildingId);
    const emptyEl = document.getElementById('buildingInspectorEmpty');
    const contentEl = document.getElementById('buildingInspectorContent');

    if (!b) {
      emptyEl.classList.remove('hidden');
      contentEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    const groupCount = state.selectedBuildingIds.size;
    const bldName = b.name || (activeBlds.find(x => x.name && !x.name.startsWith('Budynek OSM')) || b).name;
    document.getElementById('inspName').textContent =
      groupCount > 1 ? `${bldName} (+${groupCount - 1} zaznaczonych)` : bldName;

    const badge = document.getElementById('inspTagBadge');
    if (b.highlighted) {
      badge.textContent = '★ WYRÓŻNIONY';
      badge.className = 'text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 font-mono font-bold';
    } else if (groupCount > 1) {
      badge.textContent = `MULTI-SELECT (${groupCount})`;
      badge.className = 'text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono font-bold';
    } else {
      badge.textContent = b.roof ? `DACH: ${b.roof.toUpperCase()}` : 'STANDARD';
      badge.className = 'text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-mono';
    }

    const gid = b.groupId || b.osmId || b.id || b._groupId;
    const maxLevels = Math.max(...activeBlds.map(x => x.levels || 1));
    const partCount = activeBlds.length;
    document.getElementById('inspOsmId').textContent =
      `OSM ID: ${gid} • Kondygnacje: ${maxLevels} • ${partCount > 1 ? partCount + ' części (S3DB)' : '1 bryła'}`;

    const effMeters = Math.round(Math.max(...activeBlds.map(x => (x.h || 0) * (x.heightMult || 1))));
    
    // Compute printed height in mm directly from the actual extruded 3D mesh bounds across all parts in group
    const groupBounds = (state.buildingBounds || []).filter(x => x.groupId === gid || x.building.id === b.id || x.building._groupId === gid);
    let minZ = Infinity, maxZ = -Infinity;
    groupBounds.forEach(gb => {
      if (gb.minZ < minZ) minZ = gb.minZ;
      if (gb.maxZ > maxZ) maxZ = gb.maxZ;
    });
    const maxDimMm = Math.max(state.bedSizeMm || 320, state.totalHeightMm || 320);
    const scaleMm = maxDimMm / 169.2;
    const printMm = (maxZ > minZ)
      ? Math.max(1.0, (maxZ - minZ) * scaleMm).toFixed(1)
      : (effMeters * (scene.metersToUnits || 0.13) * state.zScale * scaleMm).toFixed(1);

    document.getElementById('inspRealHeight').textContent = `${effMeters} m`;
    document.getElementById('inspPrintHeight').textContent = `${printMm} mm w druku`;

    const btnHl = document.getElementById('btnToggleHighlight');
    const suffix = groupCount > 1 ? ` (${groupCount})` : '';
    btnHl.textContent = b.highlighted ? `★ Usuń wyróżnienie${suffix}` : `★ Wyróżnij (Kolor Akcentu)${suffix}`;
    btnHl.className = b.highlighted
      ? 'py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center justify-center gap-1.5 transition'
      : 'py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition';

    document.getElementById('inspHeightMultiplier').value = Math.round((b.heightMult || 1) * 100);
    document.getElementById('inspHeightMultLabel').textContent = `${Math.round((b.heightMult || 1) * 100)}%`;
  }

  function handleSelectBuilding(b, isShiftKey) {
    if (!b) return;
    const gid = b.groupId || b.osmId || b.id || b._groupId;
    state.userClickedBuilding = true;
    if (isShiftKey) {
      if (state.selectedBuildingIds.size === 0 && state.selectedBuildingId && state.selectedBuildingId !== gid) {
        state.selectedBuildingIds.add(state.selectedBuildingId);
      }
      if (state.selectedBuildingIds.has(gid)) {
        state.selectedBuildingIds.delete(gid);
      } else {
        state.selectedBuildingIds.add(gid);
      }
      state.selectedBuildingId = gid;
    } else {
      state.selectedBuildingIds.clear();
      state.selectedBuildingIds.add(gid);
      state.selectedBuildingId = gid;
    }
    updateInspectorUI();
    updateLandmarkChips();
    draw2DMap();
  }
  function updateLandmarkChips() {
    const container = document.getElementById('landmarkChips');
    if (!container || !state.sceneData) return;
    container.innerHTML = '';

    const seenGids = new Set();
    const named = (state.sceneData.buildings || [])
      .filter(b => {
        if (!b.landmark || !b.name || b.name.startsWith('Budynek OSM')) return false;
        const gid = b.groupId || b.osmId || b.id || b._groupId;
        if (seenGids.has(gid)) return false;
        seenGids.add(gid);
        return true;
      })
      .slice(0, 8);

    named.forEach(b => {
      const gid = b.groupId || b.osmId || b.id || b._groupId;
      const chip = document.createElement('button');
      const isSel = state.userClickedBuilding && (state.selectedBuildingIds.has(gid) || state.selectedBuildingId === gid);
      chip.className = `text-xs px-2 py-1 rounded-md border transition flex items-center gap-1 ${
        isSel ? 'border-amber-500 bg-amber-500/15 text-amber-500 font-semibold' : 'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:opacity-80'
      }`;
      chip.textContent = `${b.highlighted ? '★ ' : ''}${b.name.slice(0, 22)}`;
      chip.addEventListener('click', (e) => {
        handleSelectBuilding(b, e.shiftKey);
      });
      container.appendChild(chip);
    });
  }

  function updateTileSelectorOptions() {
    const sel = document.getElementById('exportTileSelect');
    if (!sel) return;
    const prevVal = state.exportTileFilter || 'all';
    const pm = state.printMetrics || {};
    const cols = state.tileCols || 1;
    const rows = state.tileRows || 1;
    const numTiles = cols * rows;
    const tw = Math.round((state.bedSizeMm || 320) / cols);
    const th = Math.round((state.totalHeightMm || state.bedSizeMm || 320) / rows);

    sel.innerHTML = '';
    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = numTiles > 1
      ? `Wszystkie ${numTiles} kafle (${cols}×${rows} • Paczka .ZIP / .3MF)`
      : `Cały model 1×1 (${tw}×${th} mm)`;
    sel.appendChild(optAll);

    if (numTiles > 1) {
      let idx = 1;
      for (let tr = rows - 1; tr >= 0; tr--) {
        const northRow = rows - tr;
        for (let tc = 0; tc < cols; tc++) {
          const tid = tr * cols + tc;
          const vMl = (pm.tileVolumesMl && pm.tileVolumesMl[tid] !== undefined)
            ? pm.tileVolumesMl[tid].toFixed(1)
            : ((pm.totalVolumeMl || 30) / numTiles).toFixed(1);
          const opt = document.createElement('option');
          opt.value = String(tid);
          opt.textContent = `Kafel ${idx++}/${numTiles} (R${northRow}•C${tc + 1} — ${tw}×${th} mm • ~${vMl} ml)`;
          sel.appendChild(opt);
        }
      }
    }

    if (prevVal !== 'all' && parseInt(prevVal, 10) < numTiles) {
      sel.value = prevVal;
    } else {
      state.exportTileFilter = 'all';
      sel.value = 'all';
    }
  }

  function updateStatsUI() {
    const sc = state.sceneData;
    const bCount = sc && sc.buildings ? sc.buildings.length : 0;
    const tCount = sc && sc.trees ? sc.trees.length : 0;
    const pm = state.printMetrics || {};
    const profile = PRINT_PROFILES[state.printerProfileId] || PRINT_PROFILES.fdm_330_1x1;
    const cols = state.tileCols || 1;
    const rows = state.tileRows || 1;
    const numTiles = cols * rows;
    const dimW = state.bedSizeMm || (state.targetWidthCm ? state.targetWidthCm * 10 : 320);
    const dimH = state.totalHeightMm || (state.targetHeightCm ? state.targetHeightCm * 10 : dimW);
    const tileW = Math.round(dimW / cols);
    const tileH = Math.round(dimH / rows);
    const maxZ = Math.round(pm.maxZMm || 22);

    document.getElementById('meshStatsBadge').textContent =
      `${state.totalTriangles.toLocaleString('pl-PL')} trójkątów • ${bCount} budynków • ${tCount} drzew 3D`;

    // Keep Target Dimensions (cm) inputs in sync without overriding user input focus
    const wCmInp = document.getElementById('targetWidthCmInput');
    const hCmInp = document.getElementById('targetHeightCmInput');
    if (wCmInp && document.activeElement !== wCmInp) {
      wCmInp.value = Math.round(dimW / 10);
    }
    if (hCmInp && document.activeElement !== hCmInp) {
      hCmInp.value = Math.round(dimH / 10);
    }

    // Update Anycubic Photon Mono 4 optimal grid solver badge
    const optGrid = computeOptimalMono4Grid(dimW, dimH);
    const monoBadge = document.getElementById('mono4GridBadge');
    if (monoBadge) {
      monoBadge.textContent = `Mono 4: ${optGrid.cols}×${optGrid.rows} (${optGrid.totalTiles} k. • ${optGrid.tileW}×${optGrid.tileH}mm${optGrid.rotated90 ? ' ↻' : ''})`;
      monoBadge.title = `Optymalny podział dla wymiaru ${Math.round(dimW/10)}×${Math.round(dimH/10)} cm na stół Anycubic Photon Mono 4: ${optGrid.cols} kolumn × ${optGrid.rows} wierszy (${optGrid.totalTiles} kafli po ${optGrid.tileW}×${optGrid.tileH} mm${optGrid.rotated90 ? ' - obrót 90°' : ''})`;
    }

    const tileGridSel = document.getElementById('tileGridSelect');
    if (tileGridSel) {
      const curKey = `${cols}x${rows}`;
      let hasOpt = false;
      for (let i = 0; i < tileGridSel.options.length; i++) {
        if (tileGridSel.options[i].value === curKey) { hasOpt = true; break; }
      }
      if (!hasOpt) {
        const customOpt = document.createElement('option');
        customOpt.value = curKey;
        customOpt.textContent = curKey;
        tileGridSel.appendChild(customOpt);
      }
      tileGridSel.value = curKey;
    }

    // Validate tile dimensions against Anycubic Photon Mono 4 build plate
    const fitsMono4 = checkTileFitsMono4(tileW, tileH, maxZ);
    const fitWarn = document.getElementById('mono4FitWarning');
    const autoFitBtn = document.getElementById('btnAutoFitMono4');
    if (fitWarn) {
      fitWarn.classList.toggle('hidden', fitsMono4 || !profile.isResin);
    }
    if (autoFitBtn) {
      autoFitBtn.classList.toggle('hidden', fitsMono4 || !profile.isResin);
    }

    // Sync Kerf and Frame Export toggles
    const kerfInp = document.getElementById('kerfMmInput');
    if (kerfInp && document.activeElement !== kerfInp) {
      kerfInp.value = (state.kerfMm !== undefined) ? state.kerfMm : 0.08;
    }
    const frameChk = document.getElementById('chkExportFrame');
    if (frameChk && document.activeElement !== frameChk) {
      frameChk.checked = !!state.exportFrame;
    }

    const baseCrop = (sc && sc._fetchedCropRatio) || 0.88;
    const effCrop = Math.min(1.0, Math.max(0.15, (state.cropRatio || 0.88) / baseCrop));
    const realSpanM = ((sc && sc.spanMeters) || 1291.3) * effCrop;
    const scaleDenom = Math.round((realSpanM * 1000) / Math.max(1, dimW));
    const cropLbl = document.getElementById('cropSizeLabel');
    if (cropLbl) {
      cropLbl.textContent = `${(realSpanM / 1000).toFixed(2)} km (1:${scaleDenom})`;
    }

    if (numTiles > 1) {
      document.getElementById('statDimensions').textContent = `${dimW}×${dimH} (${numTiles}× ${tileW}×${tileH} mm)`;
      document.getElementById('bboxScaleBadge').textContent = `${(dimW / 10).toFixed(1)}×${(dimH / 10).toFixed(1)} cm (${cols}×${rows})`;
    } else {
      document.getElementById('statDimensions').textContent = `${dimW}×${dimH}×${maxZ} mm`;
      document.getElementById('bboxScaleBadge').textContent = `${(dimW / 10).toFixed(1)}×${(dimH / 10).toFixed(1)} cm (1:${scaleDenom})`;
    }

    const totalMl = pm.totalVolumeMl !== undefined ? pm.totalVolumeMl : 42.0;
    const resinG = pm.resinGrams !== undefined ? pm.resinGrams : Math.round(totalMl * 1.12);
    const plaG = pm.plaGrams !== undefined ? pm.plaGrams : Math.round(totalMl * 0.42);
    const perTileMl = totalMl / numTiles;

    const matTitle = document.getElementById('statMaterialTitle');
    if (profile.isResin) {
      if (matTitle) matTitle.textContent = numTiles > 1 ? `Żywica SLA (1 kafel / suma)` : `Żywica SLA (Photon Mono 4)`;
      document.getElementById('statFilament').textContent = numTiles > 1
        ? `~${perTileMl.toFixed(1)} ml / ∑${Math.round(totalMl)} ml (${resinG}g)`
        : `~${totalMl.toFixed(1)} ml (${resinG} g)`;
    } else {
      if (matTitle) {
        matTitle.textContent = profile.hasAmsTower ? `Masa PLA (+ ~18g wieża AMS)` : `Masa PLA (Toolchanger • 0g wieży)`;
      }
      document.getElementById('statFilament').textContent = `~${plaG} g PLA (~${Math.round(totalMl)} ml)`;
    }

    const activeVols = Object.keys(state.layerVisible).filter(k => state.layerVisible[k]).length;
    document.getElementById('statVolumes').textContent = `${cols}×${rows} (${activeVols} warstw)`;

    const hollowBadge = document.getElementById('hollowSavingsBadge');
    if (hollowBadge) {
      hollowBadge.textContent = state.hollowBase
        ? `-${pm.hollowSavingsPct || 0}% żywicy`
        : `Pełna FDM (0%)`;
      hollowBadge.className = state.hollowBase
        ? 'text-xs font-mono font-bold text-emerald-400 shrink-0'
        : 'text-xs font-mono font-bold text-amber-400 shrink-0';
    }

    const preflightBadge = document.getElementById('preflightStatusBadge');
    if (preflightBadge) {
      const isManifold = !!pm.isWatertightManifold;
      const openE = pm.openEdgesCount || 0;
      const nonManE = pm.nonManifoldEdgesCount || 0;
      const negW = pm.negativeWindingCount || 0;
      const floatB = pm.floatingBuildingsCount || 0;
      if (isManifold) {
        preflightBadge.className = 'text-xs font-mono text-emerald-400';
        preflightBadge.textContent = profile.isResin
          ? `Manifold ✓ (0/0) • 0 lewit. • Mono 4 (${tileW}×${tileH}mm) ✓`
          : `Manifold ✓ (0/0 kraw.) • 0 lewitujących • Bez ramki`;
      } else {
        preflightBadge.className = 'text-xs font-mono text-amber-400';
        preflightBadge.textContent = `⚠ Siatka: otw.${openE} nieman.${nonManE} ujem.${negW} lewit.${floatB}`;
      }
    }
  }


  return {
    renderPalettesUI,
    renderLayersUI,
    getActiveTargetBuildings,
    updateInspectorUI,
    handleSelectBuilding,
    updateLandmarkChips,
    updateTileSelectorOptions,
    updateStatsUI
  };
}
