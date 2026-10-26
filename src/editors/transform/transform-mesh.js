// The Edit Mode selection as transform data (transform_convert_mesh.cc): the selected vertices in world space about
// their median point, for initTransform (transform.js).
import { Matrix, Vector3 } from '@babylonjs/core';
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_elem_flag_test } from '../../bmesh/intern/bmesh-class.js';
import { add_v3, sub_v3, mul_v3_fl } from '../../blenlib/math-geom.js';
import { mul_m3_v3 } from '../../blenlib/math-matrix.js';
import { toBlender, toBabylon } from './transform.js';

// Babylon world matrix columns as Blender world axes, normalized.
export function worldAxes(world) {
  const m = world.m;
  return [0, 2, 1].map((c) => toBlender(new Vector3(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]).normalize()));
}

export function createTransMesh(bm, object) {
  const world = object.computeWorldMatrix(true), inverse = Matrix.Invert(world);
  const verts = [];
  BM_ITER_MESH(bm.v, (v) => { if (BM_elem_flag_test(bm.v, v, BM_ELEM_SELECT) && !BM_elem_flag_test(bm.v, v, BM_ELEM_HIDDEN)) verts.push(v); });
  if (!verts.length) return null;
  const co = (v) => bm.v.co.subarray(v * 3, v * 3 + 3);
  const iloc = verts.map((v) => toBlender(Vector3.TransformCoordinates(new Vector3(co(v)[0], co(v)[2], co(v)[1]), world)));
  const write = (fn) => verts.forEach((v, i) => {
    const local = Vector3.TransformCoordinates(toBabylon(fn(iloc[i])), inverse);
    bm.v.co.set([local.x, local.z, local.y], v * 3);
  });
  return {
    center: mul_v3_fl(iloc.reduce(add_v3, [0, 0, 0]), 1 / iloc.length),
    local: worldAxes(world),
    apply: (mat, center, translation) => write((p) => add_v3(add_v3(center, mul_m3_v3(mat, sub_v3(p, center))), translation)),
    restore: () => write((p) => p),
  };
}
