// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Modifiers that change the vertex list (specs/mask_mirror.md, specs/subsurf.md), as stencils: each output vertex is
// a weighted sum of input vertices, a term optionally mirrored. Stencils and the new geometry (faces, edges, vertex
// groups) are built once from the rest topology; per frame only applyStencil runs (the GPU form too).
//
// Geometry: { base (Float64Array positions), count, faces: [[i...]], edges: [[a, b]], groups: Map(name -> weights) }.

// Edges of a mesh built from faces: per face the closing edge first, then around the face, skipping known edges.
export function edgesFromFaces(faces, count) {
  const seen = new Set(), edges = [];
  const add = (a, b) => { const k = a < b ? a * count + b : b * count + a; if (!seen.has(k)) { seen.add(k); edges.push([a, b]); } };
  for (const f of faces) {
    add(f[f.length - 1], f[0]);
    for (let i = 0; i + 1 < f.length; i++) add(f[i], f[i + 1]);
  }
  return edges;
}

export function geometryOf(ob, base) {
  const count = base.length / 3, faces = ob.data.faces ?? [];
  const edges = ob.data.edges?.length ? ob.data.edges : edgesFromFaces(faces, count);
  const groups = new Map((ob.data.vertex_groups ?? []).map((g) => [g.name, Float64Array.from({ length: count }, (_, i) => g.weights[i] ?? 0)]));
  return { base, count, faces, edges, groups };
}

// A stencil: rows of (source, weight, flip bits) in CSR arrays; flip bit a mirrors axis a in the mirror frame.
function stencil(rows) {
  const start = new Int32Array(rows.length + 1), src = [], weight = [], flip = [];
  rows.forEach((terms, i) => {
    start[i] = src.length;
    for (const [s, w, f = 0] of terms) { src.push(s); weight.push(w); flip.push(f); }
  });
  start[rows.length] = src.length;
  return { start, src: Int32Array.from(src), weight: Float64Array.from(weight), flip: Uint8Array.from(flip), count: rows.length };
}

// Applies a stencil to positions; `frame` (a 4x4, column-major) is the mirror frame F (object space to mirror space).
export function applyStencil(st, positions, frame = null) {
  const out = new Float64Array(st.count * 3);
  const Finv = frame && invert3x4(frame);
  for (let i = 0; i < st.count; i++) {
    let x = 0, y = 0, z = 0;
    for (let k = st.start[i]; k < st.start[i + 1]; k++) {
      const s = st.src[k] * 3, w = st.weight[k], f = st.flip[k];
      let px = positions[s], py = positions[s + 1], pz = positions[s + 2];
      if (f) {
        if (frame) [px, py, pz] = affine(frame, px, py, pz);
        if (f & 1) px = -px;
        if (f & 2) py = -py;
        if (f & 4) pz = -pz;
        if (frame) [px, py, pz] = affine(Finv, px, py, pz);
      }
      x += w * px; y += w * py; z += w * pz;
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}

const affine = (M, x, y, z) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
function invert3x4(m) {
  const a = m, c0 = a[5] * a[10] - a[6] * a[9], c1 = a[6] * a[8] - a[4] * a[10], c2 = a[4] * a[9] - a[5] * a[8];
  const d = 1 / (a[0] * c0 + a[1] * c1 + a[2] * c2);
  const r = [c0 * d, (a[2] * a[9] - a[1] * a[10]) * d, (a[1] * a[6] - a[2] * a[5]) * d, 0, c1 * d, (a[0] * a[10] - a[2] * a[8]) * d, (a[2] * a[4] - a[0] * a[6]) * d, 0,
    c2 * d, (a[1] * a[8] - a[0] * a[9]) * d, (a[0] * a[5] - a[1] * a[4]) * d, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * a[12] + r[4] * a[13] + r[8] * a[14]);
  r[13] = -(r[1] * a[12] + r[5] * a[13] + r[9] * a[14]);
  r[14] = -(r[2] * a[12] + r[6] * a[13] + r[10] * a[14]);
  return r;
}

// --- Mask (Vertex Group mode) ---

export function bindMask(program, ob, m, geo) {
  if (m.mode && m.mode !== 'VERTEX_GROUP') return { unsupported: `Mask mode ${m.mode}` };
  if (m.use_smooth) return { unsupported: 'Mask smooth' };
  const w = geo.groups.get(m.vertex_group);
  const keep = Array.from({ length: geo.count }, (_, i) => ((w?.[i] ?? 0) > (m.threshold ?? 0)) !== !!m.invert_vertex_group);
  const map = new Int32Array(geo.count).fill(-1);
  const rows = [];
  keep.forEach((k, i) => { if (k) { map[i] = rows.length; rows.push([[i, 1]]); } });
  const faces = geo.faces.filter((f) => f.every((v) => keep[v])).map((f) => f.map((v) => map[v]));
  const edges = geo.edges.filter(([a, b]) => keep[a] && keep[b]).map(([a, b]) => [map[a], map[b]]);
  const groups = new Map([...geo.groups].map(([n, g]) => [n, Float64Array.from(g.filter((_, i) => keep[i]))]));
  return { stencil: stencil(rows), geo: { count: rows.length, faces, edges, groups } };
}

// --- Mirror ---

const SIDE = /([._])([LRlr])$/;
const opposite = (name) => name.replace(SIDE, (_, sep, s) => sep + { L: 'R', R: 'L', l: 'r', r: 'l' }[s]);

export function bindMirror(program, ob, m, geo, objectIndex) {
  const { base } = geo;
  const axes = (m.use_axis ?? [true, false, false]).map(Boolean);
  const bisect = (m.use_bisect_axis ?? [false, false, false]).map(Boolean), bisectFlip = (m.use_bisect_flip_axis ?? [false, false, false]).map(Boolean);
  const mirrorObject = m.mirror_object ? program.objectIndex.get(m.mirror_object) : undefined;
  const merge = m.use_mirror_merge !== false, threshold = m.merge_threshold ?? 0.001, groupsMirror = m.use_mirror_vertex_groups !== false;
  // Rest positions in the mirror frame decide merging and bisecting (static, from the rest pose).
  const F = mirrorObject === undefined ? null : program.restFrame(objectIndex, mirrorObject);
  let rows = Array.from({ length: geo.count }, (_, i) => [[i, 1, 0]]);
  let pos = Array.from({ length: geo.count }, (_, i) => framed(F, base, i));
  let { faces, edges } = geo;
  let groups = new Map([...geo.groups].map(([n, g]) => [n, Array.from(g)]));
  axes.forEach((on, a) => {
    if (!on) return;
    const bit = 1 << a;
    if (bisect[a]) {
      const keep = pos.map((p) => (bisectFlip[a] ? p[a] <= threshold : p[a] >= -threshold));
      const map = []; let n = 0;
      keep.forEach((k, i) => { map[i] = k ? n++ : -1; });
      rows = rows.filter((_, i) => keep[i]); pos = pos.filter((_, i) => keep[i]);
      faces = faces.filter((f) => f.every((v) => keep[v])).map((f) => f.map((v) => map[v]));
      edges = edges.filter(([x, y]) => keep[x] && keep[y]).map(([x, y]) => [map[x], map[y]]);
      for (const [name, g] of groups) groups.set(name, g.filter((_, i) => keep[i]));
    }
    const n = rows.length, copy = new Int32Array(n), merged = new Uint8Array(n);
    const newRows = rows.map((r) => r.slice()), newPos = pos.map((p) => p.slice());
    for (let i = 0; i < n; i++) {
      if (merge && Math.abs(2 * pos[i][a]) <= threshold) {
        merged[i] = 1; copy[i] = i;
        newRows[i] = [...rows[i].map(([s, w, f]) => [s, w / 2, f]), ...rows[i].map(([s, w, f]) => [s, w / 2, f ^ bit])];
        newPos[i][a] = 0;
      }
    }
    for (let i = 0; i < n; i++) {
      if (merged[i]) continue;
      copy[i] = newRows.length;
      newRows.push(rows[i].map(([s, w, f]) => [s, w, f ^ bit]));
      const p = pos[i].slice(); p[a] = -p[a]; newPos.push(p);
    }
    const mirroredFaces = faces.map((f) => [copy[f[0]], ...f.slice(1).reverse().map((v) => copy[v])]);
    const mirroredEdges = edges.filter(([x, y]) => !(merged[x] && merged[y])).map(([x, y]) => [copy[x], copy[y]]);
    const nextGroups = new Map();
    const names = new Set([...groups.keys()]);
    for (const name of names) {
      const g = groups.get(name), from = groupsMirror && names.has(opposite(name)) && opposite(name) !== name ? groups.get(opposite(name)) : g;
      const out = g.slice();
      for (let i = 0; i < n; i++) if (merged[i]) out[i] = (g[i] + from[i]) / 2;
      for (let i = 0; i < n; i++) if (!merged[i]) out.push(from[i]);
      nextGroups.set(name, out);
    }
    rows = newRows; pos = newPos; faces = [...faces, ...mirroredFaces]; edges = [...edges, ...mirroredEdges]; groups = nextGroups;
  });
  return {
    stencil: stencil(rows), mirrorObject,
    geo: { count: rows.length, faces, edges, groups: new Map([...groups].map(([k, g]) => [k, Float64Array.from(g)])) },
  };
}

function framed(F, base, i) {
  const p = [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
  return F ? affine(F, ...p) : p;
}

// --- Subdivision Surface ---

export function bindSubsurf(program, ob, m, geo) {
  const levels = m.levels ?? 1, simple = m.subdivision_type === 'SIMPLE', limit = m.use_limit_surface !== false && !simple;
  if (levels <= 0) return null; // level 0: no subdivision (no limit surface either)
  const corners = m.boundary_smooth === 'PRESERVE_CORNERS';
  let rows = Array.from({ length: geo.count }, (_, i) => new Map([[i, 1]]));
  let { faces, edges, count } = geo;
  let groups = geo.groups;
  for (let level = 0; level < levels; level++) {
    const step = subdivideOnce(count, faces, edges, simple, corners);
    rows = step.rows.map((r) => compose(r, rows));
    groups = new Map([...groups].map(([n, g]) => [n, Float64Array.from(step.rows, (r) => { let s = 0; for (const [j, w] of r) s += w * g[j]; return s; })]));
    ({ faces, edges, count } = step);
  }
  if (limit) {
    const lim = limitRows(count, faces, edges, corners, levels);
    rows = lim.map((r) => compose(r, rows));
  }
  return { stencil: stencil(rows.map((r) => [...r])), geo: { count, faces, edges, groups } };
}

// Row r (over the previous level's vertices) times the previous rows (over the step's input).
function compose(r, prev) {
  const out = new Map();
  for (const [j, w] of r) for (const [s, v] of prev[j]) out.set(s, (out.get(s) ?? 0) + w * v);
  return out;
}

function adjacency(count, faces, edges) {
  const key = (a, b) => (a < b ? a * count + b : b * count + a);
  const edgeIndex = new Map(edges.map(([a, b], i) => [key(a, b), i]));
  const edgeFaces = edges.map(() => []);
  faces.forEach((f, fi) => f.forEach((v, i) => edgeFaces[edgeIndex.get(key(v, f[(i + 1) % f.length]))].push(fi)));
  const vertexEdges = Array.from({ length: count }, () => []), vertexFaces = Array.from({ length: count }, () => []);
  edges.forEach(([a, b], i) => { vertexEdges[a].push(i); vertexEdges[b].push(i); });
  faces.forEach((f, fi) => f.forEach((v) => vertexFaces[v].push(fi)));
  return { key, edgeIndex, edgeFaces, vertexEdges, vertexFaces };
}

function subdivideOnce(count, faces, edges, simple, corners) {
  const { key, edgeIndex, edgeFaces, vertexEdges, vertexFaces } = adjacency(count, faces, edges);
  const facePoint = faces.map((f) => new Map(f.map((v) => [v, 1 / f.length])));
  const add = (m, src, w) => { for (const [j, v] of src) m.set(j, (m.get(j) ?? 0) + w * v); };
  const edgePoint = edges.map(([a, b], i) => {
    const m = new Map([[a, 0.5], [b, 0.5]]);
    if (simple || edgeFaces[i].length !== 2) return m;
    const out = new Map([[a, 0.25], [b, 0.25]]);
    for (const fi of edgeFaces[i]) add(out, facePoint[fi], 0.25);
    return out;
  });
  const boundaryEdge = (i) => edgeFaces[i].length < 2;
  const vertexPoint = Array.from({ length: count }, (_, v) => {
    if (simple) return new Map([[v, 1]]);
    const bEdges = vertexEdges[v].filter(boundaryEdge);
    if (bEdges.length >= 2) {
      if (corners && vertexFaces[v].length === 1) return new Map([[v, 1]]);
      const out = new Map([[v, 0.75]]);
      for (const e of bEdges.slice(0, 2)) { const [a, b] = edges[e]; add(out, new Map([[a === v ? b : a, 1]]), 0.125); }
      return out;
    }
    const k = vertexEdges[v].length, out = new Map([[v, (k - 3) / k]]);
    for (const fi of vertexFaces[v]) add(out, facePoint[fi], 1 / vertexFaces[v].length / k);
    for (const e of vertexEdges[v]) { const [a, b] = edges[e]; add(out, new Map([[a, 0.5], [b, 0.5]]), 2 / vertexEdges[v].length / k); }
    return out;
  });
  const rows = [...vertexPoint, ...edgePoint, ...facePoint];
  const E = (a, b) => count + edgeIndex.get(key(a, b)), Fp = (fi) => count + edges.length + fi;
  const newFaces = [];
  faces.forEach((f, fi) => f.forEach((v, i) => newFaces.push([v, E(v, f[(i + 1) % f.length]), Fp(fi), E(f[(i + f.length - 1) % f.length], v)])));
  const n = rows.length;
  return { rows, faces: newFaces, edges: edgesFromFaces(newFaces, n), count: n };
}

// Limit positions after the last level (all quads).
function limitRows(count, faces, edges, corners, levels) {
  const { edgeFaces, vertexEdges, vertexFaces } = adjacency(count, faces, edges);
  const boundaryEdge = (i) => edgeFaces[i].length < 2;
  return Array.from({ length: count }, (_, v) => {
    const bEdges = vertexEdges[v].filter(boundaryEdge);
    const other = (e) => (edges[e][0] === v ? edges[e][1] : edges[e][0]);
    if (bEdges.length >= 2) {
      const [b1, b2] = bEdges.slice(0, 2).map(other);
      if (vertexFaces[v].length === 1) {
        if (corners) return new Map([[v, 1]]);
        const a = levels >= 2 ? 3 / 4 : 11 / 16;
        return new Map([[v, a], [b1, (1 - a) / 2], [b2, (1 - a) / 2]]);
      }
      return new Map([[v, 4 / 6], [b1, 1 / 6], [b2, 1 / 6]]);
    }
    const k = vertexEdges[v].length, d = k * (k + 5), out = new Map([[v, (k * k) / d]]);
    const nb = new Set(vertexEdges[v].map(other));
    for (const u of nb) out.set(u, (out.get(u) ?? 0) + 4 / d);
    for (const fi of vertexFaces[v]) {
      const f = faces[fi], i = f.indexOf(v), diag = f[(i + 2) % f.length];
      out.set(diag, (out.get(diag) ?? 0) + 1 / d);
    }
    return out;
  });
}
