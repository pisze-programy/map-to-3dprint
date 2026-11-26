// ============================================================================
// tools/camera_math.js
// 4x4 Camera and Shadow Light Matrix Algebra for Headless 3D Rendering
// ============================================================================

'use strict';

/**
 * Builds a right-handed perspective projection matrix.
 * @param {number} fovRad
 * @param {number} aspect
 * @param {number} near
 * @param {number} far
 * @returns {Float32Array}
 */
function mat4Perspective(fovRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ]);
}

/**
 * Builds an orthographic projection matrix.
 * @param {number} left
 * @param {number} right
 * @param {number} bottom
 * @param {number} top
 * @param {number} near
 * @param {number} far
 * @returns {Float32Array}
 */
function mat4Ortho(left, right, bottom, top, near, far) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  return new Float32Array([
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1
  ]);
}

/**
 * Builds a look-at view matrix.
 * @param {number[]} eye
 * @param {number[]} center
 * @param {number[]} up
 * @returns {Float32Array}
 */
function mat4LookAt(eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1
  ]);
}

/**
 * Multiplies two column-major 4x4 matrices.
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {Float32Array}
 */
function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i];
    const ai1 = a[i + 4];
    const ai2 = a[i + 8];
    const ai3 = a[i + 12];
    out[i]      = ai0 * b[0]  + ai1 * b[1]  + ai2 * b[2]  + ai3 * b[3];
    out[i + 4]  = ai0 * b[4]  + ai1 * b[5]  + ai2 * b[6]  + ai3 * b[7];
    out[i + 8]  = ai0 * b[8]  + ai1 * b[9]  + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

/**
 * Converts a hex color string like '#ffffff' to normalized [r, g, b] in [0, 1].
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRgbNorm(hex) {
  const c = (hex || '#ffffff').replace('#', '');
  const num = parseInt(c, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

/**
 * Computes perspective near/far clip planes scaled with camera distance.
 * @param {number} cameraDistance
 * @param {number} [explodeSpan=0]
 * @returns {{zNear: number, zFar: number}}
 */
function computeCameraClipPlanes(cameraDistance, explodeSpan = 0) {
  const camDist = Math.max(2.5, Number(cameraDistance) || 274);
  const expSpan = Math.max(0, Number(explodeSpan) || 0);
  const zFar = Math.max(450.0, camDist + 420.0 + expSpan * 2.5);
  const zNear = Math.max(0.25, zFar / 1950.0, Math.min(8.0, camDist * 0.08));
  return { zNear, zFar };
}

const _CANON_HALF_MATH = 84.6;

/**
 * Computes texel-snapped orthographic directional shadow frustum parameters.
 * @param {object} camera
 * @param {number} sunAngleDeg
 * @param {number} [halfW=84.6]
 * @param {number} [halfH=84.6]
 * @param {number} [explodeFactor=0]
 * @param {number} [explodeSpan=0]
 * @param {number} [shadowRes=2048]
 * @returns {{sunDir: number[], orthoR: number, lx: number, ly: number, lightNear: number, lightFar: number, lightMatrix: Float32Array, frustumKey: string}}
 */
function computeShadowFrustum(camera, sunAngleDeg, halfW = _CANON_HALF_MATH, halfH = _CANON_HALF_MATH, explodeFactor = 0, explodeSpan = 0, shadowRes = 2048) {
  const sunRad = (Number(sunAngleDeg) || 0) * Math.PI / 180;
  const sunDir = [Math.cos(sunRad) * 0.68, Math.sin(sunRad) * 0.68, 0.73];
  const fullOrthoR = Math.max(115, Math.round(Math.max(halfW || _CANON_HALF_MATH, halfH || _CANON_HALF_MATH) * 1.359)) + explodeSpan;
  const camDist = Math.max(2.5, Number(camera && camera.distance) || 274);
  const absPitch = Math.abs(Number(camera && camera.pitch) || 0.5);
  const topRayAngle = absPitch - (17.5 * Math.PI / 180);

  let neededR = fullOrthoR;
  if (camDist < 90.0) {
    if (topRayAngle > 0.09) {
      const distAhead = Math.max(0, camDist * (Math.sin(absPitch) / Math.tan(topRayAngle) - Math.cos(absPitch)));
      const distBehind = camDist * Math.cos(absPitch);
      const visRadius = Math.max(distAhead, distBehind) * 1.35 + 16.0;
      neededR = Math.max(24.0, visRadius);
    } else {
      neededR = Math.max(64.0, camDist * 2.2 + 52.0);
    }
  }

  let orthoR = fullOrthoR;
  if (neededR < fullOrthoR) {
    if (neededR <= 24.0) orthoR = 24.0;
    else if (neededR <= 36.0) orthoR = 36.0;
    else if (neededR <= 56.0) orthoR = 56.0;
    else if (neededR <= 84.0) orthoR = 84.0;
  }

  const explodeLift = (Number(explodeFactor) || 0) * 70.0;
  if (orthoR >= fullOrthoR) {
    const lightEye = [sunDir[0] * 180, sunDir[1] * 180, sunDir[2] * 180];
    const lightView = mat4LookAt(lightEye, [0, 0, 6], [0, 0, 1]);
    const lightNear = 20.0;
    const lightFar = 380.0 + explodeSpan + explodeLift;
    const lightProj = mat4Ortho(-orthoR, orthoR, -orthoR, orthoR, lightNear, lightFar);
    return {
      sunDir,
      orthoR,
      lx: 0,
      ly: 0,
      lightNear,
      lightFar,
      lightMatrix: mat4Multiply(lightProj, lightView),
      frustumKey: `full:${orthoR.toFixed(1)}`
    };
  }

  const baseLightEye = [sunDir[0] * 220, sunDir[1] * 220, 6 + sunDir[2] * 220];
  const lightView = mat4LookAt(baseLightEye, [0, 0, 6], [0, 0, 1]);
  const tx = (camera && Array.isArray(camera.target)) ? (Number(camera.target[0]) || 0) : 0;
  const ty = (camera && Array.isArray(camera.target)) ? (Number(camera.target[1]) || 0) : 0;
  const tz = (camera && Array.isArray(camera.target)) ? (Number(camera.target[2]) || 6) : 6;

  const vx = lightView[0] * tx + lightView[4] * ty + lightView[8] * tz + lightView[12];
  const vy = lightView[1] * tx + lightView[5] * ty + lightView[9] * tz + lightView[13];
  const vz = lightView[2] * tx + lightView[6] * ty + lightView[10] * tz + lightView[14];

  const texelWorld = (2.0 * orthoR) / (shadowRes || 2048);
  const snapUnit = texelWorld * 64.0;
  const lx = Math.round(vx / snapUnit) * snapUnit;
  const ly = Math.round(vy / snapUnit) * snapUnit;

  const distFocus = Math.max(80.0, -vz);
  const halfDepth = Math.max(76.0, orthoR * 1.45 + 36.0 + explodeLift * 0.65 + explodeSpan * 0.5);
  const lightNear = Math.max(8.0, Math.round(distFocus - halfDepth));
  const lightFar = Math.round(distFocus + halfDepth);
  const lightProj = mat4Ortho(lx - orthoR, lx + orthoR, ly - orthoR, ly + orthoR, lightNear, lightFar);

  return {
    sunDir,
    orthoR,
    lx,
    ly,
    lightNear,
    lightFar,
    lightMatrix: mat4Multiply(lightProj, lightView),
    frustumKey: `zoom:${orthoR}:${Math.round(vx / snapUnit)},${Math.round(vy / snapUnit)}:${lightNear}-${lightFar}`
  };
}

module.exports = {
  mat4Perspective,
  mat4Ortho,
  mat4LookAt,
  mat4Multiply,
  hexToRgbNorm,
  computeCameraClipPlanes,
  computeShadowFrustum
};
