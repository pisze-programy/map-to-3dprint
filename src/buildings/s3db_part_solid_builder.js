// ============================================================================
// src/buildings/s3db_part_solid_builder.js
// S3DB Part Elevation, Shared min(DEM) Datum, Spire Cap & Supportless Corbels
// ============================================================================

(function (root) {
  if (typeof root.buildDirectionalOrRevolveRoof !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./roof_directional_revolve.js'));
  }
  if (typeof root.buildSkeletonOrPolyRoof !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./roof_skeleton_poly.js'));
  }

  const LAYER2_MAN_MADE_SET = new Set([
    'wind_turbine', 'cooling_tower', 'chimney', 'storage_tank', 'silo',
    'crane', 'mast', 'communications_tower', 'pier', 'breakwater', 'groyne', 'jetty',
  ]);
  const WHEEL_ATTR_SET = new Set(['big_wheel', 'ferris_wheel', 'observation_wheel']);

  function isLayer2ArchetypeRecord(b, tags = {}) {
    if (!b) return false;
    if (b.archType === 'ferris_wheel' || b.btype === 'pier' || b.btype === 'observation_wheel') return true;
    const attr = String(tags.attraction || '').toLowerCase().trim(), tt = String(tags['tower:type'] || '').toLowerCase().trim();
    const mm = String(tags.man_made || '').toLowerCase().trim(), tc = String(tags['tower:construction'] || b.towerConstruction || '').toLowerCase().trim();
    if (WHEEL_ATTR_SET.has(attr) || tt === 'observation_wheel' || LAYER2_MAN_MADE_SET.has(mm) || mm === 'lighthouse') return true;
    if (tc === 'lattice' || tc === 'guyed_lattice') return true;
    const isPart = Boolean(b.part || b.fromBuildingRel || tags['building:part']);
    return mm === 'tower' && !isPart;
  }

  function _normalizeRoofShape(rawRoof) {
    if (typeof root.normalizeRoofShapeS3DB === 'function') return root.normalizeRoofShapeS3DB(rawRoof);
    const r = String(rawRoof || 'flat').toLowerCase().trim().replace(/\s+/g, '_').replace(/-/g, '_');
    const map = {
      flat: 'flat', none: 'flat', gabled: 'gabled', gable: 'gabled', pitched: 'gabled', basilical: 'gabled',
      hipped: 'hipped', hip: 'hipped', half_hipped: 'half-hipped', half_hip: 'half-hipped', clipped_gable: 'half-hipped',
      pyramidal: 'pyramidal', pyramid: 'pyramidal', dome: 'dome', onion: 'onion',
      round: 'round', round_gabled: 'round', barrel: 'round', arched: 'round', cylindrical: 'round',
      skillion: 'skillion', shed: 'skillion', lean_to: 'skillion', monopitch: 'skillion',
      mansard: 'mansard', gambrel: 'gambrel', double_saltbox: 'gambrel', saltbox: 'saltbox',
      butterfly: 'butterfly', inverted_gable: 'butterfly', sawtooth: 'sawtooth', saw_tooth: 'sawtooth',
      cone: 'cone', conical: 'cone', spire: 'cone', quadruple_saltbox: 'quadruple_saltbox', side_hipped: 'side_hipped', stepped: 'stepped',
    };
    return map[r] || 'flat';
  }

  function _buildRoofManifold(core, mf, outer, holes, zEaves, roofH, roofShape, roofDirDeg = null, roofOrient = 'along', rotDeg = 0) {
    if (roofH <= 1e-4 || roofShape === 'flat') return null;
    const inset = root._insetRoofOuterAndHoles(core, outer, holes);
    const dir = root.buildDirectionalOrRevolveRoof(core, mf, inset.outer, inset.holes, zEaves, roofH, roofShape, roofDirDeg, roofOrient, rotDeg);
    return dir || root.buildSkeletonOrPolyRoof(core, mf, inset.outer, inset.holes, zEaves, roofH, roofShape, roofDirDeg, roofOrient, rotDeg);
  }

  function sampleFootprintTerrainZ(rings, ctx, terrainWater) {
    let minZ = Infinity, maxZ = -Infinity, sumZ = 0, cntZ = 0, touchesWaterCutout = false;
    let dryMinZ = Infinity, waterSurfMinZ = Infinity;
    const samplePt = (px, py) => {
      const inWater = Boolean(terrainWater && terrainWater.isPointInWater(px, py));
      if (ctx.waterCutout && inWater) touchesWaterCutout = true;
      const z = (ctx.waterCutout && inWater) ? 0.0
        : (inWater
          ? (terrainWater && typeof terrainWater.getSurfaceZ === 'function' ? terrainWater.getSurfaceZ(px, py) : ctx.getTerrainZ(px, py))
          : (terrainWater && typeof terrainWater.getDrySurfaceZ === 'function'
            ? terrainWater.getDrySurfaceZ(px, py)
            : (terrainWater && typeof terrainWater.getSurfaceZ === 'function' ? terrainWater.getSurfaceZ(px, py) : ctx.getTerrainZ(px, py))));
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; sumZ += z; cntZ++;
      if (!inWater) {
        if (z < dryMinZ) dryMinZ = z;
      } else {
        const wNom = (terrainWater && typeof terrainWater.getNominalWaterTopZ === 'function')
          ? terrainWater.getNominalWaterTopZ(px, py)
          : (ctx.waterCutout ? ctx.zWaterTop : z);
        if (wNom < waterSurfMinZ) waterSurfMinZ = wNom;
      }
    };
    for (const r of rings) {
      const outer = r.outer || r;
      if (!outer || outer.length < 3) continue;
      let cx = 0, cy = 0;
      for (let k = 0; k < outer.length; k++) {
        const a = outer[k], b = outer[(k + 1) % outer.length];
        samplePt(a[0], a[1]); samplePt((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
        cx += a[0]; cy += a[1];
      }
      samplePt(cx / outer.length, cy / outer.length);
    }
    const rawDatumMinZ = Number.isFinite(dryMinZ)
      ? dryMinZ
      : (Number.isFinite(waterSurfMinZ) ? Math.max(ctx.zLandDatum, waterSurfMinZ) : ctx.zLandDatum);
    return {
      minZ: Number.isFinite(minZ) ? minZ : ctx.zLandDatum,
      datumMinZ: Math.max(ctx.zLandDatum, rawDatumMinZ),
      maxZ: Number.isFinite(maxZ) ? maxZ : ctx.zLandDatum,
      avgZ: cntZ > 0 ? (sumZ / cntZ) : ctx.zLandDatum,
      touchesWaterCutout,
    };
  }

  function widenNarrowSpirePolys(core, adjOuters, adjHoles, platePoly, reqPinDiaMm, scaleMm, joinType = 'Round') {
    const obb = root._computeOBB(adjOuters[0], null, 'along', 0);
    const minorMm = Math.min(obb.spanU, obb.spanV) * scaleMm;
    if (minorMm >= reqPinDiaMm) return adjOuters;
    const padU = ((reqPinDiaMm - minorMm) * 0.52) / scaleMm;
    try {
      const grown = core.clipperOffsetPolys(adjOuters, padU, joinType, 1e-5).map(r => core.ensureWinding(r, true, 5e-4)).filter(r => r.length >= 3);
      if (grown.length > 0 && adjHoles.length === 0) {
        const clipped = core.clipperIntersectPolys(grown, platePoly, 1e-5).map(r => core.ensureWinding(r, true, 5e-4)).filter(r => r.length >= 3);
        if (clipped.length > 0) return clipped;
      }
    } catch (_) {}
    return adjOuters;
  }

  /**
   * Builds a self-supporting >= 52 deg stepped gallery cornice and crisp parapet rim
   * around elevated horizontal observation decks belonging to lattice tower groups.
   * @param {object} core
   * @param {object} mf
   * @param {{ outer: number[][], holes: number[][] }} sr
   * @param {number} zBase
   * @param {number} zTop
   * @param {number} scaleMm
   * @returns {object|null} Manifold solid or null
   */
  function buildLatticeDeckGalleryCornice(core, mf, sr, zBase, zTop, scaleMm) {
    if (!sr || !sr.outer || sr.outer.length < 3) return null;
    const obb = root._computeOBB(sr.outer, null, 'along', 0);
    const minorU = Math.min(obb.spanU, obb.spanV);
    if (minorU * scaleMm < 2.2) return null;

    const outU = Math.min(0.42 / scaleMm, Math.max(0.26 / scaleMm, minorU * 0.055));
    const dropU = outU * 1.15;
    const zDeckTop = Math.max(zTop + 0.20 / scaleMm, zBase + 0.62 / scaleMm);
    const steps = [
      { off: outU * 0.34, z0: zBase - dropU, z1: zBase - dropU * 0.44 },
      { off: outU * 0.68, z0: zBase - dropU * 0.48, z1: zBase + 0.04 / scaleMm },
      { off: outU, z0: zBase - 0.02 / scaleMm, z1: zDeckTop },
    ];
    const tiers = [];
    for (const st of steps) {
      if (st.z1 <= st.z0 + 0.04 / scaleMm) continue;
      let grown = null;
      try {
        grown = core.clipperOffsetPolys([sr.outer], st.off, 'Miter', 1e-5)
          .map(r => core.ensureWinding(r, true, 5e-4))
          .filter(r => r.length >= 3);
      } catch (_) {
        grown = null;
      }
      if (!grown || grown.length === 0) continue;
      for (const r of grown) {
        const m = core.extrudeRingSolid(mf, r, sr.holes || [], st.z0, st.z1);
        if (m) tiers.push(m);
      }
    }
    return tiers.length > 0 ? core.batchUnionManifolds(mf, tiers) : null;
  }

  function buildSupportlessCorbel(core, mf, sr, zBase, zGroundSeat, ctx) {
    if (!ctx.supportlessMode || zBase <= zGroundSeat + (0.45 / ctx.scaleMm)) return null;
    const obb = root._computeOBB(sr.outer, null, 'along', 0);
    const halfMinU = Math.min(obb.spanU, obb.spanV) * 0.5;
    const maxUnsupU = (ctx.slaLaws ? ctx.slaLaws.maxUnsupportedOverhangMm(ctx.layerHeightMm) : 0.45) / ctx.scaleMm;
    if (halfMinU <= maxUnsupU) return null;
    const tanA = Math.tan(((ctx.slaLaws ? ctx.slaLaws.requiredSupportAngleDeg(true) : 40) * Math.PI) / 180.0);
    const maxDropU = Math.min(zBase - zGroundSeat + (0.12 / ctx.scaleMm), halfMinU * 0.92 * tanA);
    if (maxDropU <= 0.15 / ctx.scaleMm) return null;
    const nSteps = Math.max(4, Math.min(10, Math.ceil((maxDropU / tanA) / Math.max(1e-4, maxUnsupU * 0.8))));
    const tiers = [];
    let curOuters = [sr.outer];
    for (let s = 1; s <= nSteps && curOuters.length > 0; s++) {
      const zTop = zBase - ((s - 1) / nSteps) * maxDropU + (0.04 / ctx.scaleMm);
      const zBot = zBase - (s / nSteps) * maxDropU;
      curOuters = core.clipperOffsetPolys(curOuters, -(maxDropU / (nSteps * tanA)), 'Miter', 1e-5).map(r => core.ensureWinding(r, true, 5e-4)).filter(r => r.length >= 3);
      if (curOuters.length === 0) break;
      for (const r of curOuters) { const m = core.extrudeRingSolid(mf, r, [], zBot, zTop); if (m) tiers.push(m); }
    }
    return tiers.length > 0 ? core.batchUnionManifolds(mf, tiers) : null;
  }

  function buildS3DBPartSolid(core, b, tags, metaP, groupDatumById, platePoly, scene, ctx, terrainWater) {
    const { mf, toBed, scaleToBed, mToU, zScale, scaleMm, maxZUnits, slaLaws } = ctx;
    const outerBed = (metaP && metaP.outerBed) ? metaP.outerBed : b.outer.map(toBed);
    const holesBed = (b.holes && b.holes.length > 0) ? b.holes.filter(h => h && h.length >= 3).map(h => h.map(toBed)) : [];
    const strictlyInPlate = Boolean(metaP && metaP.strictlyInsidePlate);
    let cleanOuters;
    if (strictlyInPlate) {
      const w = core.ensureWinding(outerBed, true, 6e-4);
      cleanOuters = w.length >= 3 ? [w] : [];
    } else {
      cleanOuters = core.clipperIntersectPolys([outerBed], platePoly, 1e-5).map(r => core.ensureWinding(r, true, 6e-4)).filter(r => r.length >= 3);
    }
    if (cleanOuters.length === 0) return null;

    const isGroupedPart = metaP ? Boolean(metaP.isMultiGroup) : (b.groupId !== undefined && b.groupId !== null);
    let adjOuters = cleanOuters, adjHoles = holesBed.length > 0 ? holesBed.map(h => core.ensureWinding(h, true, 6e-4)).filter(h => h.length >= 3) : [];
    if (isGroupedPart || !strictlyInPlate) {
      try {
        const pad = isGroupedPart ? 4.5e-4 : 3.5e-4;
        const grown = core.clipperOffsetPolys(cleanOuters, pad, 'Miter', 1e-5);
        if (grown.length > 0) {
          const valid = (isGroupedPart ? grown : core.clipperOffsetPolys(grown, -pad, 'Miter', 1e-5)).map(r => core.ensureWinding(r, true, 6e-4)).filter(r => r.length >= 3);
          if (valid.length > 0) adjOuters = strictlyInPlate ? valid : core.clipperIntersectPolys(valid, platePoly, 1e-5);
        }
        if (isGroupedPart && adjHoles.length > 0) adjHoles = core.clipperOffsetPolys(adjHoles, -4.5e-4, 'Miter', 1e-5).map(r => core.ensureWinding(r, true, 6e-4)).filter(r => r.length >= 3);
      } catch (_) {}
    }
    if (adjOuters.length === 0) adjOuters = cleanOuters;

    const preNormShape = _normalizeRoofShape(tags['roof:shape'] || b.roof || 'flat');
    let roofShape = (metaP && metaP.flattened) ? 'flat' : preNormShape;
    const isLatticePart = ['lattice', 'guyed_lattice'].includes(String(b.towerConstruction || tags['tower:construction'] || '').toLowerCase());
    let rawH_m = Number((b.h !== undefined && b.h !== null) ? b.h : (b.height !== undefined ? b.height : 9.0));
    let rawMinH_m = Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0);
    const hMult = (b.heightMult || 1.0) * zScale * scaleToBed, mToMm = mToU * hMult * scaleMm;
    const spireObb = adjOuters.length > 0 ? root._computeOBB(adjOuters[0], null, 'along', 0) : null;
    const minorBedMm = spireObb ? Math.min(spireObb.spanU, spireObb.spanV) * scaleMm : 999;
    const fullObb = outerBed.length >= 3 ? root._computeOBB(outerBed, null, 'along', 0) : spireObb;
    const unclippedMinorM = fullObb ? (Math.min(fullObb.spanU, fullObb.spanV) / Math.max(1e-6, mToU * scaleToBed)) : 999;
    const isTrueNeedleSpire = minorBedMm <= 1.65 && unclippedMinorM <= 3.8 && !(metaP && metaP.areaM2 > 14.5);

    if (slaLaws && isTrueNeedleSpire && metaP && metaP.bodyTopM > 0 && rawH_m > metaP.bodyTopM + 1.5 && rawMinH_m <= metaP.bodyTopM + 2.0) {
      const bodyTopMm = metaP.bodyTopM * mToMm, rawDeltaMm = (rawH_m - metaP.bodyTopM) * mToMm;
      const cappedDeltaMm = slaLaws.capSpireProtrusionMm(rawDeltaMm, bodyTopMm);
      if (cappedDeltaMm > 0 && cappedDeltaMm < rawDeltaMm) {
        rawH_m = metaP.bodyTopM + (cappedDeltaMm / Math.max(1e-6, mToMm));
        if (rawMinH_m >= rawH_m - 0.5) rawMinH_m = Math.max(0, Math.min(rawMinH_m, metaP.bodyTopM));
      }
    }
    const isSpireOrPart = Boolean(b.part || b.fromBuildingRel || isLatticePart || (metaP && metaP.bodyTopM > 0) || ['cone', 'onion', 'pyramidal'].includes(roofShape));
    let wasWidened = false;
    if (slaLaws && isSpireOrPart && adjOuters.length > 0 && adjHoles.length === 0) {
      const isBracedFlush = Boolean(metaP && metaP.bracedTopM >= rawH_m - 1.5);
      const isArchitecturalShaft = Boolean(
        !isTrueNeedleSpire &&
        !['cone', 'onion', 'pyramidal'].includes(roofShape) &&
        (unclippedMinorM >= 4.2 || (metaP && metaP.areaM2 >= 18.0))
      );
      const protMm = Math.max(0.5, (metaP && metaP.bodyTopM > 0 ? Math.max(0.5, rawH_m - metaP.bodyTopM) : (rawH_m - rawMinH_m)) * mToMm);
      const reqDiaMm = isBracedFlush
        ? slaLaws.minWallThicknessMm(0)
        : (isArchitecturalShaft
            ? slaLaws.minWallThicknessMm(Math.min(18.0, protMm))
            : slaLaws.minPinDiameterMm(protMm));
      const joinType = isArchitecturalShaft ? 'Miter' : 'Round';
      const prevRef = adjOuters;
      adjOuters = widenNarrowSpirePolys(core, adjOuters, adjHoles, platePoly, reqDiaMm, scaleMm, joinType);
      if (adjOuters !== prevRef) wasWidened = true;
    }

    const structured = (adjHoles.length === 0 && adjOuters.length === 1 && strictlyInPlate && !wasWidened && !isGroupedPart)
      ? [{ outer: adjOuters[0], holes: [] }]
      : core.ringsToOutersWithHoles(adjHoles.length > 0 ? core.clipperDiffPolys(adjOuters, adjHoles, 1e-5) : adjOuters, 6e-4);
    if (structured.length === 0) return null;

    const terr = (metaP && metaP.terr && strictlyInPlate && !wasWidened && structured.length === 1)
      ? metaP.terr
      : sampleFootprintTerrainZ(structured, ctx, terrainWater);
    const embedU = terr.touchesWaterCutout ? 0.0 : Math.min(0.45 / scaleMm, Math.max(0.18 / scaleMm, (terr.maxZ - terr.minZ) * 0.25));
    const zGroundSeat = terr.touchesWaterCutout ? 0.0 : Math.max(0.15 / scaleMm, terr.minZ - embedU);
    const grpKey = (b.groupId !== undefined && b.groupId !== null) ? String(b.groupId) : null;
    const zDatum = (grpKey && groupDatumById.has(grpKey)) ? groupDatumById.get(grpKey) : terr.datumMinZ;

    const totalHU = Math.max(0.4 / scaleMm, Math.max(2.0, rawH_m) * mToU * hMult);
    const minHU = rawMinH_m > 0.2 ? (rawMinH_m * mToU * hMult) : 0;
    const zRawTop = zDatum + totalHU, zRawBase = zDatum + minHU;
    const compressZ = (ctx && typeof ctx.compressZUnits === 'function')
      ? ctx.compressZUnits
      : ((zU) => {
          const maxSafeMm = maxZUnits * scaleMm, zMm = zU * scaleMm;
          const zKneeMm = Math.min(maxSafeMm * 0.65, Math.max(maxSafeMm * 0.35, maxSafeMm - 35.0));
          if (zMm <= zKneeMm) return zU;
          const H = Math.max(1.0, maxSafeMm - zKneeMm), x = zMm - zKneeMm;
          return Math.min(maxZUnits, (zKneeMm + (x / (1.0 + x / H))) / scaleMm);
        });
    if (zRawTop > maxZUnits && ctx) ctx.zCapApplied = true;
    const zTop = Math.min(maxZUnits, compressZ(zRawTop));
    const zBase = minHU > 0 ? Math.max(zGroundSeat, compressZ(zRawBase) - (0.04 / scaleMm)) : zGroundSeat;
    if (zTop <= zBase + (0.15 / scaleMm)) return null;
    const effScaleRatio = totalHU > 1e-6 ? Math.max(0.05, (zTop - compressZ(zDatum)) / totalHU) : 1.0;

    let roofH_m = Number(b.roofH !== undefined ? b.roofH : (tags['roof:height'] || 0)) || 0;
    if (roofShape !== 'flat' && roofH_m <= 0) {
      const lvl = Number(tags['roof:levels'] || 0);
      roofH_m = lvl > 0 ? lvl * 3.0 : (['dome', 'onion', 'pyramidal', 'cone'].includes(roofShape) ? 5.5 : 3.4);
    }
    const hasExplicitRoofH = Boolean(b.hasExplicitRoofH || tags['roof:height'] !== undefined);
    const availHU = Math.max(0.2 / scaleMm, zTop - zBase);
    const rawRoofHU = roofShape !== 'flat' ? Math.max(0.20 / scaleMm, roofH_m * mToU * hMult) : 0;
    let roofHU = roofShape !== 'flat' ? Math.max(0.20 / scaleMm, zTop - compressZ(zRawTop - rawRoofHU)) : 0;
    if (!hasExplicitRoofH && roofHU > availHU * 0.72) roofHU = availHU * 0.65;
    const isZeroWallElevatedSkillion = hasExplicitRoofH && roofShape === 'skillion' && minHU > 0 && rawRoofHU >= availHU - (0.05 / scaleMm);
    roofHU = isZeroWallElevatedSkillion
      ? Math.min(roofHU, availHU)
      : Math.min(roofHU, Math.max(0, availHU - (0.15 / scaleMm)));
    if (roofHU * scaleMm < 0.12) { roofShape = 'flat'; roofHU = 0; }
    const zEaves = (roofShape !== 'flat' && roofHU > 0.12 / scaleMm) ? (zTop - roofHU) : zTop;

    const hasPreRot = b.roofDir !== undefined && b.roofDir !== null && scene && typeof scene._appliedRotationDeg === 'number';
    const rawDir = (b.roofDir !== undefined && b.roofDir !== null) ? b.roofDir : tags['roof:direction'];
    const roofDir = typeof root.parseRoofDirectionJS === 'function' ? root.parseRoofDirectionJS({ 'roof:direction': rawDir }) : (rawDir !== undefined ? Number(rawDir) : null);
    const roofOrient = String(b.roofOrient || tags['roof:orientation'] || 'along').toLowerCase();
    const effRotDeg = hasPreRot ? 0 : (ctx.rotDeg || 0);

    const partSolids = [];
    for (const sr of structured) {
      if (isLatticePart && roofShape === 'flat' && zTop - zBase > 0.45 / scaleMm) {
        const zSplit = zBase + (zTop - zBase) * 0.72;
        const wM = core.extrudeRingSolid(mf, sr.outer, sr.holes, zBase, zSplit); if (wM) partSolids.push(wM);
        const tM = _buildRoofManifold(core, mf, sr.outer, sr.holes, zSplit, zTop - zSplit, 'pyramidal', roofDir, roofOrient, effRotDeg); if (tM) partSolids.push(tM);
      } else {
        if (zEaves > zBase + 1e-4) {
          const wallM = core.extrudeRingSolid(mf, sr.outer, sr.holes, zBase, zEaves); if (wallM) partSolids.push(wallM);
        }
        if (roofShape !== 'flat' && zTop > zEaves + 1e-4) {
          const roofM = _buildRoofManifold(core, mf, sr.outer, sr.holes, zEaves, zTop - zEaves, roofShape, roofDir, roofOrient, effRotDeg); if (roofM) partSolids.push(roofM);
        }
      }
      if (minHU > 0) {
        const corbel = buildSupportlessCorbel(core, mf, sr, zBase, zGroundSeat, ctx);
        if (corbel) partSolids.push(corbel);
        if (metaP && metaP.inLatticeGroup && roofShape === 'flat' && rawMinH_m >= 15.0 && (rawH_m - rawMinH_m) >= 1.5 && (rawH_m - rawMinH_m) <= 12.0) {
          const cornice = buildLatticeDeckGalleryCornice(core, mf, sr, zBase, zTop, scaleMm);
          if (cornice) partSolids.push(cornice);
        }
      }
    }
    if (partSolids.length === 0) return null;
    const bSolid = partSolids.length === 1 ? partSolids[0] : core.batchUnionManifolds(mf, partSolids);
    if (!bSolid || bSolid.numTri() === 0) { core.safeDeleteManifold(bSolid); return null; }

    return {
      bSolid, structured, zGroundSeat, zDatum, zBase, zEaves, zTop,
      rawH_m, rawMinH_m, preNormShape, roofShape, effMinHU: minHU * effScaleRatio,
      flattenedUnderSuperstructure: Boolean(metaP && metaP.flattened),
    };
  }

  const exportsObj = {
    isLayer2ArchetypeRecord,
    _normalizeRoofShape,
    _buildRoofManifold,
    sampleFootprintTerrainZ,
    widenNarrowSpirePolys,
    buildSupportlessCorbel,
    buildS3DBPartSolid,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
