'use strict';

/**
 * Headless 3D Print Scene Harness (CommonJS)
 *
 * Pure-Node execution environment for the production GIS, mesh, shader-math,
 * and UI-config pipeline without any browser or local server dependency.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const https = require('https');

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Exact headless-compatible module load order matching build_app.py (stages 1-5)
 * plus WebGL math/shaders and UI config/rotation modules.
 */
const PIPELINE_SCRIPTS = [
  'src/vendor/vendor_bundle.js',
  'src/vendor/manifold_vendor.js',
  'src/geometry/print_physics_config.js',
  'src/geometry/sla_print_laws.js',
  'src/geometry/polygon_2d.js',
  'src/geometry/obb_medial_2d.js',
  'src/geometry/manifold_core.js',
  'src/mesh/mesh_primitives.js',
  'src/mesh/mesh_clipper_3d.js',
  'src/mesh/layer1_terrain_water.js',
  'src/mesh/s3db_roof_revolve.js',
  'src/mesh/s3db_roof_skeleton.js',
  'src/mesh/s3db_part_builder.js',
  'src/mesh/layer1_s3db_buildings.js',
  'src/mesh/layer1_bridges.js',
  'src/mesh/layer2_archetypes.js',
  'src/mesh/layer3_invariants_tiles.js',
  'src/mesh/mesh_builder.js',
  'src/render/webgl_math.js',
  'src/render/webgl_shaders.js',
  'src/gis_client/overpass_dem_fetch.js',
  'src/gis_client/s3db_unit_parser.js',
  'src/gis_client/s3db_relation_helper.js',
  'src/gis_client/s3db_client_matcher.js',
  'src/gis_client/osm_water_extract.js',
  'src/gis_client/osm_bridges_piers_extract.js',
  'src/gis_client/osm_greenery_extract.js',
  'src/gis_client/osm_roads_extract.js',
  'src/gis_client/osm_trees_extract.js',
  'src/gis_client/osm_buildings_extract.js',
  'src/gis_client/osm_scene_builder.js',
  'src/gis_client/overpass_chunk_grid.js',
  'src/gis_client/gis_chunk_streamer.js',
  'src/ui/ui_config.js',
  'src/ui/map_rotation.js',
  'src/ui/fast_render_manager.js',
  'src/ui/ui_map2d.js',
];

// ============================================================================
// Pure-Node PNG Decoder (Filters 0..4, Color Types 0, 2, 3, 4, 6, Adam7)
// ============================================================================

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterPngScanline(filterType, raw, rowOffset, priorRow, bytesPerRow, bpp) {
  const out = new Uint8Array(bytesPerRow);
  if (filterType === 0) {
    out.set(raw.subarray(rowOffset, rowOffset + bytesPerRow));
  } else if (filterType === 1) {
    for (let i = 0; i < bytesPerRow; i++) {
      const left = i >= bpp ? out[i - bpp] : 0;
      out[i] = (raw[rowOffset + i] + left) & 0xff;
    }
  } else if (filterType === 2) {
    for (let i = 0; i < bytesPerRow; i++) {
      const up = priorRow ? priorRow[i] : 0;
      out[i] = (raw[rowOffset + i] + up) & 0xff;
    }
  } else if (filterType === 3) {
    for (let i = 0; i < bytesPerRow; i++) {
      const left = i >= bpp ? out[i - bpp] : 0;
      const up = priorRow ? priorRow[i] : 0;
      out[i] = (raw[rowOffset + i] + ((left + up) >> 1)) & 0xff;
    }
  } else if (filterType === 4) {
    for (let i = 0; i < bytesPerRow; i++) {
      const left = i >= bpp ? out[i - bpp] : 0;
      const up = priorRow ? priorRow[i] : 0;
      const upLeft = (priorRow && i >= bpp) ? priorRow[i - bpp] : 0;
      out[i] = (raw[rowOffset + i] + paethPredictor(left, up, upLeft)) & 0xff;
    }
  } else {
    throw new Error(`Unsupported PNG scanline filter type: ${filterType}`);
  }
  return out;
}

function readSampleAt(scanline, x, sampleCount, bitDepth, channel) {
  const idx = x * sampleCount + channel;
  if (bitDepth === 8) return scanline[idx];
  if (bitDepth === 16) return scanline[idx * 2];
  const samplesPerByte = 8 / bitDepth;
  const byteIdx = Math.floor(idx / samplesPerByte);
  const subIdx = idx % samplesPerByte;
  const shift = 8 - bitDepth * (subIdx + 1);
  const mask = (1 << bitDepth) - 1;
  return (scanline[byteIdx] >> shift) & mask;
}

function scaleLowBitTo255(val, bitDepth) {
  if (bitDepth === 8 || bitDepth === 16) return val;
  const maxVal = (1 << bitDepth) - 1;
  return Math.round((val * 255) / maxVal);
}

function writePngPixel(rgba, px, py, width, colorType, bitDepth, scanline, x, plte, trns) {
  const dst = (py * width + px) * 4;
  if (colorType === 6) {
    rgba[dst] = readSampleAt(scanline, x, 4, bitDepth, 0);
    rgba[dst + 1] = readSampleAt(scanline, x, 4, bitDepth, 1);
    rgba[dst + 2] = readSampleAt(scanline, x, 4, bitDepth, 2);
    rgba[dst + 3] = readSampleAt(scanline, x, 4, bitDepth, 3);
  } else if (colorType === 2) {
    const r = scaleLowBitTo255(readSampleAt(scanline, x, 3, bitDepth, 0), bitDepth);
    const g = scaleLowBitTo255(readSampleAt(scanline, x, 3, bitDepth, 1), bitDepth);
    const b = scaleLowBitTo255(readSampleAt(scanline, x, 3, bitDepth, 2), bitDepth);
    let a = 255;
    if (trns && trns.length >= 6) {
      const tr = (trns[0] << 8) | trns[1];
      const tg = (trns[2] << 8) | trns[3];
      const tb = (trns[4] << 8) | trns[5];
      if (readSampleAt(scanline, x, 3, bitDepth, 0) === tr &&
          readSampleAt(scanline, x, 3, bitDepth, 1) === tg &&
          readSampleAt(scanline, x, 3, bitDepth, 2) === tb) {
        a = 0;
      }
    }
    rgba[dst] = r; rgba[dst + 1] = g; rgba[dst + 2] = b; rgba[dst + 3] = a;
  } else if (colorType === 0) {
    const rawVal = readSampleAt(scanline, x, 1, bitDepth, 0);
    const v = scaleLowBitTo255(rawVal, bitDepth);
    let a = 255;
    if (trns && trns.length >= 2 && rawVal === ((trns[0] << 8) | trns[1])) a = 0;
    rgba[dst] = v; rgba[dst + 1] = v; rgba[dst + 2] = v; rgba[dst + 3] = a;
  } else if (colorType === 4) {
    const v = readSampleAt(scanline, x, 2, bitDepth, 0);
    const a = readSampleAt(scanline, x, 2, bitDepth, 1);
    rgba[dst] = v; rgba[dst + 1] = v; rgba[dst + 2] = v; rgba[dst + 3] = a;
  } else if (colorType === 3) {
    const idx = readSampleAt(scanline, x, 1, bitDepth, 0);
    if (!plte || idx * 3 + 2 >= plte.length) {
      rgba[dst] = 0; rgba[dst + 1] = 0; rgba[dst + 2] = 0; rgba[dst + 3] = 255;
    } else {
      rgba[dst] = plte[idx * 3];
      rgba[dst + 1] = plte[idx * 3 + 1];
      rgba[dst + 2] = plte[idx * 3 + 2];
      rgba[dst + 3] = (trns && idx < trns.length) ? trns[idx] : 255;
    }
  }
}

/**
 * Decodes a PNG Buffer into `{ width, height, data: Uint8ClampedArray }`.
 * Supports bit depths 1/2/4/8/16, color types 0/2/3/4/6, filters 0..4, and Adam7.
 */
function decodePngRgba(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG signature');
  }

  let offset = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idatChunks = [];

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) break;
    const chunkData = buf.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      ihdr = {
        width: chunkData.readUInt32BE(0),
        height: chunkData.readUInt32BE(4),
        bitDepth: chunkData[8],
        colorType: chunkData[9],
        compression: chunkData[10],
        filter: chunkData[11],
        interlace: chunkData[12],
      };
    } else if (type === 'PLTE') {
      plte = Buffer.from(chunkData);
    } else if (type === 'tRNS') {
      trns = Buffer.from(chunkData);
    } else if (type === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!ihdr || idatChunks.length === 0) {
    throw new Error('Malformed PNG: missing IHDR or IDAT');
  }

  const { width, height, bitDepth, colorType, interlace } = ihdr;
  const channelCounts = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelCounts[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type: ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));

  if (interlace === 0) {
    const bytesPerRow = Math.ceil((width * channels * bitDepth) / 8);
    let pos = 0;
    let prior = null;
    for (let y = 0; y < height; y++) {
      const filterType = raw[pos++];
      const line = unfilterPngScanline(filterType, raw, pos, prior, bytesPerRow, bpp);
      pos += bytesPerRow;
      for (let x = 0; x < width; x++) {
        writePngPixel(rgba, x, y, width, colorType, bitDepth, line, x, plte, trns);
      }
      prior = line;
    }
  } else if (interlace === 1) {
    const passes = [
      { x0: 0, y0: 0, dx: 8, dy: 8 },
      { x0: 4, y0: 0, dx: 8, dy: 8 },
      { x0: 0, y0: 4, dx: 4, dy: 8 },
      { x0: 2, y0: 0, dx: 4, dy: 4 },
      { x0: 0, y0: 2, dx: 2, dy: 4 },
      { x0: 1, y0: 0, dx: 2, dy: 2 },
      { x0: 0, y0: 1, dx: 1, dy: 2 },
    ];
    let pos = 0;
    for (const p of passes) {
      const pw = Math.ceil((width - p.x0) / p.dx);
      const ph = Math.ceil((height - p.y0) / p.dy);
      if (pw <= 0 || ph <= 0) continue;
      const bytesPerRow = Math.ceil((pw * channels * bitDepth) / 8);
      let prior = null;
      for (let py = 0; py < ph; py++) {
        const filterType = raw[pos++];
        const line = unfilterPngScanline(filterType, raw, pos, prior, bytesPerRow, bpp);
        pos += bytesPerRow;
        const iy = p.y0 + py * p.dy;
        for (let px = 0; px < pw; px++) {
          const ix = p.x0 + px * p.dx;
          writePngPixel(rgba, ix, iy, width, colorType, bitDepth, line, px, plte, trns);
        }
        prior = line;
      }
    }
  } else {
    throw new Error(`Unsupported PNG interlace method: ${interlace}`);
  }

  return { width, height, data: rgba };
}

// ============================================================================
// Pure-Node Resizable Software 2D Canvas
// ============================================================================

const CSS_NAMED_COLORS = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  red: [255, 0, 0, 255],
  green: [0, 128, 0, 255],
  blue: [0, 0, 255, 255],
};

function parseCssColor(spec) {
  if (!spec || typeof spec !== 'string') return [255, 255, 255, 255];
  const s = spec.trim().toLowerCase();
  if (CSS_NAMED_COLORS[s]) return CSS_NAMED_COLORS[s];
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16) || 0,
        parseInt(h[1] + h[1], 16) || 0,
        parseInt(h[2] + h[2], 16) || 0,
        255,
      ];
    }
    if (h.length === 6 || h.length === 8) {
      return [
        parseInt(h.slice(0, 2), 16) || 0,
        parseInt(h.slice(2, 4), 16) || 0,
        parseInt(h.slice(4, 6), 16) || 0,
        h.length === 8 ? (parseInt(h.slice(6, 8), 16) & 0xff) : 255,
      ];
    }
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(',').map(p => Number(p.trim()));
    if (parts.length >= 3) {
      return [
        Math.max(0, Math.min(255, Math.round(parts[0]))),
        Math.max(0, Math.min(255, Math.round(parts[1]))),
        Math.max(0, Math.min(255, Math.round(parts[2]))),
        parts.length >= 4 && Number.isFinite(parts[3])
          ? Math.max(0, Math.min(255, Math.round(parts[3] * 255)))
          : 255,
      ];
    }
  }
  return [255, 255, 255, 255];
}

function blendPixel(buf, idx, r, g, b, a) {
  if (a <= 0) return;
  if (a >= 255) {
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = 255;
    return;
  }
  const sa = a / 255;
  const da = buf[idx + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 1e-6) {
    buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 0;
    return;
  }
  buf[idx] = Math.round((r * sa + buf[idx] * da * (1 - sa)) / outA);
  buf[idx + 1] = Math.round((g * sa + buf[idx + 1] * da * (1 - sa)) / outA);
  buf[idx + 2] = Math.round((b * sa + buf[idx + 2] * da * (1 - sa)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

/**
 * Resizable software Canvas matching HTMLCanvasElement + CanvasRenderingContext2D
 * features used across DEM fetching and 2D mask rasterization.
 */
function createHeadlessCanvas(initialW = 300, initialH = 150) {
  let _w = Math.max(1, initialW | 0);
  let _h = Math.max(1, initialH | 0);
  let _data = null;

  function ensureBuffer() {
    if (!_data || _data.length !== _w * _h * 4) {
      _data = new Uint8ClampedArray(_w * _h * 4);
    }
    return _data;
  }

  let subpaths = [];
  let activeSubpath = null;
  const stateStack = [];

  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1.0,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalAlpha: 1.0,
    globalCompositeOperation: 'source-over',

    save() {
      stateStack.push({
        fillStyle: ctx.fillStyle,
        strokeStyle: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        lineCap: ctx.lineCap,
        lineJoin: ctx.lineJoin,
        miterLimit: ctx.miterLimit,
        globalAlpha: ctx.globalAlpha,
        globalCompositeOperation: ctx.globalCompositeOperation,
      });
    },
    restore() {
      const prev = stateStack.pop();
      if (prev) Object.assign(ctx, prev);
    },

    clearRect(x, y, w, h) {
      const buf = ensureBuffer();
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(_w, Math.ceil(x + w));
      const y1 = Math.min(_h, Math.ceil(y + h));
      if (x0 === 0 && y0 === 0 && x1 === _w && y1 === _h) {
        buf.fill(0);
        return;
      }
      for (let py = y0; py < y1; py++) {
        const row = py * _w * 4;
        buf.fill(0, row + x0 * 4, row + x1 * 4);
      }
    },

    fillRect(x, y, w, h) {
      const buf = ensureBuffer();
      const [r, g, b, a0] = parseCssColor(ctx.fillStyle);
      const a = Math.round(a0 * Math.max(0, Math.min(1, ctx.globalAlpha)));
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(_w, Math.ceil(x + w));
      const y1 = Math.min(_h, Math.ceil(y + h));
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          blendPixel(buf, (py * _w + px) * 4, r, g, b, a);
        }
      }
    },

    drawImage(img, ...args) {
      if (!img) return;
      const srcData = img._rgba || img.data || (img._canvas ? img._canvas._getRawBuffer() : null);
      const sw0 = img.width || 0;
      const sh0 = img.height || 0;
      if (!srcData || sw0 <= 0 || sh0 <= 0) return;

      let sx = 0, sy = 0, sw = sw0, sh = sh0;
      let dx = 0, dy = 0, dw = sw0, dh = sh0;
      if (args.length === 2) {
        [dx, dy] = args;
      } else if (args.length === 4) {
        [dx, dy, dw, dh] = args;
      } else if (args.length >= 8) {
        [sx, sy, sw, sh, dx, dy, dw, dh] = args;
      }

      const buf = ensureBuffer();
      const dstX0 = Math.max(0, Math.floor(dx));
      const dstY0 = Math.max(0, Math.floor(dy));
      const dstX1 = Math.min(_w, Math.ceil(dx + dw));
      const dstY1 = Math.min(_h, Math.ceil(dy + dh));
      if (dstX1 <= dstX0 || dstY1 <= dstY0) return;

      // Exact fast copy path for 1:1 DEM tile blit (256x256 -> 256x256)
      if (sx === 0 && sy === 0 && dx === 0 && dy === 0 && sw === _w && sh === _h && dw === _w && dh === _h && sw0 === _w && sh0 === _h) {
        buf.set(srcData.subarray(0, _w * _h * 4));
        return;
      }

      for (let py = dstY0; py < dstY1; py++) {
        const iy = Math.max(0, Math.min(sh0 - 1, Math.floor(sy + ((py + 0.5 - dy) / dh) * sh)));
        const srcRow = iy * sw0 * 4;
        const dstRow = py * _w * 4;
        for (let px = dstX0; px < dstX1; px++) {
          const ix = Math.max(0, Math.min(sw0 - 1, Math.floor(sx + ((px + 0.5 - dx) / dw) * sw)));
          const si = srcRow + ix * 4;
          const di = dstRow + px * 4;
          blendPixel(buf, di, srcData[si], srcData[si + 1], srcData[si + 2], srcData[si + 3]);
        }
      }
    },

    beginPath() {
      subpaths = [];
      activeSubpath = null;
    },

    moveTo(x, y) {
      activeSubpath = { pts: [[x, y]], closed: false };
      subpaths.push(activeSubpath);
    },

    lineTo(x, y) {
      if (!activeSubpath) {
        ctx.moveTo(x, y);
        return;
      }
      activeSubpath.pts.push([x, y]);
    },

    closePath() {
      if (activeSubpath && activeSubpath.pts.length >= 2) {
        activeSubpath.closed = true;
      }
    },

    rect(x, y, w, h) {
      const sp = {
        pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        closed: true,
      };
      subpaths.push(sp);
      activeSubpath = sp;
    },

    arc(cx, cy, r, startAngle, endAngle, ccw = false) {
      let sweep = endAngle - startAngle;
      if (ccw) {
        if (sweep > 0) sweep = sweep - Math.PI * 2;
        while (sweep > -1e-9 && startAngle > endAngle) sweep -= Math.PI * 2;
      } else {
        if (sweep < 0) sweep = sweep + Math.PI * 2;
      }
      const steps = Math.max(12, Math.ceil(Math.abs(sweep) * Math.max(8, r)));
      for (let i = 0; i <= steps; i++) {
        const ang = startAngle + (sweep * i) / steps;
        const px = cx + Math.cos(ang) * r;
        const py = cy + Math.sin(ang) * r;
        if (i === 0 && !activeSubpath) ctx.moveTo(px, py);
        else if (i === 0) activeSubpath.pts.push([px, py]);
        else ctx.lineTo(px, py);
      }
    },

    fill(fillRule = 'nonzero') {
      if (subpaths.length === 0) return;
      const buf = ensureBuffer();
      const [r, g, b, a0] = parseCssColor(ctx.fillStyle);
      const a = Math.round(a0 * Math.max(0, Math.min(1, ctx.globalAlpha)));
      if (a <= 0) return;

      const edges = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const sp of subpaths) {
        const pts = sp.pts;
        if (!pts || pts.length < 3) continue;
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i];
          const p1 = pts[(i + 1) % pts.length];
          if (p0[0] < minX) minX = p0[0];
          if (p0[0] > maxX) maxX = p0[0];
          if (p0[1] < minY) minY = p0[1];
          if (p0[1] > maxY) maxY = p0[1];
          if (p0[1] !== p1[1]) {
            const up = p1[1] > p0[1];
            edges.push({
              x0: p0[0], y0: p0[1],
              x1: p1[0], y1: p1[1],
              yMin: Math.min(p0[1], p1[1]),
              yMax: Math.max(p0[1], p1[1]),
              invSlope: (p1[0] - p0[0]) / (p1[1] - p0[1]),
              dir: up ? 1 : -1,
            });
          }
        }
      }
      if (edges.length === 0) return;

      const py0 = Math.max(0, Math.floor(minY));
      const py1 = Math.min(_h - 1, Math.ceil(maxY));
      const isEvenOdd = fillRule === 'evenodd';
      const crossings = [];

      for (let py = py0; py <= py1; py++) {
        const sy = py + 0.5;
        crossings.length = 0;
        for (let e = 0; e < edges.length; e++) {
          const ed = edges[e];
          if ((ed.yMin <= sy) && (ed.yMax > sy)) {
            const ix = ed.x0 + (sy - ed.y0) * ed.invSlope;
            crossings.push({ x: ix, dir: ed.dir });
          }
        }
        if (crossings.length < 2) continue;
        crossings.sort((u, v) => u.x - v.x);

        if (isEvenOdd) {
          for (let k = 0; k + 1 < crossings.length; k += 2) {
            const pxStart = Math.max(0, Math.ceil(crossings[k].x - 0.5));
            const pxEnd = Math.min(_w - 1, Math.floor(crossings[k + 1].x - 0.5));
            const rowOff = py * _w * 4;
            for (let px = pxStart; px <= pxEnd; px++) {
              blendPixel(buf, rowOff + px * 4, r, g, b, a);
            }
          }
        } else {
          let winding = 0;
          for (let k = 0; k + 1 < crossings.length; k++) {
            winding += crossings[k].dir;
            if (winding !== 0) {
              const pxStart = Math.max(0, Math.ceil(crossings[k].x - 0.5));
              const pxEnd = Math.min(_w - 1, Math.floor(crossings[k + 1].x - 0.5));
              const rowOff = py * _w * 4;
              for (let px = pxStart; px <= pxEnd; px++) {
                blendPixel(buf, rowOff + px * 4, r, g, b, a);
              }
            }
          }
        }
      }
    },

    stroke() {
      if (subpaths.length === 0) return;
      const buf = ensureBuffer();
      const [r, g, b, a0] = parseCssColor(ctx.strokeStyle);
      const a = Math.round(a0 * Math.max(0, Math.min(1, ctx.globalAlpha)));
      if (a <= 0) return;

      const halfW = Math.max(0.5, ctx.lineWidth * 0.5);
      const halfW2 = halfW * halfW;
      const isRoundCap = ctx.lineCap !== 'butt';

      const stampSegment = (ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const pad = halfW + 1.0;
        const px0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
        const px1 = Math.min(_w - 1, Math.ceil(Math.max(ax, bx) + pad));
        const py0 = Math.max(0, Math.floor(Math.min(ay, by) - pad));
        const py1 = Math.min(_h - 1, Math.ceil(Math.max(ay, by) + pad));

        for (let py = py0; py <= py1; py++) {
          const cy = py + 0.5;
          const rowOff = py * _w * 4;
          for (let px = px0; px <= px1; px++) {
            const cx = px + 0.5;
            if (len2 < 1e-10) {
              const d2 = (cx - ax) * (cx - ax) + (cy - ay) * (cy - ay);
              if (d2 <= halfW2) blendPixel(buf, rowOff + px * 4, r, g, b, a);
              continue;
            }
            const tRaw = ((cx - ax) * dx + (cy - ay) * dy) / len2;
            if (!isRoundCap && (tRaw < 0 || tRaw > 1)) continue;
            const t = tRaw < 0 ? 0 : (tRaw > 1 ? 1 : tRaw);
            const qx = ax + t * dx;
            const qy = ay + t * dy;
            const dist2 = (cx - qx) * (cx - qx) + (cy - qy) * (cy - qy);
            if (dist2 <= halfW2) {
              blendPixel(buf, rowOff + px * 4, r, g, b, a);
            }
          }
        }
      };

      for (const sp of subpaths) {
        const pts = sp.pts;
        if (!pts || pts.length < 2) continue;
        const segCount = sp.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < segCount; i++) {
          const p0 = pts[i];
          const p1 = pts[(i + 1) % pts.length];
          stampSegment(p0[0], p0[1], p1[0], p1[1]);
        }
      }
    },

    getImageData(sx, sy, sw, sh) {
      const buf = ensureBuffer();
      const ix = sx | 0;
      const iy = sy | 0;
      const iw = Math.max(1, sw | 0);
      const ih = Math.max(1, sh | 0);
      if (ix === 0 && iy === 0 && iw === _w && ih === _h) {
        return { width: _w, height: _h, data: new Uint8ClampedArray(buf) };
      }
      const out = new Uint8ClampedArray(iw * ih * 4);
      for (let py = 0; py < ih; py++) {
        const srcY = iy + py;
        if (srcY < 0 || srcY >= _h) continue;
        const copyStartX = Math.max(0, ix);
        const copyEndX = Math.min(_w, ix + iw);
        if (copyEndX <= copyStartX) continue;
        const srcOff = (srcY * _w + copyStartX) * 4;
        const dstOff = (py * iw + (copyStartX - ix)) * 4;
        out.set(buf.subarray(srcOff, srcOff + (copyEndX - copyStartX) * 4), dstOff);
      }
      return { width: iw, height: ih, data: out };
    },
  };

  const canvas = {
    get width() { return _w; },
    set width(v) {
      const next = Math.max(1, Number(v) || 1) | 0;
      if (next !== _w) { _w = next; _data = null; }
    },
    get height() { return _h; },
    set height(v) {
      const next = Math.max(1, Number(v) || 1) | 0;
      if (next !== _h) { _h = next; _data = null; }
    },
    getContext(kind) {
      if (kind !== '2d') return null;
      ensureBuffer();
      return ctx;
    },
    _getRawBuffer() {
      return ensureBuffer();
    },
  };
  ctx._canvas = canvas;
  return canvas;
}

// ============================================================================
// HTTP Helpers (Remote Public OSM / AWS Terrarium Only) & DEM Tile Cache
// ============================================================================

function httpsGetBuffer(url, timeoutMs = 15000, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'map-to-3dprint-headless-inspector/1.0',
        ...headers,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsGetBuffer(res.headers.location, timeoutMs, headers).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body });
        } else {
          const err = new Error(`HTTP ${res.statusCode} for ${url}`);
          err.status = res.statusCode;
          err.body = body;
          reject(err);
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`Timeout after ${timeoutMs}ms for ${url}`)); });
    req.on('error', reject);
  });
}

function findCachedDemTileFile(demCacheDirs, zoom, tx, ty) {
  for (const dir of demCacheDirs) {
    if (!dir) continue;
    const candidates = [
      path.join(dir, `${zoom}_${tx}_${ty}.png`),
      path.join(dir, `terrarium_${zoom}_${tx}_${ty}.png`),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
  }
  return null;
}

function createHeadlessImageClass(opts = {}) {
  const demCacheDirs = [];
  if (opts.demCacheDir) demCacheDirs.push(opts.demCacheDir);
  if (Array.isArray(opts.extraDemCacheDirs)) demCacheDirs.push(...opts.extraDemCacheDirs);
  const repoCacheDir = path.join(REPO_ROOT, 'cache');
  if (!demCacheDirs.includes(repoCacheDir)) demCacheDirs.push(repoCacheDir);

  const primaryWriteDir = opts.demCacheDir || null;
  const offlineFallbackDem = opts.offlineFallbackDem !== false;
  const allowRemoteDem = opts.allowRemoteDem !== false && !opts.offlineOnly;

  return class HeadlessImage {
    constructor() {
      this.crossOrigin = '';
      this.width = 0;
      this.height = 0;
      this._rgba = null;
      this.onload = null;
      this.onerror = null;
      this._src = '';
    }

    get src() { return this._src; }
    set src(val) {
      this._src = String(val || '');
      this._loadAsync(this._src);
    }

    _finishOk(width, height, rgba) {
      this.width = width;
      this.height = height;
      this._rgba = rgba;
      if (typeof this.onload === 'function') this.onload();
    }

    _finishFlatDem() {
      const size = 256;
      const rgba = new Uint8ClampedArray(size * size * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = 128; // Terrarium 0m = (128 * 256 + 0 + 0/256) - 32768 = 0m
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 255;
      }
      this._finishOk(size, size, rgba);
    }

    async _loadAsync(url) {
      // Allow onload assignment immediately after .src = ...
      await new Promise(resolve => setTimeout(resolve, 0));

      try {
        if (url.startsWith('data:image/png;base64,')) {
          const decoded = decodePngRgba(Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
          this._finishOk(decoded.width, decoded.height, decoded.data);
          return;
        }

        const m = url.match(/\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/i);
        if (m) {
          const [, z, tx, ty] = m;
          const cachedPath = findCachedDemTileFile(demCacheDirs, z, tx, ty);
          if (cachedPath) {
            const decoded = decodePngRgba(fs.readFileSync(cachedPath));
            this._finishOk(decoded.width, decoded.height, decoded.data);
            return;
          }
          if (allowRemoteDem) {
            const { body } = await httpsGetBuffer(url, 15000);
            const decoded = decodePngRgba(body);
            if (primaryWriteDir) {
              fs.mkdirSync(primaryWriteDir, { recursive: true });
              fs.writeFileSync(path.join(primaryWriteDir, `${z}_${tx}_${ty}.png`), body);
            }
            this._finishOk(decoded.width, decoded.height, decoded.data);
            return;
          }
          if (offlineFallbackDem) {
            this._finishFlatDem();
            return;
          }
          throw new Error(`DEM tile ${z}/${tx}/${ty} not cached locally and remote DEM disabled`);
        }

        if (fs.existsSync(url)) {
          const decoded = decodePngRgba(fs.readFileSync(url));
          this._finishOk(decoded.width, decoded.height, decoded.data);
          return;
        }
        if (url.startsWith('https://') && allowRemoteDem) {
          const { body } = await httpsGetBuffer(url, 15000);
          const decoded = decodePngRgba(body);
          this._finishOk(decoded.width, decoded.height, decoded.data);
          return;
        }
        throw new Error(`Unsupported or unavailable image source: ${url}`);
      } catch (err) {
        if (offlineFallbackDem && /\/terrarium\//i.test(url)) {
          this._finishFlatDem();
          return;
        }
        if (typeof this.onerror === 'function') this.onerror(err);
      }
    }
  };
}

// ============================================================================
// Local Overpass Evaluator (Snapshot Spatial + Tag Query Engine)
// ============================================================================

const DETAIL_URBAN_NAT_SET = new Set([
  'water', 'coastline', 'wood', 'scrub', 'grassland', 'heath',
  'tree_row', 'beach', 'wetland', 'shingle', 'shoal', 'mud', 'bare_rock',
]);
const DETAIL_LANDUSE_SET = new Set([
  'reservoir', 'basin', 'forest', 'grass', 'meadow', 'park',
  'recreation_ground', 'cemetery', 'village_green', 'allotments',
  'farmland', 'orchard', 'vineyard',
]);
const DETAIL_LEISURE_SET = new Set([
  'park', 'garden', 'nature_reserve', 'pitch', 'playground',
  'common', 'golf_course', 'recreation_ground', 'dog_park', 'marina',
]);
const EXCLUDED_URBAN_BLD_RE = /^(shed|garage|garages|hut|cabin|kiosk|roof|allotment_house|sty|greenhouse|static_caravan|ger)$/;
const ATTRACTION_WHEEL_RE = /^(big_wheel|observation_wheel|ferris_wheel)$/;

class LocalOverpassEvaluator {
  constructor(rawElements) {
    this.elements = Array.isArray(rawElements) ? rawElements : [];
    this.nodesById = new Map();
    this.waysById = new Map();
    this.relsById = new Map();
    this.treeNodes = [];
    this.indexedWays = [];
    this.indexedRels = [];
    this._index();
  }

  _index() {
    for (const el of this.elements) {
      if (!el) continue;
      if (el.type === 'node') {
        this.nodesById.set(el.id, el);
        if (el.tags && el.tags.natural === 'tree') this.treeNodes.push(el);
      } else if (el.type === 'way') {
        this.waysById.set(el.id, el);
      } else if (el.type === 'relation') {
        this.relsById.set(el.id, el);
      }
    }

    for (const way of this.waysById.values()) {
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const nid of (way.nodes || [])) {
        const nd = this.nodesById.get(nid);
        if (!nd) continue;
        if (nd.lat < minLat) minLat = nd.lat;
        if (nd.lat > maxLat) maxLat = nd.lat;
        if (nd.lon < minLon) minLon = nd.lon;
        if (nd.lon > maxLon) maxLon = nd.lon;
      }
      if (minLat <= maxLat) {
        this.indexedWays.push({ way, minLat, maxLat, minLon, maxLon });
      }
    }

    for (const rel of this.relsById.values()) {
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      const memberWayIds = [];
      const memberNodeIds = [];
      for (const mem of (rel.members || [])) {
        if (mem.type === 'way') {
          const w = this.waysById.get(mem.ref);
          if (w) {
            memberWayIds.push(w.id);
            for (const nid of (w.nodes || [])) {
              const nd = this.nodesById.get(nid);
              if (!nd) continue;
              if (nd.lat < minLat) minLat = nd.lat;
              if (nd.lat > maxLat) maxLat = nd.lat;
              if (nd.lon < minLon) minLon = nd.lon;
              if (nd.lon > maxLon) maxLon = nd.lon;
            }
          }
        } else if (mem.type === 'node') {
          const nd = this.nodesById.get(mem.ref);
          if (nd) {
            memberNodeIds.push(nd.id);
            if (nd.lat < minLat) minLat = nd.lat;
            if (nd.lat > maxLat) maxLat = nd.lat;
            if (nd.lon < minLon) minLon = nd.lon;
            if (nd.lon > maxLon) maxLon = nd.lon;
          }
        }
      }
      if (minLat <= maxLat) {
        this.indexedRels.push({ rel, minLat, maxLat, minLon, maxLon, memberWayIds, memberNodeIds });
      }
    }
  }

  _matchWayTags(tags, isDetail) {
    if (!tags) return false;
    if (tags.building || tags['building:part']) {
      if (!isDetail && tags.building && EXCLUDED_URBAN_BLD_RE.test(String(tags.building))) {
        return false;
      }
      return true;
    }
    if (tags.attraction && ATTRACTION_WHEEL_RE.test(tags.attraction)) return true;
    if (tags.waterway || tags.water) return true;
    if (tags.natural && (isDetail || DETAIL_URBAN_NAT_SET.has(tags.natural))) return true;
    if (tags.landuse && (isDetail || DETAIL_LANDUSE_SET.has(tags.landuse))) return true;
    if (tags.leisure && (isDetail || DETAIL_LEISURE_SET.has(tags.leisure))) return true;
    if (tags.highway) return true;
    if (tags.place === 'square' || tags.place === 'island' || tags.place === 'islet') return true;
    if (tags.railway || tags.public_transport === 'platform') return true;
    if (tags.man_made && /^(bridge|pier|breakwater|groyne|tower|lighthouse)$/.test(tags.man_made)) return true;
    return false;
  }

  _matchRelTags(tags) {
    if (!tags) return false;
    if (tags.building || tags.type === 'building' || tags['building:part']) return true;
    if (tags.man_made === 'bridge') return true;
    if (tags.attraction && ATTRACTION_WHEEL_RE.test(tags.attraction)) return true;
    if (tags.type === 'multipolygon') {
      if (tags.natural || tags.waterway || tags.water || tags.landuse || tags.leisure ||
          tags.place === 'island' || tags.place === 'islet' ||
          tags.highway === 'pedestrian' || tags.railway === 'platform' ||
          tags.public_transport === 'platform') {
        return true;
      }
    }
    return false;
  }

  evaluateQL(qlText) {
    const bboxMatch = String(qlText || '').match(/\[bbox:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\]/);
    let south = -90, west = -180, north = 90, east = 180;
    if (bboxMatch) {
      south = Number(bboxMatch[1]);
      west = Number(bboxMatch[2]);
      north = Number(bboxMatch[3]);
      east = Number(bboxMatch[4]);
    }

    const wantTrees = String(qlText || '').includes('natural"="tree"');
    const isDetail = String(qlText || '').includes('way["highway"];') ||
                     String(qlText || '').includes('way["natural"];');

    const outNodes = new Map();
    const outWays = new Map();
    const outRels = new Map();

    const addWayWithNodes = (way) => {
      if (!way) return;
      outWays.set(way.id, way);
      for (const nid of (way.nodes || [])) {
        const nd = this.nodesById.get(nid);
        if (nd) outNodes.set(nd.id, nd);
      }
    };

    for (const item of this.indexedRels) {
      if (item.maxLat < south || item.minLat > north || item.maxLon < west || item.minLon > east) continue;
      if (!this._matchRelTags(item.rel.tags)) continue;
      outRels.set(item.rel.id, item.rel);
      for (const wid of item.memberWayIds) addWayWithNodes(this.waysById.get(wid));
      for (const nid of item.memberNodeIds) {
        const nd = this.nodesById.get(nid);
        if (nd) outNodes.set(nd.id, nd);
      }
    }

    for (const item of this.indexedWays) {
      if (item.maxLat < south || item.minLat > north || item.maxLon < west || item.minLon > east) continue;
      if (!this._matchWayTags(item.way.tags, isDetail)) continue;
      addWayWithNodes(item.way);
    }

    if (wantTrees) {
      for (const nd of this.treeNodes) {
        if (nd.lat >= south && nd.lat <= north && nd.lon >= west && nd.lon <= east) {
          outNodes.set(nd.id, nd);
        }
      }
    }

    return {
      version: 0.6,
      generator: 'HeadlessLocalOverpassEvaluator',
      elements: [
        ...outNodes.values(),
        ...outWays.values(),
        ...outRels.values(),
      ],
    };
  }
}

// ============================================================================
// Live Public OSM API v0.6 Direct Fetcher (No Local Proxy)
// ============================================================================

async function fetchPublicOsmMapBBox(south, west, north, east, depth = 0) {
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${west.toFixed(6)},${south.toFixed(6)},${east.toFixed(6)},${north.toFixed(6)}`;
  try {
    const { body } = await httpsGetBuffer(url, 30000, { Accept: 'application/json' });
    const json = JSON.parse(body.toString('utf8'));
    return Array.isArray(json.elements) ? json.elements : [];
  } catch (err) {
    if ((err.status === 400 || err.status === 509 || err.status === 504) && depth < 3) {
      const midLat = (south + north) * 0.5;
      const midLon = (west + east) * 0.5;
      const quads = [
        [south, west, midLat, midLon],
        [south, midLon, midLat, east],
        [midLat, west, north, midLon],
        [midLat, midLon, north, east],
      ];
      const results = [];
      for (const [s, w, n, e] of quads) {
        const sub = await fetchPublicOsmMapBBox(s, w, n, e, depth + 1);
        results.push(...sub);
      }
      return results;
    }
    throw err;
  }
}

async function fetchLiveOsmElementsViaOsmApi({ south, west, north, east }) {
  const baseElements = await fetchPublicOsmMapBBox(south, west, north, east, 0);
  const byKey = new Map();
  const waysPresent = new Set();
  const relsToComplete = [];

  for (const el of baseElements) {
    if (!el || !el.type || el.id === undefined) continue;
    byKey.set(`${el.type}:${el.id}`, el);
    if (el.type === 'way') waysPresent.add(el.id);
  }
  for (const el of byKey.values()) {
    if (el.type !== 'relation' || !el.tags) continue;
    const t = el.tags;
    const interesting = Boolean(
      t.building || t.type === 'building' || t['building:part'] ||
      t.type === 'multipolygon' && (t.water || t.waterway || t.natural || t.landuse || t.leisure)
    );
    if (!interesting) continue;
    const missingMember = (el.members || []).some(m => m.type === 'way' && !waysPresent.has(m.ref));
    if (missingMember) relsToComplete.push(el.id);
  }

  for (let i = 0; i < relsToComplete.length; i++) {
    const rid = relsToComplete[i];
    try {
      const url = `https://api.openstreetmap.org/api/0.6/relation/${rid}/full.json`;
      const { body } = await httpsGetBuffer(url, 15000, { Accept: 'application/json' });
      const json = JSON.parse(body.toString('utf8'));
      for (const el of (json.elements || [])) {
        if (el && el.type && el.id !== undefined) {
          byKey.set(`${el.type}:${el.id}`, el);
        }
      }
    } catch (_) {
      // Partial relation completion is best-effort
    }
  }

  return Array.from(byKey.values());
}

// ============================================================================
// Coordinate & BBox Helpers (Matching ui_map2d.js / osm_scene_builder.js / map_rotation.js)
// ============================================================================

/**
 * Computes tight geographic selection bbox and rotation-padded fetch bbox
 * matching `createMap2DController().getSelectionBBox()`.
 */
function computeBBoxFromParams({
  lat,
  lon,
  spanMeters = 1200,
  rotationDeg = 0,
  targetWidthCm = 50,
  targetHeightCm = 50,
}) {
  const totalWidthMm = Math.max(10, Number(targetWidthCm) * 10);
  const totalHeightMm = Math.max(10, Number(targetHeightCm) * 10);
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm) || 500;
  const baseSpan = Number(spanMeters) || 1200;

  const spanX = baseSpan * (totalWidthMm / maxDimMm);
  const spanY = baseSpan * (totalHeightMm / maxDimMm);
  const halfMx = spanX * 0.5;
  const halfMy = spanY * 0.5;

  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180.0));
  const dLat = halfMy / 111320.0;
  const dLon = halfMx / (111320.0 * cosLat);

  const south = lat - dLat;
  const north = lat + dLat;
  const west = lon - dLon;
  const east = lon + dLon;

  const rad = Math.abs(Number(rotationDeg) || 0) * Math.PI / 180.0;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const envPad = 1.045;
  const envHalfMx = (halfMx * absCos + halfMy * absSin) * envPad;
  const envHalfMy = (halfMx * absSin + halfMy * absCos) * envPad;
  const fetchDLat = envHalfMy / 111320.0;
  const fetchDLon = envHalfMx / (111320.0 * cosLat);

  return {
    south, west, north, east,
    spanX, spanY,
    targetSpanMeters: baseSpan,
    targetWidthMm: totalWidthMm,
    targetHeightMm: totalHeightMm,
    rotationDeg: Number(rotationDeg) || 0,
    fetchSouth: lat - fetchDLat,
    fetchWest: lon - fetchDLon,
    fetchNorth: lat + fetchDLat,
    fetchEast: lon + fetchDLon,
  };
}

function normalizeDegLocal(deg) {
  let d = Number(deg) || 0;
  d = ((d % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Maps geographic `(lat, lon)` to final bed/mesh scene coordinates `[bx, by]`
 * accounting for projection, scene rotation, and `cropRatio` / `cropCenter` scaling.
 */
function latLonToSceneXY(lat, lon, meta, opts = {}) {
  if (!meta) throw new Error('latLonToSceneXY requires scene meta');
  let centerLat, centerLon;
  if (Array.isArray(meta.center) && meta.center.length >= 2) {
    centerLat = Number(meta.center[0]);
    centerLon = Number(meta.center[1]);
  } else if (Array.isArray(meta.bbox) && meta.bbox.length >= 4) {
    centerLat = (meta.bbox[0] + meta.bbox[2]) * 0.5;
    centerLon = (meta.bbox[1] + meta.bbox[3]) * 0.5;
  } else if (meta.bbox && typeof meta.bbox === 'object') {
    centerLat = (meta.bbox.south + meta.bbox.north) * 0.5;
    centerLon = (meta.bbox.west + meta.bbox.east) * 0.5;
  } else {
    throw new Error('Scene meta missing center or bbox');
  }

  const mToU = Number(meta.metersToUnits) || (169.2 / Math.max(1, Number(meta.spanMeters) || 1200));
  const halfW = Number(meta.halfW) || 84.6;
  const halfH = Number(meta.halfH) || 84.6;
  const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180.0));

  const x0 = (lon - centerLon) * 111320.0 * cosLat * mToU;
  const y0 = (lat - centerLat) * 111320.0 * mToU;

  const rotDeg = normalizeDegLocal(
    opts.rotationDeg !== undefined ? opts.rotationDeg : (meta.sceneAppliedRotationDeg ?? meta.rotationDeg ?? 0)
  );
  const rad = (rotDeg * Math.PI) / 180.0;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rx = x0 * c - y0 * s;
  const ry = x0 * s + y0 * c;

  const baseCrop = (opts.fetchedCropRatio !== undefined)
    ? Number(opts.fetchedCropRatio)
    : (Number(meta._fetchedCropRatio) || 1.0);
  const reqCrop = (opts.cropRatio !== undefined)
    ? Number(opts.cropRatio)
    : (meta.cropRatio !== undefined ? Number(meta.cropRatio) : baseCrop);
  const effectiveCrop = Math.min(1.0, Math.max(0.35, (reqCrop || 0.88) / (baseCrop || 1.0)));
  const scaleToBed = 1.0 / effectiveCrop;
  const cropCX = (Number(opts.cropCenterX ?? meta.cropCenterX ?? 0)) * halfW;
  const cropCY = (Number(opts.cropCenterY ?? meta.cropCenterY ?? 0)) * halfH;

  return [(rx - cropCX) * scaleToBed, (ry - cropCY) * scaleToBed];
}

/**
 * Inverse mapping from final bed/mesh coordinates `(bx, by)` back to `[lat, lon]`.
 */
function sceneXYToLatLon(bx, by, meta, opts = {}) {
  if (!meta) throw new Error('sceneXYToLatLon requires scene meta');
  let centerLat, centerLon;
  if (Array.isArray(meta.center) && meta.center.length >= 2) {
    centerLat = Number(meta.center[0]);
    centerLon = Number(meta.center[1]);
  } else if (Array.isArray(meta.bbox) && meta.bbox.length >= 4) {
    centerLat = (meta.bbox[0] + meta.bbox[2]) * 0.5;
    centerLon = (meta.bbox[1] + meta.bbox[3]) * 0.5;
  } else if (meta.bbox && typeof meta.bbox === 'object') {
    centerLat = (meta.bbox.south + meta.bbox.north) * 0.5;
    centerLon = (meta.bbox.west + meta.bbox.east) * 0.5;
  } else {
    throw new Error('Scene meta missing center or bbox');
  }

  const mToU = Number(meta.metersToUnits) || (169.2 / Math.max(1, Number(meta.spanMeters) || 1200));
  const halfW = Number(meta.halfW) || 84.6;
  const halfH = Number(meta.halfH) || 84.6;
  const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180.0));

  const baseCrop = (opts.fetchedCropRatio !== undefined)
    ? Number(opts.fetchedCropRatio)
    : (Number(meta._fetchedCropRatio) || 1.0);
  const reqCrop = (opts.cropRatio !== undefined)
    ? Number(opts.cropRatio)
    : (meta.cropRatio !== undefined ? Number(meta.cropRatio) : baseCrop);
  const effectiveCrop = Math.min(1.0, Math.max(0.35, (reqCrop || 0.88) / (baseCrop || 1.0)));
  const scaleToBed = 1.0 / effectiveCrop;
  const cropCX = (Number(opts.cropCenterX ?? meta.cropCenterX ?? 0)) * halfW;
  const cropCY = (Number(opts.cropCenterY ?? meta.cropCenterY ?? 0)) * halfH;

  const rx = bx / scaleToBed + cropCX;
  const ry = by / scaleToBed + cropCY;

  const rotDeg = normalizeDegLocal(
    opts.rotationDeg !== undefined ? opts.rotationDeg : (meta.sceneAppliedRotationDeg ?? meta.rotationDeg ?? 0)
  );
  const rad = (-rotDeg * Math.PI) / 180.0;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const x0 = rx * c - ry * s;
  const y0 = rx * s + ry * c;

  const lon = centerLon + x0 / (111320.0 * cosLat * mToU);
  const lat = centerLat + y0 / (111320.0 * mToU);
  return [lat, lon];
}

// ============================================================================
// VM Pipeline Runtime & Read-Only Instrumentation Hooks
// ============================================================================

function createPipelineRuntime(opts = {}) {
  const silent = Boolean(opts.silent);
  let activeEvaluator = opts.overpassEvaluator || null;

  const noop = () => {};
  const vmConsole = silent
    ? { log: noop, info: noop, warn: noop, debug: noop, error: noop }
    : {
        log: (...a) => console.error('[vm:log]', ...a),
        info: (...a) => console.error('[vm:info]', ...a),
        warn: (...a) => console.error('[vm:warn]', ...a),
        debug: noop,
        error: (...a) => console.error('[vm:error]', ...a),
      };

  const HeadlessImage = createHeadlessImageClass(opts);

  const customFetch = async (url, fetchOpts = {}) => {
    const u = String(url || '');
    if (u.includes('/api/interpreter') || u.includes('overpass')) {
      if (!activeEvaluator) {
        return {
          ok: false,
          status: 503,
          async json() { throw new Error('No LocalOverpassEvaluator active in offline harness'); },
          async text() { return 'No LocalOverpassEvaluator active'; },
        };
      }
      let ql = '';
      if (fetchOpts && fetchOpts.body) {
        const bodyStr = String(fetchOpts.body);
        const m = bodyStr.match(/(?:^|&)data=([^&]+)/);
        ql = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : bodyStr;
      } else {
        const qIdx = u.indexOf('data=');
        if (qIdx >= 0) ql = decodeURIComponent(u.slice(qIdx + 5).replace(/\+/g, ' '));
      }
      const data = activeEvaluator.evaluateQL(ql);
      return {
        ok: true,
        status: 200,
        async json() { return data; },
        async text() { return JSON.stringify(data); },
      };
    }
    throw new Error(`Disallowed or unhandled fetch inside offline VM: ${u}`);
  };

  const sandbox = {
    console: vmConsole,
    Math, Date, Number, String, Boolean, Array, Object, Map, Set, WeakMap, WeakSet, RegExp, Error, TypeError,
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView,
    TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : undefined,
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
    URLSearchParams: typeof URLSearchParams !== 'undefined' ? URLSearchParams : undefined,
    atob: typeof atob === 'function' ? atob : (b64 => Buffer.from(b64, 'base64').toString('binary')),
    WebAssembly: typeof WebAssembly !== 'undefined' ? WebAssembly : undefined,
    JSON, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    AbortController,
    URL,
    encodeURIComponent,
    decodeURIComponent,
    Image: HeadlessImage,
    fetch: customFetch,
    location: {
      protocol: 'headless:',
      host: 'offline.local',
      hostname: 'offline.local',
      origin: 'headless://offline.local',
      href: 'headless://offline.local/',
      pathname: '/',
      search: '',
      hash: '',
    },
    document: {
      createElement(tag) {
        if (String(tag).toLowerCase() === 'canvas') return createHeadlessCanvas();
        return {};
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  const ctx = vm.createContext(sandbox);
  for (const relPath of PIPELINE_SCRIPTS) {
    const absPath = path.join(REPO_ROOT, relPath);
    const code = fs.readFileSync(absPath, 'utf8');
    vm.runInContext(code, ctx, { filename: absPath });
  }

  // Read-only instrumentation captures (never alters geometry/mesh behavior)
  const auditState = {
    osmElements: [],
    buildingSourceById: new Map(),
    rawBuildingRecords: [],
    s3dbAllFinalBuildings: [],
    preparedBeforeCluster: [],
    preparedList: [],
    preparedById: new Map(),
    baseInfo: null,
    ctx: null,
  };

  if (typeof sandbox.createS3DBClientCollector === 'function') {
    const origCreateS3DB = sandbox.createS3DBClientCollector;
    sandbox.createS3DBClientCollector = function wrappedCreateS3DB(...args) {
      const collector = origCreateS3DB.apply(this, args);
      if (collector && typeof collector.addBuildingRecord === 'function') {
        const origAdd = collector.addBuildingRecord.bind(collector);
        collector.addBuildingRecord = function wrappedAddBuildingRecord(
          osmId, tags, outer, holes, groupId = null, isPart = false, parentHeightHint = null, maxDefaultHeightCap = null
        ) {
          const recInfo = {
            osmId,
            tags: tags ? { ...tags } : {},
            groupId,
            isPart: Boolean(isPart),
            parentHeightHint,
            maxDefaultHeightCap,
          };
          auditState.rawBuildingRecords.push(recInfo);
          if (osmId !== undefined && osmId !== null) {
            auditState.buildingSourceById.set(osmId, recInfo);
            auditState.buildingSourceById.set(String(osmId), recInfo);
          }
          return origAdd(osmId, tags, outer, holes, groupId, isPart, parentHeightHint, maxDefaultHeightCap);
        };
      }
      if (collector && typeof collector.resolveAndEmitS3DBBuildings === 'function') {
        const origResolve = collector.resolveAndEmitS3DBBuildings.bind(collector);
        collector.resolveAndEmitS3DBBuildings = function wrappedResolveAndEmit(...rArgs) {
          const out = origResolve(...rArgs);
          if (Array.isArray(out)) auditState.s3dbAllFinalBuildings = out.slice();
          return out;
        };
      }
      return collector;
    };
  }

  if (typeof sandbox.prepareAndClusterS3DBBuildings === 'function') {
    const origPrepare = sandbox.prepareAndClusterS3DBBuildings;
    sandbox.prepareAndClusterS3DBBuildings = function wrappedPrepare(...args) {
      const res = origPrepare.apply(this, args);
      if (res && Array.isArray(res.prepared)) {
        auditState.preparedBeforeCluster = res.prepared.map(it => ({
          id: it.id,
          osmId: it.b && (it.b.osmId ?? it.b.id),
          roofShape: it.roofShape,
          zTop: it.zTop,
          zEaves: it.zEaves,
          zRidge: it.zRidge,
          effBaseZ: it.effBaseZ,
          scaledMinH: it.scaledMinH,
          area: it.area,
        }));
      }
      return res;
    };
  }

  const entryByItem = new WeakMap();

  if (typeof sandbox.resolveS3DBClusterTiers === 'function') {
    const origCluster = sandbox.resolveS3DBClusterTiers;
    sandbox.resolveS3DBClusterTiers = function wrappedResolveClusterTiers(cluster, mToU, quantizeZUnits) {
      const preSnap = new Map();
      for (const item of (cluster || [])) {
        preSnap.set(item, {
          roofShape: item.roofShape,
          zTop: item.zTop,
          zEaves: item.zEaves,
          effBaseZ: item.effBaseZ,
          skip: Boolean(item.skip),
        });
      }

      const out = origCluster.apply(this, arguments);

      for (const item of (cluster || [])) {
        const pre = preSnap.get(item) || {};
        let skipReason = null;
        if (item.skip) {
          const dupSame = (cluster || []).find(p =>
            p !== item && !p.skip &&
            Math.abs(item.zTop - p.zTop) < 0.04 &&
            Math.abs((item.scaledMinH || 0) - (p.scaledMinH || 0)) < 0.04 &&
            item.area <= p.area * 1.01
          );
          if (dupSame) {
            skipReason = 'equal_height_duplicate_part';
          } else {
            const taller = (cluster || []).find(p =>
              p !== item && !p.skip &&
              item.zTop < p.zTop - 0.05 &&
              (item.scaledMinH || 0) <= 0.01 &&
              item.area <= p.area * 0.96
            );
            skipReason = taller ? 'swallowed_by_taller_part' : 'cluster_suppressed';
          }
        }
        const resolvedId = item.id ?? (item.b && (item.b.id ?? item.b.osmId)) ?? item.pickId ?? null;
        const entry = {
          id: resolvedId,
          pickId: item.pickId ?? (item.b && item.b._pickId) ?? null,
          osmId: item.b && (item.b.osmId ?? item.b.id),
          groupId: item.groupId,
          isPart: Boolean(item.b && item.b.isPart),
          rawRoof: item.b && item.b.roof,
          preRoofShape: pre.roofShape,
          roofShape: item.roofShape,
          flattenedUnderSuperstructure: (pre.roofShape && pre.roofShape !== 'flat' && item.roofShape === 'flat'),
          roofHeight: item.roofHMm,
          roofDir: item.b && item.b.roofDir,
          zBase: item.effBaseZ,
          effBaseZ: item.effBaseZ,
          tZ: item.tZ,
          zEaves: item.zEaves,
          zRidge: item.zRidge,
          zTop: item.zTop,
          area: item.area,
          zLevelsCount: item.zLevelsCount || null,
          skip: Boolean(item.skip),
          skipReason,
          clusterIds: (cluster || []).map(c => c.id ?? (c.b && (c.b.id ?? c.b.osmId)) ?? c.pickId ?? null),
        };
        auditState.preparedList.push(entry);
        entryByItem.set(item, entry);
        if (resolvedId !== null && resolvedId !== undefined) auditState.preparedById.set(resolvedId, entry);
        if (entry.pickId !== null && entry.pickId !== undefined) auditState.preparedById.set(entry.pickId, entry);
        if (entry.osmId !== undefined) {
          auditState.preparedById.set(entry.osmId, entry);
          auditState.preparedById.set(String(entry.osmId), entry);
        }
      }
      return out;
    };
  }

  if (typeof sandbox.emitSingleS3DBBuildingItem === 'function') {
    const origEmitItem = sandbox.emitSingleS3DBBuildingItem;
    sandbox.emitSingleS3DBBuildingItem = function wrappedEmitSingleS3DBBuildingItem(item, ...rest) {
      const res = origEmitItem.apply(this, [item, ...rest]);
      if (res && res.shellId !== undefined && item) {
        const entry = entryByItem.get(item) ||
          (item.id !== undefined && item.id !== null ? auditState.preparedById.get(item.id) : null) ||
          (item.b && item.b.id !== undefined ? auditState.preparedById.get(item.b.id) : null) ||
          (item.b && item.b.osmId !== undefined ? auditState.preparedById.get(item.b.osmId) : null) ||
          (item.pickId !== undefined && item.pickId !== null ? auditState.preparedById.get(item.pickId) : null);
        if (entry) entry.shellId = res.shellId;
      }
      return res;
    };
  }

  if (typeof sandbox.buildTerrainDemGridAndTiles === 'function') {
    const origTerrainDem = sandbox.buildTerrainDemGridAndTiles;
    sandbox.buildTerrainDemGridAndTiles = function wrappedTerrainDem(...args) {
      const res = origTerrainDem.apply(this, args);
      auditState.baseInfo = res;
      if (args[1]) auditState.ctx = args[1];
      return res;
    };
  }

  return {
    sandbox,
    auditState,
    setOverpassEvaluator(ev) { activeEvaluator = ev; },
    resetAuditState() {
      auditState.buildingSourceById.clear();
      auditState.rawBuildingRecords = [];
      auditState.s3dbAllFinalBuildings = [];
      auditState.preparedBeforeCluster = [];
      auditState.preparedList = [];
      auditState.preparedById.clear();
      auditState.baseInfo = null;
      auditState.ctx = null;
    },
  };
}

// ============================================================================
// Cache Listing & Resolution
// ============================================================================

function listCachedScenes(cacheDir = path.join(REPO_ROOT, 'cache')) {
  if (!fs.existsSync(cacheDir)) return [];
  const files = fs.readdirSync(cacheDir).sort();
  const out = [];
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const fullPath = path.join(cacheDir, name);
    const kind = name.startsWith('scene_v4_') ? 'prebuilt_scene'
      : name.startsWith('osm_') ? 'osm_snapshot'
      : 'json';
    const m = name.match(/(?:scene_v4_|osm_)([-\d.]+)_([-\d.]+)_([-\d.]+)_([-\d.]+)\.json$/);
    out.push({
      name,
      path: fullPath,
      kind,
      bbox: m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null,
    });
  }
  return out;
}

function resolveCachedCityEntry(cachedCity) {
  const entries = listCachedScenes();
  const q = String(cachedCity || '').trim().toLowerCase();
  if (!q) return null;

  // 1. Direct filename or substring match
  const byName = entries.find(e => e.name.toLowerCase() === q || e.name.toLowerCase().includes(q));
  if (byName) return byName;

  // 2. Match WORLD_LOCATIONS in ui_config.js by name and pick closest cached scene/osm
  const uiCfg = fs.readFileSync(path.join(REPO_ROOT, 'src/ui/ui_config.js'), 'utf8');
  const locRegex = /name:\s*['"]([^'"]+)['"][^}]*?lat:\s*([-\d.]+)[^}]*?lon:\s*([-\d.]+)/g;
  let bestLoc = null;
  let m;
  while ((m = locRegex.exec(uiCfg)) !== null) {
    if (m[1].toLowerCase().includes(q)) {
      bestLoc = { name: m[1], lat: Number(m[2]), lon: Number(m[3]) };
      break;
    }
  }
  if (bestLoc) {
    let bestEntry = null;
    let bestDist = Infinity;
    for (const e of entries) {
      if (!e.bbox) continue;
      const clat = (e.bbox[0] + e.bbox[2]) * 0.5;
      const clon = (e.bbox[1] + e.bbox[3]) * 0.5;
      const d = Math.hypot(clat - bestLoc.lat, clon - bestLoc.lon);
      // Prefer prebuilt_scene over osm_snapshot at same location, within ~0.15 deg
      if (d < 0.15 && (d < bestDist - 1e-4 || (Math.abs(d - bestDist) < 1e-4 && e.kind === 'prebuilt_scene'))) {
        bestDist = d;
        bestEntry = e;
      }
    }
    if (bestEntry) return bestEntry;
  }

  // Fallback check on scene titles inside scene_v4_* JSON headers
  for (const e of entries) {
    if (e.kind !== 'prebuilt_scene') continue;
    try {
      const fd = fs.openSync(e.path, 'r');
      const buf = Buffer.alloc(1024);
      const bytes = fs.readSync(fd, buf, 0, 1024, 0);
      fs.closeSync(fd);
      if (buf.toString('utf8', 0, bytes).toLowerCase().includes(q)) return e;
    } catch (_) {}
  }
  return null;
}

// ============================================================================
// Universal Scene Loader + Complete Model Builder
// ============================================================================

function deepCloneScene(sc) {
  return JSON.parse(JSON.stringify(sc));
}

function buildStateFromOpts(opts = {}, sandbox, scene) {
  const palettes = sandbox.PALETTES || {};
  const paletteKey = opts.palette || 'white';
  const pal = palettes[paletteKey] || palettes.white || {
    water: '#1e6e8c',
    base: '#f1efe8',
    greenery: '#5a944a',
    trees: '#3d7033',
    roads: '#7c7b77',
    buildings: '#fafaf6',
    highlighted: '#e65100',
  };

  const targetWidthCm = Number(opts.targetWidthCm) || 50;
  const targetHeightCm = Number(opts.targetHeightCm) || targetWidthCm;
  const bedSizeMm = targetWidthCm * 10;
  const totalHeightMm = targetHeightCm * 10;
  const defaultCrop = (scene && scene._fetchedCropRatio) ? scene._fetchedCropRatio : 0.88;

  return {
    targetWidthCm,
    targetHeightCm,
    bedSizeMm,
    totalHeightMm,
    baseHeightMm: Number(opts.baseHeightMm ?? 2.4),
    zScale: Number(opts.zScale ?? 1.0),
    terrainScale: Number(opts.terrainScale ?? 1.0),
    contourSteps: Number(opts.contourSteps ?? 8),
    waterCutout: Boolean(opts.waterCutout),
    hollowBase: Boolean(opts.hollowBase),
    hollowWallMm: Number(opts.hollowWallMm ?? 1.8),
    showFrame: opts.showFrame !== false,
    exportFrame: opts.showFrame !== false,
    frameStyle: opts.frameStyle || 'black',
    palette: paletteKey,
    colors: {
      water: (opts.colors && opts.colors.water) || pal.water,
      base: (opts.colors && opts.colors.base) || pal.base,
      greenery: (opts.colors && opts.colors.greenery) || pal.greenery,
      trees: (opts.colors && opts.colors.trees) || pal.trees || pal.greenery,
      roads: (opts.colors && opts.colors.roads) || pal.roads,
      buildings: (opts.colors && opts.colors.buildings) || pal.buildings,
      highlighted: (opts.colors && opts.colors.highlighted) || pal.highlighted || '#e65100',
    },
    layerVisible: {
      water: true,
      base: true,
      greenery: true,
      roads: true,
      buildings: true,
      highlighted: true,
      frame: opts.showFrame !== false,
      ...(opts.layerVisible || {}),
    },
    cropRatio: Number(opts.cropRatio ?? defaultCrop),
    cropCenterX: Number(opts.cropCenterX ?? 0),
    cropCenterY: Number(opts.cropCenterY ?? 0),
    tileCols: Number(opts.tileCols ?? 1),
    tileRows: Number(opts.tileRows ?? 1),
    tileExplode: Number(opts.tileExplode ?? 0),
    explodeFactor: Number(opts.explodeFactor ?? 0),
    exportTileFilter: opts.exportTileFilter || 'all',
    showLayerLines: Boolean(opts.showLayerLines),
    studioBg: opts.studioBg !== false,
    sunAngleDeg: Number(opts.sunAngleDeg ?? 315),
    isResin: true,
    xyPixelMm: Number(opts.xyPixelMm ?? 0.017),
    supportlessMode: Boolean(opts.supportlessMode),
    buildingScale: Number(opts.buildingScale ?? 1.0),
    minFeatureMm: Number(opts.minFeatureMm ?? 0.12),
    layerHeightMm: Number(opts.layerHeightMm ?? 0.05),
    printProfile: opts.printProfile || 'sla_mono4',
    mapRotationDeg: Number(opts.rotationDeg ?? 0),
    selectedIds: opts.selectedIds || [],
    hoveredBuildingId: Number(opts.hoveredBuildingId ?? -999),
    userClickedBuilding: Number(opts.userClickedBuilding ?? -999),
  };
}

/**
 * Loads a scene from:
 *  1. `opts.scene` / `opts.scenePath` / prebuilt `cache/scene_v4_*.json`
 *  2. `opts.snapshotPath` / `opts.osmElements` / cached `osm_*.json`
 *  3. Live public OSM API v0.6 + AWS Terrarium DEM via `{ lat, lon, spanMeters }`
 * Then applies rotation, runs `buildComplete3DModel`, and returns full geometry + audit data.
 */
async function loadSceneAndBuildModel(opts = {}) {
  const runtime = opts.runtime || createPipelineRuntime(opts);
  const { sandbox, auditState, setOverpassEvaluator } = runtime;
  runtime.resetAuditState();

  let prebuiltScene = opts.scene ? deepCloneScene(opts.scene) : null;
  let snapshotData = opts.snapshot || null;
  let rawElements = Array.isArray(opts.osmElements) ? opts.osmElements : null;

  let resolvedScenePath = opts.scenePath || null;
  let resolvedSnapshotPath = opts.snapshotPath || null;

  if (!prebuiltScene && !snapshotData && !rawElements && !resolvedScenePath && !resolvedSnapshotPath && opts.cachedCity) {
    const entry = resolveCachedCityEntry(opts.cachedCity);
    if (!entry) throw new Error(`No cached scene found matching "${opts.cachedCity}"`);
    if (entry.kind === 'prebuilt_scene') resolvedScenePath = entry.path;
    else resolvedSnapshotPath = entry.path;
  }

  if (!prebuiltScene && resolvedScenePath) {
    prebuiltScene = JSON.parse(fs.readFileSync(resolvedScenePath, 'utf8'));
  }

  if (!prebuiltScene && !snapshotData && !rawElements && resolvedSnapshotPath) {
    const parsed = JSON.parse(fs.readFileSync(resolvedSnapshotPath, 'utf8'));
    if (Array.isArray(parsed)) {
      snapshotData = { elements: parsed };
    } else if (parsed && Array.isArray(parsed.waterPolys) && Array.isArray(parsed.buildings)) {
      prebuiltScene = parsed;
    } else {
      snapshotData = parsed;
    }
  }

  const rotationDeg = Number(opts.rotationDeg ?? 0);
  const targetWidthCm = Number(opts.targetWidthCm ?? 50);
  const targetHeightCm = Number(opts.targetHeightCm ?? targetWidthCm);
  const wantTrees = opts.wantTrees !== false;

  let scene = null;
  let selBBox = null;

  if (prebuiltScene) {
    scene = prebuiltScene;
    if (!scene._fetchedCropRatio) scene._fetchedCropRatio = 0.88;
    if (Array.isArray(scene.bbox) && scene.bbox.length >= 4) {
      selBBox = {
        south: scene.bbox[0], west: scene.bbox[1],
        north: scene.bbox[2], east: scene.bbox[3],
        targetSpanMeters: scene.spanMeters,
      };
    }
  } else {
    if (snapshotData && !rawElements) {
      rawElements = snapshotData.elements || [];
    }

    let snapBBox = null;
    if (snapshotData && snapshotData.bbox) {
      const b = snapshotData.bbox;
      snapBBox = Array.isArray(b)
        ? { south: b[0], west: b[1], north: b[2], east: b[3] }
        : { south: Number(b.south), west: Number(b.west), north: Number(b.north), east: Number(b.east) };
    }

    if (Number.isFinite(opts.lat) && Number.isFinite(opts.lon)) {
      selBBox = computeBBoxFromParams({
        lat: Number(opts.lat),
        lon: Number(opts.lon),
        spanMeters: Number(opts.spanMeters ?? 1200),
        rotationDeg,
        targetWidthCm,
        targetHeightCm,
      });
    } else if (snapBBox) {
      const cLat = (snapBBox.south + snapBBox.north) * 0.5;
      const cLon = (snapBBox.west + snapBBox.east) * 0.5;
      const cosLat = Math.max(0.2, Math.cos((cLat * Math.PI) / 180.0));
      const spanNs = (snapBBox.north - snapBBox.south) * 111320.0;
      const spanEw = (snapBBox.east - snapBBox.west) * 111320.0 * cosLat;
      const spanM = Number(opts.spanMeters) || Math.round(Math.max(spanNs, spanEw));
      selBBox = computeBBoxFromParams({
        lat: cLat,
        lon: cLon,
        spanMeters: spanM,
        rotationDeg,
        targetWidthCm,
        targetHeightCm,
      });
    } else {
      throw new Error('Must specify { lat, lon } or a snapshot/scene with bbox');
    }

    if (!rawElements) {
      if (opts.offlineOnly) {
        throw new Error('Cannot fetch live OpenStreetMap API in offlineOnly mode without snapshot or scene');
      }
      rawElements = await fetchLiveOsmElementsViaOsmApi({
        south: selBBox.fetchSouth,
        west: selBBox.fetchWest,
        north: selBBox.fetchNorth,
        east: selBBox.fetchEast,
      });
    }

    auditState.osmElements = rawElements;
    const evaluator = new LocalOverpassEvaluator(rawElements);
    setOverpassEvaluator(evaluator);

    const streamOpts = {
      targetSpanMeters: selBBox.targetSpanMeters,
      targetWidthMm: selBBox.targetWidthMm,
      targetHeightMm: selBBox.targetHeightMm,
      isResin: true,
      xyPixelMm: Number(opts.xyPixelMm ?? 0.017),
      lodSettings: {
        wantTrees,
        roadDetail: opts.roadDetail || 'all',
        minBuildingFootprintM: Number(opts.minBuildingFootprintM ?? 2.2),
      },
    };

    const fetchChunked = sandbox.fetchChunkedGISInBrowser;
    if (typeof fetchChunked !== 'function') {
      throw new Error('fetchChunkedGISInBrowser missing from VM runtime');
    }

    scene = await fetchChunked(
      selBBox.fetchSouth,
      selBBox.fetchWest,
      selBBox.fetchNorth,
      selBBox.fetchEast,
      opts.title || 'HEADLESS_SCENE',
      streamOpts
    );
    scene._fetchedCropRatio = opts.cropRatio !== undefined ? Number(opts.cropRatio) : 0.88;
  }

  if (rotationDeg !== 0 && typeof sandbox.applySceneRotation === 'function') {
    sandbox.applySceneRotation(scene, rotationDeg, scene.halfW || 84.6, scene.halfH || 84.6);
  }
  const sceneAppliedRotationDeg = normalizeDegLocal(scene._appliedRotDeg || rotationDeg || 0);

  const state = buildStateFromOpts(opts, sandbox, scene);
  if (typeof sandbox.buildComplete3DModel !== 'function') {
    throw new Error('buildComplete3DModel missing from VM runtime');
  }

  const model = sandbox.buildComplete3DModel(scene, state, {
    fast: Boolean(opts.fast),
    skipTopologyAudit: Boolean(opts.skipTopologyAudit),
  });
  if (model && model.audit) {
    if (!auditState.ctx && model.audit.ctx) auditState.ctx = model.audit.ctx;
    if (!auditState.baseInfo && model.audit.baseInfo) auditState.baseInfo = model.audit.baseInfo;
    if (Array.isArray(model.audit.s3dbAllFinalBuildings) && auditState.s3dbAllFinalBuildings.length === 0) {
      auditState.s3dbAllFinalBuildings.push(...model.audit.s3dbAllFinalBuildings);
    }
    if (Array.isArray(model.audit.preparedList) && model.audit.preparedList.length > 0) {
      for (const entry of model.audit.preparedList) {
        auditState.preparedList.push(entry);
        if (entry.id !== undefined && entry.id !== null) {
          auditState.preparedById.set(entry.id, entry);
          auditState.preparedById.set(String(entry.id), entry);
        }
        if (entry.osmId !== undefined && entry.osmId !== null) {
          auditState.preparedById.set(entry.osmId, entry);
          auditState.preparedById.set(String(entry.osmId), entry);
        }
        if (entry.pickId !== undefined && entry.pickId !== null) {
          auditState.preparedById.set(entry.pickId, entry);
        }
      }
    } else if (auditState.preparedList.length === 0 && Array.isArray(model.buildingBounds)) {
      for (const bb of model.buildingBounds) {
        const entry = {
          id: bb.id,
          osmId: bb.id,
          pickId: bb.pickId,
          shellId: bb.shellId,
          roofShape: bb.roofShape || null,
          baseZ: bb.zBot,
          topZ: bb.zTop,
          heightU: (bb.zTop || 0) - (bb.zBot || 0),
          minX: bb.minX,
          maxX: bb.maxX,
          minY: bb.minY,
          maxY: bb.maxY,
          centroid: bb.interiorPt || [((bb.minX || 0) + (bb.maxX || 0)) * 0.5, ((bb.minY || 0) + (bb.maxY || 0)) * 0.5],
        };
        auditState.preparedList.push(entry);
        if (bb.id !== undefined && bb.id !== null) {
          auditState.preparedById.set(bb.id, entry);
          auditState.preparedById.set(String(bb.id), entry);
        }
        if (bb.pickId !== undefined && bb.pickId !== null) {
          auditState.preparedById.set(bb.pickId, entry);
        }
      }
    }
  }

  const meta = {
    bbox: scene.bbox || (selBBox ? [selBBox.south, selBBox.west, selBBox.north, selBBox.east] : null),
    fetchBbox: selBBox ? [selBBox.fetchSouth, selBBox.fetchWest, selBBox.fetchNorth, selBBox.fetchEast] : null,
    center: scene.center || null,
    spanMeters: scene.spanMeters,
    metersToUnits: scene.metersToUnits,
    halfW: scene.halfW || 84.6,
    halfH: scene.halfH || 84.6,
    _fetchedCropRatio: scene._fetchedCropRatio || 1.0,
    cropRatio: state.cropRatio,
    cropCenterX: state.cropCenterX,
    cropCenterY: state.cropCenterY,
    rotationDeg: normalizeDegLocal(rotationDeg),
    sceneAppliedRotationDeg,
    elevRange: auditState.baseInfo ? {
      realMin: auditState.baseInfo.realMin,
      realMax: auditState.baseInfo.realMax,
      realElevDelta: auditState.baseInfo.realElevDelta,
      p80Span: auditState.baseInfo.p80Span,
      isTopographicRelief: auditState.baseInfo.isTopographicRelief,
      numContourSteps: auditState.baseInfo.numContourSteps,
      baseBottomZ: auditState.baseInfo.baseBottomZ,
      zSubWater: auditState.baseInfo.zSubWater,
    } : null,
  };

  return {
    model,
    meshes: model.meshes,
    buildingBounds: model.buildingBounds,
    printMetrics: model.printMetrics,
    pickIdMap: model.pickIdMap,
    scene,
    state,
    meta,
    audit: {
      osmElements: auditState.osmElements,
      buildingSourceById: auditState.buildingSourceById,
      rawBuildingRecords: auditState.rawBuildingRecords,
      s3dbAllFinalBuildings: auditState.s3dbAllFinalBuildings,
      preparedList: auditState.preparedList,
      preparedById: auditState.preparedById,
      baseInfo: auditState.baseInfo,
      ctx: auditState.ctx,
    },
    runtime,
  };
}

module.exports = {
  PIPELINE_SCRIPTS,
  createPipelineRuntime,
  loadSceneAndBuildModel,
  decodePngRgba,
  computeBBoxFromParams,
  latLonToSceneXY,
  sceneXYToLatLon,
  listCachedScenes,
  createHeadlessCanvas,
  LocalOverpassEvaluator,
};
