// ============================================================================
// src/export/zip_packager.js
// Multi-Tile SLA .ZIP Packager (R1C1..RnCm Tiles + Optional Frame Segments +
// Complete Polish Anycubic Photon Mono 4 Assembly & Post-Processing Guide)
// ============================================================================

if (typeof buildBinarySTLBytes === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./crc32_zip.js'));
  Object.assign(global, require('./stl_writer.js'));
  Object.assign(global, require('../mesh/mesh_clipper_3d.js'));
}

function exportAllTilesZipSTL(state, layerFilter = 'all') {
  const tileCols = Math.max(1, (state && state.tileCols) || 1);
  const tileRows = Math.max(1, (state && state.tileRows) || 1);
  const numTiles = tileCols * tileRows;
  const totalW = (state && state.bedSizeMm) || 252.0;
  const totalH = (state && state.totalHeightMm) || totalW;
  const targetW_cm = (totalW / 10).toFixed(1);
  const targetH_cm = (totalH / 10).toFixed(1);
  const tileW = totalW / tileCols;
  const tileH = totalH / tileRows;
  const safeTitle = sanitizeFilenameSlug((state && state.plaqueText) || 'MAP3D');
  const pm = (state && state.printMetrics) || {};
  const isResin = Boolean(state && (state.isResin || state.printerPreset === 'photon_mono_4'));
  const kerfMm = isResin ? (state.kerfMm !== undefined ? state.kerfMm : 0.08) : 0.0;

  const fitsNormal = (tileW <= 153.45 && tileH <= 87.05);
  const fitsRotated = (tileH <= 153.45 && tileW <= 87.05);
  const isAutoRotated = isResin && (!fitsNormal && fitsRotated);

  const zipFiles = [];
  const tileEntries = [];

  let fileIdx = 1;
  for (let tr = tileRows - 1; tr >= 0; tr--) {
    const northRow = tileRows - tr;
    for (let tc = 0; tc < tileCols; tc++) {
      const tid = tr * tileCols + tc;
      const stlBytes = buildBinarySTLBytes(state, layerFilter, tid);
      const tVolMl = (pm.tileVolumesMl && pm.tileVolumesMl[tid] !== undefined)
        ? pm.tileVolumesMl[tid].toFixed(1)
        : ((pm.totalVolumeMl || 40) / numTiles).toFixed(1);
      const tGrams = Math.round(parseFloat(tVolMl) * 1.12);
      const fileName = `Kafel_${String(fileIdx++).padStart(2, '0')}_R${northRow}C${tc + 1}_${Math.round(tileW)}x${Math.round(tileH)}mm.stl`;
      zipFiles.push({ name: fileName, content: stlBytes });
      tileEntries.push({
        fileName,
        r: northRow,
        c: tc + 1,
        volMl: tVolMl,
        grams: tGrams,
        w: tileW.toFixed(1),
        h: tileH.toFixed(1)
      });
    }
  }

  const meshesObj = (state && (state.layerMeshes || state.meshes)) || {};
  const frameTris = meshesObj.frame || [];
  const frameEntries = [];

  if (state && state.exportFrame && frameTris.length > 0) {
    const frameWidthMm = state.frameWidthMm || 12.0;
    const frameTotalWidthMm = totalW + 2 * frameWidthMm;
    const frameTotalHeightMm = totalH + 2 * frameWidthMm;
    const maxDimMm = Math.max(totalW, totalH);
    const scaleMm = maxDimMm / 169.2;
    const frameWidthUnits = frameWidthMm / scaleMm;
    const halfW = 84.6 * (totalW / maxDimMm);
    const halfH = 84.6 * (totalH / maxDimMm);
    const outerHalfW = halfW + frameWidthUnits;
    const outerHalfH = halfH + frameWidthUnits;

    const canClip = typeof clipMeshToBox3D === 'function';
    const fCols = Math.max(1, Math.ceil(frameTotalWidthMm / 148.0));
    const fRows = Math.max(1, Math.ceil(frameTotalHeightMm / 148.0));

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
            const segFitsNormal = (segW <= 153.45 && segH <= 87.05);
            const segFitsRotated = (segH <= 153.45 && segW <= 87.05);
            const segRotate = isResin && (!segFitsNormal && segFitsRotated);
            const segBytes = buildSTLBytesFromTriangles(clipped, -x0, -y0, scaleMm, segW, segH, state, segRotate);
            const segName = `Rama_${String(fIdx++).padStart(2, '0')}_R${segNorthRow}C${fc + 1}_${Math.round(segW)}x${Math.round(segH)}mm.stl`;
            zipFiles.push({ name: segName, content: segBytes });
            frameEntries.push({ name: segName, w: segW.toFixed(1), h: segH.toFixed(1), rot: segRotate });
          }
        }
      }
    } else {
      const fullFrameFitsNormal = (frameTotalWidthMm <= 153.45 && frameTotalHeightMm <= 87.05);
      const fullFrameFitsRotated = (frameTotalHeightMm <= 153.45 && frameTotalWidthMm <= 87.05);
      const fullRotate = isResin && (!fullFrameFitsNormal && fullFrameFitsRotated);
      const fullFrameBytes = buildSTLBytesFromTriangles(
        frameTris, outerHalfW, outerHalfH, scaleMm, frameTotalWidthMm, frameTotalHeightMm, state, fullRotate
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
    `Maksymalna wysokość reliefu: ${(pm.maxZMm || 20).toFixed(1)} mm (oś Z)`,
    `Podział na kafle:            ${tileCols} kolumn x ${tileRows} wierszy (${numTiles} kafli ogółem)`,
    `Wymiar pojedynczego kafla:   ${tileW.toFixed(1)} x ${tileH.toFixed(1)} mm`,
    `Auto-rotacja dla Mono 4:     ${isAutoRotated ? `TAK (+90° XY: wymiar na stole ${tileH.toFixed(1)} x ${tileW.toFixed(1)} mm <= 153.4 x 87.0 mm)` : `NIE (mieści się w układzie standardowym <= 153.4 x 87.0 mm)`}`,
    `Odchudzona baza (Hollow):    ${state && state.hollowBase ? `TAK (Ścianka ${state.hollowWallMm || 1.8} mm + kanały drenażowe SLA, oszczędność ~${pm.hollowSavingsPct || 45}%)` : 'NIE (Pełna baza z=0 pod lity wydruk FDM/SLA)'}`,
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
    reportLines.push(`  - ${e.fileName.padEnd(38, ' ')} | Kafel [R${e.r}C${e.c}] | Wymiar: ${e.w} x ${e.h} mm | Żywica: ~${e.volMl} ml (~${e.grams} g)`);
  });

  if (frameEntries.length > 0) {
    reportLines.push(``, `5. SEGMENTY MODUŁOWEJ RAMKI 3D:`, `--------------------------------------------------------------------------------`);
    frameEntries.forEach(fe => {
      reportLines.push(`  - ${fe.name.padEnd(38, ' ')} | Wymiar segmentu: ${fe.w} x ${fe.h} mm ${fe.rot ? '(Obrócony o 90° dla Mono 4)' : ''}`);
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

  zipFiles.push({
    name: 'INSTRUKCJA_DRUKU_PHOTON_MONO_4.txt',
    content: reportLines.join('\n')
  });

  const zipBytes = createZipArchive(zipFiles);
  downloadBlob(
    zipBytes,
    `Map3D_${safeTitle}_${Math.round(totalW)}x${Math.round(totalH)}mm_${tileCols}x${tileRows}_Kafle_PhotonMono4.zip`,
    'application/zip'
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportAllTilesZipSTL };
}
