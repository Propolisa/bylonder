// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { fixShear } from './math.js';
import {
  mat, mul, invert, linear, col, setCol, setTranslation, translation, transformDir, add, sub, scaleV, cross, dot,
  normalize, len, det3, diag, scaleOf, normalizedCols,
} from './math.js';

export const DEFAULT_FLAGS = Object.freeze({
  use_connect: false, use_inherit_rotation: true, inherit_scale: 'FULL', use_local_location: true,
});

// Beyond the spec (fuzz with sheared parents): a parent's rotation is the orientation of fix_shear(P3), and ALIGNED
// takes fix_shear(P3)'s column lengths as the parent scale.
const rotationOf = (m) => normalizedCols(fixShear(m));

// Parent frames of a bone (00-foundations Bone pose): orientation Q, extra scale S (ALIGNED), origin t, location L.
export function parentFrames(pp, rp, r, flags) {
  const o = mul(invert(rp), r), o3 = linear(o);
  const t = translation(mul(pp, o));
  const full = linear(pp);
  const L = flags.use_local_location ? mul(full, o3) : full;
  // Inherit Rotation off keeps the parent's column lengths (beyond the spec: column lengths, also when sheared).
  const p3 = flags.use_inherit_rotation ? full : mul(linear(rp), diag(scaleOf(full)));
  let q = mul(p3, o3), extra = null;
  switch (flags.inherit_scale) {
    case 'FIX_SHEAR': q = fixShear(q); break;
    case 'AVERAGE': {
      // Beyond the spec: the volume is the parent's full matrix, also with Inherit Rotation off.
      const k = Math.cbrt(det3(full));
      q = mul(mul(rotationOf(p3), diag([k, k, k])), o3);
      break;
    }
    case 'NONE': q = mul(rotationOf(p3), o3); break;
    case 'NONE_LEGACY': q = mul(normalizedCols(p3), o3); break;
    case 'ALIGNED': q = mul(rotationOf(p3), o3); extra = scaleOf(fixShear(full)); break;
  }
  return { q, extra, t, L };
}

export function poseFromBasis(parent, rest, flags, basis) {
  if (!parent) return mul(rest, basis);
  const { q, extra, t, L } = parentFrames(parent.pose, parent.rest, rest, flags);
  let out = mul(q, linear(basis));
  if (extra) out = mul(out, diag(extra));
  const loc = flags.use_connect ? [0, 0, 0] : translation(basis);
  return setTranslation(out, add(t, transformDir(L, loc)));
}

export function basisFromPose(parent, rest, flags, pose) {
  if (!parent) return mul(invert(rest), pose);
  const { q, extra, t, L } = parentFrames(parent.pose, parent.rest, rest, flags);
  let out = mul(invert(q), linear(pose));
  if (extra) out = mul(out, diag(extra.map((v) => 1 / v)));
  return setTranslation(out, transformDir(invert(L), sub(translation(pose), t)));
}
