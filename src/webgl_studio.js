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

  const shadowProg = compileWebGLProgram(gl, WEBGL_SHADOW_VS, WEBGL_SHADOW_FS, shadow);
  const mainProg = compileWebGLProgram(gl, WEBGL_MAIN_VS, WEBGL_MAIN_FS, main);
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
  let lastRenderSig = '';

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

    // Fix B21: On-demand dirty-state check so idle frames perform 0 GPU draw calls
    const selKey = state.selectedBuildingIds ? Array.from(state.selectedBuildingIds).join(',') : String(state.selectedBuildingId || '');
    const visKey = Object.values(state.layerVisible || {}).map(v => v ? '1' : '0').join('');
    const colKey = Object.values(state.colors || {}).join(',');
    const sig = `${meshUploadVersion}|${w}x${h}|${camera.yaw.toFixed(4)},${camera.pitch.toFixed(4)},${camera.distance.toFixed(2)},${camera.target[0].toFixed(2)},${camera.target[1].toFixed(2)},${camera.target[2].toFixed(2)}|${state.sunAngleDeg}|${state.explodeFactor}|${state.tileCols}x${state.tileRows}|${state.tileExplode}|${state.exportTileFilter}|${state.showFrame}|${state.studioBg}|${state.showLayerLines}|${state.frameStyle}|${state.hoveredBuildingId}|${state.userClickedBuilding}|${selKey}|${visKey}|${colKey}`;
    if (!force && sig === lastRenderSig) return;
    lastRenderSig = sig;

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
          if (idx < 64) selectedIdsBuffer[idx++] = id;
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
