// ============================================================================
// src/video/video_math_mesh.js
// Easing Curves & Coplanar-Edge-Suppressing Barycentric Mesh Packer for clean
// CAD Architectural Wireframes in the Browser Video Preview Module.
// ============================================================================

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function smoothRange(t, a, b) {
  if (b <= a) return t >= b ? 1 : 0;
  return clamp01((t - a) / (b - a));
}

function easeInOutCubic(x) {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutQuint(x) {
  const t = clamp01(x);
  return 1 - Math.pow(1 - t, 5);
}

function easeInOutQuint(x) {
  const t = clamp01(x);
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function easeOutBack(x, overshoot = 1.35) {
  const t = clamp01(x);
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}

function applyVideoEasing(x, mode) {
  if (mode === 'quint') return easeInOutQuint(x);
  if (mode === 'spring') return clamp01(easeOutBack(x, 1.15));
  if (mode === 'linear') return clamp01(x);
  return easeInOutCubic(x);
}

// ----------------------------------------------------------------------------
// Coplanar-Edge-Suppressing Barycentric Mesh Packer (13 floats / 52B per vert)
// Layout: aPos(3), aNorm(3), aBary(3), aMeta(4: layerId, groundZ, subId, rank)
// Shared interior edges between coplanar triangles of the same layer receive
// barycentric distance 1.0 so CAD wireframe renders clean architectural edges.
// ----------------------------------------------------------------------------
function packMeshForVideoGL(tris, defaultGroundZ = 0.22) {
  const n = tris ? tris.length : 0;
  const out = new Float32Array(n * 3 * 13);
  if (n === 0) return out;

  const qKey = (p) => `${Math.round(p[0] * 40)},${Math.round(p[1] * 40)},${Math.round(p[2] * 40)}`;
  const edgeKey = (a, b) => {
    const ka = qKey(a), kb = qKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  const firstSeen = new Map();
  const internalCoplanar = new Set();
  for (let i = 0; i < n; i++) {
    const t = tris[i];
    const verts = [t.v0, t.v1, t.v2];
    const pairs = [[verts[1], verts[2]], [verts[2], verts[0]], [verts[0], verts[1]]];
    for (let e = 0; e < 3; e++) {
      const ek = edgeKey(pairs[e][0], pairs[e][1]);
      const prev = firstSeen.get(ek);
      if (prev !== undefined) {
        const tp = tris[prev];
        const dotN = t.n[0] * tp.n[0] + t.n[1] * tp.n[1] + t.n[2] * tp.n[2];
        if (dotN > 0.985 && t.layerId === tp.layerId) {
          internalCoplanar.add(ek);
        }
      } else {
        firstSeen.set(ek, i);
      }
    }
  }

  let ptr = 0;
  for (let i = 0; i < n; i++) {
    const t = tris[i];
    const pts = [t.v0, t.v1, t.v2];
    const e0Internal = internalCoplanar.has(edgeKey(pts[1], pts[2]));
    const e1Internal = internalCoplanar.has(edgeKey(pts[2], pts[0]));
    const e2Internal = internalCoplanar.has(edgeKey(pts[0], pts[1]));

    const lid = t.layerId !== undefined ? t.layerId : 4;
    const subId = t.subId !== undefined ? t.subId : (t.tileId !== undefined ? t.tileId : 0);
    const gZ = t.groundZ !== undefined ? t.groundZ : defaultGroundZ;
    const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3.0;
    const cy = (pts[0][1] + pts[1][1] + pts[2][1]) / 3.0;
    const rank = clamp01(Math.hypot(cx, cy) / 120.0);

    for (let v = 0; v < 3; v++) {
      out[ptr++] = pts[v][0];
      out[ptr++] = pts[v][1];
      out[ptr++] = pts[v][2];

      out[ptr++] = t.n[0];
      out[ptr++] = t.n[1];
      out[ptr++] = t.n[2];

      out[ptr++] = e0Internal ? 1.0 : (v === 0 ? 1.0 : 0.0);
      out[ptr++] = e1Internal ? 1.0 : (v === 1 ? 1.0 : 0.0);
      out[ptr++] = e2Internal ? 1.0 : (v === 2 ? 1.0 : 0.0);

      out[ptr++] = lid;
      out[ptr++] = gZ;
      out[ptr++] = subId;
      out[ptr++] = rank;
    }
  }
  return out;
}
