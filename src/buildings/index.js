// ============================================================================
// src/buildings/index.js
// Unified Buildings Architecture Barrel (2D S3DB GIS Extractor + 3D Mesh)
// ============================================================================

(function (root) {
  let exportsObj = {};
  if (typeof require === 'function') {
    const tagParser = require('./s3db_tag_parser.js');
    const containment2d = require('./s3db_containment_2d.js');
    const wheelConsolidator = require('./s3db_wheel_consolidator.js');
    const outlineSuppressor = require('./s3db_outline_suppressor.js');
    const clientMatcher = require('./s3db_client_matcher.js');
    const osmExtractor = require('./osm_buildings_extractor.js');
    const roofDirectionalRevolve = require('./roof_directional_revolve.js');
    const roofSkeletonPoly = require('./roof_skeleton_poly.js');
    const partSolidBuilder = require('./s3db_part_solid_builder.js');
    const skybridgeAnchoring = require('./s3db_skybridge_anchoring.js');
    const layer1S3dbSolver = require('./layer1_s3db_solver.js');
    const archetypeStructuresSolver = require('./archetype_structures_solver.js');
    const layer2ArchetypesSolver = require('./layer2_archetypes_solver.js');

    exportsObj = Object.assign(
      {},
      tagParser,
      containment2d,
      wheelConsolidator,
      outlineSuppressor,
      clientMatcher,
      osmExtractor,
      roofDirectionalRevolve,
      roofSkeletonPoly,
      partSolidBuilder,
      skybridgeAnchoring,
      layer1S3dbSolver,
      archetypeStructuresSolver,
      layer2ArchetypesSolver,
      {
        modules: {
          tagParser,
          containment2d,
          wheelConsolidator,
          outlineSuppressor,
          clientMatcher,
          osmExtractor,
          roofDirectionalRevolve,
          roofSkeletonPoly,
          partSolidBuilder,
          skybridgeAnchoring,
          layer1S3dbSolver,
          archetypeStructuresSolver,
          layer2ArchetypesSolver,
        },
      }
    );
  }

  if (root && typeof root === 'object') {
    root.BuildingsModules = exportsObj.modules || root.BuildingsModules || {};
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
