// ============================================================================
// src/landmarks/landmark_registry.js
// Geo-Anchored Hero Landmark Registry, OSM Suppression & Metric Bed Transform
// ============================================================================

(function (root) {
  const _registry = new Map();

  /** @param {number|string|null|undefined} rawId @returns {number|null} */
  function _parseOsmIdNum(rawId) {
    if (rawId === null || rawId === undefined) return null;
    if (typeof rawId === 'number' && Number.isFinite(rawId)) return Math.trunc(rawId);
    const m = String(rawId).match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  /** @param {number} latA @param {number} lonA @param {number} latB @param {number} lonB @returns {number} */
  function _approxDistanceMeters(latA, lonA, latB, lonB) {
    const cosLat = Math.max(0.2, Math.cos((((latA + latB) * 0.5) * Math.PI) / 180.0));
    return Math.hypot((lonB - lonA) * 111320.0 * cosLat, (latB - latA) * 111320.0);
  }

  /** @param {object|null|undefined} scene @returns {[number, number]|null} */
  function _resolveSceneCenter(scene) {
    if (!scene) return null;
    const raw = (scene.meta && Array.isArray(scene.meta.center) && scene.meta.center.length >= 2)
      ? scene.meta.center
      : (Array.isArray(scene.center) && scene.center.length >= 2 ? scene.center : null);
    if (!raw) return null;
    const lat = Number(raw[0]), lon = Number(raw[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) ? null : [lat, lon];
  }

  /** @param {number} px @param {number} py @param {number[][]} ring @returns {boolean} */
  function _pointInRing2D(px, py, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  /**
   * Registers a curated geo-anchored hero landmark specification.
   * @param {object} spec
   * @returns {object}
   */
  function registerHeroLandmark(spec) {
    if (!spec || typeof spec.id !== 'string' || !spec.id.trim()) {
      throw new Error('registerHeroLandmark requires a non-empty string id');
    }
    if (!Number.isFinite(Number(spec.lat)) || !Number.isFinite(Number(spec.lon))) {
      throw new Error(`registerHeroLandmark(${spec.id}) requires finite lat and lon`);
    }
    if (typeof spec.buildManifold !== 'function') {
      throw new Error(`registerHeroLandmark(${spec.id}) requires buildManifold function`);
    }
    const replaceSet = new Set();
    for (const rawId of (spec.replaceOsmIds || [])) {
      const num = _parseOsmIdNum(rawId);
      if (num !== null) replaceSet.add(num);
    }
    const normalized = {
      id: spec.id.trim(),
      name: String(spec.name || spec.id).trim(),
      lat: Number(spec.lat),
      lon: Number(spec.lon),
      headingDeg: Number(spec.headingDeg) || 0,
      footprintRadiusM: Math.max(5, Number(spec.footprintRadiusM) || 80),
      maxHeightM: Math.max(0, Number(spec.maxHeightM) || 0),
      replaceOsmIds: Array.from(replaceSet),
      replaceOsmIdSet: replaceSet,
      replacePolygonM: (Array.isArray(spec.replacePolygonM) && spec.replacePolygonM.length >= 3) ? spec.replacePolygonM : null,
      buildManifold: spec.buildManifold,
    };
    _registry.set(normalized.id, normalized);
    return normalized;
  }

  /** @param {string} id @returns {boolean} */
  function unregisterHeroLandmark(id) {
    return _registry.delete(String(id || ''));
  }

  /** @returns {object[]} */
  function listHeroLandmarks() {
    return Array.from(_registry.values());
  }

  /**
   * Computes local-meter to bed-unit transform for a landmark inside a scene.
   * @param {object} spec @param {object} scene @param {object} ctx
   * @returns {object|null}
   */
  function _computeBaseGeoTransform(spec, scene, ctx) {
    const center = _resolveSceneCenter(scene);
    if (!center) return null;
    const [centerLat, centerLon] = center;
    const distM = _approxDistanceMeters(centerLat, centerLon, spec.lat, spec.lon);
    if (distM > 5000.0) return null;

    const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180.0));
    const dxM = (spec.lon - centerLon) * 111320.0 * cosLat;
    const dyM = (spec.lat - centerLat) * 111320.0;
    const rawMToU = (scene && scene.metersToUnits) || ctx.mToU;
    const scaleToBed = ctx.scaleToBed || 1.0;
    const uPerM = rawMToU * scaleToBed;
    const zPerM = rawMToU * (ctx.zScale || 1.0) * scaleToBed;
    const rotDeg = Number(ctx.rotDeg) || 0;

    let cxBed, cyBed;
    if (typeof ctx.latLonToScene === 'function') {
      [cxBed, cyBed] = ctx.latLonToScene(spec.lat, spec.lon);
    } else {
      const rotRad = (rotDeg * Math.PI) / 180.0;
      const cr = Math.cos(rotRad), sr = Math.sin(rotRad);
      const ux = dxM * rawMToU, uy = dyM * rawMToU;
      const rx = rotDeg === 0 ? ux : (ux * cr - uy * sr);
      const ry = rotDeg === 0 ? uy : (ux * sr + uy * cr);
      [cxBed, cyBed] = typeof ctx.toBed === 'function' ? ctx.toBed([rx, ry]) : [rx, ry];
    }

    const headingBedDeg = (Number(spec.headingDeg) || 0) + rotDeg;
    const hRad = (headingBedDeg * Math.PI) / 180.0;
    const cosH = Math.cos(hRad), sinH = Math.sin(hRad);
    const toBedXY = (xM, yM) => [
      cxBed + (xM * cosH - yM * sinH) * uPerM,
      cyBed + (xM * sinH + yM * cosH) * uPerM,
    ];
    const bedToLocalM = (bx, by) => {
      const lxU = (bx - cxBed) / Math.max(1e-8, uPerM);
      const lyU = (by - cyBed) / Math.max(1e-8, uPerM);
      return [lxU * cosH + lyU * sinH, -lxU * sinH + lyU * cosH];
    };
    const marginU = Math.max(2.0, spec.footprintRadiusM * uPerM + 1.0);
    const inBedBounds = (
      cxBed >= -ctx.halfW - marginU && cxBed <= ctx.halfW + marginU &&
      cyBed >= -ctx.halfH - marginU && cyBed <= ctx.halfH + marginU
    );
    return { centerLat, centerLon, distM, cxBed, cyBed, uPerM, zPerM, headingBedDeg, cosH, sinH, toBedXY, bedToLocalM, inBedBounds };
  }

  /**
   * Checks whether a scene building matches a hero landmark for OSM suppression.
   * @param {object} spec @param {object} b @param {Record<string, string>|null} tags
   * @param {object|null} metaP @param {object} ctx @param {object|null} [baseXf=null]
   * @returns {boolean}
   */
  function matchBuildingForLandmark(spec, b, tags, metaP, ctx, baseXf = null) {
    if (!spec || !b) return false;
    const osmNum = _parseOsmIdNum(b.osmId);
    if (osmNum !== null && spec.replaceOsmIdSet && spec.replaceOsmIdSet.has(osmNum)) return true;
    const grpNum = _parseOsmIdNum(b.groupId);
    if (grpNum !== null && spec.replaceOsmIdSet && spec.replaceOsmIdSet.has(grpNum) && !spec.replacePolygonM) return true;
    if (spec.replacePolygonM && baseXf && Array.isArray(b.outer) && b.outer.length >= 3) {
      const outerBed = (metaP && metaP.outerBed) ? metaP.outerBed : b.outer.map(ctx.toBed);
      let sx = 0, sy = 0;
      for (let i = 0; i < outerBed.length; i++) { sx += outerBed[i][0]; sy += outerBed[i][1]; }
      const [locX, locY] = baseXf.bedToLocalM(sx / outerBed.length, sy / outerBed.length);
      if (_pointInRing2D(locX, locY, spec.replacePolygonM)) return true;
    }
    return false;
  }

  /**
   * Finds all active geo-anchored landmarks within scene bounds and builds
   * OSM suppression sets for Layer 1 S3DB and Layer 2 archetypes.
   * @param {object} scene @param {object} ctx @param {Map|null} [rawTagById=null]
   * @returns {{ active: object[], suppressedBuildingIndices: Set<number>, suppressedBuildingIds: Set<number|string>, suppressedOsmIds: Set<number> }}
   */
  function findActiveLandmarksAndSuppression(scene, ctx, rawTagById = null) {
    const active = [], suppressedBuildingIndices = new Set(), suppressedBuildingIds = new Set(), suppressedOsmIds = new Set();
    if (!_registry.size || !scene || !ctx || !_resolveSceneCenter(scene)) {
      return { active, suppressedBuildingIndices, suppressedBuildingIds, suppressedOsmIds };
    }
    const candidates = [];
    for (const spec of _registry.values()) {
      const baseXf = _computeBaseGeoTransform(spec, scene, ctx);
      if (baseXf && baseXf.inBedBounds) {
        candidates.push({ spec, baseXf, matchedBuildings: [], matchedIndices: [], groupIds: new Set(), maxMatchedH: spec.maxHeightM || 0 });
      }
    }
    if (candidates.length === 0) {
      return { active, suppressedBuildingIndices, suppressedBuildingIds, suppressedOsmIds };
    }
    const buildings = (scene && scene.buildings) || [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) continue;
      const tags = Object.assign({}, (rawTagById && rawTagById.get(b.osmId)) || {}, b.tags || {});
      for (let ci = 0; ci < candidates.length; ci++) {
        const entry = candidates[ci];
        if (!matchBuildingForLandmark(entry.spec, b, tags, null, ctx, entry.baseXf)) continue;
        entry.matchedBuildings.push(b);
        entry.matchedIndices.push(i);
        if (b.groupId !== undefined && b.groupId !== null) entry.groupIds.add(String(b.groupId));
        const hVal = Number((b.h !== undefined && b.h !== null) ? b.h : (b.height || 0)) || 0;
        if (hVal > entry.maxMatchedH) entry.maxMatchedH = hVal;
        suppressedBuildingIndices.add(i);
        if (b.id !== undefined && b.id !== null) suppressedBuildingIds.add(b.id);
        const osmNum = _parseOsmIdNum(b.osmId);
        if (osmNum !== null) suppressedOsmIds.add(osmNum);
        break;
      }
    }
    for (let ci = 0; ci < candidates.length; ci++) {
      for (const oid of candidates[ci].spec.replaceOsmIds) suppressedOsmIds.add(oid);
      active.push(candidates[ci]);
    }
    return { active, suppressedBuildingIndices, suppressedBuildingIds, suppressedOsmIds };
  }

  /**
   * Computes full landmark anchor with terrain/group zDatumU, toBedZ, and matchedBoundsM.
   * @param {object} spec @param {object} scene @param {object} ctx
   * @param {object[]} matchedBuildings @param {object|null} terrainWater @param {Map|null} [groupDatumById=null]
   * @returns {object|null}
   */
  function computeLandmarkAnchor(spec, scene, ctx, matchedBuildings, terrainWater, groupDatumById = null) {
    const baseXf = _computeBaseGeoTransform(spec, scene, ctx);
    if (!baseXf) return null;

    let zDatumU = Infinity;
    if (groupDatumById && Array.isArray(matchedBuildings)) {
      for (let i = 0; i < matchedBuildings.length; i++) {
        const b = matchedBuildings[i];
        if (b && b.groupId !== undefined && b.groupId !== null) {
          const gd = groupDatumById.get(String(b.groupId));
          if (Number.isFinite(gd) && gd < zDatumU) zDatumU = gd;
        }
      }
    }
    if (!Number.isFinite(zDatumU)) {
      const rSamp = Math.min(spec.footprintRadiusM * 0.45, 30.0);
      const pts = [
        [baseXf.cxBed, baseXf.cyBed],
        baseXf.toBedXY(-rSamp, 0), baseXf.toBedXY(rSamp, 0),
        baseXf.toBedXY(0, -rSamp), baseXf.toBedXY(0, rSamp),
      ];
      let dryMinZ = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = pts[i];
        if (terrainWater && terrainWater.isPointInWater(px, py)) continue;
        const z = (terrainWater && typeof terrainWater.getDrySurfaceZ === 'function')
          ? terrainWater.getDrySurfaceZ(px, py)
          : ((terrainWater && typeof terrainWater.getSurfaceZ === 'function')
              ? terrainWater.getSurfaceZ(px, py)
              : ctx.getTerrainZ(px, py));
        if (Number.isFinite(z) && z < dryMinZ) dryMinZ = z;
      }
      zDatumU = Math.max(ctx.zLandDatum, Number.isFinite(dryMinZ) ? dryMinZ : ctx.zLandDatum);
    }

    let matchedBoundsM = null;
    if (Array.isArray(matchedBuildings) && matchedBuildings.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxH = 0, minH = Infinity;
      for (let i = 0; i < matchedBuildings.length; i++) {
        const b = matchedBuildings[i];
        if (!b || !Array.isArray(b.outer)) continue;
        const bh = Number((b.h !== undefined && b.h !== null) ? b.h : (b.height || 0)) || 0;
        const bmh = Math.max(0, Number(b.minH || 0) || 0);
        if (bh > maxH) maxH = bh;
        if (bmh < minH) minH = bmh;
        for (let k = 0; k < b.outer.length; k++) {
          const bp = ctx.toBed(b.outer[k]);
          const [lx, ly] = baseXf.bedToLocalM(bp[0], bp[1]);
          if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
          if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
        }
      }
      if (Number.isFinite(minX)) {
        matchedBoundsM = { minX, maxX, minY, maxY, widthM: maxX - minX, depthM: maxY - minY, minH: Number.isFinite(minH) ? minH : 0, maxH, count: matchedBuildings.length };
      }
    }

    const minFloorZ = 0.15 / Math.max(1e-6, ctx.scaleMm);
    const toBedZ = (altM) => {
      const a = Number(altM) || 0;
      const rawZ = zDatumU + a * baseXf.zPerM;
      if (a <= 0) return Math.max(minFloorZ, rawZ);
      const compZ = typeof ctx.compressZUnits === 'function' ? ctx.compressZUnits(rawZ) : rawZ;
      return Math.min(ctx.maxZUnits, compZ);
    };

    return {
      id: spec.id, name: spec.name,
      cxBed: baseXf.cxBed, cyBed: baseXf.cyBed,
      zDatumU, uPerM: baseXf.uPerM, zPerM: baseXf.zPerM,
      headingBedDeg: baseXf.headingBedDeg,
      toBedXY: baseXf.toBedXY, bedToLocalM: baseXf.bedToLocalM,
      toBedZ, matchedBoundsM,
    };
  }

  const exportsObj = {
    registerHeroLandmark,
    unregisterHeroLandmark,
    listHeroLandmarks,
    matchBuildingForLandmark,
    findActiveLandmarksAndSuppression,
    computeLandmarkAnchor,
  };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
