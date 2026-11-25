// ============================================================================
// src/geometry/format_catalog.js
// Canonical MSLA format catalog shared across JS core, UI, Node CLI, Python.
// Pure ASCII module.
// ============================================================================

(function (root) {
  'use strict';

  /**
   * Embedded browser-safe fallback identical to config/format_catalog.json.
   * Verified against config/format_catalog.json by automated tests.
   */
  const EMBEDDED_FORMAT_CATALOG = {
    schema_version: 1,
    printer: {
      id: 'anycubic_photon_mono_4',
      name: 'Anycubic Photon Mono 4',
      bed_x_mm: 153.45,
      bed_y_mm: 87.05,
      bed_z_mm: 165.0,
      default_margin_mm: 4.0,
      safe_bed_x_mm: 145.45,
      safe_bed_y_mm: 79.05,
      safe_bed_z_mm: 163.0,
      xy_pixel_mm: 0.017,
      layer_height_mm: 0.05
    },
    defaults: {
      inter_frame_gap_mm: 0.0,
      kerf_mm: 0.0,
      dfm06_chamfer_inset_mm: 0.25,
      dfm06_chamfer_height_mm: 0.50,
      underside_relief_height_mm: 1.50,
      underside_relief_width_mm: 2.60,
      underside_relief_pitch_mm: 8.80,
      underside_relief_skirt_mm: 8.0
    },
    formats: {
      single_a4_1x3: {
        format_id: 'single_a4_1x3',
        ui_profile_id: 'mono4_a4_passepartout_12x17_1x3',
        label: 'Single A4 Passe-Partout 12x17 cm (1x3)',
        window_mm: [120.0, 170.0],
        frame_cols: 1,
        frame_rows: 1,
        tiles_per_frame_cols: 1,
        tiles_per_frame_rows: 3,
        tile_cols: 1,
        tile_rows: 3,
        tile_nominal_mm: [120.0, 56.6667],
        stl_rotation_deg: 0,
        inter_frame_gap_mm: 0.0,
        solid_base_no_tunnels: true,
        base_height_mm: 4.0,
        bed_safe_margin_mm: 4.0,
        frame_style: 'heavy_a4',
        frame_outer_mm: [210.0, 297.0],
        is_custom: false
      },
      single_a4_landscape_3x1: {
        format_id: 'single_a4_landscape_3x1',
        ui_profile_id: 'single_a4_landscape_3x1',
        label: 'Single A4 Landscape 17x12 cm (3x1)',
        window_mm: [170.0, 120.0],
        frame_cols: 1,
        frame_rows: 1,
        tiles_per_frame_cols: 3,
        tiles_per_frame_rows: 1,
        tile_cols: 3,
        tile_rows: 1,
        tile_nominal_mm: [56.6667, 120.0],
        stl_rotation_deg: 90,
        inter_frame_gap_mm: 0.0,
        solid_base_no_tunnels: true,
        base_height_mm: 4.0,
        bed_safe_margin_mm: 4.0,
        frame_style: 'heavy_a4_landscape',
        frame_outer_mm: [297.0, 210.0],
        is_custom: false
      },
      triptych_a4_3x1: {
        format_id: 'triptych_a4_3x1',
        ui_profile_id: 'triptych_a4_3x1',
        label: 'Triptych A4 3x(12x17 cm) = 3x3 Strips',
        window_mm: [360.0, 170.0],
        frame_cols: 3,
        frame_rows: 1,
        tiles_per_frame_cols: 1,
        tiles_per_frame_rows: 3,
        tile_cols: 3,
        tile_rows: 3,
        tile_nominal_mm: [120.0, 56.6667],
        stl_rotation_deg: 0,
        inter_frame_gap_mm: 0.0,
        solid_base_no_tunnels: true,
        base_height_mm: 4.0,
        bed_safe_margin_mm: 4.0,
        frame_style: 'heavy_a4_triptych',
        frame_outer_mm: [210.0, 297.0],
        is_custom: false
      },
      quartet_a4_2x2: {
        format_id: 'quartet_a4_2x2',
        ui_profile_id: 'quartet_a4_2x2',
        label: 'Quartet A4 2x2 Frames = 4x(1x3) = 12 Strips (24x34 cm)',
        window_mm: [240.0, 340.0],
        frame_cols: 2,
        frame_rows: 2,
        tiles_per_frame_cols: 1,
        tiles_per_frame_rows: 3,
        tile_cols: 2,
        tile_rows: 6,
        tile_nominal_mm: [120.0, 56.6667],
        stl_rotation_deg: 0,
        inter_frame_gap_mm: 0.0,
        solid_base_no_tunnels: true,
        base_height_mm: 4.0,
        bed_safe_margin_mm: 4.0,
        frame_style: 'heavy_a4_quartet',
        frame_outer_mm: [210.0, 297.0],
        is_custom: false
      },
      square_150_2x2: {
        format_id: 'square_150_2x2',
        ui_profile_id: 'square_150_2x2',
        label: 'Square 15x15 cm (2x2: 75x75 mm)',
        window_mm: [150.0, 150.0],
        frame_cols: 1,
        frame_rows: 1,
        tiles_per_frame_cols: 2,
        tiles_per_frame_rows: 2,
        tile_cols: 2,
        tile_rows: 2,
        tile_nominal_mm: [75.0, 75.0],
        stl_rotation_deg: 0,
        inter_frame_gap_mm: 0.0,
        solid_base_no_tunnels: true,
        base_height_mm: 4.0,
        bed_safe_margin_mm: 4.0,
        frame_style: 'square_150',
        frame_outer_mm: [240.0, 240.0],
        is_custom: false
      },
      square_240_2x4: {
        format_id: 'square_240_2x4',
        ui_profile_id: 'square_240_2x4',
        label: 'Square 24x24 cm (2x4: 120x60 mm)',
        window_mm: [240.0, 240.0],
        frame_cols: 1,
        frame_rows: 1,
        tiles_per_frame_cols: 2,
        tiles_per_frame_rows: 4,
        tile_cols: 2,
        tile_rows: 4,
        tile_nominal_mm: [120.0, 60.0],
        stl_rotation_deg: 0,
        inter_frame_gap_mm: 0.0,
        solid_base_no_tunnels: true,
        base_height_mm: 4.0,
        bed_safe_margin_mm: 4.0,
        frame_style: 'square_240',
        frame_outer_mm: [340.0, 340.0],
        is_custom: false
      },
      flagship_50x70_3x9: {
        format_id: 'flagship_50x70_3x9',
        ui_profile_id: 'flagship_50x70_3x9',
        label: 'Flagship 50x70 cm (36x51 cm relief, 3x9: 120x56.7 mm)',
        window_mm: [360.0, 510.0],
        frame_cols: 1,
        frame_rows: 1,
        tiles_per_frame_cols: 3,
        tiles_per_frame_rows: 9,
        tile_cols: 3,
        tile_rows: 9,
        tile_nominal_mm: [120.0, 56.6667],
        stl_rotation_deg: 0,
        inter_frame_gap_mm: 0.0,
        solid_base_no_tunnels: true,
        base_height_mm: 4.0,
        bed_safe_margin_mm: 4.0,
        frame_style: 'flagship_50x70',
        frame_outer_mm: [500.0, 700.0],
        is_custom: false
      },
      custom_grid: {
        format_id: 'custom_grid',
        ui_profile_id: 'mono4_custom',
        label: 'Custom Mono 4 Safe Grid (Auto-Tiling)',
        window_mm: [500.0, 500.0],
        frame_cols: 1,
        frame_rows: 1,
        tiles_per_frame_cols: 4,
        tiles_per_frame_rows: 6,
        tile_cols: 4,
        tile_rows: 6,
        tile_nominal_mm: [125.0, 83.3333],
        stl_rotation_deg: 0,
        inter_frame_gap_mm: 0.0,
        solid_base_no_tunnels: false,
        base_height_mm: 2.35,
        bed_safe_margin_mm: 4.0,
        frame_style: 'custom_grid',
        frame_outer_mm: [500.0, 500.0],
        is_custom: true
      }
    },
    aliases: {
      single_a4_1x3: 'single_a4_1x3',
      mono4_a4_passepartout_12x17_1x3: 'single_a4_1x3',
      mono4_a4_passepartout_12x17_2x1: 'single_a4_1x3',
      a4_12x17: 'single_a4_1x3',
      single_a4_landscape_3x1: 'single_a4_landscape_3x1',
      mono4_a4_landscape_17x12_3x1: 'single_a4_landscape_3x1',
      triptych_a4_3x1: 'triptych_a4_3x1',
      mono4_triptych_a4_3x1: 'triptych_a4_3x1',
      quartet_a4_2x2: 'quartet_a4_2x2',
      mono4_quartet_a4_2x2: 'quartet_a4_2x2',
      square_150_2x2: 'square_150_2x2',
      mono4_square_150_2x2: 'square_150_2x2',
      square_240_2x4: 'square_240_2x4',
      mono4_square_240_2x4: 'square_240_2x4',
      flagship_50x70_3x9: 'flagship_50x70_3x9',
      mono4_flagship_50x70_3x9: 'flagship_50x70_3x9',
      custom_grid: 'custom_grid',
      mono4_custom: 'custom_grid'
    }
  };

  /**
   * @returns {object}
   */
  function loadFormatCatalog() {
    if (typeof require === 'function' && typeof __dirname === 'string') {
      try {
        const fs = require('fs');
        const path = require('path');
        const jsonPath = path.resolve(__dirname, '../../config/format_catalog.json');
        if (fs.existsSync(jsonPath)) {
          return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        }
      } catch (_) {}
    }
    return EMBEDDED_FORMAT_CATALOG;
  }

  const FORMAT_CATALOG = loadFormatCatalog();

  /**
   * Resolves a canonical format entry from a format ID or legacy UI alias.
   * @param {string|null|undefined} idOrAlias
   * @returns {object|null}
   */
  function resolveFormatSpec(idOrAlias) {
    if (typeof idOrAlias !== 'string') return null;
    const clean = idOrAlias.trim();
    if (!clean) return null;
    if (Object.prototype.hasOwnProperty.call(FORMAT_CATALOG.formats, clean)) {
      return FORMAT_CATALOG.formats[clean];
    }
    const mapped = FORMAT_CATALOG.aliases && FORMAT_CATALOG.aliases[clean];
    if (mapped && Object.prototype.hasOwnProperty.call(FORMAT_CATALOG.formats, mapped)) {
      return FORMAT_CATALOG.formats[mapped];
    }
    return null;
  }

  /**
   * Resolves the canonical format entry for a runtime state object.
   * Falls back to custom_grid when dimensions or tile grid do not match a fixed SKU.
   * @param {object|null} state
   * @returns {object}
   */
  function resolveFormatSpecForState(state) {
    if (state && typeof state.formatId === 'string') {
      const byFmt = resolveFormatSpec(state.formatId);
      if (byFmt && !byFmt.is_custom) return byFmt;
    }
    if (state && typeof state.printerProfileId === 'string') {
      const byProf = resolveFormatSpec(state.printerProfileId);
      if (byProf && !byProf.is_custom) return byProf;
    }
    const wMm = Number(state && (state.bedSizeMm || (Number(state.targetWidthCm) || 0) * 10)) || 0;
    const hMm = Number(state && (state.totalHeightMm || (Number(state.targetHeightCm) || 0) * 10)) || 0;
    const cols = Math.max(1, Math.round(Number(state && state.tileCols) || 1));
    const rows = Math.max(1, Math.round(Number(state && state.tileRows) || 1));
    const fmts = FORMAT_CATALOG.formats || {};
    for (const k of Object.keys(fmts)) {
      const f = fmts[k];
      if (f.is_custom) continue;
      if (
        Math.abs(wMm - f.window_mm[0]) <= 0.6 &&
        Math.abs(hMm - f.window_mm[1]) <= 0.6 &&
        cols === f.tile_cols &&
        rows === f.tile_rows
      ) {
        return f;
      }
    }
    return FORMAT_CATALOG.formats.custom_grid;
  }

  /**
   * Computes frame metadata and nominal tile rectangles (in assembly mm, centered at 0,0)
   * supporting multi-frame sets with configurable inter_frame_gap_mm (default 0.0 mm).
   * @param {object|null} state
   * @returns {{format: object, frames: Array<object>, tileMetaById: Array<object>, interFrameGapMm: number}}
   */
  function computeFormatFrameAndTileLayout(state) {
    const fmt = resolveFormatSpecForState(state);
    const cols = Math.max(1, Math.round(Number(state && state.tileCols) || fmt.tile_cols || 1));
    const rows = Math.max(1, Math.round(Number(state && state.tileRows) || fmt.tile_rows || 1));
    const totalW = Number(state && (state.bedSizeMm || (Number(state.targetWidthCm) || 0) * 10)) || fmt.window_mm[0];
    const totalH = Number(state && (state.totalHeightMm || (Number(state.targetHeightCm) || 0) * 10)) || fmt.window_mm[1];
    const interFrameGapMm = (state && state.interFrameGapMm !== undefined && Number.isFinite(Number(state.interFrameGapMm)))
      ? Math.max(0, Number(state.interFrameGapMm))
      : Number(fmt.inter_frame_gap_mm || 0.0);

    const frameCols = Math.max(1, Number((state && state.frameCols) || fmt.frame_cols || 1));
    const frameRows = Math.max(1, Number((state && state.frameRows) || fmt.frame_rows || 1));
    const useFrameGrid = (cols % frameCols === 0) && (rows % frameRows === 0);
    const effFrameCols = useFrameGrid ? frameCols : 1;
    const effFrameRows = useFrameGrid ? frameRows : 1;
    const tpfCols = cols / effFrameCols;
    const tpfRows = rows / effFrameRows;

    const frameW = totalW / effFrameCols;
    const frameH = totalH / effFrameRows;
    const frames = [];
    for (let fr = 0; fr < effFrameRows; fr++) {
      for (let fc = 0; fc < effFrameCols; fc++) {
        const frameIdx = fr * effFrameCols + fc;
        const northFrameRow = effFrameRows - fr;
        const fxMin = -totalW / 2 + fc * frameW + fc * interFrameGapMm - ((effFrameCols - 1) * interFrameGapMm) / 2;
        const fyMin = -totalH / 2 + fr * frameH + fr * interFrameGapMm - ((effFrameRows - 1) * interFrameGapMm) / 2;
        frames.push({
          frame_id: (effFrameCols === 1 && effFrameRows === 1) ? 'F1' : `F_R${northFrameRow}C${fc + 1}`,
          frame_index: frameIdx,
          frame_col: fc,
          frame_row: fr,
          north_frame_row: northFrameRow,
          frame_style: fmt.frame_style,
          frame_outer_mm: Array.isArray(fmt.frame_outer_mm) ? fmt.frame_outer_mm.slice() : [frameW, frameH],
          window_mm: [Number(frameW.toFixed(4)), Number(frameH.toFixed(4))],
          nominal_origin_mm: [Number(fxMin.toFixed(4)), Number(fyMin.toFixed(4))],
          tile_ids: []
        });
      }
    }

    const tileW = totalW / cols;
    const tileH = totalH / rows;
    const safeBedW = (FORMAT_CATALOG.printer && FORMAT_CATALOG.printer.safe_bed_x_mm) || 145.45;
    const safeBedH = (FORMAT_CATALOG.printer && FORMAT_CATALOG.printer.safe_bed_y_mm) || 79.05;
    const needsRot90 = (tileW > safeBedW + 1e-6 || tileH > safeBedH + 1e-6) &&
      (tileH <= safeBedW + 1e-6 && tileW <= safeBedH + 1e-6);
    const stlRotDeg = (fmt && !fmt.is_custom && typeof fmt.stl_rotation_deg === 'number')
      ? fmt.stl_rotation_deg
      : (needsRot90 ? 90 : 0);

    const tileMetaById = [];
    for (let tr = 0; tr < rows; tr++) {
      for (let tc = 0; tc < cols; tc++) {
        const tid = tr * cols + tc;
        const fc = Math.floor(tc / tpfCols);
        const fr = Math.floor(tr / tpfRows);
        const frameIdx = fr * effFrameCols + fc;
        const frame = frames[frameIdx] || frames[0];
        frame.tile_ids.push(tid);
        const northRow = rows - tr;
        const xMin = -totalW / 2 + tc * tileW + fc * interFrameGapMm - ((effFrameCols - 1) * interFrameGapMm) / 2;
        const xMax = xMin + tileW;
        const yMin = -totalH / 2 + tr * tileH + fr * interFrameGapMm - ((effFrameRows - 1) * interFrameGapMm) / 2;
        const yMax = yMin + tileH;
        tileMetaById.push({
          tile_idx: tid,
          tile_id: `R${northRow}C${tc + 1}`,
          frame_id: frame.frame_id,
          row: tr,
          north_row: northRow,
          col: tc,
          local_row: tr % tpfRows,
          local_col: tc % tpfCols,
          stl_rotation_deg: stlRotDeg,
          nominal_rect_mm: {
            x_min: Number(xMin.toFixed(6)),
            x_max: Number(xMax.toFixed(6)),
            y_min: Number(yMin.toFixed(6)),
            y_max: Number(yMax.toFixed(6))
          }
        });
      }
    }

    return {
      format: fmt,
      frames,
      tileMetaById,
      interFrameGapMm
    };
  }

  /**
   * Builds UI PRINT_PROFILES entries from the canonical format catalog.
   * @returns {object}
   */
  function buildCatalogPrintProfiles() {
    const p = FORMAT_CATALOG.printer || {};
    const printerStr = `${p.name || 'Anycubic Photon Mono 4'} (${p.bed_x_mm || 153.45}x${p.bed_y_mm || 87.05}x${p.bed_z_mm || 165.0} mm)`;
    const profiles = {
      mono4_75x84_1x1: {
        id: 'mono4_75x84_1x1',
        formatId: 'custom_grid',
        name: 'Anycubic Photon Mono 4 - 75x84 mm (1 Kafel 1x1)',
        printer: printerStr,
        bedX: p.bed_x_mm || 153.45,
        bedY: p.bed_y_mm || 87.05,
        bedZ: p.bed_z_mm || 165.0,
        totalWidthMm: 75,
        totalHeightMm: 84,
        cols: 1,
        rows: 1,
        frameCols: 1,
        frameRows: 1,
        isResin: true,
        xyPixelMm: p.xy_pixel_mm || 0.017,
        layerHeightMm: p.layer_height_mm || 0.05,
        bedSafeMarginMm: 4.0,
        solidBaseNoTunnels: false,
        baseHeightMm: 2.35
      }
    };

    const fmts = FORMAT_CATALOG.formats || {};
    for (const k of Object.keys(fmts)) {
      const f = fmts[k];
      const pid = f.ui_profile_id || f.format_id;
      const prof = {
        id: pid,
        formatId: f.format_id,
        name: f.label,
        printer: printerStr,
        bedX: p.bed_x_mm || 153.45,
        bedY: p.bed_y_mm || 87.05,
        bedZ: p.bed_z_mm || 165.0,
        totalWidthMm: f.window_mm[0],
        totalHeightMm: f.window_mm[1],
        targetWidthCm: Number((f.window_mm[0] / 10).toFixed(1)),
        targetHeightCm: Number((f.window_mm[1] / 10).toFixed(1)),
        cols: f.tile_cols,
        rows: f.tile_rows,
        frameCols: f.frame_cols,
        frameRows: f.frame_rows,
        interFrameGapMm: Number(f.inter_frame_gap_mm || 0.0),
        isResin: true,
        xyPixelMm: p.xy_pixel_mm || 0.017,
        layerHeightMm: p.layer_height_mm || 0.05,
        bedSafeMarginMm: f.bed_safe_margin_mm || 4.0,
        solidBaseNoTunnels: Boolean(f.solid_base_no_tunnels),
        baseHeightMm: Number(f.base_height_mm || 2.35),
        isCustomMono4: Boolean(f.is_custom)
      };
      profiles[pid] = prof;
      if (f.format_id !== pid) {
        profiles[f.format_id] = prof;
      }
    }

    // Backwards-compatible aliases only for safe/active SKUs
    profiles.mono4_84_1x1 = profiles.mono4_75x84_1x1;
    profiles.mono4_a4_passepartout_12x17_2x1 = profiles.mono4_a4_passepartout_12x17_1x3;
    return profiles;
  }

  const exported = {
    EMBEDDED_FORMAT_CATALOG,
    FORMAT_CATALOG,
    loadFormatCatalog,
    resolveFormatSpec,
    resolveFormatSpecForState,
    computeFormatFrameAndTileLayout,
    buildCatalogPrintProfiles
  };

  if (root) {
    root.MAP3D_FORMAT_CATALOG = FORMAT_CATALOG;
    root.resolveFormatSpec = resolveFormatSpec;
    root.resolveFormatSpecForState = resolveFormatSpecForState;
    root.computeFormatFrameAndTileLayout = computeFormatFrameAndTileLayout;
    root.buildCatalogPrintProfiles = buildCatalogPrintProfiles;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
