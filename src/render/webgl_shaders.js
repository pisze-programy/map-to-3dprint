// ============================================================================
// src/render/webgl_shaders.js
// High-Precision GLSL Shadow & Studio Photo Shaders (RGBA 2048x2048 PCF Shadow Map,
// Exact 16-bit PickID Highlighting, Underside Vault Inspection, Zero Seam Stripes)
// ============================================================================

const WEBGL_SHADOW_VS = `
  precision highp float;
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
  varying vec3 vRawPos;
  varying float vLayerId;
  varying float vTileId;
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
    vLayerId = aLayerId;
    vTileId = aTileId;
    vec4 clip = uLightMatrix * vec4(pos, 1.0);
    vDepth = clip.z * 0.5 + 0.5;
    gl_Position = clip;
  }
`;

const WEBGL_SHADOW_FS = `
  precision highp float;
  varying float vDepth;
  varying vec3 vWorldPos;
  varying vec3 vRawPos;
  varying float vLayerId;
  varying float vTileId;
  uniform float uTileCols;
  uniform float uTileRows;
  uniform float uTileExplode;
  uniform float uHalfW;
  uniform float uHalfH;
  vec4 packDepth(const in float depth) {
    const vec4 bitShift = vec4(256.0*256.0*256.0, 256.0*256.0, 256.0, 1.0);
    const vec4 bitMask  = vec4(0.0, 1.0/256.0, 1.0/256.0, 1.0/256.0);
    vec4 res = fract(depth * bitShift);
    res -= res.xxyz * bitMask;
    return res;
  }
  void main() {
    int lid = int(vLayerId + 0.5);
    if (lid < 6 && (abs(vRawPos.x) > uHalfW + 0.25 || abs(vRawPos.y) > uHalfH + 0.25)) {
      discard;
    }
    if (lid < 6 && vTileId >= 0.0 && (uTileCols > 1.0 || uTileRows > 1.0) && uTileExplode > 0.001) {
      float tid = floor(vTileId + 0.5);
      float tc = mod(tid, uTileCols);
      float tr = floor(tid / uTileCols);
      float stepX = (2.0 * uHalfW) / uTileCols;
      float stepY = (2.0 * uHalfH) / uTileRows;
      if (vRawPos.x < -uHalfW + tc * stepX - 0.015 || vRawPos.x > -uHalfW + (tc + 1.0) * stepX + 0.015 ||
          vRawPos.y < -uHalfH + tr * stepY - 0.015 || vRawPos.y > -uHalfH + (tr + 1.0) * stepY + 0.015) {
        discard;
      }
    }
    gl_FragColor = packDepth(clamp(vDepth, 0.0, 1.0));
  }
`;

const WEBGL_MAIN_VS = `
  precision highp float;
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
    if (aBuildingId > 0.5) {
      for (int i = 0; i < 64; i++) {
        if (uSelectedIds[i] > 0.5 && abs(aBuildingId - uSelectedIds[i]) < 0.25) {
          sel = 1.0;
        }
      }
      if (uHoveredBuildingId > 0.5 && abs(aBuildingId - uHoveredBuildingId) < 0.25) {
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
  uniform vec3 uColorTrees;
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
  uniform float uHalfW;
  uniform float uHalfH;

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
    float bias = max(0.0024 * (1.0 - max(dot(N, L), 0.0)), 0.0010);
    float currentDepth = projCoords.z - bias;

    float shadow = 0.0;
    float texel = 1.0 / 2048.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        vec2 uv = projCoords.xy + vec2(float(x), float(y)) * texel * 1.35;
        float pcfDepth = unpackDepth(texture2D(uShadowMap, uv));
        shadow += (currentDepth > pcfDepth) ? 0.0 : 1.0;
      }
    }
    return shadow / 9.0;
  }

  void main() {
    int lid = int(vLayerId + 0.5);

    if (lid < 6 && (abs(vRawPos.x) > uHalfW + 0.25 || abs(vRawPos.y) > uHalfH + 0.25)) {
      discard;
    }
    if (lid < 6 && vTileId >= 0.0 && (uTileCols > 1.0 || uTileRows > 1.0) && uTileExplode > 0.001) {
      float tid = floor(vTileId + 0.5);
      float tc = mod(tid, uTileCols);
      float tr = floor(tid / uTileCols);
      float stepX = (2.0 * uHalfW) / uTileCols;
      float stepY = (2.0 * uHalfH) / uTileRows;
      if (vRawPos.x < -uHalfW + tc * stepX - 0.015 || vRawPos.x > -uHalfW + (tc + 1.0) * stepX + 0.015 ||
          vRawPos.y < -uHalfH + tr * stepY - 0.015 || vRawPos.y > -uHalfH + (tr + 1.0) * stepY + 0.015) {
        discard;
      }
    }

    if (lid == 7) {
      vec3 bgCol = (uStudioBg > 0.5) ? vec3(0.985, 0.986, 0.99) : vec3(0.075, 0.105, 0.165);
      vec2 d = abs(vWorldPos.xy - vec2(-3.0, -4.0)) - vec2(uHalfW + 9.2, uHalfH + 9.2);
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
        baseCol *= 0.82;
      }
    } else if (lid == 2) {
      if (vNorm.z > 0.04 && vNorm.z < 0.98) {
        baseCol = uColorTrees * 0.92;
      } else {
        baseCol = uColorGreenery;
        if (vNorm.z < 0.88 && vNorm.z > -0.1) {
          baseCol *= 0.88;
        }
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

    float diff = max(dot(N, L), 0.0);
    if (N.z < -0.1 && uEyePos.z < 0.0) {
      diff = max(dot(-N, L), 0.35);
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

    if (uActiveTileFilter >= 0.0 && lid != 6) {
      if (abs(vTileId - uActiveTileFilter) > 0.25) {
        col = mix(col * 0.32, vec3(0.12, 0.16, 0.24), 0.45);
      }
    }

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WEBGL_SHADOW_VS,
    WEBGL_SHADOW_FS,
    WEBGL_MAIN_VS,
    WEBGL_MAIN_FS
  };
}
