// ============================================================================
// src/video/video_gl_engine.js
// Offscreen WebGL 1.0 Cinema Renderer (2048x2048 PCF Shadow Map + Multi-Slot
// Framed Product Pass) & Hybrid 2D Composite Frame Coordinator.
// ============================================================================

function computeLayerGroundZMap(meshes) {
  const src = meshes || {};
  const allKeys = ['water', 'base', 'greenery', 'trees', 'roads', 'buildings', 'highlighted'];
  const shellMinZ = new Map();
  const bldMinZ = new Map();
  let maxSceneZ = 18.0;
  let baseTopZ = 0.0;

  for (let ki = 0; ki < allKeys.length; ki++) {
    const k = allKeys[ki];
    const arr = src[k] || [];
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (!t || !t.v0 || !t.v1 || !t.v2) continue;
      const topZ = Math.max(t.v0[2], t.v1[2], t.v2[2]);
      const minZ = Math.min(t.v0[2], t.v1[2], t.v2[2]);
      if (topZ > maxSceneZ) maxSceneZ = topZ;
      if (k === 'base' && topZ > baseTopZ) baseTopZ = topZ;
      if (t.shellId !== undefined && t.shellId !== -1) {
        const prevS = shellMinZ.get(t.shellId);
        if (prevS === undefined || minZ < prevS) shellMinZ.set(t.shellId, minZ);
      }
      if ((k === 'buildings' || k === 'highlighted') && t.buildingId !== undefined && t.buildingId >= 0) {
        const prevB = bldMinZ.get(t.buildingId);
        if (prevB === undefined || minZ < prevB) bldMinZ.set(t.buildingId, minZ);
      }
    }
  }

  function resolveTriGroundZ(t, layerKey, fallbackZ) {
    if (layerKey === 'base') return 0.0;
    if (t && t.shellId !== undefined && t.shellId !== -1 && shellMinZ.has(t.shellId)) {
      return shellMinZ.get(t.shellId);
    }
    if (t && t.buildingId !== undefined && t.buildingId >= 0 && bldMinZ.has(t.buildingId)) {
      return bldMinZ.get(t.buildingId);
    }
    return fallbackZ;
  }

  function tagLayerWithGroundZ(arr, layerKey, fallbackZ) {
    const list = arr || [];
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      out[i] = Object.assign({}, t, { groundZ: resolveTriGroundZ(t, layerKey, fallbackZ) });
    }
    return out;
  }

  return { maxSceneZ, baseTopZ, shellMinZ, bldMinZ, resolveTriGroundZ, tagLayerWithGroundZ };
}

function createVideoPreviewEngine(compositeCanvas) {
  const ctxOut = compositeCanvas.getContext('2d', { alpha: false });

  const glCanvas = document.createElement('canvas');
  glCanvas.width = 1280;
  glCanvas.height = 720;
  const gl =
    glCanvas.getContext('webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true }) ||
    glCanvas.getContext('experimental-webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true });

  if (!gl) {
    throw new Error('WebGL 1.0 jest wymagany dla modułu Video Preview Studio.');
  }

  const derivExt = gl.getExtension('OES_standard_derivatives');
  const shadowProg = compileWebGLProgram(gl, VIDEO_SHADOW_VS, VIDEO_SHADOW_FS, 'video_shadow');
  const mainProg = compileWebGLProgram(gl, VIDEO_MAIN_VS, buildVideoMainFS(!!derivExt), 'video_main');

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

  const floorBuf = gl.createBuffer();
  (function initVideoFloor() {
    const R = 950, Z = -2.48;
    const tris = [
      { v0: [-R, -R, Z], v1: [R, -R, Z], v2: [R, R, Z], n: [0, 0, 1], layerId: 7, groundZ: Z, subId: 0 },
      { v0: [-R, -R, Z], v1: [R, R, Z], v2: [-R, R, Z], n: [0, 0, 1], layerId: 7, groundZ: Z, subId: 0 }
    ];
    gl.bindBuffer(gl.ARRAY_BUFFER, floorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, packMeshForVideoGL(tris, Z), gl.STATIC_DRAW);
  })();

  let gpuSlots = [];
  let primaryTelemetryRows = [];
  let primaryCad2D = null;
  const userOrbitOffset = { yaw: 0, pitch: 0, zoomMult: 1.0 };

  function makeGpuBuffer(tris, defaultGroundZ) {
    const packed = packMeshForVideoGL(tris, defaultGroundZ);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW);
    return { buf, count: tris.length * 3 };
  }

  function disposeGpuSlots() {
    gpuSlots.forEach(s => {
      Object.values(s.buffers).forEach(b => { if (b && b.buf) gl.deleteBuffer(b.buf); });
      if (s.plaqueTex) gl.deleteTexture(s.plaqueTex);
    });
    gpuSlots = [];
  }

  function uploadOrderSlots(slotsInput) {
    disposeGpuSlots();
    const list = (slotsInput && slotsInput.length > 0) ? slotsInput.slice(0, 3) : [];
    if (list.length === 0) return;

    const firstCrop = list[0].cropRatio || (list[0].sceneData && list[0].sceneData._fetchedCropRatio) || 0.88;
    const extracted = extractVideoTelemetryAndCad2D(list[0].sceneData, firstCrop);
    primaryTelemetryRows = extracted.telemetryRows;
    primaryCad2D = extracted.cad2D;

    list.forEach((item) => {
      const dimW = (item.widthCm || 30) * 10;
      const dimH = (item.heightCm || 30) * 10;
      const maxDim = Math.max(dimW, dimH) || 300;
      const halfW = 84.6 * (dimW / maxDim);
      const halfH = 84.6 * (dimH / maxDim);
      const meshes = item.meshes || {};
      const elemVis = {
        trees: true,
        ...(item.elementVisible || {
          water: true, base: true, greenery: true, trees: true, roads: true, buildings: true, highlighted: true
        })
      };

      const slotCfg = {
        halfW,
        halfH,
        widthCm: item.widthCm || 30,
        heightCm: item.heightCm || 30,
        frameStyle: item.frameStyle || 'black',
        matStyle: item.matStyle || 'none',
        backingStyle: item.backingStyle || 'obsidian',
        showPlaque: item.showPlaque !== false,
        showGlass: !!item.showGlass,
        title: item.title || 'MÜNCHEN',
        subtitle: item.subtitle || '',
        coordsText: item.coordsText || '',
        scaleText: item.scaleText || '',
        colors: item.colors || PALETTES[0].colors,
        elementVisible: { ...elemVis },
        ghostHiddenLayers: !!item.ghostHiddenLayers,
        waterCutout: Boolean(item.waterCutout),
        userClickedHighlight: Boolean(item.userClickedHighlight),
        tileCols: item.tileCols || 1,
        tileRows: item.tileRows || 1
      };

      const prod = buildVideoProductFrameBuffers(slotCfg, !!elemVis.base);
      const gInfo = computeLayerGroundZMap(meshes);
      const maxSceneZ = gInfo.maxSceneZ;
      const fallbackTop = elemVis.base ? Math.min(Math.max(gInfo.baseTopZ || 1.8, 0.5), 2.45) : 0.5;

      const buffers = {
        water:       makeGpuBuffer(gInfo.tagLayerWithGroundZ(meshes.water, 'water', 0.0), 0.0),
        base:        makeGpuBuffer(gInfo.tagLayerWithGroundZ(meshes.base, 'base', 0.0), 0.0),
        greenery:    makeGpuBuffer(gInfo.tagLayerWithGroundZ(meshes.greenery, 'greenery', fallbackTop), fallbackTop),
        trees:       makeGpuBuffer(gInfo.tagLayerWithGroundZ(meshes.trees, 'trees', fallbackTop), fallbackTop),
        roads:       makeGpuBuffer(gInfo.tagLayerWithGroundZ(meshes.roads, 'roads', fallbackTop), fallbackTop),
        buildings:   makeGpuBuffer(gInfo.tagLayerWithGroundZ(meshes.buildings, 'buildings', fallbackTop), fallbackTop),
        highlighted: makeGpuBuffer(gInfo.tagLayerWithGroundZ(meshes.highlighted, 'highlighted', fallbackTop), fallbackTop),
        backing:     makeGpuBuffer(prod.backingTris, -2.15),
        boardOnly:   makeGpuBuffer(prod.boardOnlyTris || [], -2.15),
        matboard:    makeGpuBuffer(prod.matTris, 0.0),
        frame:       makeGpuBuffer(prod.frameTris, -2.42),
        plaque:      makeGpuBuffer(prod.plaqueTris, 3.60),
        glass:       makeGpuBuffer(prod.glassTris, 6.40)
      };

      gpuSlots.push({
        cfg: slotCfg,
        buffers,
        plaqueTex: createVideoPlaqueTexture(gl, slotCfg),
        maxSceneZ,
        outerX: prod.outerX,
        outerYBot: prod.outerYBot,
        outerYTop: prod.outerYTop,
        plaqueBounds: prod.plaqueBounds
      });
    });
  }

  let lastComputedCamDist = 268.0;
  let lastComputedSlotMaxZ = 22.0;

  function renderWebGLPass(animState, animCfg, width, height) {
    if (glCanvas.width !== width || glCanvas.height !== height) {
      glCanvas.width = width;
      glCanvas.height = height;
    }

    const numSlots = gpuSlots.length;
    if (numSlots === 0) return;

    const slotSpacing = 224.0;
    const setDistMult = numSlots === 1 ? 1.0 : (numSlots === 2 ? 1.58 : 2.22);
    const bgTheme = VIDEO_BG_THEMES[animCfg.bgTheme || 'dark_to_white'] || VIDEO_BG_THEMES.dark_to_white;

    const pitch = Math.max(0.12, Math.min(1.569, animState.camPitch + userOrbitOffset.pitch));
    const yaw = animState.camYaw + userOrbitOffset.yaw;
    const maxZ = gpuSlots.reduce((m, s) => Math.max(m, s.maxSceneZ || 20), 20);
    const tallExtra = maxZ > 42 ? Math.min(58, (maxZ - 42) * 0.55) : 0;
    const tiltFactor = Math.max(0, Math.cos(pitch));
    const dist = (animState.camDist + tallExtra * tiltFactor * 0.95) * setDistMult * userOrbitOffset.zoomMult;
    lastComputedCamDist = dist;
    lastComputedSlotMaxZ = gpuSlots[0] ? (gpuSlots[0].maxSceneZ || 22.0) : maxZ;

    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const target = [
      animState.camTarget[0],
      animState.camTarget[1],
      animState.camTarget[2] + tallExtra * tiltFactor * 0.34
    ];
    const eye = [target[0] + dist * cp * sy, target[1] - dist * cp * cy, target[2] + dist * sp];

    const sunRad = (animState.sunDeg * Math.PI) / 180.0;
    const sunDir = [Math.cos(sunRad) * 0.68, Math.sin(sunRad) * 0.68, 0.73];
    const lightView = mat4LookAt([sunDir[0] * 260, sunDir[1] * 260, sunDir[2] * 260], [0, 0, 5], [0, 0, 1]);
    const orthoHalf = (numSlots === 1 ? 132 : (numSlots === 2 ? 245 : 365)) + tallExtra * 0.45;
    const shadowFar = Math.max(700, dist * 2.5 + maxZ * 4);
    const lightMatrix = mat4Multiply(
      mat4Ortho(-orthoHalf, orthoHalf, -155 - tallExtra * 0.4, 155 + tallExtra * 0.4, 10, shadowFar),
      lightView
    );

    const stride = 13 * 4;
    const mapKeys = ['water', 'base', 'greenery', 'trees', 'roads', 'buildings', 'highlighted'];
    const frameAnimMode = animCfg.frameAnimMode === 'snap_4rail' ? 1.0 : 0.0;

    // PASS 1: 2048x2048 Shadow Map
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    gl.useProgram(shadowProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(shadowProg, 'uLightMatrix'), false, lightMatrix);
    for (let i = 0; i < 6; i++) {
      gl.uniform1f(gl.getUniformLocation(shadowProg, `uLayerExtrude${i}`), animState.layerExtrude[i]);
    }
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uWaveMode'), animState.waveMode);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uWaveProgress'), animState.waveProgress);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uExplodeZ'), animState.explodeZ);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uTileExplode'), animState.tileExplode);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uFrameAssemble'), animState.frameAssemble);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uFrameAnimMode'), frameAnimMode);
    gl.uniform1f(gl.getUniformLocation(shadowProg, 'uGlassDrop'), animState.glassDrop);

    const sPos = gl.getAttribLocation(shadowProg, 'aPos');
    const sMeta = gl.getAttribLocation(shadowProg, 'aMeta');
    gl.enableVertexAttribArray(sPos);
    gl.enableVertexAttribArray(sMeta);

    gpuSlots.forEach((slot, sIdx) => {
      gl.uniform3f(gl.getUniformLocation(shadowProg, 'uModelOffset'), (sIdx - (numSlots - 1) * 0.5) * slotSpacing, 0, 0);
      gl.uniform1f(gl.getUniformLocation(shadowProg, 'uHalfW'), slot.cfg.halfW);
      gl.uniform1f(gl.getUniformLocation(shadowProg, 'uHalfH'), slot.cfg.halfH);
      gl.uniform1f(gl.getUniformLocation(shadowProg, 'uTileCols'), slot.cfg.tileCols);
      gl.uniform1f(gl.getUniformLocation(shadowProg, 'uTileRows'), slot.cfg.tileRows);
      gl.uniform1f(gl.getUniformLocation(shadowProg, 'uMaxSceneZ'), slot.maxSceneZ || 24.0);

      const drawShadowBuf = (b) => {
        if (!b || b.count === 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        gl.vertexAttribPointer(sPos, 3, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(sMeta, 4, gl.FLOAT, false, stride, 36);
        gl.drawArrays(gl.TRIANGLES, 0, b.count);
      };
      mapKeys.forEach(k => {
        if (k === 'water' && slot.cfg.waterCutout) return;
        if (slot.cfg.elementVisible[k]) drawShadowBuf(slot.buffers[k]);
      });
      if (animCfg.showFrameProduct !== false && animState.frameAssemble > 0.02) {
        ['backing', 'matboard', 'frame'].forEach(fk => drawShadowBuf(slot.buffers[fk]));
      } else if (slot.cfg.waterCutout) {
        drawShadowBuf(slot.buffers.boardOnly);
      }
    });

    // PASS 2: Main Cinema Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(
      bgTheme.dark[0] * (1 - animState.bgMix) + bgTheme.light[0] * animState.bgMix,
      bgTheme.dark[1] * (1 - animState.bgMix) + bgTheme.light[1] * animState.bgMix,
      bgTheme.dark[2] * (1 - animState.bgMix) + bgTheme.light[2] * animState.bgMix,
      1.0
    );
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(mainProg);
    const explodeSpan = (animState.tileExplode * 16.0) + (animState.explodeZ * 67.5);
    const clipPlanes = (typeof computeCameraClipPlanes === 'function')
      ? computeCameraClipPlanes(dist, explodeSpan)
      : { near: Math.max(1.5, dist * 0.04), far: Math.max(1800.0, dist * 5.0 + 350.0) };
    gl.uniformMatrix4fv(gl.getUniformLocation(mainProg, 'uProj'), false, mat4Perspective((34 * Math.PI) / 180.0, (width / height) || 1, clipPlanes.near, clipPlanes.far));
    gl.uniformMatrix4fv(gl.getUniformLocation(mainProg, 'uView'), false, mat4LookAt(eye, target, [0, 0, 1]));
    gl.uniformMatrix4fv(gl.getUniformLocation(mainProg, 'uLightMatrix'), false, lightMatrix);
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uEyePos'), eye);
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uSunDir'), sunDir);
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uBgDark'), bgTheme.dark);
    gl.uniform3fv(gl.getUniformLocation(mainProg, 'uBgLight'), bgTheme.light);

    for (let i = 0; i < 6; i++) {
      gl.uniform1f(gl.getUniformLocation(mainProg, `uLayerExtrude${i}`), animState.layerExtrude[i]);
    }
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uWaveMode'), animState.waveMode);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uWaveProgress'), animState.waveProgress);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uExplodeZ'), animState.explodeZ);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uTileExplode'), animState.tileExplode);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uFrameAssemble'), animState.frameAssemble);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uFrameAnimMode'), frameAnimMode);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uGlassDrop'), animState.glassDrop);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uGlassSweep'), animState.glassSweep);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uWireMix'), animState.wireMix);
    gl.uniform1f(gl.getUniformLocation(mainProg, 'uBgMix'), animState.bgMix);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(gl.getUniformLocation(mainProg, 'uShadowMap'), 0);

    const locPos = gl.getAttribLocation(mainProg, 'aPos');
    const locNorm = gl.getAttribLocation(mainProg, 'aNorm');
    const locBary = gl.getAttribLocation(mainProg, 'aBary');
    const locMeta = gl.getAttribLocation(mainProg, 'aMeta');
    gl.enableVertexAttribArray(locPos);
    gl.enableVertexAttribArray(locNorm);
    gl.enableVertexAttribArray(locBary);
    gl.enableVertexAttribArray(locMeta);

    const bindAndDraw = (bufObj) => {
      if (!bufObj || bufObj.count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufObj.buf);
      gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, stride, 12);
      gl.vertexAttribPointer(locBary, 3, gl.FLOAT, false, stride, 24);
      gl.vertexAttribPointer(locMeta, 4, gl.FLOAT, false, stride, 36);
      gl.drawArrays(gl.TRIANGLES, 0, bufObj.count);
    };

    gpuSlots.forEach((slot, sIdx) => {
      gl.uniform3f(gl.getUniformLocation(mainProg, 'uModelOffset'), (sIdx - (numSlots - 1) * 0.5) * slotSpacing, 0, 0);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uOuterFrameW'), slot.outerX);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uOuterFrameHBot'), slot.outerYBot);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uOuterFrameHTop'), slot.outerYTop);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uElementAlpha'), 1.0);
      if (animState.bgMix > 0.04 && animState.explodeZ < 0.15) {
        bindAndDraw({ buf: floorBuf, count: 6 });
      }
    });

    gpuSlots.forEach((slot, sIdx) => {
      const sc = slot.cfg;
      const frameFinish = VIDEO_FRAME_FINISHES[sc.frameStyle] || VIDEO_FRAME_FINISHES.black;
      const matFinish = VIDEO_MAT_STYLES[sc.matStyle] || VIDEO_MAT_STYLES.none;
      const backFinish = VIDEO_BACKING_STYLES[sc.backingStyle] || VIDEO_BACKING_STYLES.obsidian;

      gl.uniform3f(gl.getUniformLocation(mainProg, 'uModelOffset'), (sIdx - (numSlots - 1) * 0.5) * slotSpacing, 0, 0);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uHalfW'), sc.halfW);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uHalfH'), sc.halfH);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uOuterFrameW'), slot.outerX);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uOuterFrameHBot'), slot.outerYBot);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uOuterFrameHTop'), slot.outerYTop);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uTileCols'), sc.tileCols);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uTileRows'), sc.tileRows);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uMaxSceneZ'), slot.maxSceneZ || 24.0);
      gl.uniform4f(gl.getUniformLocation(mainProg, 'uPlaqueBounds'), slot.plaqueBounds[0], slot.plaqueBounds[1], slot.plaqueBounds[2], slot.plaqueBounds[3]);

      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorWater'), hexToRgbNorm(sc.colors.water));
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorBase'), hexToRgbNorm(sc.colors.base));
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorGreenery'), hexToRgbNorm(sc.colors.greenery));
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorTrees'), hexToRgbNorm(sc.colors.trees || sc.colors.greenery));
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorRoads'), hexToRgbNorm(sc.colors.roads));
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorBuildings'), hexToRgbNorm(sc.colors.buildings));
      const hlHex = sc.colors.highlighted || (sc.userClickedHighlight ? '#f59e0b' : sc.colors.buildings);
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorHighlighted'), hexToRgbNorm(hlHex));
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorFrame'), frameFinish.rgb);
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorMat'), matFinish.rgb);
      gl.uniform3fv(gl.getUniformLocation(mainProg, 'uColorBacking'), backFinish.rgb);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, slot.plaqueTex);
      gl.uniform1i(gl.getUniformLocation(mainProg, 'uPlaqueTex'), 1);

      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.uniform1f(gl.getUniformLocation(mainProg, 'uElementAlpha'), 1.0);

      if (animCfg.showFrameProduct !== false && animState.frameAssemble > 0.01) {
        bindAndDraw(slot.buffers.backing);
        bindAndDraw(slot.buffers.matboard);
        bindAndDraw(slot.buffers.frame);
      } else if (sc.waterCutout) {
        bindAndDraw(slot.buffers.boardOnly);
      }
      mapKeys.forEach(k => {
        if (k === 'water' && sc.waterCutout) return;
        if (sc.elementVisible[k]) bindAndDraw(slot.buffers[k]);
      });

      if (sc.ghostHiddenLayers) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniform1f(gl.getUniformLocation(mainProg, 'uElementAlpha'), 0.16);
        mapKeys.forEach(k => {
          if (k === 'water' && sc.waterCutout) return;
          if (!sc.elementVisible[k]) bindAndDraw(slot.buffers[k]);
        });
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      if (animCfg.showFrameProduct !== false && animState.frameAssemble > 0.04) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniform1f(gl.getUniformLocation(mainProg, 'uElementAlpha'), 1.0);
        bindAndDraw(slot.buffers.plaque);
        if (sc.showGlass && animState.glassDrop > 0.02) bindAndDraw(slot.buffers.glass);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    });
  }

  function renderFrameAt(tNorm, animCfg, targetW, targetH) {
    const w = targetW || compositeCanvas.width || 1280;
    const h = targetH || compositeCanvas.height || 720;
    if (compositeCanvas.width !== w || compositeCanvas.height !== h) {
      compositeCanvas.width = w;
      compositeCanvas.height = h;
    }

    const animState = evaluateVideoTimeline(tNorm, animCfg);
    if (animState.webglAlpha > 0.005) {
      renderWebGLPass(animState, animCfg, w, h);
      ctxOut.globalAlpha = 1.0;
      ctxOut.drawImage(glCanvas, 0, 0, w, h);
    } else {
      ctxOut.fillStyle = '#04060a';
      ctxOut.fillRect(0, 0, w, h);
    }

    if (animState.cad2dAlpha > 0.005 && gpuSlots.length > 0) {
      const whipDist = animState.webglAlpha > 0.005 ? lastComputedCamDist : animState.camDist;
      drawVideo2DCadWhipPanOverlay(ctxOut, w, h, {
        ...animState,
        camDist: whipDist,
        slotMaxZ: gpuSlots[0].maxSceneZ || lastComputedSlotMaxZ || 22.0
      }, primaryCad2D, gpuSlots[0].cfg);
    }
    if (animState.telemetryAlpha > 0.005) {
      drawVideoTelemetryOverlay(ctxOut, w, h, animState.telemetryAlpha, animState.telemetryScroll, primaryTelemetryRows);
    }
    if (animCfg.showOrderHud) {
      drawVideoOrderPackshotHud(ctxOut, w, h, animState, animCfg, gpuSlots);
    }
    return animState;
  }

  function resetUserOrbit() {
    userOrbitOffset.yaw = 0;
    userOrbitOffset.pitch = 0;
    userOrbitOffset.zoomMult = 1.0;
  }

  return {
    uploadOrderSlots,
    renderFrameAt,
    evaluateTimeline: evaluateVideoTimeline,
    recordVideoBlob: (animCfg, onProgress) => recordCanvasVideoBlob(compositeCanvas, renderFrameAt, animCfg, onProgress),
    getSupportedVideoMime,
    userOrbitOffset,
    resetUserOrbit,
    FRAME_FINISHES: VIDEO_FRAME_FINISHES,
    MAT_STYLES: VIDEO_MAT_STYLES,
    BACKING_STYLES: VIDEO_BACKING_STYLES
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeLayerGroundZMap,
    createVideoPreviewEngine
  };
}
