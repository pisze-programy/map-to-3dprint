// ============================================================================
// src/ui_app.js
// Hardened Interactive World Map Selector (CartoDB Voyager Slippy Tiles + Zoom/Pan),
// Live Place Autocomplete (Photon Komoot API - zero 403 blocks),
// Universal World Randomizer (Mountains, Resorts, Asia, East/West),
// Dual Live GIS Fetcher (Local Server + Direct In-Browser Overpass/Terrarium DEM),
// Multi-Selection (Shift+Click) Building Inspector & WebGL Controller
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
    name: 'Bambu Lab X1C / P1S • 246×246 mm (1 Kafel 1×1)',
    printer: 'Bambu Lab (256×256 mm)',
    bedX: 256.0, bedY: 256.0, bedZ: 256.0,
    totalWidthMm: 246, totalHeightMm: 246,
    cols: 1, rows: 1,
    isResin: false
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
    name: 'Format XL 4-Kafle FDM • 492×492 mm (2×2 po 246×246 mm)',
    printer: 'Bambu / Prusa (256×256 mm)',
    bedX: 256.0, bedY: 256.0, bedZ: 256.0,
    totalWidthMm: 492, totalHeightMm: 492,
    cols: 2, rows: 2,
    isResin: false
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

function initMap3DApp(initialScene) {
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
    hollowBase: false, // Fix B03: False by default on FDM (slicer generates infill); automatically enabled on SLA Resin profiles
    hollowWallMm: 1.8,
    exportTileFilter: 'all',
    printMetrics: null,
    cropRatio: 0.88,
    cropCenterX: 0.04,
    cropCenterY: 0.07,
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

  function lon2tileF(lon, z) {
    return ((lon + 180.0) / 360.0) * Math.pow(2, z);
  }
  function lat2tileF(lat, z) {
    const clampedLat = Math.max(-85.0, Math.min(85.0, lat));
    const rad = clampedLat * Math.PI / 180.0;
    return ((1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0) * Math.pow(2, z);
  }
  function tileF2lon(x, z) {
    return (x / Math.pow(2, z)) * 360.0 - 180.0;
  }
  function tileF2lat(y, z) {
    const n = Math.PI - (2.0 * Math.PI * y) / Math.pow(2, z);
    return (180.0 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function getSelectedBBoxLatLon() {
    // Always compute a ~1.25km x 1.25km physical print frame around (mapCenterLat, mapCenterLon)
    const cosLat = Math.max(0.2, Math.cos(state.mapCenterLat * Math.PI / 180.0));
    const dLat = 0.0058 * state.cropRatio / 0.88;
    const dLon = (0.0058 / cosLat) * state.cropRatio / 0.88;
    const south = state.mapCenterLat - dLat;
    const north = state.mapCenterLat + dLat;
    const west = state.mapCenterLon - dLon;
    const east = state.mapCenterLon + dLon;
    return [south, west, north, east];
  }

  function draw2DMap() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas2d.clientWidth || 360;
    const ch = canvas2d.clientHeight || 220;
    if (canvas2d.width !== Math.floor(cw * dpr) || canvas2d.height !== Math.floor(ch * dpr)) {
      canvas2d.width = Math.floor(cw * dpr);
      canvas2d.height = Math.floor(ch * dpr);
    }

    ctx2d.save();
    ctx2d.scale(dpr, dpr);

    ctx2d.fillStyle = '#dce6f0';
    ctx2d.fillRect(0, 0, cw, ch);

    // 1. Draw live CartoDB Voyager Slippy Map Tiles (zero OSM Referer blocks!)
    const z = Math.round(state.mapZoom);
    const nTiles = Math.pow(2, z);
    const centerTileX = lon2tileF(state.mapCenterLon, z);
    const centerTileY = lat2tileF(state.mapCenterLat, z);
    const tMinX = Math.floor(centerTileX - (cw / 512) - 1);
    const tMaxX = Math.floor(centerTileX + (cw / 512) + 1);
    const tMinY = Math.max(0, Math.floor(centerTileY - (ch / 512) - 1));
    const tMaxY = Math.min(nTiles - 1, Math.floor(centerTileY + (ch / 512) + 1));

    for (let tx = tMinX; tx <= tMaxX; tx++) {
      const wrappedTx = ((tx % nTiles) + nTiles) % nTiles;
      for (let ty = tMinY; ty <= tMaxY; ty++) {
        const key = `${z}/${wrappedTx}/${ty}`;
        if (!osmTileCache[key]) {
          const img = new Image();
          img.onload = () => { osmTileCache[key].loaded = true; draw2DMap(); };
          img.onerror = () => {
            if (!img._triedFallback) {
              img._triedFallback = true;
              const sub = ['a', 'b', 'c'][(wrappedTx + ty) % 3];
              img.src = `https://${sub}.tile.openstreetmap.fr/hot/${z}/${wrappedTx}/${ty}.png`;
            }
          };
          img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${ty}/${wrappedTx}`;
          osmTileCache[key] = { img, loaded: false };
        } else if (osmTileCache[key].loaded) {
          const sx = cw / 2 + (tx - centerTileX) * 256;
          const sy = ch / 2 + (ty - centerTileY) * 256;
          ctx2d.drawImage(osmTileCache[key].img, sx, sy, 256, 256);
        }
      }
    }

    // 2. Project loaded GIS vectors at their TRUE geographic coordinates (so panning moves them smoothly!)
    const scene = state.sceneData;
    if (scene && scene.center && z >= 12) {
      const scLat = scene.center[0];
      const scLon = scene.center[1];
      const mToU = scene.metersToUnits || 0.13;
      const cosLat = Math.max(0.2, Math.cos(scLat * Math.PI / 180.0));

      // Convert scene unit [x, y] -> [lat, lon] -> screen pixel [sx, sy]
      const toScreenGeo = (pt) => {
        const lon = scLon + (pt[0] / mToU) / (111320.0 * cosLat);
        const lat = scLat + (pt[1] / mToU) / 111320.0;
        const tx = lon2tileF(lon, z);
        const ty = lat2tileF(lat, z);
        return [cw / 2 + (tx - centerTileX) * 256.0, ch / 2 + (ty - centerTileY) * 256.0];
      };

      const [scCenterSx, scCenterSy] = toScreenGeo([0, 0]);
      if (Math.hypot(scCenterSx - cw / 2, scCenterSy - ch / 2) < Math.max(cw, ch) * 1.5) {
        // Subtle blue tint for loaded water/sea polygons on 2D map
        ctx2d.fillStyle = 'rgba(14, 165, 233, 0.24)';
        (scene.waterPolys || []).forEach(wp => {
          ctx2d.beginPath();
          wp.outer.forEach((p, i) => {
            const [sx, sy] = toScreenGeo(p);
            if (i === 0) ctx2d.moveTo(sx, sy); else ctx2d.lineTo(sx, sy);
          });
          ctx2d.closePath();
          ctx2d.fill();
        });

        // Highlighted / Selected buildings overlay on 2D map
        (scene.buildings || []).forEach(b => {
          if (b.hidden) return;
          const gid = b._groupId || b.id;
          const isSel = state.userClickedBuilding && (state.selectedBuildingIds.has(gid) || state.selectedBuildingId === gid);
          if (!isSel && !b.highlighted) return;
          ctx2d.fillStyle = b.highlighted ? 'rgba(245, 158, 11, 0.85)' : 'rgba(37, 99, 235, 0.85)';
          ctx2d.strokeStyle = '#ffffff';
          ctx2d.lineWidth = 1.0;
          ctx2d.beginPath();
          b.outer.forEach((p, i) => {
            const [sx, sy] = toScreenGeo(p);
            if (i === 0) ctx2d.moveTo(sx, sy); else ctx2d.lineTo(sx, sy);
          });
          ctx2d.closePath();
          ctx2d.fill();
          ctx2d.stroke();
        });
      }
    }

    // 3. Draw Blue Print Frame Bounding Box at current [south, west, north, east]
    const [south, west, north, east] = getSelectedBBoxLatLon();
    const bx0 = cw / 2 + (lon2tileF(west, z) - centerTileX) * 256.0;
    const bx1 = cw / 2 + (lon2tileF(east, z) - centerTileX) * 256.0;
    const by0 = ch / 2 + (lat2tileF(north, z) - centerTileY) * 256.0;
    const by1 = ch / 2 + (lat2tileF(south, z) - centerTileY) * 256.0;
    const bw = Math.max(16, bx1 - bx0);
    const bh = Math.max(16, by1 - by0);

    ctx2d.fillStyle = 'rgba(15, 23, 42, 0.32)';
    ctx2d.fillRect(0, 0, cw, Math.max(0, by0));
    ctx2d.fillRect(0, Math.min(ch, by0 + bh), cw, Math.max(0, ch - (by0 + bh)));
    ctx2d.fillRect(0, Math.max(0, by0), Math.max(0, bx0), Math.min(ch, bh));
    ctx2d.fillRect(Math.min(cw, bx0 + bw), Math.max(0, by0), Math.max(0, cw - (bx0 + bw)), Math.min(ch, bh));

    ctx2d.strokeStyle = '#2563eb';
    ctx2d.lineWidth = 2.2;
    ctx2d.strokeRect(bx0, by0, bw, bh);

    // Draw Multi-Tile Grid Split Overlay (e.g., 1x2, 2x2, 2x3, 2x4 for Anycubic Photon Mono 4)
    const tCols = state.tileCols || 1;
    const tRows = state.tileRows || 1;
    if (tCols > 1 || tRows > 1) {
      ctx2d.save();
      ctx2d.strokeStyle = 'rgba(6, 182, 212, 0.9)';
      ctx2d.lineWidth = 1.4;
      ctx2d.setLineDash([4, 3]);
      for (let c = 1; c < tCols; c++) {
        const sx = bx0 + (c / tCols) * bw;
        ctx2d.beginPath();
        ctx2d.moveTo(sx, by0);
        ctx2d.lineTo(sx, by0 + bh);
        ctx2d.stroke();
      }
      for (let r = 1; r < tRows; r++) {
        const sy = by0 + (r / tRows) * bh;
        ctx2d.beginPath();
        ctx2d.moveTo(bx0, sy);
        ctx2d.lineTo(bx0 + bw, sy);
        ctx2d.stroke();
      }
      ctx2d.setLineDash([]);
      ctx2d.font = 'bold 9px monospace';
      for (let r = 0; r < tRows; r++) {
        for (let c = 0; c < tCols; c++) {
          const tid = (tRows - 1 - r) * tCols + c;
          const tx = bx0 + (c / tCols) * bw;
          const ty = by0 + (r / tRows) * bh;
          const tw = bw / tCols;
          const th = bh / tRows;
          if (state.exportTileFilter !== 'all' && parseInt(state.exportTileFilter, 10) === tid) {
            ctx2d.fillStyle = 'rgba(6, 182, 212, 0.25)';
            ctx2d.fillRect(tx, ty, tw, th);
          }
          ctx2d.fillStyle = 'rgba(15, 23, 42, 0.72)';
          ctx2d.fillRect(tx + 3, ty + 3, 28, 12);
          ctx2d.fillStyle = '#38bdf8';
          // Fix B34: R1 is always the northernmost (top) row on the 2D map and in exported .STL/.ZIP files
          ctx2d.fillText(`R${r + 1}C${c + 1}`, tx + 5, ty + 12);
        }
      }
      ctx2d.restore();
    }

    // Crosshair in center of frame
    ctx2d.strokeStyle = 'rgba(37, 99, 235, 0.65)';
    ctx2d.lineWidth = 1.0;
    ctx2d.beginPath();
    ctx2d.moveTo(cw / 2 - 6, ch / 2); ctx2d.lineTo(cw / 2 + 6, ch / 2);
    ctx2d.moveTo(cw / 2, ch / 2 - 6); ctx2d.lineTo(cw / 2, ch / 2 + 6);
    ctx2d.stroke();

    const pill = document.getElementById('mapStatusPill');
    if (pill) {
      pill.textContent = `N ${south.toFixed(4)}°..${north.toFixed(4)}° • E ${west.toFixed(4)}°..${east.toFixed(4)}°`;
    }

    ctx2d.restore();
  }

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
  // IN-BROWSER FALLBACK GIS PIPELINE (AWS TERRARIUM DEM + OVERPASS QL)
  // ==========================================================================
  async function fetchTerrariumDemInBrowser(south, west, north, east, gridSize = 64, zoom = 14) {
    const xMinF = lon2tileF(west, zoom);
    const xMaxF = lon2tileF(east, zoom);
    const yMinF = lat2tileF(north, zoom);
    const yMaxF = lat2tileF(south, zoom);
    const tx0 = Math.floor(xMinF), tx1 = Math.floor(xMaxF);
    const ty0 = Math.floor(yMinF), ty1 = Math.floor(yMaxF);

    const tilePixels = {};
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 256;
    offCanvas.height = 256;
    const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

    const promises = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        promises.push(new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            offCtx.clearRect(0, 0, 256, 256);
            offCtx.drawImage(img, 0, 0, 256, 256);
            tilePixels[`${tx}_${ty}`] = offCtx.getImageData(0, 0, 256, 256).data;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
        }));
      }
    }
    await Promise.all(promises);

    const grid = [];
    let minElev = Infinity, maxElev = -Infinity;
    for (let gy = 0; gy < gridSize; gy++) {
      const lat = south + (gy / (gridSize - 1)) * (north - south);
      const row = [];
      for (let gx = 0; gx < gridSize; gx++) {
        const lon = west + (gx / (gridSize - 1)) * (east - west);
        const xf = lon2tileF(lon, zoom), yf = lat2tileF(lat, zoom);
        const tx = Math.floor(xf), ty = Math.floor(yf);
        const px = Math.min(255, Math.max(0, Math.floor((xf - tx) * 256)));
        const py = Math.min(255, Math.max(0, Math.floor((yf - ty) * 256)));
        const data = tilePixels[`${tx}_${ty}`];
        let elev = 0;
        if (data) {
          const idx = (py * 256 + px) * 4;
          elev = (data[idx] * 256.0 + data[idx + 1] + data[idx + 2] / 256.0) - 32768.0;
        }
        row.push(Math.round(elev * 100) / 100);
        if (elev < minElev) minElev = elev;
        if (elev > maxElev) maxElev = elev;
      }
      grid.push(row);
    }
    if (!isFinite(minElev)) { minElev = 0; maxElev = 15; }
    return { gridSize, minElev, maxElev, grid };
  }

  async function fetchRealGISInBrowser(south, west, north, east, title) {
    const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
    const nbbox = `${(south - 0.004).toFixed(5)},${(west - 0.005).toFixed(5)},${(north + 0.004).toFixed(5)},${(east + 0.005).toFixed(5)}`;
    // Fix B05: Include multipolygon relations for courtyard buildings, riverbanks, and parks
    const query = `[out:json][timeout:30][bbox:${bbox}];(way["building"];relation["building"];way["building:part"];relation["building:part"];way["natural"];relation["natural"="water"];way["waterway"];relation["waterway"="riverbank"];way["landuse"];way["leisure"];relation["leisure"="park"];node["natural"="tree"];way["highway"];way["railway"];way["man_made"="bridge"];);out body qt;>;out skel qt;`;

    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ];

    const demPromise = fetchTerrariumDemInBrowser(south, west, north, east, 64, 14);
    const osmPromise = Promise.any(endpoints.map(async (ep) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 36000);
      try {
        const r = await fetch(ep, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          signal: ctrl.signal
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!j.elements) throw new Error('No elements');
        return j;
      } finally {
        clearTimeout(timer);
      }
    }));

    const [dem, osmRaw] = await Promise.all([demPromise, osmPromise]);

    const centerLat = (south + north) * 0.5;
    const centerLon = (west + east) * 0.5;
    const cosLat = Math.cos(centerLat * Math.PI / 180.0);
    const spanLatM = (north - south) * 111320.0;
    const spanLonM = (east - west) * 111320.0 * cosLat;
    const spanM = Math.max(spanLatM, spanLonM);
    const metersToUnits = 170.0 / spanM;

    const project = (lon, lat) => [
      Math.round((lon - centerLon) * 111320.0 * cosLat * metersToUnits * 100) / 100,
      Math.round((lat - centerLat) * 111320.0 * metersToUnits * 100) / 100
    ];

    const nodes = new Map();
    const ways = new Map();
    const relations = [];
    const trees = [];

    for (const el of (osmRaw.elements || [])) {
      if (el.type === 'node') {
        const pt = project(el.lon, el.lat);
        nodes.set(el.id, pt);
        if (el.tags && el.tags.natural === 'tree' && Math.abs(pt[0]) <= 85 && Math.abs(pt[1]) <= 85) {
          trees.push([pt[0], pt[1], 12.0]);
        }
      } else if (el.type === 'way') {
        ways.set(el.id, el);
      } else if (el.type === 'relation') {
        relations.push(el);
      }
    }

    const nodesToPts = (nids) => (nids || []).map(id => nodes.get(id)).filter(Boolean);
    const waterPolys = [], waterLines = [], greenPolys = [], roads = [], buildings = [];
    const usedWays = new Set();

    function pushBuilding(osmId, tags, outer, holes) {
      if (outer.length < 3) return;
      let sx = 0, sy = 0;
      outer.forEach(p => { sx += p[0]; sy += p[1]; });
      const cx = sx / outer.length, cy = sy / outer.length;
      if (Math.abs(cx) > 88 || Math.abs(cy) > 88) return;
      const btype = tags.building || tags['building:part'] || 'yes';
      const isPart = ('building:part' in tags) && !('building' in tags);
      const levels = parseFloat(tags['building:levels']) || null;
      let h = parseFloat(tags.height) || (levels ? levels * 3.6 + (isPart ? 0 : 3.5) : 16.5);
      const name = tags.name || (tags['addr:street'] ? `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim() : `Budynek OSM #${osmId}`);
      buildings.push({
        id: buildings.length + 1,
        osmId,
        name,
        btype,
        cx: Math.round(cx * 100) / 100,
        cy: Math.round(cy * 100) / 100,
        outer,
        holes,
        h: Math.round(h * 10) / 10,
        minH: 0,
        levels: Math.max(1, Math.round(h / 3.5)),
        roof: tags['roof:shape'] || 'hipped',
        roofH: Math.min(6.5, Math.max(2.6, h * 0.22)),
        part: isPart,
        church: btype === 'church' || btype === 'cathedral',
        tower: btype === 'tower' || tags['man_made'] === 'tower',
        landmark: Boolean(tags.name || tags.wikidata || tags.heritage)
      });
    }

    for (const rel of relations) {
      const tags = rel.tags || {};
      const outers = [], inners = [];
      for (const m of (rel.members || [])) {
        if (m.type === 'way' && ways.has(m.ref)) {
          const pts = nodesToPts(ways.get(m.ref).nodes);
          if (pts.length >= 3) {
            if (m.role === 'inner') inners.push(pts);
            else { outers.push(pts); usedWays.add(m.ref); }
          }
        }
      }
      if (!outers.length) continue;
      if (tags.natural === 'water' || tags.waterway === 'riverbank') {
        outers.forEach(op => waterPolys.push({ outer: op, holes: inners, name: tags.name || 'Woda' }));
      } else if (tags.building || tags['building:part']) {
        outers.forEach(op => pushBuilding(rel.id, tags, op, inners));
      } else if (tags.leisure || tags.landuse || tags.natural === 'wood') {
        outers.forEach(op => greenPolys.push({ outer: op, holes: inners, type: tags.leisure || tags.landuse || 'park' }));
      }
    }

    const coastWays = [];
    for (const [wid, w] of ways.entries()) {
      const tags = w.tags || {};
      const nids = w.nodes || [];
      if (nids.length < 2) continue;
      const isClosed = nids[0] === nids[nids.length - 1] && nids.length >= 4;
      const pts = nodesToPts(nids);
      if (pts.length < 2) continue;

      if (tags.natural === 'coastline') {
        coastWays.push(pts);
        continue;
      }
      if (['pier', 'breakwater', 'groyne'].includes(tags.man_made) && isClosed && pts.length >= 3) {
        pushBuilding(wid, { ...tags, building: 'pier', height: '3.5', 'roof:shape': 'flat', name: tags.name || `Molo #${wid}` }, pts, []);
        continue;
      }
      if ((tags.building || tags['building:part']) && isClosed) {
        if (!usedWays.has(wid) || tags['building:part']) pushBuilding(wid, tags, pts, []);
        continue;
      }
      if ((tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin') && isClosed) {
        if (!usedWays.has(wid)) waterPolys.push({ outer: pts, holes: [], name: tags.name || 'Woda' });
        continue;
      }
      if (tags.waterway && ['river', 'canal', 'stream', 'dock'].includes(tags.waterway) && tags.tunnel !== 'yes') {
        const wm = parseFloat(tags.width) || (tags.waterway === 'river' ? 18 : 8);
        waterLines.push({ pts, width: Math.max(0.8, wm * metersToUnits), name: tags.name || tags.waterway });
        continue;
      }
      if ((tags.leisure || tags.landuse || ['wood', 'scrub', 'grassland'].includes(tags.natural)) && isClosed) {
        if (!usedWays.has(wid) && !['residential', 'industrial', 'commercial', 'retail'].includes(tags.landuse)) {
          greenPolys.push({ outer: pts, holes: [], type: tags.leisure || tags.landuse || tags.natural });
        }
        continue;
      }
      if (tags.highway || tags.railway || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made)) {
        if (tags.tunnel === 'yes' || (parseFloat(tags.layer) < 0)) continue;
        const hwy = tags.highway || tags.railway || tags.man_made || 'bridge';
        const isBridge = tags.bridge === 'yes' || tags.bridge === 'viaduct' || ['bridge', 'pier', 'breakwater', 'groyne'].includes(tags.man_made);
        if (['footway', 'path', 'steps', 'cycleway'].includes(hwy) && !isBridge) continue;
        const rwm = ['motorway', 'trunk', 'primary'].includes(hwy) ? 11.0 : ['secondary', 'tertiary'].includes(hwy) ? 8.5 : 6.2;
        roads.push({ pts, width: Math.max(0.55, rwm * metersToUnits), hwy, bridge: isBridge, name: tags.name || '' });
      }
    }

    // Stitch any natural=coastline ways into closed sea polygons (land on left, sea on right -> clockwise around box)
    if (coastWays.length > 0) {
      const chains = coastWays.map(c => c.slice());
      let merged = true;
      while (merged) {
        merged = false;
        for (let i = 0; i < chains.length && !merged; i++) {
          for (let j = 0; j < chains.length; j++) {
            if (i === j) continue;
            const endI = chains[i][chains[i].length - 1];
            const startJ = chains[j][0];
            if (Math.hypot(endI[0] - startJ[0], endI[1] - startJ[1]) < 0.8) {
              chains[i] = chains[i].concat(chains[j].slice(1));
              chains.splice(j, 1);
              merged = true;
              break;
            }
          }
        }
      }
      const R = 92.0;
      const rayBox = (pFrom, pTo) => {
        const dx = pTo[0] - pFrom[0], dy = pTo[1] - pFrom[1];
        let bestT = Infinity, bestPt = [Math.max(-R, Math.min(R, pTo[0])), Math.max(-R, Math.min(R, pTo[1]))];
        for (const ex of [-R, R]) {
          if (Math.abs(dx) > 1e-6) {
            const t = (ex - pFrom[0]) / dx, y = pFrom[1] + t * dy;
            if (t > 0 && y >= -R - 1e-2 && y <= R + 1e-2 && t < bestT) { bestT = t; bestPt = [ex, Math.max(-R, Math.min(R, y))]; }
          }
        }
        for (const ey of [-R, R]) {
          if (Math.abs(dy) > 1e-6) {
            const t = (ey - pFrom[1]) / dy, x = pFrom[0] + t * dx;
            if (t > 0 && x >= -R - 1e-2 && x <= R + 1e-2 && t < bestT) { bestT = t; bestPt = [Math.max(-R, Math.min(R, x)), ey]; }
          }
        }
        return bestPt;
      };
      const cwParam = (pt) => {
        const [x, y] = pt;
        if (Math.abs(y - R) < 0.05) return x + R;
        if (Math.abs(x - R) < 0.05) return 2 * R + (R - y);
        if (Math.abs(y + R) < 0.05) return 4 * R + (R - x);
        return 6 * R + (y + R);
      };
      const corners = [[2 * R, [R, R]], [4 * R, [R, -R]], [6 * R, [-R, -R]], [8 * R, [-R, R]]];
      for (const ch of chains) {
        if (ch.length < 2) continue;
        const pStart = rayBox(ch[1], ch[0]);
        const pEnd = rayBox(ch[ch.length - 2], ch[ch.length - 1]);
        const sEnd = cwParam(pEnd), sStart = cwParam(pStart);
        const span = ((sStart - sEnd) % (8 * R) + 8 * R) % (8 * R);
        const cwCorners = corners
          .map(c => [((c[0] - sEnd) % (8 * R) + 8 * R) % (8 * R), c[1]])
          .filter(c => c[0] > 0.05 && c[0] < span - 0.05)
          .sort((a, b) => a[0] - b[0])
          .map(c => c[1]);
        waterPolys.push({ outer: [pStart, ...ch, pEnd, ...cwCorners], holes: [], name: 'Morze / Zatoka' });
      }
    }

    // Add organic canopy trees in green polygons
    for (const gp of greenPolys) {
      const area = Math.abs(signedArea2D(gp.outer));
      if (area < 4) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      gp.outer.forEach(p => {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      });
      const count = Math.min(60, Math.floor(area * 0.16));
      for (let k = 0; k < count * 3 && trees.length < 1500; k++) {
        const px = minX + ((k * 0.6180339) % 1) * (maxX - minX);
        const py = minY + ((k * 0.3819660) % 1) * (maxY - minY);
        if (Math.abs(px) < 83 && Math.abs(py) < 83 && pointInPoly2D(px, py, gp.outer)) {
          trees.push([Math.round(px * 100) / 100, Math.round(py * 100) / 100, 12.0]);
        }
      }
    }

    return {
      bbox: [south, west, north, east],
      center: [centerLat, centerLon],
      spanMeters: Math.round(spanM),
      metersToUnits,
      title: title || 'MAP3D',
      dem,
      waterPolys,
      waterLines,
      greenPolys,
      trees,
      roads,
      buildings
    };
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
  // UI UPDATES: PALETTES, LAYERS, MULTI-SELECT INSPECTOR, STATS
  // ==========================================================================
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
        .map(c => `<span class="w-3.5 h-3.5 rounded-sm border border-black/25 inline-block" style="background:${c}"></span>`)
        .join('');
      btn.innerHTML = `
        <div class="text-xs font-semibold text-[var(--foreground)] truncate">${p.name}</div>
        <div class="flex items-center gap-1">${swatches}</div>
      `;
      btn.addEventListener('click', () => {
        state.activePalette = p.id;
        state.colors = { ...p.colors };
        renderPalettesUI();
        renderLayersUI();
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
      const isVis = state.layerVisible[m.key];
      row.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          <input type="checkbox" data-layer-vis="${m.key}" ${isVis ? 'checked' : ''} class="rounded cursor-pointer" />
          <input type="color" data-layer-col="${m.key}" value="${state.colors[m.key]}" class="w-6 h-6 rounded cursor-pointer shrink-0" />
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
      });
    });

    container.querySelectorAll('[data-layer-col]').forEach(inp => {
      inp.addEventListener('input', e => {
        const k = e.target.getAttribute('data-layer-col');
        state.colors[k] = e.target.value;
        state.activePalette = 'custom';
        renderPalettesUI();
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
      const members = state.groupIdMap.get(gid) || scene.buildings.filter(x => x.id === gid || x._groupId === gid);
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
    document.getElementById('inspName').textContent =
      groupCount > 1 ? `${b.name} (+${groupCount - 1} zaznaczonych)` : b.name;

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

    document.getElementById('inspOsmId').textContent =
      `OSM ID: ${b.osmId} • Kondygnacje: ${b.levels} • Części: ${activeBlds.length}`;
    const effMeters = Math.round(b.h * (b.heightMult || 1));
    // Fix B19: Compute printed height in mm directly from the actual extruded 3D mesh bounds
    const gid = b._groupId || b.id;
    const bb = (state.buildingBounds || []).find(x => x.groupId === gid || x.building.id === b.id);
    const scaleMm = (state.bedSizeMm || 320) / 169.2;
    const printMm = bb
      ? Math.max(1.0, (bb.maxZ - bb.minZ) * scaleMm).toFixed(1)
      : (b.h * (scene.metersToUnits || 0.13) * state.zScale * (b.heightMult || 1) * scaleMm).toFixed(1);
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
    const gid = b._groupId || b.id;
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

    const seenNames = new Set();
    const named = (state.sceneData.buildings || [])
      .filter(b => {
        if (!b.landmark || b.name.startsWith('Budynek OSM')) return false;
        if (seenNames.has(b.name)) return false;
        seenNames.add(b.name);
        return true;
      })
      .slice(0, 8);

    named.forEach(b => {
      const gid = b._groupId || b.id;
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
    const dimW = state.bedSizeMm || 320;
    const dimH = state.totalHeightMm || dimW;
    const tileW = Math.round(dimW / cols);
    const tileH = Math.round(dimH / rows);
    const maxZ = Math.round(pm.maxZMm || 22);

    document.getElementById('meshStatsBadge').textContent =
      `${state.totalTriangles.toLocaleString('pl-PL')} trójkątów • ${bCount} budynków • ${tCount} drzew 3D`;

    const tileGridSel = document.getElementById('tileGridSelect');
    if (tileGridSel) {
      tileGridSel.value = `${cols}x${rows}`;
    }

    const baseCrop = (sc && sc._fetchedCropRatio) || 1.0;
    const effCrop = Math.min(1.0, Math.max(0.35, (state.cropRatio || 0.88) / baseCrop));
    const realSpanM = ((sc && sc.spanMeters) || 1350) * effCrop;
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
      if (matTitle) matTitle.textContent = `Masa PLA (+ ~18g wieża AMS)`;
      document.getElementById('statFilament').textContent = `~${plaG} g PLA (~${Math.round(totalMl)} ml)`;
    }

    const activeVols = Object.keys(state.layerVisible).filter(k => state.layerVisible[k]).length;
    document.getElementById('statVolumes').textContent = `${cols}×${rows} (${activeVols} warstw)`;

    const hollowBadge = document.getElementById('hollowSavingsBadge');
    if (hollowBadge) {
      hollowBadge.textContent = state.hollowBase
        ? `-${pm.hollowSavingsPct || 48}% żywicy`
        : `Pełna FDM (0%)`;
      hollowBadge.className = state.hollowBase
        ? 'text-xs font-mono font-bold text-emerald-400 shrink-0'
        : 'text-xs font-mono font-bold text-amber-400 shrink-0';
    }

    const preflightBadge = document.getElementById('preflightStatusBadge');
    if (preflightBadge) {
      const floatOk = (pm.floatingBuildingsCount || 0) === 0;
      const tileOk = (pm.outOfTileTrisCount || 0) === 0;
      if (profile.isResin) {
        preflightBadge.textContent = (pm.fitsPhotonMono4 && floatOk && tileOk)
          ? `Manifold ✓ • 0 lewit. • Mono 4 (${tileW}×${tileH}mm) ✓`
          : `Manifold ✓ • Sprawdź wymiar (${tileW}×${tileH}mm)`;
      } else {
        preflightBadge.textContent = (floatOk && tileOk)
          ? `Manifold ✓ • 0 lewitujących • Bez ramki`
          : `Manifold ✓ • Bez ramki w eksporcie`;
      }
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
    state.cropRatio = parseInt(e.target.value, 10) / 100;
    const sc = state.sceneData;
    const baseCrop = (sc && sc._fetchedCropRatio) || 1.0;
    const effCrop = Math.min(1.0, Math.max(0.35, state.cropRatio / baseCrop));
    const realSpanM = ((sc && sc.spanMeters) || 1350) * effCrop;
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
    // Fix B03: Enable Hollow Base automatically on SLA Resin printers; disable on FDM so slicers use normal infill
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
