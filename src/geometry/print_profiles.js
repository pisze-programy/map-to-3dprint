// ============================================================================
// src/geometry/print_profiles.js
// Palettes, Layer Metadata, Global World Locations, Printer Profiles & Helpers
// ============================================================================

'use strict';

/** @typedef {{water: string, base: string, greenery: string, roads: string, buildings: string}} PaletteColors */
/** @typedef {{id: string, name: string, colors: PaletteColors}} PaletteEntry */

/** @type {PaletteEntry[]} */
const PALETTES = [
  {
    id: 'white',
    name: 'Pure Architectural White',
    colors: {
      water: '#f6f6f6',
      base: '#f4f5f7',
      greenery: '#f2f2f2',
      roads: '#fafafa',
      buildings: '#ffffff'
    }
  },
  {
    id: 'studio',
    name: 'Studio (4-Colors)',
    colors: {
      water: '#82c2e6',
      base: '#e8be8c',
      greenery: '#488e52',
      roads: '#f4f3ef',
      buildings: '#faf9f5'
    }
  },
  {
    id: 'classic_gold',
    name: 'Classic White & Gold',
    colors: {
      water: '#2b6cb0',
      base: '#e6dec8',
      greenery: '#689f63',
      roads: '#efede8',
      buildings: '#ffffff'
    }
  },
  {
    id: 'nordic_dark',
    name: 'Nordic Slate & Amber',
    colors: {
      water: '#1e3a5f',
      base: '#2b323c',
      greenery: '#2f5d46',
      roads: '#4b5563',
      buildings: '#e5e7eb'
    }
  },
  {
    id: 'alpine_relief',
    name: 'Alpine Relief Terracotta',
    colors: {
      water: '#3898a6',
      base: '#e9d3b0',
      greenery: '#5a8f52',
      roads: '#f2ece1',
      buildings: '#d97757'
    }
  }
];

/** @type {Array<{key: string, id: number, name: string, extruder: string, zDesc: string, isTree?: boolean}>} */
const LAYERS_META = [
  { key: 'water',     id: 0, name: '1. Water and Bathymetry (3 depths)',      extruder: 'Color 1 (Blue)',   zDesc: '0.0 - 2.3 mm' },
  { key: 'base',      id: 1, name: '2. DEM Terrain Contours',                 extruder: 'Color 2 (Sand)',   zDesc: '2.4 - 9.8 mm' },
  { key: 'greenery',  id: 2, name: '3A. Grass, Parks and Forests',            extruder: 'Color 3 (Green)',  zDesc: '+0.3 - 1.0 mm' },
  { key: 'trees',     id: 2, name: '3B. 3D Trees (Canopies and Trunks)',      extruder: 'Color 3 (Green)',  zDesc: '+1.5 - 3.2 mm', isTree: true },
  { key: 'roads',     id: 3, name: '4A. Streets, Railways and Bridges',       extruder: 'Color 4 (Ivory)',  zDesc: '+0.4 - 2.2 mm' },
  { key: 'buildings', id: 4, name: '4B. Buildings, Courtyards and LoD2 Roofs', extruder: 'Color 4 (White)', zDesc: '+1.5 - 28 mm' }
];

/** @type {Array<{cat: string, title: string, region: string, lat: number, lon: number}>} */
const WORLD_LOCATIONS = [
  { cat: 'mountains', title: 'ZERMATT', region: 'Alps - Zermatt (Switzerland)', lat: 46.0207, lon: 7.7491 },
  { cat: 'mountains', title: 'CHAMONIX', region: 'Alps - Chamonix-Mont-Blanc', lat: 45.9237, lon: 6.8694 },
  { cat: 'mountains', title: 'ZAKOPANE', region: 'Tatras - Zakopane (Poland)', lat: 49.2965, lon: 19.9510 },
  { cat: 'mountains', title: 'INNSBRUCK', region: 'Tyrol - Innsbruck & Inn', lat: 47.2685, lon: 11.3933 },
  { cat: 'mountains', title: 'INTERLAKEN', region: 'Alps - Interlaken & Aare', lat: 46.6863, lon: 7.8632 },
  { cat: 'mountains', title: 'CORTINA', region: 'Dolomites - Cortina d Ampezzo', lat: 46.5380, lon: 12.1370 },
  { cat: 'mountains', title: 'BANFF', region: 'Rockies - Banff (Canada)', lat: 51.1760, lon: -115.5710 },
  { cat: 'mountains', title: 'QUEENSTOWN', region: 'Southern Alps - Queenstown (NZ)', lat: -45.0312, lon: 168.6626 },

  { cat: 'resorts', title: 'POSITANO', region: 'Amalfi Coast - Positano', lat: 40.6281, lon: 14.4850 },
  { cat: 'resorts', title: 'HALLSTATT', region: 'Salzkammergut - Hallstatt', lat: 47.5622, lon: 13.6493 },
  { cat: 'resorts', title: 'DUBROVNIK', region: 'Adriatic - Dubrovnik', lat: 42.6410, lon: 18.1085 },
  { cat: 'resorts', title: 'MONACO', region: 'Riviera - Monte Carlo', lat: 43.7347, lon: 7.4206 },
  { cat: 'resorts', title: 'SANTORINI', region: 'Cyclades - Fira (Caldera)', lat: 36.4167, lon: 25.4328 },
  { cat: 'resorts', title: 'KOTOR', region: 'Bay of Kotor - Kotor', lat: 42.4247, lon: 18.7712 },
  { cat: 'resorts', title: 'COMO', region: 'Lake Como - Italy', lat: 45.8112, lon: 9.0825 },
  { cat: 'resorts', title: 'SOPOT', region: 'Baltic - Sopot & Pier', lat: 54.4446, lon: 18.5686 },

  { cat: 'asia', title: 'TOKYO', region: 'Asia - Tokyo (Sumida & Asakusa)', lat: 35.7118, lon: 139.8015 },
  { cat: 'asia', title: 'KYOTO', region: 'Asia - Kyoto (Kamo River & Gion)', lat: 35.0037, lon: 135.7715 },
  { cat: 'asia', title: 'HONG KONG', region: 'Asia - Hong Kong (Victoria Peak)', lat: 22.2795, lon: 114.1588 },
  { cat: 'asia', title: 'SINGAPORE', region: 'Asia - Singapore (Marina Bay)', lat: 1.2868, lon: 103.8545 },
  { cat: 'asia', title: 'SEOUL', region: 'Asia - Seoul (Han River)', lat: 37.5285, lon: 126.9330 },
  { cat: 'asia', title: 'TAIPEI', region: 'Asia - Taipei (Xinyi & 101)', lat: 25.0338, lon: 121.5645 },
  { cat: 'asia', title: 'YOKOHAMA', region: 'Asia - Yokohama (Minato Mirai)', lat: 35.4550, lon: 139.6360 },
  { cat: 'asia', title: 'BUSAN', region: 'Asia - Busan (Haeundae)', lat: 35.1587, lon: 129.1520 },

  { cat: 'west_east', title: 'DUBAI', region: 'UAE - Dubai (Burj Khalifa & Downtown)', lat: 25.1923, lon: 55.2724 },
  { cat: 'west_east', title: 'MUNCHEN', region: 'Europe - Munich (Isar)', lat: 48.1338, lon: 11.5855 },
  { cat: 'west_east', title: 'KRAKOW', region: 'Europe - Krakow (Wawel & Vistula)', lat: 50.0543, lon: 19.9365 },
  { cat: 'west_east', title: 'WARSZAWA', region: 'Europe - Warsaw (Escarpment & Vistula)', lat: 52.2470, lon: 21.0135 },
  { cat: 'west_east', title: 'HEIDELBERG', region: 'Europe - Heidelberg (Neckar)', lat: 49.4130, lon: 8.7085 },
  { cat: 'west_east', title: 'SAN FRANCISCO', region: 'USA - San Francisco (Telegraph Hill)', lat: 37.8024, lon: -122.4058 },
  { cat: 'west_east', title: 'NEW YORK', region: 'USA - Manhattan (Central Park South)', lat: 40.7664, lon: -73.9784 },
  { cat: 'west_east', title: 'RIO DE JANEIRO', region: 'South America - Rio (Sugarloaf)', lat: -22.9486, lon: -43.1635 },
  { cat: 'west_east', title: 'SYDNEY', region: 'Australia - Sydney (Opera & Harbour)', lat: -33.8587, lon: 151.2140 },
  { cat: 'west_east', title: 'ISTANBUL', region: 'Turkey - Istanbul (Golden Horn & Galata)', lat: 41.0256, lon: 28.9741 },
  { cat: 'west_east', title: 'PRAHA', region: 'Europe - Prague (Vltava & Charles Bridge)', lat: 50.0865, lon: 14.4114 },
  { cat: 'west_east', title: 'GDANSK', region: 'Europe - Gdansk (Motlawa & Old Town)', lat: 54.3503, lon: 18.6558 },
  { cat: 'west_east', title: 'BERN', region: 'Switzerland - Bern (Aare Loop)', lat: 46.9480, lon: 7.4515 }
];

const _catalogModForProfiles = (typeof buildCatalogPrintProfiles === 'function')
  ? { buildCatalogPrintProfiles }
  : ((typeof require === 'function') ? require('./format_catalog.js') : null);

/** @type {Record<string, object>} */
const PRINT_PROFILES = (_catalogModForProfiles && typeof _catalogModForProfiles.buildCatalogPrintProfiles === 'function')
  ? _catalogModForProfiles.buildCatalogPrintProfiles()
  : {};

/**
 * Resolves any printer profile ID strictly to a valid Photon Mono 4 preset.
 * Legacy removed IDs fall back to 'mono4_custom'.
 * @param {string} profileId
 * @returns {string}
 */
function resolveMono4ProfileId(profileId) {
  if (typeof profileId === 'string') {
    const clean = profileId.trim();
    if (clean && Object.prototype.hasOwnProperty.call(PRINT_PROFILES, clean)) {
      return clean;
    }
  }
  return 'mono4_custom';
}

/**
 * Resolves the Photon Mono 4 bed safe area rectangle from state or defaults.
 * @param {object|null} state
 * @returns {{marginMm: number, bedXMm: number, bedYMm: number, maxWMm: number, maxHMm: number, dualMaxWMm: number, dualMaxHMm: number, dualGapMm: number}}
 */
function _mono4SafeArea(state) {
  if (typeof resolveMono4SafeArea === 'function') return resolveMono4SafeArea(state);
  if (typeof require === 'function') {
    try { return require('./print_physics_config.js').resolveMono4SafeArea(state); } catch (_) {}
  }
  const raw = state && Number(state.bedSafeMarginMm);
  const marginMm = Number.isFinite(raw) ? Math.min(10, Math.max(0, raw)) : 4.0;
  const maxWMm = 153.45 - 2 * marginMm;
  const maxHMm = 87.05 - 2 * marginMm;
  return { marginMm, bedXMm: 153.45, bedYMm: 87.05, maxWMm, maxHMm, dualMaxWMm: (maxWMm - 8.0) / 2, dualMaxHMm: maxHMm, dualGapMm: 8.0 };
}

/**
 * Returns true when the tile fits the Mono 4 plate inside the bed safe area.
 * @param {number} tileWidthMm
 * @param {number} tileHeightMm
 * @param {number} [maxZMm=22.0]
 * @param {object|null} [state=null]
 * @returns {boolean}
 */
function checkTileFitsMono4(tileWidthMm, tileHeightMm, maxZMm = 22.0, state = null) {
  const w = Number(tileWidthMm);
  const h = Number(tileHeightMm);
  const z = Number(maxZMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(z) || w <= 0 || h <= 0 || z <= 0) return false;
  const sa = _mono4SafeArea(state);
  const fits0 = (w <= sa.maxWMm + 1e-6 && h <= sa.maxHMm + 1e-6);
  const fits90 = (h <= sa.maxWMm + 1e-6 && w <= sa.maxHMm + 1e-6);
  return (fits0 || fits90) && z <= 165.0;
}

/**
 * Returns true when two tiles fit side by side on one plate inside the safe area with the FEP gap.
 * @param {number} tileWidthMm
 * @param {number} tileHeightMm
 * @param {object|null} [state=null]
 * @returns {boolean}
 */
function checkTileDualPackableMono4(tileWidthMm, tileHeightMm, state = null) {
  const w = Number(tileWidthMm);
  const h = Number(tileHeightMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  const sa = _mono4SafeArea(state);
  return (w <= sa.dualMaxWMm + 1e-6 && h <= sa.dualMaxHMm + 1e-6) || (h <= sa.dualMaxWMm + 1e-6 && w <= sa.dualMaxHMm + 1e-6);
}

/**
 * Computes the minimal tile grid fitting a plate within safe bed dimensions.
 * @param {number} widthMm
 * @param {number} heightMm
 * @param {number|null} [safeMaxW=null]
 * @param {number|null} [safeMaxH=null]
 * @param {boolean} [dualPack=false]
 * @returns {{cols: number, rows: number, tileW: number, tileH: number, rotated90: boolean, totalTiles: number}}
 */
function computeOptimalMono4Grid(widthMm, heightMm, safeMaxW = null, safeMaxH = null, dualPack = false) {
  const saDef = _mono4SafeArea(null);
  const maxW = Number.isFinite(Number(safeMaxW)) && safeMaxW !== null ? Number(safeMaxW) : saDef.maxWMm;
  const maxH = Number.isFinite(Number(safeMaxH)) && safeMaxH !== null ? Number(safeMaxH) : saDef.maxHMm;
  const effectiveMaxW = dualPack ? (maxW - saDef.dualGapMm) / 2 : maxW;
  const effectiveMaxH = maxH;
  const w = Math.max(10.0, Number(widthMm) || 200.0);
  const h = Math.max(10.0, Number(heightMm) || 200.0);

  let best = null;
  for (let cols = 1; cols <= 16; cols++) {
    const tileW = w / cols;
    for (let rows = 1; rows <= 16; rows++) {
      const tileH = h / rows;
      const fitsNormal = (tileW <= effectiveMaxW && tileH <= effectiveMaxH);
      const fitsRotated = (tileH <= effectiveMaxW && tileW <= effectiveMaxH);
      if (fitsNormal || fitsRotated) {
        const totalTiles = cols * rows;
        const rotated90 = !fitsNormal && fitsRotated;
        const marginNormal = fitsNormal ? Math.min(effectiveMaxW - tileW, effectiveMaxH - tileH) : -Infinity;
        const marginRotated = fitsRotated ? Math.min(effectiveMaxW - tileH, effectiveMaxH - tileW) : -Infinity;
        const bestMargin = Math.max(marginNormal, marginRotated);
        const aspect = tileW > tileH ? tileW / tileH : tileH / tileW;

        const candidate = {
          cols, rows,
          tileW: Math.round(tileW * 10) / 10,
          tileH: Math.round(tileH * 10) / 10,
          rotated90, totalTiles,
          margin: bestMargin, aspect
        };

        if (!best || candidate.totalTiles < best.totalTiles) {
          best = candidate;
        } else if (candidate.totalTiles === best.totalTiles) {
          if (Math.abs(candidate.aspect - 1.0) < Math.abs(best.aspect - 1.0) - 0.05) {
            best = candidate;
          } else if (Math.abs(candidate.aspect - best.aspect) <= 0.05 && candidate.margin > best.margin) {
            best = candidate;
          }
        }
      }
    }
  }

  if (!best) {
    const cols = Math.ceil(w / effectiveMaxW);
    const rows = Math.ceil(h / effectiveMaxH);
    return {
      cols, rows,
      tileW: Math.round((w / cols) * 10) / 10,
      tileH: Math.round((h / rows) * 10) / 10,
      rotated90: false,
      totalTiles: cols * rows
    };
  }

  return {
    cols: best.cols,
    rows: best.rows,
    tileW: best.tileW,
    tileH: best.tileH,
    rotated90: best.rotated90,
    totalTiles: best.totalTiles
  };
}

/**
 * Optimal Mono 4 tile grid for the bed safe area stored in state.
 * @param {object|null} state
 * @param {number} widthMm
 * @param {number} heightMm
 * @returns {{cols: number, rows: number, tileW: number, tileH: number, rotated90: boolean, totalTiles: number}}
 */
function computeOptimalMono4GridForState(state, widthMm, heightMm) {
  const sa = _mono4SafeArea(state);
  return computeOptimalMono4Grid(widthMm, heightMm, sa.maxWMm, sa.maxHMm, false);
}

/**
 * Resolves the grid for a fixed-size preset while enforcing safe bed area limits.
 * @param {object|null} prof
 * @param {object|null} state
 * @returns {{cols: number, rows: number}}
 */
function resolveMono4ProfileGrid(prof, state) {
  const w = Number(prof && prof.totalWidthMm) || 150;
  const h = Number(prof && prof.totalHeightMm) || 150;
  const cols = Math.max(1, Number(prof && prof.cols) || 1);
  const rows = Math.max(1, Number(prof && prof.rows) || 1);
  const effectiveState = (state && typeof state.bedSafeMarginMm === 'number' && Number.isFinite(state.bedSafeMarginMm))
    ? state
    : ((prof && typeof prof.bedSafeMarginMm === 'number' && Number.isFinite(prof.bedSafeMarginMm))
        ? { bedSafeMarginMm: prof.bedSafeMarginMm }
        : state);
  if (checkTileFitsMono4(w / cols, h / rows, 22.0, effectiveState)) return { cols, rows };
  const opt = computeOptimalMono4GridForState(effectiveState, w, h);
  return { cols: opt.cols, rows: opt.rows };
}

/**
 * Computes a Z-height paired batch schedule for Photon Mono 4 plates.
 * @param {Array<object>} tiles
 * @param {number} [tileW=75]
 * @param {number} [tileH=84]
 * @param {object|null} [state=null]
 * @returns {{runs: Array<object>, numTiles: number, totalRuns: number, singleRuns: number, isDualPackable: boolean, sequentialSumZMm: number, pairedSumZMm: number, savedZMm: number, savingsPct: number}}
 */
function computeZHeightPairingSchedule(tiles, tileW = 75, tileH = 84, state = null) {
  if (!tiles || tiles.length === 0) {
    return {
      runs: [],
      numTiles: 0,
      totalRuns: 0,
      singleRuns: 0,
      isDualPackable: false,
      sequentialSumZMm: 0,
      pairedSumZMm: 0,
      savedZMm: 0,
      savingsPct: 0
    };
  }

  const isDual = checkTileDualPackableMono4(tileW, tileH, state);
  const tileList = tiles.map((t, idx) => ({
    ...t,
    index: idx + 1,
    maxZ: Number(t.maxZ) || 20.0,
    volMl: Number(t.volMl) || 0
  }));

  const sorted = [...tileList].sort((a, b) => b.maxZ - a.maxZ);
  const runs = [];

  if (isDual) {
    for (let i = 0; i < sorted.length; i += 2) {
      const t1 = sorted[i];
      const t2 = sorted[i + 1] || null;
      const runZ = t2 ? Math.max(t1.maxZ, t2.maxZ) : t1.maxZ;
      const runVol = (t1.volMl || 0) + (t2 ? (t2.volMl || 0) : 0);
      runs.push({
        runIndex: runs.length + 1,
        tiles: t2 ? [t1, t2] : [t1],
        runMaxZ: runZ,
        totalVolMl: runVol,
        paired: !!t2
      });
    }
  } else {
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      runs.push({
        runIndex: runs.length + 1,
        tiles: [t],
        runMaxZ: t.maxZ,
        totalVolMl: t.volMl || 0,
        paired: false
      });
    }
  }

  const sequentialSumZMm = sorted.reduce((sum, t) => sum + t.maxZ, 0);
  const pairedSumZMm = runs.reduce((sum, r) => sum + r.runMaxZ, 0);
  const savedZMm = Math.max(0, sequentialSumZMm - pairedSumZMm);
  const savingsPct = sequentialSumZMm > 0 ? Math.round((savedZMm / sequentialSumZMm) * 100) : 0;

  return {
    runs,
    numTiles: tileList.length,
    totalRuns: runs.length,
    singleRuns: tileList.length,
    isDualPackable: isDual,
    sequentialSumZMm: Math.round(sequentialSumZMm * 10) / 10,
    pairedSumZMm: Math.round(pairedSumZMm * 10) / 10,
    savedZMm: Math.round(savedZMm * 10) / 10,
    savingsPct
  };
}

if (typeof globalThis !== 'undefined') {
  globalThis.PALETTES = PALETTES;
  globalThis.LAYERS_META = LAYERS_META;
  globalThis.WORLD_LOCATIONS = WORLD_LOCATIONS;
  globalThis.PRINT_PROFILES = PRINT_PROFILES;
  globalThis.resolveMono4ProfileId = resolveMono4ProfileId;
  globalThis.checkTileFitsMono4 = checkTileFitsMono4;
  globalThis.checkTileDualPackableMono4 = checkTileDualPackableMono4;
  globalThis.computeOptimalMono4Grid = computeOptimalMono4Grid;
  globalThis.computeOptimalMono4GridForState = computeOptimalMono4GridForState;
  globalThis.resolveMono4ProfileGrid = resolveMono4ProfileGrid;
  globalThis.computeZHeightPairingSchedule = computeZHeightPairingSchedule;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PALETTES,
    LAYERS_META,
    WORLD_LOCATIONS,
    PRINT_PROFILES,
    resolveMono4ProfileId,
    checkTileFitsMono4,
    checkTileDualPackableMono4,
    computeOptimalMono4Grid,
    computeOptimalMono4GridForState,
    resolveMono4ProfileGrid,
    computeZHeightPairingSchedule
  };
}
