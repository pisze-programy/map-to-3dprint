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

function _pushPierAreaRecJS(ctx, outer, holes, tags) {
  const pierKind = getOsmPierKindJS(tags);
  const rec = { outer, holes: holes || [], name: tags.name || 'Molo', layer: 0, isPier: true, pierKind, floating: tags.floating === 'yes' || pierKind === 'pontoon' };
  ctx.bridgePolys.push(rec);
  if (!ctx.pierPolys) ctx.pierPolys = [];
  ctx.pierPolys.push({ ...rec, _inBridgePolys: true });
}

function _buildBridgeRecJS(outer, holes, tags, osmId) {
  return {
    outer, holes: holes || [], name: tags.name || 'Most',
    layer: _parseBridgeSignedLayerJS(tags.layer, 1),
    bridgeStructure: _extractBridgeStructTagJS(tags) || (tags.bridge || ''),
    covered: tags.covered || '', level: tags.level !== undefined ? tags.level : '',
    heightM: _parseLenM(tags, 'height'), minHeightM: _parseLenM(tags, 'min_height'),
    clearanceM: _parseLenM(tags, 'seamark:bridge:clearance_height') ?? _parseLenM(tags, 'maxheight'),
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
      _pushPierAreaRecJS(ctx, op, (st.innerPolys || []).filter(h => h && h.length >= 3 && _ringInsideOuterExtract2D(h, op)), tags);
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
  if (tags.man_made === 'bridge' && isClosed && tags.area !== 'no') {
    if (ctx.usedWays.has(wid) || ['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.indoor === 'yes') return true;
    const pts = ctx.nodesToPts(nids, 0.005);
    if (pts.length >= 3) ctx.bridgePolys.push(_buildBridgeRecJS(pts, [], tags, wid));
    return true;
  }
  if (isOsmPierTagsJS(tags)) {
    if (ctx.usedWays.has(wid) || ['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.indoor === 'yes') return true;
    if (isClosed && tags.area !== 'no' && (tags.area === 'yes' || !tags.highway)) {
      const pts = ctx.nodesToPts(nids, 0.005);
      if (pts.length >= 3) _pushPierAreaRecJS(ctx, pts, [], tags);
      return true;
    }
    const pierKind = getOsmPierKindJS(tags), isFloating = tags.floating === 'yes' || pierKind === 'pontoon';
    let rwm = pierKind === 'breakwater' ? 5.0 : (pierKind === 'groyne' || pierKind === 'jetty') ? 3.2 : pierKind === 'pontoon' ? 2.8 : (tags.highway === 'service' ? 4.5 : 3.2);
    const explicitW = parseFloatTagJS(tags.width, null);
    if (explicitW !== null && explicitW >= 1.0 && explicitW <= 30.0) rwm = explicitW;
    const wUnits = Math.max(0.30, rwm * (ctx.metersToUnits || 0.141));
    const pts = ctx.nodesToPts(nids, 0.005);
    if (pts.length >= 2) {
      if (!ctx.pierLines) ctx.pierLines = [];
      ctx.pierLines.push({ pts, width: wUnits, pierKind, floating: isFloating, name: tags.name || 'Molo', _inBridgePolys: true });
      for (const ring of _bufferPierPolylineToPolys2D(pts, wUnits)) {
        ctx.bridgePolys.push({ outer: ring, holes: [], name: tags.name || 'Molo', layer: 0, isPier: true, isPierLine: true, pierKind, floating: isFloating, width: wUnits });
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
  if (obj.clearanceM == null) obj.clearanceM = _parseLenM(srcTags, 'seamark:bridge:clearance_height') ?? _parseLenM(srcTags, 'maxheight');
}

function finalizeOsmBridgesLayerJS(ctx) {
  if (!ctx.pierPolys) ctx.pierPolys = [];
  if (!ctx.pierLines) ctx.pierLines = [];
  if (!ctx.bridgeSupports) ctx.bridgeSupports = [];

  const roadByOsmId = new Map(), polyByOsmId = new Map();
  for (const rd of (ctx.roads || [])) if (rd && rd.osmId != null) roadByOsmId.set(rd.osmId, rd);
  for (const bp of (ctx.bridgePolys || [])) if (bp && !bp.isPier && bp.osmId != null) polyByOsmId.set(bp.osmId, bp);

  for (const meta of (ctx.bridgeRelMeta || [])) {
    const bp = polyByOsmId.get(meta.relId) || (meta.outlineWayIds || []).map(id => polyByOsmId.get(id)).find(Boolean);
    for (const wid of (meta.acrossWayIds || [])) {
      const rd = roadByOsmId.get(wid);
      if (!rd) continue;
      _applyBridgeMetaToObjJS(meta.tags, rd);
      rd.parentBridgeRelId = meta.relId; rd.isBridge = true; rd.bridge = true;
      if (bp) {
        _applyBridgeMetaToObjJS(bp.tags, rd); _applyBridgeMetaToObjJS(rd.tags, bp);
        rd._bridgePolyOsmId = bp.osmId;
        bp.acrossRoadIds = bp.acrossRoadIds || [];
        if (!bp.acrossRoadIds.includes(rd.osmId)) bp.acrossRoadIds.push(rd.osmId);
      }
    }
    if (bp) { _applyBridgeMetaToObjJS(meta.tags, bp); bp.parentBridgeRelId = meta.relId; }
  }

  for (const rd of (ctx.roads || [])) {
    if (!rd || !(rd.isBridge || rd.bridge) || rd._bridgePolyOsmId != null || !rd.pts || rd.pts.length < 2) continue;
    let bestBp = null, bestDiff = Infinity;
    for (const bp of (ctx.bridgePolys || [])) {
      if (!bp || bp.isPier || !bp.outer || bp.outer.length < 3) continue;
      const diff = Math.abs((rd.hasExplicitLayer ? rd.layer : bp.layer) - (bp.layer ?? 1));
      if (diff > 1) continue;
      if (_polylineCrossesRingExtract2D(rd.pts, bp.outer) && diff < bestDiff) { bestDiff = diff; bestBp = bp; }
    }
    if (bestBp) {
      _applyBridgeMetaToObjJS(rd.tags, bestBp); _applyBridgeMetaToObjJS(bestBp.tags, rd);
      bestBp.acrossRoadIds = bestBp.acrossRoadIds || [];
      if (rd.osmId != null && !bestBp.acrossRoadIds.includes(rd.osmId)) bestBp.acrossRoadIds.push(rd.osmId);
      rd._bridgePolyOsmId = bestBp.osmId;
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
