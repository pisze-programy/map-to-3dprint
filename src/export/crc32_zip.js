// ============================================================================
// src/export/crc32_zip.js
// IEEE 802.3 CRC32, Uncompressed Store ZIP Builder, Slug Sanitizer & ASCII Wall Grid
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
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    crc32,
    createZipArchive,
    sanitizeFilenameSlug,
    downloadBlob,
    generateAsciiGrid
  };
}
