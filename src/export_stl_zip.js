// ============================================================================
// src/export_stl_zip.js
// CRC32, ZIP Archive Builder, Binary .STL Exporter & Multi-Tile SLA .ZIP Packager
// ============================================================================

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xFF];
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function createZipArchive(files) {
  const encoder = new TextEncoder();
  const entries = files.map(f => {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = typeof f.content === 'string' ? encoder.encode(f.content) : f.content;
    return { nameBytes, dataBytes, crc: crc32(dataBytes) };
  });

  let localSize = 0, centralSize = 0;
  entries.forEach(e => {
    localSize += 30 + e.nameBytes.length + e.dataBytes.length;
    centralSize += 46 + e.nameBytes.length;
  });

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;

  entries.forEach(e => {
    e.localHeaderOffset = offset;
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint32(offset + 14, e.crc, true);
    view.setUint32(offset + 18, e.dataBytes.length, true);
    view.setUint32(offset + 22, e.dataBytes.length, true);
    view.setUint16(offset + 26, e.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(e.nameBytes, offset + 30);
    out.set(e.dataBytes, offset + 30 + e.nameBytes.length);
    offset += 30 + e.nameBytes.length + e.dataBytes.length;
  });

  const centralDirOffset = offset;
  entries.forEach(e => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0, true);
    view.setUint32(offset + 16, e.crc, true);
    view.setUint32(offset + 20, e.dataBytes.length, true);
    view.setUint32(offset + 24, e.dataBytes.length, true);
    view.setUint16(offset + 28, e.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, e.localHeaderOffset, true);
    out.set(e.nameBytes, offset + 46);
    offset += 46 + e.nameBytes.length;
  });

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralDirOffset, true);
  view.setUint16(offset + 20, 0, true);

  return out;
}

function sanitizeFilenameSlug(text) {
  const map = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
    'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
    'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'AE', 'Ö': 'OE', 'Ü': 'UE'
  };
  const replaced = String(text || 'MAP3D').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻäöüßÄÖÜ]/g, ch => map[ch] || ch);
  return replaced
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'MAP3D';
}

function downloadBlob(uint8Array, filename, mime) {
  const blob = new Blob([uint8Array], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 250);
}


function buildBinarySTLBytes(state, layerFilter = 'all', tileIdFilter = -1) {
  const totalWidthMm = state.bedSizeMm || 320.0;
  const scaleMm = totalWidthMm / 169.2;
  const tileCols = Math.max(1, state.tileCols || 1);
  const tileRows = Math.max(1, state.tileRows || 1);

  // Strictly printable layers ONLY — meshes.frame is NEVER exported!
  const keys = layerFilter === 'all'
    ? ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted']
    : [layerFilter].filter(k => k !== 'frame');

  let shiftXScene = 84.6;
  let shiftYScene = 84.6;
  if (tileIdFilter >= 0 && (tileCols > 1 || tileRows > 1)) {
    const tc = tileIdFilter % tileCols;
    const tr = Math.floor(tileIdFilter / tileCols);
    shiftXScene = 84.6 - tc * (169.2 / tileCols);
    shiftYScene = 84.6 - tr * (169.2 / tileRows);
  }

  const allTris = [];
  keys.forEach(k => {
    if (layerFilter === 'all' && !state.layerVisible[k]) return;
    const arr = state.layerMeshes[k] || [];
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (tileIdFilter >= 0 && t.tileId !== tileIdFilter) continue;
      allTris.push(t);
    }
  });

  const buf = new ArrayBuffer(84 + allTris.length * 50);
  const headerBytes = new Uint8Array(buf, 0, 80);
  const headerStr = 'Map3D Print Studio - Watertight Mesh - Data (c) OpenStreetMap contributors ODbL';
  for (let i = 0; i < Math.min(79, headerStr.length); i++) {
    headerBytes[i] = headerStr.charCodeAt(i);
  }
  const view = new DataView(buf);
  view.setUint32(80, allTris.length, true);

  let offset = 84;
  for (let i = 0; i < allTris.length; i++) {
    const t = allTris[i];
    view.setFloat32(offset, t.n[0], true);
    view.setFloat32(offset + 4, t.n[1], true);
    view.setFloat32(offset + 8, t.n[2], true);

    const pts = [t.v0, t.v1, t.v2];
    for (let v = 0; v < 3; v++) {
      const baseOff = offset + 12 + v * 12;
      view.setFloat32(baseOff, (pts[v][0] + shiftXScene) * scaleMm, true);
      view.setFloat32(baseOff + 4, (pts[v][1] + shiftYScene) * scaleMm, true);
      view.setFloat32(baseOff + 8, Math.max(0, pts[v][2] * scaleMm), true);
    }
    // Fix B33: Standard 0 attribute byte count for universal slicer compatibility
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return new Uint8Array(buf);
}

function exportBinarySTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, state.tileCols || 1);
  const tileRows = Math.max(1, state.tileRows || 1);
  const tileFilter = (state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
    ? parseInt(state.exportTileFilter, 10)
    : -1;

  // If multi-tile mode is active and 'all' tiles are selected, export a ZIP archive with all tiles ready for Anycubic Photon Mono 4!
  if (tileFilter < 0 && (tileCols * tileRows > 1) && layerFilter === 'all') {
    exportAllTilesZipSTL(state, layerFilter);
    return;
  }

  const stlBytes = buildBinarySTLBytes(state, layerFilter, tileFilter);
  const safeTitle = sanitizeFilenameSlug(state.plaqueText || 'MAP3D');
  const tileW = Math.round((state.bedSizeMm || 320) / tileCols);
  const tileH = Math.round((state.totalHeightMm || state.bedSizeMm || 320) / tileRows);
  let tileSuffix = `_${tileW}x${tileH}mm`;
  if (tileFilter >= 0) {
    const tc = tileFilter % tileCols;
    const tr = Math.floor(tileFilter / tileCols);
    const northRow = tileRows - tr;
    tileSuffix = `_Kafel_R${northRow}C${tc + 1}_${tileW}x${tileH}mm`;
  }
  const suffix = layerFilter === 'all' ? `Pelna_Bryla${tileSuffix}` : `Warstwa_${layerFilter}${tileSuffix}`;
  downloadBlob(stlBytes, `Map3D_${safeTitle}_${suffix}.stl`, 'model/stl');
}

function exportAllTilesZipSTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, state.tileCols || 1);
  const tileRows = Math.max(1, state.tileRows || 1);
  const numTiles = tileCols * tileRows;
  const totalW = state.bedSizeMm || 252;
  const totalH = state.totalHeightMm || totalW;
  const tileW = (totalW / tileCols).toFixed(1);
  const tileH = (totalH / tileRows).toFixed(1);
  const safeTitle = sanitizeFilenameSlug(state.plaqueText || 'MAP3D');
  const pm = state.printMetrics || {};

  const zipFiles = [];
  const reportLines = [
    `====================================================================`,
    `MAP3D PRINT STUDIO — PAKIET KAFLI POD DRUK 3D (BEZ RAMKI STUDIO)`,
    `====================================================================`,
    `Model:              ${state.plaqueText || 'MAP3D'}`,
    `Wymiar po złożeniu: ${totalW} x ${totalH} x ${(pm.maxZMm || 20).toFixed(1)} mm`,
    `Układ podziału:     ${tileCols} kol. x ${tileRows} wierszy (${numTiles} kafli, R1 = Północ / Góra mapy)`,
    `Wymiar 1 kafla:     ${tileW} x ${tileH} x ${(pm.maxZMm || 20).toFixed(1)} mm`,
    `Kompatybilność:     Anycubic Photon Mono 4 (153.4 x 87.0 x 165.0 mm, max 2.2 L): ${pm.fitsPhotonMono4 ? 'TAK (MIEŚCI SIĘ NA PŁASKO)' : 'SPRAWDŹ WYMIAR'}`,
    `Odchudzona baza:    ${state.hollowBase ? `TAK (Shell ${state.hollowWallMm || 1.8} mm + 4 kanały drenażowe SLA, oszczędność ~${pm.hollowSavingsPct || 45}%)` : 'NIE (Pełna baza z=0 pod wypełnienie FDM)'}`,
    `Całkowita żywica:   ~${(pm.totalVolumeMl || 0).toFixed(1)} ml (~${pm.resinGrams || 0} g)`,
    `Ramka (meshes.frame): WYŁĄCZONA Z EKSPORTU (wyłącznie podgląd w Studio)`,
    `Licencja danych:    © OpenStreetMap contributors (ODbL 1.0, https://www.openstreetmap.org/copyright)`,
    ``,
    `LISTA PLIKÓW KAFLI .STL (R1 = Północ / Góra mapy, C1 = Zachód / Lewa strona):`
  ];

  // Iterate from Northern row (tr = tileRows - 1 -> R1) down to Southern row (tr = 0 -> R_tileRows)
  let fileIdx = 1;
  for (let tr = tileRows - 1; tr >= 0; tr--) {
    const northRow = tileRows - tr;
    for (let tc = 0; tc < tileCols; tc++) {
      const tid = tr * tileCols + tc;
      const stlBytes = buildBinarySTLBytes(state, layerFilter, tid);
      const tVolMl = (pm.tileVolumesMl && pm.tileVolumesMl[tid] !== undefined)
        ? pm.tileVolumesMl[tid].toFixed(1)
        : ((pm.totalVolumeMl || 40) / numTiles).toFixed(1);
      const tGrams = Math.round(parseFloat(tVolMl) * 1.12);
      const fileName = `Kafel_${String(fileIdx++).padStart(2, '0')}_R${northRow}C${tc + 1}_${Math.round(tileW)}x${Math.round(tileH)}mm.stl`;
      zipFiles.push({ name: fileName, content: stlBytes });
      reportLines.push(`  - ${fileName}  |  Wymiar: ${tileW} x ${tileH} mm  |  Żywica: ~${tVolMl} ml (~${tGrams} g)`);
    }
  }

  zipFiles.push({
    name: 'INSTRUKCJA_DRUKU_PHOTON_MONO_4.txt',
    content: reportLines.join('\n')
  });

  const zipBytes = createZipArchive(zipFiles);
  downloadBlob(
    zipBytes,
    `Map3D_${safeTitle}_${totalW}x${totalH}mm_${tileCols}x${tileRows}_Kafle_PhotonMono4.zip`,
    'application/zip'
  );
}
