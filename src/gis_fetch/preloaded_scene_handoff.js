// ============================================================================
// src/gis_fetch/preloaded_scene_handoff.js
// Zero-Copy Preloaded GIS -> Scene Handoff, File-URI Guard & DEM Fallback Scene
// Layer 4a (Depends on dem_terrarium_fetcher.js, osm_element_merger.js, osm_scene_builder.js)
// ============================================================================

(function (root) {
  function _deps() {
    let demMod = typeof setDemPreloadedOverride === 'function' ? { setDemPreloadedOverride } : null;
    let merger = typeof filterPrintableBuildingsForScale === 'function' ? { filterPrintableBuildingsForScale } : null;
    if (typeof require === 'function') {
      if (!demMod) demMod = require('./dem_terrarium_fetcher.js');
      if (!merger) merger = require('./osm_element_merger.js');
    }
    return { demMod, merger };
  }

  function _resolveSceneBuilderFn() {
    if (typeof fetchRealGISInBrowser === 'function') return fetchRealGISInBrowser;
    if (typeof window !== 'undefined' && typeof window.fetchRealGISInBrowser === 'function') return window.fetchRealGISInBrowser;
    if (typeof require === 'function') return require('../gis_client/osm_scene_builder.js').fetchRealGISInBrowser;
    throw new Error('fetchRealGISInBrowser unavailable');
  }

  if (typeof window !== 'undefined' && window.fetch && !window.__map3dFileProtocolGuardInstalled) {
    window.__map3dFileProtocolGuardInstalled = true;
    const _savedFetch = (typeof _origWindowFetch === 'function') ? _origWindowFetch : window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url = typeof input === 'string'
        ? input
        : (input && typeof input.url === 'string' ? input.url : (input && typeof input.href === 'string' ? input.href : ''));
      const isHttp = !!(typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol));
      if (!isHttp && (url.startsWith('/') || url.startsWith('cache/') || url.startsWith('./') || url.startsWith('file:'))) {
        return {
          ok: false,
          status: 404,
          statusText: 'File URI scheme does not support relative server fetch',
          json: async () => ({ error: 'File URI protocol' }),
          text: async () => 'File URI protocol',
        };
      }
      return _savedFetch(input, init);
    };
  }

  // Zero-copy direct preloaded handoff (eliminates legacy JSON.stringify + JSON.parse round-trip)
  async function buildSceneFromPreloadedGis(south, west, north, east, title, dem, osmElements, maxBuildings = Infinity, sceneOptions = {}) {
    const { demMod, merger } = _deps();
    const buildFn = _resolveSceneBuilderFn();
    const prevDem = demMod && typeof demMod.setDemPreloadedOverride === 'function'
      ? demMod.setDemPreloadedOverride(dem)
      : null;
    try {
      const directOptions = {
        ...sceneOptions,
        _preloadedDem: dem,
        _preloadedOsmElements: osmElements,
        _alreadyDeduplicated: Boolean(sceneOptions && sceneOptions._alreadyDeduplicated),
      };
      const scene = await buildFn(south, west, north, east, title, directOptions);
      const filtered = merger.filterPrintableBuildingsForScale(scene, maxBuildings);
      if (filtered && filtered._priorityBedCheck) delete filtered._priorityBedCheck;
      return filtered;
    } finally {
      if (demMod && typeof demMod.setDemPreloadedOverride === 'function') {
        demMod.setDemPreloadedOverride(prevDem);
      }
    }
  }

  function buildTerrainOnlyFallbackScene(title, centerLat, centerLon, effectiveSpanM, halfM, dem) {
    const spanU = (typeof SCENE_CANONICAL_SPAN_UNITS !== 'undefined') ? SCENE_CANONICAL_SPAN_UNITS : 169.2;
    const mToU = spanU / Math.max(1, effectiveSpanM);
    return {
      title: `${title || 'TEREN'} (DEM)`,
      center: [centerLat, centerLon],
      spanMeters: Math.round(effectiveSpanM),
      metersToUnits: mToU,
      _demHalfUnits: Math.round((halfM * mToU) * 100) / 100,
      buildings: [],
      waterPolys: [],
      waterLines: [],
      greenPolys: [],
      trees: [],
      roads: [],
      roadPolys: [],
      bridgePolys: [],
      pierPolys: [],
      pierLines: [],
      bridgeSupports: [],
      dem,
      _fallback: true,
    };
  }

  const exportsObj = {
    buildSceneFromPreloadedGis,
    buildTerrainOnlyFallbackScene,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
