// ============================================================================
// src/export/stl_writer.js
// Watertight Binary .STL Serializer, Anycubic Photon Mono 4 90° Auto-Orient,
// Per-Tile CSG Union & Modular Wall-Frame CSG Segment Exporter
// ============================================================================

if (typeof createZipArchive === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./export_io_utils.js'));
}

function _getStlVaultSolver() {
  if (typeof buildUnifiedTileTrianglesForStlCSG === 'function') return { buildUnifiedTileTrianglesForStlCSG };
  if (typeof window !== 'undefined' && typeof window.buildUnifiedTileTrianglesForStlCSG === 'function') return window;
  if (typeof require !== 'undefined') return require('../mesh/tile_sla_vault_solver.js');
  return null;
}

function _getStlFrameSolver() {
  if (typeof buildFrameSegmentsCSG === 'function') return { buildFrameSegmentsCSG };
  if (typeof window !== 'undefined' && typeof window.buildFrameSegmentsCSG === 'function') return window;
  if (typeof require !== 'undefined') return require('../mesh/frame_csg_solver.js');
  return null;
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
  for (let i = 0; i < Math.min(79, headerStr.length); i++) headerBytes[i] = headerStr.charCodeAt(i);
  const view = new DataView(buf);
  view.setUint32(80, tris.length, true);

  let offset = 84;
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    let nx = (t.n && t.n[0]) || 0, ny = (t.n && t.n[1]) || 0;
    const nz = (t.n && t.n[2]) !== undefined ? t.n[2] : 1;
    if (shouldRotate) { const ox = nx; nx = -ny; ny = ox; }
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    const pts = [t.v0, t.v1, t.v2];
    for (let v = 0; v < 3; v++) {
      const baseOff = offset + 12 + v * 12;
      const xLocal = (pts[v][0] + shiftX) * scaleMm;
      const yLocal = (pts[v][1] + shiftY) * scaleMm;
      const zLocal = Math.max(0, pts[v][2] * scaleMm + shiftZMm);
      const outX = shouldRotate ? (boundH_mm - yLocal) : xLocal;
      const outY = shouldRotate ? xLocal : yLocal;
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
  const { totalWidthMm, totalHeightMm, scaleMm, halfW, halfH } = resolveSceneScaleAndSpec(state, null);
  const cfg = (typeof PRINT_PHYSICS_CONFIG !== 'undefined') ? PRINT_PHYSICS_CONFIG : null;
  const mono4 = cfg ? cfg.photonMono4 : { bedXMm: 153.45, bedYMm: 87.05, frameSplitMaxMm: 148.0 };
  const defFrameWidthMm = cfg ? cfg.defaultFrameWidthMm : 12.0;
  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const tileWidthMm = totalWidthMm / tileCols, tileHeightMm = totalHeightMm / tileRows;
  const tileSpanX = (2 * halfW) / tileCols, tileSpanY = (2 * halfH) / tileRows;

  let shiftXScene = halfW, shiftYScene = halfH, targetW = totalWidthMm, targetH = totalHeightMm;
  if (layerFilter === 'frame') {
    const fwMm = (state && Number(state.frameWidthMm) > 0) ? Number(state.frameWidthMm) : defFrameWidthMm;
    const fwU = fwMm / scaleMm;
    shiftXScene = halfW + fwU; shiftYScene = halfH + fwU;
    targetW = totalWidthMm + 2 * fwMm; targetH = totalHeightMm + 2 * fwMm;
  } else if (tileIdFilter >= 0) {
    const tc = tileIdFilter % tileCols, tr = Math.floor(tileIdFilter / tileCols);
    shiftXScene = halfW - tc * tileSpanX; shiftYScene = halfH - tr * tileSpanY;
    targetW = tileWidthMm; targetH = tileHeightMm;
  }

  const fitsNormal = targetW <= mono4.bedXMm && targetH <= mono4.bedYMm;
  const fitsRotated = targetH <= mono4.bedXMm && targetW <= mono4.bedYMm;
  const shouldRotateMono4 = (tileIdFilter >= 0) && (!fitsNormal && fitsRotated);

  let allTris = [];
  const vaultMod = _getStlVaultSolver();
  if (layerFilter === 'all' && vaultMod && typeof vaultMod.buildUnifiedTileTrianglesForStlCSG === 'function') {
    allTris = vaultMod.buildUnifiedTileTrianglesForStlCSG(state, layerFilter, tileIdFilter);
  } else {
    const isCutout = Boolean(state && state.waterCutout);
    const keys = layerFilter === 'all'
      ? (isCutout ? ['base', 'greenery', 'roads', 'buildings', 'highlighted'] : ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted'])
      : ((isCutout && layerFilter === 'water') ? [] : [layerFilter]);
    const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
    for (const k of keys) {
      if (layerFilter === 'all' && state && state.layerVisible && state.layerVisible[k] === false) continue;
      for (const t of (meshesObj[k] || [])) {
        if (tileIdFilter >= 0 && resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) !== tileIdFilter) continue;
        allTris.push(t);
      }
    }
  }

  const frameZShiftMm = layerFilter === 'frame' ? computeFrameZShiftMm(allTris, scaleMm) : 0;
  return buildSTLBytesFromTriangles(allTris, shiftXScene, shiftYScene, scaleMm, targetW, targetH, state, shouldRotateMono4, frameZShiftMm);
}

function exportBinarySTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const tileFilter = (state && state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
    ? parseInt(state.exportTileFilter, 10) : -1;

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
  const tileW = Math.round(totalWidthMm / tileCols), tileH = Math.round(totalHeightMm / tileRows);
  let tileSuffix = `_${tileW}x${tileH}mm`;
  if (tileFilter >= 0) {
    const tc = tileFilter % tileCols, tr = Math.floor(tileFilter / tileCols);
    tileSuffix = `_Kafel_R${tileRows - tr}C${tc + 1}_${tileW}x${tileH}mm`;
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
  if (frameTris.length === 0) return false;

  const { scaleMm } = resolveSceneScaleAndSpec(state, null);
  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const frameSolver = _getStlFrameSolver();
  const segments = frameSolver && typeof frameSolver.buildFrameSegmentsCSG === 'function'
    ? frameSolver.buildFrameSegmentsCSG(state, frameTris) : [];

  if (segments.length > 1) {
    const zipFiles = segments.map(seg => ({
      name: seg.name,
      content: buildSTLBytesFromTriangles(seg.tris, seg.shiftX, seg.shiftY, scaleMm, seg.segW, seg.segH, state, seg.shouldRotate, seg.shiftZMm),
    }));
    const zipBytes = createZipArchive(zipFiles);
    downloadBlob(zipBytes, `Map3D_${safeTitle}_Rama_Segmenty_PhotonMono4.zip`, 'application/zip');
    return true;
  }
  if (segments.length === 1) {
    const seg = segments[0];
    const segBytes = buildSTLBytesFromTriangles(seg.tris, seg.shiftX, seg.shiftY, scaleMm, seg.segW, seg.segH, state, seg.shouldRotate, seg.shiftZMm);
    downloadBlob(segBytes, `Map3D_${safeTitle}_Rama_Pelna_${Math.round(seg.segW)}x${Math.round(seg.segH)}mm.stl`, 'model/stl');
    return true;
  }
  const fullBytes = buildBinarySTLBytes(state, 'frame', -1);
  downloadBlob(fullBytes, `Map3D_${safeTitle}_Rama_Pelna.stl`, 'model/stl');
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeFrameZShiftMm, buildSTLBytesFromTriangles, buildBinarySTLBytes, exportBinarySTL, exportFrameSTL };
}
