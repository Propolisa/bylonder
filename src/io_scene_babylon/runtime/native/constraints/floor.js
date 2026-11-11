// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { clone, invert, transformPoint, translation, setTranslation } from '../math.js';

const AXIS = { FLOOR_X: [0, 1], FLOOR_Y: [1, 1], FLOOR_Z: [2, 1], FLOOR_NEGATIVE_X: [0, -1], FLOOR_NEGATIVE_Y: [1, -1], FLOOR_NEGATIVE_Z: [2, -1] };

// FLOOR (specs/constraints_more.md): the owner's origin kept on one side of a plane through the target.
export default {
  type: 'FLOOR',
  targets: 'one',
  defaults: { floor_location: 'FLOOR_Z', offset: 0, use_rotation: false },
  evaluate(owner, target, s) {
    const [a, side] = AXIS[s.floor_location] ?? AXIS.FLOOR_Z;
    let p = translation(owner);
    if (s.use_rotation) p = transformPoint(invert(target), p);
    const plane = (s.use_rotation ? 0 : translation(target)[a]) + s.offset;
    if (side > 0 ? p[a] >= plane : p[a] <= plane) return null;
    p[a] = plane;
    if (s.use_rotation) p = transformPoint(target, p);
    return setTranslation(clone(owner), p);
  },
};
