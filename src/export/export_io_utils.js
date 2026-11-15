// src/export/export_io_utils.js — ZIP (__FFLATE__.zipSync + store fallback), slug, downloadBlob & ASCII grid
function _encodeRawBytes(raw, enc) {
  if (typeof raw === 'string') return enc.encode(raw);
  if (ArrayBuffer.isView(raw)) return raw.constructor === Uint8Array ? raw : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(0);
}

function _crc32Fallback(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) {
    c ^= u8[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function createZipArchive(files) {
  const list = Array.isArray(files) ? files : [];
  const enc = new TextEncoder();
  const fflate = (typeof __FFLATE__ !== 'undefined' && __FFLATE__) || (typeof globalThis !== 'undefined' && globalThis.__FFLATE__);
  if (fflate && typeof fflate.zipSync === 'function') {
    const zipObj = {};
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      zipObj[String((f && f.name) || `file_${i}`)] = [_encodeRawBytes(f ? (f.content !== undefined ? f.content : f.data) : '', enc), { level: 0 }];
    }
    return fflate.zipSync(zipObj, { level: 0 });
  }
  const nodeZlib = typeof require === 'function' ? (() => { try { return require('zlib'); } catch (_) { return null; } })() : null;
  let localSize = 0, centralSize = 0, off = 0;
  const entries = list.map((f, i) => {
    const nb = enc.encode(String((f && f.name) || `file_${i}`));
    const db = _encodeRawBytes(f ? (f.content !== undefined ? f.content : f.data) : '', enc);
    const crc = (nodeZlib && typeof nodeZlib.crc32 === 'function') ? (nodeZlib.crc32(db) >>> 0) : _crc32Fallback(db);
    localSize += 30 + nb.length + db.length; centralSize += 46 + nb.length;
    return { nb, db, crc, offset: 0 };
  });
  const out = new Uint8Array(localSize + centralSize + 22), v = new DataView(out.buffer);
  for (const e of entries) {
    e.offset = off;
    v.setUint32(off, 0x04034b50, true); v.setUint16(off + 4, 20, true); v.setUint32(off + 14, e.crc, true);
    v.setUint32(off + 18, e.db.length, true); v.setUint32(off + 22, e.db.length, true); v.setUint16(off + 26, e.nb.length, true);
    out.set(e.nb, off + 30); out.set(e.db, off + 30 + e.nb.length); off += 30 + e.nb.length + e.db.length;
  }
  const cdOff = off;
  for (const e of entries) {
    v.setUint32(off, 0x02014b50, true); v.setUint16(off + 4, 20, true); v.setUint16(off + 6, 20, true);
    v.setUint32(off + 16, e.crc, true); v.setUint32(off + 20, e.db.length, true); v.setUint32(off + 24, e.db.length, true);
    v.setUint16(off + 28, e.nb.length, true); v.setUint32(off + 42, e.offset, true);
    out.set(e.nb, off + 46); off += 46 + e.nb.length;
  }
  v.setUint32(off, 0x06054b50, true); v.setUint16(off + 8, entries.length, true);
  v.setUint16(off + 10, entries.length, true); v.setUint32(off + 12, centralSize, true); v.setUint32(off + 16, cdOff, true);
  return out;
}

function sanitizeFilenameSlug(text) {
  const map = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z', 'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z', 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'AE', 'Ö': 'OE', 'Ü': 'UE' };
  const s = String(text || 'MAP3D').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻäöüßÄÖÜ]/g, ch => map[ch] || ch);
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'MAP3D';
}

function downloadBlob(uint8Array, filename, mime) {
  if (typeof globalThis !== 'undefined' && typeof globalThis.downloadBlobHook === 'function') {
    globalThis.downloadBlobHook(uint8Array, filename, mime); return;
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const url = URL.createObjectURL(new Blob([uint8Array], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 250);
}

function generateAsciiGrid(tileCols, tileRows) {
  const colW = 14, hSep = '+' + Array(tileCols).fill('-'.repeat(colW)).join('+') + '+';
  const lines = ['       [PÓŁNOC / NORTH / GÓRA OBRAZU (ŚCIANA)]', hSep];
  for (let r = 1; r <= tileRows; r++) {
    const cells = [];
    for (let c = 1; c <= tileCols; c++) {
      let tag = `R${r}C${c}`;
      if (r === 1 && c === 1) tag += ' (NW)'; else if (r === 1 && c === tileCols) tag += ' (NE)';
      else if (r === tileRows && c === 1) tag += ' (SW)'; else if (r === tileRows && c === tileCols) tag += ' (SE)';
      const pL = Math.floor((colW - tag.length) / 2);
      cells.push(' '.repeat(pL) + tag + ' '.repeat(colW - tag.length - pL));
    }
    lines.push('|' + cells.join('|') + '|', hSep);
  }
  lines.push('     [POŁUDNIE / SOUTH / DÓŁ OBRAZU]');
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createZipArchive, sanitizeFilenameSlug, downloadBlob, generateAsciiGrid };
}
