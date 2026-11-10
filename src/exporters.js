// ============================================================================
// src/exporters.js
// Real Multi-Volume .3MF (ZIP + 3D Manufacturing XML) & Binary .STL Exporters
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

function exportMultiColor3MF(state) {
  const scaleMm = state.bedSizeMm / 170.0;
  const offsetMm = state.bedSizeMm / 2.0;

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

  let objectsXml = '';
  let componentsXml = '';

  exportLayers.forEach(layer => {
    if (!state.layerVisible[layer.key]) return;
    const tris = state.layerMeshes[layer.key] || [];
    if (tris.length === 0) return;

    const vChunks = [];
    const tChunks = [];
    let vIdx = 0;

    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const pts = [t.v0, t.v1, t.v2];
      for (let k = 0; k < 3; k++) {
        const vx = (pts[k][0] * scaleMm + offsetMm).toFixed(3);
        const vy = (pts[k][1] * scaleMm + offsetMm).toFixed(3);
        const vz = (pts[k][2] * scaleMm).toFixed(3);
        vChunks.push(`<vertex x="${vx}" y="${vy}" z="${vz}"/>`);
      }
      tChunks.push(`<triangle v1="${vIdx}" v2="${vIdx + 1}" v3="${vIdx + 2}" pid="10" p1="${layer.matIdx}"/>`);
      vIdx += 3;
    }

    objectsXml += `
    <object id="${layer.objId}" name="${layer.name}" type="model" pid="10" pindex="${layer.matIdx}">
      <mesh>
        <vertices>${vChunks.join('')}</vertices>
        <triangles>${tChunks.join('')}</triangles>
      </mesh>
    </object>`;
    componentsXml += `<component objectid="${layer.objId}"/>`;
  });

  const safeTitle = (state.plaqueText || 'MAP3D').replace(/[^a-zA-Z0-9_-]/g, '_');
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="pl-PL" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Map3D_${safeTitle}</metadata>
  <metadata name="Application">Map3D Print Studio</metadata>
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
    <object id="99" name="Map3D_${safeTitle}_${state.bedSizeMm}mm" type="model">
      <components>${componentsXml}</components>
    </object>
  </resources>
  <build>
    <item objectid="99"/>
  </build>
</model>`;

  const zipBytes = createZipArchive([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: relsXml },
    { name: '3D/3dmodel.model', content: modelXml }
  ]);

  downloadBlob(zipBytes, `Map3D_${safeTitle}_${state.bedSizeMm}x${state.bedSizeMm}mm_Multicolor.3mf`, 'model/3mf');
}

function exportBinarySTL(state, layerFilter = 'all') {
  const scaleMm = state.bedSizeMm / 170.0;
  const offsetMm = state.bedSizeMm / 2.0;

  const keys = layerFilter === 'all'
    ? ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted']
    : [layerFilter];

  const allTris = [];
  keys.forEach(k => {
    if (layerFilter === 'all' && !state.layerVisible[k]) return;
    const arr = state.layerMeshes[k] || [];
    for (let i = 0; i < arr.length; i++) allTris.push(arr[i]);
  });

  const buf = new ArrayBuffer(84 + allTris.length * 50);
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
      view.setFloat32(baseOff, pts[v][0] * scaleMm + offsetMm, true);
      view.setFloat32(baseOff + 4, pts[v][1] * scaleMm + offsetMm, true);
      view.setFloat32(baseOff + 8, pts[v][2] * scaleMm, true);
    }
    view.setUint16(offset + 48, t.layerId, true);
    offset += 50;
  }

  const safeTitle = (state.plaqueText || 'MAP3D').replace(/[^a-zA-Z0-9_-]/g, '_');
  const suffix = layerFilter === 'all' ? 'Pelna_Bryla' : `Warstwa_${layerFilter}`;
  downloadBlob(new Uint8Array(buf), `Map3D_${safeTitle}_${suffix}.stl`, 'model/stl');
}
