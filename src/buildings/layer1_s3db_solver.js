// ============================================================================
// src/buildings/layer1_s3db_solver.js
// Layer 1 S3DB Solid Extraction, Soft-Knee Z Compression & Cluster Emission
// ============================================================================

(function (root) {
  if (typeof root._computeOBB !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./roof_directional_revolve.js'));
  }
  if (typeof root.buildSkeletonOrPolyRoof !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./roof_skeleton_poly.js'));
  }
  if (typeof root.buildS3DBPartSolid !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./s3db_part_solid_builder.js'));
  }
  if (typeof root.anchorAndMergeS3DBClusters !== 'function' && typeof require === 'function') {
    Object.assign(root, require('./s3db_skybridge_anchoring.js'));
  }

  function _getCore() {
    if (typeof root.createBuildContext === 'function') {
      return {
        ensureWinding: root.ensureWinding, clipperIntersectPolys: root.clipperIntersectPolys,
        clipperDiffPolys: root.clipperDiffPolys, clipperOffsetPolys: root.clipperOffsetPolys,
        clipperUnionPolys: root.clipperUnionPolys,
        ringsToOutersWithHoles: root.ringsToOutersWithHoles, batchUnionManifolds: root.batchUnionManifolds,
        extrudeRingSolid: root.extrudeRingSolid, manifoldFromRawSoup: root.manifoldFromRawSoup,
        safeDeleteManifold: root.safeDeleteManifold, getVendorDeps: root.getVendorDeps,
      };
    }
    return require('../geometry/manifold_core.js');
  }

  function* _buildLayer1S3DBBuildingsGen(ctx, scene, terrainWater) {
    const core = _getCore();
    const { mf, halfW, halfH, toBed, mToU, scaleMm, maxZUnits } = ctx;
    const buildingsList = (scene && scene.buildings) || [];
    const bldOsmIds = new Set();
    for (let i = 0; i < buildingsList.length; i++) {
      const b = buildingsList[i];
      if (b && b.osmId !== undefined && b.osmId !== null) bldOsmIds.add(b.osmId);
    }
    const rawTagById = new Map();
    if (bldOsmIds.size > 0) {
      for (const el of ((scene && scene.osmElements) || [])) {
        if (el && el.tags && bldOsmIds.has(el.id)) rawTagById.set(el.id, el.tags);
      }
    }
    const padClip = 0.25;
    const platePoly = [[[-halfW - padClip, -halfH - padClip], [halfW + padClip, -halfH - padClip], [halfW + padClip, halfH + padClip], [-halfW - padClip, halfH + padClip]]];
    const normalGroups = new Map(), highlightGroups = new Map(), boundsOut = [];
    const consumedArchBuildingIds = new Set(), consumedArchGroups = new Set();

    const elevatedBridgeRings = [];
    for (const bp of ((scene && scene.bridgePolys) || [])) {
      if (!bp || bp.isPier || (bp.layer ?? 1) < 1 || !bp.outer || bp.outer.length < 3) continue;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const p of bp.outer) {
        if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0];
        if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1];
      }
      elevatedBridgeRings.push({ outer: bp.outer, bx0, by0, bx1, by1 });
    }
    const _ptInBrRing = (px, py, ring) => {
      let ins = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) ins = !ins;
      }
      return ins;
    };

    const clipLimX = halfW + padClip, clipLimY = halfH + padClip;
    const _prepMeta = new Array(buildingsList.length);
    const latticeGroupIds = new Set();
    for (let idx = 0; idx < buildingsList.length; idx++) {
      if ((idx & 255) === 0 && idx > 0) yield;
      const b = buildingsList[idx];
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) { _prepMeta[idx] = null; continue; }
      const tags = Object.assign({}, rawTagById.get(b.osmId) || {}, b.tags || {});
      const tc = String(tags['tower:construction'] || b.towerConstruction || '').toLowerCase().trim();
      if ((tc === 'lattice' || tc === 'guyed_lattice') && b.groupId !== undefined && b.groupId !== null) {
        latticeGroupIds.add(String(b.groupId));
      }
      if (root.isLayer2ArchetypeRecord(b, tags)) { _prepMeta[idx] = null; continue; }
      const outerBed = b.outer.map(toBed);
      let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
      for (let k = 0; k < outerBed.length; k++) {
        const px = outerBed[k][0], py = outerBed[k][1];
        if (px < bMinX) bMinX = px; if (px > bMaxX) bMaxX = px;
        if (py < bMinY) bMinY = py; if (py > bMaxY) bMaxY = py;
      }
      if (bMaxX <= -clipLimX || bMinX >= clipLimX || bMaxY <= -clipLimY || bMinY >= clipLimY) { _prepMeta[idx] = null; continue; }
      let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of b.outer) {
        cx += pt[0]; cy += pt[1];
        if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1];
      }
      const cxMean = cx / b.outer.length, cyMean = cy / b.outer.length;
      let rawHVal = Number((b.h !== undefined && b.h !== null) ? b.h : (b.height !== undefined ? b.height : 9.0));
      if (elevatedBridgeRings.length > 0 && !tags.height && !tags['building:height'] && !tags['building:levels'] && !tags.name && (parseFloat(tags.layer) || 0) <= 0) {
        for (let bi = 0; bi < elevatedBridgeRings.length; bi++) {
          const br = elevatedBridgeRings[bi];
          if (cxMean >= br.bx0 && cxMean <= br.bx1 && cyMean >= br.by0 && cyMean <= br.by1 && _ptInBrRing(cxMean, cyMean, br.outer)) {
            rawHVal = Math.min(rawHVal, 3.4);
            break;
          }
        }
      }
      const terr = root.sampleFootprintTerrainZ([outerBed], ctx, terrainWater);
      _prepMeta[idx] = {
        idx, b, tags, terr, outerBed,
        strictlyInsidePlate: bMinX >= -clipLimX + 1e-3 && bMaxX <= clipLimX - 1e-3 && bMinY >= -clipLimY + 1e-3 && bMaxY <= clipLimY - 1e-3,
        isMultiGroup: false,
        areaM2: Math.abs(root._ringAreaSigned(b.outer)) / Math.max(1e-8, mToU * mToU),
        cx: cxMean, cy: cyMean, minX, maxX, minY, maxY, bodyTopM: 0, bracedTopM: 0,
        rawH: rawHVal,
        rawMinH: Math.max(0, Number(b.minH !== undefined ? b.minH : (tags.min_height || 0)) || 0),
        normRoof: root._normalizeRoofShape(tags['roof:shape'] || b.roof || 'flat'),
        skip: false, skipReason: null, flattened: false,
      };
    }
    yield;

    const groupGroundedMinEle = new Map(), groupFallbackMinEle = new Map();
    for (const m of _prepMeta) {
      if (!m || m.b.groupId === undefined || m.b.groupId === null) continue;
      const gKey = String(m.b.groupId), dZ = m.terr.datumMinZ !== undefined ? m.terr.datumMinZ : m.terr.minZ;
      const tgt = m.rawMinH <= 0.05 ? groupGroundedMinEle : groupFallbackMinEle, prev = tgt.get(gKey);
      if (prev === undefined || dZ < prev) tgt.set(gKey, dZ);
    }
    const groupDatumById = new Map(groupFallbackMinEle);
    for (const [k, v] of groupGroundedMinEle) groupDatumById.set(k, v);

    const spireRoofSet = new Set(['dome', 'onion', 'cone', 'pyramidal']);
    const META_CELL = 4.0, metaGrid = new Map(), metaByGroup = new Map();
    for (let idx = 0; idx < _prepMeta.length; idx++) {
      const pm = _prepMeta[idx];
      if (!pm) continue;
      if (pm.b.groupId !== undefined && pm.b.groupId !== null) {
        const gk = String(pm.b.groupId);
        if (latticeGroupIds.has(gk)) pm.inLatticeGroup = true;
        let gArr = metaByGroup.get(gk);
        if (!gArr) { gArr = []; metaByGroup.set(gk, gArr); }
        gArr.push(idx);
      }
      for (let gx = Math.floor(pm.minX / META_CELL), gx1 = Math.floor(pm.maxX / META_CELL); gx <= gx1; gx++) {
        for (let gy = Math.floor(pm.minY / META_CELL), gy1 = Math.floor(pm.maxY / META_CELL); gy <= gy1; gy++) {
          const ck = `${gx}:${gy}`;
          let cArr = metaGrid.get(ck);
          if (!cArr) { cArr = []; metaGrid.set(ck, cArr); }
          cArr.push(idx);
        }
      }
    }
    for (const gArr of metaByGroup.values()) {
      if (gArr.length > 1) for (let k = 0; k < gArr.length; k++) _prepMeta[gArr[k]].isMultiGroup = true;
    }

    // Prune low/mid-rise buildings sliced into razor slivers along the exact outer frame
    // border, plus any tiny (< 1.0 mm) sidewalk annex fins directly attached to them.
    if (typeof root.isOuterBorderSlicedSliver === 'function') {
      const prunedBorderBoxes = [];
      for (let i = 0; i < _prepMeta.length; i++) {
        const pm = _prepMeta[i];
        if (!pm || pm.skip) continue;
        if (root.isOuterBorderSlicedSliver(core, pm.outerBed, pm.rawH, halfW, halfH, scaleMm)) {
          pm.skip = true;
          pm.skipReason = 'outer_border_sliver';
          let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
          for (let k = 0; k < pm.outerBed.length; k++) {
            const px = pm.outerBed[k][0], py = pm.outerBed[k][1];
            if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
            if (py < by0) by0 = py; if (py > by1) by1 = py;
          }
          prunedBorderBoxes.push({ bx0, bx1, by0, by1 });
        }
      }
      if (prunedBorderBoxes.length > 0) {
        const edgeBandU = 3.5 / scaleMm;
        const touchTolU = 0.25 / scaleMm;
        for (let i = 0; i < _prepMeta.length; i++) {
          const pm = _prepMeta[i];
          if (!pm || pm.skip || pm.rawH >= 20.0) continue;
          let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
          for (let k = 0; k < pm.outerBed.length; k++) {
            const px = pm.outerBed[k][0], py = pm.outerBed[k][1];
            if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
            if (py < by0) by0 = py; if (py > by1) by1 = py;
          }
          const nearOuterEdge =
            bx0 < -halfW + edgeBandU || bx1 > halfW - edgeBandU ||
            by0 < -halfH + edgeBandU || by1 > halfH - edgeBandU;
          if (!nearOuterEdge) continue;
          const obb = root._computeOBB(pm.outerBed, null, 'along', 0);
          if (Math.min(obb.spanU, obb.spanV) * scaleMm >= 1.0) continue;
          for (let pi = 0; pi < prunedBorderBoxes.length; pi++) {
            const pb = prunedBorderBoxes[pi];
            if (
              bx0 <= pb.bx1 + touchTolU && bx1 >= pb.bx0 - touchTolU &&
              by0 <= pb.by1 + touchTolU && by1 >= pb.by0 - touchTolU
            ) {
              pm.skip = true;
              pm.skipReason = 'outer_border_sliver_annex';
              break;
            }
          }
        }
      }
    }

    const seenStamp = new Int32Array(_prepMeta.length);
    let stampToken = 0;
    for (let i = 0; i < _prepMeta.length; i++) {
      if ((i & 511) === 0 && i > 0) yield;
      const m = _prepMeta[i];
      if (!m) continue;
      const tok = ++stampToken, candIdx = [];
      if (m.b.groupId !== undefined && m.b.groupId !== null) {
        const gArr = metaByGroup.get(String(m.b.groupId));
        if (gArr) for (let k = 0; k < gArr.length; k++) {
          const j = gArr[k];
          if (j !== i && seenStamp[j] !== tok) { seenStamp[j] = tok; candIdx.push(j); }
        }
      }
      for (let gx = Math.floor(m.minX / META_CELL), gx1 = Math.floor(m.maxX / META_CELL); gx <= gx1; gx++) {
        for (let gy = Math.floor(m.minY / META_CELL), gy1 = Math.floor(m.maxY / META_CELL); gy <= gy1; gy++) {
          const cArr = metaGrid.get(`${gx}:${gy}`);
          if (!cArr) continue;
          for (let k = 0; k < cArr.length; k++) {
            const j = cArr[k];
            if (j !== i && seenStamp[j] !== tok) { seenStamp[j] = tok; candIdx.push(j); }
          }
        }
      }
      if (candIdx.length > 1) candIdx.sort((a, b) => a - b);
      for (let ci = 0; ci < candIdx.length; ci++) {
        const o = _prepMeta[candIdx[ci]];
        if (!o || o.skip) continue;
        const sameGroup = m.b.groupId !== undefined && m.b.groupId !== null && m.b.groupId === o.b.groupId;
        const overlapsBox = !(m.maxX < o.minX || m.minX > o.maxX || m.maxY < o.minY || m.minY > o.maxY);
        const insideOther = overlapsBox && root._ptInSolid(m.cx, m.cy, o.b.outer, o.b.holes);
        if (o.areaM2 > m.areaM2 * 1.25 && o.rawH >= 6.0 && (sameGroup || insideOther)) {
          if (o.rawH > m.bracedTopM) m.bracedTopM = o.rawH;
          if (m.rawH > o.rawH + 1.5 && o.rawH > m.bodyTopM) m.bodyTopM = o.rawH;
        }
        if (!overlapsBox) continue;
        if ((m.b.part || m.tags['building:part']) && o.normRoof === 'flat' && o.areaM2 > m.areaM2 * 1.15 && insideOther &&
            m.rawMinH >= o.rawMinH - 0.5 && m.rawH <= o.rawH + 0.5 &&
            m.b.outer.every(pt => root._ptInSolid(pt[0], pt[1], o.b.outer, o.b.holes))) {
          m.skip = true;
          m.skipReason = 'cluster_swallowed_interior';
          break;
        }
        if (spireRoofSet.has(m.normRoof) && (sameGroup || insideOther || root._ptInSolid(o.cx, o.cy, m.b.outer, m.b.holes)) &&
            o.normRoof === 'flat' && o.rawMinH >= m.rawH - 2.0 && o.rawMinH <= m.rawH + 1.5 && (o.areaM2 / Math.max(1e-6, m.areaM2)) > 0.60) {
          m.flattened = true;
        }
      }
    }
    yield;

    const maxSafeZMm = maxZUnits * scaleMm;
    let maxRawZMm = 0;
    for (const m of _prepMeta) {
      if (!m || m.skip) continue;
      const gKey = (m.b.groupId !== undefined && m.b.groupId !== null) ? String(m.b.groupId) : null;
      const tDat = m.terr.datumMinZ !== undefined ? m.terr.datumMinZ : m.terr.minZ;
      const zDat = (gKey && groupDatumById.has(gKey)) ? groupDatumById.get(gKey) : tDat;
      const hMult = (m.b.heightMult || 1.0) * ctx.zScale * ctx.scaleToBed, mToMm = mToU * hMult * scaleMm;
      let effH = Math.max(2.0, m.rawH);
      if (ctx.slaLaws && m.bodyTopM > 0 && effH > m.bodyTopM + 1.5 && m.rawMinH <= m.bodyTopM + 2.0) {
        const obb = root._computeOBB(m.b.outer.map(toBed), null, 'along', 0);
        if (Math.min(obb.spanU, obb.spanV) * scaleMm <= 2.4) {
          const capD = ctx.slaLaws.capSpireProtrusionMm((effH - m.bodyTopM) * mToMm, m.bodyTopM * mToMm);
          if (capD > 0) effH = Math.min(effH, m.bodyTopM + capD / Math.max(1e-6, mToMm));
        }
      }
      const zRawMm = (zDat + Math.max(0.4 / scaleMm, effH * mToU * hMult)) * scaleMm;
      if (zRawMm > maxRawZMm) maxRawZMm = zRawMm;
    }
    if (maxRawZMm > maxSafeZMm) {
      ctx.zCapApplied = true;
      const zKneeMm = Math.min(maxSafeZMm * 0.65, Math.max(maxSafeZMm * 0.35, maxSafeZMm - 35.0));
      const H = Math.max(1.0, maxSafeZMm - zKneeMm), Xmax = Math.max(H + 1e-3, maxRawZMm - zKneeMm);
      const cCoeff = (Xmax - H) / (H * Xmax);
      ctx.compressZUnits = (zU) => {
        const zMm = zU * scaleMm;
        if (zMm <= zKneeMm) return zU;
        const x = zMm - zKneeMm;
        return Math.min(maxZUnits, (zKneeMm + (x / (1.0 + cCoeff * x))) / scaleMm);
      };
    } else {
      ctx.compressZUnits = (zU) => zU;
    }

    for (let i = 0; i < buildingsList.length; i++) {
      if ((i & 127) === 0 && i > 0) yield;
      const b = buildingsList[i];
      if (!b || b.hidden || b.isOutline || !b.outer || b.outer.length < 3) continue;
      const tags = Object.assign({}, rawTagById.get(b.osmId) || {}, b.tags || {});
      if (ctx.waterCutout && (b.isVessel || /^(boat|houseboat|ship|barge|floating_home)$/.test(String(tags.building || b.btype || '').toLowerCase()))) {
        continue;
      }
      if (root.isLayer2ArchetypeRecord(b, tags)) {
        if (b.id !== undefined) consumedArchBuildingIds.add(b.id);
        if (b.groupId != null) consumedArchGroups.add(String(b.groupId));
        continue;
      }
      const metaP = _prepMeta[i];
      if (!metaP) continue;
      if (metaP.skip) {
        ctx.audit.preparedList.push({ id: b.id ?? (i + 1), osmId: b.osmId || null, groupId: b.groupId ?? null, name: b.name || '', btype: b.btype || 'yes', isPart: Boolean(b.part || tags['building:part']), part: Boolean(b.part), skip: true, skipReason: metaP.skipReason, preRoofShape: metaP.normRoof, roofShape: metaP.normRoof, roof: metaP.normRoof, h: metaP.rawH, minH: metaP.rawMinH, zBase: metaP.rawMinH, zTop: metaP.rawH, area: metaP.areaM2 });
        continue;
      }
      const built = root.buildS3DBPartSolid(core, b, tags, metaP, groupDatumById, platePoly, scene, ctx, terrainWater);
      if (!built) continue;
      const bId = b.id !== undefined ? b.id : (i + 1), isHi = Boolean(b.highlighted);
      const grpKey = (b.groupId !== undefined && b.groupId !== null) ? `${isHi ? 'hg' : 'ng'}:${b.groupId}` : `${isHi ? 'hb' : 'nb'}:${bId}`;
      const bb = built.bSolid.boundingBox(), targetMap = isHi ? highlightGroups : normalGroups;
      if (!targetMap.has(grpKey)) targetMap.set(grpKey, { groupKey: grpKey, isHi, records: [], hasGrounded: false, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
      const grp = targetMap.get(grpKey);
      const rec = {
        b, bId, osmId: b.osmId || null, groupId: b.groupId ?? null, name: b.name || '', btype: b.btype || 'yes', isHi,
        structured: built.structured, zGroundSeat: built.zGroundSeat, zDatum: built.zDatum, zBase: built.zBase, zEaves: built.zEaves, zTop: built.zTop,
        rawH_m: built.rawH_m, rawMinH_m: built.rawMinH_m, preRoofShape: built.preNormShape, roofShape: built.roofShape, flattenedUnderSuperstructure: built.flattenedUnderSuperstructure,
        area: metaP ? metaP.areaM2 : 0, isPart: Boolean(b.part || tags['building:part']), part: Boolean(b.part),
        isElevated: built.effMinHU > 0 && built.zBase > built.zGroundSeat + (0.45 / scaleMm), solid: built.bSolid, bb,
      };
      grp.records.push(rec);
      if (!rec.isElevated) grp.hasGrounded = true;
      grp.minX = Math.min(grp.minX, bb.min[0]); grp.maxX = Math.max(grp.maxX, bb.max[0]);
      grp.minY = Math.min(grp.minY, bb.min[1]); grp.maxY = Math.max(grp.maxY, bb.max[1]);
      grp.minZ = Math.min(grp.minZ, bb.min[2]); grp.maxZ = Math.max(grp.maxZ, bb.max[2]);
    }
    yield;

    const allClusters = [...normalGroups.values(), ...highlightGroups.values()];
    root.anchorAndMergeS3DBClusters(core, mf, ctx, allClusters, consumedArchGroups, platePoly);
    yield;

    function* emitClusterGroupGen(isHiFlag) {
      const out = [];
      for (let ci = 0; ci < allClusters.length; ci++) {
        if ((ci & 255) === 0 && ci > 0) yield;
        const c = allClusters[ci];
        if (c.mergedOut || c.isHi !== isHiFlag || c.records.length === 0) continue;
        const bestNamed = c.records.find(r => r.name && !/^(Building|Part|Budynek|Część)\s+#/i.test(r.name));
        const primary = bestNamed || c.records.find(r => !r.isElevated) || c.records[0];
        const maxH = Math.max(...c.records.map(r => r.rawH_m || 0));
        const pickId = ctx.allocPickId({
          id: primary.bId, buildingId: primary.bId, groupId: primary.groupId, osmId: primary.osmId,
          name: primary.name, maxH, btype: primary.btype, roof: primary.roofShape, heightM: primary.rawH_m,
          highlighted: isHiFlag, primaryBuilding: primary.b, buildings: c.records.map(r => r.b),
        });
        for (const r of c.records) if (r.b) r.b._pickId = pickId;
        const merged = c.records.length === 1 ? c.records[0].solid : core.batchUnionManifolds(mf, c.records.map(r => r.solid));
        if (!merged || merged.numTri() === 0) { core.safeDeleteManifold(merged); continue; }
        const mbb = c.records.length === 1 ? c.records[0].bb : merged.boundingBox();
        const isSingleGroundedSolid = c.records.length === 1 && !c.records[0].isElevated &&
          c.records[0].roofShape === 'flat' && c.records[0].structured.length === 1;
        out.push({ buildingId: pickId, sourceBuildingId: primary.bId, groupId: primary.groupId ?? null, manifold: merged, bb: mbb, isSingleGroundedSolid, isFloatingPart: false });
        for (const r of c.records) {
          const rCx = (r.bb.min[0] + r.bb.max[0]) * 0.5, rCy = (r.bb.min[1] + r.bb.max[1]) * 0.5;
          boundsOut.push({
            id: r.bId, pickId, building: r.b, layerId: isHiFlag ? 5 : 4, osmId: r.osmId, name: r.name,
            minX: r.bb.min[0], minY: r.bb.min[1], minZ: mbb.min[2], maxX: r.bb.max[0], maxY: r.bb.max[1], maxZ: r.bb.max[2],
            cx: rCx, cy: rCy, interiorPt: [rCx, rCy], roof: r.roofShape, minH: r.rawMinH_m, h: r.rawH_m,
          });
          const auditEntry = { id: r.bId, osmId: r.osmId, groupId: r.groupId, pickId, name: r.name, btype: r.btype, tZ: r.zDatum, preRoofShape: r.preRoofShape, roofShape: r.roofShape, roof: r.roofShape, flattenedUnderSuperstructure: r.flattenedUnderSuperstructure, skip: false, h: r.rawH_m, minH: r.rawMinH_m, zBase: r.zBase, zEaves: r.zEaves, zRidge: r.zTop, zTop: r.zTop, area: r.area, isPart: r.isPart, part: r.part, highlighted: isHiFlag };
          ctx.audit.preparedList.push(auditEntry); ctx.audit.s3dbAllFinalBuildings.push(auditEntry);
        }
      }
      return out;
    }

    const buildingManifolds = yield* emitClusterGroupGen(false);
    const highlightedManifolds = yield* emitClusterGroupGen(true);
    return { buildingManifolds, highlightedManifolds, buildingBounds: boundsOut, consumedArchBuildingIds, count: buildingManifolds.length + highlightedManifolds.length };
  }

  function buildLayer1S3DBBuildings(ctx, scene, terrainWater) {
    const gen = _buildLayer1S3DBBuildingsGen(ctx, scene, terrainWater);
    let step;
    do { step = gen.next(); } while (!step.done);
    return step.value;
  }

  async function buildLayer1S3DBBuildingsAsync(ctx, scene, terrainWater, yieldCtrl = null) {
    const gen = _buildLayer1S3DBBuildingsGen(ctx, scene, terrainWater);
    let step;
    while (true) {
      step = gen.next();
      if (step.done) return step.value;
      if (yieldCtrl) await yieldCtrl.yieldIfNeeded(step.value === 'force');
    }
  }

  const exportsObj = { buildLayer1S3DBBuildings, buildLayer1S3DBBuildingsAsync };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
