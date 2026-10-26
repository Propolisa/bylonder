// An object as transform data (transform_convert_object.cc with ElementRotation and ElementResize), for initTransform
// (transform.js). Object Mode transforms the selection pivot, which passes its change on to every selected object.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { add_v3, sub_v3 } from '../../blenlib/math-geom.js';
import { mul_m3_v3 } from '../../blenlib/math-matrix.js';
import { toBlender, toBabylon } from './transform.js';
import { worldAxes } from './transform-mesh.js';

// A Blender world 3x3 matrix as a Babylon (row vector) matrix in Babylon's world.
const babylonMatrix = (m) => Matrix.FromArray([0, 2, 1].flatMap((c) => [...toBabylon(m[c]).asArray(), 0]).concat([0, 0, 0, 1]));

export function createTransObject(node) {
  const iloc = toBlender(node.position), ieul = node.rotation.clone(), iscale = node.scaling.clone();
  const irot = new Matrix();
  Quaternion.FromEulerVector(node.rotation).toRotationMatrix(irot);
  const axes = [0, 1, 2].map((r) => Vector3.FromArray(irot.m, r * 4));
  return {
    center: iloc,
    local: worldAxes(irot),
    apply(mat, center, translation, mode) {
      node.position.copyFrom(toBabylon(add_v3(add_v3(center, mul_m3_v3(mat, sub_v3(iloc, center))), translation)));
      const m = babylonMatrix(mat);
      if (mode === 'rotate') node.rotation.copyFrom(Quaternion.FromRotationMatrix(irot.multiply(m)).toEulerAngles());
      if (mode === 'resize') {
        // TransMat3ToSize: each axis scales by the length its axis gets, negative when it flips.
        const size = axes.map((axis) => { const w = Vector3.TransformNormal(axis, m); return w.length() * Math.sign(Vector3.Dot(w, axis) || 1); });
        node.scaling.set(iscale.x * size[0], iscale.y * size[1], iscale.z * size[2]);
      }
    },
    restore() {
      node.position.copyFrom(toBabylon(iloc));
      node.rotation.copyFrom(ieul);
      node.scaling.copyFrom(iscale);
    },
  };
}
