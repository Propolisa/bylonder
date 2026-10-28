// View3DCursor's rotation (scene.cc): the matrix of its rotation mode's values, and the values of a rotation matrix in
// that mode, kept compatible with the current ones (View3DCursor::set_matrix with use_compat).
import { eulO_to_mat3, quat_to_mat3, mat3_normalized_to_compatible_eulO, mat3_normalized_to_quat } from '../../blenlib/math-rotation.js';

// eRotationModes of the Euler orders.
const EULER_ORDERS = { XYZ: 1, XZY: 2, YXZ: 3, YZX: 4, ZXY: 5, ZYX: 6 };
const normalized = (q) => { const len = Math.hypot(...q); return len ? q.map((x) => x / len) : [1, 0, 0, 0]; };

export const cursorRotationMatrix = (cursor) => (cursor.rotation_mode === 'QUATERNION'
  ? quat_to_mat3(normalized(cursor.rotation_quaternion))
  : eulO_to_mat3(cursor.rotation_euler, EULER_ORDERS[cursor.rotation_mode] ?? 1));

export const cursorRotationSet = (cursor, mat) => (cursor.rotation_mode === 'QUATERNION'
  ? { rotation_quaternion: mat3_normalized_to_quat([0, 0, 0, 0], mat) }
  : { rotation_euler: mat3_normalized_to_compatible_eulO(cursor.rotation_euler, EULER_ORDERS[cursor.rotation_mode] ?? 1, mat) });
