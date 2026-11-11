// ============================================================================
// src/video/video_config.js
// Presets, Animation Storyboards, Export Resolutions & Material Catalogs for
// the Browser Video Preview & Framed Order Demo Studio Module.
// ============================================================================

const VIDEO_CACHED_PRESETS = [
  {
    id: 'dubai',
    label: '🏙️ Dubaj (Burj Khalifa)',
    title: 'DUBAI',
    subtitle: 'DOWNTOWN • BURJ KHALIFA 828M',
    lat: 25.1923,
    lon: 55.2724,
    bbox: [25.1865, 55.2660, 25.1981, 55.2788],
    cacheUrl: 'cache/scene_v4_25.1865_55.2660_25.1981_55.2788.json'
  },
  {
    id: 'munich',
    label: '🏛️ Monachium (Isar)',
    title: 'MÜNCHEN',
    subtitle: 'ISAR & DEUTSCHES MUSEUM',
    lat: 48.1338,
    lon: 11.5855,
    bbox: [48.1280, 11.5769, 48.1396, 11.5941],
    cacheUrl: 'cache/scene_v4_48.1280_11.5769_48.1396_11.5941.json'
  },
  {
    id: 'krakow',
    label: '👑 Kraków (Wawel)',
    title: 'KRAKÓW',
    subtitle: 'ZAMEK KRÓLEWSKI & WISŁA',
    lat: 50.0543,
    lon: 19.9365,
    bbox: [50.0488, 19.9280, 50.0598, 19.9450],
    cacheUrl: 'cache/scene_v4_50.0488_19.9280_50.0598_19.9450.json'
  },
  {
    id: 'warszawa',
    label: '🦅 Warszawa (Centrum)',
    title: 'WARSZAWA',
    subtitle: 'ŚRÓDMIEŚCIE & PKiN',
    lat: 52.2320,
    lon: 21.0068,
    bbox: [52.2262, 20.9973, 52.2378, 21.0162],
    cacheUrl: 'cache/scene_v4_52.2262_20.9973_52.2378_21.0162.json'
  },
  {
    id: 'sopot',
    label: '⚓ Sopot (Molo)',
    title: 'SOPOT',
    subtitle: 'ZATOKA GDAŃSKA & MOLO',
    lat: 54.4446,
    lon: 18.5686,
    bbox: [54.4381, 18.5575, 54.4511, 18.5797],
    cacheUrl: 'cache/scene_v4_54.4381_18.5575_54.4511_18.5797.json'
  },
  {
    id: 'tokyo',
    label: '🗼 Tokio (Asakusa)',
    title: 'TOKYO',
    subtitle: 'SUMIDA RIVER & ASAKUSA',
    lat: 35.7118,
    lon: 139.8015,
    bbox: [35.7060, 139.7929, 35.7176, 139.8101],
    cacheUrl: 'cache/scene_v4_35.7060_139.7929_35.7176_139.8101.json'
  },
  {
    id: 'singapore',
    label: '🦁 Singapur (Marina)',
    title: 'SINGAPORE',
    subtitle: 'MARINA BAY & SKYLINE',
    lat: 1.2868,
    lon: 103.8545,
    bbox: [1.2810, 103.8487, 1.2926, 103.8603],
    cacheUrl: 'cache/scene_v4_1.2810_103.8487_1.2926_103.8603.json'
  },
  {
    id: 'innsbruck',
    label: '⛰️ Innsbruck (Alpy)',
    title: 'INNSBRUCK',
    subtitle: 'TYROL & DOLINA RZEKI INN',
    lat: 47.2685,
    lon: 11.3933,
    bbox: [47.2627, 11.3847, 47.2743, 11.4019],
    cacheUrl: 'cache/scene_v4_47.2627_11.3847_47.2743_11.4019.json'
  }
];

const VIDEO_STORYBOARDS = [
  {
    id: 'hero',
    name: '1. Hero (Telemetria → 2D Whip-Pan → 3D Blueprint → Rama Studio)',
    shortName: 'Hero',
    desc: 'Pełna choreografia inspirowana spotem konkurencji: dane UTM, szybkie kadrowanie 2D z motion-blur, wyrost brył 3D w siatce CAD i przejście w fizyczną ramkę.'
  },
  {
    id: 'layer_build',
    name: '2. Sekwencyjna Budowa Warstw 3D (Woda → Teren → Zieleń → Ulice → Budynki → Rama)',
    shortName: 'Budowa Warstwowa',
    desc: 'Każdy wybrany element (warstwa druku wielokolorowego) wyrasta kolejno w osi Z, a na finał zamyka się rama galeryjna z grawerem.'
  },
  {
    id: 'laser_scan_morph',
    name: '3. Skaner Laserowy Mapa 2D → Makieta 3D (Przejście Falowe)',
    shortName: 'Skaner 2D→3D',
    desc: 'Płaska mapa kartograficzna pochyla się w perspektywie, a wiązka skanera 3D zamienia wektory 2D w cieniowaną rzeźbę architektoniczną.'
  },
  {
    id: 'exploded_snap',
    name: '4. Eksplozja Techniczna & Złożenie Zamówienia (Warstwy Z + Kafle + 4 Listwy Ramy)',
    shortName: 'Złożenie z Eksplozji',
    desc: 'Rozsunięte w przestrzeni warstwy Z, kafle druku i 4 narożne listwy ramy 45° łączą się sprężyście w gotowy produkt.'
  },
  {
    id: 'turntable_luxury',
    name: '5. Prezentacja Produktowa 360° + Złota Godzina Cieni (Showcase Sklepowy)',
    shortName: 'Obrót 360° Studio',
    desc: 'Gotowy oprawiony produkt obraca się płynnie w studiu przy ruchomym świetle słonecznym eksponującym głębię ulic i dachów LoD2.'
  }
];

const VIDEO_ASPECT_CONFIGS = {
  '16x9_720':  { w: 1280, h: 720,  cssAspect: '16 / 9', label: '16:9 HD (1280×720)' },
  '16x9_1080': { w: 1920, h: 1080, cssAspect: '16 / 9', label: '16:9 FullHD (1920×1080)' },
  '1x1_1080':  { w: 1080, h: 1080, cssAspect: '1 / 1',  label: '1:1 Kwadrat Sklep (1080×1080)' },
  '9x16_1280': { w: 720,  h: 1280, cssAspect: '9 / 16', label: '9:16 Reels / Shorts (720×1280)' }
};

const VIDEO_FRAME_FINISHES = {
  black:  { rgb: [0.11, 0.12, 0.14], label: 'Czarny Mat Aluminium', plaqueBg: '#111318', plaqueFg: '#f8fafc', plaqueAcc: '#94a3b8' },
  oak:    { rgb: [0.73, 0.55, 0.36], label: 'Dąb Naturalny',        plaqueBg: '#f8fafc', plaqueFg: '#1e293b', plaqueAcc: '#64748b' },
  walnut: { rgb: [0.34, 0.22, 0.15], label: 'Orzech Amerykański',   plaqueBg: '#1c1917', plaqueFg: '#fef3c7', plaqueAcc: '#d6d3d1' },
  white:  { rgb: [0.95, 0.96, 0.97], label: 'Biała Galeryjna',      plaqueBg: '#ffffff', plaqueFg: '#0f172a', plaqueAcc: '#64748b' },
  gold:   { rgb: [0.78, 0.64, 0.32], label: 'Złoto Szczotkowane',   plaqueBg: '#18181b', plaqueFg: '#fde68a', plaqueAcc: '#d4af37' }
};

const VIDEO_MAT_STYLES = {
  none:          { margin: 0.0,  rgb: [0.12, 0.13, 0.15], textFg: '#f8fafc', textSub: '#94a3b8', label: 'Bez Passe-partout (Pełny Kadr)' },
  gallery_white: { margin: 13.5, rgb: [0.97, 0.97, 0.98], textFg: '#0f172a', textSub: '#64748b', label: 'Białe Passe-partout Galeryjne' },
  museum_cream:  { margin: 13.5, rgb: [0.95, 0.93, 0.88], textFg: '#1c1917', textSub: '#78716c', label: 'Krem Muzealny Warm Art' },
  obsidian_dark: { margin: 13.5, rgb: [0.10, 0.11, 0.14], textFg: '#f8fafc', textSub: '#94a3b8', label: 'Czarny Kontrast Architektoniczny' }
};

const VIDEO_BACKING_STYLES = {
  obsidian: { rgb: [0.09, 0.10, 0.13], label: 'Czarny Kontrast (Styl)' },
  white:    { rgb: [0.95, 0.96, 0.98], label: 'Czysta Biel Architektoniczna' },
  slate:    { rgb: [0.20, 0.25, 0.33], label: 'Grafit Nordycki' },
  sand:     { rgb: [0.89, 0.83, 0.73], label: 'Piaskowy Kartograficzny' }
};

const VIDEO_BG_THEMES = {
  dark_to_white: { dark: [0.020, 0.026, 0.042], light: [0.965, 0.970, 0.980] },
  studio_white:  { dark: [0.945, 0.952, 0.965], light: [0.972, 0.976, 0.985] },
  obsidian_tech: { dark: [0.020, 0.026, 0.042], light: [0.065, 0.082, 0.120] },
  warm_gallery:  { dark: [0.045, 0.042, 0.040], light: [0.935, 0.918, 0.890] }
};
