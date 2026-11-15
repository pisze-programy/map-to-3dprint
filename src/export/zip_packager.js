// ============================================================================
// src/export/zip_packager.js
// Multi-Tile SLA .ZIP Packager (R1C1..RnCm Tiles + Optional Frame Segments +
// Complete Polish Anycubic Photon Mono 4 Assembly & Post-Processing Guide)
// ============================================================================

if (typeof buildBinarySTLBytes === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./export_io_utils.js'));
  Object.assign(global, require('./stl_writer.js'));
  Object.assign(global, require('../mesh/mesh_clipper_3d.js'));
}

function exportAllTilesZipSTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const numTiles = tileCols * tileRows;
  const {
    totalWidthMm: totalW,
    totalHeightMm: totalH,
    scaleMm,
    halfW,
    halfH
  } = resolveSceneScaleAndSpec(state, null);
  const cfg = (typeof PRINT_PHYSICS_CONFIG !== 'undefined') ? PRINT_PHYSICS_CONFIG : null;
  const mono4 = cfg ? cfg.photonMono4 : { bedXMm: 153.45, bedYMm: 87.05, frameSplitMaxMm: 148.0 };
  const resinCfg = cfg ? cfg.resin : { defaultKerfMm: 0.08, densityGPerMl: 1.12 };
  const defFrameWidthMm = cfg ? cfg.defaultFrameWidthMm : 12.0;

  const targetW_cm = (totalW / 10).toFixed(1);
  const targetH_cm = (totalH / 10).toFixed(1);
  const tileW = totalW / tileCols;
  const tileH = totalH / tileRows;
  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const pm = (state && state.printMetrics) || {};
  const isResin = Boolean(state && (state.isResin || state.printerPreset === 'photon_mono_4'));
  const kerfMm = isResin ? (state.kerfMm !== undefined ? state.kerfMm : resinCfg.defaultKerfMm) : 0.0;

  const fitsNormal = (tileW <= mono4.bedXMm && tileH <= mono4.bedYMm);
  const fitsRotated = (tileH <= mono4.bedXMm && tileW <= mono4.bedYMm);
  const isAutoRotated = isResin && (!fitsNormal && fitsRotated);

  const zipFiles = [];
  const tileEntries = [];

  let fileIdx = 1;
  const waterCutout = Boolean(state && state.waterCutout);
  for (let tr = tileRows - 1; tr >= 0; tr--) {
    const northRow = tileRows - tr;
    for (let tc = 0; tc < tileCols; tc++) {
      const tid = tr * tileCols + tc;
      const stlBytes = buildBinarySTLBytes(state, layerFilter, tid);
      const isEmptyCutoutTile = waterCutout && numTiles > 1 && stlBytes.byteLength <= 84;
      const tVolMl = (pm.tileVolumesMl && pm.tileVolumesMl[tid] !== undefined)
        ? pm.tileVolumesMl[tid].toFixed(1)
        : (isEmptyCutoutTile ? '0.0' : ((pm.totalVolumeMl || 40) / numTiles).toFixed(1));
      const tGrams = Math.round(parseFloat(tVolMl) * resinCfg.densityGPerMl);
      const tZ = (pm.tileMaxZMm && pm.tileMaxZMm[tid] !== undefined)
        ? pm.tileMaxZMm[tid]
        : (isEmptyCutoutTile ? 0.0 : (pm.maxZMm || 20));
      const fileName = `Kafel_${String(fileIdx++).padStart(2, '0')}_R${northRow}C${tc + 1}_${Math.round(tileW)}x${Math.round(tileH)}mm.stl`;
      if (!isEmptyCutoutTile) {
        zipFiles.push({ name: fileName, content: stlBytes });
      }
      tileEntries.push({
        fileName,
        skippedEmptyWater: isEmptyCutoutTile,
        id: tid,
        r: northRow,
        c: tc + 1,
        name: `R${northRow}C${tc + 1}`,
        volMl: tVolMl,
        grams: tGrams,
        w: tileW.toFixed(1),
        h: tileH.toFixed(1),
        maxZ: typeof tZ === 'number' ? tZ : parseFloat(tZ)
      });
    }
  }

  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const frameTris = meshesObj.frame || [];
  const frameEntries = [];

  if (state && state.exportFrame && frameTris.length > 0) {
    const frameWidthMm = (state && Number(state.frameWidthMm) > 0) ? Number(state.frameWidthMm) : defFrameWidthMm;
    const frameTotalWidthMm = totalW + 2 * frameWidthMm;
    const frameTotalHeightMm = totalH + 2 * frameWidthMm;
    const frameWidthUnits = frameWidthMm / scaleMm;
    const outerHalfW = halfW + frameWidthUnits;
    const outerHalfH = halfH + frameWidthUnits;

    const canClip = typeof clipMeshToBox3D === 'function';
    const fCols = Math.max(1, Math.ceil(frameTotalWidthMm / mono4.frameSplitMaxMm));
    const fRows = Math.max(1, Math.ceil(frameTotalHeightMm / mono4.frameSplitMaxMm));
    const frameShiftZMm = (typeof computeFrameZShiftMm === 'function') ? computeFrameZShiftMm(frameTris, scaleMm) : 0;

    if (canClip && (fCols > 1 || fRows > 1)) {
      const colSpanScene = (2 * outerHalfW) / fCols;
      const rowSpanScene = (2 * outerHalfH) / fRows;
      let fIdx = 1;
      for (let fr = fRows - 1; fr >= 0; fr--) {
        const segNorthRow = fRows - fr;
        for (let fc = 0; fc < fCols; fc++) {
          const x0 = -outerHalfW + fc * colSpanScene;
          const x1 = (fc === fCols - 1) ? outerHalfW : -outerHalfW + (fc + 1) * colSpanScene;
          const y0 = -outerHalfH + fr * rowSpanScene;
          const y1 = (fr === fRows - 1) ? outerHalfH : -outerHalfH + (fr + 1) * rowSpanScene;
          const clipped = clipMeshToBox3D(frameTris, x0, x1, y0, y1, -1);
          if (clipped && clipped.length > 0) {
            const segW = (x1 - x0) * scaleMm;
            const segH = (y1 - y0) * scaleMm;
            const segFitsNormal = (segW <= mono4.bedXMm && segH <= mono4.bedYMm);
            const segFitsRotated = (segH <= mono4.bedXMm && segW <= mono4.bedYMm);
            const segRotate = isResin && (!segFitsNormal && segFitsRotated);
            const segBytes = buildSTLBytesFromTriangles(clipped, -x0, -y0, scaleMm, segW, segH, state, segRotate, frameShiftZMm);
            const segName = `Rama_${String(fIdx++).padStart(2, '0')}_R${segNorthRow}C${fc + 1}_${Math.round(segW)}x${Math.round(segH)}mm.stl`;
            zipFiles.push({ name: segName, content: segBytes });
            frameEntries.push({ name: segName, w: segW.toFixed(1), h: segH.toFixed(1), rot: segRotate });
          }
        }
      }
    } else {
      const fullFrameFitsNormal = (frameTotalWidthMm <= mono4.bedXMm && frameTotalHeightMm <= mono4.bedYMm);
      const fullFrameFitsRotated = (frameTotalHeightMm <= mono4.bedXMm && frameTotalWidthMm <= mono4.bedYMm);
      const fullRotate = isResin && (!fullFrameFitsNormal && fullFrameFitsRotated);
      const fullFrameBytes = buildSTLBytesFromTriangles(
        frameTris, outerHalfW, outerHalfH, scaleMm, frameTotalWidthMm, frameTotalHeightMm, state, fullRotate, frameShiftZMm
      );
      const segName = `Rama_01_Pelna_${Math.round(frameTotalWidthMm)}x${Math.round(frameTotalHeightMm)}mm.stl`;
      zipFiles.push({ name: segName, content: fullFrameBytes });
      frameEntries.push({ name: segName, w: frameTotalWidthMm.toFixed(1), h: frameTotalHeightMm.toFixed(1), rot: fullRotate });
    }
  }

  const reportLines = [
    `================================================================================`,
    `MAP3D PRINT STUDIO — PRZEWODNIK DRUKU I MONTAŻU PŁASKORZEŹBY ŚCIENNEJ (WALL ART)`,
    `Kompatybilność z drukarkami Anycubic Photon Mono 4 (153.4 x 87.0 x 165.0 mm)`,
    `================================================================================`,
    ``,
    `1. PARAMETRY MODELU I ROZMIAR DOCELOWY:`,
    `--------------------------------------------------------------------------------`,
    `Model:                       ${(state && state.plaqueText) || 'MAP3D'}`,
    `Wymiary docelowe obrazu:     ${targetW_cm} x ${targetH_cm} cm  (${totalW} x ${totalH} mm)`,
    `Maksymalna wysokość reliefu: ${(pm.maxZMm || 20).toFixed(1)} mm (oś Z)` + (pm.zCapApplied ? ` [Z-Cap: ograniczono do <= ${(pm.zCapLimitMm || 163).toFixed(1)} mm dla osi Z drukarki]` : ''),
    `Podział na kafle:            ${tileCols} kolumn x ${tileRows} wierszy (${numTiles} kafli ogółem)`,
    `Wymiar pojedynczego kafla:   ${tileW.toFixed(1)} x ${tileH.toFixed(1)} mm`,
    `Auto-rotacja dla Mono 4:     ${isAutoRotated ? `TAK (+90° XY: wymiar na stole ${tileH.toFixed(1)} x ${tileW.toFixed(1)} mm <= 153.4 x 87.0 mm)` : `NIE (mieści się w układzie standardowym <= 153.4 x 87.0 mm)`}`,
    `Odchudzona baza (Hollow):    ${state && state.hollowBase ? `TAK (Ścianka ${state.hollowWallMm || 1.8} mm + kanały drenażowe SLA, oszczędność ~${pm.hollowSavingsPct || 45}%)` : 'NIE (Pełna baza z=0 pod lity wydruk FDM/SLA)'}`,
    `Wycięcie wody (Cutout):      ${waterCutout ? 'TAK (Woda wycięta do Z=0 pod czarny/drewniany podkład)' : 'NIE (Pełna tafla wody 3D)'}`,
    `Objętość żywicy całkowita:   ~${(pm.totalVolumeMl || 0).toFixed(1)} ml (~${pm.resinGrams || 0} g żywicy / ~${pm.plaGrams || 0} g PLA)`,
    `Tolerancja montażowa (Kerf): ${kerfMm.toFixed(2)} mm (fabryczny luz kompensujący rozszerzalność światła UV)`,
    `Ramka dekoracyjna 3D:        ${frameEntries.length > 0 ? `DOŁĄCZONA (${frameEntries.length} segmentów)` : 'WYŁĄCZONA Z PACZKI (wyłącznie podgląd 3D Studio)'}`,
    ``,
    `2. SCHEMAT ROZMIESZCZENIA KAFLI NA ŚCIANIE (ASCII GRID MAP):`,
    `--------------------------------------------------------------------------------`,
    generateAsciiGrid(tileCols, tileRows),
    ``,
    `3. OZNACZENIA NA SPODZIE KAFLI I ORIENTACJA:`,
    `--------------------------------------------------------------------------------`,
    `Każdy kafel posiada na spodzie wklęsłe oznaczenie pozycji w siatce oraz strzałkę,`,
    `np. 'R1C1 ↑'.`,
    `  - 'R' (Row)    : numer wiersza liczony od góry (R1 = wiersz północny).`,
    `  - 'C' (Column) : numer kolumny liczony od lewej (C1 = kolumna zachodnia).`,
    `  - '↑' (Strzałka): wskazuje PÓŁNOC i jednocześnie GÓRĘ gotowego obrazu na ścianie.`,
    ``,
    `4. LISTA PLIKÓW KAFLI W ARCHIWUM ZIP:`,
    `--------------------------------------------------------------------------------`
  ];

  tileEntries.forEach(e => {
    if (e.skippedEmptyWater) {
      reportLines.push(`  - ${e.fileName.padEnd(38, ' ')} | Kafel [R${e.r}C${e.c}] | [POMINIĘTO — 100% wycięta woda (pusta tafla na podkład)]`);
    } else {
      reportLines.push(`  - ${e.fileName.padEnd(38, ' ')} | Kafel [R${e.r}C${e.c}] | Wymiar: ${e.w} x ${e.h} mm (Z: ${e.maxZ.toFixed(1)} mm) | Żywica: ~${e.volMl} ml (~${e.grams} g)`);
    }
  });

  if (frameEntries.length > 0) {
    reportLines.push(``, `5. SEGMENTY MODUŁOWEJ RAMKI 3D:`, `--------------------------------------------------------------------------------`);
    frameEntries.forEach(fe => {
      reportLines.push(`  - ${fe.name.padEnd(38, ' ')} | Wymiar segmentu: ${fe.w} x ${fe.h} mm ${fe.rot ? '(Obrócony o 90° dla Mono 4)' : ''}`);
    });
  }

  const getPairingSchedFn = () => {
    if (typeof computeZHeightPairingSchedule === 'function') return computeZHeightPairingSchedule;
    if (typeof window !== 'undefined' && typeof window.computeZHeightPairingSchedule === 'function') return window.computeZHeightPairingSchedule;
    try {
      return require('../ui/ui_config.js').computeZHeightPairingSchedule;
    } catch (_) {
      return null;
    }
  };
  const pairingFn = getPairingSchedFn();
  const printableTileEntries = tileEntries.filter(e => !e.skippedEmptyWater);
  if (isResin && printableTileEntries.length > 1 && typeof pairingFn === 'function') {
    const sched = pairingFn(printableTileEntries, tileW, tileH);
    reportLines.push(
      ``,
      `HARMONOGRAM DRUKU WSADOWEGO (PHOTON MONO 4 DUAL-TILE PAIRING):`,
      `--------------------------------------------------------------------------------`,
      `Podwójne pakowanie na stół 153.4 x 87.0 mm: ${sched.isDualPackable ? 'TAK (2 kafle na wsad)' : 'NIE (kafel przekracza 75 x 84 mm)'}`,
      `Liczba wsadów drukarki:                      ${sched.totalRuns} (zamiast ${sched.numTiles} osobnych wydruków)`,
      `Suma wysokości Z w kolejności:              ${sched.sequentialSumZMm.toFixed(1)} mm`,
      `Suma wysokości Z po optymalizacji:          ${sched.pairedSumZMm.toFixed(1)} mm`,
      `Oszczędność czasu druku w osi Z:             ${sched.savedZMm.toFixed(1)} mm (-${sched.savingsPct}%)`,
      ``,
      `Szczegóły wsadów (kolejność malejąco wg max Z):`
    );
    sched.runs.forEach(r => {
      if (r.tiles.length === 2) {
        reportLines.push(`  - Wsad ${r.runIndex}: Kafel R${r.tiles[0].r}C${r.tiles[0].c} (${r.tiles[0].maxZ.toFixed(1)} mm) + Kafel R${r.tiles[1].r}C${r.tiles[1].c} (${r.tiles[1].maxZ.toFixed(1)} mm) -> wysokość wsadu: ${r.runMaxZ.toFixed(1)} mm`);
      } else {
        reportLines.push(`  - Wsad ${r.runIndex}: Kafel R${r.tiles[0].r}C${r.tiles[0].c} (${r.tiles[0].maxZ.toFixed(1)} mm) -> wysokość wsadu: ${r.runMaxZ.toFixed(1)} mm`);
      }
    });
  }

  reportLines.push(
    ``,
    `6. REKOMENDACJE DRUKU SLA, MYCIA I POST-CURINGU (ANYCUBIC PHOTON MONO 4):`,
    `--------------------------------------------------------------------------------`,
    `  1. Slicer: Anycubic Photon Workshop, Lychee Slicer lub Chitubox (płasko na Z=0).`,
    `  2. Warstwa 0.05 mm, ekspozycja 1.8–2.5 s (warstwy bazowe: 25–35 s, 5–6 warstw).`,
    `  3. Kanały drenażowe: 4 dolne kanały zapobiegają efektowi przyssawki (suction cup).`,
    `  4. Mycie IPA (>= 99%): 4–6 minut, dokładne osuszenie przed UV (3–5 min, 405 nm).`,
    `  5. Montaż obrazu: klej CA lub montażowy na płycie HDF / sklejce 4–6 mm wg mapy ASCII.`,
    ``,
    `Licencja danych: © OpenStreetMap contributors (ODbL 1.0) • AWS Terrain Tiles`,
    `================================================================================`
  );

  const reportContent = reportLines.join('\n');
  zipFiles.push({
    name: 'README.txt',
    content: reportContent
  });
  zipFiles.push({
    name: 'INSTRUKCJA_DRUKU_PHOTON_MONO_4.txt',
    content: reportContent
  });

  if (waterCutout && zipFiles.filter(f => f.name.endsWith('.stl')).length === 0) {
    if (typeof document !== 'undefined') {
      const badge = document.getElementById('preflightStatusBadge');
      if (badge) {
        badge.className = 'text-xs font-mono text-amber-400';
        badge.textContent = 'Pominięto paczkę .ZIP: wszystkie kafle to 100% wycięta woda.';
      }
    }
    return false;
  }

  const zipBytes = createZipArchive(zipFiles);
  downloadBlob(
    zipBytes,
    `Map3D_${safeTitle}_${Math.round(totalW)}x${Math.round(totalH)}mm_${tileCols}x${tileRows}_Kafle_PhotonMono4.zip`,
    'application/zip'
  );
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportAllTilesZipSTL };
}
