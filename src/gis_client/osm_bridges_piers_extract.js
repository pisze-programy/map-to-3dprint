// ============================================================================
// src/gis_client/osm_bridges_piers_extract.js
// OSM Bridges, Bridge Supports & Waterfront Piers Extractor
// ============================================================================

if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') Object.assign(global, require('./s3db_client_matcher.js'));
if (typeof _pointInRingExtract2D === 'undefined' && typeof require !== 'undefined') Object.assign(global, require('./osm_pier_geometry_helper.js'));

const OSM_PIER_MAN_MADE_SET = new Set(['pier', 'pontoon', 'breakwater', 'groyne', 'jetty']);

function _parseBridgeSignedLayerJS(rawVal, fallback = 1) {
  if (rawVal === undefined || rawVal === null || rawVal === '') return fallback;
  const n = parseFloatTagJS(rawVal, fallback);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function _parseLenM(tags, key) {
  if (!tags || tags[key] === undefined) return null;
  return typeof parseOsmLengthMetersJS === 'function' ? parseOsmLengthMetersJS(tags[key], null) : parseFloatTagJS(tags[key], null);
}

function _extractBridgeStructTagJS(tags) {
  if (!tags) return '';
  if (tags['bridge:structure']) return String(tags['bridge:structure']).trim().toLowerCase();
  if (typeof tags.bridge === 'string') {
    const b = tags.bridge.trim().toLowerCase();
    if (b && !['yes', 'no', 'false', '0', 'none', 'viaduct', 'bridge'].includes(b)) return b;
  }
  return '';
}

function isOsmPierTagsJS(tags) {
  return Boolean(tags && !tags['bridge:support'] && (OSM_PIER_MAN_MADE_SET.has(tags.man_made) || tags.mooring === 'pontoon'));
}

function getOsmPierKindJS(tags) {
  if (tags && OSM_PIER_MAN_MADE_SET.has(tags.man_made)) return tags.man_made;
  return (tags && tags.mooring === 'pontoon') ? 'pontoon' : 'pier';
}

function _pushSupportRecJS(arr, tags, osmId, isPoint, pt, outer, pts) {
  const kind = String((tags && tags['bridge:support']) || '').trim().toLowerCase();
  if (!kind || kind === 'no' || kind === 'none') return;
  arr.push({
    kind, isPoint, pt, outer: outer || null, pts: pts || null,
    heightM: _parseLenM(tags, 'height'), minHeightM: _parseLenM(tags, 'min_height'),
    layer: _parseBridgeSignedLayerJS(tags.layer, 0), osmId, name: tags.name || '', tags
  });
}

function _pushPierAreaRecJS(ctx, outer, holes, tags, osmId) {
  const pierKind = getOsmPierKindJS(tags);
  const rec = {
    outer, holes: holes || [], name: tags.name || 'Molo', layer: _parseBridgeSignedLayerJS(tags.layer, 0),
    isPier: true, pierKind, floating: tags.floating === 'yes' || pierKind === 'pontoon' || tags.platform === 'floating',
    osmId, tags
  };
  ctx.bridgePolys.push(rec);
  if (!ctx.pierPolys) ctx.pierPolys = [];
  ctx.pierPolys.push({ ...rec, _inBridgePolys: true });
}

function _parseBridgeClearanceMJS(tags) {
  if (!tags) return null;
  const below = _parseLenM(tags, 'maxheight:below') ?? _parseLenM(tags, 'seamark:bridge:clearance_height_closed');
  if (below != null && below > 0) return Math.min(85.0, below);
  if (String(tags.bridge || '').trim().toLowerCase() !== 'movable') {
    const sea = _parseLenM(tags, 'seamark:bridge:clearance_height');
    if (sea != null && sea > 0) return Math.min(85.0, sea);
  }
  return null;
}

function _buildBridgeRecJS(outer, holes, tags, osmId) {
  return {
    outer, holes: holes || [], name: tags.name || 'Most',
    layer: _parseBridgeSignedLayerJS(tags.layer, 1),
    hasExplicitLayer: Boolean(tags && tags.layer !== undefined && tags.layer !== ''),
    bridgeStructure: _extractBridgeStructTagJS(tags) || (tags.bridge || ''),
    covered: tags.covered || '', level: tags.level !== undefined ? tags.level : '',
    heightM: _parseLenM(tags, 'height'), minHeightM: _parseLenM(tags, 'min_height'),
    clearanceM: _parseBridgeClearanceMJS(tags),
    osmId, tags
  };
}

function collectOsmBridgeSupportNodeJS(el, pt, bridgeSupports) {
  if (el && el.tags && el.tags['bridge:support'] && Array.isArray(bridgeSupports)) {
    _pushSupportRecJS(bridgeSupports, el.tags, el.id, true, [pt[0], pt[1]], null, null);
  }
}

function isOsmBridgeMultipolygonJS(tags) {
  if (!tags) return false;
  if (isOsmPierTagsJS(tags)) return true;
  if (['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.indoor === 'yes') return false;
  if (tags['bridge:support']) return true;
  return Boolean(tags.man_made === 'bridge' || tags.type === 'bridge' || (tags.bridge && !['no', 'false', '0', 'none'].includes(tags.bridge)));
}

function processOsmBridgeMultipolygonJS(rel, tags, _raw, ctx) {
  if (!isOsmBridgeMultipolygonJS(tags)) return false;
  const st = ctx.stitchedRelPolys.get(rel.id);
  if (!st) return tags.type === 'bridge' || tags.man_made === 'bridge';
  for (const wid of st.memberWayIds) ctx.usedWays.add(wid);

  if (tags['bridge:support']) {
    if (!ctx.bridgeSupports) ctx.bridgeSupports = [];
    for (const op of st.outerPolys) if (op && op.length >= 3) _pushSupportRecJS(ctx.bridgeSupports, tags, rel.id, false, _ringCentroidExtract2D(op), op, null);
    return true;
  }
  if (isOsmPierTagsJS(tags)) {
    for (const op of st.outerPolys) {
      if (!op || op.length < 3) continue;
      _pushPierAreaRecJS(ctx, op, (st.innerPolys || []).filter(h => h && h.length >= 3 && _ringInsideOuterExtract2D(h, op)), tags, rel.id);
    }
    return true;
  }
  for (const op of st.outerPolys) {
    if (!op || op.length < 3) continue;
    ctx.bridgePolys.push(_buildBridgeRecJS(op, (st.innerPolys || []).filter(h => h && h.length >= 3 && _ringInsideOuterExtract2D(h, op)), tags, rel.id));
  }
  return true;
}

function processOsmBridgeOrPierWayJS(wid, _w, tags, nids, isClosed, ctx) {
  if (tags['bridge:support'] && !['no', 'false', '0', 'none'].includes(String(tags['bridge:support']).toLowerCase())) {
    if (ctx.usedWays.has(wid)) return true;
    if (!ctx.bridgeSupports) ctx.bridgeSupports = [];
    const pts = ctx.nodesToPts(nids, 0.005);
    if (pts.length >= 2) {
      const closedRing = isClosed && pts.length >= 3;
      _pushSupportRecJS(ctx.bridgeSupports, tags, wid, false, closedRing ? _ringCentroidExtract2D(pts) : pts[pts.length >> 1], closedRing ? pts : null, closedRing ? null : pts);
    }
    return true;
  }
  const isAreaHwyBridge = isClosed && tags.area === 'yes' &&
    ['pedestrian', 'footway', 'service', 'living_street'].includes(tags.highway) &&
    tags.bridge && !['no', 'false', '0', 'none'].includes(String(tags.bridge).toLowerCase());
  if ((tags.man_made === 'bridge' && isClosed && tags.area !== 'no') || isAreaHwyBridge) {
    if (ctx.usedWays.has(wid) || ['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.indoor === 'yes') return true;
    const pts = ctx.nodesToPts(nids, 0.005);
    if (pts.length >= 3) ctx.bridgePolys.push(_buildBridgeRecJS(pts, [], tags, wid));
    return true;
  }
  if (isOsmPierTagsJS(tags)) {
    if (ctx.usedWays.has(wid) || ['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.indoor === 'yes') return true;
    const isAreaPier = isClosed && tags.area !== 'no' && (tags.area === 'yes' || tags.public_transport === 'platform' || tags.floating === 'yes' || tags.man_made === 'pontoon' || !tags.highway);
    if (isAreaPier) {
      const pts = ctx.nodesToPts(nids, 0.005);
      if (pts.length >= 3) _pushPierAreaRecJS(ctx, pts, [], tags, wid);
      return true;
    }
    const pierKind = getOsmPierKindJS(tags), isFloating = tags.floating === 'yes' || pierKind === 'pontoon' || tags.platform === 'floating';
    let rwm = pierKind === 'breakwater' ? 5.0 : (pierKind === 'groyne' || pierKind === 'jetty') ? 3.2 : pierKind === 'pontoon' ? 2.8 : (tags.highway === 'service' ? 4.5 : 3.2);
    const explicitW = parseFloatTagJS(tags.width, null);
    if (explicitW !== null && explicitW >= 1.0 && explicitW <= 30.0) rwm = explicitW;
    const wUnits = Math.max(0.30, rwm * (ctx.metersToUnits || 0.141));
    const pts = ctx.nodesToPts(nids, 0.005);
    if (pts.length >= 2) {
      if (!ctx.pierLines) ctx.pierLines = [];
      ctx.pierLines.push({ pts, width: wUnits, pierKind, floating: isFloating, layer: _parseBridgeSignedLayerJS(tags.layer, 0), minHeightM: _parseLenM(tags, 'min_height'), heightM: _parseLenM(tags, 'height'), name: tags.name || 'Molo', osmId: wid, tags, _inBridgePolys: true });
      for (const ring of _bufferPierPolylineToPolys2D(pts, wUnits)) {
        ctx.bridgePolys.push({ outer: ring, holes: [], name: tags.name || 'Molo', layer: _parseBridgeSignedLayerJS(tags.layer, 0), isPier: true, isPierLine: true, pierKind, floating: isFloating, width: wUnits, osmId: wid, tags });
      }
    }
    return true;
  }
  return false;
}

function isOsmLinearBridgeOrPierWayJS(tags) {
  if (!tags || isOsmPierTagsJS(tags) || tags['bridge:support']) return false;
  return Boolean((tags.bridge && !['no', 'false', '0', 'none'].includes(tags.bridge)) || tags.man_made === 'bridge');
}

function _applyBridgeMetaToObjJS(srcTags, obj) {
  if (!srcTags || !obj) return;
  const st = _extractBridgeStructTagJS(srcTags);
  if (st && (!obj.bridgeStructure || obj.bridgeStructure === 'yes' || obj.bridgeStructure === 'viaduct')) obj.bridgeStructure = st;
  if (!obj.name || obj.name === 'Most') { if (srcTags.name) obj.name = srcTags.name; }
  if (obj.heightM == null) obj.heightM = _parseLenM(srcTags, 'height');
  if (obj.minHeightM == null) obj.minHeightM = _parseLenM(srcTags, 'min_height');
  if (obj.clearanceM == null) obj.clearanceM = _parseBridgeClearanceMJS(srcTags);
}

function _linkRoadAndBridgePolyJS(rd, bp, setBridgePolyId = true) {
  if (!rd || !bp) return;
  bp.acrossRoadIds = bp.acrossRoadIds || [];
  if (rd.osmId != null && !bp.acrossRoadIds.includes(rd.osmId)) bp.acrossRoadIds.push(rd.osmId);
  if (setBridgePolyId && bp.osmId != null) {
    rd._bridgePolyOsmIds = rd._bridgePolyOsmIds || [];
    if (!rd._bridgePolyOsmIds.includes(bp.osmId)) rd._bridgePolyOsmIds.push(bp.osmId);
    if (rd._bridgePolyOsmId == null) rd._bridgePolyOsmId = bp.osmId;
  }
}

function _ringBBoxBr2D(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const x = ring[i][0], y = ring[i][1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function _buildSceneWaterSpatialIndex(ctx) {
  if (ctx._waterSpatialIdx) return ctx._waterSpatialIdx;
  const CELL = 6.0;
  const polyGrid = new Map();
  const segGrid = new Map();
  const openIslands = Array.isArray(ctx._openSeaIslands)
    ? ctx._openSeaIslands.filter(isl => isl && isl.length >= 3).map(isl => ({ ring: isl, bb: _ringBBoxBr2D(isl) }))
    : [];

  for (const wp of (ctx.waterPolys || [])) {
    if (!wp || !wp.outer || wp.outer.length < 3) continue;
    const bb = _ringBBoxBr2D(wp.outer);
    const rec = { wp, bb };
    const gx0 = Math.floor(bb[0] / CELL), gx1 = Math.floor(bb[2] / CELL);
    const gy0 = Math.floor(bb[1] / CELL), gy1 = Math.floor(bb[3] / CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const k = `${gx}:${gy}`;
        let b = polyGrid.get(k); if (!b) { b = []; polyGrid.set(k, b); }
        b.push(rec);
      }
    }
  }
  for (const wl of (ctx.waterLines || [])) {
    if (!wl || !wl.pts || wl.pts.length < 2) continue;
    const hw = Math.max(0.25, (wl.width || 0.7) * 0.55);
    for (let i = 0; i < wl.pts.length - 1; i++) {
      const a = wl.pts[i], b = wl.pts[i + 1];
      const seg = [a[0], a[1], b[0], b[1], hw];
      const gx0 = Math.floor((Math.min(a[0], b[0]) - hw) / CELL), gx1 = Math.floor((Math.max(a[0], b[0]) + hw) / CELL);
      const gy0 = Math.floor((Math.min(a[1], b[1]) - hw) / CELL), gy1 = Math.floor((Math.max(a[1], b[1]) + hw) / CELL);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const k = `${gx}:${gy}`;
          let arr = segGrid.get(k); if (!arr) { arr = []; segGrid.set(k, arr); }
          arr.push(seg);
        }
      }
    }
  }
  ctx._waterSpatialIdx = { CELL, polyGrid, segGrid, openIslands };
  return ctx._waterSpatialIdx;
}

function _isPtInSceneWaterExtractJS(px, py, ctx) {
  const wIdx = _buildSceneWaterSpatialIndex(ctx);
  if (wIdx.openIslands.length > 0) {
    let inLand = false;
    for (let i = 0; i < wIdx.openIslands.length; i++) {
      const isl = wIdx.openIslands[i];
      if (px < isl.bb[0] || px > isl.bb[2] || py < isl.bb[1] || py > isl.bb[3]) continue;
      if (_pointInRingExtract2D(px, py, isl.ring)) { inLand = true; break; }
    }
    if (!inLand) return true;
  }
  const ck = `${Math.floor(px / wIdx.CELL)}:${Math.floor(py / wIdx.CELL)}`;
  const pBucket = wIdx.polyGrid.get(ck);
  if (pBucket) {
    for (let i = 0; i < pBucket.length; i++) {
      const { wp, bb } = pBucket[i];
      if (px < bb[0] || px > bb[2] || py < bb[1] || py > bb[3]) continue;
      if (!_pointInRingExtract2D(px, py, wp.outer)) continue;
      if ((wp.holes || []).some(h => h && h.length >= 3 && _pointInRingExtract2D(px, py, h))) continue;
      if ((wp._unrotatedLandRings || []).some(h => h && h.length >= 3 && _pointInRingExtract2D(px, py, h))) continue;
      return true;
    }
  }
  const sBucket = wIdx.segGrid.get(ck);
  if (sBucket) {
    for (let i = 0; i < sBucket.length; i++) {
      const [ax, ay, bx, by, hw] = sBucket[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      if (Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) <= hw) return true;
    }
  }
  return false;
}

function _ringTouchesWaterExtractJS(outer, ctx) {
  for (let i = 0, n = outer.length; i < n; i++) {
    const a = outer[i], b = outer[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(2, Math.min(24, Math.ceil(len / 0.8)));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      if (_isPtInSceneWaterExtractJS(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ctx)) return true;
    }
  }
  const c = _ringCentroidExtract2D(outer);
  return _isPtInSceneWaterExtractJS(c[0], c[1], ctx);
}

function _polylineCrossesBridgeOverWaterJS(pts, bpOuter, ctx) {
  if (!_polylineCrossesRingExtract2D(pts, bpOuter)) return false;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(2, Math.min(24, Math.ceil(len / 0.6)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      if (_pointInRingExtract2D(px, py, bpOuter) && _isPtInSceneWaterExtractJS(px, py, ctx)) return true;
    }
  }
  return false;
}

function _polyPrincipalAxisBr2D(outer) {
  let cx = 0, cy = 0;
  const n = outer.length || 1;
  for (let i = 0; i < n; i++) { cx += outer[i][0]; cy += outer[i][1]; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = outer[i][0] - cx, dy = outer[i][1] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(th), uy = Math.sin(th);
  let uMin = Infinity, uMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const u = (outer[i][0] - cx) * ux + (outer[i][1] - cy) * uy;
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
  }
  return { ux, uy, spanL: Math.max(0.2, uMax - uMin) };
}

function _polylineAlignsInsideBridgePolyJS(pts, bpOuter, axInfo) {
  let insideLen = 0, wDot = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], segL = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segL < 1e-5) continue;
    const steps = Math.max(2, Math.min(16, Math.ceil(segL / 0.8)));
    let inCnt = 0;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (_pointInRingExtract2D(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, bpOuter)) inCnt++;
    }
    const frac = inCnt / (steps + 1);
    if (frac > 0) {
      const dl = segL * frac;
      insideLen += dl;
      wDot += dl * Math.abs(((b[0] - a[0]) / segL) * axInfo.ux + ((b[1] - a[1]) / segL) * axInfo.uy);
    }
  }
  return insideLen >= Math.min(2.5, axInfo.spanL * 0.38) && (wDot / Math.max(1e-5, insideLen)) >= 0.80;
}

function finalizeOsmBridgesLayerJS(ctx) {
  if (!ctx.pierPolys) ctx.pierPolys = [];
  if (!ctx.pierLines) ctx.pierLines = [];
  if (!ctx.bridgeSupports) ctx.bridgeSupports = [];

  const roadByOsmId = new Map(), polysByOsmId = new Map();
  for (const rd of (ctx.roads || [])) if (rd && rd.osmId != null) roadByOsmId.set(rd.osmId, rd);
  for (const bp of (ctx.bridgePolys || [])) {
    if (!bp || bp.isPier || bp.osmId == null) continue;
    let list = polysByOsmId.get(bp.osmId);
    if (!list) { list = []; polysByOsmId.set(bp.osmId, list); }
    list.push(bp);
  }

  for (const meta of (ctx.bridgeRelMeta || [])) {
    const bps = [];
    for (const bp of (polysByOsmId.get(meta.relId) || [])) if (!bps.includes(bp)) bps.push(bp);
    for (const id of (meta.outlineWayIds || [])) {
      for (const bp of (polysByOsmId.get(id) || [])) if (!bps.includes(bp)) bps.push(bp);
    }
    for (const wid of (meta.acrossWayIds || [])) {
      const rd = roadByOsmId.get(wid);
      if (!rd) continue;
      _applyBridgeMetaToObjJS(meta.tags, rd);
      rd.parentBridgeRelId = meta.relId; rd.isBridge = true; rd.bridge = true;
      for (const bp of bps) {
        _applyBridgeMetaToObjJS(bp.tags, rd); _applyBridgeMetaToObjJS(rd.tags, bp);
        _linkRoadAndBridgePolyJS(rd, bp, true);
      }
    }
    for (const bp of bps) { _applyBridgeMetaToObjJS(meta.tags, bp); bp.parentBridgeRelId = meta.relId; }
  }

  const validBps = (ctx.bridgePolys || []).filter(bp => bp && !bp.isPier && bp.outer && bp.outer.length >= 3);
  if (validBps.length === 0) return;

  const BP_CELL = 6.0;
  const bpSpatialGrid = new Map();
  let hasWaterBps = false;
  for (let i = 0; i < validBps.length; i++) {
    const bp = validBps[i];
    const bb = _ringBBoxBr2D(bp.outer);
    const touchesWater = _ringTouchesWaterExtractJS(bp.outer, ctx);
    if (touchesWater) hasWaterBps = true;
    const entry = { bp, bb, idx: i, touchesWater };
    const gx0 = Math.floor(bb[0] / BP_CELL), gx1 = Math.floor(bb[2] / BP_CELL);
    const gy0 = Math.floor(bb[1] / BP_CELL), gy1 = Math.floor(bb[3] / BP_CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const k = `${gx}:${gy}`;
        let arr = bpSpatialGrid.get(k); if (!arr) { arr = []; bpSpatialGrid.set(k, arr); }
        arr.push(entry);
      }
    }
  }
  const seenBpStamp = new Int32Array(validBps.length);
  let stamp = 0;

  for (const rd of (ctx.roads || [])) {
    if (!rd || !rd.pts || rd.pts.length < 2) continue;
    const isBr = Boolean(rd.isBridge || rd.bridge);
    if (!isBr && !((rd.layer ?? 0) >= 0 && hasWaterBps)) continue;

    const rbb = _ringBBoxBr2D(rd.pts);
    const gx0 = Math.floor(rbb[0] / BP_CELL), gx1 = Math.floor(rbb[2] / BP_CELL);
    const gy0 = Math.floor(rbb[1] / BP_CELL), gy1 = Math.floor(rbb[3] / BP_CELL);
    stamp++;
    const cands = [];
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const arr = bpSpatialGrid.get(`${gx}:${gy}`);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const e = arr[k];
          if (seenBpStamp[e.idx] === stamp) continue;
          seenBpStamp[e.idx] = stamp;
          if (!isBr && !e.touchesWater) continue;
          if (rbb[2] < e.bb[0] - 1e-4 || rbb[0] > e.bb[2] + 1e-4 || rbb[3] < e.bb[1] - 1e-4 || rbb[1] > e.bb[3] + 1e-4) continue;
          cands.push(e);
        }
      }
    }
    if (cands.length === 0) continue;
    if (cands.length > 1) cands.sort((a, b) => a.idx - b.idx);

    if (isBr) {
      const matched = [];
      for (let ci = 0; ci < cands.length; ci++) {
        const bp = cands[ci].bp;
        const bpLyr = bp.layer ?? 1, rdLyr = rd.hasExplicitLayer ? rd.layer : bpLyr;
        const diff = Math.abs(rdLyr - bpLyr);
        if ((rd.hasExplicitLayer && bp.hasExplicitLayer) ? (diff > 0) : (diff > 1)) continue;
        if (_polylineCrossesRingExtract2D(rd.pts, bp.outer)) matched.push({ bp, diff });
      }
      matched.sort((a, b) => a.diff - b.diff);
      for (const { bp } of matched) {
        _applyBridgeMetaToObjJS(rd.tags, bp); _applyBridgeMetaToObjJS(bp.tags, rd);
        _linkRoadAndBridgePolyJS(rd, bp, true);
      }
    } else {
      for (let ci = 0; ci < cands.length; ci++) {
        const bp = cands[ci].bp;
        if (!_polylineCrossesBridgeOverWaterJS(rd.pts, bp.outer, ctx)) continue;
        _applyBridgeMetaToObjJS(rd.tags, bp);
        _linkRoadAndBridgePolyJS(rd, bp, false);
        rd._surfaceAcrossBridgePolyIds = rd._surfaceAcrossBridgePolyIds || [];
        if (bp.osmId != null && !rd._surfaceAcrossBridgePolyIds.includes(bp.osmId)) rd._surfaceAcrossBridgePolyIds.push(bp.osmId);
      }
    }
  }

  const unlinkedBps = validBps.filter(bp => !(bp.acrossRoadIds && bp.acrossRoadIds.length > 0));
  if (unlinkedBps.length > 0) {
    const bridgeRoads = (ctx.roads || []).filter(r => r && (r.isBridge || r.bridge) && r.pts && r.pts.length >= 2);
    const rdBbs = bridgeRoads.map(r => _ringBBoxBr2D(r.pts));
    for (const bp of unlinkedBps) {
      const bbb = _ringBBoxBr2D(bp.outer);
      const axInfo = _polyPrincipalAxisBr2D(bp.outer);
      const carried = [];
      for (let ri = 0; ri < bridgeRoads.length; ri++) {
        const rb = rdBbs[ri];
        if (rb[2] < bbb[0] - 1e-4 || rb[0] > bbb[2] + 1e-4 || rb[3] < bbb[1] - 1e-4 || rb[1] > bbb[3] + 1e-4) continue;
        const rd = bridgeRoads[ri];
        const diff = Math.abs((rd.layer ?? 1) - (bp.layer ?? 1));
        if (diff > 2) continue;
        if (_polylineAlignsInsideBridgePolyJS(rd.pts, bp.outer, axInfo)) carried.push(rd);
      }
      if (carried.length > 0) {
        let maxCarriedLyr = -Infinity;
        for (const rd of carried) {
          _applyBridgeMetaToObjJS(rd.tags, bp); _applyBridgeMetaToObjJS(bp.tags, rd);
          _linkRoadAndBridgePolyJS(rd, bp, true);
          maxCarriedLyr = Math.max(maxCarriedLyr, rd.layer ?? 1);
        }
        if (Number.isFinite(maxCarriedLyr)) bp.layer = maxCarriedLyr;
      }
    }
  }
}

const _BRIDGES_EXPORTS = {
  isOsmPierTagsJS, getOsmPierKindJS, collectOsmBridgeSupportNodeJS,
  isOsmBridgeMultipolygonJS, processOsmBridgeMultipolygonJS,
  processOsmBridgeOrPierWayJS, isOsmLinearBridgeOrPierWayJS, finalizeOsmBridgesLayerJS
};
if (typeof window !== 'undefined') Object.assign(window, _BRIDGES_EXPORTS);
if (typeof module !== 'undefined' && module.exports) module.exports = _BRIDGES_EXPORTS;
