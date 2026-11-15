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

function _normLodForSig(lod) {
  if (!lod) return '1|4|0|all';
  return `${lod.enableTrees !== false ? 1 : 0}|${Number(lod.treeMaxSpanKm ?? 4)}|${Number(lod.minBuildingFootprintM || 0)}|${lod.roadDetail || 'all'}`;
}

function computeVideoGeometrySignature(scene, st) {
  if (!st) return '';
  const wMm = Number(st.bedSizeMm) || (Number(st.targetWidthCm || 30) * 10);
  const hMm = Number(st.totalHeightMm) || (Number(st.targetHeightCm || 30) * 10);
  const tCols = Number(st.tileCols) || 1;
  const tRows = Number(st.tileRows) || 1;
  const zSc = Math.round((Number(st.zScale) || 1.25) * 1000) / 1000;
  const terSc = Math.round((Number(st.terrainScale) || 1.15) * 1000) / 1000;
  const cropR = Math.round((Number(st.cropRatio) || 0.88) * 1000) / 1000;
  const cropX = Math.round((Number(st.cropCenterX) || 0) * 1000) / 1000;
  const cropY = Math.round((Number(st.cropCenterY) || 0) * 1000) / 1000;
  const resin = st.isResin !== false ? 1 : 0;
  const xyPx = Number(st.xyPixelMm) || 0.05;
  const layH = Number(st.layerHeightMm) || 0.05;
  const bZ = Number(st.bedZ) || 200;
  const hollow = st.hollowBase ? 1 : 0;
  const waterCut = st.waterCutout ? 1 : 0;
  const rot = Math.round((Number(st.mapRotationDeg) || 0) * 10) / 10;
  const scSpan = (scene && scene.spanMeters) ? Math.round(scene.spanMeters) : 0;
  const scRot = (scene && typeof scene._appliedRotationDeg === 'number') ? scene._appliedRotationDeg : rot;
  return `${wMm}x${hMm}|${tCols}x${tRows}|z${zSc}|t${terSc}|c${cropR},${cropX},${cropY}|r${resin}|px${xyPx}|lh${layH}|bz${bZ}|hb${hollow}|wc${waterCut}|rot${rot}|sr${scRot}|sp${scSpan}|${_normLodForSig(st.lodSettings)}`;
}

function partitionSlotMeshes(rawMeshes, pickIdMap, highlightedIdsSet, buildings) {
  const src = rawMeshes || {};
  const rawGreenery = src.greenery || [];
  const treeShellIds = new Set();
  for (let i = 0; i < rawGreenery.length; i++) {
    const t = rawGreenery[i];
    if (t && t.shellId !== undefined && t.shellId !== -1 && t.n && t.n[2] > 0.04 && t.n[2] < 0.98) {
      treeShellIds.add(t.shellId);
    }
  }
  const greenery = [];
  const trees = [];
  for (let i = 0; i < rawGreenery.length; i++) {
    const t = rawGreenery[i];
    if (!t) continue;
    const isTree = (t.shellId !== undefined && t.shellId !== -1)
      ? treeShellIds.has(t.shellId)
      : Boolean(t.n && t.n[2] > 0.04 && t.n[2] < 0.98);
    if (isTree) trees.push(t);
    else greenery.push(t);
  }

  let pickToBid = null;
  if ((!pickIdMap || typeof pickIdMap.get !== 'function') && Array.isArray(buildings)) {
    pickToBid = new Map();
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (!b) continue;
      if (b._pickId !== undefined) pickToBid.set(b._pickId, b.id);
      else if (b.pickId !== undefined) pickToBid.set(b.pickId, b.id);
    }
  }

  const hlSet = (highlightedIdsSet instanceof Set)
    ? highlightedIdsSet
    : new Set(Array.isArray(highlightedIdsSet) ? highlightedIdsSet : []);
  const isPickHighlighted = new Map();
  const resolveTriHighlighted = (rawId) => {
    if (hlSet.size === 0 || rawId === undefined) return false;
    if (isPickHighlighted.has(rawId)) return isPickHighlighted.get(rawId);
    let isHl = hlSet.has(rawId);
    if (!isHl && pickIdMap && typeof pickIdMap.get === 'function') {
      const mapped = pickIdMap.get(rawId);
      if (mapped) {
        isHl = Boolean(
          (mapped.id !== undefined && hlSet.has(mapped.id)) ||
          (mapped.groupId !== undefined && hlSet.has(mapped.groupId)) ||
          (mapped.primaryBuilding && hlSet.has(mapped.primaryBuilding.id)) ||
          (Array.isArray(mapped.buildings) && mapped.buildings.some(
            m => m && (hlSet.has(m.id) || (m.osmId !== undefined && hlSet.has(m.osmId)))
          ))
        );
      }
    } else if (!isHl && pickToBid && pickToBid.has(rawId)) {
      isHl = hlSet.has(pickToBid.get(rawId));
    }
    isPickHighlighted.set(rawId, isHl);
    return isHl;
  };

  const outBld = [];
  const outHl = [];
  const pushBuildingTri = (t) => {
    if (!t) return;
    if (resolveTriHighlighted(t.buildingId)) {
      outHl.push(t.layerId === 5 ? t : { ...t, layerId: 5 });
    } else {
      outBld.push(t.layerId === 4 ? t : { ...t, layerId: 4 });
    }
  };

  const srcBld = src.buildings || [];
  const srcHl = src.highlighted || [];
  for (let i = 0; i < srcBld.length; i++) pushBuildingTri(srcBld[i]);
  for (let i = 0; i < srcHl.length; i++) pushBuildingTri(srcHl[i]);

  return {
    water: (src.water || []).slice(),
    base: (src.base || []).slice(),
    greenery,
    trees,
    roads: (src.roads || []).slice(),
    buildings: outBld,
    highlighted: outHl
  };
}

function createVideoOrderDemoController(vState, engine, previewCanvas, hooks, bridge) {
  const _sceneUidMap = new WeakMap();
  let _nextSceneUid = 1;
  function getSceneUid(sc) {
    if (!sc || typeof sc !== 'object') return 0;
    let id = _sceneUidMap.get(sc);
    if (!id) { id = _nextSceneUid++; _sceneUidMap.set(sc, id); }
    return id;
  }

  const slotGeometryCache = new Map();
  function getCachedGeometry(cacheKey) {
    if (!slotGeometryCache.has(cacheKey)) return null;
    const entry = slotGeometryCache.get(cacheKey);
    slotGeometryCache.delete(cacheKey);
    slotGeometryCache.set(cacheKey, entry);
    return entry;
  }
  function setCachedGeometry(cacheKey, entry) {
    if (slotGeometryCache.has(cacheKey)) slotGeometryCache.delete(cacheKey);
    slotGeometryCache.set(cacheKey, entry);
    if (slotGeometryCache.size > 4) {
      const oldestKey = slotGeometryCache.keys().next().value;
      slotGeometryCache.delete(oldestKey);
    }
  }

  function buildSlotParams(overrides = {}) {
    const scene = overrides.sceneData !== undefined ? overrides.sceneData : vState.sceneData;
    const widthCm = overrides.widthCm || vState.targetWidthCm || 30;
    const heightCm = overrides.heightCm || vState.targetHeightCm || 30;
    const bedSizeMm = Number(overrides.bedSizeMm) || (overrides.widthCm ? overrides.widthCm * 10 : (Number(vState.bedSizeMm) || widthCm * 10));
    const totalHeightMm = Number(overrides.totalHeightMm) || (overrides.heightCm ? overrides.heightCm * 10 : (Number(vState.totalHeightMm) || heightCm * 10));
    const elemVis = overrides.elementVisible
      ? { trees: true, ...overrides.elementVisible }
      : { trees: true, ...vState.elementVisible };
    const isResin = overrides.isResin !== undefined ? Boolean(overrides.isResin) : (vState.isResin !== false);
    const xyPixelMm = Number(overrides.xyPixelMm !== undefined ? overrides.xyPixelMm : vState.xyPixelMm) || 0.05;
    const layerHeightMm = Number(overrides.layerHeightMm !== undefined ? overrides.layerHeightMm : vState.layerHeightMm) || 0.05;
    const bedZ = Number(overrides.bedZ !== undefined ? overrides.bedZ : vState.bedZ) || 200;
    const hollowBase = overrides.hollowBase !== undefined ? Boolean(overrides.hollowBase) : Boolean(vState.hollowBase);
    const waterCutout = overrides.waterCutout !== undefined ? Boolean(overrides.waterCutout) : Boolean(vState.waterCutout);
    const mapRotationDeg = Number(overrides.mapRotationDeg !== undefined ? overrides.mapRotationDeg : vState.mapRotationDeg) || 0;
    const lodSettings = overrides.lodSettings
      ? { ...overrides.lodSettings }
      : (vState.lodSettings ? { ...vState.lodSettings } : { enableTrees: true, treeMaxSpanKm: 4.0, minBuildingFootprintM: 0, roadDetail: 'all' });

    const buildState = {
      cropRatio: vState.cropRatio || 0.88,
      cropCenterX: Number(vState.cropCenterX) || 0,
      cropCenterY: Number(vState.cropCenterY) || 0,
      zScale: overrides.zScale !== undefined ? overrides.zScale : vState.zScale,
      terrainScale: overrides.terrainScale !== undefined ? overrides.terrainScale : vState.terrainScale,
      bedSizeMm,
      totalHeightMm,
      tileCols: overrides.tileCols || vState.tileCols || 1,
      tileRows: overrides.tileRows || vState.tileRows || 1,
      hollowBase,
      waterCutout,
      isResin,
      xyPixelMm,
      layerHeightMm,
      bedZ,
      mapRotationDeg,
      lodSettings,
      layerVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true }
    };

    const toIdArr = (v) => Array.isArray(v) ? v : (v instanceof Set ? Array.from(v) : null);
    const ovrHl = toIdArr(overrides.highlightedBuildingIds);
    const stHl = toIdArr(vState.highlightedBuildingIds);
    const hlIds = ovrHl !== null
      ? ovrHl
      : (stHl && stHl.length > 0
          ? stHl
          : ((scene && Array.isArray(scene.buildings)) ? scene.buildings.filter(b => b.highlighted).map(b => b.id) : []));
    const hlSet = new Set(hlIds);
    const userClickedHighlight = overrides.userClickedHighlight !== undefined
      ? Boolean(overrides.userClickedHighlight)
      : Boolean(vState.userClickedHighlight || hlSet.size > 0);

    return { scene, widthCm, heightCm, elemVis, buildState, hlSet, userClickedHighlight };
  }

  function ensureSceneRotatedForBuild(scene, buildState) {
    if (!scene || typeof applySceneRotation !== 'function') return;
    const canonHalfU = (typeof SCENE_CANONICAL_HALF_UNITS !== 'undefined') ? SCENE_CANONICAL_HALF_UNITS : 84.6;
    const dimW = buildState.bedSizeMm || (typeof DEFAULT_BED_SIZE_MM !== 'undefined' ? DEFAULT_BED_SIZE_MM : 320);
    const dimH = buildState.totalHeightMm || dimW;
    const maxDim = Math.max(dimW, dimH) || dimW;
    const targetHalfW = canonHalfU * (dimW / maxDim);
    const targetHalfH = canonHalfU * (dimH / maxDim);
    const targetRot = (typeof normalizeRotationDeg === 'function')
      ? normalizeRotationDeg(buildState.mapRotationDeg || 0)
      : (Number(buildState.mapRotationDeg) || 0);
    if (
      scene._appliedRotationDeg !== targetRot ||
      Math.abs((scene.halfW || canonHalfU) - targetHalfW) > 0.25 ||
      Math.abs((scene.halfH || canonHalfU) - targetHalfH) > 0.25
    ) {
      applySceneRotation(scene, targetRot, targetHalfW, targetHalfH);
    }
  }

  function finalizeSlotDescriptor(params, res, overrides = {}) {
    const { scene, widthCm, heightCm, elemVis, buildState, hlSet, userClickedHighlight } = params;
    const partitioned = partitionSlotMeshes(
      res.meshes,
      res.pickIdMap || (scene ? null : null),
      hlSet,
      scene ? scene.buildings : null
    );
    const totalTriCount = (partitioned.water.length + partitioned.base.length + partitioned.greenery.length +
      partitioned.trees.length + partitioned.roads.length + partitioned.buildings.length + partitioned.highlighted.length);
    vState.lastModelMetrics = res.printMetrics || null;

    const lat = (scene && scene.center && scene.center[0]) || vState.mapCenterLat;
    const lon = (scene && scene.center && scene.center[1]) || vState.mapCenterLon;

    return {
      id: Date.now() + Math.random(),
      sceneData: scene,
      meshes: partitioned,
      printMetrics: res.printMetrics,
      totalTriangles: totalTriCount || res.totalTriangles || 0,
      widthCm,
      heightCm,
      bedSizeMm: buildState.bedSizeMm,
      totalHeightMm: buildState.totalHeightMm,
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
      tileCols: buildState.tileCols,
      tileRows: buildState.tileRows,
      cropRatio: buildState.cropRatio,
      waterCutout: buildState.waterCutout,
      userClickedHighlight
    };
  }

  function tryReuseSharedOrCachedRaw(scene, buildState) {
    const sig = computeVideoGeometrySignature(scene, buildState);
    const mainSt = (bridge && typeof bridge.getState === 'function') ? bridge.getState() : null;
    if (mainSt && mainSt.sceneData === scene && mainSt.layerMeshes) {
      const m = mainSt.layerMeshes;
      const triCount = (m.water ? m.water.length : 0) + (m.base ? m.base.length : 0) +
        (m.greenery ? m.greenery.length : 0) + (m.roads ? m.roads.length : 0) +
        (m.buildings ? m.buildings.length : 0) + (m.highlighted ? m.highlighted.length : 0);
      if (triCount > 0 && computeVideoGeometrySignature(mainSt.sceneData, mainSt) === sig) {
        return {
          meshes: m,
          pickIdMap: mainSt.pickIdMap,
          printMetrics: mainSt.lastModelMetrics || null,
          totalTriangles: triCount
        };
      }
    }
    const cacheKey = `${getSceneUid(scene)}|${sig}`;
    return getCachedGeometry(cacheKey);
  }

  function buildSlotDescriptorFromCurrent(overrides = {}) {
    const params = buildSlotParams(overrides);
    const { scene, buildState } = params;
    ensureSceneRotatedForBuild(scene, buildState);
    let res = tryReuseSharedOrCachedRaw(scene, buildState);
    if (!res) {
      res = buildComplete3DModel(scene, buildState);
      if (scene) {
        const cacheKey = `${getSceneUid(scene)}|${computeVideoGeometrySignature(scene, buildState)}`;
        setCachedGeometry(cacheKey, {
          meshes: res.meshes,
          pickIdMap: buildState.pickIdMap || res.pickIdMap,
          printMetrics: res.printMetrics,
          totalTriangles: res.totalTriangles
        });
      }
    }
    return finalizeSlotDescriptor(params, { ...res, pickIdMap: res.pickIdMap || buildState.pickIdMap }, overrides);
  }

  async function buildSlotDescriptorAsync(overrides = {}) {
    const params = buildSlotParams(overrides);
    const { scene, buildState } = params;
    ensureSceneRotatedForBuild(scene, buildState);
    let res = tryReuseSharedOrCachedRaw(scene, buildState);
    if (!res) {
      if (typeof rebuildModel3DProgressive === 'function') {
        const progRes = await rebuildModel3DProgressive(scene, buildState, {
          timeBudgetMs: 14,
          onProgress: (pct, msg) => {
            const loadingTxt = (typeof document !== 'undefined' && document.getElementById)
              ? document.getElementById('vidLoadingText')
              : null;
            if (loadingTxt && msg) loadingTxt.textContent = msg;
          }
        });
        if (progRes && !progRes.aborted && progRes.meshes) {
          res = {
            meshes: progRes.meshes,
            pickIdMap: buildState.pickIdMap || progRes.pickIdMap,
            printMetrics: progRes.printMetrics,
            totalTriangles: progRes.totalTriangles
          };
        }
      }
      if (!res) {
        res = buildComplete3DModel(scene, buildState);
      }
      if (scene && res) {
        const cacheKey = `${getSceneUid(scene)}|${computeVideoGeometrySignature(scene, buildState)}`;
        setCachedGeometry(cacheKey, {
          meshes: res.meshes,
          pickIdMap: res.pickIdMap || buildState.pickIdMap,
          printMetrics: res.printMetrics,
          totalTriangles: res.totalTriangles
        });
      }
    }
    return finalizeSlotDescriptor(params, { ...res, pickIdMap: res.pickIdMap || buildState.pickIdMap }, overrides);
  }

  function canFastBuildCurrentSlot(overrides = {}) {
    if (vState.pinnedSlots && vState.pinnedSlots.length > 0) return true;
    const params = buildSlotParams(overrides);
    if (!params.scene) return true;
    return Boolean(tryReuseSharedOrCachedRaw(params.scene, params.buildState));
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
      const visKeys = Object.keys(s0.elementVisible || {});
      const activeLayerCount = Object.values(s0.elementVisible || {}).filter(Boolean).length;
      const totalLayerCount = visKeys.length || 7;
      const frameLbl = (VIDEO_FRAME_FINISHES[s0.frameStyle] || VIDEO_FRAME_FINISHES.black).label;
      specEl.textContent = `${count}× Format ${s0.widthCm}×${s0.heightCm} cm • ${frameLbl} • ${activeLayerCount}/${totalLayerCount} warstw • ~${Math.round(totalMl)} ml materiału`;
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
            elementVisible: { water: true, base: true, greenery: false, trees: false, roads: false, buildings: false, highlighted: false },
            colors: { ...PALETTES[1].colors }
          }),
          buildSlotDescriptorFromCurrent({
            title: `${baseTitle} • II`,
            subtitle: 'UKŁAD URBANISTYCZNY ULIC',
            elementVisible: { water: true, base: false, greenery: true, trees: true, roads: true, buildings: false, highlighted: false },
            backingStyle: 'obsidian',
            colors: { ...PALETTES[0].colors, roads: '#f8fafc' }
          }),
          buildSlotDescriptorFromCurrent({
            title: `${baseTitle} • III`,
            subtitle: 'ARCHITEKTURA 3D LoD2',
            elementVisible: { water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true }
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
            if (sc) built.push(await buildSlotDescriptorAsync({ sceneData: sc, title: p.title, subtitle: p.subtitle }));
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
            waterCutout: Boolean(s.waterCutout),
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
    buildSlotDescriptorAsync,
    canFastBuildCurrentSlot,
    updateOrderSummaryUI,
    populateOrderDemoModal,
    bindSetAndOrderControls
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatVideoCoordsText,
    formatVideoScaleText,
    computeVideoItemPriceEur,
    computeVideoGeometrySignature,
    partitionSlotMeshes,
    createVideoOrderDemoController
  };
}
