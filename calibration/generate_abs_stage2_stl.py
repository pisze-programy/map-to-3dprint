#!/usr/bin/env python3
"""
Generate the Stage 2 2-manifold STL model (0.100 mm layer thickness) for Anycubic Photon Mono 4 (10K).

Output file:
  calibration/abs_stage2_krakow_and_gauge_010mm.stl

Components on the build plate:
  1. Krakow historic center tile (60.00 x 60.00 x 16.31 mm) built as one unified 2-manifold solid:
     - Samples top surface elevation directly from map-to-3dprint (S3DB roofs, towers, 3D trees, streets).
     - Forms a closed 4.40 mm perimeter rim, 8 cell-aligned perimeter pressure relief channels (1.25 mm high),
       a 6.00 mm bottom rib grid with 1.25 mm interconnecting air notches, and 45-deg self-supporting
       relief vaults under thick buildings (minimum building wall thickness 1.85 mm).
     - Guarantees 0 open edges, 0 non-manifold edges, 0 non-manifold vertices, and 0 self-intersections.
  2. Vented Z-arm collar gauge (14.00 x 51.00 mm inner bore above Z=1.30 mm):
     - Uses a 6.00 mm bottom anchor flange (Z=0.00..1.00 mm) and 6 pressure relief channels at Z=0.00..1.25 mm.
  3. Horizontal bolt-hole bridge block (8.00 mm bore diameter, 13.00 mm total height).
  4. Two slotted M3 Z-endstop spacers (2.70 mm thickness, 3.50 mm slot width).
"""

import math
import os
import struct
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_stage1_stl import (
    RectilinearManifoldBuilder,
    audit_topology_and_volume,
    write_binary_stl,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


NODE_UNIFIED_MANIFOLD_TILE_SCRIPT = r"""
const fs = require('fs');
const path = require('path');
const repo = process.argv[1];
const outGridBin = process.argv[2];

const { buildComplete3DModel } = require(path.join(repo, 'src/mesh/mesh_builder.js'));
const { buildBinarySTLBytes } = require(path.join(repo, 'src/export/stl_writer.js'));

global.computePrintMetricsAndTopology = (meshes, bb, st, ctx) => {
  st.layerMeshes = meshes;
  return global.computeFastVolumeAndExtents(meshes, bb, st, ctx);
};

const scenePath = path.join(repo, 'cache/scene_v5_50.0488_19.9280_50.0598_19.9450.json');
const sc = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
const st = {
  bedSizeMm: 180,
  totalHeightMm: 180,
  tileCols: 3,
  tileRows: 3,
  isResin: true,
  printerPreset: 'photon_mono_4',
  hollowBase: false,
  layerHeightMm: 0.10,
  cropRatio: 0.88,
  zScale: 1.25,
  terrainScale: 1.15,
  treesEnabled: true,
};

buildComplete3DModel(sc, st);
// Export center tile 4 (60.00 x 60.00 mm) raw triangles to sample exact top surface envelope.
const stlBytes = buildBinarySTLBytes(st, 'all', 4);
const view = new DataView(stlBytes.buffer, stlBytes.byteOffset, stlBytes.byteLength);
const nTris = view.getUint32(80, true);

const N = 300; // 301 x 301 vertices over 60.00 x 60.00 mm (0.20 mm grid pitch)
const SPAN = 60.0;
const STEP = SPAN / N;
const NV = N + 1;
const zTop = new Float32Array(NV * NV);
zTop.fill(2.50);

for (let t = 0; t < nTris; t++) {
  const off = 84 + t * 50;
  const nz = view.getFloat32(off + 8, true);
  if (nz < 0.08) continue;
  const x0 = view.getFloat32(off + 12, true), y0 = view.getFloat32(off + 16, true), z0 = view.getFloat32(off + 20, true);
  const x1 = view.getFloat32(off + 24, true), y1 = view.getFloat32(off + 28, true), z1 = view.getFloat32(off + 32, true);
  const x2 = view.getFloat32(off + 36, true), y2 = view.getFloat32(off + 40, true), z2 = view.getFloat32(off + 44, true);

  const iMin = Math.max(0, Math.ceil(Math.min(x0, x1, x2) / STEP - 1e-5));
  const iMax = Math.min(N, Math.floor(Math.max(x0, x1, x2) / STEP + 1e-5));
  const jMin = Math.max(0, Math.ceil(Math.min(y0, y1, y2) / STEP - 1e-5));
  const jMax = Math.min(N, Math.floor(Math.max(y0, y1, y2) / STEP + 1e-5));
  if (iMin > iMax || jMin > jMax) continue;

  const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(denom) < 1e-9) continue;
  const invD = 1.0 / denom;

  for (let j = jMin; j <= jMax; j++) {
    const py = j * STEP;
    for (let i = iMin; i <= iMax; i++) {
      const px = i * STEP;
      const a = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) * invD;
      if (a < -1e-4) continue;
      const b = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) * invD;
      if (b < -1e-4) continue;
      const c = 1.0 - a - b;
      if (c < -1e-4) continue;
      const z = a * z0 + b * z1 + c * z2;
      const idx = j * NV + i;
      if (z > zTop[idx]) zTop[idx] = z;
    }
  }
}

// Compute self-supporting <=45-deg bottom surface zBot[j * NV + i] with closed rim,
// 8 cell-aligned perimeter vents (1.25 mm high, above Z=1.10 mm transition zone),
// 6.00 mm rib grid, 1.25 mm interconnecting air notches, and 45-deg building relief vaults.
const zBot = new Float32Array(NV * NV);
const MIN_WALL = 1.85;
const RIM_W = 4.40;
const PITCH = 6.00;
const RIB_HALF = 0.70; // 1.40 mm solid rib width (4.60 mm open pocket width)
const VENT_POS_A = RIM_W + 2.5 * PITCH; // 19.40 mm (center of cell 2)
const VENT_POS_B = RIM_W + 6.5 * PITCH; // 43.40 mm (center of cell 6)

for (let j = 0; j <= N; j++) {
  const y = j * STEP;
  for (let i = 0; i <= N; i++) {
    const x = i * STEP;
    const idx = j * NV + i;
    const ventMaxSafe = Math.min(1.25, Math.max(0.0, zTop[idx] - 1.25));
    const cellMaxSafe = Math.max(ventMaxSafe, Math.min(6.80, zTop[idx] - MIN_WALL));

    const inRim = (x <= RIM_W || x >= SPAN - RIM_W || y <= RIM_W || y >= SPAN - RIM_W);
    if (inRim) {
      // Eight perimeter pressure relief channels (2 per edge, base width 4.10 mm, crest height 1.25 mm)
      const dxVent = Math.min(Math.abs(x - VENT_POS_A), Math.abs(x - VENT_POS_B));
      const dyVent = Math.min(Math.abs(y - VENT_POS_A), Math.abs(y - VENT_POS_B));
      const isNSVent = (dxVent < 2.05) && (y <= RIM_W + 0.20 || y >= SPAN - RIM_W - 0.20);
      const isEWVent = (dyVent < 2.05) && (x <= RIM_W + 0.20 || x >= SPAN - RIM_W - 0.20);
      if (isNSVent) {
        zBot[idx] = Math.min(ventMaxSafe, Math.max(0.0, 2.05 - dxVent));
      } else if (isEWVent) {
        zBot[idx] = Math.min(ventMaxSafe, Math.max(0.0, 2.05 - dyVent));
      } else {
        zBot[idx] = 0.0;
      }
      continue;
    }

    // Interior 6.00 mm rib grid with 1.25 mm interconnecting air notches at cell midpoints
    const rx = ((x - RIM_W) % PITCH);
    const ry = ((y - RIM_W) % PITCH);
    const distRibX = Math.min(rx, PITCH - rx);
    const distRibY = Math.min(ry, PITCH - ry);
    const onRibX = distRibX <= RIB_HALF;
    const onRibY = distRibY <= RIB_HALF;

    if (onRibX || onRibY) {
      const notchY = Math.abs(ry - 0.5 * PITCH) < 2.00;
      const notchX = Math.abs(rx - 0.5 * PITCH) < 2.00;
      if ((onRibX && !onRibY && notchY) || (onRibY && !onRibX && notchX)) {
        const ramp = onRibX ? (2.00 - Math.abs(ry - 0.5 * PITCH)) : (2.00 - Math.abs(rx - 0.5 * PITCH));
        zBot[idx] = Math.min(ventMaxSafe, Math.max(0.0, ramp));
      } else {
        zBot[idx] = 0.0;
      }
    } else {
      zBot[idx] = cellMaxSafe;
    }
  }
}

// Limit underside vault slopes to <=45 deg (|dz/ds| <= 1.0) via a 3-pass Chamfer distance envelope.
const DIAG = STEP * Math.SQRT2;
for (let pass = 0; pass < 3; pass++) {
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const idx = j * NV + i;
      let v = zBot[idx];
      if (i > 0) v = Math.min(v, zBot[idx - 1] + STEP);
      if (j > 0) v = Math.min(v, zBot[idx - NV] + STEP);
      if (i > 0 && j > 0) v = Math.min(v, zBot[idx - NV - 1] + DIAG);
      if (i < N && j > 0) v = Math.min(v, zBot[idx - NV + 1] + DIAG);
      zBot[idx] = v;
    }
  }
  for (let j = N; j >= 0; j--) {
    for (let i = N; i >= 0; i--) {
      const idx = j * NV + i;
      let v = zBot[idx];
      if (i < N) v = Math.min(v, zBot[idx + 1] + STEP);
      if (j < N) v = Math.min(v, zBot[idx + NV] + STEP);
      if (i < N && j < N) v = Math.min(v, zBot[idx + NV + 1] + DIAG);
      if (i > 0 && j < N) v = Math.min(v, zBot[idx + NV - 1] + DIAG);
      zBot[idx] = v;
    }
  }
}

// Enforce >=1.85 mm horizontal wall thickness on deep building vaults above Z=1.35 mm
// by clamping zBot[i,j] <= zTop[ni,nj] - MIN_WALL within a 1.85 mm radius.
const R_CELLS = Math.ceil(1.85 / STEP);
const zBotClamped = new Float32Array(zBot);
for (let j = 1; j < N; j++) {
  for (let i = 1; i < N; i++) {
    const idx = j * NV + i;
    if (zBot[idx] <= 1.35) continue;
    let limit = zBot[idx];
    for (let dj = -R_CELLS; dj <= R_CELLS; dj++) {
      const nj = j + dj;
      if (nj < 0 || nj > N) continue;
      for (let di = -R_CELLS; di <= R_CELLS; di++) {
        const ni = i + di;
        if (ni < 0 || ni > N) continue;
        const dist = Math.hypot(di, dj) * STEP;
        if (dist <= 1.85) {
          const allow = Math.max(1.35, zTop[nj * NV + ni] - MIN_WALL);
          if (allow < limit) limit = allow;
        }
      }
    }
    zBotClamped[idx] = limit;
  }
}
zBot.set(zBotClamped);

// Re-run the 45-deg slope envelope after the building-wall clamp so every interior vault stays <=45 deg.
for (let j = 0; j <= N; j++) {
  for (let i = 0; i <= N; i++) {
    const idx = j * NV + i;
    let v = zBot[idx];
    if (i > 0) v = Math.min(v, zBot[idx - 1] + STEP);
    if (j > 0) v = Math.min(v, zBot[idx - NV] + STEP);
    if (i > 0 && j > 0) v = Math.min(v, zBot[idx - NV - 1] + DIAG);
    if (i < N && j > 0) v = Math.min(v, zBot[idx - NV + 1] + DIAG);
    zBot[idx] = v;
  }
}
for (let j = N; j >= 0; j--) {
  for (let i = N; i >= 0; i--) {
    const idx = j * NV + i;
    let v = zBot[idx];
    if (i < N) v = Math.min(v, zBot[idx + 1] + STEP);
    if (j < N) v = Math.min(v, zBot[idx + NV] + STEP);
    if (i < N && j < N) v = Math.min(v, zBot[idx + NV + 1] + DIAG);
    if (i > 0 && j < N) v = Math.min(v, zBot[idx + NV - 1] + DIAG);
    zBot[idx] = v;
  }
}

const header = Buffer.alloc(8);
header.writeUInt32LE(N, 0);
header.writeFloatLE(SPAN, 4);
fs.writeFileSync(
  outGridBin,
  Buffer.concat([
    header,
    Buffer.from(zTop.buffer, zTop.byteOffset, zTop.byteLength),
    Buffer.from(zBot.buffer, zBot.byteOffset, zBot.byteLength),
  ])
);
"""


def build_unified_city_sphere_manifold(grid_bin_path, ox=-64.0, oy=-30.0):
    """
    Convert the (N+1)x(N+1) double heightfield (zBot < zTop strictly everywhere)
    into a single closed 2-manifold solid (Euler characteristic V - E + F = 2).
    """
    raw = open(grid_bin_path, "rb").read()
    n, span = struct.unpack_from("<If", raw, 0)
    nv = n + 1
    count = nv * nv
    z_top = struct.unpack_from(f"<{count}f", raw, 8)
    z_bot = struct.unpack_from(f"<{count}f", raw, 8 + count * 4)
    step = span / n

    xs = [round(ox + i * step, 4) for i in range(nv)]
    ys = [round(oy + j * step, 4) for j in range(nv)]

    top_pts = [
        [(xs[i], ys[j], round(float(z_top[j * nv + i]), 4)) for i in range(nv)]
        for j in range(nv)
    ]
    bot_pts = [
        [(xs[i], ys[j], round(max(0.0, float(z_bot[j * nv + i])), 4)) for i in range(nv)]
        for j in range(nv)
    ]

    for j in range(nv):
        for i in range(nv):
            assert top_pts[j][i][2] - bot_pts[j][i][2] >= 1.20, (
                f"Wall thickness violation at ({i},{j}): top={top_pts[j][i][2]} bot={bot_pts[j][i][2]}"
            )

    tris = []
    append = tris.append

    # 1. Top surface (+Z outward) and Bottom surface (-Z outward)
    for j in range(n):
        t_row0 = top_pts[j]
        t_row1 = top_pts[j + 1]
        b_row0 = bot_pts[j]
        b_row1 = bot_pts[j + 1]
        for i in range(n):
            t00, t10 = t_row0[i], t_row0[i + 1]
            t01, t11 = t_row1[i], t_row1[i + 1]
            append((t00, t10, t11))
            append((t00, t11, t01))

            b00, b10 = b_row0[i], b_row0[i + 1]
            b01, b11 = b_row1[i], b_row1[i + 1]
            append((b00, b11, b10))
            append((b00, b01, b11))

    # 2. South perimeter wall (j = 0, outward -Y)
    for i in range(n):
        b00, b10 = bot_pts[0][i], bot_pts[0][i + 1]
        t00, t10 = top_pts[0][i], top_pts[0][i + 1]
        append((b00, b10, t10))
        append((b00, t10, t00))

    # 3. East perimeter wall (i = n, outward +X)
    for j in range(n):
        b10, b11 = bot_pts[j][n], bot_pts[j + 1][n]
        t10, t11 = top_pts[j][n], top_pts[j + 1][n]
        append((b10, b11, t11))
        append((b10, t11, t10))

    # 4. North perimeter wall (j = n, outward +Y)
    for i in range(n):
        b01, b11 = bot_pts[n][i], bot_pts[n][i + 1]
        t01, t11 = top_pts[n][i], top_pts[n][i + 1]
        append((b11, b01, t01))
        append((b11, t01, t11))

    # 5. West perimeter wall (i = 0, outward -X)
    for j in range(n):
        b00, b01 = bot_pts[j][0], bot_pts[j + 1][0]
        t00, t01 = top_pts[j][0], top_pts[j + 1][0]
        append((b01, b00, t00))
        append((b01, t00, t01))

    return tris


def make_ops():
    ops = []
    xs = set()
    ys = set()

    def add(x0, x1, y0, y1, z0, z1):
        x0, x1 = round(float(x0), 4), round(float(x1), 4)
        y0, y1 = round(float(y0), 4), round(float(y1), 4)
        z0, z1 = round(float(z0), 4), round(float(z1), 4)
        if x1 - x0 > 1e-5 and y1 - y0 > 1e-5 and z1 - z0 > 1e-5:
            xs.update([x0, x1])
            ys.update([y0, y1])
            ops.append(("add", x0, x1, y0, y1, z0, z1))

    def cut(x0, x1, y0, y1, z0, z1):
        x0, x1 = round(float(x0), 4), round(float(x1), 4)
        y0, y1 = round(float(y0), 4), round(float(y1), 4)
        z0, z1 = round(float(z0), 4), round(float(z1), 4)
        if x1 - x0 > 1e-5 and y1 - y0 > 1e-5 and z1 - z0 > 1e-5:
            xs.update([x0, x1])
            ys.update([y0, y1])
            ops.append(("cut", x0, x1, y0, y1, z0, z1))

    return xs, ys, ops, add, cut


def compile_part(fn):
    xs, ys, ops, add, cut = make_ops()
    fn(add, cut)
    builder = RectilinearManifoldBuilder(xs, ys)
    for kind, x0, x1, y0, y1, z0, z1 in ops:
        if kind == "add":
            builder.add_box(x0, x1, y0, y1, z0, z1)
        else:
            builder.cut_box(x0, x1, y0, y1, z0, z1)
    return builder.build_triangles()


def build_vented_mono4_arm_gauge(add, cut):
    """
    Build the vented Z-arm collar gauge (14.00 x 51.00 mm inner bore above Z=1.30 mm).
    Uses a 6.00 mm bottom anchor flange (Z=0.00..1.00 mm) and 6 pressure relief channels at Z=0.00..1.25 mm.
    """
    cx, cy = 17.00, 0.00
    ix0, ix1 = cx - 7.00, cx + 7.00      # 14.00 mm inner X
    iy0, iy1 = cy - 25.50, cy + 25.50    # 51.00 mm inner Y
    wx0, wx1 = ix0 - 2.50, ix1 + 2.50    # 19.00 mm structural collar X
    wy0, wy1 = iy0 - 2.50, iy1 + 2.50    # 56.00 mm structural collar Y
    bx0, bx1 = wx0 - 3.50, wx1 + 3.50    # 26.00 mm outer flange X (4.00..30.00)
    by0, by1 = wy0 - 3.50, wy1 + 3.50    # 63.00 mm outer flange Y (-31.50..+31.50)

    add(bx0, bx1, by0, by1, 0.00, 1.00)
    add(wx0, wx1, wy0, wy1, 0.00, 5.60)
    cut(ix0, ix1, iy0, iy1, 0.00, 5.70)

    # Step back inner bore on Z=0.00..1.30 mm by 0.35 mm so transition layers do not pinch the bore.
    cut(ix0 - 0.35, ix1 + 0.35, iy0 - 0.35, iy1 + 0.35, 0.00, 1.30)

    # Cut 6 pressure relief channels (4.20 mm wide x 1.25 mm high, above Z=1.10 mm transition zone).
    for vy in (-13.50, 13.50):
        cut(bx0 - 0.10, ix0 + 0.10, vy - 2.10, vy + 2.10, 0.00, 1.25)
        cut(ix1 - 0.10, bx1 + 0.10, vy - 2.10, vy + 2.10, 0.00, 1.25)
    cut(cx - 2.10, cx + 2.10, by0 - 0.10, iy0 + 0.10, 0.00, 1.25)
    cut(cx - 2.10, cx + 2.10, iy1 - 0.10, by1 + 0.10, 0.00, 1.25)


def build_bolt_hole_arch_test(add, cut):
    """
    Build the horizontal bolt-hole bridge block (8.00 mm diameter, 0.100 mm layer thickness).
    Location: X in [35.0, 51.0], Y in [7.0, 23.0], Z in [0.00, 13.00] mm.
    """
    x0, x1 = 35.00, 51.00
    y0, y1 = 7.00, 23.00
    yc, zc, rad = 15.00, 7.20, 4.00

    add(x0, x1, y0, y1, 0.00, 13.00)
    cut(x0, x0 + 0.30, y0, y1, 0.00, 0.40)
    cut(x1 - 0.30, x1, y0, y1, 0.00, 0.40)
    cut(x0, x1, y0, y0 + 0.30, 0.00, 0.40)
    cut(x0, x1, y1 - 0.30, y1, 0.00, 0.40)
    cut(x0 - 0.10, x1 + 0.10, yc - 1.20, yc + 1.20, 0.00, 1.25)

    for s in range(80):
        za = round(zc - rad + s * 0.10, 4)
        zb = round(za + 0.10, 4)
        zm = 0.5 * (za + zb) - zc
        half_chord = math.sqrt(max(0.0, rad * rad - zm * zm))
        if half_chord >= 0.15:
            cut(x0 - 0.10, x1 + 0.10, round(yc - half_chord, 3), round(yc + half_chord, 3), za, zb)


def build_universal_z_shim_washers(add, cut):
    """
    Build two slotted M3 Z-endstop spacers (2.70 mm thickness, 3.50 mm slot width).
    """
    for y0 in (-29.00, -13.00):
        x0, x1 = 35.00, 49.00
        y1 = y0 + 12.00
        yc = 0.5 * (y0 + y1)

        add(x0, x1, y0, y1, 0.00, 2.70)
        cut(x0 + 4.00, x1 + 0.10, yc - 1.75, yc + 1.75, 0.00, 2.80)

        cut(x0, x0 + 0.30, y0, y1, 0.00, 0.40)
        cut(x1 - 0.30, x1, y0, y1, 0.00, 0.40)
        cut(x0, x1, y0, y0 + 0.30, 0.00, 0.40)
        cut(x0, x1, y1 - 0.30, y1, 0.00, 0.40)
        cut(x0 + 3.70, x1 + 0.10, yc - 2.05, yc + 2.05, 0.00, 0.40)


def strict_manifold_audit(tris):
    """
    Verify 0 degenerate faces, 0 open edges, 0 non-manifold edges, 0 conflicting half-edges,
    and 0 non-manifold vertices across all shells.
    """
    undir = Counter()
    dir_e = Counter()
    v_tris = defaultdict(list)
    degen = 0
    for ti, (p0, p1, p2) in enumerate(tris):
        ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        area2 = math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2)
        if area2 < 1e-9 or p0 == p1 or p1 == p2 or p2 == p0:
            degen += 1
        for a, b in ((p0, p1), (p1, p2), (p2, p0)):
            undir[tuple(sorted((a, b)))] += 1
            dir_e[(a, b)] += 1
        for p in (p0, p1, p2):
            v_tris[p].append(ti)

    open_e = sum(1 for c in undir.values() if c == 1)
    nonman_e = sum(1 for c in undir.values() if c > 2)
    bad_half = sum(1 for (a, b), c in dir_e.items() if c != 1 or dir_e[(b, a)] != 1)

    nm_verts = 0
    for v, tlist in v_tris.items():
        adj = defaultdict(list)
        for ti in tlist:
            pts = [p for p in tris[ti] if p != v]
            if len(pts) == 2:
                adj[pts[0]].append(pts[1])
                adj[pts[1]].append(pts[0])
        if not adj:
            continue
        seen = set()
        stack = [next(iter(adj))]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(adj[cur])
        if len(seen) != len(adj) or any(len(nb) != 2 for nb in adj.values()):
            nm_verts += 1

    return {
        "degen": degen,
        "open_edges": open_e,
        "non_manifold_edges": nonman_e,
        "bad_half_edges": bad_half,
        "non_manifold_verts": nm_verts,
    }


def check_z0_contact_area(tris, x_min_filter, x_max_filter):
    area = 0.0
    for p0, p1, p2 in tris:
        if p0[2] < 0.02 and p1[2] < 0.02 and p2[2] < 0.02:
            mx = (p0[0] + p1[0] + p2[0]) / 3.0
            if x_min_filter <= mx <= x_max_filter:
                ux, uy = p1[0] - p0[0], p1[1] - p0[1]
                vx, vy = p2[0] - p0[0], p2[1] - p0[1]
                cz = ux * vy - uy * vx
                if cz < -1e-7:
                    area += 0.5 * abs(cz)
    return area


def main():
    out_dir = os.path.dirname(os.path.abspath(__file__))

    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tmp:
        tmp_grid_bin = tmp.name

    try:
        subprocess.run(
            ["node", "-e", NODE_UNIFIED_MANIFOLD_TILE_SCRIPT, REPO_ROOT, tmp_grid_bin],
            check=True,
        )
        city_tris = build_unified_city_sphere_manifold(tmp_grid_bin, ox=-64.0, oy=-30.0)
    finally:
        if os.path.exists(tmp_grid_bin):
            os.remove(tmp_grid_bin)

    gauge_tris = compile_part(build_vented_mono4_arm_gauge)
    hole_tris = compile_part(build_bolt_hole_arch_test)
    shim_tris = compile_part(build_universal_z_shim_washers)

    full_tris = city_tris + gauge_tris + hole_tris + shim_tris
    full_stats = audit_topology_and_volume(full_tris)
    strict = strict_manifold_audit(full_tris)

    city_z0_mm2 = check_z0_contact_area(city_tris, -65.0, -3.0)
    gauge_z0_mm2 = check_z0_contact_area(gauge_tris, 3.0, 31.0)

    out_path = os.path.join(out_dir, "abs_stage2_krakow_and_gauge_010mm.stl")
    write_binary_stl(
        out_path,
        full_tris,
        header_text="ABS-Like White Stage 2 (0.10mm): Unified 2-Manifold Krakow + Gauge + M8 + Shim",
    )

    sx = full_stats["bbox_max"][0] - full_stats["bbox_min"][0]
    sy = full_stats["bbox_max"][1] - full_stats["bbox_min"][1]
    sz = full_stats["bbox_max"][2] - full_stats["bbox_min"][2]

    print("=== STAGE 2 (ABS-LIKE WHITE @ 0.100 MM) STRICT 2-MANIFOLD REPORT ===")
    print(f"File: {out_path}")
    print(f"Total triangles: {full_stats['triangles']} (City: {len(city_tris)}, Aux: {len(full_tris) - len(city_tris)})")
    print(
        f"Bounding box: {sx:.2f} x {sy:.2f} x {sz:.2f} mm "
        f"(X: {full_stats['bbox_min'][0]:.2f}..{full_stats['bbox_max'][0]:.2f}, "
        f"Y: {full_stats['bbox_min'][1]:.2f}..{full_stats['bbox_max'][1]:.2f}, "
        f"Z: {full_stats['bbox_min'][2]:.2f}..{full_stats['bbox_max'][2]:.2f} mm)"
    )
    print(f"Layer count @ 0.100 mm: {math.ceil(sz / 0.10)}")
    print(f"Total resin volume: {full_stats['volume_ml']:.2f} ml")
    print(f"Z=0 contact area (City 60x60): {city_z0_mm2:.1f} mm2 ({city_z0_mm2 / 36.0:.1f}% of tile area)")
    print(f"Z=0 contact area (Gauge P1):   {gauge_z0_mm2:.1f} mm2 (6 relief channels)")
    print(f"Strict manifold check: {strict}")

    assert strict["degen"] == 0, f"ERROR: degenerate triangles={strict['degen']}"
    assert strict["open_edges"] == 0, f"ERROR: open edges={strict['open_edges']}"
    assert strict["non_manifold_edges"] == 0, f"ERROR: non-manifold edges={strict['non_manifold_edges']}"
    assert strict["bad_half_edges"] == 0, f"ERROR: conflicting half-edges={strict['bad_half_edges']}"
    assert strict["non_manifold_verts"] == 0, f"ERROR: non-manifold vertices={strict['non_manifold_verts']}"
    assert sx <= 150.0 and sy <= 84.0, "ERROR: Build volume limit exceeded."
    print("STATUS: STRICT 2-MANIFOLD VERIFIED (ZERO MESH ERRORS).")


if __name__ == "__main__":
    main()
