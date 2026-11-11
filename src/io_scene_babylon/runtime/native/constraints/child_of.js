// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, invert, split, compose, eulerMatrix, fromRows, translation, setTranslation } from '../math.js';
import { eulerOf } from '../euler.js';

const AXES = ['x', 'y', 'z'];
const flags = (s, kind) => AXES.map((a) => s[`use_${kind}_${a}`] !== false);
const allUsed = (s) => ['location', 'rotation', 'scale'].every((k) => flags(s, k).every(Boolean));

// CHILD_OF (specs/child_of.md): the owner follows the target as if parented, through the stored inverse matrix.
export default {
  type: 'CHILD_OF',
  targets: 'one',
  // Beyond the spec (fuzz, every owner and target space pair; the spec's cases are the WORLD ones): the result is
  // `target @ inverse @ owner` taken as a world matrix, with the target in target space and the owner in owner
  // space; it is not converted back from owner space.
  resultInWorld: true,
  defaults: { set_inverse_pending: true, inverse_matrix: null },
  evaluate(owner, target, s, spaces) {
    // Beyond the spec: with every axis used the target and inverse are taken as they are (a sheared target keeps its
    // shear); otherwise both are filtered by the axis flags, the inverse with its disabled location axes zeroed.
    const all = allUsed(s);
    const parent = all ? target : filtered(target, s, false);
    let inverse;
    if (s.set_inverse_pending) {
      // Beyond the spec: for a bone owner Set Inverse takes the target in armature space.
      const setFrame = spaces.ent.kind === 'bone' ? mul(invert(spaces.ent.armatureWorld), parent) : parent;
      inverse = invert(setFrame);
      spaces.store('inverse_matrix', inverse);
      spaces.store('set_inverse_pending', false);
    } else {
      inverse = asMatrix(s.inverse_matrix);
      if (!all) inverse = filtered(inverse, s, true);
    }
    const out = mul(mul(parent, inverse), owner);
    const useLoc = flags(s, 'location'), ot = translation(owner);
    return setTranslation(out, translation(out).map((v, i) => (useLoc[i] ? v : ot[i])));
  },
};

// Split into translation, XYZ Euler (smaller-sum solution) and column lengths; disabled rotation axes become 0,
// disabled scale axes 1 and, with zeroLocation, disabled location axes 0.
function filtered(m, s, zeroLocation) {
  const { t, r, s: sc } = split(m);
  const useLoc = flags(s, 'location'), useRot = flags(s, 'rotation'), useScale = flags(s, 'scale');
  const e = eulerOf(r, 'XYZ').map((v, i) => (useRot[i] ? v : 0));
  const loc = zeroLocation ? t.map((v, i) => (useLoc[i] ? v : 0)) : t;
  return compose(loc, eulerMatrix(e, 'XYZ'), sc.map((v, i) => (useScale[i] ? v : 1)));
}

// A nested list is read as Blender's Python API reads one assigned to a matrix property: one list per column.
function asMatrix(m) {
  if (!m) return fromRows([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  return Float64Array.from(Array.isArray(m[0]) ? m.flat() : m);
}
