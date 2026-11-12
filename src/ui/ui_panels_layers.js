// ============================================================================
// src/ui/ui_panels_layers.js
// Color Palettes, Printable Layer Toggles, Mono 4 Tile Selector & Print Stats
// ============================================================================

function toColorHex(col, defaultHex = '#ffffff') {
  if (!col) return defaultHex;
  if (typeof col === 'string') {
    const s = col.trim();
    if (s.startsWith('#')) {
      if (s.length === 7) return s.toLowerCase();
      if (s.length === 4) return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(s)) return ('#' + s).toLowerCase();
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
      r = Math.round(r * 255); g = Math.round(g * 255); b = Math.round(b * 255);
    } else {
      r = Math.round(r); g = Math.round(g); b = Math.round(b);
    }
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  return defaultHex;
}

const PALETTE_SWATCH_KEYS = ['water', 'base', 'greenery', 'roads', 'buildings'];

function createUILayersStatsController(state, onRebuildNeeded) {
  let colorRafId = 0;

  function getStudioInstance() {
    return (state && state.studio) ||
      (typeof window !== 'undefined' && window.__map3d && window.__map3d.studio) ||
      null;
  }

  function triggerStudioRecolorImmediate() {
    if (colorRafId) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(colorRafId);
      colorRafId = 0;
    }
    const studio = getStudioInstance();
    if (studio && typeof studio.render === 'function') {
      studio.render(true);
    }
  }

  function scheduleFastColorRepaint() {
    if (colorRafId) return;
    if (typeof requestAnimationFrame === 'function') {
      colorRafId = requestAnimationFrame(() => {
        colorRafId = 0;
        const studio = getStudioInstance();
        if (studio && typeof studio.render === 'function') {
          studio.render(true);
        }
      });
    } else {
      triggerStudioRecolorImmediate();
    }
  }

  function syncPaletteActiveButtonsInPlace() {
    const container = document.getElementById('paletteButtonsContainer');
    if (!container) return;
    container.querySelectorAll('button[data-palette-id]').forEach(btn => {
      const active = state.activePalette === btn.getAttribute('data-palette-id');
      btn.className = `p-2 rounded-lg border text-left transition flex flex-col gap-1 ${
        active ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--border)] bg-[var(--background)] hover:opacity-85'
      }`;
    });
  }

  function renderPalettesUI() {
    const container = document.getElementById('paletteButtonsContainer');
    if (!container) return;
    if (state && state.colors && 'highlighted' in state.colors) {
      delete state.colors.highlighted;
    }
    container.innerHTML = '';
    PALETTES.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-palette-id', p.id);
      const active = state.activePalette === p.id;
      btn.className = `p-2 rounded-lg border text-left transition flex flex-col gap-1 ${
        active ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--border)] bg-[var(--background)] hover:opacity-85'
      }`;
      const swatches = PALETTE_SWATCH_KEYS
        .filter(k => p.colors && p.colors[k])
        .map(k => `<span class="w-3.5 h-3.5 rounded-sm border border-black/25 inline-block" style="background:${toColorHex(p.colors[k])}"></span>`)
        .join('');
      btn.innerHTML = `
        <div class="text-xs font-semibold text-[var(--foreground)] truncate">${p.name}</div>
        <div class="flex items-center gap-1">${swatches}</div>
      `;
      btn.addEventListener('click', () => {
        state.activePalette = p.id;
        state._treesColorCustomized = false;
        state.colors = {};
        PALETTE_SWATCH_KEYS.forEach(k => {
          if (p.colors && p.colors[k]) state.colors[k] = toColorHex(p.colors[k]);
        });
        syncPaletteActiveButtonsInPlace();
        renderLayersUI();
        triggerStudioRecolorImmediate();
        if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
      });
      container.appendChild(btn);
    });
  }

  function renderLayersUI() {
    const container = document.getElementById('layersListContainer');
    if (!container) return;
    if (state && state.colors && 'highlighted' in state.colors) {
      delete state.colors.highlighted;
    }
    container.innerHTML = '';
    LAYERS_META.forEach(m => {
      const row = document.createElement('div');
      row.className = 'bg-[var(--background)] border border-[var(--border)] rounded-lg p-1.5 flex items-center justify-between gap-2';
      const isVis = state.layerVisible[m.key] !== false;
      const colVal = toColorHex(state.colors[m.key] || state.colors.greenery || '#488e52', '#488e52');
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

    const applyColorInputChange = (e, isCommit) => {
      const k = e.target.getAttribute('data-layer-col');
      if (!k) return;
      const hex = toColorHex(e.target.value);
      if (!state.colors) state.colors = {};
      delete state.colors.highlighted;
      state.colors[k] = hex;

      if (k === 'trees') {
        state._treesColorCustomized = true;
      } else if (k === 'greenery' && !state._treesColorCustomized) {
        delete state.colors.trees;
        const treeInp = container.querySelector('[data-layer-col="trees"]');
        if (treeInp && treeInp !== e.target) treeInp.value = hex;
      }

      if (state.activePalette !== 'custom') {
        state.activePalette = 'custom';
        syncPaletteActiveButtonsInPlace();
      }

      if (isCommit) {
        triggerStudioRecolorImmediate();
        if (typeof saveActiveConfig === 'function') saveActiveConfig(state);
      } else {
        scheduleFastColorRepaint();
        if (typeof scheduleSaveActiveConfig === 'function') scheduleSaveActiveConfig(state, 250);
      }
    };

    container.querySelectorAll('[data-layer-col]').forEach(inp => {
      inp.addEventListener('input', e => applyColorInputChange(e, false));
      inp.addEventListener('change', e => applyColorInputChange(e, true));
    });
  }

  function updateTileSelectorOptions() {
    const sel = document.getElementById('exportTileSelect');
    if (!sel) return;
    const prevVal = state.exportTileFilter || 'all';
    const pm = state.printMetrics || {};
    const cols = state.tileCols || 1, rows = state.tileRows || 1;
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
    const bCount = state.pickIdMap ? state.pickIdMap.size : (sc && sc.buildings ? sc.buildings.length : 0);
    const tCount = sc && sc.trees ? sc.trees.length : 0;
    const pm = state.printMetrics || {};
    const profile = PRINT_PROFILES[state.printerProfileId] || PRINT_PROFILES.fdm_330_1x1;
    const cols = state.tileCols || 1, rows = state.tileRows || 1;
    const numTiles = cols * rows;
    const dimW = state.bedSizeMm || (state.targetWidthCm ? state.targetWidthCm * 10 : 320);
    const dimH = state.totalHeightMm || (state.targetHeightCm ? state.targetHeightCm * 10 : dimW);
    const tileW = Math.round(dimW / cols);
    const tileH = Math.round(dimH / rows);
    const maxZ = Math.round(pm.maxZMm || 22);

    document.getElementById('meshStatsBadge').textContent =
      `${state.totalTriangles.toLocaleString('pl-PL')} trójkątów • ${bCount} budynków • ${tCount} drzew 3D`;

    const wCmInp = document.getElementById('targetWidthCmInput');
    const hCmInp = document.getElementById('targetHeightCmInput');
    if (wCmInp && document.activeElement !== wCmInp) wCmInp.value = Math.round(dimW / 10);
    if (hCmInp && document.activeElement !== hCmInp) hCmInp.value = Math.round(dimH / 10);

    const optGrid = computeOptimalMono4Grid(dimW, dimH);
    const monoBadge = document.getElementById('mono4GridBadge');
    if (monoBadge) {
      monoBadge.textContent = `Mono 4: ${optGrid.cols}×${optGrid.rows} (${optGrid.totalTiles} k. • ${optGrid.tileW}×${optGrid.tileH}mm${optGrid.rotated90 ? ' ↻' : ''})`;
      monoBadge.title = `Optymalny podział dla wymiaru ${Math.round(dimW / 10)}×${Math.round(dimH / 10)} cm na stół Anycubic Photon Mono 4`;
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

    const fitsMono4 = checkTileFitsMono4(tileW, tileH, maxZ);
    const fitWarn = document.getElementById('mono4FitWarning');
    const autoFitBtn = document.getElementById('btnAutoFitMono4');
    if (fitWarn) fitWarn.classList.toggle('hidden', fitsMono4 || !profile.isResin);
    if (autoFitBtn) autoFitBtn.classList.toggle('hidden', fitsMono4 || !profile.isResin);

    const kerfInp = document.getElementById('kerfMmInput');
    if (kerfInp && document.activeElement !== kerfInp) kerfInp.value = (state.kerfMm !== undefined) ? state.kerfMm : 0.08;
    const frameChk = document.getElementById('chkExportFrame');
    if (frameChk && document.activeElement !== frameChk) frameChk.checked = !!state.exportFrame;

    const realSpanM = Number(state.mapSpanMeters) || (sc && sc.spanMeters) || 1200;
    const spanKm = realSpanM / 1000;
    const scaleDenom = Math.round((realSpanM * 1000) / Math.max(1, dimW));
    const cropLbl = document.getElementById('cropSizeLabel');
    if (cropLbl) cropLbl.textContent = `${spanKm.toFixed(2)} km (1:${scaleDenom})`;
    const cropSl = document.getElementById('cropSizeSlider');
    if (cropSl && document.activeElement !== cropSl) cropSl.value = Math.min(50.0, Math.max(0.4, spanKm)).toFixed(1);

    document.querySelectorAll('[data-span-km]').forEach(btn => {
      const isActive = Math.abs(parseFloat(btn.getAttribute('data-span-km')) - spanKm) < 0.08;
      btn.className = isActive
        ? 'px-1.5 py-0.5 rounded bg-blue-600 text-white border border-blue-500 text-[11px] font-mono transition'
        : 'px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] hover:border-blue-500 text-[11px] font-mono transition';
    });

    const rotDeg = Number(state.mapRotationDeg) || 0;
    const rotLbl = document.getElementById('mapRotationLabel');
    if (rotLbl) rotLbl.textContent = typeof formatRotationBadgeText === 'function' ? formatRotationBadgeText(rotDeg) : `${rotDeg}°`;
    const rotSl = document.getElementById('mapRotationSlider');
    if (rotSl && document.activeElement !== rotSl) rotSl.value = String(Math.round(rotDeg));

    document.querySelectorAll('[data-rot-deg]').forEach(btn => {
      const bDeg = parseFloat(btn.getAttribute('data-rot-deg'));
      const isActive = Math.abs(bDeg - rotDeg) < 1.0 || (Math.abs(bDeg) === 180 && Math.abs(rotDeg) === 180);
      btn.className = isActive
        ? 'px-1.5 py-0.5 rounded bg-blue-600 text-white border border-blue-500 text-[11px] font-mono transition'
        : 'px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] hover:border-blue-500 text-[11px] font-mono transition';
    });

    const curFrameKey = `${Math.round(dimW / 10)}x${Math.round(dimH / 10)}`;
    document.querySelectorAll('[data-frame-size]').forEach(btn => {
      const isActive = btn.getAttribute('data-frame-size') === curFrameKey;
      btn.className = isActive
        ? 'px-1.5 py-0.5 rounded bg-blue-600 text-white border border-blue-500 text-[11px] font-mono transition'
        : 'px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] hover:border-blue-500 text-[11px] font-mono transition';
    });

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
      if (matTitle) matTitle.textContent = profile.hasAmsTower ? `Masa PLA (+ ~18g wieża AMS)` : `Masa PLA (Toolchanger • 0g wieży)`;
      document.getElementById('statFilament').textContent = `~${plaG} g PLA (~${Math.round(totalMl)} ml)`;
    }

    const activeVols = Object.keys(state.layerVisible).filter(k => state.layerVisible[k]).length;
    document.getElementById('statVolumes').textContent = `${cols}×${rows} (${activeVols} warstw)`;

    const hollowBadge = document.getElementById('hollowSavingsBadge');
    if (hollowBadge) {
      hollowBadge.textContent = state.hollowBase ? `-${pm.hollowSavingsPct || 0}% żywicy` : `Pełna FDM (0%)`;
      hollowBadge.className = state.hollowBase
        ? 'text-xs font-mono font-bold text-emerald-400 shrink-0'
        : 'text-xs font-mono font-bold text-amber-400 shrink-0';
    }

    const preflightBadge = document.getElementById('preflightStatusBadge');
    if (preflightBadge) {
      const isManifold = !!pm.isWatertightManifold;
      if (isManifold) {
        preflightBadge.className = 'text-xs font-mono text-emerald-400';
        preflightBadge.textContent = profile.isResin
          ? `Manifold ✓ (0/0) • 0 lewit. • Mono 4 (${tileW}×${tileH}mm) ✓`
          : `Manifold ✓ (0/0 kraw.) • 0 lewitujących • Bez ramki`;
      } else {
        preflightBadge.className = 'text-xs font-mono text-amber-400';
        preflightBadge.textContent = `⚠ Siatka: otw.${pm.openEdgesCount || 0} nieman.${pm.nonManifoldEdgesCount || 0} lewit.${pm.floatingBuildingsCount || 0}`;
      }
    }
  }

  return { renderPalettesUI, renderLayersUI, updateTileSelectorOptions, updateStatsUI };
}
