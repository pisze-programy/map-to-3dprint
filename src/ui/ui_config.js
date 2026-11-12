// ============================================================================
// src/ui/ui_config.js
// Palettes, Layer Metadata, Global World Locations, Printer Profiles & Helpers
// ============================================================================

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
    name: 'Studio (4-Kolory)',
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
    name: 'Alpejski Relief Terakota',
    colors: {
      water: '#3898a6',
      base: '#e9d3b0',
      greenery: '#5a8f52',
      roads: '#f2ece1',
      buildings: '#d97757'
    }
  }
];

const LAYERS_META = [
  { key: 'water',       id: 0, name: '1. Woda i Batymetria (3 głębokości)', extruder: 'Kolor 1 (Błękit)',  zDesc: '0.0 – 2.3 mm' },
  { key: 'base',        id: 1, name: '2. Warstwice Terenu DEM (Nierówności)',extruder: 'Kolor 2 (Piasek)',  zDesc: '2.4 – 9.8 mm' },
  { key: 'greenery',    id: 2, name: '3A. Trawa, Parki i Lasy (Murawa)',     extruder: 'Kolor 3 (Zieleń)',  zDesc: '+0.3 – 1.0 mm' },
  { key: 'trees',       id: 2, name: '3B. Drzewa 3D (Korony i Pnie)',        extruder: 'Kolor 3 (Zieleń)',  zDesc: '+1.5 – 3.2 mm', isTree: true },
  { key: 'roads',       id: 3, name: '4A. Ulice, Aleje, Koleje i Mosty',    extruder: 'Kolor 4 (Kość sł.)',zDesc: '+0.4 – 2.2 mm' },
  { key: 'buildings',   id: 4, name: '4B. Budynki, Dziedzińce i Dachy LoD2',extruder: 'Kolor 4 (Biel)',    zDesc: '+1.5 – 28 mm' }
];

const WORLD_LOCATIONS = [
  { cat: 'mountains', title: 'ZERMATT', region: 'Alpy • Zermatt (Szwajcaria)', lat: 46.0207, lon: 7.7491 },
  { cat: 'mountains', title: 'CHAMONIX', region: 'Alpy • Chamonix-Mont-Blanc', lat: 45.9237, lon: 6.8694 },
  { cat: 'mountains', title: 'ZAKOPANE', region: 'Tatry • Zakopane (Polska)', lat: 49.2965, lon: 19.9510 },
  { cat: 'mountains', title: 'INNSBRUCK', region: 'Tyrol • Innsbruck & Inn', lat: 47.2685, lon: 11.3933 },
  { cat: 'mountains', title: 'INTERLAKEN', region: 'Alpy • Interlaken & Aare', lat: 46.6863, lon: 7.8632 },
  { cat: 'mountains', title: 'CORTINA', region: 'Dolomity • Cortina d’Ampezzo', lat: 46.5380, lon: 12.1370 },
  { cat: 'mountains', title: 'BANFF', region: 'Góry Skaliste • Banff (Kanada)', lat: 51.1760, lon: -115.5710 },
  { cat: 'mountains', title: 'QUEENSTOWN', region: 'Alpy Płd. • Queenstown (NZ)', lat: -45.0312, lon: 168.6626 },

  { cat: 'resorts', title: 'POSITANO', region: 'Wybrzeże Amalfi • Positano', lat: 40.6281, lon: 14.4850 },
  { cat: 'resorts', title: 'HALLSTATT', region: 'Alpy Salzburskie • Hallstatt', lat: 47.5622, lon: 13.6493 },
  { cat: 'resorts', title: 'DUBROVNIK', region: 'Adriatyk • Dubrownik', lat: 42.6410, lon: 18.1085 },
  { cat: 'resorts', title: 'MONACO', region: 'Riwiera • Monte Carlo', lat: 43.7347, lon: 7.4206 },
  { cat: 'resorts', title: 'SANTORINI', region: 'Cyklady • Fira (Kaldera)', lat: 36.4167, lon: 25.4328 },
  { cat: 'resorts', title: 'KOTOR', region: 'Boka Kotorska • Kotor', lat: 42.4247, lon: 18.7712 },
  { cat: 'resorts', title: 'COMO', region: 'Jezioro Como • Włochy', lat: 45.8112, lon: 9.0825 },
  { cat: 'resorts', title: 'SOPOT', region: 'Bałtyk • Sopot & Molo', lat: 54.4446, lon: 18.5686 },

  { cat: 'asia', title: 'TOKYO', region: 'Azja • Tokio (Sumida & Asakusa)', lat: 35.7118, lon: 139.8015 },
  { cat: 'asia', title: 'KYOTO', region: 'Azja • Kioto (Rzeka Kamo & Gion)', lat: 35.0037, lon: 135.7715 },
  { cat: 'asia', title: 'HONG KONG', region: 'Azja • Hongkong (Victoria Peak)', lat: 22.2795, lon: 114.1588 },
  { cat: 'asia', title: 'SINGAPORE', region: 'Azja • Singapur (Marina Bay)', lat: 1.2868, lon: 103.8545 },
  { cat: 'asia', title: 'SEOUL', region: 'Azja • Seul (Rzeka Han)', lat: 37.5285, lon: 126.9330 },
  { cat: 'asia', title: 'TAIPEI', region: 'Azja • Tajpej (Xinyi & 101)', lat: 25.0338, lon: 121.5645 },
  { cat: 'asia', title: 'YOKOHAMA', region: 'Azja • Jokohama (Minato Mirai)', lat: 35.4550, lon: 139.6360 },
  { cat: 'asia', title: 'BUSAN', region: 'Azja • Pusan (Haeundae)', lat: 35.1587, lon: 129.1520 },

  { cat: 'west_east', title: 'DUBAI', region: 'ZEA • Dubaj (Burj Khalifa & Downtown)', lat: 25.1923, lon: 55.2724 },
  { cat: 'west_east', title: 'MÜNCHEN', region: 'Europa • Monachium (Isar)', lat: 48.1338, lon: 11.5855 },
  { cat: 'west_east', title: 'KRAKÓW', region: 'Europa • Kraków (Wawel & Wisła)', lat: 50.0543, lon: 19.9365 },
  { cat: 'west_east', title: 'WARSZAWA', region: 'Europa • Warszawa (Skarpa & Wisła)', lat: 52.2470, lon: 21.0135 },
  { cat: 'west_east', title: 'HEIDELBERG', region: 'Europa • Heidelberg (Neckar)', lat: 49.4130, lon: 8.7085 },
  { cat: 'west_east', title: 'SAN FRANCISCO', region: 'USA • San Francisco (Telegraph Hill)', lat: 37.8024, lon: -122.4058 },
  { cat: 'west_east', title: 'NEW YORK', region: 'USA • Manhattan (Central Park South)', lat: 40.7664, lon: -73.9784 },
  { cat: 'west_east', title: 'RIO DE JANEIRO', region: 'Ameryka Płd. • Rio (Pão de Açúcar)', lat: -22.9486, lon: -43.1635 },
  { cat: 'west_east', title: 'SYDNEY', region: 'Australia • Sydney (Opera & Port)', lat: -33.8587, lon: 151.2140 },
  { cat: 'west_east', title: 'ISTANBUL', region: 'Turcja • Stambuł (Złoty Róg & Galata)', lat: 41.0256, lon: 28.9741 },
  { cat: 'west_east', title: 'PRAHA', region: 'Europa • Praga (Wełtawa & Most Karola)', lat: 50.0865, lon: 14.4114 },
  { cat: 'west_east', title: 'GDAŃSK', region: 'Europa • Gdańsk (Motława & Stare Miasto)', lat: 54.3503, lon: 18.6558 },
  { cat: 'west_east', title: 'BERN', region: 'Szwajcaria • Berno (Zakole Aare)', lat: 46.9480, lon: 7.4515 }
];

const PRINT_PROFILES = {
  mono4_75x84_1x1: {
    id: 'mono4_75x84_1x1',
    name: 'Anycubic Photon Mono 4 • 75×84 mm (1 Kafel 1×1)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 75, totalHeightMm: 84,
    cols: 1, rows: 1,
    isResin: true
  },
  mono4_150x168_2x2: {
    id: 'mono4_150x168_2x2',
    name: 'Anycubic Photon Mono 4 • 150×168 mm (4 Kafle 2×2 po 75×84 mm)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 150, totalHeightMm: 168,
    cols: 2, rows: 2,
    isResin: true
  },
  mono4_225x252_3x3: {
    id: 'mono4_225x252_3x3',
    name: 'Anycubic Photon Mono 4 • 225×252 mm (9 Kafli 3×3 po 75×84 mm)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 225, totalHeightMm: 252,
    cols: 3, rows: 3,
    isResin: true
  },
  mono4_150_1x2: {
    id: 'mono4_150_1x2',
    name: 'Anycubic Photon Mono 4 • 150×150 mm (2 Kafle 1×2 po 150×75 mm)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 150, totalHeightMm: 150,
    cols: 1, rows: 2,
    isResin: true
  },
  mono4_296_2x4: {
    id: 'mono4_296_2x4',
    name: 'Anycubic Photon Mono 4 • 296×296 mm (8 Kafli 2×4 po 148×74 mm)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 296, totalHeightMm: 296,
    cols: 2, rows: 4,
    isResin: true
  },
  mono4_custom: {
    id: 'mono4_custom',
    name: 'Anycubic Photon Mono 4 • Dowolny Format cm (Auto-Siatka)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 500, totalHeightMm: 500,
    cols: 4, rows: 6,
    isResin: true,
    isCustomMono4: true
  },
  fdm_330_1x1: {
    id: 'fdm_330_1x1',
    name: 'Prusa XL 5-Toolhead • 320×320 mm (1 Kafel 1×1)',
    printer: 'Prusa XL (360×360 mm)',
    bedX: 360.0, bedY: 360.0, bedZ: 360.0,
    totalWidthMm: 320, totalHeightMm: 320,
    cols: 1, rows: 1,
    isResin: false
  },
  fdm_256_1x1: {
    id: 'fdm_256_1x1',
    name: 'Bambu Lab X1C / P1S • 220×220 mm (stół 256mm + wieża AMS)',
    printer: 'Bambu Lab (256×256 mm)',
    bedX: 256.0, bedY: 256.0, bedZ: 256.0,
    totalWidthMm: 220, totalHeightMm: 220,
    cols: 1, rows: 1,
    isResin: false,
    hasAmsTower: true
  },
  fdm_350_1x1: {
    id: 'fdm_350_1x1',
    name: 'Voron 2.4 350 • 340×340 mm (1 Kafel 1×1)',
    printer: 'Voron 2.4 (350×350 mm)',
    bedX: 350.0, bedY: 350.0, bedZ: 350.0,
    totalWidthMm: 340, totalHeightMm: 340,
    cols: 1, rows: 1,
    isResin: false
  },
  fdm_500_2x2: {
    id: 'fdm_500_2x2',
    name: 'Format XL 4-Kafle FDM • 440×440 mm (2×2 po 220×220 mm)',
    printer: 'Bambu / Prusa (256×256 mm)',
    bedX: 256.0, bedY: 256.0, bedZ: 256.0,
    totalWidthMm: 440, totalHeightMm: 440,
    cols: 2, rows: 2,
    isResin: false,
    hasAmsTower: true
  }
};

// Backwards-compatible aliases for legacy 84mm Mono 4 profile IDs
PRINT_PROFILES.mono4_84_1x1 = PRINT_PROFILES.mono4_75x84_1x1;
PRINT_PROFILES.mono4_168_2x2 = PRINT_PROFILES.mono4_150x168_2x2;
PRINT_PROFILES.mono4_252_2x3 = PRINT_PROFILES.mono4_225x252_3x3;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function checkTileFitsMono4(tileWidthMm, tileHeightMm, maxZMm = 22.0) {
  const w = Number(tileWidthMm), h = Number(tileHeightMm), z = Number(maxZMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(z) || w <= 0 || h <= 0 || z <= 0) return false;
  const fits0 = (w <= 153.45 && h <= 87.05);
  const fits90 = (h <= 153.45 && w <= 87.05);
  return (fits0 || fits90) && z <= 165.0;
}

function checkTileDualPackableMono4(tileWidthMm, tileHeightMm) {
  const w = Number(tileWidthMm);
  const h = Number(tileHeightMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  return (w <= 75.45 && h <= 87.05) || (h <= 75.45 && w <= 87.05);
}

function computeOptimalMono4Grid(widthMm, heightMm, safeMaxW = 150.0, safeMaxH = 85.0, dualPack = false) {
  const effectiveMaxW = dualPack ? 75.0 : safeMaxW;
  const effectiveMaxH = dualPack ? 84.0 : safeMaxH;
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

function computeZHeightPairingSchedule(tiles, tileW = 75, tileH = 84) {
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

  const isDual = checkTileDualPackableMono4(tileW, tileH);
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

// ============================================================================
// Safe Event Delegation & Extension Event Guards
// ============================================================================
function safeClosest(target, selector) {
  if (!target || !selector || typeof selector !== 'string') return null;
  try {
    if (typeof target.closest === 'function') return target.closest(selector);
    const parent = target.parentElement || target.parentNode;
    if (parent && typeof parent.closest === 'function') return parent.closest(selector);
    return null;
  } catch (_) {
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.checkTileFitsMono4 = checkTileFitsMono4;
  window.checkTileDualPackableMono4 = checkTileDualPackableMono4;
  window.computeOptimalMono4Grid = computeOptimalMono4Grid;
  window.computeZHeightPairingSchedule = computeZHeightPairingSchedule;
  window.safeClosest = safeClosest;
  if (typeof Window !== 'undefined' && Window.prototype && !Window.prototype.closest) {
    Window.prototype.closest = function() { return null; };
  }
  if (typeof Document !== 'undefined' && Document.prototype && !Document.prototype.closest) {
    Document.prototype.closest = function() { return null; };
  }
  if (typeof Text !== 'undefined' && Text.prototype && !Text.prototype.closest) {
    Text.prototype.closest = function(selector) {
      return (this.parentElement && typeof this.parentElement.closest === 'function')
        ? this.parentElement.closest(selector)
        : (this.parentNode && typeof this.parentNode.closest === 'function')
          ? this.parentNode.closest(selector)
          : null;
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PALETTES, LAYERS_META, WORLD_LOCATIONS, PRINT_PROFILES, escapeHtml,
    checkTileFitsMono4, checkTileDualPackableMono4, computeOptimalMono4Grid, computeZHeightPairingSchedule, safeClosest
  };
}
