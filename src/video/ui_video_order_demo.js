// ============================================================================
// src/video/ui_video_order_demo.js
// Framed Product Builder, Multi-Element Set Composer (Solo / Duet / Triptych),
// Live EUR/PLN Pricing & Order Demo Checkout Modal + JSON Specification Export.
// ============================================================================

function formatVideoCoordsText(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}  •  ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

function formatVideoScaleText(scene, widthCm) {
  const spanM = (scene && scene.spanMeters) || 1250;
  const denom = Math.max(500, Math.round((spanM * 1000) / Math.max(80, widthCm * 10)));
  return `1:${denom}`;
}

function computeVideoItemPriceEur(cfg) {
  const maxCm = Math.max(cfg.widthCm || 30, cfg.heightCm || 30);
  let base = maxCm <= 22 ? 69 : maxCm <= 32 ? 99 : maxCm <= 45 ? 149 : maxCm <= 55 ? 199 : 279;
  if (cfg.paletteId !== 'white') base += 24;
  if (cfg.matStyle !== 'none') base += 14;
  if (cfg.showGlass) base += 19;
  if (cfg.frameStyle === 'oak' || cfg.frameStyle === 'walnut' || cfg.frameStyle === 'gold') base += 15;
  return base;
}

function createVideoOrderDemoController(vState, engine, previewCanvas, hooks) {
  function buildSlotDescriptorFromCurrent(overrides = {}) {
    const scene = overrides.sceneData || vState.sceneData;
    const widthCm = overrides.widthCm || vState.targetWidthCm || 30;
    const heightCm = overrides.heightCm || vState.targetHeightCm || 30;
    const elemVis = overrides.elementVisible ? { ...overrides.elementVisible } : { ...vState.elementVisible };

    const buildState = {
      cropRatio: vState.cropRatio || 0.88,
      cropCenterX: 0,
      cropCenterY: 0,
      zScale: overrides.zScale !== undefined ? overrides.zScale : vState.zScale,
      terrainScale: overrides.terrainScale !== undefined ? overrides.terrainScale : vState.terrainScale,
      bedSizeMm: widthCm * 10,
      totalHeightMm: heightCm * 10,
      tileCols: vState.tileCols || 1,
      tileRows: vState.tileRows || 1,
      hollowBase: false,
      isResin: false,
      layerHeightMm: 0.20,
      layerVisible: { water: true, base: true, greenery: true, roads: true, buildings: true, highlighted: true }
    };

    const res = buildComplete3DModel(scene, buildState);
    vState.lastModelMetrics = res.printMetrics || null;

    const lat = (scene && scene.center && scene.center[0]) || vState.mapCenterLat;
    const lon = (scene && scene.center && scene.center[1]) || vState.mapCenterLon;

    return {
      id: Date.now() + Math.random(),
      sceneData: scene,
      meshes: res.meshes,
      printMetrics: res.printMetrics,
      totalTriangles: res.totalTriangles,
      widthCm,
      heightCm,
      paletteId: overrides.paletteId || vState.paletteId,
      colors: overrides.colors ? { ...overrides.colors } : { ...vState.colors },
      frameStyle: overrides.frameStyle || vState.frameStyle,
      matStyle: overrides.matStyle !== undefined ? overrides.matStyle : vState.matStyle,
      backingStyle: overrides.backingStyle || vState.backingStyle,
      showPlaque: overrides.showPlaque !== undefined ? overrides.showPlaque : vState.showPlaque,
      showGlass: overrides.showGlass !== undefined ? overrides.showGlass : vState.showGlass,
      title: overrides.title || vState.title || 'MÜNCHEN',
      subtitle: overrides.subtitle !== undefined ? overrides.subtitle : vState.subtitle,
      coordsText: formatVideoCoordsText(lat, lon),
      scaleText: formatVideoScaleText(scene, widthCm),
      elementVisible: elemVis,
      ghostHiddenLayers: overrides.ghostHiddenLayers !== undefined ? overrides.ghostHiddenLayers : vState.ghostHiddenLayers,
      tileCols: vState.tileCols || 1,
      tileRows: vState.tileRows || 1
    };
  }

  function updateOrderSummaryUI(activeSlots) {
    const slots = activeSlots || (vState.pinnedSlots.length ? vState.pinnedSlots : []);
    const count = slots.length || 1;
    const totalEur = slots.reduce((sum, s) => sum + computeVideoItemPriceEur(s), 0) || computeVideoItemPriceEur({
      widthCm: vState.targetWidthCm,
      heightCm: vState.targetHeightCm,
      paletteId: vState.paletteId,
      matStyle: vState.matStyle,
      showGlass: vState.showGlass,
      frameStyle: vState.frameStyle
    });
    const totalPln = Math.round(totalEur * 4.30);
    const totalMl = slots.reduce((sum, s) => sum + ((s.printMetrics && s.printMetrics.totalVolumeMl) || 42), 0);

    const badgeSet = document.getElementById('vidSetCountBadge');
    if (badgeSet) {
      badgeSet.textContent = count === 1 ? 'Solo (1 Ramka)' : (count === 2 ? 'Duet (2 Ramki)' : `Tryptyk (${count} Ramki)`);
    }

    const priceEl = document.getElementById('vidOrderPriceLabel');
    if (priceEl) priceEl.textContent = `${totalEur} € (~${totalPln} zł)`;

    const specEl = document.getElementById('vidOrderSpecSummary');
    if (specEl && slots[0]) {
      const s0 = slots[0];
      const activeLayerCount = Object.values(s0.elementVisible || {}).filter(Boolean).length;
      const frameLbl = (VIDEO_FRAME_FINISHES[s0.frameStyle] || VIDEO_FRAME_FINISHES.black).label;
      specEl.textContent = `${count}× Format ${s0.widthCm}×${s0.heightCm} cm • ${frameLbl} • ${activeLayerCount}/6 warstw • ~${Math.round(totalMl)} ml materiału`;
    }

    const listEl = document.getElementById('vidPinnedSlotsList');
    if (listEl) {
      listEl.innerHTML = '';
      slots.forEach((s, idx) => {
        const pill = document.createElement('div');
        pill.className = 'flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[11px]';
        const layersOn = Object.entries(s.elementVisible).filter(([, v]) => v).map(([k]) => k.slice(0, 3)).join('+');
        pill.innerHTML = `
          <span class="font-semibold truncate">#${idx + 1} ${escapeHtml(s.title)} (${s.widthCm}×${s.heightCm}cm • ${escapeHtml(layersOn)})</span>
          ${vState.pinnedSlots.length > 0 ? `<button type="button" data-remove-slot="${idx}" class="text-red-400 hover:text-red-300 font-bold px-1">✕</button>` : '<span class="text-emerald-400 font-mono">LIVE</span>'}
        `;
        listEl.appendChild(pill);
      });
      listEl.querySelectorAll('[data-remove-slot]').forEach(btn => {
        btn.addEventListener('click', () => {
          vState.pinnedSlots.splice(parseInt(btn.getAttribute('data-remove-slot'), 10), 1);
          hooks.rebuildSlots();
        });
      });
    }
  }

  function populateOrderDemoModal() {
    const slots = vState.pinnedSlots.length ? vState.pinnedSlots : [buildSlotDescriptorFromCurrent()];
    const cfg = hooks.getAnimConfig();
    engine.renderFrameAt(0.92, cfg, 960, 540);
    const thumbImg = document.getElementById('orderModalPackshotImg');
    if (thumbImg) {
      try {
        thumbImg.src = (typeof safeCanvasToDataURL === 'function')
          ? safeCanvasToDataURL(previewCanvas, 'image/png')
          : previewCanvas.toDataURL('image/png');
      } catch (err) {
        console.warn('[Canvas Security] orderModalPackshotImg fallback:', err);
        thumbImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      }
    }
    hooks.renderPreview();

    const itemsBox = document.getElementById('orderModalItemsList');
    const totalBox = document.getElementById('orderModalTotalPrice');
    let sumEur = 0;
    if (itemsBox) {
      itemsBox.innerHTML = '';
      slots.forEach((s, i) => {
        const eur = computeVideoItemPriceEur(s);
        sumEur += eur;
        const fLbl = (VIDEO_FRAME_FINISHES[s.frameStyle] || VIDEO_FRAME_FINISHES.black).label;
        const mLbl = (VIDEO_MAT_STYLES[s.matStyle] || VIDEO_MAT_STYLES.none).label;
        const elems = Object.entries(s.elementVisible).filter(([, v]) => v).map(([k]) => k).join(', ');
        const row = document.createElement('div');
        row.className = 'p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] flex items-start justify-between gap-3';
        row.innerHTML = `
          <div class="text-xs space-y-0.5">
            <div class="font-bold text-[var(--foreground)]">#${i + 1} • Ramka 3D „${escapeHtml(s.title)}” — ${s.widthCm}×${s.heightCm} cm</div>
            <div class="text-[var(--muted-foreground)]">${escapeHtml(fLbl)} • ${escapeHtml(mLbl)}${s.showGlass ? ' • Szyba Akrylowa' : ''}</div>
            <div class="font-mono text-[11px] text-blue-400">${escapeHtml(s.coordsText)} (${escapeHtml(s.scaleText)}) • Elementy: ${escapeHtml(elems)}</div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-bold text-sm text-emerald-400">${eur} €</div>
            <div class="text-[11px] font-mono text-[var(--muted-foreground)]">~${Math.round(eur * 4.3)} zł</div>
          </div>
        `;
        itemsBox.appendChild(row);
      });
    }
    if (totalBox) totalBox.textContent = `${sumEur} € (~${Math.round(sumEur * 4.30)} zł brutto)`;
  }

  function bindSetAndOrderControls(getOrFetchCachedPresetScene) {
    const btnAddSlot = document.getElementById('btnVidAddSlot');
    if (btnAddSlot) {
      btnAddSlot.addEventListener('click', () => {
        if (vState.pinnedSlots.length === 0) vState.pinnedSlots.push(buildSlotDescriptorFromCurrent());
        if (vState.pinnedSlots.length < 3) vState.pinnedSlots.push(buildSlotDescriptorFromCurrent());
        hooks.rebuildSlots();
      });
    }

    const btnResetSolo = document.getElementById('btnVidResetSolo');
    if (btnResetSolo) {
      btnResetSolo.addEventListener('click', () => {
        vState.pinnedSlots = [];
        hooks.rebuildSlots();
      });
    }

    const btnLayerTriptych = document.getElementById('btnVidLayerTriptych');
    if (btnLayerTriptych) {
      btnLayerTriptych.addEventListener('click', () => {
        const baseTitle = vState.title || 'CITY';
        vState.pinnedSlots = [
          buildSlotDescriptorFromCurrent({
            title: `${baseTitle} • I`,
            subtitle: 'HYDROLOGIA & WARSTWICE DEM',
            elementVisible: { water: true, base: true, greenery: false, roads: false, buildings: false, highlighted: false },
            colors: { ...PALETTES[1].colors }
          }),
          buildSlotDescriptorFromCurrent({
            title: `${baseTitle} • II`,
            subtitle: 'UKŁAD URBANISTYCZNY ULIC',
            elementVisible: { water: true, base: false, greenery: true, roads: true, buildings: false, highlighted: false },
            backingStyle: 'obsidian',
            colors: { ...PALETTES[0].colors, water: '#161b24', roads: '#f8fafc' }
          }),
          buildSlotDescriptorFromCurrent({
            title: `${baseTitle} • III`,
            subtitle: 'ARCHITEKTURA 3D LoD2',
            elementVisible: { water: true, base: true, greenery: true, roads: true, buildings: true, highlighted: true }
          })
        ];
        hooks.rebuildSlots();
      });
    }

    const btnWorldTriptych = document.getElementById('btnVidWorldTriptych');
    if (btnWorldTriptych) {
      btnWorldTriptych.addEventListener('click', async () => {
        const loadingEl = document.getElementById('vidLoadingOverlay');
        const loadingTxt = document.getElementById('vidLoadingText');
        if (loadingEl) loadingEl.classList.remove('hidden');
        if (loadingTxt) loadingTxt.textContent = 'Składanie Tryptyku 3 Miast (Dubaj • Monachium • Kraków)...';
        try {
          const picks = [VIDEO_CACHED_PRESETS[0], VIDEO_CACHED_PRESETS[1], VIDEO_CACHED_PRESETS[2]];
          const built = [];
          for (const p of picks) {
            const sc = await getOrFetchCachedPresetScene(p);
            if (sc) built.push(buildSlotDescriptorFromCurrent({ sceneData: sc, title: p.title, subtitle: p.subtitle }));
          }
          if (built.length > 0) {
            vState.pinnedSlots = built;
            hooks.rebuildSlots();
          }
        } finally {
          if (loadingEl) loadingEl.classList.add('hidden');
        }
      });
    }

    const btnOpenOrder = document.getElementById('btnVidOpenOrderDemo');
    const orderModal = document.getElementById('vidOrderDemoModal');
    const btnCloseOrder = document.getElementById('btnCloseOrderModal');
    if (btnOpenOrder && orderModal) {
      btnOpenOrder.addEventListener('click', () => {
        populateOrderDemoModal();
        orderModal.classList.remove('hidden');
      });
    }
    if (btnCloseOrder && orderModal) {
      btnCloseOrder.addEventListener('click', () => orderModal.classList.add('hidden'));
    }

    const btnDownloadOrderJson = document.getElementById('btnDownloadOrderSpecJson');
    if (btnDownloadOrderJson) {
      btnDownloadOrderJson.addEventListener('click', () => {
        const slots = vState.pinnedSlots.length ? vState.pinnedSlots : [buildSlotDescriptorFromCurrent()];
        const payload = {
          createdAt: new Date().toISOString(),
          orderType: slots.length > 1 ? `MULTI_SET_${slots.length}` : 'SINGLE_FRAME',
          animationPreset: vState.storyboard,
          items: slots.map((s, idx) => ({
            index: idx + 1,
            title: s.title,
            subtitle: s.subtitle,
            coordinates: s.coordsText,
            scale: s.scaleText,
            dimensionsCm: `${s.widthCm}x${s.heightCm}`,
            frameFinish: s.frameStyle,
            passePartout: s.matStyle,
            backing: s.backingStyle,
            acrylicGlass: s.showGlass,
            activeElements: s.elementVisible,
            estimatedVolumeMl: s.printMetrics ? s.printMetrics.totalVolumeMl : null,
            priceEur: computeVideoItemPriceEur(s)
          }))
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `zamowienie_demo_${(vState.title || 'map3d').toLowerCase()}.json`;
        a.click();
      });
    }
  }

  return {
    buildSlotDescriptorFromCurrent,
    updateOrderSummaryUI,
    populateOrderDemoModal,
    bindSetAndOrderControls
  };
}
