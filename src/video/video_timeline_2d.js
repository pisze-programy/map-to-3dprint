// ============================================================================
// src/video/video_timeline_2d.js
// Deterministic Timeline Choreographer (5 Storyboards + 4 Spatial Waves) &
// 2D Compositor Overlays (UTM GIS Telemetry, Whip-Pan Motion Blur & Packshot HUD).
// ============================================================================

function extractVideoTelemetryAndCad2D(scene) {
  if (!scene) {
    return { telemetryRows: [], cad2D: null };
  }
  const slug = ((scene.title || 'city').toLowerCase().replace(/[^a-z0-9]/g, '') || 'city').slice(0, 9);
  const lat = (scene.center && scene.center[0]) || 48.1338;
  const lon = (scene.center && scene.center[1]) || 11.5855;
  const zoneLon0 = Math.floor((lon + 180) / 6) * 6 - 180 + 3;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const baseEast = 500000 + (lon - zoneLon0) * 111320 * cosLat;
  const baseNorth = (lat >= 0 ? 0 : 10000000) + lat * 110574;
  const invM = 1.0 / (scene.metersToUnits || 0.13);

  const blds = (scene.buildings || []).slice(0, 150);
  const telemetryRows = [];
  for (let i = 0; i < 135; i++) {
    const b = blds[i % Math.max(1, blds.length)];
    const pt = (b && b.outer && b.outer[0]) ? b.outer[0] : [(i * 13) % 80 - 40, (i * 29) % 80 - 40];
    const east = (baseEast + pt[0] * invM).toFixed(2);
    const north = (baseNorth + pt[1] * invM).toFixed(2);
    const h = (b && b.h ? Number(b.h) : (8 + (i % 19) * 3)).toFixed(1);
    const idNum = 82690 + ((b && b.id ? Number(b.id) : i) % 9000);
    telemetryRows.push(`${slug}_${idNum}  ${east}  ${north}  ${h.padStart(5, ' ')}`);
  }

  const roads = (scene.roads || []).map(r => ({ pts: r.pts || [], w: r.width || 1.5 }));
  const bldOuters = (scene.buildings || []).filter(b => !b.hidden).slice(0, 2600).map(b => ({
    pts: b.outer || [],
    hl: !!b.highlighted,
    h: b.h || 10
  }));
  const waters = (scene.waterPolys || []).map(w => w.outer || []);

  return {
    telemetryRows,
    cad2D: { roads, bldOuters, waters }
  };
}

function evaluateVideoTimeline(tNorm, animCfg) {
  const t = clamp01(tNorm);
  const sb = animCfg.storyboard || 'hero';
  const easeMode = animCfg.easing || 'cubic';
  const styleMode = animCfg.styleTransition || 'wire_to_studio';
  const baseSun = animCfg.sunAngleDeg !== undefined ? animCfg.sunAngleDeg : 132;

  const state = {
    telemetryAlpha: 0.0,
    telemetryScroll: 0.0,
    cad2dAlpha: 0.0,
    cad2dExteriorAlpha: 0.0,
    cad2dPanX: 0.0,
    cad2dPanY: 0.0,
    cad2dVelX: 0.0,
    cad2dVelY: 0.0,
    reticleAlpha: 0.0,
    webglAlpha: 1.0,

    camYaw: -0.48,
    camPitch: 0.52,
    camDist: 285,
    camTarget: [0, -2, 2.5],

    layerExtrude: [1, 1, 1, 1, 1, 1],
    waveMode: 0,
    waveProgress: 1.0,
    explodeZ: 0.0,
    tileExplode: 0.0,
    frameAssemble: 1.0,
    glassDrop: 1.0,
    glassSweep: -1.5,

    wireMix: 0.0,
    bgMix: 1.0,
    sunDeg: baseSun,
    packshotBadgeAlpha: 0.0
  };

  const wModeNum =
    animCfg.waveMode === 'diagonal' ? 1 :
    animCfg.waveMode === 'radial' ? 2 :
    animCfg.waveMode === 'zslicer' ? 3 : 0;

  if (sb === 'hero') {
    const hasTel = animCfg.showTelemetry !== false;
    const hasPan = animCfg.showWhipPan !== false;
    const tStart2D = hasTel ? 0.11 : 0.0;
    const tLock = hasPan ? 0.36 : (hasTel ? 0.14 : 0.04);

    if (hasTel && t < 0.14) {
      state.telemetryAlpha = 1.0 - easeInOutCubic(smoothRange(t, 0.09, 0.14));
      state.telemetryScroll = t / 0.14;
    }

    if (hasPan && t >= tStart2D * 0.7 && t < tLock + 0.06) {
      const fadeIn = easeInOutCubic(smoothRange(t, tStart2D * 0.7, tStart2D + 0.05));
      const fadeOut = 1.0 - easeInOutCubic(smoothRange(t, tLock - 0.02, tLock + 0.05));
      state.cad2dAlpha = fadeIn * fadeOut;
      state.reticleAlpha = easeInOutCubic(smoothRange(t, tStart2D + 0.05, tStart2D + 0.10)) * fadeOut;
      state.cad2dExteriorAlpha = (1.0 - easeInOutCubic(smoothRange(t, tLock - 0.06, tLock))) * fadeIn;

      const uPan = smoothRange(t, tStart2D + 0.06, tLock - 0.04);
      const samplePan = (u) => {
        if (u < 0.45) {
          const k = easeInOutQuint(u / 0.45);
          return [(1 - k) * 145 + k * (-92), (1 - k) * (-95) + k * 78];
        }
        const k = easeInOutQuint((u - 0.45) / 0.55);
        return [(1 - k) * (-92), (1 - k) * 78];
      };
      const [px, py] = samplePan(uPan);
      const [nx, ny] = samplePan(clamp01(uPan + 0.006));
      state.cad2dPanX = px;
      state.cad2dPanY = py;
      state.cad2dVelX = (nx - px) * 2.4;
      state.cad2dVelY = (ny - py) * 2.4;
    }

    state.webglAlpha = smoothRange(t, Math.max(0, tLock - 0.05), tLock + 0.01);

    const kCam = applyVideoEasing(smoothRange(t, tLock, 0.72), easeMode);
    const kHold = easeInOutCubic(smoothRange(t, 0.72, 1.0));
    state.camPitch = (1.568 * (1 - kCam) + 0.54 * kCam) - 0.03 * kHold;
    state.camYaw = (0.0 * (1 - kCam) + (-0.64) * kCam) + 0.20 * kHold;
    state.camDist = 268 * (1 - kCam) + (288 + 16 * kHold) * kCam;
    state.camTarget = [0, -3.5 * kCam, 2.8 * kCam];

    const ext = applyVideoEasing(smoothRange(t, tLock + 0.02, 0.66), easeMode);
    state.layerExtrude = [ext, ext, ext, ext, ext, ext];
    state.waveMode = wModeNum;
    state.waveProgress = wModeNum > 0 ? smoothRange(t, tLock + 0.01, 0.67) : 1.0;

    state.frameAssemble = applyVideoEasing(smoothRange(t, 0.50, 0.72), easeMode);
    state.glassDrop = easeInOutCubic(smoothRange(t, 0.70, 0.84));
    state.glassSweep = -1.1 + 2.4 * easeInOutCubic(smoothRange(t, 0.78, 0.96));

    const cross = easeInOutCubic(smoothRange(t, 0.64, 0.82));
    state.wireMix = 1.0 - cross;
    state.bgMix = cross;
    state.sunDeg = baseSun - 28 + 38 * easeInOutCubic(smoothRange(t, 0.60, 1.0));
    state.packshotBadgeAlpha = easeInOutCubic(smoothRange(t, 0.84, 0.92));

  } else if (sb === 'layer_build') {
    const kOrbit = easeInOutCubic(t);
    state.camPitch = 0.64 - 0.12 * kOrbit;
    state.camYaw = -0.82 + 0.42 * kOrbit;
    state.camDist = 295 - 12 * Math.sin(t * Math.PI);
    state.camTarget = [0, -3.0, 2.6];

    const spans = [[0.03, 0.18], [0.14, 0.30], [0.27, 0.43], [0.40, 0.56], [0.52, 0.70], [0.64, 0.77]];
    state.layerExtrude = spans.map(([a, b]) => applyVideoEasing(smoothRange(t, a, b), easeMode));
    state.waveMode = wModeNum;
    state.waveProgress = wModeNum > 0 ? smoothRange(t, 0.04, 0.75) : 1.0;

    state.frameAssemble = applyVideoEasing(smoothRange(t, 0.73, 0.88), easeMode);
    state.glassDrop = easeInOutCubic(smoothRange(t, 0.83, 0.93));
    state.glassSweep = -1.1 + 2.4 * easeInOutCubic(smoothRange(t, 0.86, 0.99));

    const cross = easeInOutCubic(smoothRange(t, 0.0, 0.25));
    state.wireMix = (1.0 - cross) * 0.65;
    state.bgMix = 0.25 + 0.75 * cross;
    state.sunDeg = baseSun - 20 + 35 * kOrbit;
    state.packshotBadgeAlpha = easeInOutCubic(smoothRange(t, 0.86, 0.94));

  } else if (sb === 'laser_scan_morph') {
    const kTilt = applyVideoEasing(smoothRange(t, 0.04, 0.45), easeMode);
    state.camPitch = 1.56 * (1 - kTilt) + 0.52 * kTilt;
    state.camYaw = -0.10 * (1 - kTilt) + (-0.48 + 0.14 * smoothRange(t, 0.45, 1.0)) * kTilt;
    state.camDist = 266 + 24 * kTilt;
    state.camTarget = [0, -3.0 * kTilt, 2.6 * kTilt];

    state.waveMode = wModeNum === 0 ? 1 : wModeNum;
    state.waveProgress = easeInOutCubic(smoothRange(t, 0.10, 0.68));
    state.layerExtrude = [1, 1, 1, 1, 1, 1];

    state.frameAssemble = applyVideoEasing(smoothRange(t, 0.64, 0.82), easeMode);
    state.glassDrop = easeInOutCubic(smoothRange(t, 0.78, 0.90));
    state.glassSweep = -1.1 + 2.4 * easeInOutCubic(smoothRange(t, 0.82, 0.97));

    const cross = easeInOutCubic(smoothRange(t, 0.20, 0.68));
    state.wireMix = 1.0 - cross;
    state.bgMix = cross;
    state.sunDeg = baseSun - 25 + 40 * smoothRange(t, 0.3, 1.0);
    state.packshotBadgeAlpha = easeInOutCubic(smoothRange(t, 0.84, 0.92));

  } else if (sb === 'exploded_snap') {
    const kSnapZ = applyVideoEasing(smoothRange(t, 0.32, 0.68), easeMode);
    const kSnapTiles = applyVideoEasing(smoothRange(t, 0.16, 0.52), easeMode);
    state.explodeZ = (1.0 - kSnapZ) * 0.88;
    state.tileExplode = (1.0 - kSnapTiles) * 0.72;

    const kCam = easeInOutCubic(smoothRange(t, 0.0, 0.78));
    state.camPitch = 0.33 * (1 - kCam) + 0.55 * kCam;
    state.camYaw = -0.76 + 0.34 * easeInOutCubic(t);
    state.camDist = 328 * (1 - kCam) + 286 * kCam;
    state.camTarget = [0, -2.5, (1 - kSnapZ) * 18.0 + 2.5];

    state.frameAssemble = applyVideoEasing(smoothRange(t, 0.58, 0.82), easeMode);
    state.glassDrop = easeInOutCubic(smoothRange(t, 0.76, 0.89));
    state.glassSweep = -1.1 + 2.4 * easeInOutCubic(smoothRange(t, 0.82, 0.97));

    state.wireMix = (1.0 - easeInOutCubic(smoothRange(t, 0.08, 0.42))) * 0.75;
    state.bgMix = easeInOutCubic(smoothRange(t, 0.12, 0.48));
    state.sunDeg = baseSun - 18 + 32 * t;
    state.packshotBadgeAlpha = easeInOutCubic(smoothRange(t, 0.84, 0.92));

  } else {
    state.camPitch = 0.54 + 0.10 * Math.sin(t * Math.PI * 2.0);
    state.camYaw = -0.48 + t * Math.PI * 2.0;
    state.camDist = 286 - 18 * Math.sin(t * Math.PI);
    state.camTarget = [0, -3.0, 2.8];
    state.frameAssemble = applyVideoEasing(smoothRange(t, 0.0, 0.15), easeMode);
    state.glassDrop = easeInOutCubic(smoothRange(t, 0.08, 0.22));
    state.glassSweep = -1.1 + 2.4 * easeInOutCubic(smoothRange(t, 0.55, 0.82));
    state.wireMix = 0.0;
    state.bgMix = 1.0;
    state.sunDeg = baseSun + t * 140.0;
    state.packshotBadgeAlpha = easeInOutCubic(smoothRange(t, 0.78, 0.90));
  }

  if (styleMode === 'pure_studio') {
    state.wireMix = 0.0;
    state.bgMix = 1.0;
  } else if (styleMode === 'pure_blueprint') {
    state.wireMix = 1.0;
    state.bgMix = 0.0;
  } else if (styleMode === 'hybrid_cad') {
    state.wireMix = Math.max(0.28, state.wireMix);
  }

  return state;
}

function drawVideoTelemetryOverlay(ctx, w, h, alpha, scroll, telemetryRows) {
  if (alpha <= 0.01 || !telemetryRows || !telemetryRows.length) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, w, h);

  const fontSize = Math.max(10, Math.round(h * 0.0145));
  ctx.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = 'rgba(218, 228, 242, 0.86)';

  const lineH = Math.round(fontSize * 1.42);
  const cols = 3;
  const colW = Math.floor((w * 0.84) / cols);
  const startX = Math.floor(w * 0.08);
  const maxRowsPerCol = Math.min(42, Math.floor((h * 0.86) / lineH));
  const wipeY = scroll > 0.72 ? ((scroll - 0.72) / 0.28) * h * 1.15 : -1;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < maxRowsPerCol; r++) {
      const y = Math.floor(h * 0.07) + r * lineH;
      if (wipeY > 0 && y < wipeY) continue;
      const idx = (c * maxRowsPerCol + r + Math.floor(scroll * 28)) % telemetryRows.length;
      ctx.fillText(telemetryRows[idx], startX + c * colW, y);
    }
  }

  if (wipeY > 0 && wipeY < h) {
    const grad = ctx.createLinearGradient(0, wipeY - 36, 0, wipeY + 12);
    grad.addColorStop(0, 'rgba(4,6,10,1)');
    grad.addColorStop(0.75, 'rgba(148,197,255,0.28)');
    grad.addColorStop(1, 'rgba(4,6,10,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, Math.max(0, wipeY - 36), w, 48);
  }
  ctx.restore();
}

function drawVideo2DCadWhipPanOverlay(ctx, w, h, animState, cad2D, slot0Cfg) {
  if (animState.cad2dAlpha <= 0.01 || !cad2D || !slot0Cfg) return;
  const tanHalfFov = Math.tan((17 * Math.PI) / 180.0);
  const pxPerUnit = (h * 0.5) / (268.0 * tanHalfFov);

  const cropHalfPxW = slot0Cfg.halfW * pxPerUnit;
  const cropHalfPxH = slot0Cfg.halfH * pxPerUnit;
  const cx = w * 0.5;
  const cy = h * 0.5;

  ctx.save();
  ctx.globalAlpha = animState.cad2dAlpha;
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, w, h);

  const speed = Math.hypot(animState.cad2dVelX, animState.cad2dVelY);
  const blurSamples = speed > 3.5 ? 5 : 1;

  const renderMapAtOffset = (ox, oy, sampleAlpha) => {
    ctx.save();
    ctx.globalAlpha = animState.cad2dAlpha * sampleAlpha;
    const tileSpan = 169.2;
    for (let ty = -1; ty <= 1; ty++) {
      for (let tx = -1; tx <= 1; tx++) {
        const isCenterTile = (tx === 0 && ty === 0);
        if (!isCenterTile && animState.cad2dExteriorAlpha <= 0.02) continue;
        const baseShiftX = ox + tx * tileSpan;
        const baseShiftY = oy + ty * tileSpan;
        const flipX = (Math.abs(tx) % 2 === 1) ? -1 : 1;
        const flipY = (Math.abs(ty) % 2 === 1) ? -1 : 1;

        ctx.strokeStyle = isCenterTile ? 'rgba(148, 163, 184, 0.52)' : `rgba(100, 116, 139, ${0.32 * animState.cad2dExteriorAlpha})`;
        ctx.lineWidth = Math.max(1.0, pxPerUnit * 0.55);
        ctx.beginPath();
        const rStep = isCenterTile ? 1 : 2;
        for (let i = 0; i < cad2D.roads.length; i += rStep) {
          const pts = cad2D.roads[i].pts;
          for (let p = 0; p < pts.length; p++) {
            const sx = cx + (pts[p][0] * flipX + baseShiftX) * pxPerUnit;
            const sy = cy - (pts[p][1] * flipY + baseShiftY) * pxPerUnit;
            if (p === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
        }
        ctx.stroke();

        ctx.strokeStyle = isCenterTile ? 'rgba(241, 245, 249, 0.88)' : `rgba(203, 213, 225, ${0.42 * animState.cad2dExteriorAlpha})`;
        ctx.lineWidth = Math.max(0.85, pxPerUnit * 0.34);
        ctx.beginPath();
        const bStep = isCenterTile ? 1 : 3;
        for (let i = 0; i < cad2D.bldOuters.length; i += bStep) {
          const pts = cad2D.bldOuters[i].pts;
          if (pts.length < 3) continue;
          for (let p = 0; p < pts.length; p++) {
            const sx = cx + (pts[p][0] * flipX + baseShiftX) * pxPerUnit;
            const sy = cy - (pts[p][1] * flipY + baseShiftY) * pxPerUnit;
            if (p === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  if (blurSamples === 1) {
    renderMapAtOffset(animState.cad2dPanX, animState.cad2dPanY, 1.0);
  } else {
    for (let s = 0; s < blurSamples; s++) {
      const f = (s / (blurSamples - 1)) - 0.5;
      renderMapAtOffset(animState.cad2dPanX + animState.cad2dVelX * f, animState.cad2dPanY + animState.cad2dVelY * f, 0.30);
    }
  }

  const rx0 = cx - cropHalfPxW;
  const ry0 = cy - cropHalfPxH;
  const rw = cropHalfPxW * 2;
  const rh = cropHalfPxH * 2;
  const dimAlpha = 0.68 + 0.32 * (1.0 - animState.cad2dExteriorAlpha);

  ctx.fillStyle = `rgba(5, 7, 11, ${dimAlpha})`;
  ctx.fillRect(0, 0, w, Math.max(0, ry0));
  ctx.fillRect(0, ry0 + rh, w, Math.max(0, h - (ry0 + rh)));
  ctx.fillRect(0, ry0, Math.max(0, rx0), rh);
  ctx.fillRect(rx0 + rw, ry0, Math.max(0, w - (rx0 + rw)), rh);

  if (animState.reticleAlpha > 0.02) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.92 * animState.reticleAlpha})`;
    ctx.lineWidth = Math.max(1.8, h * 0.0024);
    ctx.strokeRect(rx0, ry0, rw, rh);
  }
  ctx.restore();
}

function drawVideoOrderPackshotHud(ctx, w, h, animState, animCfg, gpuSlots) {
  if (!animCfg.showOrderHud || animState.packshotBadgeAlpha <= 0.02 || !gpuSlots.length) return;
  const s0 = gpuSlots[0].cfg;
  const numSlots = gpuSlots.length;
  const frameInfo = VIDEO_FRAME_FINISHES[s0.frameStyle] || VIDEO_FRAME_FINISHES.black;

  ctx.save();
  ctx.globalAlpha = animState.packshotBadgeAlpha;

  const pad = Math.round(h * 0.032);
  const boxH = Math.round(h * 0.088);
  const titlePx = Math.max(13, Math.round(boxH * 0.30));
  const subPx = Math.max(10, Math.round(boxH * 0.21));
  const setLabel = numSlots > 1 ? `ZESTAW ${numSlots} RAMEK • ` : '';
  const titleLine = `${setLabel}${s0.title} — ${animCfg.dimensionsLabel || '30×30 cm'}`;
  const specLine = `${frameInfo.label}${s0.showGlass ? ' + Szyba Akrylowa' : ''} • ${animCfg.priceLabel || 'Gotowy produkt 3D'}`;

  ctx.font = `700 ${titlePx}px "Inter", system-ui, sans-serif`;
  const titleW = ctx.measureText(titleLine).width;
  ctx.font = `500 ${subPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const specW = ctx.measureText(specLine).width;

  const boxW = Math.min(w - pad * 2, Math.max(Math.round(h * 0.50), Math.ceil(Math.max(titleW, specW)) + 36));
  const bx = pad;
  const by = h - pad - boxH;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = `700 ${titlePx}px "Inter", system-ui, sans-serif`;
  ctx.fillText(titleLine, bx + 18, by + Math.round(boxH * 0.44));

  ctx.fillStyle = '#94a3b8';
  ctx.font = `500 ${subPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(specLine, bx + 18, by + Math.round(boxH * 0.78));

  ctx.restore();
}
