// Mesh and BMesh conversion (bmesh_mesh_convert.cc): entering and leaving Edit Mode.
import { BM_mesh_create, BM_ITER_MESH, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_ELEM_SMOOTH, BM_ELEM_SEAM } from './bmesh-class.js';
import { BM_data_layer_add_named } from './bmesh-interp.js';
import { CD_PROP_FLOAT, CD_PROP_FLOAT2 } from '../../makesdna/customdata-types.js';
import { BM_vert_create, BM_edge_create, BM_face_create, BM_CREATE_SKIP_CD } from './bmesh-core.js';
import { createMesh } from '../../blenkernel/mesh/mesh.js';
import { BM_face_normal_update } from './bmesh-polygon.js';

// Mesh attribute types of the corner layers BMesh keeps.
const LAYER_OF_ATTRIBUTE = { FLOAT: CD_PROP_FLOAT, FLOAT2: CD_PROP_FLOAT2 };
const ATTRIBUTE_OF_LAYER = { [CD_PROP_FLOAT]: 'FLOAT', [CD_PROP_FLOAT2]: 'FLOAT2' };

// Element flags kept as boolean attributes on the Mesh, as Blender names them.
const FLAG_ATTRIBUTES = [
  ['.select_vert', 'v', BM_ELEM_SELECT, 'POINT'], ['.hide_vert', 'v', BM_ELEM_HIDDEN, 'POINT'],
  ['.select_edge', 'e', BM_ELEM_SELECT, 'EDGE'], ['.hide_edge', 'e', BM_ELEM_HIDDEN, 'EDGE'], ['.uv_seam', 'e', BM_ELEM_SEAM, 'EDGE'],
  ['.select_poly', 'f', BM_ELEM_SELECT, 'FACE'], ['.hide_poly', 'f', BM_ELEM_HIDDEN, 'FACE'],
];
// Stored inverted: Blender keeps `sharp_*` attributes while BMesh flags smoothness.
const SHARP_ATTRIBUTES = [['sharp_edge', 'e', 'EDGE'], ['sharp_face', 'f', 'FACE']];

export function BM_mesh_bm_to_me(bm) {
  const index = { v: new Int32Array(bm.v.size), e: new Int32Array(bm.e.size), f: new Int32Array(bm.f.size) };
  for (const name of ['v', 'e', 'f']) {
    let i = 0;
    BM_ITER_MESH(bm[name], (elem) => { index[name][elem] = i; bm[name].index[elem] = i++; });
  }
  const vert_positions = new Float32Array(bm.totvert * 3);
  BM_ITER_MESH(bm.v, (v) => vert_positions.set(bm.v.co.subarray(v * 3, v * 3 + 3), index.v[v] * 3));
  const edges = new Int32Array(bm.totedge * 2);
  BM_ITER_MESH(bm.e, (e) => { edges[index.e[e] * 2] = index.v[bm.e.v1[e]]; edges[index.e[e] * 2 + 1] = index.v[bm.e.v2[e]]; });
  const face_offsets = new Int32Array(bm.totface + 1);
  const corner_verts = new Int32Array(bm.totloop), corner_edges = new Int32Array(bm.totloop);
  const loops = new Int32Array(bm.totloop);
  let c = 0;
  BM_ITER_MESH(bm.f, (f) => {
    face_offsets[index.f[f]] = c;
    const first = bm.f.l_first[f];
    let l = first;
    do {
      loops[c] = l;
      corner_verts[c] = index.v[bm.l.v[l]];
      corner_edges[c] = index.e[bm.l.e[l]];
      bm.l.index[l] = c++;
    } while ((l = bm.l.next[l]) !== first);
  });
  face_offsets[bm.totface] = c;

  const attributes = {};
  const domainOf = { v: bm.totvert, e: bm.totedge, f: bm.totface };
  const flagAttribute = (pool, test) => {
    const data = new Uint8Array(domainOf[pool]);
    let any = false;
    BM_ITER_MESH(bm[pool], (elem) => { if (test(bm[pool].hflag[elem])) data[index[pool][elem]] = any = 1; });
    return any ? data : null;
  };
  for (const [name, pool, flag, domain] of FLAG_ATTRIBUTES) {
    const data = flagAttribute(pool, (h) => h & flag);
    if (data) attributes[name] = { domain, type: 'BOOLEAN', data };
  }
  for (const [name, pool, domain] of SHARP_ATTRIBUTES) {
    const data = flagAttribute(pool, (h) => !(h & BM_ELEM_SMOOTH));
    if (data) attributes[name] = { domain, type: 'BOOLEAN', data };
  }
  const material_index = new Int32Array(bm.totface);
  let anyMaterial = false;
  BM_ITER_MESH(bm.f, (f) => { if ((material_index[index.f[f]] = bm.f.mat_nr[f])) anyMaterial = true; });
  if (anyMaterial) attributes.material_index = { domain: 'FACE', type: 'INT', data: material_index };
  for (const layer of bm.l.layers) {
    const data = new Float32Array(c * layer.size);
    for (let i = 0; i < c; i++) data.set(layer.data.subarray(loops[i] * layer.size, loops[i] * layer.size + layer.size), i * layer.size);
    attributes[layer.name] = { domain: 'CORNER', type: ATTRIBUTE_OF_LAYER[layer.type], data };
  }
  return createMesh({ vert_positions, edges, face_offsets, corner_verts, corner_edges, attributes });
}

// Normals as Edit Mode loads them (calc_face_normal and calc_vert_normal).
export function BM_mesh_bm_from_me(mesh, { calc_face_normal = true, calc_vert_normal = true } = {}) {
  const bm = BM_mesh_create({ totvert: mesh.verts_num, totedge: mesh.edges_num, totloop: mesh.corners_num, totface: mesh.faces_num });
  const attr = (name) => mesh.attributes.get(name)?.data;
  for (const [name, { domain, type }] of mesh.attributes) if (domain === 'CORNER' && LAYER_OF_ATTRIBUTE[type]) BM_data_layer_add_named(bm, bm.ldata, LAYER_OF_ATTRIBUTE[type], name);
  const verts = [];
  for (let v = 0; v < mesh.verts_num; v++) verts.push(BM_vert_create(bm, mesh.vert_positions.subarray(v * 3, v * 3 + 3)));
  const edges = [];
  for (let e = 0; e < mesh.edges_num; e++) edges.push(BM_edge_create(bm, verts[mesh.edges[e * 2]], verts[mesh.edges[e * 2 + 1]], -1, BM_CREATE_SKIP_CD));
  for (let f = 0; f < mesh.faces_num; f++) {
    const start = mesh.face_offsets[f], end = mesh.face_offsets[f + 1];
    const face = BM_face_create(bm, Array.from(mesh.corner_verts.subarray(start, end), (v) => verts[v]), Array.from(mesh.corner_edges.subarray(start, end), (e) => edges[e]), end - start, -1, BM_CREATE_SKIP_CD);
    bm.f.mat_nr[face] = attr('material_index')?.[f] ?? 0;
    let l = bm.f.l_first[face], c = start;
    do {
      for (const layer of bm.l.layers) layer.data.set(attr(layer.name).subarray(c * layer.size, c * layer.size + layer.size), l * layer.size);
      c++;
    } while ((l = bm.l.next[l]) !== bm.f.l_first[face]);
  }
  const pools = { v: verts, e: edges, f: [] };
  BM_ITER_MESH(bm.f, (f) => pools.f.push(f));
  for (const [pool, list] of Object.entries(pools)) list.forEach((elem, i) => { bm[pool].index[elem] = i; });
  for (const [name, pool, flag] of FLAG_ATTRIBUTES) {
    const data = attr(name);
    if (data) pools[pool].forEach((elem, i) => { if (data[i]) bm[pool].hflag[elem] |= flag; });
  }
  for (const [name, pool] of SHARP_ATTRIBUTES) {
    const data = attr(name);
    pools[pool].forEach((elem, i) => { if (data?.[i]) bm[pool].hflag[elem] &= ~BM_ELEM_SMOOTH; else bm[pool].hflag[elem] |= BM_ELEM_SMOOTH; });
  }
  if (calc_face_normal) BM_ITER_MESH(bm.f, (f) => BM_face_normal_update(bm, f));
  if (calc_vert_normal) {
    const normals = mesh.vert_normals();
    pools.v.forEach((v, i) => bm.v.no.set(normals.subarray(i * 3, i * 3 + 3), v * 3));
  }
  return bm;
}
