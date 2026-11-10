// ============================================================================
// src/export_3mf.js
// Real Multi-Volume .3MF (ZIP + 3D Manufacturing XML) Exporter with Per-Tile Assemblies
// ============================================================================

function exportMultiColor3MF(state) {
  const totalWidthMm = state.bedSizeMm || 320.0;
  const scaleMm = totalWidthMm / 169.2;
  const offsetMm = totalWidthMm / 2.0;
  const tileCols = Math.max(1, state.tileCols || 1);
  const tileRows = Math.max(1, state.tileRows || 1);
  const tileFilter = (state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
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

  // Strictly 6 printable layers ONLY — meshes.frame is NEVER exported!
  const exportLayers = [
    { key: 'water',       objId: 1, matIdx: 0, name: '1_Woda_i_Batymetria' },
    { key: 'base',        objId: 2, matIdx: 1, name: '2_Teren_Warstwice_DEM' },
    { key: 'greenery',    objId: 3, matIdx: 2, name: '3_Zielen_Parki_i_Drzewa_3D' },
    { key: 'roads',       objId: 4, matIdx: 3, name: '4_Ulice_i_Mosty' },
    { key: 'buildings',   objId: 5, matIdx: 4, name: '5_Budynki_i_Dachy_LoD2' },
    { key: 'highlighted', objId: 6, matIdx: 5, name: '6_Wyroznione_Budynki' }
  ];

  // If exporting a single tile, shift its minimum X/Y to (0, 0) on the printer plate
  let shiftXScene = 84.6;
  let shiftYScene = 84.6;
  if (tileFilter >= 0 && (tileCols > 1 || tileRows > 1)) {
    const tc = tileFilter % tileCols;
    const tr = Math.floor(tileFilter / tileCols);
    shiftXScene = 84.6 - tc * (169.2 / tileCols);
    shiftYScene = 84.6 - tr * (169.2 / tileRows);
  }

  let objectsXml = '';
  let buildItemsXml = '';
  const numTiles = tileCols * tileRows;

  function buildLayerMeshXml(tris, shiftX, shiftY, objId, objName, matIdx) {
    const vertexMap = new Map();
    const vChunks = [];
    const tChunks = [];

    function getWeldedVertexIndex(pt) {
      const vx = ((pt[0] + shiftX) * scaleMm).toFixed(3);
      const vy = ((pt[1] + shiftY) * scaleMm).toFixed(3);
      const vz = Math.max(0, pt[2] * scaleMm).toFixed(3);
      const key = `${vx}_${vy}_${vz}`;
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
      const i0 = getWeldedVertexIndex(t.v0);
      const i1 = getWeldedVertexIndex(t.v1);
      const i2 = getWeldedVertexIndex(t.v2);
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

  const safeTitle = sanitizeFilenameSlug(state.plaqueText || 'MAP3D');
  const tileSuffix = tileFilter >= 0 ? `_Kafel_${tileFilter + 1}z${numTiles}` : (numTiles > 1 ? `_${tileCols}x${tileRows}_Kafli` : '');

  if (tileFilter < 0 && numTiles > 1) {
    // Fix B16: Group multi-tile .3MF into per-tile assembly objects so slicers can plate each tile separately
    for (let tid = 0; tid < numTiles; tid++) {
      let tileComponentsXml = '';
      const tc = tid % tileCols;
      const tr = Math.floor(tid / tileCols);
      const northRow = tileRows - tr;
      exportLayers.forEach(layer => {
        if (!state.layerVisible[layer.key]) return;
        const rawTris = state.layerMeshes[layer.key] || [];
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
      if (!state.layerVisible[layer.key]) return;
      const rawTris = state.layerMeshes[layer.key] || [];
      const tris = tileFilter >= 0 ? rawTris.filter(t => t.tileId === tileFilter) : rawTris;
      if (tris.length === 0) return;
      const meshXml = buildLayerMeshXml(tris, shiftXScene, shiftYScene, layer.objId, layer.name, layer.matIdx);
      if (meshXml) {
        objectsXml += meshXml;
        componentsXml += `<component objectid="${layer.objId}"/>`;
      }
    });
    objectsXml += `
    <object id="99" name="Map3D_${safeTitle}_${totalWidthMm}mm${tileSuffix}" type="model">
      <components>${componentsXml}</components>
    </object>`;
    buildItemsXml = `<item objectid="99"/>`;
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="pl-PL" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Map3D_${safeTitle}${tileSuffix}</metadata>
  <metadata name="Application">Map3D Print Studio</metadata>
  <metadata name="Copyright">© OpenStreetMap contributors (ODbL 1.0) • AWS Terrain Tiles</metadata>
  <resources>
    <basematerials id="10">
      <base name="Kolor_1_Woda" displaycolor="${state.colors.water.toUpperCase()}FF"/>
      <base name="Kolor_2_Teren_Warstwice" displaycolor="${state.colors.base.toUpperCase()}FF"/>
      <base name="Kolor_3_Zielen_i_Drzewa" displaycolor="${state.colors.greenery.toUpperCase()}FF"/>
      <base name="Kolor_4_Ulice_i_Mosty" displaycolor="${state.colors.roads.toUpperCase()}FF"/>
      <base name="Kolor_4_Budynki_LoD2" displaycolor="${state.colors.buildings.toUpperCase()}FF"/>
      <base name="Kolor_5_Akcent_Highlight" displaycolor="${state.colors.highlighted.toUpperCase()}FF"/>
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

  downloadBlob(zipBytes, `Map3D_${safeTitle}_${totalWidthMm}mm${tileSuffix}_Multicolor.3mf`, 'model/3mf');
}

