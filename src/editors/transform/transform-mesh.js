// The Edit Mode selection as transform data (transform_convert_mesh.cc): the selected vertices in world space about
// their median point, for initTransform (transform.js). Read from the edit mesh's Mesh arrays, written to the edit
// mesh (an EditMesh), as Blender's transform writes BMVert.co.
import { Matrix, Vector3 } from '@babylonjs/core';
import { add_v3, sub_v3, mul_v3_fl } from '../../blenlib/math-geom.js';
import { mul_m3_v3 } from '../../blenlib/math-matrix.js';
import { toBlender, toBabylon } from './transform.js';

// Babylon world matrix columns as Blender world axes, normalized.
export function worldAxes(world) {
  const m = world.m;
  return [0, 2, 1].map((c) => toBlender(new Vector3(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]).normalize()));
}

export function createTransMesh(edit, mesh, object) {
  const world = object.computeWorldMatrix(true), inverse = Matrix.Invert(world);
  const selected = mesh.attribute('.select_vert'), hidden = mesh.attribute('.hide_vert');
  const verts = [];
  for (let v = 0; v < mesh.verts_num; v++) if (selected[v] && !hidden[v]) verts.push(v);
  if (!verts.length) return null;
  const co = (v) => mesh.vert_positions.subarray(v * 3, v * 3 + 3);
  const iloc = verts.map((v) => toBlender(Vector3.TransformCoordinates(new Vector3(co(v)[0], co(v)[2], co(v)[1]), world)));
  const write = (fn) => edit.setCoords(verts, iloc.flatMap((p) => {
    const local = Vector3.TransformCoordinates(toBabylon(fn(p)), inverse);
    return [local.x, local.z, local.y];
  }));
  return {
    center: mul_v3_fl(iloc.reduce(add_v3, [0, 0, 0]), 1 / iloc.length),
    local: worldAxes(world),
    apply: (mat, center, translation) => write((p) => add_v3(add_v3(center, mul_m3_v3(mat, sub_v3(p, center))), translation)),
    restore: () => write((p) => p),
  };
}
