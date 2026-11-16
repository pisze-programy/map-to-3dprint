// ============================================================================
// src/gis_fetch/osm_element_merger.js
// Non-Mutating O(N) Cross-Chunk OSM Element Deduplicator & Scale Building Filter
// Layer 1 (Zero internal module dependencies)
// ============================================================================

(function (root) {
  function _hasNonEmptyTagsJS(tags) {
    if (!tags || typeof tags !== 'object') return false;
    for (const k in tags) {
      if (Object.prototype.hasOwnProperty.call(tags, k)) return true;
    }
    return false;
  }

  function mergeOsmElementJS(existing, incoming) {
    if (!existing) return incoming;
    if (!incoming) return existing;
    const exHasTags = _hasNonEmptyTagsJS(existing.tags);
    const inHasTags = _hasNonEmptyTagsJS(incoming.tags);
    let mergedTags;
    if (exHasTags && inHasTags) {
      mergedTags = { ...incoming.tags, ...existing.tags };
    } else if (exHasTags) {
      mergedTags = existing.tags;
    } else if (inHasTags) {
      mergedTags = incoming.tags;
    }

    const out = { ...incoming, ...existing };
    if (mergedTags !== undefined) {
      out.tags = mergedTags;
    } else {
      delete out.tags;
    }

    const etype = existing.type || incoming.type;
    if (etype === 'node') {
      const exLatOk = Number.isFinite(existing.lat);
      const exLonOk = Number.isFinite(existing.lon);
      const inLatOk = Number.isFinite(incoming.lat);
      const inLonOk = Number.isFinite(incoming.lon);
      if (exLatOk && exLonOk) {
        out.lat = existing.lat;
        out.lon = existing.lon;
      } else if (inLatOk && inLonOk) {
        out.lat = incoming.lat;
        out.lon = incoming.lon;
      } else {
        if (exLatOk || inLatOk) out.lat = exLatOk ? existing.lat : incoming.lat;
        if (exLonOk || inLonOk) out.lon = exLonOk ? existing.lon : incoming.lon;
      }
    } else if (etype === 'way') {
      const exNodes = Array.isArray(existing.nodes) ? existing.nodes : [];
      const inNodes = Array.isArray(incoming.nodes) ? incoming.nodes : [];
      out.nodes = inNodes.length > exNodes.length ? inNodes : exNodes;
    } else if (etype === 'relation') {
      const exMembers = Array.isArray(existing.members) ? existing.members : [];
      const inMembers = Array.isArray(incoming.members) ? incoming.members : [];
      out.members = inMembers.length > exMembers.length ? inMembers : exMembers;
    }

    return out;
  }

  // Strictly O(N) non-mutating cross-chunk deduplicator preserving tags, coords, nodes & members.
  function mergeAndDeduplicateElements(elementArrays, _maxSpanM = 1200, _lodOptions = null) {
    const nodeMap = new Map();
    const wayMap = new Map();
    const relMap = new Map();

    for (const arr of (elementArrays || [])) {
      if (!Array.isArray(arr)) continue;
      for (let i = 0, len = arr.length; i < len; i++) {
        const el = arr[i];
        if (!el || el.id === undefined || el.id === null) continue;
        if (el.type === 'node') {
          const prev = nodeMap.get(el.id);
          nodeMap.set(el.id, prev ? mergeOsmElementJS(prev, el) : el);
        } else if (el.type === 'way') {
          const prev = wayMap.get(el.id);
          wayMap.set(el.id, prev ? mergeOsmElementJS(prev, el) : el);
        } else if (el.type === 'relation') {
          const prev = relMap.get(el.id);
          relMap.set(el.id, prev ? mergeOsmElementJS(prev, el) : el);
        }
      }
    }

    const total = nodeMap.size + wayMap.size + relMap.size;
    const merged = new Array(total);
    let idx = 0;
    for (const v of nodeMap.values()) merged[idx++] = v;
    for (const v of wayMap.values()) merged[idx++] = v;
    for (const v of relMap.values()) merged[idx++] = v;
    return merged;
  }

  function filterPrintableBuildingsForScale(scene, maxBuildings = Infinity) {
    if (!scene || !Array.isArray(scene.buildings) || !Number.isFinite(maxBuildings) || scene.buildings.length <= maxBuildings) {
      return scene;
    }
    const inBedFn = typeof scene._priorityBedCheck === 'function' ? scene._priorityBedCheck : null;
    const mustKeep = [];
    const candidates = [];
    const mustKeepGroups = new Set();

    for (const b of scene.buildings) {
      if (b.landmark || b.church || b.tower || (b.h && b.h >= 22)) {
        mustKeep.push(b);
        if (b.groupId) mustKeepGroups.add(b.groupId);
      } else {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [x, y] of (b.outer || b.poly || [])) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        const approxArea = Math.max(0.01, (maxX - minX) * (maxY - minY));
        const inBedBoost = (inBedFn && inBedFn(b.cx || 0, b.cy || 0)) ? 6.0 : 1.0;
        candidates.push({ b, approxArea, inBedBoost });
      }
    }

    const scored = candidates.map((c) => {
      const partMult = c.b.part
        ? (c.b.groupId && mustKeepGroups.has(c.b.groupId) ? 1.8 : 0.75)
        : 1.0;
      return {
        b: c.b,
        score: c.approxArea * (1 + (c.b.h || 10) * 0.04) * c.inBedBoost * partMult,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const remainSlots = Math.max(0, maxBuildings - mustKeep.length);
    const kept = mustKeep.concat(scored.slice(0, remainSlots).map((c) => c.b));
    for (let i = 0; i < kept.length; i++) kept[i].id = i + 1;
    scene.buildings = kept;
    return scene;
  }

  const exportsObj = {
    mergeOsmElementJS,
    mergeAndDeduplicateElements,
    filterPrintableBuildingsForScale,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
