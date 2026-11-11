// ============================================================================
// src/video/video_shader_main_fs.js
// Cinema Fragment Shader: 2048x2048 PCF Shadows, Cyclorama Drop-Shadow Floor,
// Swept Acrylic Glass, Engraved Plaque Texture & CAD Blueprint <-> Studio Pass.
// ============================================================================

function buildVideoMainFS(hasDerivatives) {
  const extHeader = hasDerivatives ? '#extension GL_OES_standard_derivatives : enable\n' : '';
  const edgeCalc = hasDerivatives
    ? `
      vec3 dB = fwidth(vBary);
      vec3 a3 = smoothstep(vec3(0.0), dB * 1.35, vBary);
      float edgeMask = 1.0 - min(min(a3.x, a3.y), a3.z);
    `
    : `
      float minB = min(vBary.x, min(vBary.y, vBary.z));
      float edgeMask = 1.0 - smoothstep(0.004, 0.055, minB);
    `;

  return `${extHeader}
    precision highp float;

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

    uniform sampler2D uShadowMap;
    uniform sampler2D uPlaqueTex;
    uniform vec3 uColorWater;
    uniform vec3 uColorBase;
    uniform vec3 uColorGreenery;
    uniform vec3 uColorRoads;
    uniform vec3 uColorBuildings;
    uniform vec3 uColorHighlighted;
    uniform vec3 uColorFrame;
    uniform vec3 uColorMat;
    uniform vec3 uColorBacking;
    uniform vec3 uBgDark;
    uniform vec3 uBgLight;

    uniform vec3 uSunDir;
    uniform vec3 uEyePos;
    uniform float uHalfW;
    uniform float uHalfH;
    uniform float uOuterFrameW;
    uniform float uOuterFrameHBot;
    uniform float uOuterFrameHTop;
    uniform vec4 uPlaqueBounds;

    uniform float uWireMix;
    uniform float uBgMix;
    uniform float uFrameAssemble;
    uniform float uTileExplode;
    uniform float uElementAlpha;
    uniform float uGlassSweep;

    float unpackDepth(const in vec4 rgbaDepth) {
      const vec4 bitShift = vec4(1.0/(256.0*256.0*256.0), 1.0/(256.0*256.0), 1.0/256.0, 1.0);
      return dot(rgbaDepth, bitShift);
    }

    float computeShadow(vec4 lightSpacePos, vec3 N, vec3 L) {
      vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
      projCoords = projCoords * 0.5 + 0.5;
      if (projCoords.x < 0.005 || projCoords.x > 0.995 || projCoords.y < 0.005 || projCoords.y > 0.995 || projCoords.z > 0.996) {
        return 1.0;
      }
      float bias = max(0.0022 * (1.0 - max(dot(N, L), 0.0)), 0.0009);
      float currentDepth = projCoords.z - bias;
      float shadow = 0.0;
      float texel = 1.0 / 2048.0;
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          vec2 uv = projCoords.xy + vec2(float(x), float(y)) * texel * 1.45;
          float pcfDepth = unpackDepth(texture2D(uShadowMap, uv));
          shadow += (currentDepth > pcfDepth) ? 0.0 : 1.0;
        }
      }
      return shadow / 9.0;
    }

    void main() {
      int lid = int(vLayerId + 0.5);

      float limX = uHalfW + 0.25 + uTileExplode * 34.0;
      float limY = uHalfH + 0.25 + uTileExplode * 34.0;
      if (lid <= 5 && (abs(vLocalPos.x) > limX || abs(vLocalPos.y) > limY)) {
        discard;
      }

      // Studio Cyclorama Shadow-Catcher Floor (lid == 7)
      if (lid == 7) {
        vec3 bgBase = mix(uBgDark, uBgLight, uBgMix);
        vec2 boxCenter = vec2(0.0, 0.5 * (uOuterFrameHTop - uOuterFrameHBot));
        vec2 boxHalf = vec2(uOuterFrameW, 0.5 * (uOuterFrameHTop + uOuterFrameHBot));
        vec2 shifted = vLocalPos.xy - boxCenter - vec2(-uSunDir.x * 7.5, -uSunDir.y * 7.5);
        vec2 d = abs(shifted) - boxHalf;
        float boxDist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
        float softDrop = smoothstep(-6.0, 28.0, boxDist);
        float shadowStrength = 0.24 * uBgMix * clamp(uFrameAssemble * 1.2, 0.15, 1.0);
        vec3 floorCol = bgBase * (1.0 - shadowStrength * (1.0 - softDrop));
        gl_FragColor = vec4(floorCol, 1.0);
        return;
      }

      // Acrylic Museum Glass Cover (lid == 10)
      if (lid == 10) {
        float diag = (vLocalPos.x - vLocalPos.y) / max(1.0, (uOuterFrameW + uOuterFrameHTop));
        float band1 = exp(-pow((diag - uGlassSweep) / 0.14, 2.0));
        float band2 = exp(-pow((diag - (uGlassSweep - 0.22)) / 0.055, 2.0)) * 0.65;
        vec3 N = vec3(0.0, 0.0, 1.0);
        vec3 V = normalize(uEyePos - vWorldPos);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        float alpha = clamp(0.035 + 0.11 * fresnel + (band1 * 0.34 + band2 * 0.24), 0.0, 0.58) * (1.0 - uWireMix * 0.75);
        vec3 glassCol = mix(vec3(0.88, 0.94, 1.0), vec3(1.0, 1.0, 1.0), clamp(band1 + band2, 0.0, 1.0));
        gl_FragColor = vec4(glassCol, alpha);
        return;
      }

      // Engraved Plaque / Gallery Typography Quad (lid == 9)
      if (lid == 9) {
        float u = clamp((vLocalPos.x - uPlaqueBounds.x) / max(0.1, uPlaqueBounds.z - uPlaqueBounds.x), 0.0, 1.0);
        float v = clamp((uPlaqueBounds.w - vLocalPos.y) / max(0.1, uPlaqueBounds.w - uPlaqueBounds.y), 0.0, 1.0);
        vec4 tex = texture2D(uPlaqueTex, vec2(u, v));
        if (tex.a < 0.02) discard;
        vec3 plaqueStudio = tex.rgb;
        vec3 plaqueCad = mix(vec3(0.05, 0.07, 0.10), vec3(0.85, 0.92, 1.0), tex.a);
        vec3 finalPlaque = mix(plaqueStudio, plaqueCad, uWireMix);
        gl_FragColor = vec4(finalPlaque, tex.a * clamp(uFrameAssemble * 1.4, 0.0, 1.0));
        return;
      }

      ${edgeCalc}

      vec3 baseCol = uColorBuildings;
      float cadEdgeGain = 0.85;
      vec3 cadTint = vec3(0.90, 0.94, 1.0);

      if (lid == 0) {
        baseCol = uColorWater;
        cadEdgeGain = 0.42;
        cadTint = vec3(0.38, 0.68, 0.95);
      } else if (lid == 1) {
        baseCol = uColorBase;
        if (abs(vNorm.z) < 0.45) baseCol *= 0.82;
        cadEdgeGain = 0.48;
        cadTint = vec3(0.58, 0.64, 0.74);
      } else if (lid == 2) {
        baseCol = uColorGreenery;
        if (vNorm.z < 0.88) baseCol *= 0.88;
        cadEdgeGain = 0.55;
        cadTint = vec3(0.45, 0.82, 0.62);
      } else if (lid == 3) {
        baseCol = uColorRoads;
        cadEdgeGain = 0.66;
        cadTint = vec3(0.68, 0.73, 0.82);
      } else if (lid == 4) {
        baseCol = uColorBuildings;
        cadEdgeGain = 0.96;
        cadTint = vec3(0.96, 0.98, 1.0);
      } else if (lid == 5) {
        baseCol = uColorHighlighted;
        cadEdgeGain = 1.0;
        cadTint = vec3(1.0, 0.78, 0.28);
      } else if (lid == 6) {
        baseCol = uColorFrame;
        float cornerCheck = abs((abs(vLocalPos.x) - uHalfW) - (abs(vLocalPos.y) - uHalfH));
        if (cornerCheck < 0.42 && vLocalPos.y > -uHalfH - 8.0) {
          baseCol *= 0.74;
        }
        cadEdgeGain = 0.78;
        cadTint = vec3(0.75, 0.80, 0.88);
      } else if (lid == 8) {
        baseCol = (vSubId > 0.5) ? uColorMat : uColorBacking;
        cadEdgeGain = (vSubId > 0.5) ? 0.55 : 0.18;
        cadTint = vec3(0.45, 0.50, 0.58);
      }

      vec3 N = normalize(vNorm);
      vec3 L = normalize(uSunDir);
      vec3 V = normalize(uEyePos - vWorldPos);
      vec3 H = normalize(L + V);

      float diff = max(dot(N, L), 0.0);
      float shadow = computeShadow(vLightSpacePos, N, L);
      float sky = 0.5 + 0.5 * N.z;
      float bounce = 0.5 + 0.5 * dot(N.xy, vec2(-L.x, -L.y));

      float heightAo = clamp(0.86 + 0.14 * ((vLocalPos.z - 2.0) / 14.0), 0.82, 1.03);
      if (abs(N.z) < 0.45 && (lid == 4 || lid == 5)) {
        heightAo *= clamp(0.84 + 0.16 * ((vLocalPos.z - 2.4) / 9.5), 0.82, 1.0);
      }

      float specPower = (lid == 0) ? 36.0 : (lid == 6 ? 24.0 : 18.0);
      float specGain = (lid == 0) ? 0.18 : (lid == 6 ? 0.10 : 0.04);
      float spec = pow(max(dot(N, H), 0.0), specPower) * specGain * shadow;

      float studioIllum = (0.62 + 0.20 * sky + 0.06 * bounce) + (0.34 * diff * (0.28 + 0.72 * shadow));
      studioIllum *= (0.84 + 0.16 * shadow);
      vec3 studioCol = baseCol * studioIllum * heightAo + vec3(spec);

      if (lid == 5) {
        studioCol = mix(studioCol, studioCol * 1.12, edgeMask * 0.25);
      }

      vec3 cadFace = vec3(0.025, 0.032, 0.048) + 0.035 * diff * cadTint;
      if (lid == 0) {
        cadFace = vec3(0.015, 0.028, 0.052);
      }
      vec3 cadCol = mix(cadFace, cadTint, clamp(edgeMask * cadEdgeGain, 0.0, 1.0));

      vec3 finalCol = mix(studioCol, cadCol, clamp(uWireMix, 0.0, 1.0));

      if (vWaveFront > 0.01 && lid <= 5) {
        vec3 glowCol = mix(vec3(0.18, 0.68, 1.0), vec3(1.0, 0.72, 0.20), float(lid == 5));
        finalCol += glowCol * vWaveFront * (0.55 + 0.45 * edgeMask);
      }

      if (uElementAlpha < 0.99) {
        vec3 ghostCol = mix(vec3(0.88, 0.90, 0.93), vec3(0.14, 0.18, 0.26), uWireMix);
        finalCol = mix(ghostCol, cadTint, edgeMask * 0.45 * uWireMix);
      }

      gl_FragColor = vec4(clamp(finalCol, 0.0, 1.0), uElementAlpha);
    }
  `;
}
