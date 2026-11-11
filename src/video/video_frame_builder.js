// ============================================================================
// src/video/video_frame_builder.js
// Parametric 3D Gallery Frame (45° Mitered 4-Rail Shadow Box), Contrast Backing,
// Passe-partout Mat, Engraved Plaque Texture & Acrylic Museum Glass Builder.
// ============================================================================

function pushVideoQuadPrism(quad2d, zBot, zTop, layerId, subId, outList) {
  extrudeBuildingLoD2(quad2d, [], zBot, zTop, zTop, false, layerId, -1, outList, subId, 'flat');
  for (let i = outList.length - 1; i >= 0; i--) {
    if (outList[i]._taggedSub) break;
    outList[i].subId = subId;
    outList[i].groundZ = zBot;
    outList[i]._taggedSub = true;
  }
}

function createVideoPlaqueTexture(gl, slotCfg) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');

  const matInfo = VIDEO_MAT_STYLES[slotCfg.matStyle] || VIDEO_MAT_STYLES.gallery_white;
  const frameInfo = VIDEO_FRAME_FINISHES[slotCfg.frameStyle] || VIDEO_FRAME_FINISHES.black;
  const isMinimal = slotCfg.matStyle === 'none';

  g.clearRect(0, 0, c.width, c.height);

  if (isMinimal) {
    const padX = 180, padY = 34, bw = c.width - padX * 2, bh = c.height - padY * 2;
    g.fillStyle = frameInfo.plaqueBg;
    g.strokeStyle = frameInfo.plaqueAcc;
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(padX, padY, bw, bh, 14);
    g.fill();
    g.stroke();

    g.fillStyle = frameInfo.plaqueFg;
    g.textAlign = 'center';
    g.font = '700 66px "Inter", "SF Pro Display", system-ui, sans-serif';
    g.letterSpacing = '8px';
    g.fillText((slotCfg.title || 'MÜNCHEN').toUpperCase(), c.width / 2, 118);

    g.fillStyle = frameInfo.plaqueAcc;
    g.font = '500 26px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.letterSpacing = '2px';
    const metaLine = [slotCfg.subtitle, slotCfg.coordsText].filter(Boolean).join('  •  ');
    g.fillText(metaLine.slice(0, 56), c.width / 2, 174);
  } else {
    const r = Math.round(matInfo.rgb[0] * 255);
    const gr = Math.round(matInfo.rgb[1] * 255);
    const b = Math.round(matInfo.rgb[2] * 255);
    g.fillStyle = `rgb(${r},${gr},${b})`;
    g.fillRect(0, 0, c.width, c.height);

    g.strokeStyle = matInfo.textSub;
    g.globalAlpha = 0.35;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(140, 26);
    g.lineTo(c.width - 140, 26);
    g.stroke();
    g.globalAlpha = 1.0;

    g.fillStyle = matInfo.textFg;
    g.textAlign = 'center';
    g.font = '800 76px "Inter", "SF Pro Display", system-ui, sans-serif';
    g.fillText((slotCfg.title || 'MÜNCHEN').toUpperCase(), c.width / 2, 118);

    if (slotCfg.subtitle) {
      g.fillStyle = matInfo.textFg;
      g.globalAlpha = 0.82;
      g.font = '600 28px "Inter", system-ui, sans-serif';
      g.fillText(slotCfg.subtitle.toUpperCase(), c.width / 2, 168);
      g.globalAlpha = 1.0;
    }

    g.fillStyle = matInfo.textSub;
    g.font = '500 24px ui-monospace, SFMono-Regular, Menlo, monospace';
    const bottomLine = [slotCfg.coordsText, slotCfg.scaleText].filter(Boolean).join('   |   ');
    g.fillText(bottomLine, c.width / 2, 214);
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function buildVideoProductFrameBuffers(slotCfg, hasBaseLayer) {
  const halfW = slotCfg.halfW;
  const halfH = slotCfg.halfH;
  const matInfo = VIDEO_MAT_STYLES[slotCfg.matStyle] || VIDEO_MAT_STYLES.none;
  const hasMat = matInfo.margin > 0.5;
  const mSide = hasMat ? matInfo.margin : 0.0;
  const mTop = hasMat ? matInfo.margin : 0.0;
  const mBot = hasMat ? (slotCfg.showPlaque ? 27.5 : matInfo.margin) : 0.0;

  const innerX = halfW + mSide + 0.25;
  const innerYTop = halfH + mTop + 0.25;
  const innerYBot = halfH + mBot + 0.25;
  const frameRim = 9.4;
  const outerX = innerX + frameRim;
  const outerYTop = innerYTop + frameRim;
  const outerYBot = innerYBot + frameRim;

  // 1. Contrast Backing Plate (lid = 8, subId = 0)
  const backingTopZ = hasBaseLayer ? -0.04 : 2.38;
  const backingTris = [];
  pushVideoQuadPrism(
    [[-innerX - 1.0, -innerYBot - 1.0], [innerX + 1.0, -innerYBot - 1.0], [innerX + 1.0, innerYTop + 1.0], [-innerX - 1.0, innerYTop + 1.0]],
    -2.15, backingTopZ, 8, 0, backingTris
  );

  // 2. Passe-partout Matboard Border (lid = 8, subId = 1)
  const matTris = [];
  if (hasMat) {
    const zMatBot = 0.0;
    const zMatTop = 3.55;
    const ix = halfW - 0.15;
    const iy = halfH - 0.15;
    pushVideoQuadPrism([[-innerX, -innerYBot], [innerX, -innerYBot], [innerX, -iy], [-innerX, -iy]], zMatBot, zMatTop, 8, 1, matTris);
    pushVideoQuadPrism([[ix, -iy], [innerX, -iy], [innerX, iy], [ix, iy]], zMatBot, zMatTop, 8, 1, matTris);
    pushVideoQuadPrism([[-innerX, iy], [innerX, iy], [innerX, innerYTop], [-innerX, innerYTop]], zMatBot, zMatTop, 8, 1, matTris);
    pushVideoQuadPrism([[-innerX, -iy], [-ix, -iy], [-ix, iy], [-innerX, iy]], zMatBot, zMatTop, 8, 1, matTris);
  }

  // 3. Mitered 4-Rail Deep Shadow-Box Gallery Frame (lid = 6, subId = 0,1,2,3)
  const frameTris = [];
  const zFBot = -2.42;
  const zFTop = 6.75;
  const miterRails = [
    [[-outerX, -outerYBot], [outerX, -outerYBot], [innerX, -innerYBot], [-innerX, -innerYBot]],
    [[outerX, -outerYBot], [outerX, outerYTop], [innerX, innerYTop], [innerX, -innerYBot]],
    [[outerX, outerYTop], [-outerX, outerYTop], [-innerX, innerYTop], [innerX, innerYTop]],
    [[-outerX, outerYTop], [-outerX, -outerYBot], [-innerX, -innerYBot], [-innerX, innerYTop]]
  ];
  miterRails.forEach((mq, rIdx) => {
    pushVideoQuadPrism(mq, zFBot, zFTop, 6, rIdx, frameTris);
  });

  // 4. Engraved Plaque Quad (lid = 9)
  const plaqueTris = [];
  let plaqueBounds = [-40, -halfH - 24, 40, -halfH - 3];
  if (slotCfg.showPlaque) {
    let px0, px1, py0, py1, pz;
    if (hasMat) {
      const pw = Math.min(innerX * 1.65, 138.0);
      px0 = -pw * 0.5;
      px1 = pw * 0.5;
      py0 = -innerYBot + 1.8;
      py1 = -halfH - 1.4;
      pz = 3.60;
    } else {
      const pw = Math.min(outerX * 1.05, 92.0);
      px0 = -pw * 0.5;
      px1 = pw * 0.5;
      py0 = -outerYBot + 0.6;
      py1 = -innerYBot - 0.5;
      pz = zFTop + 0.08;
    }
    plaqueBounds = [px0, py0, px1, py1];
    plaqueTris.push(
      { v0: [px0, py0, pz], v1: [px1, py0, pz], v2: [px1, py1, pz], n: [0, 0, 1], layerId: 9, groundZ: pz, subId: 0 },
      { v0: [px0, py0, pz], v1: [px1, py1, pz], v2: [px0, py1, pz], n: [0, 0, 1], layerId: 9, groundZ: pz, subId: 0 }
    );
  }

  // 5. Acrylic Museum Glass Sheet (lid = 10)
  const glassTris = [];
  if (slotCfg.showGlass) {
    const gz = zFTop - 0.35;
    glassTris.push(
      { v0: [-innerX, -innerYBot, gz], v1: [innerX, -innerYBot, gz], v2: [innerX, innerYTop, gz], n: [0, 0, 1], layerId: 10, groundZ: gz, subId: 0 },
      { v0: [-innerX, -innerYBot, gz], v1: [innerX, innerYTop, gz], v2: [-innerX, innerYTop, gz], n: [0, 0, 1], layerId: 10, groundZ: gz, subId: 0 }
    );
  }

  return {
    outerX,
    outerYBot,
    outerYTop,
    plaqueBounds,
    backingTris,
    matTris,
    frameTris,
    plaqueTris,
    glassTris
  };
}
