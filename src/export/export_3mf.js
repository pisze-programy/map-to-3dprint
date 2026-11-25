// ============================================================================
// src/export/export_3mf.js
// Real Multi-Volume .3MF (ZIP + 3D Manufacturing XML) Streaming Byte Exporter
// O(T) Single-Pass Tile Bucketing & Zero Giant-String V8 Allocation
// ============================================================================

if (typeof createZipArchive === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./export_io_utils.js'));
}
if (typeof resolveSceneScaleAndSpec === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('../geometry/print_physics_config.js')); } catch (_) {}
}

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

  let shiftXScene = halfW;
  let shiftYScene = halfH;
  if (tileFilter >= 0) {
    const tc = tileFilter % tileCols;
    const tr = Math.floor(tileFilter / tileCols);
    shiftXScene = halfW - tc * tileSpanX;
    shiftYScene = halfH - tr * tileSpanY;
  }

  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const fmtMm = (v) => (Math.abs(v) < 5e-6 ? '0.00000' : v.toFixed(5));

  function appendLayerMeshXml(sink, tris, shiftX, shiftY, objId, objName, matIdx) {
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

    if (tChunks.length === 0) return false;
    sink.push(`\n    <object id="${objId}" name="${objName}" type="model" pid="10" pindex="${matIdx}">\n      <mesh>\n        <vertices>`);
    for (let i = 0; i < vChunks.length; i++) sink.push(vChunks[i]);
    sink.push(`</vertices>\n        <triangles>`);
    for (let i = 0; i < tChunks.length; i++) sink.push(tChunks[i]);
    sink.push(`</triangles>\n      </mesh>\n    </object>`);
    return true;
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

  const sink = _createUtf8ChunkSink();
  sink.push(`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="pl-PL" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Map3D_${safeTitle}${tileSuffix}</metadata>
  <metadata name="Application">Map3D Print Studio</metadata>
  <metadata name="Copyright">© OpenStreetMap contributors (ODbL 1.0) • AWS Terrain Tiles</metadata>
  <resources>
    <basematerials id="10">
      <base name="Kolor_1_Woda" displaycolor="${cWater}FF"/>
      <base name="Kolor_2_Teren_Warstwice" displaycolor="${cBase}FF"/>
      <base name="Kolor_3_Zielen_i_Drzewa" displaycolor="${cGreenery}FF"/>
      <base name="Kolor_4_Ulice_i_Mosty" displaycolor="${cRoads}FF"/>
      <base name="Kolor_5_Budynki_LoD2" displaycolor="${cBuildings}FF"/>
      <base name="Kolor_6_Akcent_Highlight" displaycolor="${cHighlighted}FF"/>
    </basematerials>`);

  const isLayerEnabled = (layerKey) => {
    if (!state || !state.layerVisible) return true;
    if (layerKey === 'greenery') {
      return !(state.layerVisible.greenery === false && state.layerVisible.trees === false);
    }
    return state.layerVisible[layerKey] !== false;
  };

  let buildItemsXml = '';

  if (tileFilter < 0 && numTiles > 1) {
    // O(T) single-pass per-layer tile bucketing instead of O(numTiles * T) repeated .filter()
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
      for (const layer of exportLayers) {
        const buckets = layerTileBuckets.get(layer.key);
        const tris = buckets ? buckets[tid] : null;
        if (!tris || tris.length === 0) continue;
        const subObjId = (tid + 1) * 10 + layer.objId;
        if (appendLayerMeshXml(sink, tris, shiftXScene, shiftYScene, subObjId, `R${northRow}C${tc + 1}_${layer.name}`, layer.matIdx)) {
          tileComponentsXml += `<component objectid="${subObjId}"/>`;
        }
      }
      if (tileComponentsXml) {
        const assemblyId = 100 + tid;
        sink.push(`\n    <object id="${assemblyId}" name="Kafel_R${northRow}C${tc + 1}_${safeTitle}" type="model">\n      <components>${tileComponentsXml}</components>\n    </object>`);
        buildItemsXml += `<item objectid="${assemblyId}"/>`;
      }
    }
    if (isCutout && !buildItemsXml) {
      if (typeof document !== 'undefined') {
        const badge = document.getElementById('preflightStatusBadge');
        if (badge) {
          badge.className = 'text-xs font-mono text-amber-400';
          badge.textContent = 'Pominięto eksport .3MF: wszystkie kafle to 100% wycięta woda.';
        }
      }
      return false;
    }
  } else {
    let componentsXml = '';
    for (const layer of exportLayers) {
      if (!isLayerEnabled(layer.key)) continue;
      const rawTris = meshesObj[layer.key] || [];
      const tris = tileFilter >= 0
        ? rawTris.filter((t) => resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) === tileFilter)
        : rawTris;
      if (tris.length === 0) continue;
      if (appendLayerMeshXml(sink, tris, shiftXScene, shiftYScene, layer.objId, layer.name, layer.matIdx)) {
        componentsXml += `<component objectid="${layer.objId}"/>`;
      }
    }
    if (isCutout && !componentsXml) {
      if (typeof document !== 'undefined') {
        const badge = document.getElementById('preflightStatusBadge');
        if (badge) {
          badge.className = 'text-xs font-mono text-amber-400';
          badge.textContent = tileFilter >= 0
            ? 'Pominięto eksport .3MF: wybrany kafel to 100% wycięta woda.'
            : 'Pominięto eksport .3MF: obszar to 100% wycięta woda.';
        }
      }
      return false;
    }
    sink.push(`\n    <object id="99" name="Map3D_${safeTitle}_${Math.round(totalWidthMm)}x${Math.round(totalHeightMm)}mm${tileSuffix}" type="model">\n      <components>${componentsXml}</components>\n    </object>`);
    buildItemsXml = `<item objectid="99"/>`;
  }

  sink.push(`\n  </resources>\n  <build>\n    ${buildItemsXml}\n  </build>\n</model>`);
  const modelXmlBytes = sink.toUint8Array();

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
      const recPlaceholder = [];
      for (let tr = 0; tr < tileRows; tr++) {
        for (let tc = 0; tc < tileCols; tc++) {
          const tid = tr * tileCols + tc;
          recPlaceholder.push({ tileId: tid, fileName: `3D/3dmodel.model#Tile_R${tileRows - tr}C${tc + 1}`, bytes: null, skippedEmptyWater: false });
        }
      }
      const manifestObj = manifestFn(state, recPlaceholder, null);
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
