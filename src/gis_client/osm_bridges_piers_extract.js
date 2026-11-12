// ============================================================================
// src/gis_client/osm_bridges_piers_extract.js
// OSM Bridges & Piers Extractor (man_made=bridge Polygons, Linear Bridge Tags,
// Closed & Linear man_made=pier|pontoon|breakwater|groyne|jetty Structures)
// ============================================================================

if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}

const OSM_PIER_MAN_MADE_SET = new Set(['pier', 'pontoon', 'breakwater', 'groyne', 'jetty']);

function isOsmPierTagsJS(tags) {
  if (!tags) return false;
  return OSM_PIER_MAN_MADE_SET.has(tags.man_made) || tags.mooring === 'pontoon';
}

function getOsmPierKindJS(tags) {
  if (tags && OSM_PIER_MAN_MADE_SET.has(tags.man_made)) return tags.man_made;
  if (tags && tags.mooring === 'pontoon') return 'pontoon';
  return 'pier';
}

function _pointInRingExtract2D(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function _signedRingAreaExtract2D(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return 0.5 * s;
}

function _segsCrossExtract2D(a, b, c, d) {
  const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c), o2 = orient(a, b, d);
  const o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 1e-9 && o2 < -1e-9) || (o1 < -1e-9 && o2 > 1e-9)) &&
      ((o3 > 1e-9 && o4 < -1e-9) || (o3 < -1e-9 && o4 > 1e-9))) {
    return true;
  }
  return false;
}

function _isSimpleRingExtract2D(ring) {
  if (!ring || ring.length < 3 || Math.abs(_signedRingAreaExtract2D(ring)) < 1e-5) return false;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i], a2 = ring[(i + 1) % n];
    if (Math.hypot(a2[0] - a1[0], a2[1] - a1[1]) < 1e-5) return false;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = ring[j], b2 = ring[(j + 1) % n];
      if (_segsCrossExtract2D(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function _bufferPierPolylineToPolys2D(rawPts, widthUnits) {
  if (!rawPts || rawPts.length < 2) return [];
  const pts = [rawPts[0]];
  for (let i = 1; i < rawPts.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.hypot(rawPts[i][0] - prev[0], rawPts[i][1] - prev[1]) >= 0.018) {
      pts.push(rawPts[i]);
    }
  }
  if (pts.length < 2) return [];

  const halfW = Math.max(0.14, widthUnits * 0.5);
  const isClosedLoop = pts.length >= 4 &&
    Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.03;

  // Attempt single clean miter/bevel ribbon for open polylines
  if (!isClosedLoop) {
    const leftPts = [];
    const rightPts = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        leftPts.push([pts[0][0] + nx * halfW, pts[0][1] + ny * halfW]);
        rightPts.push([pts[0][0] - nx * halfW, pts[0][1] - ny * halfW]);
      } else if (i === n - 1) {
        const dx = pts[n - 1][0] - pts[n - 2][0], dy = pts[n - 1][1] - pts[n - 2][1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        leftPts.push([pts[n - 1][0] + nx * halfW, pts[n - 1][1] + ny * halfW]);
        rightPts.push([pts[n - 1][0] - nx * halfW, pts[n - 1][1] - ny * halfW]);
      } else {
        const d1x = pts[i][0] - pts[i - 1][0], d1y = pts[i][1] - pts[i - 1][1];
        const l1 = Math.hypot(d1x, d1y) || 1;
        const t1x = d1x / l1, t1y = d1y / l1;
        const d2x = pts[i + 1][0] - pts[i][0], d2y = pts[i + 1][1] - pts[i][1];
        const l2 = Math.hypot(d2x, d2y) || 1;
        const t2x = d2x / l2, t2y = d2y / l2;

        const n1x = -t1y, n1y = t1x;
        const n2x = -t2y, n2y = t2x;
        const turnDot = t1x * t2x + t1y * t2y;
        const cross = t1x * t2y - t1y * t2x;

        if (turnDot < -0.15) {
          // Bevel outer corner on sharp turns (> ~98 deg) to prevent long spikes or self-crossings
          if (cross > 0) {
            rightPts.push([pts[i][0] - n1x * halfW, pts[i][1] - n1y * halfW]);
            rightPts.push([pts[i][0] - n2x * halfW, pts[i][1] - n2y * halfW]);
            const bx = n1x + n2x, by = n1y + n2y, bl = Math.hypot(bx, by) || 1;
            leftPts.push([pts[i][0] + (bx / bl) * halfW, pts[i][1] + (by / bl) * halfW]);
          } else {
            leftPts.push([pts[i][0] + n1x * halfW, pts[i][1] + n1y * halfW]);
            leftPts.push([pts[i][0] + n2x * halfW, pts[i][1] + n2y * halfW]);
            const bx = n1x + n2x, by = n1y + n2y, bl = Math.hypot(bx, by) || 1;
            rightPts.push([pts[i][0] - (bx / bl) * halfW, pts[i][1] - (by / bl) * halfW]);
          }
        } else {
          const tx = t1x + t2x, ty = t1y + t2y, tl = Math.hypot(tx, ty) || 1;
          const mnx = -ty / tl, mny = tx / tl;
          const dot = mnx * n1x + mny * n1y;
          const miter = Math.min(1.45, 1.0 / Math.max(0.68, dot));
          leftPts.push([pts[i][0] + mnx * halfW * miter, pts[i][1] + mny * halfW * miter]);
          rightPts.push([pts[i][0] - mnx * halfW * miter, pts[i][1] - mny * halfW * miter]);
        }
      }
    }
    const ribbon = rightPts.concat(leftPts.slice().reverse());
    if (_isSimpleRingExtract2D(ribbon)) {
      if (_signedRingAreaExtract2D(ribbon) < 0) ribbon.reverse();
      return [ribbon];
    }
  }

  // Fallback for closed walkway loops or self-crossing marina dock polylines:
  // emit clean per-segment convex quads with slight interior joint overlap
  const segPolys = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const pA = pts[i], pB = pts[i + 1];
    const dx = pB[0] - pA[0], dy = pB[1] - pA[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.02) continue;
    const tx = dx / len, ty = dy / len;
    const nx = -ty, ny = tx;
    const extA = (i > 0 || isClosedLoop) ? Math.min(halfW * 0.45, len * 0.35) : 0;
    const extB = (i < pts.length - 2 || isClosedLoop) ? Math.min(halfW * 0.45, len * 0.35) : 0;
    const ax = pA[0] - tx * extA, ay = pA[1] - ty * extA;
    const bx = pB[0] + tx * extB, by = pB[1] + ty * extB;
    segPolys.push([
      [ax - nx * halfW, ay - ny * halfW],
      [bx - nx * halfW, by - ny * halfW],
      [bx + nx * halfW, by + ny * halfW],
      [ax + nx * halfW, ay + ny * halfW]
    ]);
  }
  return segPolys;
}

function isOsmBridgeMultipolygonJS(tags) {
  if (!tags) return false;
  if (isOsmPierTagsJS(tags)) return true;
  if (['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.indoor === 'yes') return false;
  if ((parseFloatTagJS(tags.layer, 1) || 1) < 0) return false;
  return Boolean(
    tags.man_made === 'bridge' ||
    (tags.bridge && !['no', 'false', '0', 'none'].includes(tags.bridge))
  );
}

function processOsmBridgeMultipolygonJS(rel, tags, raw, ctx) {
  if (!isOsmBridgeMultipolygonJS(tags)) return false;
  const st = ctx.stitchedRelPolys.get(rel.id);
  if (!st) return true;
  for (const wid of st.memberWayIds) ctx.usedWays.add(wid);

  const isPier = isOsmPierTagsJS(tags);
  if (isPier) {
    const pierKind = getOsmPierKindJS(tags);
    const isFloating = tags.floating === 'yes' || pierKind === 'pontoon';
    if (!ctx.pierPolys) ctx.pierPolys = [];
    for (const op of st.outerPolys) {
      if (!op || op.length < 3) continue;
      const opHoles = (st.innerPolys || []).filter(
        h => h && h.length >= 3 && _pointInRingExtract2D(h[0][0], h[0][1], op)
      );
      const rec = {
        outer: op,
        holes: opHoles,
        name: tags.name || 'Molo',
        layer: 0,
        isPier: true,
        pierKind,
        floating: isFloating
      };
      ctx.bridgePolys.push(rec);
      ctx.pierPolys.push({ ...rec, _inBridgePolys: true });
    }
    return true;
  }

  const layerVal = Math.max(1, Math.trunc(parseFloatTagJS(tags.layer, 1) || 1));
  for (const op of st.outerPolys) {
    if (!op || op.length < 3) continue;
    const opHoles = (st.innerPolys || []).filter(
      h => h && h.length >= 3 && _pointInRingExtract2D(h[0][0], h[0][1], op)
    );
    ctx.bridgePolys.push({ outer: op, holes: opHoles, name: tags.name || 'Most', layer: layerVal });
  }
  return true;
}

function processOsmBridgeOrPierWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (tags.man_made === 'bridge' && isClosed && tags.area !== 'no') {
    if (ctx.usedWays.has(wid)) return true;
    if (['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.indoor === 'yes') return true;
    const rawLayer = parseFloatTagJS(tags.layer, 1);
    if (rawLayer !== null && rawLayer < 0) return true;
    const pts = ctx.nodesToPts(nids, 0.02);
    if (pts.length >= 3) {
      const layerVal = Math.max(1, Math.trunc(rawLayer || 1));
      ctx.bridgePolys.push({ outer: pts, holes: [], name: tags.name || 'Most', layer: layerVal });
    }
    return true;
  }

  if (isOsmPierTagsJS(tags)) {
    if (ctx.usedWays.has(wid)) return true;
    if (['yes', 'building_passage', 'culvert'].includes(tags.tunnel) || tags.indoor === 'yes') return true;

    const pierKind = getOsmPierKindJS(tags);
    const isFloating = tags.floating === 'yes' || pierKind === 'pontoon';
    const isPierArea = isClosed && tags.area !== 'no' && (tags.area === 'yes' || !tags.highway);

    if (isPierArea) {
      const pts = ctx.nodesToPts(nids, 0.02);
      if (pts.length >= 3) {
        const rec = {
          outer: pts,
          holes: [],
          name: tags.name || 'Molo',
          layer: 0,
          isPier: true,
          pierKind,
          floating: isFloating
        };
        ctx.bridgePolys.push(rec);
        if (!ctx.pierPolys) ctx.pierPolys = [];
        ctx.pierPolys.push({ ...rec, _inBridgePolys: true });
      }
      return true;
    }

    let rwm = pierKind === 'breakwater'
      ? 5.0
      : (pierKind === 'groyne' || pierKind === 'jetty')
        ? 3.2
        : pierKind === 'pontoon'
          ? 2.8
          : (tags.highway === 'service' ? 4.5 : 3.2);
    const explicitW = parseFloatTagJS(tags.width, null);
    if (explicitW !== null && explicitW >= 1.0 && explicitW <= 30.0) rwm = explicitW;
    const wUnits = Math.max(0.30, rwm * (ctx.metersToUnits || 0.14));

    const pts = ctx.nodesToPts(nids, 0.02);
    if (pts.length >= 2) {
      if (!ctx.pierLines) ctx.pierLines = [];
      ctx.pierLines.push({
        pts,
        width: wUnits,
        pierKind,
        floating: isFloating,
        name: tags.name || 'Molo',
        _inBridgePolys: true
      });
      const polyRings = _bufferPierPolylineToPolys2D(pts, wUnits);
      for (let i = 0; i < polyRings.length; i++) {
        ctx.bridgePolys.push({
          outer: polyRings[i],
          holes: [],
          name: tags.name || 'Molo',
          layer: 0,
          isPier: true,
          isPierLine: true,
          pierKind,
          floating: isFloating,
          width: wUnits
        });
      }
    }
    return true;
  }

  return false;
}

function isOsmLinearBridgeOrPierWayJS(tags) {
  if (!tags || isOsmPierTagsJS(tags)) return false;
  const bridgeTag = tags.bridge;
  return Boolean(
    (bridgeTag && !['no', 'false', '0', 'none'].includes(bridgeTag)) ||
    tags.man_made === 'bridge'
  );
}

function finalizeOsmBridgesLayerJS(ctx) {
  if (!ctx.pierPolys) ctx.pierPolys = [];
  if (!ctx.pierLines) ctx.pierLines = [];
}

if (typeof window !== 'undefined') {
  window.isOsmBridgeMultipolygonJS = isOsmBridgeMultipolygonJS;
  window.processOsmBridgeMultipolygonJS = processOsmBridgeMultipolygonJS;
  window.processOsmBridgeOrPierWayJS = processOsmBridgeOrPierWayJS;
  window.isOsmLinearBridgeOrPierWayJS = isOsmLinearBridgeOrPierWayJS;
  window.finalizeOsmBridgesLayerJS = finalizeOsmBridgesLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isOsmBridgeMultipolygonJS,
    processOsmBridgeMultipolygonJS,
    processOsmBridgeOrPierWayJS,
    isOsmLinearBridgeOrPierWayJS,
    finalizeOsmBridgesLayerJS
  };
}
