// ============================================================================
// src/gis_client/osm_pier_geometry_helper.js
// Backward-Compatible Shim -> src/Water/water_pier_osm_helper.js
// ============================================================================

(function (root) {
  const mod = (typeof require === 'function')
    ? require('../Water/water_pier_osm_helper.js')
    : {
        _pointInRingExtract2D: root._pointInRingExtract2D,
        _ringInsideOuterExtract2D: root._ringInsideOuterExtract2D,
        _signedRingAreaExtract2D: root._signedRingAreaExtract2D,
        _ringCentroidExtract2D: root._ringCentroidExtract2D,
        _segsCrossExtract2D: root._segsCrossExtract2D,
        _isSimpleRingExtract2D: root._isSimpleRingExtract2D,
        _polylineCrossesRingExtract2D: root._polylineCrossesRingExtract2D,
        _bufferPierPolylineToPolys2D: root._bufferPierPolylineToPolys2D
      };

  Object.assign(root, mod);
  if (typeof window !== 'undefined') Object.assign(window, mod);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
