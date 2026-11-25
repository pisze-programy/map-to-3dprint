// ============================================================================
// src/Water/water_osm_tags.js
// Pure OSM Water, Shingle/Shoal, Standalone Island & Relation Tag Classifiers
// ============================================================================

(function (root) {
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
    return wet === 'tidalflat' || wet === 'mud';
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

  function isOsmArealRelationTypeJS(tags) {
    if (!tags || !tags.type) return true;
    const rt = String(tags.type).trim().toLowerCase();
    return rt === '' || rt === 'multipolygon' || rt === 'boundary';
  }

  function isOsmWaterMultipolygonJS(tags) {
    if (!tags || !isOsmArealRelationTypeJS(tags)) return false;
    return Boolean(
      tags.natural === 'water' ||
      ['riverbank', 'dock', 'canal'].includes(tags.waterway) ||
      Boolean(tags.water) ||
      ['reservoir', 'basin'].includes(tags.landuse) ||
      tags.amenity === 'fountain' ||
      (tags.leisure === 'swimming_pool' && tags.location !== 'indoor' && tags.indoor !== 'yes')
    );
  }

  const exportsObj = {
    isNonSurfaceWaterTagsJS,
    isOsmShingleOrShoalTagsJS,
    isOsmStandaloneIslandTagsJS,
    defaultWaterwayWidthMetersJS,
    isOsmArealRelationTypeJS,
    isOsmWaterMultipolygonJS
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
