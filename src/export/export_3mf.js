// ============================================================================
// src/export/export_3mf.js
// Real Multi-Volume .3MF (ZIP + 3D Manufacturing XML) Exporter with Per-Tile Assemblies
// ============================================================================

if (typeof createZipArchive === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./export_io_utils.js'));
}
if (typeof resolveSceneScaleAndSpec === 'undefined' && typeof require !== 'undefined') {
  try { Object.assign(global, require('../geometry/print_physics_config.js')); } catch (_) {}
}

function exportMultiColor3MF(state) {
  const {
    totalWidthMm,
    totalHeightMm,
    scaleMm,
    halfW,
    halfH
  } = resolveSceneScaleAndSpec(state, null);

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
    { key: 'highlighted', objId: 6, matIdx: 5, name: '6_Wyroznione_Budynki' }
  ];
  const exportLayers = isCutout ? allExportLayers.filter(l => l.key !== 'water') : allExportLayers;

  let shiftXScene = halfW;
  let shiftYScene = halfH;
  if (tileFilter >= 0) {
    const tc = tileFilter % tileCols;
    const tr = Math.floor(tileFilter / tileCols);
    shiftXScene = halfW - tc * tileSpanX;
    shiftYScene = halfH - tr * tileSpanY;
  }

  let objectsXml = '';
  let buildItemsXml = '';
  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};

  function buildLayerMeshXml(tris, shiftX, shiftY, objId, objName, matIdx) {
    const vertexMap = new Map();
    const vChunks = [];
    const tChunks = [];
    const fmtMm = (v) => (Math.abs(v) < 5e-6 ? 0 : v).toFixed(5);

    function getIndexedVertexIndex(pt, shellTag, mBatch, vi) {
      const vx = fmtMm((pt[0] + shiftX) * scaleMm);
      const vy = fmtMm((pt[1] + shiftY) * scaleMm);
      const vz = fmtMm(Math.max(0, pt[2] * scaleMm));
      const key = (mBatch !== undefined && vi !== undefined)
        ? `${mBatch}_${vi}`
        : `${shellTag}_${vx}_${vy}_${vz}`;
      let idx = vertexMap.get(key);
      if (idx === undefined) {
        idx = vChunks.length;
        vertexMap.set(key, idx);
        vChunks.push(`<vertex x="${vx}" y="${vy}" z="${vz}"/>`);
      }
      return idx;
    }

    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const shellTag = `${t.tileId ?? 0}_${t.shellId ?? t.buildingId ?? 0}`;
      const i0 = getIndexedVertexIndex(t.v0, shellTag, t.mBatch, t.vi0);
      const i1 = getIndexedVertexIndex(t.v1, shellTag, t.mBatch, t.vi1);
      const i2 = getIndexedVertexIndex(t.v2, shellTag, t.mBatch, t.vi2);
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      tChunks.push(`<triangle v1="${i0}" v2="${i1}" v3="${i2}" pid="10" p1="${matIdx}"/>`);
    }

    if (tChunks.length === 0) return '';
    return `
    <object id="${objId}" name="${objName}" type="model" pid="10" pindex="${matIdx}">
      <mesh>
        <vertices>${vChunks.join('')}</vertices>
        <triangles>${tChunks.join('')}</triangles>
      </mesh>
    </object>`;
  }

  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const tileW = Math.round(tileWidthMm);
  const tileH = Math.round(tileHeightMm);
  const tileSuffix = tileFilter >= 0
    ? `_Kafel_${tileFilter + 1}z${numTiles}_${tileW}x${tileH}mm`
    : (numTiles > 1 ? `_${tileCols}x${tileRows}_Kafli_${Math.round(totalWidthMm)}x${Math.round(totalHeightMm)}mm` : `_${Math.round(totalWidthMm)}x${Math.round(totalHeightMm)}mm`);

  if (tileFilter < 0 && numTiles > 1) {
    for (let tid = 0; tid < numTiles; tid++) {
      let tileComponentsXml = '';
      const tc = tid % tileCols;
      const tr = Math.floor(tid / tileCols);
      const northRow = tileRows - tr;
      exportLayers.forEach(layer => {
        if (state && state.layerVisible) {
          if (layer.key === 'greenery') {
            if (state.layerVisible.greenery === false && state.layerVisible.trees === false) return;
          } else if (state.layerVisible[layer.key] === false) return;
        }
        const rawTris = meshesObj[layer.key] || [];
        const tris = rawTris.filter(t => resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) === tid);
        if (tris.length === 0) return;
        const subObjId = (tid + 1) * 10 + layer.objId;
        const meshXml = buildLayerMeshXml(tris, shiftXScene, shiftYScene, subObjId, `R${northRow}C${tc + 1}_${layer.name}`, layer.matIdx);
        if (meshXml) {
          objectsXml += meshXml;
          tileComponentsXml += `<component objectid="${subObjId}"/>`;
        }
      });
      if (tileComponentsXml) {
        const assemblyId = 100 + tid;
        objectsXml += `
    <object id="${assemblyId}" name="Kafel_R${northRow}C${tc + 1}_${safeTitle}" type="model">
      <components>${tileComponentsXml}</components>
    </object>`;
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
    exportLayers.forEach(layer => {
      if (state && state.layerVisible) {
        if (layer.key === 'greenery') {
          if (state.layerVisible.greenery === false && state.layerVisible.trees === false) return;
        } else if (state.layerVisible[layer.key] === false) return;
      }
      const rawTris = meshesObj[layer.key] || [];
      const tris = tileFilter >= 0
        ? rawTris.filter(t => resolveTriangleTileId(t, halfW, halfH, tileCols, tileRows) === tileFilter)
        : rawTris;
      if (tris.length === 0) return;
      const meshXml = buildLayerMeshXml(tris, shiftXScene, shiftYScene, layer.objId, layer.name, layer.matIdx);
      if (meshXml) {
        objectsXml += meshXml;
        componentsXml += `<component objectid="${layer.objId}"/>`;
      }
    });
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
    objectsXml += `
    <object id="99" name="Map3D_${safeTitle}_${Math.round(totalWidthMm)}x${Math.round(totalHeightMm)}mm${tileSuffix}" type="model">
      <components>${componentsXml}</components>
    </object>`;
    buildItemsXml = `<item objectid="99"/>`;
  }

  const colors = (state && state.colors) || {};
  const cWater = ((colors.water || '#0284c7').replace('#', '')).toUpperCase();
  const cBase = ((colors.base || '#f8fafc').replace('#', '')).toUpperCase();
  const cGreenery = ((colors.greenery || '#15803d').replace('#', '')).toUpperCase();
  const cRoads = ((colors.roads || '#94a3b8').replace('#', '')).toUpperCase();
  const cBuildings = ((colors.buildings || '#cbd5e1').replace('#', '')).toUpperCase();
  const cHighlighted = ((colors.highlighted || colors.buildings || '#cbd5e1').replace('#', '')).toUpperCase();

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
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
    </basematerials>
    ${objectsXml}
  </resources>
  <build>
    ${buildItemsXml}
  </build>
</model>`;

  const zipBytes = createZipArchive([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: relsXml },
    { name: '3D/3dmodel.model', content: modelXml }
  ]);

  downloadBlob(zipBytes, `Map3D_${safeTitle}${tileSuffix}_Multicolor.3mf`, 'model/3mf');
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportMultiColor3MF };
}
