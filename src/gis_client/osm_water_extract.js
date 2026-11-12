// ============================================================================
// src/gis_client/osm_water_extract.js
// OSM Water Layer Extractor (Water Polygons, Rivers/Canals/Streams, Islands, Shingle & Coastlines)
// ============================================================================

if (typeof simplifyRingJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./overpass_dem_fetch.js'));
}
if (typeof parseFloatTagJS === 'undefined' && typeof require !== 'undefined') {
  Object.assign(global, require('./s3db_client_matcher.js'));
}

function isNonSurfaceWaterTagsJS(tags) {
  if (!tags) return false;
  const norm = (v) => String(v || '').trim().toLowerCase();
  if (tags.tunnel !== undefined) {
    const tv = norm(tags.tunnel);
    if (tv && !['no', 'false', '0', 'none'].includes(tv)) return true;
  }
  if (tags.covered !== undefined) {
    const cv = norm(tags.covered);
    if (cv && !['no', 'false', '0', 'none'].includes(cv)) return true;
  }
  if (tags.indoor !== undefined) {
    const iv = norm(tags.indoor);
    if (iv && !['no', 'false', '0', 'none'].includes(iv)) return true;
  }
  if (tags.location !== undefined) {
    const lv = norm(tags.location);
    if (['underground', 'underwater', 'indoor', 'roof', 'overhead'].includes(lv)) return true;
  }
  if (norm(tags.dock) === 'drydock') return true;
  if (norm(tags.waterway) === 'pressurised' || norm(tags.man_made) === 'pipeline') return true;
  if (tags.layer !== undefined && String(tags.layer).trim() !== '') {
    const layerNum = parseFloat(String(tags.layer).replace(',', '.'));
    if (Number.isFinite(layerNum) && layerNum < 0) return true;
  }
  return false;
}

function isOsmShingleOrShoalTagsJS(tags) {
  if (!tags) return false;
  const nat = String(tags.natural || '').trim().toLowerCase();
  if (['shingle', 'shoal', 'mud'].includes(nat)) return true;
  const wet = String(tags.wetland || '').trim().toLowerCase();
  if (wet === 'tidalflat' || wet === 'mud') return true;
  return false;
}

function isOsmStandaloneIslandTagsJS(tags) {
  if (!tags) return false;
  const pl = String(tags.place || '').trim().toLowerCase();
  return pl === 'island' || pl === 'islet';
}

function defaultWaterwayWidthMetersJS(waterwayTag) {
  const ww = String(waterwayTag || '').trim().toLowerCase();
  if (ww === 'river') return 10.0;
  if (ww === 'dock') return 6.0;
  if (ww === 'canal') return 4.5;
  if (ww === 'stream') return 1.8;
  if (ww === 'drain' || ww === 'ditch') return 1.0;
  return 1.8;
}

function _waterPointInPolyJS(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yin = poly[j][1];
    if (((yi > py) !== (yin > py)) && (px < (xj - xi) * (py - yi) / ((yin - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function _waterRingAbsAreaJS(ring) {
  if (!ring || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) * 0.5;
}

function _waterPointToRingDistSqJS(px, py, ring) {
  let minD2 = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const ax = ring[i][0], ay = ring[i][1];
    const bx = ring[(i + 1) % n][0], by = ring[(i + 1) % n][1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const qx = ax + t * dx, qy = ay + t * dy;
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d2 < minD2) minD2 = d2;
  }
  return minD2;
}

function _waterRingProbePtJS(ring) {
  if (!ring || ring.length === 0) return [0, 0];
  let cx = 0, cy = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const x = ring[i][0], y = ring[i][1];
    cx += x; cy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  cx /= ring.length;
  cy /= ring.length;

  let bestPt = null;
  let bestD2 = -1;
  const consider = (px, py) => {
    if (!_waterPointInPolyJS(px, py, ring)) return;
    const d2 = _waterPointToRingDistSqJS(px, py, ring);
    if (d2 > bestD2) { bestD2 = d2; bestPt = [px, py]; }
  };

  consider(cx, cy);
  const steps = 7;
  for (let iy = 1; iy < steps; iy++) {
    const py = minY + (iy / steps) * (maxY - minY);
    for (let ix = 1; ix < steps; ix++) {
      const px = minX + (ix / steps) * (maxX - minX);
      consider(px, py);
    }
  }
  if (!bestPt) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
      consider((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3);
    }
  }
  return bestPt || [ring[0][0], ring[0][1]];
}

function _waterRingsMatchSameLoopJS(rA, rB) {
  if (!rA || !rB || rA.length < 3 || rB.length < 3) return false;
  const aA = _waterRingAbsAreaJS(rA);
  const aB = _waterRingAbsAreaJS(rB);
  if (aA <= 1e-5 || aB <= 1e-5) return false;
  const ratio = aA > aB ? aA / aB : aB / aA;
  if (ratio > 1.18) return false;
  const pA = _waterRingProbePtJS(rA);
  const pB = _waterRingProbePtJS(rB);
  return _waterPointInPolyJS(pA[0], pA[1], rB) && _waterPointInPolyJS(pB[0], pB[1], rA);
}

function _waterRingStrictlyInsideOuterJS(hole, outer) {
  if (!hole || hole.length < 3 || !outer || outer.length < 3) return false;
  const probe = _waterRingProbePtJS(hole);
  if (!_waterPointInPolyJS(probe[0], probe[1], outer)) return false;
  for (let i = 0; i < hole.length; i++) {
    if (!_waterPointInPolyJS(hole[i][0], hole[i][1], outer)) return false;
  }
  return true;
}

function collectOsmWaterSampleCandidateJS(w, wt, wn, isBrWay, isTunWay, nodes, fetchHalfW, fetchHalfH, allWaterCandidates) {
  if ((wt.waterway === 'river' || wt.waterway === 'canal') && !isTunWay && !isNonSurfaceWaterTagsJS(wt)) {
    const weight = wt.waterway === 'river' ? 3 : 2;
    const wName = String(wt.name || wt['name:en'] || '').trim().toLowerCase();
    const stride = Math.max(1, Math.floor(wn.length / 6));
    for (let i = 0; i < wn.length; i += stride) {
      const pt = nodes.get(wn[i]);
      if (pt && Math.abs(pt[0]) <= fetchHalfW && Math.abs(pt[1]) <= fetchHalfH) {
        allWaterCandidates.push([pt[0], pt[1], weight, wName]);
      }
    }
    return true;
  }
  return false;
}

function isOsmWaterMultipolygonJS(tags) {
  return Boolean(
    tags.natural === 'water' ||
    ['riverbank', 'dock', 'canal'].includes(tags.waterway) ||
    Boolean(tags.water) ||
    ['reservoir', 'basin'].includes(tags.landuse) ||
    tags.leisure === 'marina'
  );
}

function processOsmWaterMultipolygonJS(rel, tags, raw, ctx, extraFlags = null) {
  if (!ctx._standaloneIslands) ctx._standaloneIslands = [];
  if (!ctx._shinglePolys) ctx._shinglePolys = [];

  if (isOsmWaterMultipolygonJS(tags)) {
    if (isNonSurfaceWaterTagsJS(tags)) {
      for (const wid of raw.memberWayIds) ctx.usedWays.add(wid);
      return true;
    }
    const relName = String(tags.name || tags['name:en'] || '').trim().toLowerCase();
    const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
      ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH, {
          isWater: true,
          isGreen: Boolean(extraFlags && extraFlags.isGreen),
          isPlaza: Boolean(extraFlags && extraFlags.isPlaza),
          relName,
          waterSamplePts: ctx.waterSamplePts,
          buildingSamplePts: ctx.buildingSamplePts,
          roadSamplePts: ctx.roadSamplePts,
          tol: 0.018
        })
      : null;
    const stFallback = ctx.stitchedRelPolys.get(rel.id) || { outerPolys: [], innerPolys: [] };
    const entries = clipped
      ? clipped.outerEntries
      : stFallback.outerPolys.map(op => ({
          outer: op,
          holes: stFallback.innerPolys
        }));
    if (entries.length === 0) return true;

    // Identify inner member ways tagged as shingle/shoal/mud gravel bars
    const shingleInnerPolys = [];
    if (ctx.ways && Array.isArray(rel.members)) {
      const shingleWayNodeLists = [];
      for (const m of rel.members) {
        if (m.type === 'way' && m.role === 'inner' && ctx.ways.has(m.ref)) {
          const mw = ctx.ways.get(m.ref);
          if (mw && isOsmShingleOrShoalTagsJS(mw.tags)) {
            shingleWayNodeLists.push(mw.nodes || []);
          }
        }
      }
      if (shingleWayNodeLists.length > 0 && typeof stitchWayRingsJS === 'function') {
        const stitchedShingle = stitchWayRingsJS(shingleWayNodeLists)
          .map(r => ctx.nodesToPts(r, 0.018))
          .filter(p => p.length >= 3);
        for (const sp of stitchedShingle) shingleInnerPolys.push(sp);
      }
    }

    for (const wid of raw.memberWayIds) ctx.usedWays.add(wid);
    for (const e of entries) {
      const holes = Array.isArray(e.holes) ? e.holes.slice() : [];
      const shingleHoleIndices = [];
      if (shingleInnerPolys.length > 0 && holes.length > 0) {
        for (let hi = 0; hi < holes.length; hi++) {
          if (shingleInnerPolys.some(sp => _waterRingsMatchSameLoopJS(holes[hi], sp))) {
            shingleHoleIndices.push(hi);
          }
        }
      }
      const wpEntry = { outer: e.outer, holes, name: tags.name || 'Woda' };
      if (shingleHoleIndices.length > 0) wpEntry.shingleHoleIndices = shingleHoleIndices;
      ctx.waterPolys.push(wpEntry);
    }
    return true;
  }

  // Multipolygon shingle / shoal / tidalflat gravel bars (non-water riverbed shoals)
  if (isOsmShingleOrShoalTagsJS(tags)) {
    const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
      ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH, {
          isWater: false,
          isGreen: false,
          isPlaza: false,
          buildingSamplePts: ctx.buildingSamplePts,
          roadSamplePts: ctx.roadSamplePts,
          tol: 0.018
        })
      : null;
    const entries = clipped ? clipped.outerEntries : [];
    for (const e of entries) {
      if (e.outer && e.outer.length >= 3) ctx._shinglePolys.push(e.outer);
    }
    if (!extraFlags || (!extraFlags.isGreen && !extraFlags.isPlaza)) {
      for (const wid of raw.memberWayIds) ctx.usedWays.add(wid);
      return true;
    }
    return false;
  }

  // Standalone place=island / place=islet multipolygons: record land ring without blocking greenery/plaza extraction
  if (isOsmStandaloneIslandTagsJS(tags)) {
    const clipped = (typeof stitchClippedMultipolygonRingsJS === 'function')
      ? stitchClippedMultipolygonRingsJS(raw.outerWays, raw.innerWays, ctx.nodesToPts, ctx.fetchHalfW, ctx.fetchHalfH, {
          isWater: false,
          isGreen: Boolean(extraFlags && extraFlags.isGreen),
          isPlaza: Boolean(extraFlags && extraFlags.isPlaza),
          buildingSamplePts: ctx.buildingSamplePts,
          roadSamplePts: ctx.roadSamplePts,
          tol: 0.018
        })
      : null;
    const entries = clipped ? clipped.outerEntries : [];
    for (const e of entries) {
      if (e.outer && e.outer.length >= 3) ctx._standaloneIslands.push(e.outer);
    }
    if (!extraFlags || (!extraFlags.isGreen && !extraFlags.isPlaza)) {
      return true;
    }
    return false;
  }

  return false;
}

function processOsmCoastlineWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (tags.natural === 'coastline') {
    const pts = nids.map(id => ctx.nodes.get(id)).filter(Boolean);
    if (pts.length >= 2) ctx.coastWays.push(pts);
    if (isClosed && isOsmStandaloneIslandTagsJS(tags)) {
      if (!ctx._standaloneIslands) ctx._standaloneIslands = [];
      const islPts = ctx.nodesToPts(nids, 0.018);
      if (islPts.length >= 3) ctx._standaloneIslands.push(islPts);
    }
    return true;
  }
  return false;
}

function processOsmWaterWayJS(wid, w, tags, nids, isClosed, ctx) {
  if (!ctx._standaloneIslands) ctx._standaloneIslands = [];
  if (!ctx._shinglePolys) ctx._shinglePolys = [];

  const isArealWater = (
    tags.natural === 'water' ||
    ['riverbank', 'dock'].includes(tags.waterway) ||
    Boolean(tags.water) ||
    ['reservoir', 'basin'].includes(tags.landuse) ||
    tags.leisure === 'marina'
  );

  if (isArealWater && isClosed) {
    if (isNonSurfaceWaterTagsJS(tags)) return true;
    if (!ctx.usedWays.has(wid)) {
      const pts = ctx.nodesToPts(nids, 0.025);
      if (pts.length >= 3) ctx.waterPolys.push({ outer: pts, holes: [], name: tags.name || 'Woda' });
    }
    return true;
  }

  if (isClosed && isOsmShingleOrShoalTagsJS(tags)) {
    const pts = ctx.nodesToPts(nids, 0.02);
    if (pts.length >= 3) ctx._shinglePolys.push(pts);
    return true;
  }

  if (isClosed && isOsmStandaloneIslandTagsJS(tags) && !isArealWater) {
    const pts = ctx.nodesToPts(nids, 0.02);
    if (pts.length >= 3) ctx._standaloneIslands.push(pts);
    // Return false so greenery / woodland / park tags on the island way still extract downstream
    return false;
  }

  if (tags.waterway && ['river', 'canal', 'stream', 'dock', 'drain', 'ditch'].includes(tags.waterway)) {
    if (isNonSurfaceWaterTagsJS(tags)) return true;
    const ww = String(tags.waterway).trim().toLowerCase();
    const explicitW = parseFloatTagJS(tags.width, null);
    if ((ww === 'drain' || ww === 'ditch') && !(explicitW >= 2.5) && (ctx.effectiveSpanM || 1200) > 2600) {
      return true;
    }
    const pts = ctx.nodesToPts(nids, 0.035);
    if (pts.length >= 2) {
      const wm = (explicitW !== null && explicitW > 0) ? explicitW : defaultWaterwayWidthMetersJS(ww);
      const widthUnits = Math.round(Math.max(0.08, wm * (ctx.metersToUnits || 0.14)) * 1000) / 1000;
      ctx.waterLines.push({
        pts,
        width: widthUnits,
        waterway: ww,
        name: tags.name || tags.waterway
      });
    }
    return true;
  }

  return false;
}

function finalizeOsmWaterLayerJS(ctx) {
  stitchCoastlineSeaPolysJS(ctx.coastWays, ctx.fetchHalfW, ctx.fetchHalfH, ctx.waterPolys);

  const waterPolys = ctx.waterPolys || [];
  if (waterPolys.length === 0) return;

  // Collect all explicit island holes (from multipolygons + coastline islands) and standalone place=island|islet polygons
  const allIslandEntries = [];
  for (let wi = 0; wi < waterPolys.length; wi++) {
    const wp = waterPolys[wi];
    const shingleSet = new Set(wp.shingleHoleIndices || []);
    const holes = wp.holes || [];
    for (let hi = 0; hi < holes.length; hi++) {
      const h = holes[hi];
      const area = _waterRingAbsAreaJS(h);
      if (area > 1e-4) {
        allIslandEntries.push({ ring: h, area, isShingle: shingleSet.has(hi) });
      }
    }
  }

  for (const isl of (ctx._standaloneIslands || [])) {
    const area = _waterRingAbsAreaJS(isl);
    if (area <= 1e-4) continue;
    if (!allIslandEntries.some(e => _waterRingsMatchSameLoopJS(e.ring, isl))) {
      allIslandEntries.push({ ring: isl, area, isShingle: false });
    }
  }

  const extraShingleRings = [];
  for (const sh of (ctx._shinglePolys || [])) {
    const area = _waterRingAbsAreaJS(sh);
    if (area <= 1e-4) continue;
    const existing = allIslandEntries.find(e => _waterRingsMatchSameLoopJS(e.ring, sh));
    if (existing) {
      existing.isShingle = true;
    } else {
      allIslandEntries.push({ ring: sh, area, isShingle: true });
      extraShingleRings.push(sh);
    }
  }

  // Propagate strictly-contained island/shingle holes across overlapping larger waterPolys
  // (e.g. marinas or overlapping river sections) so 2D evenodd rendering & 3D masks stay consistent,
  // while never carving out genuine nested ponds that are strictly smaller than the island.
  const outerAreas = waterPolys.map(wp => _waterRingAbsAreaJS(wp.outer));
  const extraLandRings = [];

  for (const entry of allIslandEntries) {
    let attachedStrict = false;
    for (let wi = 0; wi < waterPolys.length; wi++) {
      const wp = waterPolys[wi];
      if (outerAreas[wi] <= entry.area * 1.08) continue;
      if (!_waterRingStrictlyInsideOuterJS(entry.ring, wp.outer)) continue;
      attachedStrict = true;
      if (!wp.holes) wp.holes = [];
      let matchIdx = -1;
      for (let hi = 0; hi < wp.holes.length; hi++) {
        if (_waterRingsMatchSameLoopJS(wp.holes[hi], entry.ring)) {
          matchIdx = hi;
          break;
        }
      }
      if (matchIdx === -1) {
        matchIdx = wp.holes.length;
        wp.holes.push(entry.ring);
      }
      if (entry.isShingle) {
        if (!wp.shingleHoleIndices) wp.shingleHoleIndices = [];
        if (!wp.shingleHoleIndices.includes(matchIdx)) wp.shingleHoleIndices.push(matchIdx);
      }
    }
    if (!attachedStrict && !entry.isShingle) {
      extraLandRings.push(entry.ring);
    }
  }

  if (extraLandRings.length > 0) {
    waterPolys[0]._unrotatedLandRings = extraLandRings;
  }
  if (extraShingleRings.length > 0) {
    waterPolys[0]._unrotatedShingleRings = extraShingleRings;
  }
}

if (typeof window !== 'undefined') {
  window.isNonSurfaceWaterTagsJS = isNonSurfaceWaterTagsJS;
  window.collectOsmWaterSampleCandidateJS = collectOsmWaterSampleCandidateJS;
  window.isOsmWaterMultipolygonJS = isOsmWaterMultipolygonJS;
  window.processOsmWaterMultipolygonJS = processOsmWaterMultipolygonJS;
  window.processOsmCoastlineWayJS = processOsmCoastlineWayJS;
  window.processOsmWaterWayJS = processOsmWaterWayJS;
  window.finalizeOsmWaterLayerJS = finalizeOsmWaterLayerJS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isNonSurfaceWaterTagsJS,
    collectOsmWaterSampleCandidateJS,
    isOsmWaterMultipolygonJS,
    processOsmWaterMultipolygonJS,
    processOsmCoastlineWayJS,
    processOsmWaterWayJS,
    finalizeOsmWaterLayerJS
  };
}
