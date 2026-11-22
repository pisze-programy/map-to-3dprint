// Generate the build plate dripper (drain hanger) v2 for Anycubic Photon Mono 4.
//
// Source design: calibration/Photon_mono4_drip.stl (open-source community design).
// Output file:
//   calibration/abs_dripper_mono4_v2_010mm.stl (print orientation, front face on the plate)
//
// Function of the two parts:
//   - Sleeve = FEMALE. It slides onto the printer Z-arm. A larger opening gives a looser fit.
//   - Socket = MALE. The build plate bracket slides onto it. A smaller outer profile gives a
//     looser fit. Its OUTER profile is the fit dimension.
//
// Fit history (physical prints):
//   - v1 sleeve inner 52.5 x 15.5 mm goes onto the Z-arm with play. User accepts it. Kept in v2.
//   - v1 socket outer 50.0 x 16.5 mm is about 5 mm too wide for the plate bracket. In v2 the
//     socket outer is the source profile (45.0 x 15.0 mm, R 2.0 mm corners) minus 1.0 mm:
//     44.0 x 14.0 mm with R 2.0 mm corners.
//   - v1 socket mouth corner lifted off the Flex Plate: a vent notch 13 mm from the corner left
//     a 3 mm L-shaped strip (DFM-06 violation). In v2 the socket mouth is closed by the 4.0 mm
//     front web, so the full socket footprint is one solid Z = 0 pad.
//
// Design frame (hanging frame, before print rotation):
//   X = across the Z-arm, Y = along the Z-arm (front face at Y = -4.0 mm), Z = up.
//
// Other features:
//   - Socket: 30 deg tilt and 4 deg drain pitch from the source design. Blind hollow
//     (3.0 mm walls) open at the back end. Its floor is flat at the back face of the front web.
//   - One vent slot 4.2 mm wide, 2.0 mm straight wall plus a 45 deg pointed roof, through the free
//     socket wall at mid-length, flush with the hollow floor. Distance to the socket ends is more
//     than 15 mm (DFM-06).
//   - Knob slot 8.0 mm wide through the sleeve top wall, open at the front, 45 deg pointed tip.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'manifold-3d';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'abs_dripper_mono4_v2_010mm.stl');

// Parameters (mm)
const WALL = 3.0;
const FRONT_Y = -4.0;
const WEB_T = 4.0;
const SLEEVE_IN_W = 52.5;
const SLEEVE_IN_H = 15.5;
const SLEEVE_LEN = 32.0;
const SOCKET_OUT_T = 14.0;       // Male outer thickness (source 15.0 minus 1.0)
const SOCKET_OUT_L = 44.0;       // Male outer width (source 45.0 minus 1.0)
const SOCKET_R = 2.0;            // Outer corner radius (source R 2.0)
const SOCKET_DEPTH = 36.0;         // Source socket depth (measured 36.0 mm)
const SOCKET_U0 = 18.398;        // Source outer u range 17.898 .. 32.898, centered, 0.5 mm smaller per side
const SOCKET_V1 = -10.834;       // Source outer v range -55.334 .. -10.334, centered, 0.5 mm smaller per side
const SOCKET_TILT_DEG = 60.0;    // Rotation about Y: local X -> n1 = (0.5, 0, -0.866)
const DRAIN_PITCH_DEG = 4.0;     // Rotation about X (source design value)
const PITCH_PIVOT_Z = -15.5;
const KNOB_W = 8.0;
const KNOB_CENTER_FROM_FRONT = 11.25;
const VENT_W = 4.2;               // Half-span 2.1 mm <= 2.25 mm (DFM-07)
const VENT_H = 2.0;

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection } = wasm;

function box(x0, x1, y0, y1, z0, z1) {
  return Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
}

function pitch(m) {
  return m
    .translate([0, -FRONT_Y, -PITCH_PIVOT_Z])
    .rotate([DRAIN_PITCH_DEG, 0, 0])
    .translate([0, FRONT_Y, PITCH_PIVOT_Z]);
}

function socketFrame(m) {
  // Local (u, y, v) -> global u*n1 + y*Y + v*n2, then the 4 deg drain pitch about X.
  return pitch(m.rotate([0, SOCKET_TILT_DEG, 0]));
}

function roundedPrismLocal(u0, u1, v0, v1, r, y0, y1) {
  // Rounded rectangle in the local (u, v) plane, extruded along local Y from y0 to y1.
  const cs = CrossSection.square([u1 - u0 - 2 * r, v1 - v0 - 2 * r])
    .translate([u0 + r, v0 + r])
    .offset(r, 'Round', 2.0, 48);
  // Extrude along +Z, then Rx(+90): (x, y, z) -> (x, -z, y), so local v -> Z and depth -> -Y.
  return cs.extrude(y1 - y0).rotate([90, 0, 0]).translate([0, y1, 0]);
}

// Sleeve (female)
const sOutW = SLEEVE_IN_W + 2 * WALL;
const sOutH = SLEEVE_IN_H + 2 * WALL;
const sleeveOuter = box(-sOutW / 2, sOutW / 2, FRONT_Y, FRONT_Y + SLEEVE_LEN, -sOutH / 2, sOutH / 2);
const sleeveHole = box(-SLEEVE_IN_W / 2, SLEEVE_IN_W / 2, FRONT_Y - 10, FRONT_Y + SLEEVE_LEN + 10, -SLEEVE_IN_H / 2, SLEEVE_IN_H / 2);

// Socket (male), local u along n1, v along n2
const uOut0 = SOCKET_U0;
const uOut1 = SOCKET_U0 + SOCKET_OUT_T;
const vOut1 = SOCKET_V1;
const vOut0 = SOCKET_V1 - SOCKET_OUT_L;
const socketOuter = socketFrame(
  roundedPrismLocal(uOut0, uOut1, vOut0, vOut1, SOCKET_R, FRONT_Y - 8, FRONT_Y + SOCKET_DEPTH)
);
// Blind hollow: open at the back, floor flat at the back face of the front web (global Y = 0)
const hollowFloorY = FRONT_Y + WEB_T;
const socketHollow = socketFrame(
  box(uOut0 + WALL, uOut1 - WALL, FRONT_Y - 20, FRONT_Y + SOCKET_DEPTH + 20, vOut0 + WALL, vOut1 - WALL)
).intersect(box(-200, 200, hollowFloorY, 200, -200, 200));

// Front web plate: convex hull of the sleeve and socket sections inside the front slab
const slab = box(-200, 200, FRONT_Y, FRONT_Y + WEB_T, -200, 200);
const web = Manifold.hull([sleeveOuter.intersect(slab), socketOuter.intersect(slab)]);

// Knob slot through the sleeve top wall, open at the front face, 45 deg pointed tip
const knobHalf = KNOB_W / 2;
const knobCenterY = FRONT_Y + KNOB_CENTER_FROM_FRONT;
const kz0 = SLEEVE_IN_H / 2 - 0.5;
const kz1 = sOutH / 2 + 0.5;
const knobBox = box(-knobHalf, knobHalf, FRONT_Y - 10, knobCenterY, kz0, kz1);
const knobPoint = box(-knobHalf, knobHalf, -knobHalf, knobHalf, kz0, kz1)
  .rotate([0, 0, 45])
  .translate([0, knobCenterY, 0])
  .intersect(box(-knobHalf, knobHalf, knobCenterY, knobCenterY + 2 * knobHalf, kz0, kz1));

// Vent slot through the free socket wall (far from the sleeve) at mid-length, above the hollow floor.
// Defined without the drain pitch; near Y = 0 the pitch shift of the wall is below 0.4 mm.
// The vent roof is a 45 deg point (no flat downward ceiling on the male sliding face, DFM-07).
const vMid = (vOut0 + vOut1) / 2;
const ventHalf = VENT_W / 2;
const vu0 = uOut1 - WALL - 1.5;
const vu1 = uOut1 + 1.5;
const ventTop = hollowFloorY + VENT_H;
const ventRect = box(vu0, vu1, hollowFloorY, ventTop, vMid - ventHalf, vMid + ventHalf);
const ventRoof = box(vu0, vu1, -ventHalf, ventHalf, -ventHalf, ventHalf)
  .rotate([45, 0, 0])
  .translate([0, ventTop, vMid])
  .intersect(box(vu0, vu1, ventTop, ventTop + 2 * ventHalf, vMid - ventHalf, vMid + ventHalf));
const vent = Manifold.union([ventRect, ventRoof]).rotate([0, SOCKET_TILT_DEG, 0]);

// Assemble in the hanging frame, then cut the flat front face
const frontKeep = box(-200, 200, FRONT_Y, 200, -200, 200);
let body = Manifold.union([sleeveOuter, socketOuter, web]).intersect(frontKeep);
body = body.subtract(Manifold.union([sleeveHole, socketHollow, knobBox, knobPoint, vent]));

// Print orientation: rotate +90 deg about X (front face Y = -4 goes to Z = 0), center on the plate
let printPart = body.rotate([90, 0, 0]);
const bb = printPart.boundingBox();
printPart = printPart.translate([
  -(bb.min[0] + bb.max[0]) / 2,
  -(bb.min[1] + bb.max[1]) / 2,
  -bb.min[2],
]);

// Export binary STL
const mesh = printPart.getMesh();
const np = mesh.numProp;
const vp = mesh.vertProperties;
const tv = mesh.triVerts;
const nTri = tv.length / 3;
const buf = Buffer.alloc(84 + 50 * nTri);
Buffer.from('Mono 4 dripper v2, male socket 44x14 R2, print orientation, 2-manifold'.padEnd(80, ' '), 'ascii').copy(buf, 0);
buf.writeUInt32LE(nTri, 80);
let off = 84;
for (let t = 0; t < nTri; t++) {
  const p = [0, 1, 2].map((k) => {
    const i = tv[3 * t + k] * np;
    return [vp[i], vp[i + 1], vp[i + 2]];
  });
  const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
  const wx = p[2][0] - p[0][0], wy = p[2][1] - p[0][1], wz = p[2][2] - p[0][2];
  let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  for (const v of [nx, ny, nz, ...p[0], ...p[1], ...p[2]]) {
    buf.writeFloatLE(v, off);
    off += 4;
  }
  buf.writeUInt16LE(0, off);
  off += 2;
}
fs.writeFileSync(OUT, buf);

const fb = printPart.boundingBox();
console.log(`Written: ${OUT}`);
console.log(`Status: ${printPart.status()} | genus: ${printPart.genus()} | triangles: ${nTri}`);
console.log(`Volume: ${(printPart.volume() / 1000).toFixed(2)} ml`);
console.log(`BBox: ${(fb.max[0] - fb.min[0]).toFixed(2)} x ${(fb.max[1] - fb.min[1]).toFixed(2)} x ${(fb.max[2] - fb.min[2]).toFixed(2)} mm`);
