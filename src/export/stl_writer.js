// ============================================================================
// src/export/stl_writer.js
// Watertight Binary .STL Serializer, Anycubic Photon Mono 4 90° Auto-Orient &
// Modular Wall-Frame Segment Exporter
// ============================================================================

if (typeof createZipArchive === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./export_io_utils.js'));
  Object.assign(global, require('../mesh/mesh_clipper_3d.js'));
}

function computeFrameZShiftMm(tris, scaleMm) {
  if (!tris || tris.length === 0) return 0;
  let minZ = Infinity;
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    if (t.v0 && t.v0[2] < minZ) minZ = t.v0[2];
    if (t.v1 && t.v1[2] < minZ) minZ = t.v1[2];
    if (t.v2 && t.v2[2] < minZ) minZ = t.v2[2];
  }
  return (Number.isFinite(minZ) && minZ < 0) ? (-minZ * scaleMm) : 0;
}

function buildSTLBytesFromTriangles(tris, shiftX, shiftY, scaleMm, boundW_mm, boundH_mm, state, shouldRotate = false, shiftZMm = 0) {
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
      const zLocal = Math.max(0, pts[v][2] * scaleMm + shiftZMm);
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
  const {
    totalWidthMm,
    totalHeightMm,
    scaleMm,
    halfW,
    halfH
  } = resolveSceneScaleAndSpec(state, null);

  const cfg = (typeof PRINT_PHYSICS_CONFIG !== 'undefined') ? PRINT_PHYSICS_CONFIG : null;
  const mono4 = cfg ? cfg.photonMono4 : { bedXMm: 153.45, bedYMm: 87.05, frameSplitMaxMm: 148.0 };
  const defFrameWidthMm = cfg ? cfg.defaultFrameWidthMm : 12.0;

  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const tileWidthMm = totalWidthMm / tileCols;
  const tileHeightMm = totalHeightMm / tileRows;
  const tileSpanX = (2 * halfW) / tileCols;
  const tileSpanY = (2 * halfH) / tileRows;

  const isCutout = Boolean(state && state.waterCutout);
  const keys = layerFilter === 'all'
    ? (isCutout
        ? ['base', 'greenery', 'roads', 'buildings', 'highlighted']
        : ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'])
    : ((isCutout && layerFilter === 'water') ? [] : [layerFilter]);

  let shiftXScene = halfW;
  let shiftYScene = halfH;
  let targetW = totalWidthMm;
  let targetH = totalHeightMm;

  if (layerFilter === 'frame') {
    const frameWidthMm = (state && Number(state.frameWidthMm) > 0) ? Number(state.frameWidthMm) : defFrameWidthMm;
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

  const fitsNormal = (targetW <= mono4.bedXMm && targetH <= mono4.bedYMm);
  const fitsRotated = (targetH <= mono4.bedXMm && targetW <= mono4.bedYMm);
  const isResinMode = Boolean(state && (state.isResin || state.printerPreset === 'photon_mono_4'));
  const shouldRotateMono4 = isResinMode && (tileIdFilter >= 0) && (!fitsNormal && fitsRotated);

  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const allTris = [];
  keys.forEach(k => {
    if (layerFilter === 'all' && state && state.layerVisible && state.layerVisible[k] === false) return;
    const arr = meshesObj[k] || [];
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (tileIdFilter >= 0 && resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) !== tileIdFilter) continue;
      allTris.push(t);
    }
  });

  const frameZShiftMm = layerFilter === 'frame' ? computeFrameZShiftMm(allTris, scaleMm) : 0;
  return buildSTLBytesFromTriangles(allTris, shiftXScene, shiftYScene, scaleMm, targetW, targetH, state, shouldRotateMono4, frameZShiftMm);
}

function exportBinarySTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const tileFilter = (state && state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
    ? parseInt(state.exportTileFilter, 10)
    : -1;

  if (tileFilter < 0 && (tileCols * tileRows > 1) && layerFilter === 'all') {
    return exportAllTilesZipSTL(state, layerFilter);
  }

  const stlBytes = buildBinarySTLBytes(state, layerFilter, tileFilter);
  if (Boolean(state && state.waterCutout) && stlBytes.byteLength <= 84) {
    if (typeof document !== 'undefined') {
      const badge = document.getElementById('preflightStatusBadge');
      if (badge) {
        badge.className = 'text-xs font-mono text-amber-400';
        badge.textContent = tileFilter >= 0
          ? 'Pominięto eksport .STL: wybrany kafel to 100% wycięta woda.'
          : 'Pominięto eksport .STL: brak geometrii po wycięciu wody (100% woda).';
      }
    }
    return false;
  }
  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const { totalWidthMm, totalHeightMm } = resolveSceneScaleAndSpec(state, null);
  const defFrameWidthMm = (typeof PRINT_PHYSICS_CONFIG !== 'undefined') ? PRINT_PHYSICS_CONFIG.defaultFrameWidthMm : 12.0;
  const frameWidthMm = (state && Number(state.frameWidthMm) > 0) ? Number(state.frameWidthMm) : defFrameWidthMm;
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
    : (layerFilter === 'frame' ? `Rama_${Math.round(totalWidthMm + 2 * frameWidthMm)}x${Math.round(totalHeightMm + 2 * frameWidthMm)}mm` : `Warstwa_${layerFilter}${tileSuffix}`);
  downloadBlob(stlBytes, `Map3D_${safeTitle}_${suffix}.stl`, 'model/stl');
  return true;
}

function exportFrameSTL(state) {
  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const frameTris = meshesObj.frame || [];
  if (frameTris.length === 0) return;

  const {
    totalWidthMm: totalW,
    totalHeightMm: totalH,
    scaleMm,
    halfW,
    halfH
  } = resolveSceneScaleAndSpec(state, null);
  const cfg = (typeof PRINT_PHYSICS_CONFIG !== 'undefined') ? PRINT_PHYSICS_CONFIG : null;
  const mono4 = cfg ? cfg.photonMono4 : { bedXMm: 153.45, bedYMm: 87.05, frameSplitMaxMm: 148.0 };
  const frameWidthMm = (state && Number(state.frameWidthMm) > 0)
    ? Number(state.frameWidthMm)
    : (cfg ? cfg.defaultFrameWidthMm : 12.0);
  const frameTotalWidthMm = totalW + 2 * frameWidthMm;
  const frameTotalHeightMm = totalH + 2 * frameWidthMm;
  const frameWidthUnits = frameWidthMm / scaleMm;
  const outerHalfW = halfW + frameWidthUnits;
  const outerHalfH = halfH + frameWidthUnits;
  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const isResin = Boolean(state && (state.isResin || state.printerPreset === 'photon_mono_4'));

  const canClip = typeof clipMeshToBox3D === 'function';
  const fCols = Math.max(1, Math.ceil(frameTotalWidthMm / mono4.frameSplitMaxMm));
  const fRows = Math.max(1, Math.ceil(frameTotalHeightMm / mono4.frameSplitMaxMm));
  const frameShiftZMm = computeFrameZShiftMm(frameTris, scaleMm);

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
          const segFitsNormal = (segW <= mono4.bedXMm && segH <= mono4.bedYMm);
          const segFitsRotated = (segH <= mono4.bedXMm && segW <= mono4.bedYMm);
          const segRotate = isResin && (!segFitsNormal && segFitsRotated);
          const segBytes = buildSTLBytesFromTriangles(clipped, -x0, -y0, scaleMm, segW, segH, state, segRotate, frameShiftZMm);
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
    computeFrameZShiftMm,
    buildSTLBytesFromTriangles,
    buildBinarySTLBytes,
    exportBinarySTL,
    exportFrameSTL
  };
}
