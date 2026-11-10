// ============================================================================
// src/ui_app.js
// Main Application Controller, 3D/2D Viewport Events, Photon Search & URL Hooks
// ============================================================================

function initMap3DApp(initialScene) {
  if (initialScene && !initialScene._fetchedCropRatio) {
    initialScene._fetchedCropRatio = 0.88;
  }
  const state = {
    mapCenterLat: initialScene ? initialScene.center[0] : 48.1338,
    mapCenterLon: initialScene ? initialScene.center[1] : 11.5855,
    mapZoom: 15,
    plaqueText: initialScene ? initialScene.title : 'MÜNCHEN',
    printerProfileId: 'fdm_330_1x1',
    bedSizeMm: 320,
    totalHeightMm: 320,
    tileCols: 1,
    tileRows: 1,
    tileExplode: 0.0,
    isResin: false,
    layerHeightMm: 0.20,
    hollowBase: false, // Fix B03: False by default on FDM (slicer generates infill); automatically enabled on SLA Resin profiles
    hollowWallMm: 1.8,
    exportTileFilter: 'all',
    printMetrics: null,
    cropRatio: 0.88,
    cropCenterX: 0.0,
    cropCenterY: 0.0,
    explodeFactor: 0.0,
    zScale: 1.25,
    terrainScale: 1.15,
    waterSteps: 3,
    sunAngleDeg: 132,
    showFrame: true,
    showLayerLines: true,
    studioBg: true,
    frameStyle: 'black',
    autoRotate: false,
    activePalette: 'lichtbild_studio',
    colors: { ...PALETTES[0].colors },
    layerVisible: {
      water: true,
      base: true,
      greenery: true,
      roads: true,
      buildings: true,
      highlighted: true
    },
    sceneData: initialScene,
    selectedBuildingId: null,
    selectedBuildingIds: new Set(),
    hoveredBuildingId: null,
    userClickedBuilding: false,
    layerMeshes: {},
    buildingBounds: [],
    groupIdMap: new Map(), // maps groupId -> array of buildings in that group
    totalTriangles: 0
  };

  const canvas3d = document.getElementById('view3dCanvas');
  const studio = createWebGLStudio(canvas3d, state);

  studio.camera.yaw = -0.48;
  studio.camera.pitch = 0.50;
  studio.camera.distance = 274;
  studio.camera.target = [2, 5, 3.2];

  // ==========================================================================
  // SLIPPY MAP TILE CACHE & GEOGRAPHIC PROJECTION
  // ==========================================================================
  const canvas2d = document.getElementById('map2dCanvas');
  const ctx2d = canvas2d.getContext('2d');
  const osmTileCache = {};
  let lastRandomIndex = -1;

  const { getSelectedBBoxLatLon, draw2DMap } = createMap2DController(canvas2d, ctx2d, osmTileCache, state);
  const {
    renderPalettesUI,
    renderLayersUI,
    getActiveTargetBuildings,
    updateInspectorUI,
    handleSelectBuilding,
    updateLandmarkChips,
    updateTileSelectorOptions,
    updateStatsUI
  } = createUIPanelsController(state, draw2DMap);

  // ==========================================================================
  // REBUILD 3D MODEL FROM CURRENT REAL GIS SCENE
  // ==========================================================================
  function rebuildModel3D() {
    const res = buildComplete3DModel(state.sceneData, state);
    state.layerMeshes = res.meshes;
    state.buildingBounds = res.buildingBounds;
    state.totalTriangles = res.totalTriangles;
    state.printMetrics = res.printMetrics || null;

    // Build groupId -> buildings lookup so multi-part buildings act as one cohesive unit
    state.groupIdMap.clear();
    res.buildingBounds.forEach(bb => {
      const gid = bb.groupId || bb.building.id;
      bb.building._groupId = gid;
      if (!state.groupIdMap.has(gid)) state.groupIdMap.set(gid, []);
      state.groupIdMap.get(gid).push(bb.building);
    });

    studio.uploadMeshes(state.layerMeshes);
    updateTileSelectorOptions();
    updateStatsUI();
    updateLandmarkChips();
    updateInspectorUI();
  }


  // ==========================================================================
  // LIVE FETCH REAL OSM + REAL DEM FOR CURRENT MAP BOUNDING BOX
  // ==========================================================================
  async function fetchRealGISAndRender(customBBox, titleHint, regionLabel) {
    const btn = document.getElementById('btnRender3D');
    const statusOverlay = document.getElementById('loadingOverlay3D');
    const statusText = document.getElementById('loadingStatusText');
    const regBadge = document.getElementById('currentRegionBadge');

    const [south, west, north, east] = customBBox || getSelectedBBoxLatLon();
    const title = titleHint || state.plaqueText || 'MAP3D';
    if (regBadge && regionLabel) regBadge.textContent = regionLabel;

    if (statusOverlay) statusOverlay.classList.remove('hidden');
    if (statusText) statusText.textContent = `Pobieranie prawdziwych danych GIS (DEM + OpenStreetMap) dla ${title} [${south.toFixed(3)}°, ${west.toFixed(3)}°]...`;
    if (btn) btn.disabled = true;

    try {
      const qs = `south=${south.toFixed(4)}&west=${west.toFixed(4)}&north=${north.toFixed(4)}&east=${east.toFixed(4)}&title=${encodeURIComponent(title)}`;
      let scene = null;

      // 1. Try local Python GIS Server first (fast disk cache + IPv4 Overpass)
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 42000);
        let resp = null;
        try {
          resp = await fetch(`/api/gis?${qs}`, { signal: ctrl.signal });
        } catch (_) {
          resp = await fetch(`http://127.0.0.1:8765/api/gis?${qs}`, { signal: ctrl.signal });
        }
        clearTimeout(timer);
        if (resp && resp.ok) {
          const data = await resp.json();
          if (data && Array.isArray(data.buildings)) scene = data;
        }
      } catch (_) {
        // Fallback to direct in-browser fetch
      }

      // 2. If server wasn't reachable or returned error, run direct in-browser GIS pipeline!
      if (!scene) {
        if (statusText) statusText.textContent = `Pobieranie bezpośrednio w przeglądarce (AWS Terrarium DEM + Overpass API) dla ${title}...`;
        scene = await fetchRealGISInBrowser(south, west, north, east, title);
      }

      if (scene) {
        // Fix B04 / U1: Record the cropRatio at which this bbox was fetched so 2D map frame matches 3D model 1:1
        scene._fetchedCropRatio = state.cropRatio || 0.88;
        state.sceneData = scene;
        state.mapCenterLat = scene.center[0];
        state.mapCenterLon = scene.center[1];
        state.cropCenterX = 0;
        state.cropCenterY = 0;
        state.selectedBuildingIds.clear();
        state.userClickedBuilding = false;
        const firstLandmark = (scene.buildings || []).find(b => b.church || b.landmark) || (scene.buildings || [])[0];
        state.selectedBuildingId = firstLandmark ? firstLandmark.id : null;
        const errBanner = document.getElementById('gisErrorBanner');
        if (errBanner) errBanner.classList.add('hidden');
        draw2DMap();
        rebuildModel3D();
      }
    } catch (err) {
      console.warn('GIS Fetch error:', err);
      const errBanner = document.getElementById('gisErrorBanner');
      const errText = document.getElementById('gisErrorText');
      if (errBanner && errText) {
        errText.textContent = `Nie udało się pobrać nowego kadru GIS (${err && err.message ? err.message : 'Timeout Overpass'}). Wyświetlam ostatni model.`;
        errBanner.classList.remove('hidden');
      }
      rebuildModel3D();
    } finally {
      if (statusOverlay) statusOverlay.classList.add('hidden');
      if (btn) btn.disabled = false;
    }
  }


  // ==========================================================================
  // EVENT HANDLERS: 3D VIEWPORT (ROTATE, PAN, CLICK & SHIFT+CLICK MULTI-SELECT)
  // ==========================================================================
  let isDragging3D = false, isPanning3D = false;
  let lastX = 0, lastY = 0, downPos = [0, 0];

  canvas3d.addEventListener('mousedown', e => {
    isDragging3D = true;
    // Pan with Right-Click (button 2) or Middle-Click (button 1) so Shift+Click is free for multi-selecting buildings!
    isPanning3D = (e.button === 2 || e.button === 1);
    lastX = e.clientX; lastY = e.clientY;
    downPos = [e.clientX, e.clientY];
    state.autoRotate = false;
  });

  window.addEventListener('mousemove', e => {
    if (isDragging3D) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (isPanning3D) {
        const ps = 0.20;
        studio.camera.target[0] -= dx * ps * Math.cos(studio.camera.yaw);
        studio.camera.target[1] -= dx * ps * Math.sin(studio.camera.yaw);
        studio.camera.target[2] += dy * ps;
      } else {
        studio.camera.yaw += dx * 0.008;
        studio.camera.pitch = Math.max(-1.25, Math.min(1.50, studio.camera.pitch + dy * 0.008));
      }
      return;
    }

    const rect = canvas3d.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      const hit = studio.pickBuilding(e.clientX, e.clientY, state.buildingBounds);
      const tooltip = document.getElementById('hoverTooltip');
      if (hit) {
        state.hoveredBuildingId = hit._groupId || hit.id;
        tooltip.classList.remove('hidden');
        tooltip.style.left = `${e.clientX - rect.left + 14}px`;
        tooltip.style.top = `${e.clientY - rect.top + 14}px`;
        tooltip.innerHTML = `<strong>${escapeHtml(hit.name)}</strong><br/><span class="text-blue-300 font-mono">Wysokość: ${escapeHtml(hit.h)}m (${escapeHtml(hit.levels)} p.) • Klik: zaznacz • Shift+Klik: dodaj</span>`;
      } else {
        state.hoveredBuildingId = null;
        tooltip.classList.add('hidden');
      }
    }
  });

  window.addEventListener('mouseup', e => {
    if (isDragging3D) {
      const dist = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
      if (dist < 5 && e.target === canvas3d && e.button === 0) {
        const hit = studio.pickBuilding(e.clientX, e.clientY, state.buildingBounds);
        if (hit) {
          handleSelectBuilding(hit, e.shiftKey);
        }
      }
    }
    isDragging3D = false;
    isPanning3D = false;
  });

  canvas3d.addEventListener('contextmenu', e => e.preventDefault());
  canvas3d.addEventListener('wheel', e => {
    e.preventDefault();
    studio.camera.distance = Math.max(75, Math.min(480, studio.camera.distance + e.deltaY * 0.16));
  }, { passive: false });

  // ==========================================================================
  // 2D SLIPPY MAP PANNING & ZOOMING (ANYWHERE ON EARTH)
  // ==========================================================================
  let isDragging2D = false;
  let drag2DStart = [0, 0];

  canvas2d.addEventListener('mousedown', e => {
    isDragging2D = true;
    drag2DStart = [e.clientX, e.clientY];
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging2D) return;
    const dx = e.clientX - drag2DStart[0];
    const dy = e.clientY - drag2DStart[1];
    drag2DStart = [e.clientX, e.clientY];

    const z = Math.round(state.mapZoom);
    const cxTile = lon2tileF(state.mapCenterLon, z) - dx / 256.0;
    const cyTile = lat2tileF(state.mapCenterLat, z) - dy / 256.0;
    state.mapCenterLon = Math.max(-179.9, Math.min(179.9, tileF2lon(cxTile, z)));
    state.mapCenterLat = Math.max(-80.0, Math.min(80.0, tileF2lat(cyTile, z)));
    draw2DMap();
  });

  window.addEventListener('mouseup', () => {
    isDragging2D = false;
  });

  canvas2d.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    state.mapZoom = Math.max(3, Math.min(16, state.mapZoom + delta));
    draw2DMap();
  }, { passive: false });

  document.getElementById('btnZoomIn2D').addEventListener('click', () => {
    state.mapZoom = Math.min(16, state.mapZoom + 1);
    draw2DMap();
  });

  document.getElementById('btnZoomOut2D').addEventListener('click', () => {
    state.mapZoom = Math.max(3, state.mapZoom - 1);
    draw2DMap();
  });

  // ==========================================================================
  // LIVE PLACE AUTOCOMPLETE (PHOTON KOMOOT API — ZERO 403 BLOCKS!)
  // ==========================================================================
  const placeInput = document.getElementById('placeSearchInput');
  const suggestionsBox = document.getElementById('searchSuggestionsDropdown');
  let searchDebounceTimer = null;

  async function queryPlaceSuggestions(q) {
    if (!q || q.length < 2) {
      suggestionsBox.classList.add('hidden');
      return [];
    }
    try {
      const resp = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6`);
      if (!resp.ok) throw new Error('Photon status ' + resp.status);
      const data = await resp.json();
      const features = data.features || [];
      return features.map(f => {
        const props = f.properties || {};
        const coords = (f.geometry && f.geometry.coordinates) || [11.5855, 48.1338];
        const name = props.name || props.city || props.locality || q;
        const sub = [props.state, props.country].filter(Boolean).join(', ');
        const kind = props.osm_value || props.type || 'miejsce';
        return {
          name,
          sub,
          kind,
          lat: coords[1],
          lon: coords[0]
        };
      });
    } catch (e) {
      console.warn('Autocomplete fallback:', e);
      return [];
    }
  }

  function renderSuggestionsDropdown(items) {
    if (!items || items.length === 0) {
      suggestionsBox.classList.add('hidden');
      suggestionsBox.innerHTML = '';
      return;
    }
    suggestionsBox.innerHTML = '';
    items.forEach(item => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'w-full text-left px-3 py-2 hover:bg-blue-500/15 transition flex items-center justify-between gap-2';
      row.innerHTML = `
        <div class="min-w-0">
          <div class="text-xs font-bold text-[var(--foreground)] truncate">${escapeHtml(item.name)}</div>
          <div class="text-xs text-[var(--muted-foreground)] truncate">${escapeHtml(item.sub || 'Świat')}</div>
        </div>
        <span class="text-xs font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 shrink-0">${item.lat.toFixed(2)}°, ${item.lon.toFixed(2)}°</span>
      `;
      row.addEventListener('click', () => {
        suggestionsBox.classList.add('hidden');
        placeInput.value = `${item.name}${item.sub ? ', ' + item.sub : ''}`;
        jumpToLatLonAndRender(item.lat, item.lon, item.name.toUpperCase().slice(0, 20), `${item.sub || 'Świat'} • ${item.name}`);
      });
      suggestionsBox.appendChild(row);
    });
    suggestionsBox.classList.remove('hidden');
  }

  placeInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const q = placeInput.value.trim();
    if (q.length < 2) {
      suggestionsBox.classList.add('hidden');
      return;
    }
    searchDebounceTimer = setTimeout(async () => {
      const items = await queryPlaceSuggestions(q);
      renderSuggestionsDropdown(items);
    }, 200);
  });

  document.addEventListener('click', e => {
    if (!placeInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add('hidden');
    }
  });

  async function jumpToLatLonAndRender(lat, lon, shortTitle, regionDesc) {
    state.mapCenterLat = lat;
    state.mapCenterLon = lon;
    state.mapZoom = 15;
    state.plaqueText = shortTitle;
    const pInput = document.getElementById('plaqueTextInput');
    if (pInput) pInput.value = shortTitle;
    draw2DMap();
    const bbox = getSelectedBBoxLatLon();
    await fetchRealGISAndRender(bbox, shortTitle, regionDesc);
  }

  async function searchPlaceAndFetch() {
    const q = (placeInput ? placeInput.value : '').trim();
    if (!q) return;
    suggestionsBox.classList.add('hidden');
    const btn = document.getElementById('btnSearchPlace');
    if (btn) btn.textContent = '...';
    try {
      const items = await queryPlaceSuggestions(q);
      if (items.length > 0) {
        const best = items[0];
        await jumpToLatLonAndRender(best.lat, best.lon, best.name.toUpperCase().slice(0, 20), `${best.sub || 'Świat'} • ${best.name}`);
      }
    } finally {
      if (btn) btn.textContent = 'Szukaj';
    }
  }

  document.getElementById('btnSearchPlace').addEventListener('click', searchPlaceAndFetch);
  placeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchPlaceAndFetch();
    }
  });

  // ==========================================================================
  // UNIVERSAL WORLD RANDOMIZER (MOUNTAINS, RESORTS, ASIA, EAST/WEST, ALL)
  // ==========================================================================
  document.querySelectorAll('[data-random-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-random-cat');
      const pool = cat === 'all' ? WORLD_LOCATIONS : WORLD_LOCATIONS.filter(x => x.cat === cat);
      if (!pool.length) return;
      let idx = Math.floor(Math.random() * pool.length);
      if (pool.length > 1 && idx === lastRandomIndex) {
        idx = (idx + 1) % pool.length;
      }
      lastRandomIndex = idx;
      const pick = pool[idx];
      placeInput.value = pick.region;
      jumpToLatLonAndRender(pick.lat, pick.lon, pick.title, pick.region);
    });
  });

  document.getElementById('btnRender3D').addEventListener('click', () => {
    fetchRealGISAndRender(null, state.plaqueText);
  });

  const btnRetryGis = document.getElementById('btnRetryGis');
  if (btnRetryGis) {
    btnRetryGis.addEventListener('click', () => {
      fetchRealGISAndRender(null, state.plaqueText);
    });
  }

  let sliderRebuildTimer = null;
  function scheduleRebuildModel3D() {
    clearTimeout(sliderRebuildTimer);
    sliderRebuildTimer = setTimeout(() => {
      rebuildModel3D();
    }, 80);
  }

  document.getElementById('cropSizeSlider').addEventListener('input', e => {
    const sc = state.sceneData;
    const baseCrop = (sc && sc._fetchedCropRatio) || 0.88;
    const rawVal = parseInt(e.target.value, 10) / 100;
    state.cropRatio = Math.min(baseCrop, rawVal);
    if (rawVal > baseCrop) {
      e.target.value = Math.round(baseCrop * 100);
    }
    const effCrop = Math.min(1.0, Math.max(0.35, state.cropRatio / baseCrop));
    const realSpanM = ((sc && sc.spanMeters) || 1291.3) * effCrop;
    const scaleDenom = Math.round((realSpanM * 1000) / Math.max(1, state.bedSizeMm || 320));
    document.getElementById('cropSizeLabel').textContent = `${(realSpanM / 1000).toFixed(2)} km (1:${scaleDenom})`;
    draw2DMap();
  });
  document.getElementById('cropSizeSlider').addEventListener('change', () => rebuildModel3D());

  // Exploded View slider & toggle
  const explodeSlider = document.getElementById('explodeSlider');
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

  // Independent Tile Grid Selector (U4 / B22: Works on ANY printer without overwriting printer selection!)
  const tileGridSelect = document.getElementById('tileGridSelect');
  if (tileGridSelect) {
    tileGridSelect.addEventListener('change', e => {
      const [cStr, rStr] = (e.target.value || '1x1').split('x');
      state.tileCols = Math.max(1, Math.min(4, parseInt(cStr, 10) || 1));
      state.tileRows = Math.max(1, Math.min(4, parseInt(rStr, 10) || 1));
      state.exportTileFilter = 'all';
      if (state.tileCols === 1 && state.tileRows === 1) {
        state.tileExplode = 0;
        if (tileExplodeSlider) tileExplodeSlider.value = 0;
        const lbl = document.getElementById('tileExplodeValueLabel');
        if (lbl) lbl.textContent = '0%';
      }
      draw2DMap();
      rebuildModel3D();
    });
  }

  // Multi-Tile Split Explode slider & toggle (preserves active printer while enabling 2x2 or 2x3 split if in 1x1!)
  const tileExplodeSlider = document.getElementById('tileExplodeSlider');
  if (tileExplodeSlider) {
    tileExplodeSlider.addEventListener('input', e => {
      const val = parseInt(e.target.value, 10);
      if ((state.tileCols || 1) === 1 && (state.tileRows || 1) === 1 && val > 0) {
        const prof = PRINT_PROFILES[state.printerProfileId] || PRINT_PROFILES.fdm_330_1x1;
        state.tileCols = 2;
        state.tileRows = prof.isResin ? 3 : 2;
        draw2DMap();
        rebuildModel3D();
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
        state.tileCols = 2;
        state.tileRows = prof.isResin ? 3 : 2;
        draw2DMap();
        rebuildModel3D();
      }
      const target = state.tileExplode > 0.15 ? 0 : 65;
      if (tileExplodeSlider) tileExplodeSlider.value = target;
      state.tileExplode = target / 100;
      const lbl = document.getElementById('tileExplodeValueLabel');
      if (lbl) lbl.textContent = `${target}%`;
      if (target > 0) {
        studio.camera.pitch = 0.62;
        studio.camera.distance = 295;
      }
    });
  }

  function applyPrinterProfile(profileId) {
    const prof = PRINT_PROFILES[profileId] || PRINT_PROFILES.fdm_330_1x1;
    state.printerProfileId = prof.id;
    state.bedSizeMm = prof.totalWidthMm;
    state.totalHeightMm = prof.totalHeightMm;
    state.tileCols = prof.cols;
    state.tileRows = prof.rows;
    state.exportTileFilter = 'all';
    // Fix R11 & B03: layerHeightMm comes strictly from the printer profile (0.05 mm SLA / 0.20 mm FDM), independent of hollowBase
    state.isResin = !!prof.isResin;
    state.layerHeightMm = prof.isResin ? 0.05 : 0.20;
    state.hollowBase = !!prof.isResin;
    const chkH = document.getElementById('chkHollowBase');
    if (chkH) chkH.checked = state.hollowBase;
    if (prof.cols === 1 && prof.rows === 1) {
      state.tileExplode = 0;
      if (tileExplodeSlider) tileExplodeSlider.value = 0;
      const lbl = document.getElementById('tileExplodeValueLabel');
      if (lbl) lbl.textContent = '0%';
    }
    draw2DMap();
    rebuildModel3D();
  }

  // Multi-Select Inspector Actions (applies to all selected buildings + their building:parts!)
  document.getElementById('btnToggleHighlight').addEventListener('click', () => {
    const targets = getActiveTargetBuildings();
    if (!targets.length) return;
    const newState = !targets[0].highlighted;
    targets.forEach(b => { b.highlighted = newState; });
    draw2DMap();
    rebuildModel3D();
  });

  document.getElementById('btnToggleHideBuilding').addEventListener('click', () => {
    const targets = getActiveTargetBuildings();
    if (!targets.length) return;
    const newState = !targets[0].hidden;
    targets.forEach(b => { b.hidden = newState; });
    draw2DMap();
    rebuildModel3D();
  });

  document.getElementById('inspHeightMultiplier').addEventListener('input', e => {
    const targets = getActiveTargetBuildings();
    if (!targets.length) return;
    const mult = parseInt(e.target.value, 10) / 100;
    targets.forEach(b => { b.heightMult = mult; });
    document.getElementById('inspHeightMultLabel').textContent = `${e.target.value}%`;
    scheduleRebuildModel3D();
  });

  // Camera Presets
  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-cam');
      state.autoRotate = false;
      if (mode === 'studio') {
        studio.camera.yaw = -0.48; studio.camera.pitch = 0.50; studio.camera.distance = 274;
        studio.camera.target = [2, 5, 3.2];
      } else if (mode === 'top') {
        studio.camera.yaw = 0; studio.camera.pitch = 1.51; studio.camera.distance = 250;
        studio.camera.target = [0, 0, 2.0];
      } else if (mode === 'side') {
        studio.camera.yaw = -0.45; studio.camera.pitch = 0.26; studio.camera.distance = 265;
        if (state.explodeFactor < 0.3) {
          explodeSlider.value = 65;
          state.explodeFactor = 0.65;
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
        studio.camera.yaw = -0.38; studio.camera.pitch = 0.64; studio.camera.distance = 298;
        studio.camera.target = [0, 0, 2.5];
      } else if (mode === 'bottom') {
        studio.camera.yaw = -0.42; studio.camera.pitch = -0.68; studio.camera.distance = 255;
        studio.camera.target = [0, 0, 1.0];
      }
    });
  });

  document.getElementById('btnAutoRotate').addEventListener('click', () => {
    state.autoRotate = !state.autoRotate;
  });

  document.getElementById('zScaleSlider').addEventListener('input', e => {
    state.zScale = parseInt(e.target.value, 10) / 100;
    document.getElementById('zScaleLabel').textContent = `${state.zScale.toFixed(2)}×`;
    scheduleRebuildModel3D();
  });

  document.getElementById('terrainScaleSlider').addEventListener('input', e => {
    state.terrainScale = parseInt(e.target.value, 10) / 100;
    document.getElementById('terrainScaleLabel').textContent = `${state.terrainScale.toFixed(2)}×`;
    scheduleRebuildModel3D();
  });

  document.getElementById('sunAngleSlider').addEventListener('input', e => {
    state.sunAngleDeg = parseInt(e.target.value, 10);
  });

  document.getElementById('chkShowFrame').addEventListener('change', e => {
    state.showFrame = e.target.checked;
  });

  document.getElementById('chkStudioBg').addEventListener('change', e => {
    state.studioBg = e.target.checked;
  });

  document.getElementById('frameStyleSelect').addEventListener('change', e => {
    state.frameStyle = e.target.value;
  });

  document.getElementById('plaqueTextInput').addEventListener('input', e => {
    state.plaqueText = e.target.value || 'MAP3D';
  });

  document.getElementById('printerSelect').addEventListener('change', e => {
    applyPrinterProfile(e.target.value);
  });

  const chkHollowBase = document.getElementById('chkHollowBase');
  if (chkHollowBase) {
    chkHollowBase.addEventListener('change', e => {
      state.hollowBase = e.target.checked;
      rebuildModel3D();
    });
  }

  const exportTileSelect = document.getElementById('exportTileSelect');
  if (exportTileSelect) {
    exportTileSelect.addEventListener('change', e => {
      state.exportTileFilter = e.target.value;
      draw2DMap();
    });
  }

  document.getElementById('btnShowAllLayers').addEventListener('click', () => {
    Object.keys(state.layerVisible).forEach(k => { state.layerVisible[k] = true; });
    renderLayersUI();
    updateStatsUI();
  });

  document.getElementById('btnExport3MF').addEventListener('click', () => exportMultiColor3MF(state));
  document.getElementById('btnExportSTL').addEventListener('click', () => exportBinarySTL(state, 'all'));
  document.getElementById('btnExportLayerSTL').addEventListener('click', () => {
    const sel = document.getElementById('singleLayerStlSelect').value;
    exportBinarySTL(state, sel);
  });

  // Initialize UI & First Render
  renderPalettesUI();
  renderLayersUI();
  if (state.sceneData && state.sceneData.buildings && state.sceneData.buildings.length > 0) {
    const lukas = state.sceneData.buildings.find(b => b.name.includes('Lukas')) || state.sceneData.buildings[0];
    state.selectedBuildingId = lukas ? lukas.id : null;
  }
  draw2DMap();
  rebuildModel3D();

  window.addEventListener('resize', draw2DMap);

  // URL Query Parameter Hooks for Automated Multi-Angle & Multi-Location Inspection
  (async function applyUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
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
      const multi = params.get('multi');
      if (multi === '1' && state.sceneData && state.sceneData.buildings) {
        const blds = state.sceneData.buildings;
        const targets = blds.filter(b => b.name && (
          b.name.includes('Sandomierska') ||
          b.name.includes('Wawel') ||
          b.name.includes('Katedra') ||
          b.name.includes('Franciszkan') ||
          b.name.includes('Lukas') ||
          b.landmark
        ));
        const seenGids = new Set();
        const uniqueTargets = [];
        for (const t of targets) {
          const gid = t._groupId || t.id;
          if (!seenGids.has(gid)) {
            seenGids.add(gid);
            uniqueTargets.push(t);
            if (uniqueTargets.length >= 3) break;
          }
        }
        uniqueTargets.forEach((t, idx) => {
          handleSelectBuilding(t, idx > 0);
        });
        // Also highlight the first selected building group so both highlighted (gold/red) and multi-selected (blue) render together
        if (uniqueTargets.length > 0) {
          const gid0 = uniqueTargets[0]._groupId || uniqueTargets[0].id;
          const members0 = state.groupIdMap.get(gid0) || blds.filter(x => x.id === gid0 || x._groupId === gid0);
          members0.forEach(m => { m.highlighted = true; });
          rebuildModel3D();
        }
      }
      const printerParam = params.get('printer');
      if (printerParam && PRINT_PROFILES[printerParam]) {
        const pSel = document.getElementById('printerSelect');
        if (pSel) pSel.value = printerParam;
        applyPrinterProfile(printerParam);
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
      const cam = params.get('cam');
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
        explodeSlider.value = 70;
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
    } catch (e) {
      console.warn('URL param error:', e);
    }
  })();

  function animate() {
    if (state.autoRotate) {
      studio.camera.yaw += 0.004;
    }
    studio.render();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
