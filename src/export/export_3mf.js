// ============================================================================
// src/export/export_3mf.js
// Real Multi-Volume .3MF (ZIP + 3D Manufacturing XML) Exporter with Per-Tile Assemblies
// ============================================================================

if (typeof createZipArchive === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./crc32_zip.js'));
}

function exportMultiColor3MF(state) {
  const totalWidthMm = (state && state.bedSizeMm) || 320.0;
  const totalHeightMm = (state && state.totalHeightMm) || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const halfW = 84.6 * (totalWidthMm / maxDimMm);
  const halfH = 84.6 * (totalHeightMm / maxDimMm);

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

  const exportLayers = [
    { key: 'water',       objId: 1, matIdx: 0, name: '1_Woda_i_Batymetria' },
    { key: 'base',        objId: 2, matIdx: 1, name: '2_Teren_Warstwice_DEM' },
    { key: 'greenery',    objId: 3, matIdx: 2, name: '3_Zielen_Parki_i_Drzewa_3D' },
    { key: 'roads',       objId: 4, matIdx: 3, name: '4_Ulice_i_Mosty' },
    { key: 'buildings',   objId: 5, matIdx: 4, name: '5_Budynki_i_Dachy_LoD2' },
    { key: 'highlighted', objId: 6, matIdx: 5, name: '6_Wyroznione_Budynki' }
  ];

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

    function getWeldedVertexIndex(pt, shellTag) {
      const vx = ((pt[0] + shiftX) * scaleMm).toFixed(3);
      const vy = ((pt[1] + shiftY) * scaleMm).toFixed(3);
      const vz = Math.max(0, pt[2] * scaleMm).toFixed(3);
      const key = `${shellTag}_${vx}_${vy}_${vz}`;
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
      const i0 = getWeldedVertexIndex(t.v0, shellTag);
      const i1 = getWeldedVertexIndex(t.v1, shellTag);
      const i2 = getWeldedVertexIndex(t.v2, shellTag);
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
        if (state && state.layerVisible && !state.layerVisible[layer.key]) return;
        const rawTris = meshesObj[layer.key] || [];
        const tris = rawTris.filter(t => t.tileId === tid);
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
  } else {
    let componentsXml = '';
    exportLayers.forEach(layer => {
      if (state && state.layerVisible && !state.layerVisible[layer.key]) return;
      const rawTris = meshesObj[layer.key] || [];
      const tris = tileFilter >= 0 ? rawTris.filter(t => t.tileId === tileFilter) : rawTris;
      if (tris.length === 0) return;
      const meshXml = buildLayerMeshXml(tris, shiftXScene, shiftYScene, layer.objId, layer.name, layer.matIdx);
      if (meshXml) {
        objectsXml += meshXml;
        componentsXml += `<component objectid="${layer.objId}"/>`;
      }
    });
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
      <base name="Kolor_4_Budynki_LoD2" displaycolor="${cBuildings}FF"/>
      <base name="Kolor_5_Akcent_Highlight" displaycolor="${cHighlighted}FF"/>
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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportMultiColor3MF };
}
