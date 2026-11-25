// ============================================================================
// src/export/assembly_manifest.js
// Canonical assembly_manifest.json Builder + Pure-JS SHA-256 Digest
// Pure ASCII module with strict JSDoc types.
// ============================================================================

(function (root) {
  'use strict';

  const _SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  /**
   * Computes a lowercase hex SHA-256 digest of a byte buffer without Node crypto.
   * @param {Uint8Array|ArrayBuffer} input
   * @returns {string}
   */
  function sha256BytesHex(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    const len = bytes.length;
    const bitLenHi = Math.floor((len * 8) / 0x100000000);
    const bitLenLo = (len * 8) >>> 0;
    const paddedLen = ((len + 9 + 63) >> 6) << 6;
    const padded = new Uint8Array(paddedLen);
    padded.set(bytes, 0);
    padded[len] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 8, bitLenHi, false);
    view.setUint32(paddedLen - 4, bitLenLo, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);
    for (let off = 0; off < paddedLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + S1 + ch + _SHA256_K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const words = [h0, h1, h2, h3, h4, h5, h6, h7];
    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += words[i].toString(16).padStart(8, '0');
    }
    return hex;
  }

  /**
   * Builds canonical assembly_manifest.json object for an exported tile set.
   * @param {object} state
   * @param {Array<{tileId: number, fileName: string, bytes: Uint8Array, skippedEmptyWater?: boolean}>} tileRecords
   * @param {object|null} extraMeta
   * @returns {object}
   */
  function buildAssemblyManifest(state, tileRecords, extraMeta = null) {
    const catalogMod = (typeof computeFormatFrameAndTileLayout === 'function')
      ? root
      : (typeof require !== 'undefined' ? require('../geometry/format_catalog.js') : null);
    const cutterMod = (typeof getCachedMasterFrameEntry === 'function')
      ? root
      : (typeof require !== 'undefined' ? require('../mesh/tile_seam_cutter.js') : null);
    const cfgMod = (typeof resolveSceneScaleAndSpec === 'function')
      ? root
      : (typeof require !== 'undefined' ? require('../geometry/print_physics_config.js') : null);

    const layout = catalogMod && typeof catalogMod.computeFormatFrameAndTileLayout === 'function'
      ? catalogMod.computeFormatFrameAndTileLayout(state)
      : { format: { format_id: 'custom_grid', is_custom: true }, frames: [], tileMetaById: [], interFrameGapMm: 0.0 };
    const cached = cutterMod && typeof cutterMod.getCachedMasterFrameEntry === 'function'
      ? cutterMod.getCachedMasterFrameEntry(state)
      : null;
    const spec = cfgMod && typeof cfgMod.resolveSceneScaleAndSpec === 'function'
      ? cfgMod.resolveSceneScaleAndSpec(state, null)
      : { totalWidthMm: Number(state && state.bedSizeMm) || 120, totalHeightMm: Number(state && state.totalHeightMm) || 170 };

    const cols = Math.max(1, Math.round(Number(state && state.tileCols) || 1));
    const rows = Math.max(1, Math.round(Number(state && state.tileRows) || 1));
    const tileCols = cols;
    const tileRows = rows;
    const byTid = new Map();
    for (const rec of (tileRecords || [])) {
      if (rec && Number.isInteger(rec.tileId)) byTid.set(rec.tileId, rec);
    }

    const fmt = layout.format || { format_id: 'custom_grid' };
    const safeTitleRaw = String((extraMeta && extraMeta.city_slug) || (state && state.plaqueText) || 'map3d');
    const citySlug = safeTitleRaw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'map3d';
    const tileBoundsMap = cached && cached.tileBoundsMmById ? cached.tileBoundsMmById : null;
    const allowLmMap = cached && cached.allowLandmassesById ? cached.allowLandmassesById : null;
    const masterVolMm3 = (cached && Number.isFinite(cached.masterVolumeMm3))
      ? cached.masterVolumeMm3
      : ((extraMeta && Number.isFinite(extraMeta.master_volume_mm3)) ? extraMeta.master_volume_mm3 : null);

    const tileIdOf = (r, c) => (r >= 0 && r < tileRows && c >= 0 && c < tileCols)
      ? `R${tileRows - r}C${c + 1}` : null;

    const tiles = [];
    for (let tr = 0; tr < tileRows; tr++) {
      for (let tc = 0; tc < tileCols; tc++) {
        const tid = tr * tileCols + tc;
        const meta = layout.tileMetaById[tid] || {
          tile_idx: tid,
          tile_id: `R${tileRows - tr}C${tc + 1}`,
          frame_id: 'F1',
          row: tr,
          north_row: tileRows - tr,
          col: tc,
          local_row: tr,
          local_col: tc,
          stl_rotation_deg: 0,
          nominal_rect_mm: {
            x_min: -spec.totalWidthMm / 2 + tc * (spec.totalWidthMm / tileCols),
            x_max: -spec.totalWidthMm / 2 + (tc + 1) * (spec.totalWidthMm / tileCols),
            y_min: -spec.totalHeightMm / 2 + tr * (spec.totalHeightMm / tileRows),
            y_max: -spec.totalHeightMm / 2 + (tr + 1) * (spec.totalHeightMm / tileRows),
          },
        };
        const rec = byTid.get(tid);
        const actualBounds = tileBoundsMap ? tileBoundsMap.get(tid) : null;
        // Compute effective rect in assembly coordinates (applying frame gap if any, centered at 0,0)
        const baseRect = meta.nominal_rect_mm;
        const rectMm = actualBounds
          ? {
              x_min: Number((actualBounds.minX + (baseRect.x_min - (-spec.totalWidthMm / 2 + tc * (spec.totalWidthMm / tileCols)))).toFixed(6)),
              x_max: Number((actualBounds.maxX + (baseRect.x_min - (-spec.totalWidthMm / 2 + tc * (spec.totalWidthMm / tileCols)))).toFixed(6)),
              y_min: Number((actualBounds.minY + (baseRect.y_min - (-spec.totalHeightMm / 2 + tr * (spec.totalHeightMm / tileRows)))).toFixed(6)),
              y_max: Number((actualBounds.maxY + (baseRect.y_min - (-spec.totalHeightMm / 2 + tr * (spec.totalHeightMm / tileRows)))).toFixed(6)),
            }
          : baseRect;

        const wMm = rectMm.x_max - rectMm.x_min;
        const hMm = rectMm.y_max - rectMm.y_min;
        const safeArea = (cfgMod && typeof cfgMod.resolveMono4SafeArea === 'function')
          ? cfgMod.resolveMono4SafeArea(state)
          : { maxWMm: 145.45, maxHMm: 79.05 };
        const fitsN = wMm <= safeArea.maxWMm + 1e-6 && hMm <= safeArea.maxHMm + 1e-6;
        const fitsR = hMm <= safeArea.maxWMm + 1e-6 && wMm <= safeArea.maxHMm + 1e-6;
        const effRotDeg = (!fitsN && fitsR) ? 90 : Number(meta.stl_rotation_deg || 0);
        const rawBytes = rec && rec.bytes ? (rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes)) : null;

        tiles.push({
          tile_idx: tid,
          tile_id: meta.tile_id,
          frame_id: meta.frame_id,
          row: tr,
          north_row: meta.north_row,
          col: tc,
          local_row: meta.local_row,
          local_col: meta.local_col,
          file: rec ? rec.fileName : null,
          skipped_empty_water: Boolean(rec && rec.skippedEmptyWater),
          byte_length: rawBytes ? rawBytes.byteLength : 0,
          sha256: (rawBytes && !(rec && rec.skippedEmptyWater)) ? sha256BytesHex(rawBytes) : null,
          stl_rotation_deg: effRotDeg,
          nominal_rect_mm: rectMm,
          neighbors: {
            north: tileIdOf(tr + 1, tc),
            south: tileIdOf(tr - 1, tc),
            west: tileIdOf(tr, tc - 1),
            east: tileIdOf(tr, tc + 1),
          },
          allow_landmasses: Array.isArray(rec && rec.allowLandmasses)
            ? rec.allowLandmasses
            : (allowLmMap && Array.isArray(allowLmMap.get(tid)) ? allowLmMap.get(tid) : []),
        });
      }
    }

    const safeBaseMm = (cfgMod && typeof cfgMod.resolveBaseBottomMm === 'function')
      ? cfgMod.resolveBaseBottomMm(state, cfgMod.PRINT_PHYSICS_CONFIG)
      : Number((state && state.baseHeightMm) || 2.35);

    return {
      schema_version: 1,
      sku_id: String((extraMeta && extraMeta.sku_id) || fmt.format_id || 'custom_grid'),
      format_id: fmt.format_id || 'custom_grid',
      city_slug: citySlug,
      generated_at: new Date().toISOString(),
      source_params: {
        title: String((state && state.plaqueText) || 'MAP3D'),
        lat: Number(state && state.mapCenterLat) || null,
        lon: Number(state && state.mapCenterLon) || null,
        span_m: Number(state && state.mapSpanMeters) || null,
        rotation_deg: Number(state && state.mapRotationDeg) || 0,
        z_scale: Number((state && state.zScale) ?? 1.0),
        terrain_scale: Number((state && state.terrainScale) ?? 1.0),
        window_mm: [Number(spec.totalWidthMm.toFixed(4)), Number(spec.totalHeightMm.toFixed(4))],
        grid: [tileCols, tileRows],
        inter_frame_gap_mm: Number(layout.interFrameGapMm || 0.0),
        water_cutout: Boolean(state && state.waterCutout),
        solid_base_no_tunnels: Boolean(state && state.solidBaseNoTunnels),
        hollow_base: Boolean(state && state.hollowBase),
        base_height_mm: Number(safeBaseMm),
        kerf_mm: Number((state && state.kerfMm) ?? 0.0),
        bed_safe_margin_mm: Number((state && state.bedSafeMarginMm) ?? 4.0),
        dfm06_chamfer_inset_mm: Boolean(state && state.solidBaseNoTunnels) || tileCols > 1 || tileRows > 1 ? 0.25 : 0.0,
        dfm06_chamfer_height_mm: Boolean(state && state.solidBaseNoTunnels) || tileCols > 1 || tileRows > 1 ? 0.50 : 0.0,
        underside_relief_enabled: Boolean(state && state.solidBaseNoTunnels) || (tileCols > 1 || tileRows > 1),
      },
      master_volume_mm3: masterVolMm3,
      nudged_seams: cached && Array.isArray(cached.nudgedSeams) ? cached.nudgedSeams : [],
      frames: layout.frames || [],
      tiles,
      validation: {
        status: 'PENDING',
        verdict: null,
        validated_at: null,
        validator: null,
        report_file: 'validation_report.json',
        report_sha256: null,
      },
    };
  }

  const exportsObj = {
    sha256BytesHex,
    buildAssemblyManifest,
  };

  if (root) Object.assign(root, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
