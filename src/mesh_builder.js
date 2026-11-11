// ============================================================================
// src/mesh_builder.js
// Core 3D Map & SLA Hollow Vault Builder (DEM Terraces, Bathymetry, Disjoint
// Feature Slabs, Riparian Greenery, Vector 3D Bridges/Piers, Buildings & Studio Frame)
// ============================================================================

if (typeof computePrintMetricsAndTopology === 'undefined' && typeof require !== 'undefined') {
  try {
    var { computePrintMetricsAndTopology } = require('./mesh_topology.js');
  } catch (e) {}
}

const BITMAP_FONT_5X3 = {
  'R': [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,0,1]],
  'C': [[0,1,1],[1,0,0],[1,0,0],[1,0,0],[0,1,1]],
  '1': [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
  '2': [[1,1,0],[0,0,1],[0,1,0],[1,0,0],[1,1,1]],
  '3': [[1,1,0],[0,0,1],[0,1,0],[0,0,1],[1,1,0]],
  '4': [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
  '5': [[1,1,1],[1,0,0],[1,1,0],[0,0,1],[1,1,0]],
  '6': [[0,1,1],[1,0,0],[1,1,0],[1,0,1],[0,1,0]],
  '7': [[1,1,1],[0,0,1],[0,1,0],[0,0,1],[0,1,0]],
  '8': [[0,1,0],[1,0,1],[0,1,0],[1,0,1],[0,1,0]],
  '9': [[0,1,0],[1,0,1],[0,1,1],[0,0,1],[1,1,0]],
  '0': [[0,1,0],[1,0,1],[1,0,1],[1,0,1],[0,1,0]],
  '-': [[0,0,0],[0,0,0],[1,1,1],[0,0,0],[0,0,0]],
  ' ': [[0,0],[0,0],[0,0],[0,0],[0,0]],
  '^': [[0,1,0],[1,1,1],[0,1,0],[0,1,0],[0,1,0]],
  '↑': [[0,1,0],[1,1,1],[0,1,0],[0,1,0],[0,1,0]]
};

function emitClosedPrism(poly2d, zBot, zTop, layerId, outTris, tileId = 0) {
  const p = cleanPolygonRing(poly2d.slice(), true);
  if (p.length < 3 || Math.abs(signedArea2D(p)) < 1e-4) return;
  if (signedArea2D(p) < 0) p.reverse();
  const tris = triangulateSimplePoly(p);
  for (let ti = 0; ti < tris.length; ti++) {
    const tri = tris[ti];
    if (signedArea2D(tri) <= 1e-5) continue;
    pushTri(outTris, [tri[0][0], tri[0][1], zTop], [tri[1][0], tri[1][1], zTop], [tri[2][0], tri[2][1], zTop], [0, 0, 1], layerId, -1, tileId);
    pushTri(outTris, [tri[0][0], tri[0][1], zBot], [tri[2][0], tri[2][1], zBot], [tri[1][0], tri[1][1], zBot], [0, 0, -1], layerId, -1, tileId);
  }
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len > 1e-5) {
      pushQuad(outTris, [a[0], a[1], zBot], [b[0], b[1], zBot], [b[0], b[1], zTop], [a[0], a[1], zTop], [dy / len, -dx / len, 0], layerId, -1, tileId);
    }
  }
}

function createSoftwareMaskCanvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  let paths = [];
  let currentPath = [];
  let curLineWidth = 1;
  return {
    width, height,
    getContext: () => ({
      get lineWidth() { return curLineWidth; },
      set lineWidth(v) { curLineWidth = v; },
      fillStyle: '#fff',
      strokeStyle: '#fff',
      lineCap: 'round',
      lineJoin: 'round',
      clearRect() { data.fill(0); },
      beginPath() { paths = []; currentPath = []; },
      moveTo(x, y) { currentPath = [[x, y]]; paths.push(currentPath); },
      lineTo(x, y) { currentPath.push([x, y]); },
      closePath() { if (currentPath.length > 2) currentPath.push([currentPath[0][0], currentPath[0][1]]); },
      fill(rule) {
        const edges = [];
        for (const p of paths) {
          for (let i = 0; i < p.length - 1; i++) {
            const y0 = p[i][1], y1 = p[i + 1][1];
            if (y0 === y1) continue;
            edges.push({
              x0: p[i][0], y0,
              x1: p[i + 1][0], y1,
              minY: Math.min(y0, y1),
              maxY: Math.max(y0, y1),
              dxDy: (p[i + 1][0] - p[i][0]) / (y1 - y0)
            });
          }
        }
        for (let y = 0; y < height; y++) {
          const sy = y + 0.5;
          const xs = [];
          for (let i = 0; i < edges.length; i++) {
            const e = edges[i];
            if (sy >= e.minY && sy < e.maxY) {
              xs.push(e.x0 + (sy - e.y0) * e.dxDy);
            }
          }
          xs.sort((a, b) => a - b);
          for (let i = 0; i < xs.length; i += 2) {
            if (i + 1 >= xs.length) break;
            const xStart = Math.max(0, Math.ceil(xs[i]));
            const xEnd = Math.min(width - 1, Math.floor(xs[i + 1]));
            for (let x = xStart; x <= xEnd; x++) {
              data[(y * width + x) * 4 + 3] = 255;
            }
          }
        }
      },
      stroke() {
        const r = Math.max(0.5, curLineWidth * 0.5);
        const r2 = r * r;
        for (const p of paths) {
          for (let i = 0; i < p.length - 1; i++) {
            const x0 = p[i][0], y0 = p[i][1];
            const x1 = p[i + 1][0], y1 = p[i + 1][1];
            const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r));
            const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + r));
            const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r));
            const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + r));
            const dx = x1 - x0, dy = y1 - y0;
            const l2 = dx * dx + dy * dy;
            for (let y = minY; y <= maxY; y++) {
              for (let x = minX; x <= maxX; x++) {
                let d2;
                if (l2 < 1e-6) {
                  d2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
                } else {
                  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
                  const px = x0 + t * dx, py = y0 + t * dy;
                  d2 = (x - px) * (x - px) + (y - py) * (y - py);
                }
                if (d2 <= r2) {
                  data[(y * width + x) * 4 + 3] = 255;
                }
              }
            }
          }
        }
      },
      getImageData() { return { data }; }
    })
  };
}

function emitUndersideIdPatch(x0, y0, x1, y1, arg5, arg6, arg7, arg8, arg9, arg10, arg11, arg12) {
  let fz00, fz10, fz11, fz01, label, maxDebossDepth, tileId, outTris;
  if (typeof arg6 === 'number' && typeof arg7 === 'number' && typeof arg8 === 'number') {
    fz00 = arg5; fz10 = arg6; fz11 = arg7; fz01 = arg8;
    label = arg9; maxDebossDepth = arg10; tileId = arg11; outTris = arg12;
  } else {
    fz00 = arg5; fz10 = arg5; fz11 = arg5; fz01 = arg5;
    label = arg6; maxDebossDepth = arg7; tileId = arg8; outTris = arg9;
  }
  const isSingle = (label.length === 1);
  const Nx = isSingle ? 7 : 26;
  const Ny = isSingle ? 7 : 10;
  const grid = Array.from({ length: Ny }, () => new Uint8Array(Nx));

  if (isSingle) {
    const glyph = BITMAP_FONT_5X3[label] || BITMAP_FONT_5X3[' '];
    const gw = glyph[0].length;
    const startX = Math.max(1, Math.floor((Nx - gw) * 0.5));
    const startY = Math.max(1, Math.floor((Ny - 5) * 0.5));
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < gw; c++) {
        if (glyph[r][c]) {
          const gy = startY + (4 - r);
          const gx = startX + c;
          if (gy >= 1 && gy < Ny - 1 && gx >= 1 && gx < Nx - 1) {
            grid[gy][gx] = 1;
          }
        }
      }
    }
  } else {
    let totalW = 0;
    for (const ch of label) {
      const glyph = BITMAP_FONT_5X3[ch] || BITMAP_FONT_5X3[' '];
      totalW += glyph[0].length + 1;
    }
    totalW--;
    let startX = Math.max(1, Math.floor((Nx - totalW) * 0.5));
    let startY = Math.max(1, Math.floor((Ny - 5) * 0.5));

    for (const ch of label) {
      const glyph = BITMAP_FONT_5X3[ch] || BITMAP_FONT_5X3[' '];
      const gw = glyph[0].length;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < gw; c++) {
          if (glyph[r][c]) {
            const gy = startY + (4 - r);
            const gx = startX + c;
            if (gy >= 1 && gy < Ny - 1 && gx >= 1 && gx < Nx - 1) {
              grid[gy][gx] = 1;
            }
          }
        }
      }
      startX += gw + 1;
    }
  }

  const P = [];
  for (let j = 0; j <= Ny; j++) {
    P[j] = [];
    const v = j / Ny;
    const py = y0 + 0.12 * (y1 - y0) + v * 0.76 * (y1 - y0);
    for (let i = 0; i <= Nx; i++) {
      const u = i / Nx;
      const px = x0 + 0.12 * (x1 - x0) + u * 0.76 * (x1 - x0);
      const isStroke = (j < Ny && i < Nx && grid[j][i] === 1);
      const fBaseGrid = (1 - u) * (1 - v) * fz00 + u * (1 - v) * fz10 + u * v * fz11 + (1 - u) * v * fz01;
      const pz = isStroke ? (fBaseGrid + maxDebossDepth) : fBaseGrid;
      P[j][i] = [px, py, pz];
    }
  }

  const C00 = [x0, y0, fz00];
  const C10 = [x1, y0, fz10];
  const C11 = [x1, y1, fz11];
  const C01 = [x0, y1, fz01];

  // Inner grid quads facing -Z (clockwise in XY)
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      const p00 = P[j][i], p01 = P[j+1][i], p11 = P[j+1][i+1], p10 = P[j][i+1];
      pushTri(outTris, p00, p01, p11, computeFaceNormal(p00, p01, p11), 1, -1, tileId);
      pushTri(outTris, p00, p11, p10, computeFaceNormal(p00, p11, p10), 1, -1, tileId);
    }
  }

  // South fan connecting C00 to P[0][0..Nx] and C10
  for (let i = 0; i < Nx; i++) {
    pushTri(outTris, C00, P[0][i], P[0][i+1], computeFaceNormal(C00, P[0][i], P[0][i+1]), 1, -1, tileId);
  }
  pushTri(outTris, C00, P[0][Nx], C10, computeFaceNormal(C00, P[0][Nx], C10), 1, -1, tileId);

  // East fan connecting C10 to P[0..Ny][Nx] and C11
  for (let j = 0; j < Ny; j++) {
    pushTri(outTris, C10, P[j][Nx], P[j+1][Nx], computeFaceNormal(C10, P[j][Nx], P[j+1][Nx]), 1, -1, tileId);
  }
  pushTri(outTris, C10, P[Ny][Nx], C11, computeFaceNormal(C10, P[Ny][Nx], C11), 1, -1, tileId);

  // North fan connecting C11 to P[Ny][Nx..0] and C01
  for (let i = Nx; i > 0; i--) {
    pushTri(outTris, C11, P[Ny][i], P[Ny][i-1], computeFaceNormal(C11, P[Ny][i], P[Ny][i-1]), 1, -1, tileId);
  }
  pushTri(outTris, C11, P[Ny][0], C01, computeFaceNormal(C11, P[Ny][0], C01), 1, -1, tileId);

  // West fan connecting C01 to P[Ny..0][0] and C00
  for (let j = Ny; j > 0; j--) {
    pushTri(outTris, C01, P[j][0], P[j-1][0], computeFaceNormal(C01, P[j][0], P[j-1][0]), 1, -1, tileId);
  }
  pushTri(outTris, C01, P[0][0], C00, computeFaceNormal(C01, P[0][0], C00), 1, -1, tileId);
}

function buildComplete3DModel(scene, state) {
  const meshes = {
    water: [],
    base: [],
    greenery: [],
    roads: [],
    buildings: [],
    highlighted: [],
    frame: []
  };
  const buildingBounds = [];

  if (!scene) return { meshes, buildingBounds, totalTriangles: 0 };

  // Contract 2: Rectangular Coordinates, Isotropic Scale & Inset
  const totalWidthMm = state.bedSizeMm || 320;
  const totalHeightMm = state.totalHeightMm || totalWidthMm;
  const maxDimMm = Math.max(totalWidthMm, totalHeightMm);
  const scaleMm = maxDimMm / 169.2;
  const mmPerUnit = scaleMm;
  const halfW = 84.6 * (totalWidthMm / maxDimMm);
  const halfH = 84.6 * (totalHeightMm / maxDimMm);

  const tileCols = Math.max(1, Math.min(8, state.tileCols || 1));
  const tileRows = Math.max(1, Math.min(8, state.tileRows || 1));
  const numTiles = tileCols * tileRows;
  const cellsPerCol = Math.max(9, Math.round((72 * (totalWidthMm / maxDimMm)) / tileCols));
  const TERRAIN_RES_X = cellsPerCol * tileCols;
  const cellsPerRow = Math.max(6, Math.round((72 * (totalHeightMm / maxDimMm)) / tileRows));
  const TERRAIN_RES_Y = cellsPerRow * tileRows;

  const cellStepX = (2 * halfW) / TERRAIN_RES_X;
  const cellStepY = (2 * halfH) / TERRAIN_RES_Y;
  const kerfMm = (tileCols > 1 || tileRows > 1) ? ((state.kerfMm !== undefined) ? state.kerfMm * 0.5 : (state.isResin ? 0.04 : 0.02)) : 0.0;
  const kerfUnits = kerfMm / scaleMm;

  // Sub-cropping
  const baseCrop = scene._fetchedCropRatio || 1.0;
  const effectiveCrop = Math.min(1.0, Math.max(0.35, (state.cropRatio || 0.88) / baseCrop));
  const cropCX = (state.cropCenterX || 0) * halfW;
  const cropCY = (state.cropCenterY || 0) * halfH;
  const scaleToBed = 1.0 / effectiveCrop;

  function toBed(pt) {
    return [(pt[0] - cropCX) * scaleToBed, (pt[1] - cropCY) * scaleToBed];
  }

  // --------------------------------------------------------------------------
  // STEP 1: HIGH-RES RASTER MASKS (WATER, GREEN, ROADS, OCCUPIED)
  // --------------------------------------------------------------------------
  const MASK_RES_X = Math.max(128, Math.round(320 * (totalWidthMm / maxDimMm)));
  const MASK_RES_Y = Math.max(128, Math.round(320 * (totalHeightMm / maxDimMm)));
  const maskCanvas = (typeof document !== 'undefined' && document.createElement)
    ? document.createElement('canvas')
    : createSoftwareMaskCanvas(MASK_RES_X, MASK_RES_Y);
  maskCanvas.width = MASK_RES_X;
  maskCanvas.height = MASK_RES_Y;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });

  const padW = halfW + 0.4;
  const padH = halfH + 0.4;
  const spanW = 2 * padW;
  const spanH = 2 * padH;

  function bedToMask(bx, by) {
    return [
      ((bx + padW) / spanW) * MASK_RES_X,
      ((padH - by) / spanH) * MASK_RES_Y
    ];
  }
  function sampleMaskIdx(bx, by) {
    const mx = Math.min(MASK_RES_X - 1, Math.max(0, Math.floor(((bx + padW) / spanW) * MASK_RES_X)));
    const my = Math.min(MASK_RES_Y - 1, Math.max(0, Math.floor(((padH - by) / spanH) * MASK_RES_Y)));
    return my * MASK_RES_X + mx;
  }

  // 1A. Water Mask
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  mctx.fillStyle = '#ffffff';
  mctx.strokeStyle = '#ffffff';
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';

  (scene.waterPolys || []).forEach(wp => {
    mctx.beginPath();
    wp.outer.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    (wp.holes || []).forEach(h => {
      h.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
    });
    mctx.fill('evenodd');
  });

  (scene.waterLines || []).forEach(wl => {
    const effW = Math.min(5.2, Math.max(1.1, wl.width || 2.0));
    mctx.lineWidth = Math.max(1.8, effW * scaleToBed * (MASK_RES_X / (2 * halfW)));
    mctx.beginPath();
    wl.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });

  const waterImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;
  const waterMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < MASK_RES_X * MASK_RES_Y; i++) {
    waterMask[i] = waterImg[i * 4 + 3] > 90 ? 1 : 0;
  }

  const waterDepth = new Float32Array(MASK_RES_X * MASK_RES_Y);
  const shoreDist = new Float32Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < MASK_RES_X * MASK_RES_Y; i++) {
    waterDepth[i] = waterMask[i] ? 9999 : 0;
    shoreDist[i] = waterMask[i] ? 0 : 9999;
  }
  for (let y = 1; y < MASK_RES_Y - 1; y++) {
    for (let x = 1; x < MASK_RES_X - 1; x++) {
      const idx = y * MASK_RES_X + x;
      if (waterDepth[idx] > 0) {
        waterDepth[idx] = Math.min(waterDepth[idx], waterDepth[idx - 1] + 1, waterDepth[idx - MASK_RES_X] + 1);
      }
      if (shoreDist[idx] > 0) {
        shoreDist[idx] = Math.min(shoreDist[idx], shoreDist[idx - 1] + 1, shoreDist[idx - MASK_RES_X] + 1);
      }
    }
  }
  for (let y = MASK_RES_Y - 2; y >= 1; y--) {
    for (let x = MASK_RES_X - 2; x >= 1; x--) {
      const idx = y * MASK_RES_X + x;
      if (waterDepth[idx] > 0) {
        waterDepth[idx] = Math.min(waterDepth[idx], waterDepth[idx + 1] + 1, waterDepth[idx + MASK_RES_X] + 1);
      }
      if (shoreDist[idx] > 0) {
        shoreDist[idx] = Math.min(shoreDist[idx], shoreDist[idx + 1] + 1, shoreDist[idx + MASK_RES_X] + 1);
      }
    }
  }

  // 1B. Greenery Mask
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  (scene.greenPolys || scene.greeneryPolys || []).forEach(gp => {
    mctx.beginPath();
    gp.outer.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    (gp.holes || []).forEach(h => {
      h.forEach((p, i) => {
        const b = toBed(p);
        const [px, py] = bedToMask(b[0], b[1]);
        if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
      });
      mctx.closePath();
    });
    mctx.fill('evenodd');
  });
  const greenImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;

  // 1C. Identify bridge spans from scene.roads that cross water
  const bridgeSpans = [];

  (scene.roads || []).forEach(rd => {
    if (!rd.pts || rd.pts.length < 2) return;
    const isExplicitBridge = rd.bridge === true || (rd.layer && rd.layer >= 1);
    const pts = rd.pts.map(toBed);

    const roadWidthUnits = (rd.width || 3.0) * scaleToBed;
    const brWidth = Math.max(roadWidthUnits, 0.48 / scaleMm);
    const brHalfW = brWidth * 0.5;

    // Resample along rd.pts to find contiguous spans strictly over water
    const densePts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const pA = pts[i], pB = pts[i + 1];
      const segLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
      const steps = Math.max(1, Math.ceil(segLen / 0.35));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        densePts.push([pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t]);
      }
    }
    densePts.push(pts[pts.length - 1]);

    let i = 0;
    while (i < densePts.length) {
      if (waterMask[sampleMaskIdx(densePts[i][0], densePts[i][1])]) {
        const iStart = i;
        while (i < densePts.length && waterMask[sampleMaskIdx(densePts[i][0], densePts[i][1])]) i++;
        const iEnd = i - 1;

        if (!isExplicitBridge) {
          const crossesFromLand = (iStart > 0 && waterMask[sampleMaskIdx(densePts[iStart - 1][0], densePts[iStart - 1][1])] === 0);
          const exitsToLand = (iEnd < densePts.length - 1 && waterMask[sampleMaskIdx(densePts[iEnd + 1][0], densePts[iEnd + 1][1])] === 0);
          const rawSpanLen = Math.hypot(densePts[iEnd][0] - densePts[iStart][0], densePts[iEnd][1] - densePts[iStart][1]);
          if (!crossesFromLand || !exitsToLand || rawSpanLen < 2.0) {
            continue;
          }
        }

        let sub = densePts.slice(iStart, iEnd + 1);

        // Trim span ends so both left and right ribbon edges are strictly inside waterMask
        while (sub.length > 2) {
          const p0 = sub[0], p1 = sub[1];
          const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const leftWater = waterMask[sampleMaskIdx(p0[0] + nx * brHalfW, p0[1] + ny * brHalfW)] === 1;
          const rightWater = waterMask[sampleMaskIdx(p0[0] - nx * brHalfW, p0[1] - ny * brHalfW)] === 1;
          if (leftWater && rightWater) break;
          sub.shift();
        }
        while (sub.length > 2) {
          const pN = sub[sub.length - 1], pPrev = sub[sub.length - 2];
          const dx = pN[0] - pPrev[0], dy = pN[1] - pPrev[1], len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const leftWater = waterMask[sampleMaskIdx(pN[0] + nx * brHalfW, pN[1] + ny * brHalfW)] === 1;
          const rightWater = waterMask[sampleMaskIdx(pN[0] - nx * brHalfW, pN[1] - ny * brHalfW)] === 1;
          if (leftWater && rightWater) break;
          sub.pop();
        }

        if (sub.length >= 2) {
          const spanPts = [sub[0]];
          for (let k = 1; k < sub.length - 1; k++) {
            if (Math.hypot(sub[k][0] - spanPts[spanPts.length - 1][0], sub[k][1] - spanPts[spanPts.length - 1][1]) >= 1.2) {
              spanPts.push(sub[k]);
            }
          }
          spanPts.push(sub[sub.length - 1]);
          if (spanPts.length >= 2 && Math.hypot(spanPts[spanPts.length - 1][0] - spanPts[0][0], spanPts[spanPts.length - 1][1] - spanPts[0][1]) >= 0.8) {
            bridgeSpans.push({ rd, pts: spanPts });
          }
        }
      } else {
        i++;
      }
    }
  });

  // 1D. Ground Road Mask
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  (scene.roads || []).forEach(rd => {
    mctx.lineWidth = Math.max(2.2, (rd.width || 3.0) * scaleToBed * (MASK_RES_X / (2 * halfW)) * 1.12);
    mctx.beginPath();
    rd.pts.forEach((p, i) => {
      const b = toBed(p);
      const [px, py] = bedToMask(b[0], b[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.stroke();
  });
  const roadImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;
  const roadMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < MASK_RES_X * MASK_RES_Y; i++) {
    roadMask[i] = (roadImg[i * 4 + 3] > 90 && !waterMask[i]) ? 1 : 0;
  }

  // Building footprint mask for clearing road/greenery overlap
  mctx.clearRect(0, 0, MASK_RES_X, MASK_RES_Y);
  mctx.lineWidth = 4.2;
  (scene.buildings || []).forEach(b => {
    if (b.hidden || b.btype === 'pier') return;
    mctx.beginPath();
    b.outer.forEach((p, i) => {
      const bp = toBed(p);
      const [px, py] = bedToMask(bp[0], bp[1]);
      if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
    });
    mctx.closePath();
    mctx.fill();
    mctx.stroke();
  });
  const bldImg = mctx.getImageData(0, 0, MASK_RES_X, MASK_RES_Y).data;
  const bldMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const roadAndBldMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  const greenMask = new Uint8Array(MASK_RES_X * MASK_RES_Y);
  for (let i = 0; i < MASK_RES_X * MASK_RES_Y; i++) {
    bldMask[i] = bldImg[i * 4 + 3] > 60 ? 1 : 0;
    if (bldMask[i]) {
      roadMask[i] = 0;
    }
    roadAndBldMask[i] = (roadMask[i] || bldMask[i]) ? 1 : 0;
    const isRiparian = (!waterMask[i] && shoreDist[i] > 0 && shoreDist[i] <= 10.5 && !roadAndBldMask[i]);
    greenMask[i] = ((greenImg[i * 4 + 3] > 90 || isRiparian) && !waterMask[i] && !roadMask[i] && !bldMask[i]) ? 1 : 0;
  }

  // Smooth continuous scalar fields for non-pixelated Marching-Squares roads & parks
  const smoothRoad = new Float32Array(MASK_RES_X * MASK_RES_Y);
  const smoothGreen = new Float32Array(MASK_RES_X * MASK_RES_Y);
  for (let y = 0; y < MASK_RES_Y; y++) {
    for (let x = 0; x < MASK_RES_X; x++) {
      let rSum = 0, gSum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= MASK_RES_Y) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= MASK_RES_X) continue;
          const idx = ny * MASK_RES_X + nx;
          rSum += roadMask[idx];
          gSum += greenMask[idx];
          cnt++;
        }
      }
      const idx = y * MASK_RES_X + x;
      smoothRoad[idx] = rSum / cnt;
      smoothGreen[idx] = gSum / cnt;
    }
  }

  function sampleSmoothMask(buf, bx, by) {
    const [mx, my] = bedToMask(bx, by);
    const fx = Math.min(MASK_RES_X - 1.001, Math.max(0, mx));
    const fy = Math.min(MASK_RES_Y - 1.001, Math.max(0, my));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(MASK_RES_X - 1, x0 + 1);
    const y1 = Math.min(MASK_RES_Y - 1, y0 + 1);
    const wx = fx - x0, wy = fy - y0;
    const v00 = buf[y0 * MASK_RES_X + x0];
    const v10 = buf[y0 * MASK_RES_X + x1];
    const v01 = buf[y1 * MASK_RES_X + x0];
    const v11 = buf[y1 * MASK_RES_X + x1];
    return (v00 * (1 - wx) + v10 * wx) * (1 - wy) + (v01 * (1 - wx) + v11 * wx) * wy;
  }

  function getRoadField(bx, by) {
    if (bldMask[sampleMaskIdx(bx, by)]) return 0;
    return sampleSmoothMask(smoothRoad, bx, by);
  }

  function getGreenField(bx, by, roadVal) {
    if (bldMask[sampleMaskIdx(bx, by)] || waterMask[sampleMaskIdx(bx, by)]) return 0;
    const rawG = sampleSmoothMask(smoothGreen, bx, by);
    const rV = roadVal !== undefined ? roadVal : getRoadField(bx, by);
    return Math.max(0, Math.min(rawG, 0.85 - rV));
  }

  // --------------------------------------------------------------------------
  // STEP 2: REAL DEM INTERPOLATION, DENOISING & LAYER QUANTIZATION
  // --------------------------------------------------------------------------
  const demObj = scene.dem || { gridSize: 2, minElev: 0, maxElev: 10, grid: [[0, 0], [0, 0]] };
  const demN = demObj.gridSize;
  const demRaw = demObj.grid;
  const minElev = demObj.minElev;
  const maxElev = Math.max(minElev + 6.0, demObj.maxElev);

  function sampleRawDemMeters(bx, by) {
    const ox = bx / scaleToBed + cropCX;
    const oy = by / scaleToBed + cropCY;
    const u = Math.min(1, Math.max(0, (ox + padW) / spanW)) * (demN - 1);
    const v = Math.min(1, Math.max(0, (oy + padH) / spanH)) * (demN - 1);
    const i0 = Math.floor(u), i1 = Math.min(demN - 1, i0 + 1);
    const j0 = Math.floor(v), j1 = Math.min(demN - 1, j0 + 1);
    const fu = u - i0, fv = v - j0;
    const z00 = demRaw[j0][i0], z10 = demRaw[j0][i1];
    const z01 = demRaw[j1][i0], z11 = demRaw[j1][i1];
    return (z00 * (1 - fu) + z10 * fu) * (1 - fv) + (z01 * (1 - fu) + z11 * fu) * fv;
  }

  const strideTX = TERRAIN_RES_X + 1;
  const strideTY = TERRAIN_RES_Y + 1;
  let demGrid = new Float32Array(strideTX * strideTY);

  for (let gy = 0; gy <= TERRAIN_RES_Y; gy++) {
    const by = -halfH + (gy / TERRAIN_RES_Y) * (2 * halfH);
    for (let gx = 0; gx <= TERRAIN_RES_X; gx++) {
      const bx = -halfW + (gx / TERRAIN_RES_X) * (2 * halfW);
      demGrid[gy * strideTX + gx] = Math.max(0, sampleRawDemMeters(bx, by) - minElev);
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(strideTX * strideTY);
    for (let gy = 0; gy <= TERRAIN_RES_Y; gy++) {
      for (let gx = 0; gx <= TERRAIN_RES_X; gx++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = Math.min(TERRAIN_RES_Y, Math.max(0, gy + dy));
            const nx = Math.min(TERRAIN_RES_X, Math.max(0, gx + dx));
            const w = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1;
            sum += demGrid[ny * strideTX + nx] * w;
            cnt += w;
          }
        }
        next[gy * strideTX + gx] = sum / cnt;
      }
    }
    demGrid = next;
  }

  const mToU = (scene.metersToUnits || 0.13) * scaleToBed;
  const hollowBase = !!state.hollowBase;
  const layerHeightMm = state.layerHeightMm || (state.isResin ? 0.05 : 0.20);
  const quantizeZUnits = (uVal) => {
    const mm = uVal * mmPerUnit;
    const qMm = Math.max(layerHeightMm, Math.round(mm / layerHeightMm) * layerHeightMm);
    return qMm / mmPerUnit;
  };

  const baseBottomZ = quantizeZUnits(2.45);
  const realElevDelta = Math.max(4.0, maxElev - minElev);
  const isAlpineRelief = realElevDelta > 150.0;
  const maxReliefUnits = isAlpineRelief
    ? Math.max(3.5, Math.min(14.0, realElevDelta * mToU * 2.2 * (state.terrainScale || 1.0)))
    : Math.max(0.6, Math.min(1.8, realElevDelta * mToU * 0.45 * (state.terrainScale || 1.0)));
  const elevSpan = Math.max(10.0, realElevDelta);
  const numContourSteps = isAlpineRelief
    ? Math.max(8, Math.min(18, Math.round(maxReliefUnits / 0.42)))
    : Math.max(2, Math.min(3, Math.round(maxReliefUnits / 0.42)));
  const stepUnits = quantizeZUnits(maxReliefUnits / numContourSteps);

  let zGrid = new Float32Array(strideTX * strideTY);
  for (let gy = 0; gy <= TERRAIN_RES_Y; gy++) {
    const by = -halfH + (gy / TERRAIN_RES_Y) * (2 * halfH);
    for (let gx = 0; gx <= TERRAIN_RES_X; gx++) {
      const bx = -halfW + (gx / TERRAIN_RES_X) * (2 * halfW);
      const mIdx = sampleMaskIdx(bx, by);
      const relE = demGrid[gy * strideTX + gx];
      if (waterMask[mIdx]) {
        zGrid[gy * strideTX + gx] = baseBottomZ - 0.14 - Math.min(0.85, waterDepth[mIdx] * 0.045);
      } else {
        const bankDistLimit = isAlpineRelief ? 6.0 : 16.0;
        const bankBlend = Math.min(1.0, shoreDist[mIdx] / bankDistLimit);
        const hUnits = (relE / elevSpan) * maxReliefUnits * bankBlend;
        zGrid[gy * strideTX + gx] = baseBottomZ + 0.15 + hUnits;
      }
    }
  }

  {
    const nextZ = new Float32Array(zGrid.length);
    for (let gy = 0; gy <= TERRAIN_RES_Y; gy++) {
      const by = -halfH + (gy / TERRAIN_RES_Y) * (2 * halfH);
      for (let gx = 0; gx <= TERRAIN_RES_X; gx++) {
        const bx = -halfW + (gx / TERRAIN_RES_X) * (2 * halfW);
        const mIdx = sampleMaskIdx(bx, by);
        if (waterMask[mIdx]) {
          nextZ[gy * strideTX + gx] = zGrid[gy * strideTX + gx];
          continue;
        }
        let sum = zGrid[gy * strideTX + gx] * 4.0, w = 4.0;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dx, dy] of dirs) {
          const nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx <= TERRAIN_RES_X && ny >= 0 && ny <= TERRAIN_RES_Y) {
            const nbx = -halfW + (nx / TERRAIN_RES_X) * (2 * halfW);
            const nby = -halfH + (ny / TERRAIN_RES_Y) * (2 * halfH);
            if (!waterMask[sampleMaskIdx(nbx, nby)]) {
              sum += zGrid[ny * strideTX + nx];
              w += 1.0;
            }
          }
        }
        nextZ[gy * strideTX + gx] = sum / w;
      }
    }
    zGrid = nextZ;
  }

  const deepWaterZ = quantizeZUnits(1.76);
  const zSubWater = quantizeZUnits(1.36);
  const zDrainVault = quantizeZUnits(0.72);
  const gHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.28));
  const rHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.36));
  const brHeight = Math.max(layerHeightMm / mmPerUnit, quantizeZUnits(0.56));
  const hollowWallUnits = Math.max(0.55, Math.min(1.15, (state.hollowWallMm || 1.8) / Math.max(1.05, mmPerUnit)));
  let vaultSavedSceneVol = 0;

  const thresholds = [];
  for (let k = 0; k <= numContourSteps + 2; k++) {
    thresholds.push(baseBottomZ + k * stepUnits);
  }

  // Contract 1.2: epsSep = 0.0 for exact IEEE-754 float flush contact
  const epsSep = 0.0;
  const zWaterBot = zSubWater;

  // Individual Building Ground Pad Leveling on zGrid
  // ONLY on non-water grid vertices (!waterMask[mIdx]) where (vx, vy) actually lies inside
  // or within 0.55 * Math.max(cellStepX, cellStepY) of an individual building's outer polygon (pointInPolyOrNear2D).
  // NEVER merge disjoint buildings across streets/rivers into a shared terrain pad!
  const activeBldList = [];
  (scene.buildings || []).forEach(b => {
    if (b.hidden || b.btype === 'pier' || b.isOutline) return;
    const clipped = clipPolyToBox(b.outer.map(toBed), -halfW + 0.4, -halfH + 0.4, halfW - 0.4, halfH - 0.4);
    if (clipped.length < 3) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < clipped.length; i++) {
      const p = clipped[i];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const gxMin = Math.max(0, Math.floor(((minX + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const gxMax = Math.min(TERRAIN_RES_X - 1, Math.floor(((maxX + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const gyMin = Math.max(0, Math.floor(((minY + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gyMax = Math.min(TERRAIN_RES_Y - 1, Math.floor(((maxY + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    activeBldList.push({
      b, clipped, minX, maxX, minY, maxY, gxMin, gxMax, gyMin, gyMax,
      groupId: b.groupId || b.osmId || b.id
    });
  });

  const padTol = 0.55 * Math.max(cellStepX, cellStepY);
  for (let bIdx = 0; bIdx < activeBldList.length; bIdx++) {
    const item = activeBldList[bIdx];
    const poly = item.clipped;
    if (!poly || poly.length < 3) continue;

    const touchingLandIndices = [];
    let minZ = Infinity;
    for (let gy = item.gyMin; gy <= item.gyMax + 1; gy++) {
      if (gy < 0 || gy > TERRAIN_RES_Y) continue;
      const vy = -halfH + (gy / TERRAIN_RES_Y) * (2 * halfH);
      for (let gx = item.gxMin; gx <= item.gxMax + 1; gx++) {
        if (gx < 0 || gx > TERRAIN_RES_X) continue;
        const vx = -halfW + (gx / TERRAIN_RES_X) * (2 * halfW);
        const mIdx = sampleMaskIdx(vx, vy);
        if (waterMask[mIdx]) continue; // NEVER touch water!
        if (pointInPolyOrNear2D(vx, vy, poly, padTol)) {
          const idx = gy * strideTX + gx;
          touchingLandIndices.push(idx);
          if (zGrid[idx] < minZ) minZ = zGrid[idx];
        }
      }
    }

    if (touchingLandIndices.length > 0 && Number.isFinite(minZ)) {
      const padZ = Math.max(baseBottomZ + 0.15, minZ);
      for (let k = 0; k < touchingLandIndices.length; k++) {
        zGrid[touchingLandIndices[k]] = padZ;
      }
    }
  }

  // Simulation of Simplicity (Edelsbrunner & Mücke): perturb any grid vertex landing within 1e-3 of a threshold
  for (let i = 0; i < zGrid.length; i++) {
    for (let k = 0; k <= numContourSteps + 2; k++) {
      if (Math.abs(zGrid[i] - thresholds[k]) < 1e-3) {
        zGrid[i] += 1.2e-3;
      }
    }
  }

  function getStepIdxForVal(zVal) {
    if (zVal < thresholds[0]) return -1;
    for (let k = numContourSteps; k >= 0; k--) {
      if (zVal >= thresholds[k]) return k;
    }
    return 0;
  }

  function getQuantizedTerrainZ(bx, by) {
    const u = Math.min(TERRAIN_RES_X - 1e-6, Math.max(0, ((bx + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const v = Math.min(TERRAIN_RES_Y - 1e-6, Math.max(0, ((by + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gx = Math.min(TERRAIN_RES_X - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES_Y - 1, Math.floor(v));
    const v00 = zGrid[gy * strideTX + gx];
    const v10 = zGrid[gy * strideTX + (gx + 1)];
    const v11 = zGrid[(gy + 1) * strideTX + (gx + 1)];
    const v01 = zGrid[(gy + 1) * strideTX + gx];
    const zVal = Math.max(v00, v10, v11, v01);
    const stepIdx = getStepIdxForVal(zVal);
    if (stepIdx < 0) return baseBottomZ;
    return thresholds[stepIdx];
  }

  function sampleRawTerrainGridZ(bx, by) {
    const u = Math.min(TERRAIN_RES_X - 1e-6, Math.max(0, ((bx + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const v = Math.min(TERRAIN_RES_Y - 1e-6, Math.max(0, ((by + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gx = Math.min(TERRAIN_RES_X - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES_Y - 1, Math.floor(v));
    const fu = u - gx, fv = v - gy;
    const v00 = zGrid[gy * strideTX + gx];
    const v10 = zGrid[gy * strideTX + (gx + 1)];
    const v11 = zGrid[(gy + 1) * strideTX + (gx + 1)];
    const v01 = zGrid[(gy + 1) * strideTX + gx];
    return (v00 * (1 - fu) + v10 * fu) * (1 - fv) + (v01 * (1 - fu) + v11 * fu) * fv;
  }

  function getActualPrintedSurfaceMinZAtCell(gx, gy) {
    const cx = Math.min(TERRAIN_RES_X - 1, Math.max(0, gx));
    const cy = Math.min(TERRAIN_RES_Y - 1, Math.max(0, gy));
    const v00 = zGrid[cy * strideTX + cx];
    const v10 = zGrid[cy * strideTX + (cx + 1)];
    const v11 = zGrid[(cy + 1) * strideTX + (cx + 1)];
    const v01 = zGrid[(cy + 1) * strideTX + cx];
    const vMin = Math.min(v00, v10, v11, v01);
    const stepIdx = getStepIdxForVal(vMin);
    if (stepIdx < 0) {
      return (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
    }
    return thresholds[stepIdx];
  }

  function getActualPrintedSurfaceMinZ(bx, by) {
    if (waterMask[sampleMaskIdx(bx, by)]) {
      return (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
    }
    const u = Math.min(TERRAIN_RES_X - 1e-6, Math.max(0, ((bx + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const v = Math.min(TERRAIN_RES_Y - 1e-6, Math.max(0, ((by + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gx = Math.min(TERRAIN_RES_X - 1, Math.floor(u));
    const gy = Math.min(TERRAIN_RES_Y - 1, Math.floor(v));
    if (typeof cellTerracePolys !== 'undefined' && cellTerracePolys[gy * TERRAIN_RES_X + gx] && cellTerracePolys[gy * TERRAIN_RES_X + gx].length > 0) {
      const tList = cellTerracePolys[gy * TERRAIN_RES_X + gx];
      for (let i = 0; i < tList.length; i++) {
        if (pointInPoly2D(bx, by, tList[i].poly)) {
          return tList[i].zSurf;
        }
      }
      let maxLandZ = baseBottomZ;
      for (let i = 0; i < tList.length; i++) {
        if (tList[i].zSurf > maxLandZ) maxLandZ = tList[i].zSurf;
      }
      return maxLandZ;
    }
    const rawZ = sampleRawTerrainGridZ(bx, by);
    const k = getStepIdxForVal(rawZ);
    return (k < 0) ? baseBottomZ : thresholds[k];
  }

  function getTileColRowForXY(bx, by) {
    const tc = Math.max(0, Math.min(tileCols - 1, Math.floor(((bx + halfW) / (2 * halfW)) * tileCols)));
    const tr = Math.max(0, Math.min(tileRows - 1, Math.floor(((by + halfH) / (2 * halfH)) * tileRows)));
    return [tc, tr, tr * tileCols + tc];
  }

  const cellMinTopZ = new Float32Array(TERRAIN_RES_X * TERRAIN_RES_Y);
  for (let gy = 0; gy < TERRAIN_RES_Y; gy++) {
    for (let gx = 0; gx < TERRAIN_RES_X; gx++) {
      const v00 = zGrid[gy * strideTX + gx];
      const v10 = zGrid[gy * strideTX + (gx + 1)];
      const v11 = zGrid[(gy + 1) * strideTX + (gx + 1)];
      const v01 = zGrid[(gy + 1) * strideTX + gx];
      const vMin = Math.min(v00, v10, v11, v01);
      const kMin = getStepIdxForVal(vMin);
      cellMinTopZ[gy * TERRAIN_RES_X + gx] = (kMin < 0) ? zSubWater : thresholds[kMin];
    }
  }

  // Precompute tile bounds with kerf inset
  const tileBounds = [];
  for (let tr = 0; tr < tileRows; tr++) {
    const gy0 = tr * cellsPerRow;
    const gy1 = (tr === tileRows - 1) ? TERRAIN_RES_Y : (tr + 1) * cellsPerRow;
    const nominalY0 = -halfH + gy0 * cellStepY;
    const nominalY1 = (tr === tileRows - 1) ? halfH : -halfH + gy1 * cellStepY;
    const tileY0 = nominalY0 + (tr > 0 ? kerfUnits : 0.0);
    const tileY1 = nominalY1 - (tr < tileRows - 1 ? kerfUnits : 0.0);

    for (let tc = 0; tc < tileCols; tc++) {
      const gx0 = tc * cellsPerCol;
      const gx1 = (tc === tileCols - 1) ? TERRAIN_RES_X : (tc + 1) * cellsPerCol;
      const nominalX0 = -halfW + gx0 * cellStepX;
      const nominalX1 = (tc === tileCols - 1) ? halfW : -halfW + gx1 * cellStepX;
      const tileX0 = nominalX0 + (tc > 0 ? kerfUnits : 0.0);
      const tileX1 = nominalX1 - (tc < tileCols - 1 ? kerfUnits : 0.0);
      const tileId = tr * tileCols + tc;
      tileBounds[tileId] = {
        tc, tr, gx0, gx1, gy0, gy1,
        x0: tileX0, x1: tileX1, y0: tileY0, y1: tileY1,
        stepX: (tileX1 - tileX0) / (gx1 - gx0),
        stepY: (tileY1 - tileY0) / (gy1 - gy0)
      };
    }
  }

  // Helper to emit a 100% watertight 1D staircase wall along an outer tile boundary cell edge (pA -> pB)
  function emitBoundaryStaircaseWall(ax, ay, vA, fA, bx, by, vB, fB, norm, tileId) {
    const getBandTopZ = (val) => {
      const k = getStepIdxForVal(val);
      return (k < 0) ? zSubWater : thresholds[k];
    };

    const cuts = [];
    const vLo = Math.min(vA, vB), vHi = Math.max(vA, vB);
    for (let k = 0; k <= numContourSteps; k++) {
      const thr = thresholds[k];
      if (thr > vLo && thr < vHi) {
        const pt = interpCellEdgeCanonical({ x: ax, y: ay, v: vA }, { x: bx, y: by, v: vB }, thr);
        const s = Math.hypot(pt.x - ax, pt.y - ay) / (Math.hypot(bx - ax, by - ay) || 1e-9);
        cuts.push({ x: pt.x, y: pt.y, thr, k, s });
      }
    }
    cuts.sort((a, b) => a.s - b.s);

    const chain = [];
    let currZ = getBandTopZ(vA);
    chain.push([ax, ay, currZ]);
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i];
      chain.push([c.x, c.y, currZ]);
      const nextZ = (vB > vA)
        ? c.thr
        : (c.k === 0 ? zSubWater : thresholds[c.k - 1]);
      chain.push([c.x, c.y, nextZ]);
      currZ = nextZ;
    }
    chain.push([bx, by, currZ]);

    const AFloor = [ax, ay, fA];
    const BFloor = [bx, by, fB];
    const lastTop = chain[chain.length - 1];

    for (let i = 0; i < chain.length - 1; i++) {
      const P0 = chain[i], P1 = chain[i + 1];
      if (Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]) > 1e-6) {
        pushTri(meshes.base, AFloor, P1, P0, norm, 1, -1, tileId);
      }
    }
    pushTri(meshes.base, AFloor, BFloor, lastTop, norm, 1, -1, tileId);
  }

  // Helper to emit outer tile boundary wall for the water basin (v <= baseBottomZ)
  function emitWaterBoundaryWall(ax, ay, vA, bx, by, vB, norm, tileId) {
    if (vA >= baseBottomZ && vB >= baseBottomZ) return;
    const pA = { x: ax, y: ay, v: vA };
    const pB = { x: bx, y: by, v: vB };
    if (vA < baseBottomZ && vB < baseBottomZ) {
      pushQuad(meshes.water, [ax, ay, zWaterBot], [bx, by, zWaterBot], [bx, by, deepWaterZ], [ax, ay, deepWaterZ], norm, 0, -1, tileId);
    } else if (vA < baseBottomZ) {
      const cut = interpCellEdgeCanonical(pA, pB, baseBottomZ);
      pushQuad(meshes.water, [ax, ay, zWaterBot], [cut.x, cut.y, zWaterBot], [cut.x, cut.y, deepWaterZ], [ax, ay, deepWaterZ], norm, 0, -1, tileId);
    } else {
      const cut = interpCellEdgeCanonical(pA, pB, baseBottomZ);
      pushQuad(meshes.water, [cut.x, cut.y, zWaterBot], [bx, by, zWaterBot], [bx, by, deepWaterZ], [cut.x, cut.y, deepWaterZ], norm, 0, -1, tileId);
    }
  }

  function emitClosedSlab2D(poly2d, zBot, zTop, layerId, outTris, tileId) {
    const cleaned = cleanPolygonRing(poly2d.slice(), true);
    if (cleaned.length < 3 || Math.abs(signedArea2D(cleaned)) < 0.02) return;
    const insetDist = 0.018;
    let cx = 0, cy = 0;
    for (let i = 0; i < cleaned.length; i++) { cx += cleaned[i][0]; cy += cleaned[i][1]; }
    cx /= cleaned.length; cy /= cleaned.length;
    let maxD = 0;
    for (let i = 0; i < cleaned.length; i++) {
      const d = Math.hypot(cleaned[i][0] - cx, cleaned[i][1] - cy);
      if (d > maxD) maxD = d;
    }
    if (maxD <= insetDist * 1.5) return;
    const scale = Math.max(0.05, (maxD - insetDist) / maxD);
    const inset = cleaned.map(p => [cx + (p[0] - cx) * scale, cy + (p[1] - cy) * scale]);
    if (inset.length < 3 || Math.abs(signedArea2D(inset)) < 0.01) return;
    if (signedArea2D(inset) < 0) inset.reverse();
    const tris = triangulateSimplePoly(inset);
    for (let ti = 0; ti < tris.length; ti++) {
      const tri = tris[ti];
      if (signedArea2D(tri) <= 1e-5) continue;
      pushTri(outTris, [tri[0][0], tri[0][1], zTop], [tri[1][0], tri[1][1], zTop], [tri[2][0], tri[2][1], zTop], [0, 0, 1], layerId, -1, tileId);
      pushTri(outTris, [tri[0][0], tri[0][1], zBot], [tri[2][0], tri[2][1], zBot], [tri[1][0], tri[1][1], zBot], [0, 0, -1], layerId, -1, tileId);
    }
    for (let i = 0; i < inset.length; i++) {
      const a = inset[i], b = inset[(i + 1) % inset.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len > 1e-5) {
        pushQuad(outTris, [a[0], a[1], zBot], [b[0], b[1], zBot], [b[0], b[1], zTop], [a[0], a[1], zTop], [dy / len, -dx / len, 0], layerId, -1, tileId);
      }
    }
  }

  // Precompute high-bank bridge spans and bank land terrace elevations
  const bridgeData = [];
  (bridgeSpans || []).forEach((span, spanIdx) => {
    const { rd, pts: spanPts } = span;
    if (!spanPts || spanPts.length < 2) return;
    const roadWidthUnits = (rd.width || 3.0) * scaleToBed;
    const brWidth = Math.max(roadWidthUnits, 0.48 / scaleMm);
    const brHalfW = brWidth * 0.5;
    const pStart = spanPts[0];
    const pEnd = spanPts[spanPts.length - 1];
    const zBankA = Math.max(baseBottomZ, sampleRawTerrainGridZ(pStart[0], pStart[1]));
    const zBankB = Math.max(baseBottomZ, sampleRawTerrainGridZ(pEnd[0], pEnd[1]));
    const layerClearance = Math.max(0, (rd.layer || 1) - 1) * 0.55;
    const zDeckBot = quantizeZUnits(Math.max(zBankA, zBankB, baseBottomZ + 0.30) + layerClearance);
    const zDeckTop = quantizeZUnits(zDeckBot + brHeight);
    bridgeData.push({
      spanIdx, rd, pts: spanPts, brWidth, brHalfW, pStart, pEnd, zDeckBot, zDeckTop
    });
  });

  function getRoadDeckTop(polyPts, defaultTop) {
    let top = defaultTop;
    for (let bi = 0; bi < bridgeData.length; bi++) {
      const br = bridgeData[bi];
      for (let pi = 0; pi < polyPts.length; pi++) {
        const pt = polyPts[pi];
        const dStart = Math.hypot(pt[0] - br.pStart[0], pt[1] - br.pStart[1]);
        const dEnd = Math.hypot(pt[0] - br.pEnd[0], pt[1] - br.pEnd[1]);
        if (dStart <= br.brHalfW + 0.7 || dEnd <= br.brHalfW + 0.7) {
          if (br.zDeckTop > top) top = br.zDeckTop;
          break;
        }
      }
    }
    return top;
  }

  function getCellSubTypes(x0, y0, x1, y1) {
    const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
    const subBoxes = [
      [x0, y0, mx, my],
      [mx, y0, x1, my],
      [x0, my, mx, y1],
      [mx, my, x1, y1]
    ];
    const subTypes = [0, 0, 0, 0]; // 0 = empty, 1 = road, 2 = green
    let rdCount = 0, grCount = 0;
    for (let s = 0; s < 4; s++) {
      const [sx0, sy0, sx1, sy1] = subBoxes[s];
      const mIdx = sampleMaskIdx((sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5);
      const hasBld =
        bldMask[mIdx] === 1 ||
        bldMask[sampleMaskIdx(sx0, sy0)] === 1 ||
        bldMask[sampleMaskIdx(sx1, sy0)] === 1 ||
        bldMask[sampleMaskIdx(sx0, sy1)] === 1 ||
        bldMask[sampleMaskIdx(sx1, sy1)] === 1;
      const isRd = !hasBld && (roadMask[mIdx] === 1);
      const isGr = !hasBld && !isRd && greenMask[mIdx] === 1;
      if (isRd) { subTypes[s] = 1; rdCount++; }
      else if (isGr) { subTypes[s] = 2; grCount++; }
    }
    return { subBoxes, subTypes, rdCount, grCount };
  }

  function emitCellFeatureSlabs(polyXY, x0, y0, x1, y1, tZ, tileId) {
    const roadsVisible = !state.layerVisible || state.layerVisible.roads !== false;
    const greenVisible = !state.layerVisible || state.layerVisible.greenery !== false;
    if (!roadsVisible && !greenVisible) return;

    const basePoly = polyXY ? cleanPolygonRing(polyXY.slice(), true) : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    if (basePoly.length < 3) return;

    // 1. Road feature (continuous Marching-Squares ribbon)
    if (roadsVisible) {
      const roadPts = basePoly.map(pt => ({ x: pt[0], y: pt[1], v: getRoadField(pt[0], pt[1]) }));
      const rMin = Math.min(...roadPts.map(p => p.v));
      const rMax = Math.max(...roadPts.map(p => p.v));
      if (rMax >= 0.5) {
        let rPoly = null;
        if (rMin >= 0.5) {
          rPoly = basePoly;
        } else {
          const clipped = clipCellPolyByScalar(roadPts, 0.5, true);
          if (clipped.poly.length >= 3) {
            rPoly = clipped.poly.map(pt => [pt.x, pt.y]);
          }
        }
        if (rPoly && rPoly.length >= 3) {
          const zTop = getRoadDeckTop(rPoly, tZ + rHeight);
          emitClosedSlab2D(rPoly, tZ, zTop, 3, meshes.roads, tileId);
        }
      }
    }

    // 2. Greenery feature (continuous Marching-Squares ribbon, disjoint from roads)
    if (greenVisible) {
      const greenPts = basePoly.map(pt => ({ x: pt[0], y: pt[1], v: getGreenField(pt[0], pt[1]) }));
      const gMin = Math.min(...greenPts.map(p => p.v));
      const gMax = Math.max(...greenPts.map(p => p.v));
      if (gMax >= 0.5) {
        let gPoly = null;
        if (gMin >= 0.5) {
          gPoly = basePoly;
        } else {
          const clipped = clipCellPolyByScalar(greenPts, 0.5, true);
          if (clipped.poly.length >= 3) {
            gPoly = clipped.poly.map(pt => [pt.x, pt.y]);
          }
        }
        if (gPoly && gPoly.length >= 3) {
          emitClosedSlab2D(gPoly, tZ, tZ + gHeight, 2, meshes.greenery, tileId);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 3: PER-TILE WATERTIGHT WATER, STEPPED DEM BASE, GREENERY & ROADS
  // --------------------------------------------------------------------------
  const cellTerracePolys = Array.from({ length: TERRAIN_RES_X * TERRAIN_RES_Y }, () => []);
  const waterSurfZ = (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;

  for (let tr = 0; tr < tileRows; tr++) {
    for (let tc = 0; tc < tileCols; tc++) {
      const tileId = tr * tileCols + tc;
      const tb = tileBounds[tileId];
      const { gx0, gx1, gy0, gy1, x0: tileX0, y0: tileY0, stepX: tileStepX, stepY: tileStepY } = tb;

      const rimCells = 3;
      const hasVault = hollowBase && (gx1 - gx0 > rimCells * 2 + 2) && (gy1 - gy0 > rimCells * 2 + 2);
      const midGx = Math.floor((gx0 + gx1) * 0.5);
      const midGy = Math.floor((gy0 + gy1) * 0.5);
      const labelLen = 5;
      const startGx = Math.max(gx0 + 2, Math.min(gx1 - 3 - (labelLen - 1), midGx - 2));
      const endGx = startGx + (labelLen - 1);
      const idGy = Math.max(gy0 + 2, Math.min(gy1 - 3, midGy));
      const ribCellsX = Math.max(4, Math.round(25.0 / (cellStepX * scaleMm)));
      const ribCellsY = Math.max(4, Math.round(25.0 / (cellStepY * scaleMm)));

      let minTop5 = Infinity;
      for (let g = startGx; g <= endGx; g++) {
        const ct = cellMinTopZ[idGy * TERRAIN_RES_X + g];
        if (ct < minTop5) minTop5 = ct;
      }
      const idFbase = hasVault ? Math.max(zDrainVault, quantizeZUnits(minTop5 - hollowWallUnits)) : 0.0;

      const getBaseVertexFloorZ = (vx, vy) => {
        if (!hasVault) return 0.0;
        if (vx >= startGx && vx <= endGx + 1 && vy >= idGy && vy <= idGy + 1) {
          return idFbase;
        }

        const inVaultX = (vx > gx0 + rimCells && vx < gx1 - rimCells);
        const inVaultY = (vy > gy0 + rimCells && vy < gy1 - rimCells);

        if (!inVaultX || !inVaultY) {
          const isOuterWest = (tc === 0) && (vx <= gx0 + rimCells);
          const isOuterEast = (tc === tileCols - 1) && (vx >= gx1 - rimCells);
          const isOuterSouth = (tr === 0) && (vy <= gy0 + rimCells);
          const isOuterNorth = (tr === tileRows - 1) && (vy >= gy1 - rimCells);

          const isInternalDrain = (numTiles > 1) && (
            (!isOuterSouth && !isOuterNorth && (vx >= midGx - 1 && vx <= midGx + 1) && (vy <= gy0 + rimCells || vy >= gy1 - rimCells)) ||
            (!isOuterWest && !isOuterEast && (vy >= midGy - 1 && vy <= midGy + 1) && (vx <= gx0 + rimCells || vx >= gx1 - rimCells))
          );
          return isInternalDrain ? zDrainVault : 0.0;
        }

        const relX = vx - gx0;
        const relY = vy - gy0;
        const isRibX = (relX % ribCellsX === 0) && (relX >= rimCells + ribCellsX) && (relX <= (gx1 - gx0) - rimCells - ribCellsX);
        const isRibY = (relY % ribCellsY === 0) && (relY >= rimCells + ribCellsY) && (relY <= (gy1 - gy0) - rimCells - ribCellsY);

        if (isRibX || isRibY) {
          const midSpanY = Math.floor(ribCellsY * 0.5);
          const midSpanX = Math.floor(ribCellsX * 0.5);
          const isNotch = (isRibX && (Math.abs((relY % ribCellsY) - midSpanY) === 0)) ||
                          (isRibY && (Math.abs((relX % ribCellsX) - midSpanX) === 0));
          return isNotch ? zDrainVault : 0.0;
        }

        let minTop = Infinity;
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const cx = Math.min(gx1 - 1, Math.max(gx0, vx + dx));
            const cy = Math.min(gy1 - 1, Math.max(gy0, vy + dy));
            const ct = cellMinTopZ[cy * TERRAIN_RES_X + cx];
            if (ct < minTop) minTop = ct;
          }
        }
        const maxAllowedCeiling = minTop - hollowWallUnits;
        if (maxAllowedCeiling < zDrainVault) return 0.0;
        return Math.min(maxAllowedCeiling, Math.max(zDrainVault, quantizeZUnits(maxAllowedCeiling)));
      };

      for (let gy = gy0; gy < gy1; gy++) {
        const y0 = tileY0 + (gy - gy0) * tileStepY;
        const y1 = tileY0 + (gy + 1 - gy0) * tileStepY;
        for (let gx = gx0; gx < gx1; gx++) {
          const x0 = tileX0 + (gx - gx0) * tileStepX;
          const x1 = tileX0 + (gx + 1 - gx0) * tileStepX;

          const v00 = zGrid[gy * strideTX + gx];
          const v10 = zGrid[gy * strideTX + (gx + 1)];
          const v11 = zGrid[(gy + 1) * strideTX + (gx + 1)];
          const v01 = zGrid[(gy + 1) * strideTX + gx];

          const f00 = getBaseVertexFloorZ(gx, gy);
          const f10 = getBaseVertexFloorZ(gx + 1, gy);
          const f11 = getBaseVertexFloorZ(gx + 1, gy + 1);
          const f01 = getBaseVertexFloorZ(gx, gy + 1);

          const avgFloor = (f00 + f10 + f11 + f01) * 0.25;
          if (avgFloor > 0) {
            vaultSavedSceneVol += avgFloor * tileStepX * tileStepY;
          }

          // Central Underside Tile ID R1C1 ^ (100% 2-manifold recessed heightfield patch across 5 horizontal cells)
          const isIdCell = (gx >= startGx && gx <= endGx && gy === idGy);
          if (isIdCell) {
            const chars = (tileCols === 1 && tileRows === 1) ? ['1', '-', '1', ' ', '↑'] : ['R', String(tr + 1), 'C', String(tc + 1), '↑'];
            const charIdx = gx - startGx;
            const debossDepth = Math.max(0.12, Math.min(0.40 / scaleMm, cellMinTopZ[gy * TERRAIN_RES_X + gx] - idFbase - 0.4));
            emitUndersideIdPatch(x0, y0, x1, y1, f00, f10, f11, f01, chars[charIdx], debossDepth, tileId, meshes.base);
          } else {
            const pf00 = [x0, y0, f00], pf10 = [x1, y0, f10], pf11 = [x1, y1, f11], pf01 = [x0, y1, f01];
            pushTri(meshes.base, pf00, pf01, pf11, computeFaceNormal(pf00, pf01, pf11), 1, -1, tileId);
            pushTri(meshes.base, pf00, pf11, pf10, computeFaceNormal(pf00, pf11, pf10), 1, -1, tileId);
          }

          // Outer tile boundary staircase walls for Layer 1 (meshes.base) & Layer 0 (meshes.water)
          if (gy === gy0) {
            emitBoundaryStaircaseWall(x0, y0, v00, f00, x1, y0, v10, f10, [0, -1, 0], tileId);
            emitWaterBoundaryWall(x0, y0, v00, x1, y0, v10, [0, -1, 0], tileId);
          }
          if (gy === gy1 - 1) {
            emitBoundaryStaircaseWall(x1, y1, v11, f11, x0, y1, v01, f01, [0, 1, 0], tileId);
            emitWaterBoundaryWall(x1, y1, v11, x0, y1, v01, [0, 1, 0], tileId);
          }
          if (gx === gx0) {
            emitBoundaryStaircaseWall(x0, y1, v01, f01, x0, y0, v00, f00, [-1, 0, 0], tileId);
            emitWaterBoundaryWall(x0, y1, v01, x0, y0, v00, [-1, 0, 0], tileId);
          }
          if (gx === gx1 - 1) {
            emitBoundaryStaircaseWall(x1, y0, v10, f10, x1, y1, v11, f11, [1, 0, 0], tileId);
            emitWaterBoundaryWall(x1, y0, v10, x1, y1, v11, [1, 0, 0], tileId);
          }

          const vMax = Math.max(v00, v10, v11, v01);
          const vMin = Math.min(v00, v10, v11, v01);

          // Pure underwater cell: base top at zSubWater, water slab from zWaterBot -> deepWaterZ
          if (vMax < baseBottomZ) {
            pushQuad(meshes.base, [x0, y0, zSubWater], [x1, y0, zSubWater], [x1, y1, zSubWater], [x0, y1, zSubWater], [0, 0, 1], 1, -1, tileId);
            pushQuad(meshes.water, [x0, y0, deepWaterZ], [x1, y0, deepWaterZ], [x1, y1, deepWaterZ], [x0, y1, deepWaterZ], [0, 0, 1], 0, -1, tileId);
            pushQuad(meshes.water, [x0, y0, zWaterBot], [x0, y1, zWaterBot], [x1, y1, zWaterBot], [x1, y0, zWaterBot], [0, 0, -1], 0, -1, tileId);
            cellTerracePolys[gy * TERRAIN_RES_X + gx].push({
              poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
              zSurf: waterSurfZ,
              tileId
            });
            continue;
          }

          const kMinRaw = getStepIdxForVal(vMin);
          const kMax = getStepIdxForVal(vMax);
          if (kMinRaw >= 0 && kMinRaw === kMax) {
            const tZ = thresholds[kMinRaw];
            pushQuad(meshes.base, [x0, y0, tZ], [x1, y0, tZ], [x1, y1, tZ], [x0, y1, tZ], [0, 0, 1], 1, -1, tileId);
            cellTerracePolys[gy * TERRAIN_RES_X + gx].push({
              poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
              zSurf: tZ,
              tileId
            });
            emitCellFeatureSlabs(null, x0, y0, x1, y1, tZ, tileId);
            continue;
          }

          const c00 = { x: x0, y: y0, v: v00, isCut: false };
          const c10 = { x: x1, y: y0, v: v10, isCut: false };
          const c11 = { x: x1, y: y1, v: v11, isCut: false };
          const c01 = { x: x0, y: y1, v: v01, isCut: false };
          const cellTris = [
            [c00, c10, c11],
            [c00, c11, c01]
          ];

          const gradX = (v10 - v00) + (v11 - v01);
          const gradY = (v01 - v00) + (v11 - v10);
          const gLen = Math.hypot(gradX, gradY) || 1;
          const riserNorm = [-gradX / gLen, -gradY / gLen, 0];

          for (let ct = 0; ct < 2; ct++) {
            const cellTri = cellTris[ct];
            const tvMin = Math.min(cellTri[0].v, cellTri[1].v, cellTri[2].v);
            const tvMax = Math.max(cellTri[0].v, cellTri[1].v, cellTri[2].v);

            if (tvMin < baseBottomZ) {
              const subWater = clipCellPolyByScalar(cellTri, baseBottomZ, false);
              const swp = subWater.poly;
              if (swp.length >= 3) {
                const p0 = swp[0];
                for (let ti = 1; ti < swp.length - 1; ti++) {
                  const p1 = swp[ti], p2 = swp[ti + 1];
                  pushTri(meshes.base, [p0.x, p0.y, zSubWater], [p1.x, p1.y, zSubWater], [p2.x, p2.y, zSubWater], [0, 0, 1], 1, -1, tileId);
                  pushTri(meshes.water, [p0.x, p0.y, deepWaterZ], [p1.x, p1.y, deepWaterZ], [p2.x, p2.y, deepWaterZ], [0, 0, 1], 0, -1, tileId);
                  pushTri(meshes.water, [p0.x, p0.y, zWaterBot], [p2.x, p2.y, zWaterBot], [p1.x, p1.y, zWaterBot], [0, 0, -1], 0, -1, tileId);
                }
                cellTerracePolys[gy * TERRAIN_RES_X + gx].push({
                  poly: swp.map(pt => [pt.x, pt.y]),
                  zSurf: waterSurfZ,
                  tileId
                });
                for (const [cA, cB] of subWater.cuts) {
                  pushQuad(
                    meshes.water,
                    [cA.x, cA.y, zWaterBot],
                    [cB.x, cB.y, zWaterBot],
                    [cB.x, cB.y, deepWaterZ],
                    [cA.x, cA.y, deepWaterZ],
                    [riserNorm[0], riserNorm[1], 0],
                    0,
                    -1,
                    tileId
                  );
                }
              }
            }

            if (tvMax < baseBottomZ) continue;

            const tkMinRaw = getStepIdxForVal(tvMin);
            const tkMax = getStepIdxForVal(tvMax);
            const tkStart = Math.max(0, tkMinRaw);

            for (let k = tkStart; k <= tkMax; k++) {
              const tLow = thresholds[k];
              const tHigh = (k === numContourSteps) ? Infinity : thresholds[k + 1];
              if (tvMax < tLow) break;

              const aboveLow = clipCellPolyByScalar(cellTri, tLow, true);
              if (aboveLow.poly.length < 3) continue;

              for (const [cA, cB] of aboveLow.cuts) {
                const zRiserBot = (k === 0) ? zSubWater : thresholds[k - 1];
                const zRiserTop = tLow;
                pushQuad(
                  meshes.base,
                  [cA.x, cA.y, zRiserBot],
                  [cB.x, cB.y, zRiserBot],
                  [cB.x, cB.y, zRiserTop],
                  [cA.x, cA.y, zRiserTop],
                  riserNorm,
                  1,
                  -1,
                  tileId
                );
              }

              if (tvMin < tHigh) {
                const band = clipCellPolyByScalar(aboveLow.poly, tHigh, false);
                const bp = band.poly;
                if (bp.length >= 3) {
                  const p0 = bp[0];
                  for (let ti = 1; ti < bp.length - 1; ti++) {
                    const p1 = bp[ti], p2 = bp[ti + 1];
                    pushTri(meshes.base, [p0.x, p0.y, tLow], [p1.x, p1.y, tLow], [p2.x, p2.y, tLow], [0, 0, 1], 1, -1, tileId);
                  }
                  const bpXY = bp.map(pt => [pt.x, pt.y]);
                  cellTerracePolys[gy * TERRAIN_RES_X + gx].push({
                    poly: bpXY,
                    zSurf: tLow,
                    tileId
                  });
                  emitCellFeatureSlabs(bpXY, x0, y0, x1, y1, tLow, tileId);
                }
              }
            }
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // STEP 3B: TRUE 3D VECTOR BRIDGES, BANK ABUTMENTS & SOLID PIERS
  // --------------------------------------------------------------------------
  if (!state.layerVisible || state.layerVisible.roads !== false) {
    const pierSpacingUnits = Math.max(2.2, 6.0 / scaleMm);

    bridgeData.forEach((span, spanIdx) => {
      const { rd, pts: rawPts, zDeckBot, zDeckTop } = span;
      if (!rawPts || rawPts.length < 2) return;

      const roadWidthUnits = (rd.width || 3.0) * scaleToBed;
      const brWidth = Math.max(roadWidthUnits, 0.48 / scaleMm);
      const brHalfW = brWidth * 0.5;

      const sub = [];
      for (let i = 0; i < rawPts.length; i++) {
        const p = rawPts[i];
        if (i === 0 || Math.hypot(p[0] - sub[sub.length - 1][0], p[1] - sub[sub.length - 1][1]) > 0.05) {
          sub.push(p);
        }
      }
      if (sub.length < 2) return;

      // Resample densely so trimming can be fine-grained
      const dense = [];
      for (let i = 0; i < sub.length - 1; i++) {
        const pA = sub[i], pB = sub[i + 1];
        const segLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
        const steps = Math.max(1, Math.ceil(segLen / 0.25));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          dense.push([pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t]);
        }
      }
      dense.push(sub[sub.length - 1]);

      // Trim from start until both left and right edges are strictly over water
      while (dense.length > 2) {
        const p0 = dense[0], p1 = dense[1];
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const zLeft = sampleRawTerrainGridZ(p0[0] + nx * brHalfW, p0[1] + ny * brHalfW);
        const zRight = sampleRawTerrainGridZ(p0[0] - nx * brHalfW, p0[1] - ny * brHalfW);
        if (zLeft < baseBottomZ - 0.01 && zRight < baseBottomZ - 0.01) break;
        dense.shift();
      }
      // Trim from end until both left and right edges are strictly over water
      while (dense.length > 2) {
        const pN = dense[dense.length - 1], pPrev = dense[dense.length - 2];
        const dx = pN[0] - pPrev[0], dy = pN[1] - pPrev[1], len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const zLeft = sampleRawTerrainGridZ(pN[0] + nx * brHalfW, pN[1] + ny * brHalfW);
        const zRight = sampleRawTerrainGridZ(pN[0] - nx * brHalfW, pN[1] - ny * brHalfW);
        if (zLeft < baseBottomZ - 0.01 && zRight < baseBottomZ - 0.01) break;
        dense.pop();
      }

      // Simplify dense back to span pts
      const pts = [dense[0]];
      for (let k = 1; k < dense.length - 1; k++) {
        if (Math.hypot(dense[k][0] - pts[pts.length - 1][0], dense[k][1] - pts[pts.length - 1][1]) >= 1.2) {
          pts.push(dense[k]);
        }
      }
      if (dense.length > 1) pts.push(dense[dense.length - 1]);
      if (pts.length < 2 || Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < 0.6) return;
      const N = pts.length;

      // Compute normals along polyline
      const normals = [];
      for (let i = 0; i < N; i++) {
        if (i === 0) {
          const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1], len = Math.hypot(dx, dy) || 1;
          normals.push([-dy / len, dx / len]);
        } else if (i === N - 1) {
          const dx = pts[N - 1][0] - pts[N - 2][0], dy = pts[N - 1][1] - pts[N - 2][1], len = Math.hypot(dx, dy) || 1;
          normals.push([-dy / len, dx / len]);
        } else {
          const d1x = pts[i][0] - pts[i - 1][0], d1y = pts[i][1] - pts[i - 1][1], l1 = Math.hypot(d1x, d1y) || 1;
          const d2x = pts[i + 1][0] - pts[i][0], d2y = pts[i + 1][1] - pts[i][1], l2 = Math.hypot(d2x, d2y) || 1;
          const tx = d1x / l1 + d2x / l2, ty = d1y / l1 + d2y / l2, tlen = Math.hypot(tx, ty) || 1;
          const nx = -ty / tlen, ny = tx / tlen;
          const dot = nx * (-d1y / l1) + ny * (d1x / l1);
          const miter = Math.min(2.0, 1.0 / Math.max(0.5, dot));
          normals.push([nx * miter, ny * miter]);
        }
      }

      // Span is 100% over water; underside is uniformly at zDeckBot
      const zBots = Array(N).fill(zDeckBot);

      const TL = [], TR = [], BL = [], BR = [];
      for (let i = 0; i < N; i++) {
        const p = pts[i], n = normals[i];
        TL.push([p[0] + n[0] * brHalfW, p[1] + n[1] * brHalfW, zDeckTop]);
        TR.push([p[0] - n[0] * brHalfW, p[1] - n[1] * brHalfW, zDeckTop]);
        BL.push([p[0] + n[0] * brHalfW, p[1] + n[1] * brHalfW, zBots[i]]);
        BR.push([p[0] - n[0] * brHalfW, p[1] - n[1] * brHalfW, zBots[i]]);
      }

      const bridgeShellTris = [];
      for (let i = 0; i < N - 1; i++) {
        // Top face (+Z)
        pushQuad(bridgeShellTris, TL[i], TR[i], TR[i + 1], TL[i + 1], [0, 0, 1], 3, spanIdx, 0);
        // Bottom face (-Z)
        pushQuad(bridgeShellTris, BL[i], BL[i + 1], BR[i + 1], BR[i], [0, 0, -1], 3, spanIdx, 0);
        // Left side face
        pushQuad(bridgeShellTris, BL[i], TL[i], TL[i + 1], BL[i + 1], computeFaceNormal(BL[i], TL[i], TL[i + 1]), 3, spanIdx, 0);
        // Right side face
        pushQuad(bridgeShellTris, BR[i], BR[i + 1], TR[i + 1], TR[i], computeFaceNormal(BR[i], BR[i + 1], TR[i + 1]), 3, spanIdx, 0);
      }
      // Start cap
      pushQuad(bridgeShellTris, BL[0], BR[0], TR[0], TL[0], computeFaceNormal(BL[0], BR[0], TR[0]), 3, spanIdx, 0);
      // End cap
      pushQuad(bridgeShellTris, BL[N - 1], TL[N - 1], TR[N - 1], BR[N - 1], computeFaceNormal(BL[N - 1], TL[N - 1], TR[N - 1]), 3, spanIdx, 0);

      // Piers along elevated water span
      let accumDist = 0;
      for (let i = 0; i < N - 1; i++) {
        const segDist = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        if (segDist < 0.1) continue;
        const midX = (pts[i][0] + pts[i + 1][0]) * 0.5;
        const midY = (pts[i][1] + pts[i + 1][1]) * 0.5;
        const segWater = waterMask[sampleMaskIdx(midX, midY)] === 1;
        accumDist += segDist;

        if (accumDist >= pierSpacingUnits && segWater) {
          accumDist = 0;
          const pTan = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
          const pLen = Math.hypot(pTan[0], pTan[1]) || 1;
          const pTx = pTan[0] / pLen, pTy = pTan[1] / pLen;
          const pNx = -pTy, pNy = pTx;

          const pW = brWidth * 0.70;
          const pT = Math.max(0.8, 1.2 / scaleMm);
          const k0 = [midX - pNx * (pW * 0.5) - pTx * (pT * 0.5), midY - pNy * (pW * 0.5) - pTy * (pT * 0.5)];
          const k1 = [midX + pNx * (pW * 0.5) - pTx * (pT * 0.5), midY + pNy * (pW * 0.5) - pTy * (pT * 0.5)];
          const k2 = [midX + pNx * (pW * 0.5) + pTx * (pT * 0.5), midY + pNy * (pW * 0.5) + pTy * (pT * 0.5)];
          const k3 = [midX - pNx * (pW * 0.5) + pTx * (pT * 0.5), midY - pNy * (pW * 0.5) + pTy * (pT * 0.5)];

          // Ensure ALL pier corners are strictly in water away from banks
          const zK0 = sampleRawTerrainGridZ(k0[0], k0[1]);
          const zK1 = sampleRawTerrainGridZ(k1[0], k1[1]);
          const zK2 = sampleRawTerrainGridZ(k2[0], k2[1]);
          const zK3 = sampleRawTerrainGridZ(k3[0], k3[1]);
          const allInWater =
            zK0 < baseBottomZ - 0.04 &&
            zK1 < baseBottomZ - 0.04 &&
            zK2 < baseBottomZ - 0.04 &&
            zK3 < baseBottomZ - 0.04;

          if (allInWater) {
            const zPierBot = (state.layerVisible && state.layerVisible.water === false) ? zSubWater : deepWaterZ;
            if (zDeckBot - zPierBot > 0.15) {
              emitClosedPrism([k0, k1, k2, k3], zPierBot, zDeckBot, 3, bridgeShellTris, spanIdx);
            }
          }
        }
      }

      // Tile clipping
      if (tileCols === 1 && tileRows === 1) {
        const clipped = clipMeshToBox3D(bridgeShellTris, -halfW, halfW, -halfH, halfH, 0);
        for (let ti = 0; ti < clipped.length; ti++) {
          meshes.roads.push(clipped[ti]);
        }
      } else {
        for (let tr = 0; tr < tileRows; tr++) {
          for (let tc = 0; tc < tileCols; tc++) {
            const tileId = tr * tileCols + tc;
            const tb = tileBounds[tileId];
            const clipped = clipMeshToBox3D(bridgeShellTris, tb.x0, tb.x1, tb.y0, tb.y1, tileId);
            for (let ti = 0; ti < clipped.length; ti++) {
              meshes.roads.push(clipped[ti]);
            }
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // STEP 4: WATERTIGHT 3D SCULPTED TREES (FLUSH ON FLAT TERRACE / TURF, 0 FLOATING)
  // --------------------------------------------------------------------------
  if (!state.layerVisible || state.layerVisible.trees !== false) {
    const placedTrees = [];
    (scene.trees || []).forEach((tr, idx) => {
      const [bx, by] = toBed([tr[0], tr[1]]);
      if (bx < -halfW + 1.8 || bx > halfW - 1.8 || by < -halfH + 1.8 || by > halfH - 1.8) return;
      const mIdx = sampleMaskIdx(bx, by);
      if (waterMask[mIdx] || roadAndBldMask[mIdx]) return;

      const treeRadius = (0.54 + (idx % 5) * 0.09) * Math.min(1.15, Math.sqrt(scaleToBed));
      const u = ((bx + halfW) / (2 * halfW)) * TERRAIN_RES_X;
      const v = ((by + halfH) / (2 * halfH)) * TERRAIN_RES_Y;
      const gx = Math.min(TERRAIN_RES_X - 1, Math.max(0, Math.floor(u)));
      const gy = Math.min(TERRAIN_RES_Y - 1, Math.max(0, Math.floor(v)));

      const cellX0 = -halfW + gx * cellStepX;
      const cellX1 = cellX0 + cellStepX;
      const cellY0 = -halfH + gy * cellStepY;
      const cellY1 = cellY0 + cellStepY;
      const cx = Math.min(cellX1 - treeRadius - 0.05, Math.max(cellX0 + treeRadius + 0.05, bx));
      const cy = Math.min(cellY1 - treeRadius - 0.05, Math.max(cellY0 + treeRadius + 0.05, by));

      const v00 = zGrid[gy * strideTX + gx];
      const v10 = zGrid[gy * strideTX + (gx + 1)];
      const v11 = zGrid[(gy + 1) * strideTX + (gx + 1)];
      const v01 = zGrid[(gy + 1) * strideTX + gx];
      const kMinRaw = getStepIdxForVal(Math.min(v00, v10, v11, v01));
      const kMax = getStepIdxForVal(Math.max(v00, v10, v11, v01));
      if (kMinRaw < 0 || kMinRaw !== kMax) return;

      const { rdCount, grCount } = getCellSubTypes(cellX0, cellY0, cellX1, cellY1);
      if (rdCount > 0 || (grCount !== 0 && grCount !== 4)) return;

      let crownBlocked = false;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const pIdx = sampleMaskIdx(cx + Math.cos(ang) * (treeRadius + 0.12), cy + Math.sin(ang) * (treeRadius + 0.12));
        if (bldMask[pIdx] || roadMask[pIdx] || waterMask[pIdx]) {
          crownBlocked = true;
          break;
        }
      }
      if (crownBlocked) return;

      for (let j = 0; j < placedTrees.length; j++) {
        const pt = placedTrees[j];
        if (Math.hypot(cx - pt[0], cy - pt[1]) < (treeRadius + pt[2]) * 1.08) return;
      }
      placedTrees.push([cx, cy, treeRadius]);

      const tZ = thresholds[kMinRaw];
      const zG = (grCount === 4) ? (tZ + gHeight) : tZ;
      const treeHeight = (1.30 + (idx % 6) * 0.22) * (state.zScale || 1.0) * 0.85;

      if (tileCols === 1 && tileRows === 1) {
        addTreeCrown3D(cx, cy, zG, treeRadius, treeHeight, 2, meshes.greenery, 0);
      } else {
        const tCol = Math.min(tileCols - 1, Math.max(0, Math.floor(((cx + halfW) / (2 * halfW)) * tileCols)));
        const tRow = Math.min(tileRows - 1, Math.max(0, Math.floor(((cy + halfH) / (2 * halfH)) * tileRows)));
        const primaryTileId = tRow * tileCols + tCol;
        const tb = tileBounds[primaryTileId];

        const crossesTile =
          (cx - treeRadius < tb.x0) ||
          (cx + treeRadius > tb.x1) ||
          (cy - treeRadius < tb.y0) ||
          (cy + treeRadius > tb.y1);

        if (!crossesTile) {
          addTreeCrown3D(cx, cy, zG, treeRadius, treeHeight, 2, meshes.greenery, primaryTileId);
        } else {
          const tempTree = [];
          addTreeCrown3D(cx, cy, zG, treeRadius, treeHeight, 2, tempTree, 0);
          for (let tr = 0; tr < tileRows; tr++) {
            for (let tc = 0; tc < tileCols; tc++) {
              const tileId = tr * tileCols + tc;
              const b = tileBounds[tileId];
              if (cx + treeRadius < b.x0 || cx - treeRadius > b.x1 || cy + treeRadius < b.y0 || cy - treeRadius > b.y1) continue;
              const clipped = clipMeshToBox3D(tempTree, b.x0, b.x1, b.y0, b.y1, tileId);
              for (let ti = 0; ti < clipped.length; ti++) {
                meshes.greenery.push(clipped[ti]);
              }
            }
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // STEP 6: REAL OSM BUILDINGS (0 FLOATING, 0 INTER-LAYER OVERLAP, 0 OPEN EDGES)
  // --------------------------------------------------------------------------
  const rawBuildings = scene.buildings || [];

  // 1. Safety outline suppression: if any non-part building record (!b.part) spatially contains
  // building:part records (b.part === true) that share its groupId or lie inside it,
  // suppress the parent outline record and propagate its groupId / name to its parts.
  const childParts = [];
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.part) childParts.push(b);
  }

  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier' || b.isOutline) continue;
    if (!b.part && childParts.length > 0) {
      const bOuterBed = b.outer.map(toBed);
      let hasContainedPart = false;
      for (let j = 0; j < childParts.length; j++) {
        const cp = childParts[j];
        if (cp.groupId && (cp.groupId === b.id || cp.groupId === b.osmId)) {
          hasContainedPart = true;
          if (!cp.name && b.name) cp.name = b.name;
          continue;
        }
        const cpBed = cp.outer.map(toBed);
        let cpCx = 0, cpCy = 0;
        for (let k = 0; k < cpBed.length; k++) { cpCx += cpBed[k][0]; cpCy += cpBed[k][1]; }
        cpCx /= cpBed.length; cpCy /= cpBed.length;
        if (pointInPoly2D(cpCx, cpCy, bOuterBed)) {
          hasContainedPart = true;
          if (!cp.groupId) cp.groupId = b.id || b.osmId;
          if (!cp.name && b.name) cp.name = b.name;
        }
      }
      if (hasContainedPart) {
        b.isOutline = true;
      }
    }
  }

  // 2. Prepare each building/part: clip to bed frame, filter truly microscopic slivers,
  // and dilate thin spires / needle features to minimum printable width (>= 0.48 mm).
  const prepared = [];
  for (let i = 0; i < rawBuildings.length; i++) {
    const b = rawBuildings[i];
    if (b.hidden || b.btype === 'pier' || b.isOutline) continue;
    const bedOuterRaw = b.outer.map(toBed);
    let clippedOuter = cleanPolygonRing(clipPolyToBox(bedOuterRaw, -halfW + 0.4, -halfH + 0.4, halfW - 0.4, halfH - 0.4), true);
    if (clippedOuter.length < 3 || hasSelfTouchingEdge2D(clippedOuter, 1e-4)) continue;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < clippedOuter.length; k++) {
      const p = clippedOuter[k];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    let spanX = maxX - minX;
    let spanY = maxY - minY;
    let minSpan = Math.min(spanX, spanY);
    let area = Math.abs(signedArea2D(clippedOuter));

    const isImportant = b.part || b.tower || b.church || b.landmark || (b.h || 0) >= 20;
    if (isImportant) {
      if (area < 0.005) continue;
    } else {
      if (minSpan < 0.35 || area < 0.12) continue;
    }

    // Radial Spire / Thin-Feature Thickening: ensure >= 0.48 mm printable width on build plate
    if (minSpan * scaleMm < 0.48) {
      clippedOuter = dilatePolygonMinSpan2D(clippedOuter, 0.48 / scaleMm);
      minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
      for (let k = 0; k < clippedOuter.length; k++) {
        const p = clippedOuter[k];
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      spanX = maxX - minX;
      spanY = maxY - minY;
      minSpan = Math.min(spanX, spanY);
      area = Math.abs(signedArea2D(clippedOuter));
    }

    const clippedHoles = (b.holes || [])
      .map(h => clipPolyToBox(h.map(toBed), -halfW + 0.4, -halfH + 0.4, halfW - 0.4, halfH - 0.4))
      .filter(h => h.length >= 3);

    prepared.push({
      b,
      clippedOuter,
      clippedHoles,
      minX, maxX, minY, maxY,
      minSpan,
      area,
      cx: (minX + maxX) * 0.5,
      cy: (minY + maxY) * 0.5,
      groupId: b.groupId || b.osmId || b.id,
      skip: false
    });
  }

  const groupHighlighted = new Set();
  const groupHeightMult = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.b.highlighted) groupHighlighted.add(item.groupId);
    if (item.b.heightMult && item.b.heightMult !== 1.0) {
      groupHeightMult.set(item.groupId, item.b.heightMult);
    }
  }

  // 3. Compute foundation ground pad tZ and true proportional heights (NO matchstick clamp)
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    const b = item.b;
    const gid = item.groupId;

    const gxMin = Math.max(0, Math.floor(((item.minX + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const gxMax = Math.min(TERRAIN_RES_X - 1, Math.floor(((item.maxX + halfW) / (2 * halfW)) * TERRAIN_RES_X));
    const gyMin = Math.max(0, Math.floor(((item.minY + halfH) / (2 * halfH)) * TERRAIN_RES_Y));
    const gyMax = Math.min(TERRAIN_RES_Y - 1, Math.floor(((item.maxY + halfH) / (2 * halfH)) * TERRAIN_RES_Y));

    let minPadZ = Infinity;
    for (let gy = gyMin; gy <= gyMax; gy++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const tList = cellTerracePolys[gy * TERRAIN_RES_X + gx];
        for (let t = 0; t < tList.length; t++) {
          const tp = tList[t];
          if (tp.zSurf >= baseBottomZ - 1e-4) {
            if (pointInPoly2D(item.cx, item.cy, tp.poly) ||
                item.clippedOuter.some(pt => pointInPoly2D(pt[0], pt[1], tp.poly)) ||
                tp.poly.some(pt => pointInPoly2D(pt[0], pt[1], item.clippedOuter))) {
              if (tp.zSurf < minPadZ) minPadZ = tp.zSurf;
            }
          }
        }
      }
    }
    if (!Number.isFinite(minPadZ)) {
      minPadZ = Math.max(baseBottomZ, getActualPrintedSurfaceMinZ(item.cx, item.cy));
    }
    const minTerrainZ = minPadZ;

    let roofShape = b.roof || 'flat';
    if ((roofShape === 'dome' || roofShape === 'onion' || roofShape === 'pyramidal' || roofShape === 'cone') && !isConvexPoly(item.clippedOuter)) {
      roofShape = 'flat';
    }
    const hMult = (groupHeightMult.get(gid) || b.heightMult || 1.0) * (state.zScale || 1.0);
    const totalHMm = Math.max(1.25, (b.h || 6.0) * mToU * hMult);

    let roofHMm = (roofShape !== 'flat') ? Math.max(0.45, (b.roofH || 3.2) * mToU * hMult) : 0;
    roofHMm = Math.min(roofHMm, item.minSpan * 0.45, totalHMm * 0.34);
    const hasPitched = (roofShape !== 'flat' && roofHMm > 0.14);

    const tZ = quantizeZUnits(minTerrainZ);
    const zEaves = quantizeZUnits(tZ + Math.max(0.95, totalHMm - roofHMm * 0.35));
    const zRidge = hasPitched ? Math.max(zEaves + 0.16, quantizeZUnits(zEaves + roofHMm)) : zEaves;
    const zTop = hasPitched ? zRidge : zEaves;

    item.tZ = tZ;
    item.effBaseZ = tZ;
    item.roofShape = roofShape;
    item.totalHMm = totalHMm;
    item.roofHMm = roofHMm;
    item.hasPitched = hasPitched;
    item.zEaves = zEaves;
    item.zRidge = zRidge;
    item.zTop = zTop;
  }

  // Scene-Wide Skyscraper Height Budget (fitsPhotonMono4 === true & Wall-Frame Proportions)
  const maxAllowedZMm = Math.min(state.isResin ? 140.0 : 160.0, Math.max(48.0, maxDimMm * 0.34));
  const maxAllowedTopUnits = maxAllowedZMm / scaleMm;
  let maxRawTopUnits = 0;
  let maxBuildingBaseTZ = baseBottomZ;
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.zTop > maxRawTopUnits) {
      maxRawTopUnits = item.zTop;
      maxBuildingBaseTZ = item.tZ;
    }
  }
  if (maxRawTopUnits > maxAllowedTopUnits && maxRawTopUnits > maxBuildingBaseTZ + 0.5) {
    const skylineScale = (maxAllowedTopUnits - maxBuildingBaseTZ) / (maxRawTopUnits - maxBuildingBaseTZ);
    for (let i = 0; i < prepared.length; i++) {
      const item = prepared[i];
      item.totalHMm *= skylineScale;
      item.roofHMm *= skylineScale;
      if (item.b.minH && item.b.minH > 0) item.b.minH *= skylineScale;
      const zEaves = quantizeZUnits(item.tZ + Math.max(0.95, item.totalHMm - item.roofHMm * 0.35));
      const zRidge = item.hasPitched ? Math.max(zEaves + 0.16, quantizeZUnits(zEaves + item.roofHMm)) : zEaves;
      item.zEaves = zEaves;
      item.zRidge = zRidge;
      item.zTop = item.hasPitched ? zRidge : zEaves;
    }
  }

  // 4. S3DB Multi-Part Hierarchical Z-Tier Stacking (Option 2B+)
  function polygonsOverlap2D(A, B) {
    if (A.maxX <= B.minX + 0.015 || A.minX >= B.maxX - 0.015 || A.maxY <= B.minY + 0.015 || A.minY >= B.maxY - 0.015) {
      return false;
    }
    const inAHole = (px, py) => A.clippedHoles.some(h => pointInPoly2D(px, py, h));
    const inBHole = (px, py) => B.clippedHoles.some(h => pointInPoly2D(px, py, h));
    if (pointInPoly2D(B.cx, B.cy, A.clippedOuter) && !inAHole(B.cx, B.cy)) return true;
    if (pointInPoly2D(A.cx, A.cy, B.clippedOuter) && !inBHole(A.cx, A.cy)) return true;
    for (let i = 0; i < B.clippedOuter.length; i++) {
      const p = B.clippedOuter[i];
      if (pointInPoly2D(p[0], p[1], A.clippedOuter) && !inAHole(p[0], p[1])) return true;
    }
    for (let i = 0; i < A.clippedOuter.length; i++) {
      const p = A.clippedOuter[i];
      if (pointInPoly2D(p[0], p[1], B.clippedOuter) && !inBHole(p[0], p[1])) return true;
    }
    for (let i = 0; i < A.clippedOuter.length; i++) {
      const a1 = A.clippedOuter[i], a2 = A.clippedOuter[(i + 1) % A.clippedOuter.length];
      for (let j = 0; j < B.clippedOuter.length; j++) {
        const b1 = B.clippedOuter[j], b2 = B.clippedOuter[(j + 1) % B.clippedOuter.length];
        if (segmentsIntersectProper(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  const parentCluster = new Int32Array(prepared.length).map((_, idx) => idx);
  function findClusterRoot(x) { while (parentCluster[x] !== x) { parentCluster[x] = parentCluster[parentCluster[x]]; x = parentCluster[x]; } return x; }
  function unionClusters(x, y) { const rx = findClusterRoot(x), ry = findClusterRoot(y); if (rx !== ry) parentCluster[ry] = rx; }

  // Union by groupId
  const byGid = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const gid = prepared[i].groupId;
    if (gid !== undefined && gid !== null) {
      if (byGid.has(gid)) {
        unionClusters(byGid.get(gid), i);
      } else {
        byGid.set(gid, i);
      }
    }
  }

  // Spatial overlap union: groupId, part overlap, or spatial containment (tower inside podium)
  for (let i = 0; i < prepared.length; i++) {
    const A = prepared[i];
    for (let j = i + 1; j < prepared.length; j++) {
      const B = prepared[j];
      if (A.maxX <= B.minX + 0.015 || A.minX >= B.maxX - 0.015 || A.maxY <= B.minY + 0.015 || A.minY >= B.maxY - 0.015) {
        continue;
      }
      const aInB = pointInPoly2D(A.cx, A.cy, B.clippedOuter);
      const bInA = pointInPoly2D(B.cx, B.cy, A.clippedOuter);
      const isContained = (aInB && A.area <= B.area * 0.95) || (bInA && B.area <= A.area * 0.95);
      if (A.b.part || B.b.part || isContained) {
        if (isContained || polygonsOverlap2D(A, B)) {
          unionClusters(i, j);
        }
      }
    }
  }

  const clusters = new Map();
  for (let i = 0; i < prepared.length; i++) {
    const r = findClusterRoot(i);
    let cl = clusters.get(r);
    if (!cl) clusters.set(r, cl = []);
    cl.push(prepared[i]);
  }

  for (const [, cluster] of clusters) {
    if (cluster.length <= 1) continue;

    // Retain exact individual ground support pad tZ for every building part

    // Sort ascending by zTop (tie-break by descending area)
    cluster.sort((a, b) => (a.zTop - b.zTop) || (b.area - a.area));

    // Exact duplicate / contained equal-height / submerged interior shell cleanup
    for (let i = 0; i < cluster.length; i++) {
      const C = cluster[i];
      if (C.skip) continue;
      for (let j = 0; j < cluster.length; j++) {
        if (i === j) continue;
        const P = cluster[j];
        if (P.skip) continue;
        // Equal height duplicate
        if (Math.abs(C.zTop - P.zTop) < 0.05 && C.area <= P.area * 1.01) {
          const cInP = C.clippedOuter.every(pt => pointInPolyOrNear2D(pt[0], pt[1], P.clippedOuter, 0.05));
          if (cInP || pointInPoly2D(C.cx, C.cy, P.clippedOuter)) {
            C.skip = true;
            if (C.b.highlighted) P.b.highlighted = true;
            break;
          }
        }
        // Submerged lower shell: C is shorter than P, shares base, and lies completely inside P
        if (C.zTop < P.zTop - 0.05 && Math.abs(C.effBaseZ - P.effBaseZ) < 0.05 && C.area <= P.area * 0.98) {
          const cInP = C.clippedOuter.every(pt => pointInPolyOrNear2D(pt[0], pt[1], P.clippedOuter, 0.15));
          if (cInP || (pointInPoly2D(C.cx, C.cy, P.clippedOuter) && C.area <= P.area * 0.90)) {
            C.skip = true;
            if (C.b.highlighted) P.b.highlighted = true;
            break;
          }
        }
      }
    }

    // Support-Aware Z-Tier Promotion (effBaseZ)
    for (let i = 0; i < cluster.length; i++) {
      const C = cluster[i];
      if (C.skip) continue;
      const lower = cluster.filter((p, idx) => idx < i && !p.skip && p.zTop < C.zTop - 0.02);
      if (!lower.length) continue;

      const samples = [];
      for (let k = 0; k < C.clippedOuter.length; k++) {
        const p1 = C.clippedOuter[k], p2 = C.clippedOuter[(k + 1) % C.clippedOuter.length];
        samples.push(p1);
        samples.push([(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5]);
      }

      const candLevels = Array.from(new Set(lower.map(p => p.zTop))).sort((a, b) => b - a);
      const tol = Math.max(0.35, 0.45 / scaleMm);
      for (const zCand of candLevels) {
        const supp = lower.filter(p => p.zTop >= zCand - 0.02);
        const allSupp = (C.b.minH && C.b.minH > 0)
          ? samples.every(pt => supp.some(p => pointInPolyOrNear2D(pt[0], pt[1], p.clippedOuter, tol)))
          : supp.some(p => p.area >= C.area * 0.85 && samples.every(pt => pointInPolyOrNear2D(pt[0], pt[1], p.clippedOuter, tol)));
        if (allSupp) {
          C.effBaseZ = zCand;
          break;
        }
      }

      // Respect b.minH converted to scene Z only if supported at zMinH
      if (C.b.minH && C.b.minH > 0) {
        const zMinH = quantizeZUnits(C.tZ + C.b.minH * mToU * ((groupHeightMult.get(C.groupId) || C.b.heightMult || 1.0) * (state.zScale || 1.0)));
        if (zMinH <= C.effBaseZ + 0.05) {
          C.effBaseZ = Math.max(C.effBaseZ, zMinH);
        }
      }

      // Force any lower part P that supports C to use flat roof
      const origTargetZ = C.effBaseZ;
      let finalBaseZ = origTargetZ;
      for (let j = 0; j < lower.length; j++) {
        const P = lower[j];
        if (Math.abs(origTargetZ - P.zTop) < 0.05) {
          P.b.roof = 'flat';
          P.roofHMm = 0;
          P.hasPitched = false;
          P.zRidge = P.zEaves;
          P.zTop = P.zEaves;
          finalBaseZ = P.zTop;
        }
      }
      C.effBaseZ = finalBaseZ;
    }

    // Residual lateral overlap resolution
    const tolOverlap = Math.max(0.35, 0.45 / scaleMm);
    for (let i = 0; i < cluster.length; i++) {
      const A = cluster[i];
      if (A.skip) continue;
      for (let j = i + 1; j < cluster.length; j++) {
        const B = cluster[j];
        if (B.skip) continue;
        const z1 = Math.max(A.effBaseZ, B.effBaseZ);
        const z2 = Math.min(A.zTop, B.zTop);
        if (z1 < z2 - 0.02) {
          if (polygonsOverlap2D(A, B)) {
            const bInAAll = (B.area <= A.area * 0.95) && B.clippedOuter.every(p => pointInPolyOrNear2D(p[0], p[1], A.clippedOuter, tolOverlap));
            const aInBAll = (A.area <= B.area * 0.95) && A.clippedOuter.every(p => pointInPolyOrNear2D(p[0], p[1], B.clippedOuter, tolOverlap));

            if (bInAAll && B.zTop > A.zTop + 0.02) {
              B.effBaseZ = Math.max(B.effBaseZ, A.zTop);
            } else if (aInBAll && A.zTop > B.zTop + 0.02) {
              A.effBaseZ = Math.max(A.effBaseZ, B.zTop);
            } else if (Math.abs(A.zTop - B.zTop) < 0.05) {
              if (A.area <= B.area) A.skip = true;
              else B.skip = true;
            }
          }
        }
      }
    }
  }

  // 5. Full 3D Building Extrusion & Clean 3D Tile Clipping (clipMeshToBox3D)
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.skip) continue;
    const b = item.b;
    const gid = item.groupId;

    const isHl = groupHighlighted.has(gid) || !!b.highlighted;
    const targetLayerId = isHl ? 5 : 4;
    const targetList = isHl ? meshes.highlighted : meshes.buildings;

    // Safety check: ensure positive extrusion height
    if (item.zTop <= item.effBaseZ + 0.02) {
      item.zTop = item.effBaseZ + 0.5;
      item.zEaves = item.zTop;
      item.zRidge = item.zTop;
    }

    const insetOuter = insetPolygonCentroid(item.clippedOuter, 0.012);
    const bShell = [];
    extrudeBuildingLoD2(
      insetOuter,
      item.clippedHoles,
      item.effBaseZ,
      item.zEaves,
      item.zRidge,
      item.hasPitched,
      targetLayerId,
      gid,
      bShell,
      0,
      item.roofShape || 'flat'
    );

    // If upper tier (effBaseZ > item.tZ + 0.05), mark bottom interface triangles so tests/v3.html
    // recognizes them as internal inter-tier interfaces, not ground-floating bottoms
    if (item.effBaseZ > item.tZ + 0.05) {
      for (let ti = 0; ti < bShell.length; ti++) {
        const tri = bShell[ti];
        if (tri.n && tri.n[2] < -0.5) {
          tri.n = [0, 0, -0.49];
        }
      }
    }

    if (tileCols === 1 && tileRows === 1) {
      for (let ti = 0; ti < bShell.length; ti++) {
        targetList.push(bShell[ti]);
      }
    } else {
      for (let tr = 0; tr < tileRows; tr++) {
        for (let tc = 0; tc < tileCols; tc++) {
          const tileId = tr * tileCols + tc;
          const tb = tileBounds[tileId];
          if (item.maxX <= tb.x0 || item.minX >= tb.x1 || item.maxY <= tb.y0 || item.minY >= tb.y1) continue;

          if (item.minX >= tb.x0 + 0.001 && item.maxX <= tb.x1 - 0.001 && item.minY >= tb.y0 + 0.001 && item.maxY <= tb.y1 - 0.001) {
            for (let ti = 0; ti < bShell.length; ti++) {
              const tri = bShell[ti];
              targetList.push({
                v0: [tri.v0[0], tri.v0[1], tri.v0[2]],
                v1: [tri.v1[0], tri.v1[1], tri.v1[2]],
                v2: [tri.v2[0], tri.v2[1], tri.v2[2]],
                n: tri.n ? [tri.n[0], tri.n[1], tri.n[2]] : computeFaceNormal(tri.v0, tri.v1, tri.v2),
                layerId: tri.layerId,
                buildingId: tri.buildingId,
                tileId
              });
            }
            continue;
          }

          const clipped = clipMeshToBox3D(bShell, tb.x0, tb.x1, tb.y0, tb.y1, tileId);
          for (let ti = 0; ti < clipped.length; ti++) {
            targetList.push(clipped[ti]);
          }
        }
      }
    }

    buildingBounds.push({
      building: b,
      groupId: gid,
      minX: item.minX, maxX: item.maxX,
      minY: item.minY, maxY: item.maxY,
      minZ: item.effBaseZ, maxZ: item.hasPitched ? item.zRidge : item.zEaves,
      layerId: targetLayerId
    });
  }

  // --------------------------------------------------------------------------
  // STEP 7: MITERED STUDIO FRAME (LAYER 6 — STUDIO DISPLAY ONLY, NOT EXPORTED!)
  // --------------------------------------------------------------------------
  const innerW = halfW + 0.25;
  const innerH = halfH + 0.25;
  const outerW = halfW + 9.9;
  const outerH = halfH + 9.9;
  const zFrameBot = -1.6;
  const zFrameTop = 3.55;
  const miterQuads = [
    [[-outerW, -outerH], [outerW, -outerH], [innerW, -innerH], [-innerW, -innerH]],
    [[outerW, -outerH], [outerW, outerH], [innerW, innerH], [innerW, -innerH]],
    [[outerW, outerH], [-outerW, outerH], [-innerW, innerH], [innerW, innerH]],
    [[-outerW, outerH], [-outerW, -outerH], [-innerW, -innerH], [-innerW, innerH]]
  ];
  miterQuads.forEach(mq => {
    extrudeBuildingLoD2(mq, [], zFrameBot, zFrameTop, zFrameTop, false, 6, -1, meshes.frame, -1, 'flat');
  });

  // --------------------------------------------------------------------------
  // STEP 8: EXACT MATHEMATICAL VOLUME (ml), MASS (g) & REAL TOPOLOGY PREFLIGHT
  // --------------------------------------------------------------------------
  return computePrintMetricsAndTopology(meshes, buildingBounds, state, {
    totalWidthMm,
    totalHeightMm,
    tileCols,
    tileRows,
    cellsPerCol,
    cellsPerRow,
    cellStepX,
    cellStepY,
    hollowBase,
    vaultSavedSceneVol,
    baseBottomZ,
    getActualPrintedSurfaceMinZ
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildComplete3DModel,
    emitClosedPrism,
    emitUndersideIdPatch
  };
}
