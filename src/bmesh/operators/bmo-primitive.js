// Primitive operators (bmo_primitive.cc). Run through BMO_op_callf; `matrix` is a 4x4 of columns.
import { BM_ITER_MESH, BMO_flag_test, BMO_flag_enable } from '../intern/bmesh-class.js';
import { CustomData_get_offset } from '../../blenkernel/customdata.js';
import { CD_PROP_FLOAT2 } from '../../makesdna/customdata-types.js';
import { BM_vert_create, BM_edge_create, BM_vert_kill, BM_face_create_verts, BM_CREATE_NOP } from '../intern/bmesh-core.js';
import { BM_face_create_quad_tri } from '../intern/bmesh-construct.js';
import { BM_edge_collapse } from '../intern/bmesh-mods.js';
import { BM_face_normal_update } from '../intern/bmesh-polygon.js';
import { BMO_op_callf } from '../intern/bmesh-operators.js';
import { bmo_dissolve_faces_exec } from './bmo-dissolve.js';
import { sin_cos_from_fraction } from '../../blenlib/math-rotation.js';
import { mul_m4_v3, mul_mat3_m4_v3, invert_m4_m4, unit_m4 } from '../../blenlib/math-matrix.js';

const VERT_MARK = 1, FACE_MARK = 1 << 1, FACE_NEW = 1 << 2;
const f32 = Math.fround;

// The loop UV layer when UVs are wanted and the mesh has one (CustomData_get_offset(CD_PROP_FLOAT2) != -1).
const uvLayer = (bm, calc_uvs) => (calc_uvs ? bm.ldata.layers[CustomData_get_offset(bm.ldata, CD_PROP_FLOAT2)] ?? null : null);
const loopsOf = (bm, f, fn) => { const first = bm.f.l_first[f]; let l = first, i = 0; do fn(l, i++); while ((l = bm.l.next[l]) !== first); };
const markedFaces = (bm, flag, fn) => BM_ITER_MESH(bm.f, (f) => BMO_flag_test(bm.f, f, flag) && fn(f));
const setUV = (uv, l, u, v) => { uv.data[l * 2] = u; uv.data[l * 2 + 1] = v; };

export function bmo_create_grid_exec(bm, { x_segments, y_segments, size, matrix = unit_m4(), calc_uvs = false }) {
  const xtot = Math.max(1, x_segments), ytot = Math.max(1, y_segments);
  const xtot_inv2 = f32(2 / xtot), ytot_inv2 = f32(2 / ytot);
  const uv = uvLayer(bm, calc_uvs);
  const varr = [];
  for (let y = 0; y <= ytot; y++) {
    const vy = f32(f32(f32(y * ytot_inv2) - 1) * size);
    for (let x = 0; x <= xtot; x++) {
      const vx = f32(f32(f32(x * xtot_inv2) - 1) * size);
      varr.push(BM_vert_create(bm, mul_m4_v3(matrix, [vx, vy, 0])));
    }
  }
  const XY = (x, y) => x + y * (xtot + 1);
  for (let y = 1; y <= ytot; y++) {
    for (let x = 1; x <= xtot; x++) {
      const f = BM_face_create_verts(bm, [varr[XY(x - 1, y - 1)], varr[XY(x, y - 1)], varr[XY(x, y)], varr[XY(x - 1, y)]], 4, -1, BM_CREATE_NOP, true);
      if (uv) BMO_flag_enable(bm.f, f, FACE_MARK);
    }
  }
  if (uv) BM_mesh_calc_uvs_grid(bm, xtot, ytot, FACE_MARK, uv);
  return varr;
}

export function BM_mesh_calc_uvs_grid(bm, x_segments, y_segments, oflag, uv) {
  const dx = f32(1 / x_segments), dy = f32(1 / y_segments);
  let face_index = 0;
  markedFaces(bm, oflag, (f) => {
    const ix = face_index % x_segments, iy = Math.trunc(face_index / x_segments);
    loopsOf(bm, f, (l, i) => {
      const [u, v] = [[ix, iy], [ix + 1, iy], [ix + 1, iy + 1], [ix, iy + 1]][i] ?? [];
      if (u !== undefined) setUV(uv, l, f32(u * dx), f32(v * dy));
    });
    face_index++;
  });
}

const cube_faces = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]];

export function bmo_create_cube_exec(bm, { size, matrix = unit_m4(), calc_uvs = false }) {
  let off = f32(size / 2);
  if (!off) off = 0.5;
  const uv = uvLayer(bm, calc_uvs);
  const verts = [];
  for (let x = -1; x < 2; x += 2) for (let y = -1; y < 2; y += 2) for (let z = -1; z < 2; z += 2) {
    verts.push(BM_vert_create(bm, mul_m4_v3(matrix, [x * off, y * off, z * off])));
  }
  for (const quad of cube_faces) {
    const f = BM_face_create_verts(bm, quad.map((i) => verts[i]), 4, -1, BM_CREATE_NOP, true);
    if (uv) BMO_flag_enable(bm.f, f, FACE_MARK);
  }
  if (uv) BM_mesh_calc_uvs_cube(bm, FACE_MARK, uv);
  return verts;
}

export function BM_mesh_calc_uvs_cube(bm, oflag, uv) {
  const width = 0.25;
  let x = 0.375, y = 0;
  markedFaces(bm, oflag, (f) => {
    loopsOf(bm, f, (l, i) => {
      setUV(uv, l, x, y);
      if (i === 0) x += width;
      else if (i === 1) y += width;
      else if (i === 2) x -= width;
      else if (i === 3) y -= width;
    });
    if (y >= 0.75 && x > 0.125) { x = 0.125; y = 0.5; }
    else if (x <= 0.125) { x = 0.625; y = 0.5; }
    else y += 0.25;
  });
}

export function bmo_create_circle_exec(bm, { segments: segs, radius, cap_ends, cap_tris, matrix = unit_m4(), calc_uvs = false }) {
  if (!segs) return [];
  const uv = uvLayer(bm, calc_uvs);
  const verts = [];
  let cent1 = -1, v1 = -1, lastv1 = -1, firstv1 = -1, a;
  if (cap_ends) {
    cent1 = BM_vert_create(bm, mul_m4_v3(matrix, [0, 0, 0]));
    verts.push(cent1);
  }
  for (a = 0; a < segs; a++) {
    const [s, c] = sin_cos_from_fraction(a, segs);
    v1 = BM_vert_create(bm, mul_m4_v3(matrix, [f32(s * -radius), f32(c * radius), 0]));
    verts.push(v1);
    if (lastv1 >= 0) BM_edge_create(bm, v1, lastv1);
    if (a && cap_ends) BMO_flag_enable(bm.f, BM_face_create_quad_tri(bm, cent1, lastv1, v1, -1, -1, BM_CREATE_NOP), FACE_NEW);
    if (firstv1 < 0) firstv1 = v1;
    lastv1 = v1;
  }
  BM_edge_create(bm, firstv1, lastv1);
  if (cap_ends) {
    BMO_flag_enable(bm.f, BM_face_create_quad_tri(bm, cent1, v1, firstv1, -1, -1, BM_CREATE_NOP), FACE_NEW);
    if (uv) BM_mesh_calc_uvs_circle(bm, matrix, radius, FACE_NEW, uv);
  }
  if (!cap_tris) dissolveMarked(bm, FACE_NEW);
  return verts;
}

function dissolveMarked(bm, flag) {
  const faces = [];
  markedFaces(bm, flag, (f) => faces.push(f));
  BMO_op_callf(bm, bmo_dissolve_faces_exec, faces);
}

export function BM_mesh_calc_uvs_circle(bm, matrix, radius, oflag, uv) {
  const uv_scale = f32(0.5 / radius), uv_center = 0.5;
  const inv = invert_m4_m4(matrix);
  markedFaces(bm, oflag, (f) => loopsOf(bm, f, (l) => {
    const [x, y] = mul_m4_v3(inv, bm.v.co.subarray(bm.l.v[l] * 3, bm.l.v[l] * 3 + 3));
    setUV(uv, l, f32(uv_center + uv_scale * x), f32(uv_center + uv_scale * y));
  }));
}

export function bmo_create_cone_exec(bm, { segments: segs, radius1: rad1, radius2: rad2, depth, cap_ends, cap_tris, matrix = unit_m4(), calc_uvs = false }) {
  if (!segs) return [];
  const uv = uvLayer(bm, calc_uvs);
  const depth_half = f32(0.5 * depth);
  const verts = [], side_faces = [];
  const markUV = (f) => { if (uv) BMO_flag_enable(bm.f, f, FACE_MARK); return f; };
  let cent1 = -1, cent2 = -1, v1 = -1, v2 = -1, lastv1 = -1, lastv2 = -1, firstv1 = -1, firstv2 = -1;
  if (cap_ends) {
    cent1 = BM_vert_create(bm, mul_m4_v3(matrix, [0, 0, -depth_half]));
    cent2 = BM_vert_create(bm, mul_m4_v3(matrix, [0, 0, depth_half]));
    verts.push(cent1, cent2);
  }
  for (let i = 0; i < segs; i++) {
    const [sin_phi, cos_phi] = sin_cos_from_fraction(i, segs);
    v1 = BM_vert_create(bm, mul_m4_v3(matrix, [f32(rad1 * sin_phi), f32(rad1 * cos_phi), -depth_half]));
    v2 = BM_vert_create(bm, mul_m4_v3(matrix, [f32(rad2 * sin_phi), f32(rad2 * cos_phi), depth_half]));
    verts.push(v1, v2);
    if (i) {
      if (cap_ends) {
        BMO_flag_enable(bm.f, markUV(BM_face_create_quad_tri(bm, cent1, lastv1, v1, -1, -1, BM_CREATE_NOP)), FACE_NEW);
        BMO_flag_enable(bm.f, markUV(BM_face_create_quad_tri(bm, cent2, v2, lastv2, -1, -1, BM_CREATE_NOP)), FACE_NEW);
      }
      side_faces.push(markUV(BM_face_create_quad_tri(bm, lastv1, lastv2, v2, v1, -1, BM_CREATE_NOP)));
    } else {
      firstv1 = v1;
      firstv2 = v2;
    }
    lastv1 = v1;
    lastv2 = v2;
  }
  if (cap_ends) {
    BMO_flag_enable(bm.f, markUV(BM_face_create_quad_tri(bm, cent1, v1, firstv1, -1, -1, BM_CREATE_NOP)), FACE_NEW);
    BMO_flag_enable(bm.f, markUV(BM_face_create_quad_tri(bm, cent2, firstv2, v2, -1, -1, BM_CREATE_NOP)), FACE_NEW);
  }
  markUV(BM_face_create_quad_tri(bm, v1, v2, firstv2, firstv1, -1, BM_CREATE_NOP));
  if (uv) BM_mesh_calc_uvs_cone(bm, matrix, rad2, rad1, segs, cap_ends, FACE_MARK, uv);
  const { l } = bm;
  if (rad1 === 0) {
    if (cap_ends) BM_vert_kill(bm, cent1);
    for (const f of side_faces) {
      const first = bm.f.l_first[f];
      BM_edge_collapse(bm, l.e[l.prev[first]], l.v[l.prev[first]], true, true);
    }
  }
  if (rad2 === 0) {
    if (cap_ends) BM_vert_kill(bm, cent2);
    for (const f of side_faces) {
      const first = bm.f.l_first[f];
      BM_edge_collapse(bm, l.e[l.next[first]], l.v[l.next[first]], true, true);
    }
  }
  if (!cap_tris) dissolveMarked(bm, FACE_NEW);
  return verts.filter((v) => bm.v.alive[v]);
}

export function BM_mesh_calc_uvs_cone(bm, matrix, radius_top, radius_bottom, segments, cap_ends, oflag, uv) {
  const uv_width = f32(1 / segments), uv_height = cap_ends ? 0.5 : 1;
  const uv_center_y = cap_ends ? 0.25 : 0.5, uv_center_x_top = cap_ends ? 0.25 : 0.5;
  const uv_center_x_bottom = cap_ends ? 0.75 : 0.5, uv_radius = cap_ends ? f32(0.24) : 0.5;
  const uv_scale_top = radius_top !== 0 ? f32(uv_radius / radius_top) : radius_bottom !== 0 ? f32(uv_radius / radius_bottom) : uv_radius;
  const uv_scale_bottom = radius_bottom !== 0 ? f32(uv_radius / radius_bottom) : uv_scale_top;
  const up = mul_mat3_m4_v3(matrix, [0, 0, 1]);
  const inv = invert_m4_m4(matrix);
  let x = 1, y = f32(1 - uv_height);
  markedFaces(bm, oflag, (f) => {
    if (bm.f.len[f] === 4 && radius_top && radius_bottom) {
      loopsOf(bm, f, (l, i) => {
        if (i === 1) y = f32(y + uv_height);
        else if (i === 2) x = f32(x - uv_width);
        else if (i === 3) y = f32(y - uv_height);
        setUV(uv, l, x, y);
      });
      return;
    }
    BM_face_normal_update(bm, f);
    const top = bm.f.no[f * 3] * up[0] + bm.f.no[f * 3 + 1] * up[1] + bm.f.no[f * 3 + 2] * up[2] > 0;
    loopsOf(bm, f, (l) => {
      const [vx, vy] = mul_m4_v3(inv, bm.v.co.subarray(bm.l.v[l] * 3, bm.l.v[l] * 3 + 3));
      if (top) setUV(uv, l, f32(uv_center_x_top + vx * uv_scale_top), f32(uv_center_y + vy * uv_scale_top));
      else setUV(uv, l, f32(uv_center_x_bottom + vx * uv_scale_bottom), f32(uv_center_y + vy * uv_scale_bottom));
    });
  });
}
