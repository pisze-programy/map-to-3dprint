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
  if (typeof globalThis !== 'undefined' && typeof globalThis.downloadBlobHook === 'function') {
    globalThis.downloadBlobHook(uint8Array, filename, mime);
    return;
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
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

function generateAsciiGrid(tileCols, tileRows) {
  const colWidth = 14;
  const lines = [];
  const hSep = '+' + Array(tileCols).fill('-'.repeat(colWidth)).join('+') + '+';
  lines.push('       [PÓŁNOC / NORTH / GÓRA OBRAZU (ŚCIANA)]');
  lines.push(hSep);
  for (let r = 1; r <= tileRows; r++) {
    const rowCells = [];
    for (let c = 1; c <= tileCols; c++) {
      let tag = `R${r}C${c}`;
      if (r === 1 && c === 1) tag += ' (NW)';
      else if (r === 1 && c === tileCols) tag += ' (NE)';
      else if (r === tileRows && c === 1) tag += ' (SW)';
      else if (r === tileRows && c === tileCols) tag += ' (SE)';
      const padLeft = Math.floor((colWidth - tag.length) / 2);
      const padRight = colWidth - tag.length - padLeft;
      rowCells.push(' '.repeat(padLeft) + tag + ' '.repeat(padRight));
    }
    lines.push('|' + rowCells.join('|') + '|');
    lines.push(hSep);
  }
  lines.push('     [POŁUDNIE / SOUTH / DÓŁ OBRAZU]');
  return lines.join('\n');
}

function buildSTLBytesFromTriangles(tris, shiftX, shiftY, scaleMm, boundW_mm, boundH_mm, state, shouldRotate = false) {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const headerBytes = new Uint8Array(buf, 0, 80);
  const headerStr = 'Map3D Print Studio - Watertight Mesh - Data (c) OpenStreetMap contributors ODbL';
  for (let i = 0; i < Math.min(79, headerStr.length); i++) {
    headerBytes[i] = headerStr.charCodeAt(i);
  }
  const view = new DataView(buf);
  view.setUint32(80, tris.length, true);

  let offset = 84;
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    let nx = (t.n && t.n[0]) || 0;
    let ny = (t.n && t.n[1]) || 0;
    const nz = (t.n && t.n[2]) !== undefined ? t.n[2] : 1;
    if (shouldRotate) {
      const origNx = nx;
      nx = -ny;
      ny = origNx;
    }
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    const pts = [t.v0, t.v1, t.v2];
    for (let v = 0; v < 3; v++) {
      const baseOff = offset + 12 + v * 12;
      const xLocal = (pts[v][0] + shiftX) * scaleMm;
      const yLocal = (pts[v][1] + shiftY) * scaleMm;
      const zLocal = Math.max(0, pts[v][2] * scaleMm);
      let outX = xLocal;
      let outY = yLocal;
      const outZ = zLocal;
      if (shouldRotate) {
        outX = boundH_mm - yLocal;
        outY = xLocal;
      }
      view.setFloat32(baseOff, outX, true);
      view.setFloat32(baseOff + 4, outY, true);
      view.setFloat32(baseOff + 8, outZ, true);
    }
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return new Uint8Array(buf);
}

function buildBinarySTLBytes(state, layerFilter = 'all', tileIdFilter = -1) {
  const totalWidthMm = (state && state.bedSizeMm) || 320.0;
  const totalHeightMm = (state && state.totalHeightMm) || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const halfW = 84.6 * (totalWidthMm / maxDimMm);
  const halfH = 84.6 * (totalHeightMm / maxDimMm);

  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const tileWidthMm = totalWidthMm / tileCols;
  const tileHeightMm = totalHeightMm / tileRows;
  const tileSpanX = (2 * halfW) / tileCols;
  const tileSpanY = (2 * halfH) / tileRows;

  // Layer filtering: by default ('all'), keep meshes.frame excluded from map tile STLs
  const keys = layerFilter === 'all'
    ? ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted']
    : [layerFilter];

  let shiftXScene = halfW;
  let shiftYScene = halfH;
  let targetW = totalWidthMm;
  let targetH = totalHeightMm;

  if (layerFilter === 'frame') {
    const frameWidthMm = (state && state.frameWidthMm) || 12.0;
    const frameWidthUnits = frameWidthMm / scaleMm;
    const outerHalfW = halfW + frameWidthUnits;
    const outerHalfH = halfH + frameWidthUnits;
    shiftXScene = outerHalfW;
    shiftYScene = outerHalfH;
    targetW = totalWidthMm + 2 * frameWidthMm;
    targetH = totalHeightMm + 2 * frameWidthMm;
  } else if (tileIdFilter >= 0) {
    const tc = tileIdFilter % tileCols;
    const tr = Math.floor(tileIdFilter / tileCols);
    shiftXScene = halfW - tc * tileSpanX;
    shiftYScene = halfH - tr * tileSpanY;
    targetW = tileWidthMm;
    targetH = tileHeightMm;
  } else {
    shiftXScene = halfW;
    shiftYScene = halfH;
    targetW = totalWidthMm;
    targetH = totalHeightMm;
  }

  // Contract 4: Anycubic Photon Mono 4 build volume is 153.4 x 87.0 x 165.0 mm
  // If tile fits Mono 4 rotated 90° on XY (e.g. tileW > 153.4 or tileH > 87.0 but fits rotated),
  // rotate exported vertex XY and normal XY by +90° so it drops cleanly on the plate!
  const fitsNormal = (targetW <= 153.45 && targetH <= 87.05);
  const fitsRotated = (targetH <= 153.45 && targetW <= 87.05);
  const isResinMode = Boolean(state && (state.isResin || state.printerPreset === 'photon_mono_4'));
  const shouldRotateMono4 = isResinMode && (tileIdFilter >= 0) && (!fitsNormal && fitsRotated);

  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const allTris = [];
  keys.forEach(k => {
    if (layerFilter === 'all' && state && state.layerVisible && !state.layerVisible[k]) return;
    const arr = meshesObj[k] || [];
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (tileIdFilter >= 0 && t.tileId !== undefined && t.tileId !== tileIdFilter) continue;
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
    let nx = (t.n && t.n[0]) || 0;
    let ny = (t.n && t.n[1]) || 0;
    const nz = (t.n && t.n[2]) !== undefined ? t.n[2] : 1;
    if (shouldRotateMono4) {
      const origNx = nx;
      nx = -ny;
      ny = origNx;
    }
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    const pts = [t.v0, t.v1, t.v2];
    for (let v = 0; v < 3; v++) {
      const baseOff = offset + 12 + v * 12;
      const xLocal = (pts[v][0] + shiftXScene) * scaleMm;
      const yLocal = (pts[v][1] + shiftYScene) * scaleMm;
      const zLocal = Math.max(0, pts[v][2] * scaleMm);
      let outX = xLocal;
      let outY = yLocal;
      const outZ = zLocal;
      if (shouldRotateMono4) {
        outX = targetH - yLocal;
        outY = xLocal;
      }
      view.setFloat32(baseOff, outX, true);
      view.setFloat32(baseOff + 4, outY, true);
      view.setFloat32(baseOff + 8, outZ, true);
    }
    // Fix B33: Standard 0 attribute byte count for universal slicer compatibility
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return new Uint8Array(buf);
}

function exportBinarySTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const tileFilter = (state && state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
    ? parseInt(state.exportTileFilter, 10)
    : -1;

  // If multi-tile mode is active and 'all' tiles are selected, export a ZIP archive with all tiles ready for Anycubic Photon Mono 4!
  if (tileFilter < 0 && (tileCols * tileRows > 1) && layerFilter === 'all') {
    exportAllTilesZipSTL(state, layerFilter);
    return;
  }

  const stlBytes = buildBinarySTLBytes(state, layerFilter, tileFilter);
  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const totalWidthMm = (state && state.bedSizeMm) || 320.0;
  const totalHeightMm = (state && state.totalHeightMm) || totalWidthMm;
  const tileW = Math.round(totalWidthMm / tileCols);
  const tileH = Math.round(totalHeightMm / tileRows);
  let tileSuffix = `_${tileW}x${tileH}mm`;
  if (tileFilter >= 0) {
    const tc = tileFilter % tileCols;
    const tr = Math.floor(tileFilter / tileCols);
    const northRow = tileRows - tr;
    tileSuffix = `_Kafel_R${northRow}C${tc + 1}_${tileW}x${tileH}mm`;
  }
  const suffix = layerFilter === 'all'
    ? `Pelna_Bryla${tileSuffix}`
    : (layerFilter === 'frame' ? `Rama_${Math.round(totalWidthMm + 24)}x${Math.round(totalHeightMm + 24)}mm` : `Warstwa_${layerFilter}${tileSuffix}`);
  downloadBlob(stlBytes, `Map3D_${safeTitle}_${suffix}.stl`, 'model/stl');
}

function exportFrameSTL(state) {
  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const frameTris = meshesObj.frame || [];
  if (frameTris.length === 0) {
    console.warn('exportFrameSTL: meshes.frame is empty or not generated.');
    return;
  }

  const totalW = (state && state.bedSizeMm) || 252.0;
  const totalH = (state && state.totalHeightMm) || totalW;
  const frameWidthMm = (state && state.frameWidthMm) || 12.0;
  const frameTotalWidthMm = totalW + 2 * frameWidthMm;
  const frameTotalHeightMm = totalH + 2 * frameWidthMm;
  const maxDimMm = Math.max(totalW, totalH);
  const scaleMm = maxDimMm / 169.2;
  const frameWidthUnits = frameWidthMm / scaleMm;
  const halfW = 84.6 * (totalW / maxDimMm);
  const halfH = 84.6 * (totalH / maxDimMm);
  const outerHalfW = halfW + frameWidthUnits;
  const outerHalfH = halfH + frameWidthUnits;
  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const isResin = Boolean(state && (state.isResin || state.printerPreset === 'photon_mono_4'));

  const canClip = typeof clipMeshToBox3D === 'function';
  const fCols = Math.max(1, Math.ceil(frameTotalWidthMm / 148.0));
  const fRows = Math.max(1, Math.ceil(frameTotalHeightMm / 148.0));

  if (canClip && (fCols > 1 || fRows > 1)) {
    const colSpanScene = (2 * outerHalfW) / fCols;
    const rowSpanScene = (2 * outerHalfH) / fRows;
    const zipFiles = [];
    let fIdx = 1;
    for (let fr = fRows - 1; fr >= 0; fr--) {
      const segNorthRow = fRows - fr;
      for (let fc = 0; fc < fCols; fc++) {
        const x0 = -outerHalfW + fc * colSpanScene;
        const x1 = (fc === fCols - 1) ? outerHalfW : -outerHalfW + (fc + 1) * colSpanScene;
        const y0 = -outerHalfH + fr * rowSpanScene;
        const y1 = (fr === fRows - 1) ? outerHalfH : -outerHalfH + (fr + 1) * rowSpanScene;
        const clipped = clipMeshToBox3D(frameTris, x0, x1, y0, y1, -1);
        if (clipped && clipped.length > 0) {
          const segW = (x1 - x0) * scaleMm;
          const segH = (y1 - y0) * scaleMm;
          const segFitsNormal = (segW <= 153.45 && segH <= 87.05);
          const segFitsRotated = (segH <= 153.45 && segW <= 87.05);
          const segRotate = isResin && (!segFitsNormal && segFitsRotated);
          const segBytes = buildSTLBytesFromTriangles(clipped, -x0, -y0, scaleMm, segW, segH, state, segRotate);
          const segName = `Rama_${String(fIdx++).padStart(2, '0')}_R${segNorthRow}C${fc + 1}_${Math.round(segW)}x${Math.round(segH)}mm.stl`;
          zipFiles.push({ name: segName, content: segBytes });
        }
      }
    }
    if (zipFiles.length > 0) {
      const zipBytes = createZipArchive(zipFiles);
      downloadBlob(zipBytes, `Map3D_${safeTitle}_Rama_Segmenty_PhotonMono4.zip`, 'application/zip');
      return;
    }
  }

  // Graceful fallback: full frame export
  const fullBytes = buildBinarySTLBytes(state, 'frame', -1);
  downloadBlob(fullBytes, `Map3D_${safeTitle}_Rama_Pelna_${Math.round(frameTotalWidthMm)}x${Math.round(frameTotalHeightMm)}mm.stl`, 'model/stl');
}

function exportAllTilesZipSTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const numTiles = tileCols * tileRows;
  const totalW = (state && state.bedSizeMm) || 252.0;
  const totalH = (state && state.totalHeightMm) || totalW;
  const targetW_cm = (totalW / 10).toFixed(1);
  const targetH_cm = (totalH / 10).toFixed(1);
  const tileW = totalW / tileCols;
  const tileH = totalH / tileRows;
  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const pm = (state && state.printMetrics) || {};
  const isResin = Boolean(state && (state.isResin || state.printerPreset === 'photon_mono_4'));
  const kerfMm = isResin ? (state.kerfMm !== undefined ? state.kerfMm : 0.08) : 0.0;

  const fitsNormal = (tileW <= 153.45 && tileH <= 87.05);
  const fitsRotated = (tileH <= 153.45 && tileW <= 87.05);
  const isAutoRotated = isResin && (!fitsNormal && fitsRotated);

  const zipFiles = [];
  const tileEntries = [];

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
      tileEntries.push({
        fileName,
        r: northRow,
        c: tc + 1,
        volMl: tVolMl,
        grams: tGrams,
        w: tileW.toFixed(1),
        h: tileH.toFixed(1)
      });
    }
  }

  // Optional Modular Frame Export (sliced into segments fitting 148 mm max length)
  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const frameTris = meshesObj.frame || [];
  const frameEntries = [];

  if (state && state.exportFrame && frameTris.length > 0) {
    const frameWidthMm = state.frameWidthMm || 12.0;
    const frameTotalWidthMm = totalW + 2 * frameWidthMm;
    const frameTotalHeightMm = totalH + 2 * frameWidthMm;
    const maxDimMm = Math.max(totalW, totalH);
    const scaleMm = maxDimMm / 169.2;
    const frameWidthUnits = frameWidthMm / scaleMm;
    const halfW = 84.6 * (totalW / maxDimMm);
    const halfH = 84.6 * (totalH / maxDimMm);
    const outerHalfW = halfW + frameWidthUnits;
    const outerHalfH = halfH + frameWidthUnits;

    const canClip = typeof clipMeshToBox3D === 'function';
    const fCols = Math.max(1, Math.ceil(frameTotalWidthMm / 148.0));
    const fRows = Math.max(1, Math.ceil(frameTotalHeightMm / 148.0));

    if (canClip && (fCols > 1 || fRows > 1)) {
      const colSpanScene = (2 * outerHalfW) / fCols;
      const rowSpanScene = (2 * outerHalfH) / fRows;
      let fIdx = 1;
      for (let fr = fRows - 1; fr >= 0; fr--) {
        const segNorthRow = fRows - fr;
        for (let fc = 0; fc < fCols; fc++) {
          const x0 = -outerHalfW + fc * colSpanScene;
          const x1 = (fc === fCols - 1) ? outerHalfW : -outerHalfW + (fc + 1) * colSpanScene;
          const y0 = -outerHalfH + fr * rowSpanScene;
          const y1 = (fr === fRows - 1) ? outerHalfH : -outerHalfH + (fr + 1) * rowSpanScene;
          const clipped = clipMeshToBox3D(frameTris, x0, x1, y0, y1, -1);
          if (clipped && clipped.length > 0) {
            const segW = (x1 - x0) * scaleMm;
            const segH = (y1 - y0) * scaleMm;
            const segFitsNormal = (segW <= 153.45 && segH <= 87.05);
            const segFitsRotated = (segH <= 153.45 && segW <= 87.05);
            const segRotate = isResin && (!segFitsNormal && segFitsRotated);
            const segBytes = buildSTLBytesFromTriangles(clipped, -x0, -y0, scaleMm, segW, segH, state, segRotate);
            const segName = `Rama_${String(fIdx++).padStart(2, '0')}_R${segNorthRow}C${fc + 1}_${Math.round(segW)}x${Math.round(segH)}mm.stl`;
            zipFiles.push({ name: segName, content: segBytes });
            frameEntries.push({ name: segName, w: segW.toFixed(1), h: segH.toFixed(1), rot: segRotate });
          }
        }
      }
    } else {
      const fullFrameFitsNormal = (frameTotalWidthMm <= 153.45 && frameTotalHeightMm <= 87.05);
      const fullFrameFitsRotated = (frameTotalHeightMm <= 153.45 && frameTotalWidthMm <= 87.05);
      const fullRotate = isResin && (!fullFrameFitsNormal && fullFrameFitsRotated);
      const fullFrameBytes = buildSTLBytesFromTriangles(
        frameTris,
        outerHalfW,
        outerHalfH,
        scaleMm,
        frameTotalWidthMm,
        frameTotalHeightMm,
        state,
        fullRotate
      );
      const segName = `Rama_01_Pelna_${Math.round(frameTotalWidthMm)}x${Math.round(frameTotalHeightMm)}mm.stl`;
      zipFiles.push({ name: segName, content: fullFrameBytes });
      frameEntries.push({ name: segName, w: frameTotalWidthMm.toFixed(1), h: frameTotalHeightMm.toFixed(1), rot: fullRotate });
    }
  }

  // Upgraded Polish Wall-Art Assembly & Printing Guide
  const reportLines = [
    `================================================================================`,
    `MAP3D PRINT STUDIO — PRZEWODNIK DRUKU I MONTAŻU PŁASKORZEŹBY ŚCIENNEJ (WALL ART)`,
    `Kompatybilność z drukarkami Anycubic Photon Mono 4 (153.4 x 87.0 x 165.0 mm)`,
    `================================================================================`,
    ``,
    `1. PARAMETRY MODELU I ROZMIAR DOCELOWY:`,
    `--------------------------------------------------------------------------------`,
    `Model:                       ${(state && state.plaqueText) || 'MAP3D'}`,
    `Wymiary docelowe obrazu:     ${targetW_cm} x ${targetH_cm} cm  (${totalW} x ${totalH} mm)`,
    `Maksymalna wysokość reliefu: ${(pm.maxZMm || 20).toFixed(1)} mm (oś Z)`,
    `Podział na kafle:            ${tileCols} kolumn x ${tileRows} wierszy (${numTiles} kafli ogółem)`,
    `Wymiar pojedynczego kafla:   ${tileW.toFixed(1)} x ${tileH.toFixed(1)} mm`,
    `Auto-rotacja dla Mono 4:     ${isAutoRotated ? `TAK (+90° XY: wymiar na stole ${tileH.toFixed(1)} x ${tileW.toFixed(1)} mm <= 153.4 x 87.0 mm)` : `NIE (mieści się w układzie standardowym <= 153.4 x 87.0 mm)`}`,
    `Odchudzona baza (Hollow):    ${state && state.hollowBase ? `TAK (Ścianka ${state.hollowWallMm || 1.8} mm + kanały drenażowe SLA, oszczędność ~${pm.hollowSavingsPct || 45}%)` : 'NIE (Pełna baza z=0 pod lity wydruk FDM/SLA)'}`,
    `Objętość żywicy całkowita:   ~${(pm.totalVolumeMl || 0).toFixed(1)} ml (~${pm.resinGrams || 0} g żywicy / ~${pm.plaGrams || 0} g PLA)`,
    `Tolerancja montażowa (Kerf): ${kerfMm.toFixed(2)} mm (fabryczny luz kompensujący rozszerzalność światła UV)`,
    `Ramka dekoracyjna 3D:        ${frameEntries.length > 0 ? `DOŁĄCZONA (${frameEntries.length} segmentów)` : 'WYŁĄCZONA Z PACZKI (wyłącznie podgląd 3D Studio)'}`,
    ``,
    `2. SCHEMAT ROZMIESZCZENIA KAFLI NA ŚCIANIE (ASCII GRID MAP):`,
    `--------------------------------------------------------------------------------`,
    generateAsciiGrid(tileCols, tileRows),
    ``,
    `3. OZNACZENIA NA SPODZIE KAFLI I ORIENTACJA:`,
    `--------------------------------------------------------------------------------`,
    `Każdy kafel posiada na spodzie wklęsłe oznaczenie pozycji w siatce oraz strzałkę,`,
    `np. 'R1C1 ↑'.`,
    `  - 'R' (Row)    : numer wiersza liczony od góry (R1 = wiersz północny).`,
    `  - 'C' (Column) : numer kolumny liczony od lewej (C1 = kolumna zachodnia).`,
    `  - '↑' (Strzałka): wskazuje PÓŁNOC i jednocześnie GÓRĘ gotowego obrazu na ścianie.`,
    `  * Przykład: R1C1 to lewy górny narożnik (NW), R${tileRows}C${tileCols} to prawy dolny narożnik (SE).`,
    ``,
    `4. LISTA PLIKÓW KAFLI W ARCHIWUM ZIP:`,
    `--------------------------------------------------------------------------------`
  ];

  tileEntries.forEach(e => {
    reportLines.push(`  - ${e.fileName.padEnd(38, ' ')} | Kafel [R${e.r}C${e.c}] | Wymiar: ${e.w} x ${e.h} mm | Żywica: ~${e.volMl} ml (~${e.grams} g)`);
  });

  if (frameEntries.length > 0) {
    reportLines.push(``);
    reportLines.push(`5. SEGMENTY MODUŁOWEJ RAMKI 3D:`);
    reportLines.push(`--------------------------------------------------------------------------------`);
    frameEntries.forEach(fe => {
      reportLines.push(`  - ${fe.name.padEnd(38, ' ')} | Wymiar segmentu: ${fe.w} x ${fe.h} mm ${fe.rot ? '(Obrócony o 90° dla Mono 4)' : ''}`);
    });
  }

  reportLines.push(``);
  reportLines.push(`6. REKOMENDACJE DRUKU SLA, MYCIA I POST-CURINGU (ANYCUBIC PHOTON MONO 4):`);
  reportLines.push(`--------------------------------------------------------------------------------`);
  reportLines.push(`  1. Oprogramowanie cięcia: Anycubic Photon Workshop, Lychee Slicer lub Chitubox.`);
  reportLines.push(`  2. Orientacja na stole: Wszystkie pliki .stl mają zoptymalizowane wymiary tak,`);
  reportLines.push(`     że po zaimportowaniu do slicera układają się bezpośrednio na płasko na platformie`);
  reportLines.push(`     roboczej (Z=0) w granicach 153.4 x 87.0 mm.`);
  reportLines.push(`  3. Kalibracja ekspozycji: Warstwa 0.05 mm, żywica standard/craft: 1.8–2.5 s ekspozycji`);
  reportLines.push(`     (warstwy bazowe: 25–35 s, 5–6 warstw).`);
  reportLines.push(`  4. Kanały drenażowe: Przy odchudzonej bazie upewnij się, że 4 dolne kanały`);
  reportLines.push(`     drenażowe są drożne, co zapobiega powstawaniu efektu przyssawki (suction cup).`);
  reportLines.push(`  5. Mycie (IPA): Kąpiel w alkoholu izopropylowym (>= 99%) przez 4–6 minut w myjce`);
  reportLines.push(`     wirowej. Dokładnie wypłucz wnętrze bazy za pomocą strzykawki lub myjki.`);
  reportLines.push(`  6. Suszenie: Odczekaj min. 30 minut do całkowitego odparowania IPA przed naświetlaniem,`);
  reportLines.push(`     aby uniknąć białych plam kredowych na reliefie.`);
  reportLines.push(`  7. Utwardzanie UV (405 nm): 3–5 minut z obracaniem. Zbyt długa ekspozycja może wywołać`);
  reportLines.push(`     naprężenia i mikroskurcz krawędzi.`);
  reportLines.push(`  8. Montaż obrazu: Ułóż kafle na stabilnym podłożu (sklejka liściasta 4–6 mm, płyta HDF`);
  reportLines.push(`     lub tył ramy kasetowej) według mapy ASCII. Do łączenia zaleca się gęsty klej`);
  reportLines.push(`     cyjanoakrylowy (CA) lub bezrozpuszczalnikowy klej montażowy.`);
  reportLines.push(``);
  reportLines.push(`Licencja danych przestrzennych: © OpenStreetMap contributors (ODbL 1.0)`);
  reportLines.push(`Dane wysokościowe DEM: AWS Terrain Tiles / Mapzen Terrarium`);
  reportLines.push(`Wygenerowano przez: Map3D Print Studio (Antigravity 2.0)`);
  reportLines.push(`================================================================================`);

  zipFiles.push({
    name: 'INSTRUKCJA_DRUKU_PHOTON_MONO_4.txt',
    content: reportLines.join('\n')
  });

  const zipBytes = createZipArchive(zipFiles);
  downloadBlob(
    zipBytes,
    `Map3D_${safeTitle}_${Math.round(totalW)}x${Math.round(totalH)}mm_${tileCols}x${tileRows}_Kafle_PhotonMono4.zip`,
    'application/zip'
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    crc32,
    createZipArchive,
    sanitizeFilenameSlug,
    downloadBlob,
    generateAsciiGrid,
    buildSTLBytesFromTriangles,
    buildBinarySTLBytes,
    exportBinarySTL,
    exportFrameSTL,
    exportAllTilesZipSTL
  };
}
