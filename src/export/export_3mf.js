// ============================================================================
// src/export/export_3mf.js
// Real Multi-Volume .3MF (ZIP + 3D Manufacturing XML) Streaming Byte Exporter
// Routed through tile_seam_cutter.js for seam-exact geometry & real SHA-256 manifest
// Pure ASCII module with strict JSDoc types.
// ============================================================================

if (typeof createZipArchive === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./export_io_utils.js'));
}
if (typeof resolveSceneScaleAndSpec === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('../geometry/print_physics_config.js')); } catch (_) {}
}

/**
 * Resolves tile_seam_cutter module across browser and Node runtimes.
 * @returns {object|null}
 */
function _get3mfCutterMod() {
  if (typeof buildMasterFrameUnifiedTilesForStl === 'function') {
    return {
      buildMasterFrameUnifiedTilesForStl,
      getCachedMasterFrameEntry: (typeof getCachedMasterFrameEntry === 'function') ? getCachedMasterFrameEntry : null,
    };
  }
  if (typeof window !== 'undefined' && typeof window.buildMasterFrameUnifiedTilesForStl === 'function') {
    return window;
  }
  if (typeof require !== 'undefined') {
    try { return require('../mesh/tile_seam_cutter.js'); } catch (_) {}
  }
  return null;
}

/**
 * Resolves tile_sla_vault_solver module across browser and Node runtimes.
 * @returns {object|null}
 */
function _get3mfVaultMod() {
  if (typeof buildUnifiedTileTrianglesForStlCSG === 'function') {
    return {
      buildUnifiedTileTrianglesForStlCSG,
      _plugInlandThroughHoles: (typeof _plugInlandThroughHoles === 'function') ? _plugInlandThroughHoles : undefined,
      _plugPostUnionBasePockets: (typeof _plugPostUnionBasePockets === 'function') ? _plugPostUnionBasePockets : undefined,
      _ventUpperSealedCourtyards: (typeof _ventUpperSealedCourtyards === 'function') ? _ventUpperSealedCourtyards : undefined,
      _groundFlatOverhangPiers: (typeof _groundFlatOverhangPiers === 'function') ? _groundFlatOverhangPiers : undefined,
      _cleanupDetachedBorderSlivers: (typeof _cleanupDetachedBorderSlivers === 'function') ? _cleanupDetachedBorderSlivers : undefined,
      _rasterizePolysToGrid: (typeof _rasterizePolysToGrid === 'function') ? _rasterizePolysToGrid : undefined,
    };
  }
  if (typeof window !== 'undefined' && typeof window._plugInlandThroughHoles === 'function') {
    return window;
  }
  if (typeof require !== 'undefined') {
    try { return require('../mesh/tile_sla_vault_solver.js'); } catch (_) {}
  }
  return null;
}

/**
 * Creates a streaming UTF-8 byte sink to avoid giant string V8 pressure.
 * @returns {{push: (str: string) => void, toUint8Array: () => Uint8Array}}
 */
function _createUtf8ChunkSink() {
  const enc = new TextEncoder();
  const byteChunks = [];
  let totalBytes = 0;
  let pendingStrs = [];
  let pendingChars = 0;
  const FLUSH_CHARS = 262144; // ~256 KB string window -> zero V8 max-string pressure

  function flushPending() {
    if (pendingStrs.length === 0) return;
    const u8 = enc.encode(pendingStrs.join(''));
    byteChunks.push(u8);
    totalBytes += u8.byteLength;
    pendingStrs = [];
    pendingChars = 0;
  }

  return {
    push(str) {
      if (!str) return;
      pendingStrs.push(str);
      pendingChars += str.length;
      if (pendingChars >= FLUSH_CHARS) flushPending();
    },
    toUint8Array() {
      flushPending();
      if (byteChunks.length === 1) return byteChunks[0];
      const out = new Uint8Array(totalBytes);
      let off = 0;
      for (let i = 0; i < byteChunks.length; i++) {
        out.set(byteChunks[i], off);
        off += byteChunks[i].byteLength;
      }
      return out;
    },
  };
}

/**
 * Exports a watertight seam-exact .3MF package routed through tile_seam_cutter.js
 * with embedded Metadata/assembly_manifest.json containing real SHA-256 digests.
 * @param {object} state
 * @returns {boolean}
 */
function exportMultiColor3MF(state) {
  const { totalWidthMm, totalHeightMm, scaleMm, halfW, halfH } = resolveSceneScaleAndSpec(state, null);

  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const numTiles = tileCols * tileRows;
  const tileWidthMm = totalWidthMm / tileCols;
  const tileHeightMm = totalHeightMm / tileRows;
  const tileSpanX = (2 * halfW) / tileCols;
  const tileSpanY = (2 * halfH) / tileRows;

  const tileFilter = (state && state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
    ? parseInt(state.exportTileFilter, 10)
    : -1;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const isCutout = Boolean(state && state.waterCutout);
  const allExportLayers = [
    { key: 'water',       objId: 1, matIdx: 0, name: '1_Woda_i_Batymetria' },
    { key: 'base',        objId: 2, matIdx: 1, name: '2_Teren_Warstwice_DEM' },
    { key: 'greenery',    objId: 3, matIdx: 2, name: '3_Zielen_Parki_i_Drzewa_3D' },
    { key: 'roads',       objId: 4, matIdx: 3, name: '4_Ulice_i_Mosty' },
    { key: 'buildings',   objId: 5, matIdx: 4, name: '5_Budynki_i_Dachy_LoD2' },
    { key: 'highlighted', objId: 6, matIdx: 5, name: '6_Wyroznione_Budynki' },
  ];
  const exportLayers = isCutout ? allExportLayers.filter((l) => l.key !== 'water') : allExportLayers;

  const cutterMod = _get3mfCutterMod();
  const vaultMod = _get3mfVaultMod();
  const useMasterCutter = Boolean(
    !Array.isArray(state) && cutterMod && typeof cutterMod.buildMasterFrameUnifiedTilesForStl === 'function'
  );

  // Pre-build unified seam-exact master tiles when available
  const unifiedTilesById = new Map();
  let cachedMaster = null;
  if (useMasterCutter) {
    if (tileFilter >= 0) {
      unifiedTilesById.set(tileFilter, cutterMod.buildMasterFrameUnifiedTilesForStl(state, tileFilter, { vaultMod }));
    } else {
      for (let tid = 0; tid < numTiles; tid++) {
        unifiedTilesById.set(tid, cutterMod.buildMasterFrameUnifiedTilesForStl(state, tid, { vaultMod }));
      }
    }
    if (typeof cutterMod.getCachedMasterFrameEntry === 'function') {
      cachedMaster = cutterMod.getCachedMasterFrameEntry(state);
    }
  }

  let shiftXScene = halfW;
  let shiftYScene = halfH;
  if (tileFilter >= 0) {
    const customBoundsMm = (cachedMaster && cachedMaster.tileBoundsMmById)
      ? (cachedMaster.tileBoundsMmById.get(tileFilter) || null)
      : null;
    if (customBoundsMm) {
      shiftXScene = -customBoundsMm.minX / scaleMm;
      shiftYScene = -customBoundsMm.minY / scaleMm;
    } else {
      const tc = tileFilter % tileCols;
      const tr = Math.floor(tileFilter / tileCols);
      shiftXScene = halfW - tc * tileSpanX;
      shiftYScene = halfH - tr * tileSpanY;
    }
  }

  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const fmtMm = (v) => (Math.abs(v) < 5e-6 ? '0.00000' : v.toFixed(5));

  /**
   * Builds a 3MF <object> XML chunk and returns its UTF-8 byte buffer (or null if empty).
   * @param {Array<object>} tris
   * @param {number} shiftX
   * @param {number} shiftY
   * @param {number} objId
   * @param {string} objName
   * @param {number} matIdx
   * @returns {Uint8Array|null}
   */
  function buildLayerMeshXmlBytes(tris, shiftX, shiftY, objId, objName, matIdx) {
    const batchVertMap = new Map();
    const fallbackVertMap = new Map();
    const vChunks = [];
    const tChunks = [];
    const matSuffix = `" pid="10" p1="${matIdx}"/>`;

    function getVertIdx(pt, t, vi) {
      const mBatch = t.mBatch;
      if (mBatch !== undefined && vi !== undefined) {
        let bm = batchVertMap.get(mBatch);
        if (!bm) { bm = new Map(); batchVertMap.set(mBatch, bm); }
        let idx = bm.get(vi);
        if (idx === undefined) {
          idx = vChunks.length;
          bm.set(vi, idx);
          const vx = fmtMm((pt[0] + shiftX) * scaleMm);
          const vy = fmtMm((pt[1] + shiftY) * scaleMm);
          const vz = fmtMm(Math.max(0, pt[2] * scaleMm));
          vChunks.push(`<vertex x="${vx}" y="${vy}" z="${vz}"/>`);
        }
        return idx;
      }
      const vx = fmtMm((pt[0] + shiftX) * scaleMm);
      const vy = fmtMm((pt[1] + shiftY) * scaleMm);
      const vz = fmtMm(Math.max(0, pt[2] * scaleMm));
      const key = `${t.tileId ?? 0}_${t.shellId ?? t.buildingId ?? 0}_${vx}_${vy}_${vz}`;
      let idx = fallbackVertMap.get(key);
      if (idx === undefined) {
        idx = vChunks.length;
        fallbackVertMap.set(key, idx);
        vChunks.push(`<vertex x="${vx}" y="${vy}" z="${vz}"/>`);
      }
      return idx;
    }

    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const i0 = getVertIdx(t.v0, t, t.vi0);
      const i1 = getVertIdx(t.v1, t, t.vi1);
      const i2 = getVertIdx(t.v2, t, t.vi2);
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      tChunks.push(`<triangle v1="${i0}" v2="${i1}" v3="${i2}${matSuffix}`);
    }

    if (tChunks.length === 0) return null;
    const objSink = _createUtf8ChunkSink();
    objSink.push(`\n    <object id="${objId}" name="${objName}" type="model" pid="10" pindex="${matIdx}">\n      <mesh>\n        <vertices>`);
    for (let i = 0; i < vChunks.length; i++) objSink.push(vChunks[i]);
    objSink.push(`</vertices>\n        <triangles>`);
    for (let i = 0; i < tChunks.length; i++) objSink.push(tChunks[i]);
    objSink.push(`</triangles>\n      </mesh>\n    </object>`);
    return objSink.toUint8Array();
  }

  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const tileW = Math.round(tileWidthMm);
  const tileH = Math.round(tileHeightMm);
  const tileSuffix = tileFilter >= 0
    ? `_Kafel_${tileFilter + 1}z${numTiles}_${tileW}x${tileH}mm`
    : (numTiles > 1 ? `_${tileCols}x${tileRows}_Kafli_${Math.round(totalWidthMm)}x${Math.round(totalHeightMm)}mm` : `_${Math.round(totalWidthMm)}x${Math.round(totalHeightMm)}mm`);

  const colors = (state && state.colors) || {};
  const cWater = ((colors.water || '#0284c7').replace('#', '')).toUpperCase();
  const cBase = ((colors.base || '#f8fafc').replace('#', '')).toUpperCase();
  const cGreenery = ((colors.greenery || '#15803d').replace('#', '')).toUpperCase();
  const cRoads = ((colors.roads || '#94a3b8').replace('#', '')).toUpperCase();
  const cBuildings = ((colors.buildings || '#cbd5e1').replace('#', '')).toUpperCase();
  const cHighlighted = ((colors.highlighted || colors.buildings || '#cbd5e1').replace('#', '')).toUpperCase();
  const cFrame = (state && state.frameStyle === 'white') ? 'F8FAFC' : '1E293B';

  const byteParts = [];
  const enc = new TextEncoder();
  const pushStr = (s) => { if (s) byteParts.push(enc.encode(s)); };
  const pushBytes = (b) => { if (b && b.byteLength > 0) byteParts.push(b); };

  pushStr(`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="pl-PL" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Map3D_${safeTitle}${tileSuffix}</metadata>
  <metadata name="Application">Map3D Print Studio</metadata>
  <metadata name="Copyright">(c) OpenStreetMap contributors (ODbL 1.0) | AWS Terrain Tiles</metadata>
  <resources>
    <basematerials id="10">
      <base name="Kolor_1_Woda" displaycolor="${cWater}FF"/>
      <base name="Kolor_2_Teren_Warstwice" displaycolor="${cBase}FF"/>
      <base name="Kolor_3_Zielen_i_Drzewa" displaycolor="${cGreenery}FF"/>
      <base name="Kolor_4_Ulice_i_Mosty" displaycolor="${cRoads}FF"/>
      <base name="Kolor_5_Budynki_LoD2" displaycolor="${cBuildings}FF"/>
      <base name="Kolor_6_Akcent_Highlight" displaycolor="${cHighlighted}FF"/>
      <base name="Kolor_7_Ramka" displaycolor="${cFrame}FF"/>
    </basematerials>`);

  const isLayerEnabled = (layerKey) => {
    if (!state || !state.layerVisible) return true;
    if (layerKey === 'greenery') {
      return !(state.layerVisible.greenery === false && state.layerVisible.trees === false);
    }
    return state.layerVisible[layerKey] !== false;
  };

  let buildItemsXml = '';
  const manifestTileRecords = [];
  const skipBadgePrefix = 'Pomini\u0119to eksport .3MF: ';

  if (tileFilter < 0 && numTiles > 1) {
    if (useMasterCutter) {
      for (let tid = 0; tid < numTiles; tid++) {
        const tc = tid % tileCols;
        const tr = Math.floor(tid / tileCols);
        const northRow = tileRows - tr;
        const tris = unifiedTilesById.get(tid) || [];
        const fileRef = `3D/3dmodel.model#Tile_R${northRow}C${tc + 1}`;
        if (tris.length === 0) {
          manifestTileRecords.push({ tileId: tid, fileName: fileRef, bytes: null, skippedEmptyWater: true });
          continue;
        }
        const subObjId = (tid + 1) * 10 + 2;
        const objBytes = buildLayerMeshXmlBytes(
          tris, shiftXScene, shiftYScene, subObjId, `R${northRow}C${tc + 1}_Unified_MSLA`, 1
        );
        if (objBytes) {
          pushBytes(objBytes);
          const assemblyId = 100 + tid;
          pushStr(`\n    <object id="${assemblyId}" name="Kafel_R${northRow}C${tc + 1}_${safeTitle}" type="model">\n      <components><component objectid="${subObjId}"/></components>\n    </object>`);
          buildItemsXml += `<item objectid="${assemblyId}"/>`;
          manifestTileRecords.push({ tileId: tid, fileName: fileRef, bytes: objBytes, skippedEmptyWater: false });
        } else {
          manifestTileRecords.push({ tileId: tid, fileName: fileRef, bytes: null, skippedEmptyWater: true });
        }
      }
    } else {
      const layerTileBuckets = new Map();
      for (const layer of exportLayers) {
        if (!isLayerEnabled(layer.key)) continue;
        const rawTris = meshesObj[layer.key] || [];
        if (rawTris.length === 0) continue;
        const buckets = Array.from({ length: numTiles }, () => []);
        for (let i = 0; i < rawTris.length; i++) {
          const t = rawTris[i];
          const tid = resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows);
          if (tid >= 0 && tid < numTiles) buckets[tid].push(t);
        }
        layerTileBuckets.set(layer.key, buckets);
      }

      for (let tid = 0; tid < numTiles; tid++) {
        let tileComponentsXml = '';
        const tc = tid % tileCols;
        const tr = Math.floor(tid / tileCols);
        const northRow = tileRows - tr;
        const tileChunks = [];
        let tileByteLen = 0;
        for (const layer of exportLayers) {
          const buckets = layerTileBuckets.get(layer.key);
          const tris = buckets ? buckets[tid] : null;
          if (!tris || tris.length === 0) continue;
          const subObjId = (tid + 1) * 10 + layer.objId;
          const objBytes = buildLayerMeshXmlBytes(
            tris, shiftXScene, shiftYScene, subObjId, `R${northRow}C${tc + 1}_${layer.name}`, layer.matIdx
          );
          if (objBytes) {
            pushBytes(objBytes);
            tileChunks.push(objBytes);
            tileByteLen += objBytes.byteLength;
            tileComponentsXml += `<component objectid="${subObjId}"/>`;
          }
        }
        const fileRef = `3D/3dmodel.model#Tile_R${northRow}C${tc + 1}`;
        if (tileComponentsXml) {
          const assemblyId = 100 + tid;
          pushStr(`\n    <object id="${assemblyId}" name="Kafel_R${northRow}C${tc + 1}_${safeTitle}" type="model">\n      <components>${tileComponentsXml}</components>\n    </object>`);
          buildItemsXml += `<item objectid="${assemblyId}"/>`;
          const mergedTileBytes = new Uint8Array(tileByteLen);
          let off = 0;
          for (const ch of tileChunks) { mergedTileBytes.set(ch, off); off += ch.byteLength; }
          manifestTileRecords.push({ tileId: tid, fileName: fileRef, bytes: mergedTileBytes, skippedEmptyWater: false });
        } else {
          manifestTileRecords.push({ tileId: tid, fileName: fileRef, bytes: null, skippedEmptyWater: true });
        }
      }
    }

    if (isCutout && !buildItemsXml) {
      if (typeof document !== 'undefined') {
        const badge = document.getElementById('preflightStatusBadge');
        if (badge) {
          badge.className = 'text-xs font-mono text-amber-400';
          badge.textContent = `${skipBadgePrefix}wszystkie kafle to 100% wyci\u0119ta woda.`;
        }
      }
      return false;
    }
  } else {
    let componentsXml = '';
    const activeTid = tileFilter >= 0 ? tileFilter : 0;
    const singleChunks = [];
    let singleByteLen = 0;
    if (useMasterCutter) {
      const tris = unifiedTilesById.get(activeTid) || [];
      const objBytes = tris.length > 0
        ? buildLayerMeshXmlBytes(tris, shiftXScene, shiftYScene, 2, 'Unified_MSLA_Tile', 1)
        : null;
      if (objBytes) {
        pushBytes(objBytes);
        singleChunks.push(objBytes);
        singleByteLen += objBytes.byteLength;
        componentsXml += `<component objectid="2"/>`;
      }
    } else {
      for (const layer of exportLayers) {
        if (!isLayerEnabled(layer.key)) continue;
        const rawTris = meshesObj[layer.key] || [];
        const tris = tileFilter >= 0
          ? rawTris.filter((t) => resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) === tileFilter)
          : rawTris;
        if (tris.length === 0) continue;
        const objBytes = buildLayerMeshXmlBytes(tris, shiftXScene, shiftYScene, layer.objId, layer.name, layer.matIdx);
        if (objBytes) {
          pushBytes(objBytes);
          singleChunks.push(objBytes);
          singleByteLen += objBytes.byteLength;
          componentsXml += `<component objectid="${layer.objId}"/>`;
        }
      }
    }
    if (isCutout && !componentsXml) {
      if (typeof document !== 'undefined') {
        const badge = document.getElementById('preflightStatusBadge');
        if (badge) {
          badge.className = 'text-xs font-mono text-amber-400';
          badge.textContent = tileFilter >= 0
            ? `${skipBadgePrefix}wybrany kafel to 100% wyci\u0119ta woda.`
            : `${skipBadgePrefix}obszar to 100% wyci\u0119ta woda.`;
        }
      }
      return false;
    }
    const mergedSingleBytes = new Uint8Array(singleByteLen);
    let sOff = 0;
    for (const ch of singleChunks) { mergedSingleBytes.set(ch, sOff); sOff += ch.byteLength; }
    for (let tr = 0; tr < tileRows; tr++) {
      for (let tc = 0; tc < tileCols; tc++) {
        const tid = tr * tileCols + tc;
        const isSelected = tid === activeTid;
        manifestTileRecords.push({
          tileId: tid,
          fileName: `3D/3dmodel.model#Tile_R${tileRows - tr}C${tc + 1}`,
          bytes: isSelected ? mergedSingleBytes : null,
          skippedEmptyWater: !isSelected,
        });
      }
    }
    pushStr(`\n    <object id="99" name="Map3D_${safeTitle}_${Math.round(totalWidthMm)}x${Math.round(totalHeightMm)}mm${tileSuffix}" type="model">\n      <components>${componentsXml}</components>\n    </object>`);
    buildItemsXml = `<item objectid="99"/>`;
  }

  // Emit optional printable outer frame mesh alongside unified tiles when enabled
  const wantFrame3mf = tileFilter < 0 && Boolean(state && state.showFrame) && state.exportFrame !== false && isLayerEnabled('frame');
  const frameTris3mf = wantFrame3mf ? (meshesObj.frame || []) : [];
  if (frameTris3mf.length > 0) {
    const frameBytes = buildLayerMeshXmlBytes(frameTris3mf, shiftXScene, shiftYScene, 900, '7_Ramka_Passe_Partout', 6);
    if (frameBytes) {
      pushBytes(frameBytes);
      buildItemsXml += `<item objectid="900"/>`;
    }
  }

  pushStr(`\n  </resources>\n  <build>\n    ${buildItemsXml}\n  </build>\n</model>`);
  let totalModelBytes = 0;
  for (let i = 0; i < byteParts.length; i++) totalModelBytes += byteParts[i].byteLength;
  const modelXmlBytes = new Uint8Array(totalModelBytes);
  let mOff = 0;
  for (let i = 0; i < byteParts.length; i++) {
    modelXmlBytes.set(byteParts[i], mOff);
    mOff += byteParts[i].byteLength;
  }

  const zipEntries = [
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: relsXml },
    { name: '3D/3dmodel.model', content: modelXmlBytes },
  ];
  try {
    const manifestFn = (typeof buildAssemblyManifest === 'function')
      ? buildAssemblyManifest
      : (typeof require !== 'undefined' ? require('./assembly_manifest.js').buildAssemblyManifest : null);
    if (typeof manifestFn === 'function') {
      const manifestObj = manifestFn(state, manifestTileRecords, null);
      zipEntries.push({ name: 'Metadata/assembly_manifest.json', content: JSON.stringify(manifestObj, null, 2) });
    }
  } catch (_) {}

  const zipBytes = createZipArchive(zipEntries);

  downloadBlob(zipBytes, `Map3D_${safeTitle}${tileSuffix}_Multicolor.3mf`, 'model/3mf');
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportMultiColor3MF };
}
