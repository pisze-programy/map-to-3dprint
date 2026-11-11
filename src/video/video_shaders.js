// ============================================================================
// src/video/video_shaders.js
// Vertex Deformation & 2048x2048 Orthographic Shadow Map Shaders for the
// Browser Video Preview & Framed Order Demo Studio Module.
// ============================================================================

const VIDEO_VERTEX_TRANSFORM_GLSL = `
  uniform vec3 uModelOffset;
  uniform float uLayerExtrude0;
  uniform float uLayerExtrude1;
  uniform float uLayerExtrude2;
  uniform float uLayerExtrude3;
  uniform float uLayerExtrude4;
  uniform float uLayerExtrude5;
  uniform float uWaveMode;
  uniform float uWaveProgress;
  uniform float uExplodeZ;
  uniform float uTileCols;
  uniform float uTileRows;
  uniform float uTileExplode;
  uniform float uFrameAssemble;
  uniform float uFrameAnimMode;
  uniform float uGlassDrop;

  float getLayerExtrudeFactor(int lid) {
    if (lid == 0) return uLayerExtrude0;
    if (lid == 1) return uLayerExtrude1;
    if (lid == 2) return uLayerExtrude2;
    if (lid == 3) return uLayerExtrude3;
    if (lid == 4) return uLayerExtrude4;
    if (lid == 5) return uLayerExtrude5;
    return 1.0;
  }

  vec3 computeAnimatedVertex(vec3 rawPos, vec4 meta, out float outWaveFront, out float outLocalExt) {
    int lid = int(meta.x + 0.5);
    float groundZ = meta.y;
    float subId = meta.z;
    outWaveFront = 0.0;
    outLocalExt = 1.0;

    vec3 p = rawPos;

    if (lid >= 0 && lid <= 5) {
      float baseExt = getLayerExtrudeFactor(lid);
      float waveExt = 1.0;
      if (uWaveMode > 0.5 && uWaveMode < 1.5) {
        // 1: Diagonal Laser Scan Wave across (x - y)
        float coord = clamp((rawPos.x - rawPos.y + 175.0) / 350.0, 0.0, 1.0);
        float diff = uWaveProgress * 1.28 - coord;
        waveExt = smoothstep(-0.02, 0.16, diff);
        outWaveFront = exp(-pow((diff - 0.04) / 0.035, 2.0));
      } else if (uWaveMode >= 1.5 && uWaveMode < 2.5) {
        // 2: Radial Ripple from Center Landmark
        float rNorm = clamp(length(rawPos.xy) / 125.0, 0.0, 1.0);
        float diff = uWaveProgress * 1.28 - rNorm;
        waveExt = smoothstep(-0.02, 0.18, diff);
        outWaveFront = exp(-pow((diff - 0.04) / 0.038, 2.0));
      } else if (uWaveMode >= 2.5) {
        // 3: Vertical Z-Slicer Print Head
        float maxPrintZ = uWaveProgress * 36.0;
        waveExt = clamp(uWaveProgress * 1.35, 0.0, 1.0);
        float topClamp = max(groundZ, min(rawPos.z, maxPrintZ));
        p.z = mix(groundZ, topClamp, baseExt);
        outWaveFront = exp(-pow((rawPos.z - maxPrintZ) / 0.85, 2.0)) * step(0.02, uWaveProgress) * step(uWaveProgress, 0.98);
        outLocalExt = baseExt * waveExt;
      }

      if (uWaveMode < 2.5) {
        float finalExt = clamp(baseExt * waveExt, 0.0, 1.0);
        outLocalExt = finalExt;
        p.z = mix(groundZ, rawPos.z, finalExt);
      }

      p.z += float(lid) * uExplodeZ * 13.5;

      if (subId >= 0.0 && (uTileCols > 1.0 || uTileRows > 1.0) && uTileExplode > 0.001) {
        float tid = floor(subId + 0.5);
        float tc = mod(tid, uTileCols);
        float tr = floor(tid / uTileCols);
        p.x += (tc - (uTileCols - 1.0) * 0.5) * uTileExplode * 16.0;
        p.y += (tr - (uTileRows - 1.0) * 0.5) * uTileExplode * 16.0;
      }
    } else if (lid == 6) {
      // Mitered 4-Rail Product Frame (subId 0=South, 1=East, 2=North, 3=West)
      float invF = 1.0 - clamp(uFrameAssemble, 0.0, 1.0);
      if (uFrameAnimMode > 0.5) {
        int rail = int(subId + 0.5);
        float slide = invF * invF * 48.0;
        if (rail == 0) p.y -= slide;
        else if (rail == 1) p.x += slide;
        else if (rail == 2) p.y += slide;
        else if (rail == 3) p.x -= slide;
        p.z -= invF * 4.0;
      } else {
        p.z -= invF * invF * 26.0;
      }
    } else if (lid == 8 || lid == 9) {
      float invF = 1.0 - clamp(uFrameAssemble, 0.0, 1.0);
      p.z -= invF * invF * 20.0;
    } else if (lid == 10) {
      float invG = 1.0 - clamp(uGlassDrop, 0.0, 1.0);
      p.z += invG * invG * 30.0;
    }

    return p + uModelOffset;
  }
`;

const VIDEO_SHADOW_VS = `
  attribute vec3 aPos;
  attribute vec4 aMeta;
  uniform mat4 uLightMatrix;
  ${VIDEO_VERTEX_TRANSFORM_GLSL}
  varying float vDepth;
  varying vec3 vLocalPos;
  varying float vLayerId;
  void main() {
    float wf = 0.0;
    float le = 1.0;
    vec3 worldPos = computeAnimatedVertex(aPos, aMeta, wf, le);
    vLocalPos = worldPos - uModelOffset;
    vLayerId = aMeta.x;
    vec4 clip = uLightMatrix * vec4(worldPos, 1.0);
    vDepth = clip.z * 0.5 + 0.5;
    gl_Position = clip;
  }
`;

const VIDEO_SHADOW_FS = `
  precision highp float;
  varying float vDepth;
  varying vec3 vLocalPos;
  varying float vLayerId;
  uniform float uHalfW;
  uniform float uHalfH;
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
    float limX = uHalfW + 0.3 + uTileExplode * 34.0;
    float limY = uHalfH + 0.3 + uTileExplode * 34.0;
    if (lid <= 5 && (abs(vLocalPos.x) > limX || abs(vLocalPos.y) > limY)) {
      discard;
    }
    if (lid == 7 || lid == 9 || lid == 10) {
      discard;
    }
    gl_FragColor = packDepth(clamp(vDepth, 0.0, 1.0));
  }
`;

const VIDEO_MAIN_VS = `
  attribute vec3 aPos;
  attribute vec3 aNorm;
  attribute vec3 aBary;
  attribute vec4 aMeta;

  uniform mat4 uProj;
  uniform mat4 uView;
  uniform mat4 uLightMatrix;
  ${VIDEO_VERTEX_TRANSFORM_GLSL}

  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying vec3 vRawPos;
  varying vec3 vNorm;
  varying vec3 vBary;
  varying float vLayerId;
  varying float vSubId;
  varying float vWaveFront;
  varying float vLocalExt;
  varying vec4 vLightSpacePos;

  void main() {
    float wf = 0.0;
    float le = 1.0;
    vec3 worldPos = computeAnimatedVertex(aPos, aMeta, wf, le);
    vWorldPos = worldPos;
    vLocalPos = worldPos - uModelOffset;
    vRawPos = aPos;
    vNorm = aNorm;
    vBary = aBary;
    vLayerId = aMeta.x;
    vSubId = aMeta.z;
    vWaveFront = wf;
    vLocalExt = le;
    vLightSpacePos = uLightMatrix * vec4(worldPos, 1.0);

    vec4 clipPos = uProj * uView * vec4(worldPos, 1.0);
    if (abs(aMeta.x - 5.0) < 0.2) {
      clipPos.z -= 0.00022 * clipPos.w;
    } else if (abs(aMeta.x - 9.0) < 0.2) {
      clipPos.z -= 0.00035 * clipPos.w;
    }
    gl_Position = clipPos;
  }
`;
