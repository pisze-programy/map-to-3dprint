// ============================================================================
// src/render/webgl_studio.js
// Studio Photo WebGL Renderer with:
// - 2048x2048 Orthographic Shadow Mapping (RGBA Depth Packing + 9-tap PCF)
// - Compact 16-bit PickID Selection & Hover (Zero Float32 OSM-ID Collisions!)
// - Exact Möller–Trumbore 3D Ray-Triangle Picking (Supporting Multi-Tile Explode)
// ============================================================================

if (typeof mat4Perspective === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./webgl_math.js'));
}

function createWebGLStudio(canvas3d, state) {
  const gl =
    canvas3d.getContext('webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true }) ||
    canvas3d.getContext('experimental-webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL not supported');

  const camera = {
    yaw: -0.48,
    pitch: 0.50,
    distance: 274,
    target: [2, 5, 3.2]
  };

  const shadowProg = compileWebGLProgram(gl, WEBGL_SHADOW_VS, WEBGL_SHADOW_FS, 'shadow');
  const mainProg = compileWebGLProgram(gl, WEBGL_MAIN_VS, WEBGL_MAIN_FS, 'main');
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
  let meshUploadVersion = 0;
  let shadowUploadVersion = 0;
  let lastRenderSig = '';
  let lastShadowSig = '';
  let activeGenerationId = 0;

  function setGenerationId(id) {
    activeGenerationId = id;
  }

  function getActiveGenerationId() {
    return activeGenerationId;
  }

  function clearMeshes() {
    const keys = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted', 'frame'];
    keys.forEach(key => {
      const entry = glBuffers[key];
      if (entry) {
        if (entry.chunks && entry.chunks.length > 0) {
          entry.chunks.forEach(c => {
            if (c.buf) gl.deleteBuffer(c.buf);
          });
          entry.chunks = [];
        }
        entry.floatChunks = [];
        if (entry.buf) {
          entry.count = 0;
        }
      }
    });
    if (state && state.layerMeshes) {
      keys.forEach(k => {
        state.layerMeshes[k] = [];
      });
    }
    meshUploadVersion++;
    shadowUploadVersion++;
    lastRenderSig = '';
    render(true);
  }

  function decodeStride9ToTriangles(floatData) {
    const triCount = Math.floor(floatData.length / 27);
    const tris = new Array(triCount);
    for (let i = 0; i < triCount; i++) {
      const o = i * 27;
      tris[i] = {
        v0: [floatData[o], floatData[o + 1], floatData[o + 2]],
        v1: [floatData[o + 9], floatData[o + 10], floatData[o + 11]],
        v2: [floatData[o + 18], floatData[o + 19], floatData[o + 20]],
        n: [floatData[o + 3], floatData[o + 4], floatData[o + 5]],
        layerId: floatData[o + 6],
        buildingId: floatData[o + 7],
        tileId: floatData[o + 8]
      };
    }
    return tris;
  }

  function uploadLayerMesh(layerName, meshData, options = {}) {
    if (options.generationId !== undefined && options.generationId !== activeGenerationId) {
      return;
    }

    let floatData = null;
    let triCount = 0;
    if (meshData instanceof Float32Array) {
      floatData = meshData;
      triCount = Math.floor(floatData.length / 27);
    } else if (Array.isArray(meshData)) {
      triCount = meshData.length;
      floatData = new Float32Array(triCount * 3 * 9);
      let ptr = 0;
      for (let i = 0; i < triCount; i++) {
        const t = meshData[i];
        const pts = [t.v0, t.v1, t.v2];
        const tid = (t.tileId !== undefined) ? t.tileId : 0;
        for (let v = 0; v < 3; v++) {
          floatData[ptr++] = pts[v][0];
          floatData[ptr++] = pts[v][1];
          floatData[ptr++] = pts[v][2];
          floatData[ptr++] = t.n[0];
          floatData[ptr++] = t.n[1];
          floatData[ptr++] = t.n[2];
          floatData[ptr++] = t.layerId;
          floatData[ptr++] = t.buildingId;
          floatData[ptr++] = tid;
        }
      }
    } else {
      return;
    }

    if (!glBuffers[layerName]) {
      glBuffers[layerName] = { buf: gl.createBuffer(), count: 0, chunks: [], floatChunks: [] };
    }
    const entry = glBuffers[layerName];
    if (!entry.floatChunks) entry.floatChunks = [];

    if (options.append) {
      if (!entry.chunks) entry.chunks = [];
      if (entry.count > 0 && entry.buf && entry.chunks.length === 0) {
        entry.chunks.push({ buf: entry.buf, count: entry.count });
        entry.buf = null;
        entry.count = 0;
      }
      const chunkBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, chunkBuf);
      gl.bufferData(gl.ARRAY_BUFFER, floatData, gl.STATIC_DRAW);
      entry.chunks.push({ buf: chunkBuf, count: triCount * 3 });
      entry.floatChunks.push(floatData);
    } else {
      if (entry.chunks && entry.chunks.length > 0) {
        entry.chunks.forEach(c => {
          if (c.buf) gl.deleteBuffer(c.buf);
        });
        entry.chunks = [];
      }
      if (!entry.buf) entry.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buf);
      gl.bufferData(gl.ARRAY_BUFFER, floatData, gl.STATIC_DRAW);
      entry.count = triCount * 3;
      entry.floatChunks = [floatData];
    }

    if (state && state.layerMeshes) {
      const trisToStore = Array.isArray(meshData) ? meshData : decodeStride9ToTriangles(floatData);
      if (!options.append) {
        state.layerMeshes[layerName] = trisToStore.slice();
      } else {
        if (!state.layerMeshes[layerName]) state.layerMeshes[layerName] = [];
        for (let i = 0; i < trisToStore.length; i++) {
          state.layerMeshes[layerName].push(trisToStore[i]);
        }
      }
    }

    meshUploadVersion++;
    if (!options.deferShadow) shadowUploadVersion++;
    lastRenderSig = '';
    if (options.renderImmediately !== false) {
      render(true);
    }
  }

  function consolidateLayer(layerName) {
    const entry = glBuffers[layerName];
    if (!entry || !entry.chunks || entry.chunks.length === 0) return;
    if (entry.chunks.length === 1) {
      if (entry.buf && entry.buf !== entry.chunks[0].buf) {
        gl.deleteBuffer(entry.buf);
      }
      entry.buf = entry.chunks[0].buf;
      entry.count = entry.chunks[0].count;
      entry.chunks = [];
      shadowUploadVersion++;
      lastRenderSig = '';
      return;
    }
    if (entry.floatChunks && entry.floatChunks.length === entry.chunks.length) {
      let totalFloats = 0;
      for (let i = 0; i < entry.floatChunks.length; i++) totalFloats += entry.floatChunks[i].length;
      const merged = new Float32Array(totalFloats);
      let off = 0;
      for (let i = 0; i < entry.floatChunks.length; i++) {
        merged.set(entry.floatChunks[i], off);
        off += entry.floatChunks[i].length;
      }
      entry.chunks.forEach(c => {
        if (c.buf) gl.deleteBuffer(c.buf);
      });
      entry.chunks = [];
      if (!entry.buf) entry.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buf);
      gl.bufferData(gl.ARRAY_BUFFER, merged, gl.STATIC_DRAW);
      entry.count = Math.floor(totalFloats / 9);
      entry.floatChunks = [merged];
      shadowUploadVersion++;
      lastRenderSig = '';
      return;
    }
    if (state && state.layerMeshes && state.layerMeshes[layerName]) {
      uploadLayerMesh(layerName, state.layerMeshes[layerName], { append: false, renderImmediately: false });
    }
  }

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

  const BACKING_BOARD_COLORS = {
    black_wood: [0.082, 0.078, 0.075],
    walnut: [0.24, 0.16, 0.105],
    oak: [0.60, 0.44, 0.28],
    obsidian: [0.055, 0.060, 0.070],
    slate: [0.18, 0.21, 0.26]
  };

  const boardBuf = gl.createBuffer();
  let lastBoardKey = '';
  function syncBoardBuffer(bw, bh, zBot = -1.60) {
    const zTop = -0.025;
    const key = `${bw.toFixed(3)}x${bh.toFixed(3)}x${zBot.toFixed(3)}`;
    if (key === lastBoardKey) return;
    lastBoardKey = key;
    const pushQuad = (out, x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, nx, ny, nz) => {
      out.push(
        x0, y0, z0, nx, ny, nz, 8, -1, -1,
        x1, y1, z1, nx, ny, nz, 8, -1, -1,
        x2, y2, z2, nx, ny, nz, 8, -1, -1,
        x0, y0, z0, nx, ny, nz, 8, -1, -1,
        x2, y2, z2, nx, ny, nz, 8, -1, -1,
        x3, y3, z3, nx, ny, nz, 8, -1, -1
      );
    };
    const arr = [];
    // Top (+Z) and Bottom (-Z) faces
    pushQuad(arr, -bw, -bh, zTop,  bw, -bh, zTop,  bw,  bh, zTop, -bw,  bh, zTop,  0,  0,  1);
    pushQuad(arr, -bw, -bh, zBot, -bw,  bh, zBot,  bw,  bh, zBot,  bw, -bh, zBot,  0,  0, -1);
    // Front (-Y), Back (+Y), Right (+X), Left (-X) faces
    pushQuad(arr, -bw, -bh, zBot,  bw, -bh, zBot,  bw, -bh, zTop, -bw, -bh, zTop,  0, -1,  0);
    pushQuad(arr,  bw,  bh, zBot, -bw,  bh, zBot, -bw,  bh, zTop,  bw,  bh, zTop,  0,  1,  0);
    pushQuad(arr,  bw, -bh, zBot,  bw,  bh, zBot,  bw,  bh, zTop,  bw, -bh, zTop,  1,  0,  0);
    pushQuad(arr, -bw,  bh, zBot, -bw, -bh, zBot, -bw, -bh, zTop, -bw,  bh, zTop, -1,  0,  0);
    const verts = new Float32Array(arr);
    gl.bindBuffer(gl.ARRAY_BUFFER, boardBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  }

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
      if (!glBuffers[key]) glBuffers[key] = { buf: gl.createBuffer(), count: 0, chunks: [] };
      const entry = glBuffers[key];
      if (entry.chunks && entry.chunks.length > 0) {
        entry.chunks.forEach(c => {
          if (c.buf) gl.deleteBuffer(c.buf);
        });
        entry.chunks = [];
      }
      if (!entry.buf) entry.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      entry.count = tris.length * 3;
    });
    meshUploadVersion++;
    lastRenderSig = '';
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

  // Maps any stored selection token (pickId, groupId, osmId, or id) to its exact 16-bit pickId!
  function resolveSelectedPickIds() {
    const out = new Set();
    if (!state.userClickedBuilding) return out;
    const rawSet = new Set(state.selectedBuildingIds || []);
    if (rawSet.size === 0 && state.selectedBuildingId) rawSet.add(state.selectedBuildingId);

    const pickMap = state.pickIdMap;
    if (pickMap && pickMap.size > 0) {
      rawSet.forEach(tok => {
        if (pickMap.has(tok)) {
          out.add(tok);
          return;
        }
        for (const [pid, info] of pickMap.entries()) {
          if (info.groupId === tok || info.buildings.some(b => b.id === tok || b.osmId === tok)) {
            out.add(pid);
            break;
          }
        }
      });
    } else {
      rawSet.forEach(tok => { if (typeof tok === 'number') out.add(tok); });
    }
    return out;
  }

  const selectedIdsBuffer = new Float32Array(64);

  function render(force = false) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(canvas3d.clientWidth * dpr);
    const h = Math.floor(canvas3d.clientHeight * dpr);
    if (canvas3d.width !== w || canvas3d.height !== h) {
      canvas3d.width = w;
      canvas3d.height = h;
      lastRenderSig = '';
    }

    const { halfW, halfH } = (typeof resolveSceneScaleAndSpec === 'function')
      ? resolveSceneScaleAndSpec(state, null)
      : (() => {
          const dimW = state.bedSizeMm || (state.targetWidthCm ? state.targetWidthCm * 10 : 320);
          const dimH = state.totalHeightMm || (state.targetHeightCm ? state.targetHeightCm * 10 : dimW);
          const maxDim = Math.max(dimW, dimH) || 320;
          return { halfW: 84.6 * (dimW / maxDim), halfH: 84.6 * (dimH / maxDim) };
        })();

    const selPickIds = resolveSelectedPickIds();
    const selKey = Array.from(selPickIds).join(',');
    const visKey = Object.values(state.layerVisible || {}).map(v => v ? '1' : '0').join('');
    const colKey = Object.values(state.colors || {}).join(',');
    const sig = `${meshUploadVersion}|${w}x${h}|${camera.yaw.toFixed(4)},${camera.pitch.toFixed(4)},${camera.distance.toFixed(2)},${camera.target[0].toFixed(2)},${camera.target[1].toFixed(2)},${camera.target[2].toFixed(2)}|${state.sunAngleDeg}|${state.explodeFactor}|${state.tileCols}x${state.tileRows}|${state.tileExplode}|${state.exportTileFilter}|${state.showFrame}|${state.studioBg}|${state.showLayerLines}|${state.frameStyle}|${Boolean(state.waterCutout)}|${state.backingStyle || 'black_wood'}|${state.hoveredBuildingId}|${state.userClickedBuilding}|${selKey}|${visKey}|${colKey}|${halfW.toFixed(1)}x${halfH.toFixed(1)}`;
    if (!force && sig === lastRenderSig) return;
    lastRenderSig = sig;

    const tCols = state.tileCols || 1;
    const tRows = state.tileRows || 1;
    const tExplode = state.tileExplode || 0.0;
    const explodeSpan = Math.max(tCols - 1, tRows - 1) * 0.5 * tExplode * 15.0;

    const sunShadow = computeShadowFrustum(
      camera,
      state.sunAngleDeg,
      halfW,
      halfH,
      state.explodeFactor,
      explodeSpan,
      SHADOW_RES
    );
    const sunDir = sunShadow.sunDir;
    const lightMatrix = sunShadow.lightMatrix;

    const drawOrder = ['water', 'base', 'greenery', 'roads', 'buildings', 'highlighted', 'frame'];
    const stride = 9 * 4;
    const activeTile = (state.exportTileFilter !== undefined && state.exportTileFilter !== 'all')
      ? parseFloat(state.exportTileFilter)
      : -1.0;

    // PASS 1: SHADOW MAP (cached across pure color-picker & camera orbit frames)
    const shadowSig = `${shadowUploadVersion}|${state.sunAngleDeg}|${state.explodeFactor}|${tCols}x${tRows}|${tExplode}|${state.showFrame}|${Boolean(state.waterCutout)}|${visKey}|${halfW.toFixed(1)}x${halfH.toFixed(1)}|${sunShadow.frustumKey}`;
    if (shadowSig !== lastShadowSig) {
      lastShadowSig = shadowSig;
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
      gl.uniform1f(gl.getUniformLocation(shadowProg, 'uHalfW'), halfW);
      gl.uniform1f(gl.getUniformLocation(shadowProg, 'uHalfH'), halfH);

      const sLocPos = gl.getAttribLocation(shadowProg, 'aPos');
      const sLocLayer = gl.getAttribLocation(shadowProg, 'aLayerId');
      const sLocTile = gl.getAttribLocation(shadowProg, 'aTileId');
      gl.enableVertexAttribArray(sLocPos);
      gl.enableVertexAttribArray(sLocLayer);
      if (sLocTile >= 0) gl.enableVertexAttribArray(sLocTile);

      drawOrder.forEach(key => {
        if (key === 'water' && state.waterCutout) return;
        if (key === 'frame') {
          if (!state.showFrame || state.explodeFactor > 0.08 || tExplode > 0.03) return;
        } else if (!state.layerVisible[key]) return;
        const b = glBuffers[key];
        if (!b) return;

        if (b.chunks && b.chunks.length > 0) {
          for (let ci = 0; ci < b.chunks.length; ci++) {
            const c = b.chunks[ci];
            if (!c || c.count === 0) continue;
            gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
            gl.vertexAttribPointer(sLocPos, 3, gl.FLOAT, false, stride, 0);
            gl.vertexAttribPointer(sLocLayer, 1, gl.FLOAT, false, stride, 24);
            if (sLocTile >= 0) gl.vertexAttribPointer(sLocTile, 1, gl.FLOAT, false, stride, 32);
            gl.drawArrays(gl.TRIANGLES, 0, c.count);
          }
        } else if (b.buf && b.count > 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
          gl.vertexAttribPointer(sLocPos, 3, gl.FLOAT, false, stride, 0);
          gl.vertexAttribPointer(sLocLayer, 1, gl.FLOAT, false, stride, 24);
          if (sLocTile >= 0) gl.vertexAttribPointer(sLocTile, 1, gl.FLOAT, false, stride, 32);
          gl.drawArrays(gl.TRIANGLES, 0, b.count);
        }
      });
    }

    // PASS 2: STUDIO CAMERA RENDER
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    if (state.studioBg) gl.clearColor(0.985, 0.986, 0.99, 1.0);
    else gl.clearColor(0.075, 0.105, 0.165, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(mainProg);
    const camDist = Math.max(2.5, Number(camera.distance) || 274);
    const { zNear, zFar } = computeCameraClipPlanes(camDist, explodeSpan);
    const proj = mat4Perspective(34 * Math.PI / 180, (w / h) || 1, zNear, zFar);
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
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uHalfW'), halfW);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uHalfH'), halfH);
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uEyePos'), eye);
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uSunDir'), sunDir);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(gl.getUniformLocation(mainProg, 'uShadowMap'), 0);

    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorWater'), hexToRgbNorm(state.colors.water));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorBase'), hexToRgbNorm(state.colors.base));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorGreenery'), hexToRgbNorm(state.colors.greenery));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorTrees'), hexToRgbNorm(state.colors.trees || state.colors.greenery));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorRoads'), hexToRgbNorm(state.colors.roads));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorBuildings'), hexToRgbNorm(state.colors.buildings));
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorHighlighted'), hexToRgbNorm(state.colors.highlighted || state.colors.buildings));

    const frameCol =
      state.frameStyle === 'black' ? [0.13, 0.14, 0.16] :
      state.frameStyle === 'oak' ? [0.74, 0.56, 0.37] :
      state.frameStyle === 'walnut' ? [0.36, 0.24, 0.16] : [0.95, 0.95, 0.96];
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorFrame'), frameCol);

    const boardCol = BACKING_BOARD_COLORS[state.backingStyle] || BACKING_BOARD_COLORS.black_wood;
    const uBoardLoc = gl.getUniformLocation(mainProg, 'uColorBoard');
    if (uBoardLoc) gl.uniform3fv(uBoardLoc, boardCol);

    selectedIdsBuffer.fill(-999.0);
    let idx = 0;
    selPickIds.forEach(pid => {
      if (idx < 64) selectedIdsBuffer[idx++] = pid;
    });
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

    if (Boolean(state.waterCutout) && state.explodeFactor < 0.08 && tExplode <= 0.03 && eye[2] >= 0.0) {
      const boardPad = state.showFrame ? 0.25 : 0.08;
      syncBoardBuffer(halfW + boardPad, halfH + boardPad, -1.60);
      gl.bindBuffer(gl.ARRAY_BUFFER, boardBuf);
      gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(locLayer, 1, gl.FLOAT, false, stride, 24);
      gl.vertexAttribPointer(locBld, 1, gl.FLOAT, false, stride, 28);
      if (locTile >= 0) gl.vertexAttribPointer(locTile, 1, gl.FLOAT, false, stride, 32);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    drawOrder.forEach(key => {
      if (key === 'water' && state.waterCutout) return;
      if (key === 'frame') {
        if (!state.showFrame || state.explodeFactor > 0.08 || tExplode > 0.03) return;
      } else if (!state.layerVisible[key]) return;
      const b = glBuffers[key];
      if (!b) return;

      if (b.chunks && b.chunks.length > 0) {
        for (let ci = 0; ci < b.chunks.length; ci++) {
          const c = b.chunks[ci];
          if (!c || c.count === 0) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
          gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, stride, 0);
          gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, stride, 12);
          gl.vertexAttribPointer(locLayer, 1, gl.FLOAT, false, stride, 24);
          gl.vertexAttribPointer(locBld, 1, gl.FLOAT, false, stride, 28);
          if (locTile >= 0) gl.vertexAttribPointer(locTile, 1, gl.FLOAT, false, stride, 32);
          gl.drawArrays(gl.TRIANGLES, 0, c.count);
        }
      } else if (b.buf && b.count > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, stride, 12);
        gl.vertexAttribPointer(locLayer, 1, gl.FLOAT, false, stride, 24);
        gl.vertexAttribPointer(locBld, 1, gl.FLOAT, false, stride, 28);
        if (locTile >= 0) gl.vertexAttribPointer(locTile, 1, gl.FLOAT, false, stride, 32);
        gl.drawArrays(gl.TRIANGLES, 0, b.count);
      }
    });

    gl.disableVertexAttribArray(locNorm);
    gl.disableVertexAttribArray(locBld);
    if (locTile >= 0) gl.disableVertexAttribArray(locTile);
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

    let rx = fy, ry = -fx;
    const rlen = Math.hypot(rx, ry) || 1;
    rx /= rlen; ry /= rlen;

    const ux = ry * fz;
    const uy = -rx * fz;
    const uz = rx * fy - ry * fx;

    const tanHalfFov = Math.tan(17 * Math.PI / 180);
    const aspect = (rect.width / rect.height) || 1;

    let dx = fx + rx * (nx * aspect * tanHalfFov) + ux * (ny * tanHalfFov);
    let dy = fy + ry * (nx * aspect * tanHalfFov) + uy * (ny * tanHalfFov);
    let dz = fz + uz * (ny * tanHalfFov);
    const dlen = Math.hypot(dx, dy, dz) || 1;
    dx /= dlen; dy /= dlen; dz /= dlen;

    const tCols = state.tileCols || 1;
    const tRows = state.tileRows || 1;
    const tExplode = state.tileExplode || 0.0;
    const maxShiftX = (tCols > 1 && tExplode > 0) ? ((tCols - 1) * 0.5 * tExplode * 15.0) : 0;
    const maxShiftY = (tRows > 1 && tExplode > 0) ? ((tRows - 1) * 0.5 * tExplode * 15.0) : 0;

    // 1. Broadphase AABB candidate set using exact 16-bit pickId
    const candidatePickIds = new Set();
    const bldByPickId = new Map();
    for (let i = 0; i < buildingBounds.length; i++) {
      const bb = buildingBounds[i];
      const pid = bb.pickId || bb.building._pickId || bb.building.id;
      const lift = bb.layerId * state.explodeFactor * 14.0;
      const minZ = bb.minZ + lift;
      const maxZ = bb.maxZ + lift;

      const tx1 = ((bb.minX - maxShiftX) - eye[0]) / (dx || 1e-9);
      const tx2 = ((bb.maxX + maxShiftX) - eye[0]) / (dx || 1e-9);
      let tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);

      const ty1 = ((bb.minY - maxShiftY) - eye[1]) / (dy || 1e-9);
      const ty2 = ((bb.maxY + maxShiftY) - eye[1]) / (dy || 1e-9);
      tmin = Math.max(tmin, Math.min(ty1, ty2));
      tmax = Math.min(tmax, Math.max(ty1, ty2));

      const tz1 = (minZ - eye[2]) / (dz || 1e-9);
      const tz2 = (maxZ - eye[2]) / (dz || 1e-9);
      tmin = Math.max(tmin, Math.min(tz1, tz2));
      tmax = Math.min(tmax, Math.max(tz1, tz2));

      if (tmax >= Math.max(0, tmin)) {
        candidatePickIds.add(pid);
        if (!bldByPickId.has(pid)) {
          const info = state.pickIdMap ? state.pickIdMap.get(pid) : null;
          bldByPickId.set(pid, (info && info.primaryBuilding) ? info.primaryBuilding : bb.building);
        }
      }
    }

    if (candidatePickIds.size === 0) return null;

    // 2. Narrowphase exact triangle hit test (respecting tile explode shifts!)
    let bestPickId = -1;
    let bestT = Infinity;
    const lists = [state.layerMeshes.buildings || [], state.layerMeshes.highlighted || []];
    for (let l = 0; l < lists.length; l++) {
      const tris = lists[l];
      for (let i = 0; i < tris.length; i++) {
        const tri = tris[i];
        if (!candidatePickIds.has(tri.buildingId)) continue;
        const liftZ = tri.layerId * state.explodeFactor * 14.0;
        let shiftX = 0, shiftY = 0;
        if ((tCols > 1 || tRows > 1) && tExplode > 0 && tri.tileId >= 0) {
          const tid = Math.round(tri.tileId);
          const tc = tid % tCols;
          const tr = Math.floor(tid / tCols);
          shiftX = (tc - (tCols - 1) * 0.5) * tExplode * 15.0;
          shiftY = (tr - (tRows - 1) * 0.5) * tExplode * 15.0;
        }
        const t = rayTriangleIntersect(eye[0], eye[1], eye[2], dx, dy, dz, tri.v0, tri.v1, tri.v2, liftZ, shiftX, shiftY);
        if (t > 0 && t < bestT) {
          bestT = t;
          bestPickId = tri.buildingId;
        }
      }
    }

    return bestPickId > 0 ? (bldByPickId.get(bestPickId) || null) : null;
  }

  return {
    camera,
    uploadMeshes,
    uploadLayerMesh,
    clearMeshes,
    consolidateLayer,
    setGenerationId,
    getActiveGenerationId,
    render,
    pickBuilding
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createWebGLStudio };
}
