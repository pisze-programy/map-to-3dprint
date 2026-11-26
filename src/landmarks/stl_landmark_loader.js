// ============================================================================
// src/landmarks/stl_landmark_loader.js
// Pure Node + VM Binary .STL Parser, Watertight Manifold Builder & Manifest Loader
// ============================================================================

(function (root) {
  /**
   * Resolves Node builtin fs and path modules when running in Node; returns null in VM/browser.
   * @returns {{ fs: object, path: object }|null}
   */
  function _getNodeFsPath() {
    try {
      let req = typeof require === 'function' ? require : null;
      if (!req && typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function') {
        const mod = process.getBuiltinModule('module');
        if (mod && typeof mod.createRequire === 'function') {
          req = mod.createRequire(process.cwd() + '/src/landmarks/stl_landmark_loader.js');
        }
      }
      if (!req) return null;
      return { fs: req('fs'), path: req('path') };
    } catch (_) {
      return null;
    }
  }

  /**
   * Normalizes binary STL input into a DataView covering its exact byte range.
   * @param {ArrayBuffer|ArrayBufferView} stlBytes
   * @returns {{ byteLength: number, view: DataView }}
   */
  function _toDataView(stlBytes) {
    if (!stlBytes) {
      throw new Error('loadBinaryStlToManifold requires binary STL bytes');
    }
    if (stlBytes instanceof ArrayBuffer) {
      if (stlBytes.byteLength < 84) {
        throw new Error('Binary STL buffer is smaller than 84-byte header');
      }
      return { byteLength: stlBytes.byteLength, view: new DataView(stlBytes) };
    }
    if (ArrayBuffer.isView(stlBytes)) {
      if (stlBytes.byteLength < 84) {
        throw new Error('Binary STL buffer is smaller than 84-byte header');
      }
      return {
        byteLength: stlBytes.byteLength,
        view: new DataView(stlBytes.buffer, stlBytes.byteOffset, stlBytes.byteLength),
      };
    }
    throw new Error('loadBinaryStlToManifold expects Uint8Array, Buffer, or ArrayBuffer');
  }

  /**
   * Parses an 84-byte-header binary STL buffer into deduplicated float32 positions and uint32 indices.
   * @param {ArrayBuffer|ArrayBufferView} stlBytes
   * @returns {{ positions: Float32Array, indices: Uint32Array, rawTriCount: number }}
   */
  function _parseBinaryStlSoup(stlBytes) {
    const { byteLength, view } = _toDataView(stlBytes);
    const rawTriCount = view.getUint32(80, true);
    if (!Number.isFinite(rawTriCount) || rawTriCount === 0) {
      throw new Error('Binary STL contains zero triangles');
    }
    const expectedBytes = 84 + rawTriCount * 50;
    if (expectedBytes > byteLength) {
      throw new Error(`Binary STL truncated: expected ${expectedBytes} bytes for ${rawTriCount} triangles, got ${byteLength}`);
    }

    const vertMap = new Map();
    const pos = [];
    const idx = [];
    let offset = 84;

    for (let i = 0; i < rawTriCount; i++) {
      const triIdx = [0, 0, 0];
      for (let v = 0; v < 3; v++) {
        const vOff = offset + 12 + v * 12;
        const x = view.getFloat32(vOff, true);
        const y = view.getFloat32(vOff + 4, true);
        const z = view.getFloat32(vOff + 8, true);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          throw new Error(`Binary STL contains non-finite vertex at triangle ${i}`);
        }
        const key = `${x},${y},${z}`;
        let vi = vertMap.get(key);
        if (vi === undefined) {
          vi = pos.length / 3;
          vertMap.set(key, vi);
          pos.push(x, y, z);
        }
        triIdx[v] = vi;
      }
      offset += 50;
      if (triIdx[0] === triIdx[1] || triIdx[1] === triIdx[2] || triIdx[2] === triIdx[0]) {
        continue;
      }
      idx.push(triIdx[0], triIdx[1], triIdx[2]);
    }

    if (idx.length < 12) {
      throw new Error('Binary STL contains too few valid non-degenerate triangles to form a closed solid');
    }

    return {
      positions: new Float32Array(pos),
      indices: new Uint32Array(idx),
      rawTriCount,
    };
  }

  /**
   * Flips triangle winding in an index buffer to correct inside-out meshes.
   * @param {Uint32Array} indices
   * @returns {Uint32Array}
   */
  function _flipTriWinding(indices) {
    const out = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i += 3) {
      out[i] = indices[i];
      out[i + 1] = indices[i + 2];
      out[i + 2] = indices[i + 1];
    }
    return out;
  }

  /**
   * Attempts to construct a valid watertight Manifold from indexed soup at a merge tolerance.
   * @param {object} mf
   * @param {Float32Array} positions
   * @param {Uint32Array} indices
   * @param {number} tolerance
   * @returns {object|null}
   */
  function _tryBuildManifold(mf, positions, indices, tolerance) {
    try {
      const mesh = new mf.Mesh({
        numProp: 3,
        vertProperties: positions,
        triVerts: indices,
        tolerance,
      });
      if (typeof mesh.merge === 'function') {
        mesh.merge();
      }
      const man = new mf.Manifold(mesh);
      const st = typeof man.status === 'function' ? man.status() : 0;
      const isOk = st === 'NoError' || st === 0;
      if (!isOk || man.numTri() === 0) {
        if (typeof man.delete === 'function') man.delete();
        return null;
      }
      return man;
    } catch (_) {
      return null;
    }
  }

  /**
   * Welds vertices within tolerance and enforces a positive-volume watertight 2-manifold.
   * @param {object} mf
   * @param {Float32Array} positions
   * @param {Uint32Array} indices
   * @param {number} weldTol
   * @returns {object}
   */
  function _buildWatertightManifoldFromSoup(mf, positions, indices, weldTol) {
    const tolerances = [weldTol];
    for (const fallbackTol of [1e-4, 5e-4, 1e-3]) {
      if (fallbackTol > weldTol) tolerances.push(fallbackTol);
    }

    let man = null;
    let usedTol = weldTol;
    for (let i = 0; i < tolerances.length; i++) {
      man = _tryBuildManifold(mf, positions, indices, tolerances[i]);
      if (man) {
        usedTol = tolerances[i];
        break;
      }
    }
    if (!man) {
      throw new Error('STL mesh could not be repaired into a watertight 2-manifold');
    }

    if (typeof man.volume === 'function' && man.volume() < 0) {
      const flipped = _tryBuildManifold(mf, positions, _flipTriWinding(indices), usedTol);
      if (flipped && typeof flipped.volume === 'function' && flipped.volume() > 0) {
        man.delete();
        man = flipped;
      } else if (flipped) {
        flipped.delete();
      }
    }

    return man;
  }

  /**
   * Clips a bed-space Manifold cleanly against plate XY and Z bounds when needed.
   * @param {object} mf
   * @param {object} man
   * @param {object} options
   * @param {object|null} ctx
   * @returns {object|null}
   */
  function _clipManifoldToPlate(mf, man, options, ctx) {
    if (!man || options.clipToPlate === false) return man;
    const rawHalfW = options.halfW !== undefined ? Number(options.halfW) : (ctx ? Number(ctx.halfW) : NaN);
    const rawHalfH = options.halfH !== undefined ? Number(options.halfH) : (ctx ? Number(ctx.halfH) : NaN);
    const hasXY = Number.isFinite(rawHalfW) && rawHalfW > 0 && Number.isFinite(rawHalfH) && rawHalfH > 0;
    const rawMaxZ = options.maxZUnits !== undefined ? Number(options.maxZUnits) : (ctx ? Number(ctx.maxZUnits) : NaN);
    const hasMaxZ = Number.isFinite(rawMaxZ) && rawMaxZ > 0;
    if (!hasXY && !hasMaxZ) return man;

    const bb = man.boundingBox();
    const minX = hasXY ? -rawHalfW : bb.min[0] - 1.0;
    const maxX = hasXY ? rawHalfW : bb.max[0] + 1.0;
    const minY = hasXY ? -rawHalfH : bb.min[1] - 1.0;
    const maxY = hasXY ? rawHalfH : bb.max[1] + 1.0;
    const minZ = Number.isFinite(Number(options.minZ)) ? Number(options.minZ) : 0.0;
    const maxZ = hasMaxZ ? rawMaxZ : bb.max[2] + 1.0;

    const needsClip = (
      (hasXY && (bb.min[0] < minX || bb.max[0] > maxX || bb.min[1] < minY || bb.max[1] > maxY)) ||
      bb.min[2] < minZ ||
      (hasMaxZ && bb.max[2] > maxZ)
    );
    if (!needsClip) return man;

    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    if (!(dx > 0 && dy > 0 && dz > 0)) {
      man.delete();
      return null;
    }

    const rawBox = mf.Manifold.cube([dx, dy, dz], false);
    const clipBox = rawBox.translate([minX, minY, minZ]);
    rawBox.delete();
    try {
      const clipped = man.intersect(clipBox);
      man.delete();
      clipBox.delete();
      if (!clipped || clipped.numTri() === 0) {
        if (clipped && typeof clipped.delete === 'function') clipped.delete();
        return null;
      }
      return clipped;
    } catch (err) {
      clipBox.delete();
      throw err;
    }
  }

  /**
   * Parses binary STL bytes into a watertight, geo-transformed, plate-clipped Manifold solid.
   * @param {object} mf
   * @param {ArrayBuffer|ArrayBufferView} stlBytes
   * @param {object} [options={}]
   * @returns {object|null}
   */
  function loadBinaryStlToManifold(mf, stlBytes, options = {}) {
    if (!mf || !mf.Manifold || !mf.Mesh) {
      throw new Error('loadBinaryStlToManifold requires an initialized Manifold module');
    }
    const opts = options || {};
    const soup = _parseBinaryStlSoup(stlBytes);
    const weldTol = Number.isFinite(Number(opts.weldTol)) && Number(opts.weldTol) > 0 ? Number(opts.weldTol) : 1e-5;
    let man = _buildWatertightManifoldFromSoup(mf, soup.positions, soup.indices, weldTol);

    const transform = opts.transform || opts.anchor || opts;
    const ctx = opts.ctx || null;
    const uPerM = Number.isFinite(Number(transform.uPerM)) ? Number(transform.uPerM) : 1.0;
    const zPerM = Number.isFinite(Number(transform.zPerM)) ? Number(transform.zPerM) : uPerM;
    const scaleM = Number.isFinite(Number(opts.scaleM)) && Number(opts.scaleM) > 0 ? Number(opts.scaleM) : 1.0;
    const hasZOverride = opts.zScaleOverride !== undefined && opts.zScaleOverride !== null && Number.isFinite(Number(opts.zScaleOverride));
    const effXYPerM = uPerM * scaleM;
    const effZPerM = (hasZOverride ? uPerM * Number(opts.zScaleOverride) : zPerM) * scaleM;

    if (effXYPerM !== 1.0 || effZPerM !== 1.0) {
      const scaled = man.scale([effXYPerM, effXYPerM, effZPerM]);
      man.delete();
      man = scaled;
    }

    const baseHeadingDeg = Number.isFinite(Number(transform.headingBedDeg))
      ? Number(transform.headingBedDeg)
      : ((Number(opts.headingDeg !== undefined ? opts.headingDeg : transform.headingDeg) || 0) + ((ctx && Number(ctx.rotDeg)) || 0));
    if (Math.abs(baseHeadingDeg) > 1e-9) {
      const rotated = man.rotate([0, 0, baseHeadingDeg]);
      man.delete();
      man = rotated;
    }

    const cxBed = Number(opts.cxBed !== undefined ? opts.cxBed : (transform.cxBed !== undefined ? transform.cxBed : 0)) || 0;
    const cyBed = Number(opts.cyBed !== undefined ? opts.cyBed : (transform.cyBed !== undefined ? transform.cyBed : 0)) || 0;
    let zGround = 0.0;
    if (opts.zGround !== undefined && Number.isFinite(Number(opts.zGround))) {
      zGround = Number(opts.zGround);
    } else if (transform.zGround !== undefined && Number.isFinite(Number(transform.zGround))) {
      zGround = Number(transform.zGround);
    } else if (transform.zDatumU !== undefined && Number.isFinite(Number(transform.zDatumU))) {
      zGround = Number(transform.zDatumU);
    } else if (ctx && Number.isFinite(Number(ctx.zLandDatum))) {
      zGround = Number(ctx.zLandDatum);
    }
    const zOffsetM = Number(opts.zOffsetM !== undefined ? opts.zOffsetM : (transform.zOffsetM !== undefined ? transform.zOffsetM : 0)) || 0;
    const zOffsetU = opts.zOffsetU !== undefined && Number.isFinite(Number(opts.zOffsetU))
      ? Number(opts.zOffsetU)
      : zOffsetM * effZPerM;
    const zAnchor = zGround + zOffsetU;

    if (Math.abs(cxBed) > 1e-9 || Math.abs(cyBed) > 1e-9 || Math.abs(zAnchor) > 1e-9) {
      const translated = man.translate([cxBed, cyBed, zAnchor]);
      man.delete();
      man = translated;
    }

    return _clipManifoldToPlate(mf, man, opts, ctx);
  }

  /**
   * Resolves the registerHeroLandmark function from global scope or landmark_registry.js.
   * @returns {Function|null}
   */
  function _resolveRegisterHeroLandmark() {
    if (typeof root.registerHeroLandmark === 'function') return root.registerHeroLandmark;
    if (typeof require === 'function') {
      try {
        const reg = require('./landmark_registry.js');
        if (reg && typeof reg.registerHeroLandmark === 'function') return reg.registerHeroLandmark;
      } catch (_) {}
    }
    return null;
  }

  /**
   * Reads a declarative JSON landmark manifest and registers each STL landmark in the registry.
   * Safe no-op returning [] in VM/browser or when the manifest file is absent.
   * @param {string} [manifestPath]
   * @returns {object[]}
   */
  function registerStlLandmarksFromManifest(manifestPath) {
    const nodeMods = _getNodeFsPath();
    if (!nodeMods) return [];
    const { fs, path } = nodeMods;

    const defaultManifest = typeof __dirname === 'string'
      ? path.join(__dirname, 'assets', 'landmarks.json')
      : path.resolve(process.cwd(), 'src/landmarks/assets/landmarks.json');
    const resolvedManifest = manifestPath ? path.resolve(String(manifestPath)) : defaultManifest;
    if (!fs.existsSync(resolvedManifest)) return [];

    const registerFn = _resolveRegisterHeroLandmark();
    if (typeof registerFn !== 'function') {
      throw new Error('registerStlLandmarksFromManifest requires registerHeroLandmark');
    }

    const rawJson = fs.readFileSync(resolvedManifest, 'utf8');
    const parsed = JSON.parse(rawJson);
    const entries = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.landmarks) ? parsed.landmarks : (parsed && parsed.id ? [parsed] : []));

    const manifestDir = path.dirname(resolvedManifest);
    const registered = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || entry.enabled === false) continue;
      if (!entry.id || !entry.stlFile) {
        throw new Error(`Manifest entry ${i} in ${resolvedManifest} requires id and stlFile`);
      }
      const stlPath = path.isAbsolute(entry.stlFile)
        ? entry.stlFile
        : path.resolve(manifestDir, entry.stlFile);
      if (!fs.existsSync(stlPath)) {
        throw new Error(`STL landmark asset not found for ${entry.id}: ${stlPath}`);
      }

      let cachedBytes = null;
      const spec = registerFn({
        id: String(entry.id),
        name: entry.name ? String(entry.name) : String(entry.id),
        lat: Number(entry.lat),
        lon: Number(entry.lon),
        headingDeg: Number(entry.headingDeg) || 0,
        footprintRadiusM: Number(entry.footprintRadiusM) || 80,
        maxHeightM: Number(entry.maxHeightM) || 0,
        replaceOsmIds: Array.isArray(entry.replaceOsmIds) ? entry.replaceOsmIds : [],
        replacePolygonM: Array.isArray(entry.replacePolygonM) ? entry.replacePolygonM : null,
        buildManifold(_core, mf, ctx, anchor) {
          if (!cachedBytes) {
            cachedBytes = new Uint8Array(fs.readFileSync(stlPath));
          }
          return loadBinaryStlToManifold(mf, cachedBytes, {
            transform: anchor,
            ctx,
            scaleM: entry.scaleM,
            zScaleOverride: entry.zScaleOverride,
            zOffsetM: entry.zOffsetM,
          });
        },
      });
      registered.push(spec);
    }

    return registered;
  }

  const exportsObj = {
    loadBinaryStlToManifold,
    registerStlLandmarksFromManifest,
  };
  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
