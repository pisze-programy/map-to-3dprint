// ============================================================================
// src/export/stl_writer.js
// Watertight Binary .STL Serializer, Anycubic Photon Mono 4 90° Auto-Orient &
// Modular Wall-Frame Segment Exporter
// ============================================================================

if (typeof createZipArchive === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./crc32_zip.js'));
  Object.assign(global, require('../mesh/mesh_clipper_3d.js'));
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
      if (shouldRotate) {
        outX = boundH_mm - yLocal;
        outY = xLocal;
      }
      view.setFloat32(baseOff, outX, true);
      view.setFloat32(baseOff + 4, outY, true);
      view.setFloat32(baseOff + 8, zLocal, true);
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
    shiftXScene = halfW + frameWidthUnits;
    shiftYScene = halfH + frameWidthUnits;
    targetW = totalWidthMm + 2 * frameWidthMm;
    targetH = totalHeightMm + 2 * frameWidthMm;
  } else if (tileIdFilter >= 0) {
    const tc = tileIdFilter % tileCols;
    const tr = Math.floor(tileIdFilter / tileCols);
    shiftXScene = halfW - tc * tileSpanX;
    shiftYScene = halfH - tr * tileSpanY;
    targetW = tileWidthMm;
    targetH = tileHeightMm;
  }

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

  return buildSTLBytesFromTriangles(allTris, shiftXScene, shiftYScene, scaleMm, targetW, targetH, state, shouldRotateMono4);
}

function exportBinarySTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const tileFilter = (state && state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
    ? parseInt(state.exportTileFilter, 10)
    : -1;

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
  if (frameTris.length === 0) return;

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

  const fullBytes = buildBinarySTLBytes(state, 'frame', -1);
  downloadBlob(fullBytes, `Map3D_${safeTitle}_Rama_Pelna_${Math.round(frameTotalWidthMm)}x${Math.round(frameTotalHeightMm)}mm.stl`, 'model/stl');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildSTLBytesFromTriangles,
    buildBinarySTLBytes,
    exportBinarySTL,
    exportFrameSTL
  };
}
