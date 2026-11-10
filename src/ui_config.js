// ============================================================================
// src/ui_config.js
// Palettes, Layer Metadata, Global World Locations, Printer Profiles & Helpers
// ============================================================================

const PALETTES = [
  {
    id: 'lichtbild_studio',
    name: 'Lichtbild Studio (4-Kolory)',
    colors: {
      water: '#82c2e6',
      base: '#e8be8c',
      greenery: '#488e52',
      roads: '#f4f3ef',
      buildings: '#faf9f5',
      highlighted: '#f59e0b'
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
      buildings: '#ffffff',
      highlighted: '#d4af37'
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
      buildings: '#e5e7eb',
      highlighted: '#f59e0b'
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
      buildings: '#d97757',
      highlighted: '#2563eb'
    }
  }
];

const LAYERS_META = [
  { key: 'water',       id: 0, name: '1. Woda i Batymetria (3 głębokości)', extruder: 'Kolor 1 (Błękit)',  zDesc: '0.0 – 2.3 mm' },
  { key: 'base',        id: 1, name: '2. Warstwice Terenu DEM (Nierówności)',extruder: 'Kolor 2 (Piasek)',  zDesc: '2.4 – 9.8 mm' },
  { key: 'greenery',    id: 2, name: '3. Trawa, Parki, Lasy i Drzewa 3D',   extruder: 'Kolor 3 (Zieleń)',  zDesc: '+0.3 – 3.0 mm' },
  { key: 'roads',       id: 3, name: '4A. Ulice, Aleje, Koleje i Mosty',    extruder: 'Kolor 4 (Kość sł.)',zDesc: '+0.4 – 2.2 mm' },
  { key: 'buildings',   id: 4, name: '4B. Budynki, Dziedzińce i Dachy LoD2',extruder: 'Kolor 4 (Biel)',    zDesc: '+1.5 – 28 mm' },
  { key: 'highlighted', id: 5, name: '5. Wyróżnione Budynki ★ (Opcja)',     extruder: 'Kolor 5 (Akcent)',  zDesc: 'Wyróżnienie' }
];

// Global Pool of Diverse Real-World Locations for Universal Testing
const WORLD_LOCATIONS = [
  // Mountains & Alpine Valleys
  { cat: 'mountains', title: 'ZERMATT', region: 'Alpy • Zermatt (Szwajcaria)', lat: 46.0207, lon: 7.7491 },
  { cat: 'mountains', title: 'CHAMONIX', region: 'Alpy • Chamonix-Mont-Blanc', lat: 45.9237, lon: 6.8694 },
  { cat: 'mountains', title: 'ZAKOPANE', region: 'Tatry • Zakopane (Polska)', lat: 49.2965, lon: 19.9510 },
  { cat: 'mountains', title: 'INNSBRUCK', region: 'Tyrol • Innsbruck & Inn', lat: 47.2685, lon: 11.3933 },
  { cat: 'mountains', title: 'INTERLAKEN', region: 'Alpy • Interlaken & Aare', lat: 46.6863, lon: 7.8632 },
  { cat: 'mountains', title: 'CORTINA', region: 'Dolomity • Cortina d’Ampezzo', lat: 46.5380, lon: 12.1370 },
  { cat: 'mountains', title: 'BANFF', region: 'Góry Skaliste • Banff (Kanada)', lat: 51.1760, lon: -115.5710 },
  { cat: 'mountains', title: 'QUEENSTOWN', region: 'Alpy Płd. • Queenstown (NZ)', lat: -45.0312, lon: 168.6626 },

  // Coastal Resorts, Fjords & Lakes
  { cat: 'resorts', title: 'POSITANO', region: 'Wybrzeże Amalfi • Positano', lat: 40.6281, lon: 14.4850 },
  { cat: 'resorts', title: 'HALLSTATT', region: 'Alpy Salzburskie • Hallstatt', lat: 47.5622, lon: 13.6493 },
  { cat: 'resorts', title: 'DUBROVNIK', region: 'Adriatyk • Dubrownik', lat: 42.6410, lon: 18.1085 },
  { cat: 'resorts', title: 'MONACO', region: 'Riwiera • Monte Carlo', lat: 43.7347, lon: 7.4206 },
  { cat: 'resorts', title: 'SANTORINI', region: 'Cyklady • Fira (Kaldera)', lat: 36.4167, lon: 25.4328 },
  { cat: 'resorts', title: 'KOTOR', region: 'Boka Kotorska • Kotor', lat: 42.4247, lon: 18.7712 },
  { cat: 'resorts', title: 'COMO', region: 'Jezioro Como • Włochy', lat: 45.8112, lon: 9.0825 },
  { cat: 'resorts', title: 'SOPOT', region: 'Bałtyk • Sopot & Molo', lat: 54.4446, lon: 18.5686 },

  // Asia & East
  { cat: 'asia', title: 'TOKYO', region: 'Azja • Tokio (Sumida & Asakusa)', lat: 35.7118, lon: 139.8015 },
  { cat: 'asia', title: 'KYOTO', region: 'Azja • Kioto (Rzeka Kamo & Gion)', lat: 35.0037, lon: 135.7715 },
  { cat: 'asia', title: 'HONG KONG', region: 'Azja • Hongkong (Victoria Peak)', lat: 22.2795, lon: 114.1588 },
  { cat: 'asia', title: 'SINGAPORE', region: 'Azja • Singapur (Marina Bay)', lat: 1.2868, lon: 103.8545 },
  { cat: 'asia', title: 'SEOUL', region: 'Azja • Seul (Rzeka Han)', lat: 37.5285, lon: 126.9330 },
  { cat: 'asia', title: 'TAIPEI', region: 'Azja • Tajpej (Xinyi & 101)', lat: 25.0338, lon: 121.5645 },
  { cat: 'asia', title: 'YOKOHAMA', region: 'Azja • Jokohama (Minato Mirai)', lat: 35.4550, lon: 139.6360 },
  { cat: 'asia', title: 'BUSAN', region: 'Azja • Pusan (Haeundae)', lat: 35.1587, lon: 129.1520 },

  // East & West Metropolises & River Cities
  { cat: 'west_east', title: 'MÜNCHEN', region: 'Europa • Monachium (Isar)', lat: 48.1338, lon: 11.5855 },
  { cat: 'west_east', title: 'KRAKÓW', region: 'Europa • Kraków (Wawel & Wisła)', lat: 50.0543, lon: 19.9365 },
  { cat: 'west_east', title: 'WARSZAWA', region: 'Europa • Warszawa (Skarpa & Wisła)', lat: 52.2470, lon: 21.0135 },
  { cat: 'west_east', title: 'HEIDELBERG', region: 'Europa • Heidelberg (Neckar)', lat: 49.4130, lon: 8.7085 },
  { cat: 'west_east', title: 'SAN FRANCISCO', region: 'USA • San Francisco (Telegraph Hill)', lat: 37.8024, lon: -122.4058 },
  { cat: 'west_east', title: 'NEW YORK', region: 'USA • Manhattan (Wall St & East River)', lat: 40.7061, lon: -74.0092 },
  { cat: 'west_east', title: 'RIO DE JANEIRO', region: 'Ameryka Płd. • Rio (Pão de Açúcar)', lat: -22.9486, lon: -43.1635 },
  { cat: 'west_east', title: 'SYDNEY', region: 'Australia • Sydney (Opera & Port)', lat: -33.8587, lon: 151.2140 },
  { cat: 'west_east', title: 'ISTANBUL', region: 'Turcja • Stambuł (Złoty Róg & Galata)', lat: 41.0256, lon: 28.9741 },
  { cat: 'west_east', title: 'PRAHA', region: 'Europa • Praga (Wełtawa & Most Karola)', lat: 50.0865, lon: 14.4114 },
  { cat: 'west_east', title: 'GDAŃSK', region: 'Europa • Gdańsk (Motława & Stare Miasto)', lat: 54.3503, lon: 18.6558 },
  { cat: 'west_east', title: 'BERN', region: 'Szwajcaria • Berno (Zakole Aare)', lat: 46.9480, lon: 7.4515 }
];

const PRINT_PROFILES = {
  mono4_84_1x1: {
    id: 'mono4_84_1x1',
    name: 'Anycubic Photon Mono 4 • 84×84 mm (1 Kafel 1×1)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 84, totalHeightMm: 84,
    cols: 1, rows: 1,
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
  mono4_168_2x2: {
    id: 'mono4_168_2x2',
    name: 'Anycubic Photon Mono 4 • 168×168 mm (4 Kafle 2×2 po 84×84 mm)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 168, totalHeightMm: 168,
    cols: 2, rows: 2,
    isResin: true
  },
  mono4_252_2x3: {
    id: 'mono4_252_2x3',
    name: 'Anycubic Photon Mono 4 • 252×252 mm (6 Kafli 2×3 po 126×84 mm)',
    printer: 'Anycubic Photon Mono 4 (153.4×87×165 mm)',
    bedX: 153.4, bedY: 87.0, bedZ: 165.0,
    totalWidthMm: 252, totalHeightMm: 252,
    cols: 2, rows: 3,
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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

