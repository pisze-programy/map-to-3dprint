// ============================================================================
// src/webgl_shaders_math.js
// GLSL Shadow/Studio Shaders, 4x4 Matrix Math & Möller–Trumbore Ray Intersection
// ============================================================================

const WEBGL_SHADOW_VS = `
  attribute vec3 aPos;
  attribute float aLayerId;
  attribute float aTileId;
  uniform mat4 uLightMatrix;
  uniform float uExplode;
  uniform float uTileCols;
  uniform float uTileRows;
  uniform float uTileExplode;
  varying float vDepth;
  varying vec3 vWorldPos;
  varying float vLayerId;
  void main() {
    float lift = (aLayerId >= 0.0 && aLayerId <= 5.0) ? (aLayerId * uExplode * 14.0) : 0.0;
    float shiftX = 0.0;
    float shiftY = 0.0;
    if (aTileId >= 0.0 && (uTileCols > 1.0 || uTileRows > 1.0)) {
      float tid = floor(aTileId + 0.5);
      float tc = mod(tid, uTileCols);
      float tr = floor(tid / uTileCols);
      shiftX = (tc - (uTileCols - 1.0) * 0.5) * uTileExplode * 15.0;
      shiftY = (tr - (uTileRows - 1.0) * 0.5) * uTileExplode * 15.0;
    }
    vec3 pos = vec3(aPos.x + shiftX, aPos.y + shiftY, aPos.z + lift);
    vWorldPos = pos;
    vLayerId = aLayerId;
    vec4 clip = uLightMatrix * vec4(pos, 1.0);
    vDepth = clip.z * 0.5 + 0.5;
    gl_Position = clip;
  }
`;

const WEBGL_SHADOW_FS = `
  precision highp float;
  varying float vDepth;
  varying vec3 vWorldPos;
  varying float vLayerId;
  uniform float uTileExplode;
  vec4 packDepth(const in float depth) {
    const vec4 bitShift = vec4(256.0*256.0*256.0, 256.0*256.0, 256.0, 1.0);
    const vec4 bitMask  = vec4(0.0, 1.0/256.0, 1.0/256.0, 1.0/256.0);
    vec4 res = fract(depth * bitShift);
    res -= res.xxyz * bitMask;
    return res;
  }
  void main() {
    int lid = int(vLayerId + 0.5);
    float clipLim = 84.85 + uTileExplode * 32.0;
    if (lid < 6 && (abs(vWorldPos.x) > clipLim || abs(vWorldPos.y) > clipLim)) {
      discard;
    }
    gl_FragColor = packDepth(clamp(vDepth, 0.0, 1.0));
  }
`;

const WEBGL_MAIN_VS = `
  attribute vec3 aPos;
  attribute vec3 aNorm;
  attribute float aLayerId;
  attribute float aBuildingId;
  attribute float aTileId;

  uniform mat4 uProj;
  uniform mat4 uView;
  uniform mat4 uLightMatrix;
  uniform float uExplode;
  uniform float uTileCols;
  uniform float uTileRows;
  uniform float uTileExplode;
  uniform float uSelectedIds[64];
  uniform float uHoveredBuildingId;

  varying vec3 vWorldPos;
  varying vec3 vRawPos;
  varying vec3 vNorm;
  varying float vLayerId;
  varying float vBuildingId;
  varying float vTileId;
  varying vec4 vLightSpacePos;
  varying float vIsSelected;
  varying float vIsHovered;

  void main() {
    float lift = (aLayerId >= 0.0 && aLayerId <= 5.0) ? (aLayerId * uExplode * 14.0) : 0.0;
    float shiftX = 0.0;
    float shiftY = 0.0;
    if (aTileId >= 0.0 && (uTileCols > 1.0 || uTileRows > 1.0)) {
      float tid = floor(aTileId + 0.5);
      float tc = mod(tid, uTileCols);
      float tr = floor(tid / uTileCols);
      shiftX = (tc - (uTileCols - 1.0) * 0.5) * uTileExplode * 15.0;
      shiftY = (tr - (uTileRows - 1.0) * 0.5) * uTileExplode * 15.0;
    }
    vec3 pos = vec3(aPos.x + shiftX, aPos.y + shiftY, aPos.z + lift);
    vRawPos = aPos;
    vWorldPos = pos;
    vNorm = aNorm;
    vLayerId = aLayerId;
    vBuildingId = aBuildingId;
    vTileId = aTileId;
    vLightSpacePos = uLightMatrix * vec4(pos, 1.0);

    float sel = 0.0;
    float hov = 0.0;
    if (aBuildingId > 0.0) {
      for (int i = 0; i < 64; i++) {
        if (uSelectedIds[i] > 0.0 && abs(aBuildingId - uSelectedIds[i]) < 0.2) {
          sel = 1.0;
        }
      }
      if (uHoveredBuildingId > 0.0 && abs(aBuildingId - uHoveredBuildingId) < 0.2) {
        hov = 1.0;
      }
    }
    vIsSelected = sel;
    vIsHovered = hov;

    vec4 clipPos = uProj * uView * vec4(pos, 1.0);
    if (sel > 0.5) {
      clipPos.z -= 0.00035 * clipPos.w;
    } else if (hov > 0.5) {
      clipPos.z -= 0.00025 * clipPos.w;
    } else if (abs(aLayerId - 5.0) < 0.2) {
      clipPos.z -= 0.00018 * clipPos.w;
    }
    gl_Position = clipPos;
  }
`;

const WEBGL_MAIN_FS = `
  precision highp float;

  varying vec3 vWorldPos;
  varying vec3 vRawPos;
  varying vec3 vNorm;
  varying float vLayerId;
  varying float vBuildingId;
  varying float vTileId;
  varying vec4 vLightSpacePos;
  varying float vIsSelected;
  varying float vIsHovered;

  uniform sampler2D uShadowMap;
  uniform vec3 uColorWater;
  uniform vec3 uColorBase;
  uniform vec3 uColorGreenery;
  uniform vec3 uColorRoads;
  uniform vec3 uColorBuildings;
  uniform vec3 uColorHighlighted;
  uniform vec3 uColorFrame;
  uniform vec3 uSunDir;
  uniform vec3 uEyePos;
  uniform float uShowLayerLines;
  uniform float uTileCols;
  uniform float uTileRows;
  uniform float uTileExplode;
  uniform float uActiveTileFilter;
  uniform float uStudioBg;

  float unpackDepth(const in vec4 rgbaDepth) {
    const vec4 bitShift = vec4(1.0/(256.0*256.0*256.0), 1.0/(256.0*256.0), 1.0/256.0, 1.0);
    return dot(rgbaDepth, bitShift);
  }

  float computeShadow(vec4 lightSpacePos, vec3 N, vec3 L) {
    vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
    projCoords = projCoords * 0.5 + 0.5;
    if (projCoords.x < 0.01 || projCoords.x > 0.99 || projCoords.y < 0.01 || projCoords.y > 0.99 || projCoords.z > 0.995) {
      return 1.0;
    }
    float bias = max(0.0025 * (1.0 - max(dot(N, L), 0.0)), 0.0011);
    float currentDepth = projCoords.z - bias;

    float shadow = 0.0;
    float texel = 1.0 / 2048.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        vec2 uv = projCoords.xy + vec2(float(x), float(y)) * texel * 1.4;
        float pcfDepth = unpackDepth(texture2D(uShadowMap, uv));
        shadow += (currentDepth > pcfDepth) ? 0.0 : 1.0;
      }
    }
    return shadow / 9.0;
  }

  void main() {
    int lid = int(vLayerId + 0.5);

    // Hard GPU Clip (expands smoothly when tiles are exploded)
    float clipLim = 84.85 + uTileExplode * 32.0;
    if (lid < 6 && (abs(vWorldPos.x) > clipLim || abs(vWorldPos.y) > clipLim)) {
      discard;
    }

    // Studio Floor Shadow Receiver Plane (lid == 7)
    if (lid == 7) {
      vec3 bgCol = (uStudioBg > 0.5) ? vec3(0.985, 0.986, 0.99) : vec3(0.075, 0.105, 0.165);
      vec2 d = abs(vWorldPos.xy - vec2(-3.0, -4.0)) - vec2(93.8, 93.8);
      float boxDist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      float dropShadow = smoothstep(-4.0, 22.0, boxDist);
      float darkness = (uStudioBg > 0.5) ? (0.76 + 0.24 * dropShadow) : (0.55 + 0.45 * dropShadow);
      gl_FragColor = vec4(bgCol * darkness, 1.0);
      return;
    }

    vec3 baseCol = uColorBuildings;
    if (lid == 0) {
      baseCol = uColorWater;
    } else if (lid == 1) {
      baseCol = uColorBase;
      if (abs(vNorm.z) < 0.45) {
        baseCol *= 0.80;
      }
    } else if (lid == 2) {
      baseCol = uColorGreenery;
      if (vNorm.z < 0.88 && vNorm.z > -0.1) {
        baseCol *= 0.88;
      }
    } else if (lid == 3) {
      baseCol = uColorRoads;
    } else if (lid == 4) {
      baseCol = uColorBuildings;
    } else if (lid == 5) {
      baseCol = uColorHighlighted;
    } else if (lid == 6) {
      baseCol = uColorFrame;
      float miterDist = abs(abs(vWorldPos.x) - abs(vWorldPos.y));
      if (miterDist < 0.40) {
        baseCol *= 0.68;
      }
    }

    if (vIsSelected > 0.5) {
      baseCol = mix(baseCol, vec3(0.98, 0.62, 0.04), 0.78);
    } else if (vIsHovered > 0.5) {
      baseCol = mix(baseCol, vec3(0.18, 0.62, 1.0), 0.62);
    }

    vec3 N = normalize(vNorm);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(uEyePos - vWorldPos);
    vec3 H = normalize(L + V);

    // Double-sided illumination when inspecting the underside hollow vault (N.z < -0.1)
    float diff = max(dot(N, L), 0.0);
    if (N.z < -0.1 && uEyePos.z < 0.0) {
      diff = max(dot(-N, L), 0.35);
      // Highlight recessed hollow vault cavity and 4 perimeter SLA resin drain channels vs z=0 build-plate rim!
      if (vRawPos.z > 0.08) {
        baseCol = mix(baseCol * 0.72, vec3(0.88, 0.72, 0.52), 0.45);
      } else {
        baseCol *= 1.06;
      }
      if (abs(N.z) < 0.92) {
        baseCol *= 0.68;
      }
    }
    float shadow = (N.z < -0.1) ? 0.88 : computeShadow(vLightSpacePos, N, L);

    float sky = 0.5 + 0.5 * abs(N.z);
    float bounce = 0.5 + 0.5 * dot(N.xy, vec2(-L.x, -L.y));

    float heightAo = clamp(0.92 + 0.08 * ((vWorldPos.z - 2.0) / 14.0), 0.88, 1.03);
    if (abs(N.z) < 0.4 && lid >= 4) {
      heightAo *= clamp(0.90 + 0.10 * ((vWorldPos.z - 2.5) / 8.0), 0.88, 1.0);
    }

    float spec = pow(max(dot(N, H), 0.0), 28.0) * (lid == 0 ? 0.16 : 0.05) * shadow;

    float studioIllum = (0.66 + 0.18 * sky + 0.05 * bounce) + (0.30 * diff * (0.35 + 0.65 * shadow));
    studioIllum *= (0.86 + 0.14 * shadow);

    vec3 col = baseCol * studioIllum * heightAo + vec3(spec);

    if (uShowLayerLines > 0.5 && lid != 6) {
      float wave = sin(vWorldPos.z * 14.0) * 0.5 + 0.5;
      col *= (0.98 + 0.02 * wave);
    }

    // Precision multi-tile cut line visualization for Anycubic Photon Mono 4 & FDM multi-tile modes
    if ((uTileCols > 1.0 || uTileRows > 1.0) && lid != 6 && uTileExplode < 0.03) {
      float uX = ((vRawPos.x + 84.6) / 169.2) * uTileCols;
      float uY = ((vRawPos.y + 84.6) / 169.2) * uTileRows;
      float distX = min(fract(uX), 1.0 - fract(uX)) * (169.2 / uTileCols);
      float distY = min(fract(uY), 1.0 - fract(uY)) * (169.2 / uTileRows);
      bool onInnerSeamX = (uX > 0.05 && uX < uTileCols - 0.05 && distX < 0.36);
      bool onInnerSeamY = (uY > 0.05 && uY < uTileRows - 0.05 && distY < 0.36);
      if (onInnerSeamX || onInnerSeamY) {
        col = mix(col * 0.38, vec3(0.05, 0.65, 0.92), 0.55);
      }
    }

    // Highlight active single tile if user selected a specific tile in UI
    if (uActiveTileFilter >= 0.0 && lid != 6) {
      if (abs(vTileId - uActiveTileFilter) > 0.25) {
        col = mix(col * 0.32, vec3(0.12, 0.16, 0.24), 0.45);
      }
    }

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function compileWebGLProgram(gl, vsSrc, fsSrc, label) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    console.error("VS Error (" + label + "):", gl.getShaderInfoLog(vs));
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.error("FS Error (" + label + "):", gl.getShaderInfoLog(fs));
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("Link Error (" + label + "):", gl.getProgramInfoLog(prog));
  }
  return prog;
}

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

function mat4LookAt(eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
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

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
    out[i]      = ai0 * b[0]  + ai1 * b[1]  + ai2 * b[2]  + ai3 * b[3];
    out[i + 4]  = ai0 * b[4]  + ai1 * b[5]  + ai2 * b[6]  + ai3 * b[7];
    out[i + 8]  = ai0 * b[8]  + ai1 * b[9]  + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

function hexToRgbNorm(hex) {
  const c = (hex || '#ffffff').replace('#', '');
  const num = parseInt(c, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

// Exact Möller–Trumbore ray-triangle intersection (after fast AABB broadphase)
function rayTriangleIntersect(ox, oy, oz, dx, dy, dz, v0, v1, v2, liftZ) {
  const v0x = v0[0], v0y = v0[1], v0z = v0[2] + liftZ;
  const v1x = v1[0], v1y = v1[1], v1z = v1[2] + liftZ;
  const v2x = v2[0], v2y = v2[1], v2z = v2[2] + liftZ;

  const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
  const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;

  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -1e-6 && a < 1e-6) return -1;
  const f = 1.0 / a;

  const sx = ox - v0x, sy = oy - v0y, sz = oz - v0z;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0.0 || u > 1.0) return -1;

  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;

  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0.0 || u + v > 1.0) return -1;

  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t > 0.1 ? t : -1;
}
