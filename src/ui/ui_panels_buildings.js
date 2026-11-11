// ============================================================================
// src/ui/ui_panels_buildings.js
// Compact 16-bit PickID Building Inspector, Multi-Part S3DB Group Selection
// & Landmark Chips (Zero Neighbor Collisions & 100% Unified Multi-Part Actions)
// ============================================================================

function resolveBuildingPickId(state, bOrToken) {
  if (!bOrToken) return null;
  if (typeof bOrToken === 'number') {
    if (state.pickIdMap && state.pickIdMap.has(bOrToken)) return bOrToken;
    if (state.pickIdMap) {
      for (const [pid, info] of state.pickIdMap.entries()) {
        if (info.groupId === bOrToken || info.buildings.some(x => x.id === bOrToken || x.osmId === bOrToken)) {
          return pid;
        }
      }
    }
    return bOrToken;
  }
  if (bOrToken._pickId) return bOrToken._pickId;
  if (state.pickIdMap) {
    for (const [pid, info] of state.pickIdMap.entries()) {
      if (info.buildings.includes(bOrToken) || info.groupId === (bOrToken.groupId || bOrToken.osmId)) {
        return pid;
      }
    }
  }
  return bOrToken.id || null;
}

function createUIPanelsController(state, draw2DMap, onRebuildNeeded) {
  const {
    renderPalettesUI,
    renderLayersUI,
    updateTileSelectorOptions,
    updateStatsUI
  } = createUILayersStatsController(state, onRebuildNeeded);

  function getActiveTargetBuildings() {
    const scene = state.sceneData;
    if (!scene || !scene.buildings) return [];
    const rawTokens = new Set(state.selectedBuildingIds);
    if (rawTokens.size === 0 && state.selectedBuildingId) {
      rawTokens.add(state.selectedBuildingId);
    }
    const result = [];
    const seen = new Set();
    rawTokens.forEach(tok => {
      const pid = resolveBuildingPickId(state, tok);
      let members = [];
      if (pid && state.pickIdMap && state.pickIdMap.has(pid)) {
        members = state.pickIdMap.get(pid).buildings;
      } else {
        members = scene.buildings.filter(x => x._pickId === pid || x.id === tok || x.osmId === tok);
      }
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
    const hlCountBadge = document.getElementById('highlightedCountBadge');
    if (!hlCountBadge) return;
    const scene = state.sceneData;
    if (!scene) return;

    const hlPickIds = new Set();
    (scene.buildings || []).forEach(b => {
      if (b.highlighted && !b.hidden) hlPickIds.add(b._pickId || b.id);
    });
    const hlCount = hlPickIds.size;
    const selCount = state.selectedBuildingIds.size || (state.selectedBuildingId ? 1 : 0);
    hlCountBadge.textContent =
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

    const pid = resolveBuildingPickId(state, b);
    const pickInfo = (pid && state.pickIdMap) ? state.pickIdMap.get(pid) : null;
    const groupCount = state.selectedBuildingIds.size;
    const bldName = (pickInfo && pickInfo.name) ||
      (activeBlds.find(x => x.name && !x.name.startsWith('Budynek OSM') && !x.name.startsWith('Część #')) || b).name;

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

    const displayOsmId = (pickInfo && pickInfo.primaryBuilding && pickInfo.primaryBuilding.osmId) || b.osmId || b.groupId || b.id;
    const maxLevels = Math.max(...activeBlds.map(x => x.levels || 1));
    const partCount = activeBlds.length;
    document.getElementById('inspOsmId').textContent =
      `OSM ID: ${displayOsmId} • Kondygnacje: ${maxLevels} • ${partCount > 1 ? partCount + ' części (S3DB)' : '1 bryła'}`;

    const effMeters = Math.round(Math.max(...activeBlds.map(x => (x.h || 0) * (x.heightMult || 1))));
    const activePickSet = new Set(activeBlds.map(x => x._pickId).filter(Boolean));
    const groupBounds = (state.buildingBounds || []).filter(
      x => activePickSet.has(x.pickId) || (x.building && activePickSet.has(x.building._pickId)) || (x.building && x.building.id === b.id)
    );
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
    const pid = resolveBuildingPickId(state, b);
    if (!pid) return;
    state.userClickedBuilding = true;
    if (isShiftKey) {
      const prevPid = resolveBuildingPickId(state, state.selectedBuildingId);
      if (state.selectedBuildingIds.size === 0 && prevPid && prevPid !== pid) {
        state.selectedBuildingIds.add(prevPid);
      }
      if (state.selectedBuildingIds.has(pid)) {
        state.selectedBuildingIds.delete(pid);
      } else {
        state.selectedBuildingIds.add(pid);
      }
      state.selectedBuildingId = pid;
    } else {
      state.selectedBuildingIds.clear();
      state.selectedBuildingIds.add(pid);
      state.selectedBuildingId = pid;
    }
    updateInspectorUI();
    updateLandmarkChips();
    draw2DMap();
  }

  function updateLandmarkChips() {
    const container = document.getElementById('landmarkChips');
    if (!container || !state.sceneData) return;
    container.innerHTML = '';

    const seenPids = new Set();
    const named = [];
    if (state.pickIdMap && state.pickIdMap.size > 0) {
      for (const [pid, info] of state.pickIdMap.entries()) {
        const b = info.primaryBuilding;
        const nm = info.name || (b && b.name) || '';
        if (!nm || nm.startsWith('Budynek OSM') || nm.startsWith('Część #')) continue;
        if (!(b && b.landmark) && !info.buildings.some(x => x.landmark || x.church || x.tower)) continue;
        if (seenPids.has(pid)) continue;
        seenPids.add(pid);
        named.push({ pid, b, name: nm, highlighted: info.buildings.some(x => x.highlighted) });
        if (named.length >= 8) break;
      }
    }

    named.forEach(entry => {
      const chip = document.createElement('button');
      const isSel = state.userClickedBuilding && (state.selectedBuildingIds.has(entry.pid) || state.selectedBuildingId === entry.pid);
      chip.className = `text-xs px-2 py-1 rounded-md border transition flex items-center gap-1 ${
        isSel ? 'border-amber-500 bg-amber-500/15 text-amber-500 font-semibold' : 'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:opacity-80'
      }`;
      chip.textContent = `${entry.highlighted ? '★ ' : ''}${entry.name.slice(0, 22)}`;
      chip.addEventListener('click', (e) => handleSelectBuilding(entry.b, !!(e && e.shiftKey)));
      container.appendChild(chip);
    });
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
