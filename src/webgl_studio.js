// ============================================================================
// src/webgl_studio.js
// Hardened Studio Photo WebGL Renderer with:
// - 2048x2048 Real Orthographic Shadow Mapping (RGBA Depth Packing + 9-tap PCF)
// - Hard GPU Inner-Frame Clipping (zero protruding geometry outside [-84.85, 84.85])
// - Multi-Selection Support (uSelectedIds[16] for Shift+Click) + Anti-Z-Fighting NDC Bias
// - Exact Möller–Trumbore 3D Ray-Triangle Picking (with AABB broadphase)
// ============================================================================

function createWebGLStudio(canvas3d, state) {
  const gl =
    canvas3d.getContext('webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true }) ||
    canvas3d.getContext('experimental-webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL not supported");

  const camera = {
    yaw: -0.48,
    pitch: 0.50,
    distance: 274,
    target: [2, 5, 3.2]
  };

  const SHADOW_VS = `
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

  const SHADOW_FS = `
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

  const MAIN_VS = `
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
    uniform float uSelectedIds[16];
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
        for (int i = 0; i < 16; i++) {
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

  const MAIN_FS = `
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

      // Double-sided illumination when inspecting the underside hollow vault (N.z < -0.5)
      float diff = max(dot(N, L), 0.0);
      if (N.z < -0.5 && uEyePos.z < 0.0) {
        diff = max(dot(-N, L), 0.35);
      }
      float shadow = (N.z < -0.5) ? 0.85 : computeShadow(vLightSpacePos, N, L);

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

  function compileProgram(vsSrc, fsSrc, label) {
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

  const shadowProg = compileProgram(SHADOW_VS, SHADOW_FS, 'shadow');
  const mainProg = compileProgram(MAIN_VS, MAIN_FS, 'main');

  const SHADOW_RES = 2048;
  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_RES, SHADOW_RES, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const shadowDepthRb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, shadowDepthRb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_RES, SHADOW_RES);

  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowDepthRb);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const glBuffers = {};

  const floorBuf = gl.createBuffer();
  (function initFloor() {
    const R = 360, Z = -1.62;
    const verts = new Float32Array([
      -R, -R, Z, 0, 0, 1, 7, -1, -1,
       R, -R, Z, 0, 0, 1, 7, -1, -1,
       R,  R, Z, 0, 0, 1, 7, -1, -1,
      -R, -R, Z, 0, 0, 1, 7, -1, -1,
       R,  R, Z, 0, 0, 1, 7, -1, -1,
      -R,  R, Z, 0, 0, 1, 7, -1, -1
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, floorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  })();

  function uploadMeshes(layerMeshes) {
    const keys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted', 'frame'];
    keys.forEach(key => {
      const tris = layerMeshes[key] || [];
      const data = new Float32Array(tris.length * 3 * 9);
      let ptr = 0;
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        const pts = [t.v0, t.v1, t.v2];
        const tid = (t.tileId !== undefined) ? t.tileId : 0;
        for (let v = 0; v < 3; v++) {
          data[ptr++] = pts[v][0];
          data[ptr++] = pts[v][1];
          data[ptr++] = pts[v][2];
          data[ptr++] = t.n[0];
          data[ptr++] = t.n[1];
          data[ptr++] = t.n[2];
          data[ptr++] = t.layerId;
          data[ptr++] = t.buildingId;
          data[ptr++] = tid;
        }
      }
      if (!glBuffers[key]) glBuffers[key] = { buf: gl.createBuffer(), count: 0 };
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers[key].buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      glBuffers[key].count = tris.length * 3;
    });
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

  function getCameraEye() {
    const cp = Math.cos(camera.pitch);
    const sp = Math.sin(camera.pitch);
    const cy = Math.cos(camera.yaw);
    const sy = Math.sin(camera.yaw);
    return [
      camera.target[0] + camera.distance * cp * sy,
      camera.target[1] - camera.distance * cp * cy,
      camera.target[2] + camera.distance * sp
    ];
  }

  const selectedIdsBuffer = new Float32Array(16);

  function render() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(canvas3d.clientWidth * dpr);
    const h = Math.floor(canvas3d.clientHeight * dpr);
    if (canvas3d.width !== w || canvas3d.height !== h) {
      canvas3d.width = w;
      canvas3d.height = h;
    }

    const sunRad = state.sunAngleDeg * Math.PI / 180;
    const sunDir = [Math.cos(sunRad) * 0.68, Math.sin(sunRad) * 0.68, 0.73];
    const lightEye = [sunDir[0] * 180, sunDir[1] * 180, sunDir[2] * 180];
    const lightView = mat4LookAt(lightEye, [0, 0, 6], [0, 0, 1]);
    const lightProj = mat4Ortho(-115, 115, -115, 115, 20, 380);
    const lightMatrix = mat4Multiply(lightProj, lightView);

    const drawOrder = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted', 'frame'];
    const stride = 9 * 4;
    const tCols = state.tileCols || 1;
    const tRows = state.tileRows || 1;
    const tExplode = state.tileExplode || 0.0;
    const activeTile = (state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
      ? parseFloat(state.exportTileFilter)
      : -1.0;

    // PASS 1: SHADOW MAP
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.useProgram(shadowProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(shadowProg, 'uLightMatrix'), false, lightMatrix);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uExplode'), state.explodeFactor);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uTileCols'), tCols);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uTileRows'), tRows);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uTileExplode'), tExplode);

    const sLocPos = gl.getAttribLocation(shadowProg, 'aPos');
    const sLocLayer = gl.getAttribLocation(shadowProg, 'aLayerId');
    const sLocTile = gl.getAttribLocation(shadowProg, 'aTileId');
    gl.enableVertexAttribArray(sLocPos);
    gl.enableVertexAttribArray(sLocLayer);
    if (sLocTile >= 0) gl.enableVertexAttribArray(sLocTile);

    drawOrder.forEach(key => {
      if (key === 'frame') {
        if (!state.showFrame || state.explodeFactor > 0.08 || tExplode > 0.03) return;
      } else if (!state.layerVisible[key]) return;
      const b = glBuffers[key];
      if (!b || b.count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.vertexAttribPointer(sLocPos, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(sLocLayer, 1, gl.FLOAT, false, stride, 24);
      if (sLocTile >= 0) gl.vertexAttribPointer(sLocTile, 1, gl.FLOAT, false, stride, 32);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
    });

    // PASS 2: STUDIO CAMERA RENDER
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    if (state.studioBg) {
      gl.clearColor(0.985, 0.986, 0.99, 1.0);
    } else {
      gl.clearColor(0.075, 0.105, 0.165, 1.0);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(mainProg);

    // High-precision depth range (near=25, far=680 gives >11x better depth precision than near=2!)
    const proj = mat4Perspective(34 * Math.PI / 180, (w / h) || 1, 25.0, 680.0);
    const eye = getCameraEye();
    const view = mat4LookAt(eye, camera.target, [0, 0, 1]);

    gl.uniformMatrix4fv(gl.getUniformLocation(mainProg, 'uProj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(mainProg, 'uView'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(mainProg, 'uLightMatrix'), false, lightMatrix);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uExplode'), state.explodeFactor);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uTileCols'), tCols);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uTileRows'), tRows);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uTileExplode'), tExplode);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uActiveTileFilter'), activeTile);
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uEyePos'), eye);
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uSunDir'), sunDir);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(gl.getUniformLocation(mainProg, 'uShadowMap'), 0);

    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorWater'), hexToRgbNorm(state.colors.water));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorBase'), hexToRgbNorm(state.colors.base));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorGreenery'), hexToRgbNorm(state.colors.greenery));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorRoads'), hexToRgbNorm(state.colors.roads));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorBuildings'), hexToRgbNorm(state.colors.buildings));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorHighlighted'), hexToRgbNorm(state.colors.highlighted));

    const frameCol =
      state.frameStyle === 'black' ? [0.13, 0.14, 0.16] :
      state.frameStyle === 'oak' ? [0.74, 0.56, 0.37] :
      state.frameStyle === 'walnut' ? [0.36, 0.24, 0.16] : [0.95, 0.95, 0.96];
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorFrame'), frameCol);

    selectedIdsBuffer.fill(-999.0);
    if (state.userClickedBuilding) {
      if (state.selectedBuildingIds && state.selectedBuildingIds.size > 0) {
        let idx = 0;
        for (const id of state.selectedBuildingIds) {
          if (idx < 16) selectedIdsBuffer[idx++] = id;
        }
      } else if (state.selectedBuildingId) {
        selectedIdsBuffer[0] = state.selectedBuildingId;
      }
    }
    gl.uniform1fv(gl.getUniformLocation(mainProg, 'uSelectedIds[0]'), selectedIdsBuffer);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uHoveredBuildingId'), state.hoveredBuildingId || -999);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uShowLayerLines'), state.showLayerLines ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uStudioBg'), state.studioBg ? 1.0 : 0.0);

    const locPos = gl.getAttribLocation(mainProg, 'aPos');
    const locNorm = gl.getAttribLocation(mainProg, 'aNorm');
    const locLayer = gl.getAttribLocation(mainProg, 'aLayerId');
    const locBld = gl.getAttribLocation(mainProg, 'aBuildingId');
    const locTile = gl.getAttribLocation(mainProg, 'aTileId');

    gl.enableVertexAttribArray(locPos);
    gl.enableVertexAttribArray(locNorm);
    gl.enableVertexAttribArray(locLayer);
    gl.enableVertexAttribArray(locBld);
    if (locTile >= 0) gl.enableVertexAttribArray(locTile);

    if (state.explodeFactor < 0.05 && camera.pitch > 0.05) {
      gl.bindBuffer(gl.ARRAY_BUFFER, floorBuf);
      gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(locLayer, 1, gl.FLOAT, false, stride, 24);
      gl.vertexAttribPointer(locBld, 1, gl.FLOAT, false, stride, 28);
      if (locTile >= 0) gl.vertexAttribPointer(locTile, 1, gl.FLOAT, false, stride, 32);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    drawOrder.forEach(key => {
      if (key === 'frame') {
        if (!state.showFrame || state.explodeFactor > 0.08 || tExplode > 0.03) return;
      } else if (!state.layerVisible[key]) return;
      const b = glBuffers[key];
      if (!b || b.count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(locLayer, 1, gl.FLOAT, false, stride, 24);
      gl.vertexAttribPointer(locBld, 1, gl.FLOAT, false, stride, 28);
      if (locTile >= 0) gl.vertexAttribPointer(locTile, 1, gl.FLOAT, false, stride, 32);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
    });

    gl.disableVertexAttribArray(locNorm);
    gl.disableVertexAttribArray(locBld);
    if (locTile >= 0) gl.disableVertexAttribArray(locTile);
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

  function pickBuilding(clientX, clientY, buildingBounds) {
    const rect = canvas3d.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const eye = getCameraEye();

    let fx = camera.target[0] - eye[0];
    let fy = camera.target[1] - eye[1];
    let fz = camera.target[2] - eye[2];
    const flen = Math.hypot(fx, fy, fz) || 1;
    fx /= flen; fy /= flen; fz /= flen;

    let rx = fy, ry = -fx, rz = 0;
    const rlen = Math.hypot(rx, ry, rz) || 1;
    rx /= rlen; ry /= rlen;

    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const tanHalfFov = Math.tan(17 * Math.PI / 180);
    const aspect = (rect.width / rect.height) || 1;

    let dx = fx + rx * (nx * aspect * tanHalfFov) + ux * (ny * tanHalfFov);
    let dy = fy + ry * (nx * aspect * tanHalfFov) + uy * (ny * tanHalfFov);
    let dz = fz + rz * (nx * aspect * tanHalfFov) + uz * (ny * tanHalfFov);
    const dlen = Math.hypot(dx, dy, dz) || 1;
    dx /= dlen; dy /= dlen; dz /= dlen;

    // 1. Broadphase AABB candidate set
    const candidateIds = new Set();
    const bldById = new Map();
    for (let i = 0; i < buildingBounds.length; i++) {
      const bb = buildingBounds[i];
      const lift = bb.layerId * state.explodeFactor * 14.0;
      const minZ = bb.minZ + lift;
      const maxZ = bb.maxZ + lift;

      const tx1 = (bb.minX - eye[0]) / (dx || 1e-9);
      const tx2 = (bb.maxX - eye[0]) / (dx || 1e-9);
      let tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);

      const ty1 = (bb.minY - eye[1]) / (dy || 1e-9);
      const ty2 = (bb.maxY - eye[1]) / (dy || 1e-9);
      tmin = Math.max(tmin, Math.min(ty1, ty2));
      tmax = Math.min(tmax, Math.max(ty1, ty2));

      const tz1 = (minZ - eye[2]) / (dz || 1e-9);
      const tz2 = (maxZ - eye[2]) / (dz || 1e-9);
      tmin = Math.max(tmin, Math.min(tz1, tz2));
      tmax = Math.min(tmax, Math.max(tz1, tz2));

      if (tmax >= Math.max(0, tmin)) {
        const gid = bb.groupId || bb.building.id;
        candidateIds.add(gid);
        if (!bldById.has(gid)) bldById.set(gid, bb.building);
      }
    }

    if (candidateIds.size === 0) return null;

    // 2. Narrowphase exact triangle hit test on candidate buildings
    let bestId = -1;
    let bestT = Infinity;
    const lists = [state.layerMeshes.buildings || [], state.layerMeshes.highlighted || []];
    for (let l = 0; l < lists.length; l++) {
      const tris = lists[l];
      for (let i = 0; i < tris.length; i++) {
        const tri = tris[i];
        if (!candidateIds.has(tri.buildingId)) continue;
        const liftZ = tri.layerId * state.explodeFactor * 14.0;
        const t = rayTriangleIntersect(eye[0], eye[1], eye[2], dx, dy, dz, tri.v0, tri.v1, tri.v2, liftZ);
        if (t > 0 && t < bestT) {
          bestT = t;
          bestId = tri.buildingId;
        }
      }
    }

    return bestId > 0 ? (bldById.get(bestId) || null) : null;
  }

  return { camera, uploadMeshes, render, pickBuilding };
}
