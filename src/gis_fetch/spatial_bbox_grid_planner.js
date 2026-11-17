// ============================================================================
// src/gis_fetch/spatial_bbox_grid_planner.js
// Adaptive Spatial BBox Grid Planner, Center-Out Tile Ordering & 2x2 Subdivision
// Layer 1 (Pure stateless math — zero internal module dependencies)
// ============================================================================

(function (root) {
  const TARGET_CHUNK_SPAN_METERS = 1550;
  const MAX_GRID_AXIS = 12;
  const MIN_PRINT_ALIGNED_CHUNK_M = 900;
  const MAX_CHUNK_SPLIT_DEPTH = 2;
  const MIN_CHUNK_SPLIT_SPAN_M = 250;

  function selectLodTier(spanMeters) {
    const s = Number(spanMeters) || 1200;
    if (s <= 1650) return 'detail';
    if (s <= 3800) return 'urban';
    if (s <= 7200) return 'regional';
    return 'mountain';
  }

  function computeBBoxSpanMeters(south, west, north, east) {
    const midLat = (south + north) * 0.5;
    const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
    const spanNsM = Math.abs(north - south) * 111320.0;
    const spanEwM = Math.abs(east - west) * 111320.0 * cosLat;
    return {
      midLat,
      midLon: (west + east) * 0.5,
      cosLat,
      spanNsM,
      spanEwM,
      maxSpanM: Math.max(spanNsM, spanEwM),
    };
  }

  function getChunkCanonicalBBoxKey(chunk) {
    if (!chunk) return '';
    return `${Number(chunk.south).toFixed(6)}_${Number(chunk.west).toFixed(6)}_${Number(chunk.north).toFixed(6)}_${Number(chunk.east).toFixed(6)}`;
  }

  function buildSpatialChunkGrid(south, west, north, east, spanMeters, lodOptions = null) {
    const s = Number(spanMeters) || 1200;
    const { midLat: centerLat, midLon: centerLon, spanNsM: bboxNsM, spanEwM: bboxEwM } =
      computeBBoxSpanMeters(south, west, north, east);
    const fetchSpan = (lodOptions && Number(lodOptions.fetchSpanMeters) > 0)
      ? Number(lodOptions.fetchSpanMeters)
      : Math.max(s, bboxNsM, bboxEwM);
    const lodTier = selectLodTier(s);

    let rows = 1;
    let cols = 1;
    const effNs = bboxNsM > 10 ? bboxNsM : fetchSpan;
    const effEw = bboxEwM > 10 ? bboxEwM : fetchSpan;

    if (fetchSpan > 3200) {
      rows = Math.min(MAX_GRID_AXIS, Math.max(2, Math.ceil(effNs / TARGET_CHUNK_SPAN_METERS)));
      cols = Math.min(MAX_GRID_AXIS, Math.max(2, Math.ceil(effEw / TARGET_CHUNK_SPAN_METERS)));
    } else if (fetchSpan > 1650) {
      rows = 2;
      cols = 2;
    }

    // Align fetch granularity so GIS sectors are never coarser than physical print-bed tiles on wide frames
    const rawPrintCols = lodOptions && Number(lodOptions.printTileCols) > 1 ? Math.round(Number(lodOptions.printTileCols)) : 0;
    const rawPrintRows = lodOptions && Number(lodOptions.printTileRows) > 1 ? Math.round(Number(lodOptions.printTileRows)) : 0;
    if ((rawPrintCols > 1 || rawPrintRows > 1) && fetchSpan > 2200) {
      const rotRad = ((Number(lodOptions && lodOptions.rotationDeg) || 0) * Math.PI) / 180.0;
      const swapAxes = Math.abs(Math.sin(rotRad)) > Math.abs(Math.cos(rotRad));
      const axisPrintRows = swapAxes ? (rawPrintCols || 1) : (rawPrintRows || 1);
      const axisPrintCols = swapAxes ? (rawPrintRows || 1) : (rawPrintCols || 1);
      const maxRowsByMinSpan = Math.min(MAX_GRID_AXIS, Math.max(1, Math.floor(effNs / MIN_PRINT_ALIGNED_CHUNK_M)));
      const maxColsByMinSpan = Math.min(MAX_GRID_AXIS, Math.max(1, Math.floor(effEw / MIN_PRINT_ALIGNED_CHUNK_M)));
      rows = Math.max(rows, Math.min(axisPrintRows, maxRowsByMinSpan));
      cols = Math.max(cols, Math.min(axisPrintCols, maxColsByMinSpan));
    }

    const dLat = (north - south) / rows;
    const dLon = (east - west) / cols;
    const padLat = rows > 1 ? dLat * 0.015 : 0;
    const padLon = cols > 1 ? dLon * 0.015 : 0;
    const chunks = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cSouth = Math.max(south, south + r * dLat - padLat);
        const cNorth = Math.min(north, south + (r + 1) * dLat + padLat);
        const cWest = Math.max(west, west + c * dLon - padLon);
        const cEast = Math.min(east, west + (c + 1) * dLon + padLon);
        const midLat = (cSouth + cNorth) * 0.5;
        const midLon = (cWest + cEast) * 0.5;
        chunks.push({
          id: `R${r + 1}C${c + 1}`,
          south: cSouth,
          west: cWest,
          north: cNorth,
          east: cEast,
          lodTier,
          lodOptions: lodOptions || null,
          totalChunks: rows * cols,
          distCenter: Math.hypot(midLat - centerLat, midLon - centerLon),
          depth: 0,
        });
      }
    }
    chunks.sort((a, b) => a.distCenter - b.distCenter);
    return { rows, cols, lodTier, chunks };
  }

  function subdivideChunk2x2(chunk) {
    if (!chunk) return [];
    const curDepth = Number(chunk.depth) || 0;
    if (curDepth >= MAX_CHUNK_SPLIT_DEPTH) return [];
    const { midLat, midLon, maxSpanM: parentSpanM } =
      computeBBoxSpanMeters(chunk.south, chunk.west, chunk.north, chunk.east);
    if (!(parentSpanM > MIN_CHUNK_SPLIT_SPAN_M)) return [];

    const fallbackTier = chunk.lodTier;
    const lo = chunk.lodOptions || null;
    const parentTotalChunks = chunk.totalChunks || 1;
    const subPadLat = (chunk.north - chunk.south) * 0.008;
    const subPadLon = (chunk.east - chunk.west) * 0.008;
    const nextDepth = curDepth + 1;

    const rawSubs = [
      {
        id: `${chunk.id}.1`,
        south: chunk.south,
        west: chunk.west,
        north: Math.min(chunk.north, midLat + subPadLat),
        east: Math.min(chunk.east, midLon + subPadLon),
        lodTier: fallbackTier,
        lodOptions: lo,
        totalChunks: parentTotalChunks,
        depth: nextDepth,
      },
      {
        id: `${chunk.id}.2`,
        south: chunk.south,
        west: Math.max(chunk.west, midLon - subPadLon),
        north: Math.min(chunk.north, midLat + subPadLat),
        east: chunk.east,
        lodTier: fallbackTier,
        lodOptions: lo,
        totalChunks: parentTotalChunks,
        depth: nextDepth,
      },
      {
        id: `${chunk.id}.3`,
        south: Math.max(chunk.south, midLat - subPadLat),
        west: chunk.west,
        north: chunk.north,
        east: Math.min(chunk.east, midLon + subPadLon),
        lodTier: fallbackTier,
        lodOptions: lo,
        totalChunks: parentTotalChunks,
        depth: nextDepth,
      },
      {
        id: `${chunk.id}.4`,
        south: Math.max(chunk.south, midLat - subPadLat),
        west: Math.max(chunk.west, midLon - subPadLon),
        north: chunk.north,
        east: chunk.east,
        lodTier: fallbackTier,
        lodOptions: lo,
        totalChunks: parentTotalChunks,
        depth: nextDepth,
      },
    ];

    // Strict geometric contraction guard: every child must strictly shrink parent span
    return rawSubs.filter((sc) => {
      if (!(sc.north > sc.south && sc.east > sc.west)) return false;
      const { maxSpanM: childSpanM } = computeBBoxSpanMeters(sc.south, sc.west, sc.north, sc.east);
      return childSpanM < parentSpanM * 0.75;
    });
  }

  const exportsObj = {
    TARGET_CHUNK_SPAN_METERS,
    MAX_CHUNK_SPLIT_DEPTH,
    MIN_CHUNK_SPLIT_SPAN_M,
    selectLodTier,
    computeBBoxSpanMeters,
    getChunkCanonicalBBoxKey,
    buildSpatialChunkGrid,
    subdivideChunk2x2,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
