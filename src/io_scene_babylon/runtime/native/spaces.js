// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, invert, linear, polarRotation, setTranslation, translation, transformDir } from './math.js';
import { basisFromPose, poseFromBasis } from './bone.js';
import { mulAffine, invertAffine } from './rig/m4.js';
import { poseFromBasisInto, basisFromPoseInto } from './rig/inherit.js';

// Space conversions (00-foundations Spaces). An entity is
//   { kind: 'object', parentMatrix: ParentWorld @ ParentInverse | null }
//   { kind: 'bone', armatureWorld, rest, parent: { pose, rest } | null, flags }
// `opts.custom` is the CUSTOM space's world matrix, `opts.w0` the entity's own world matrix at conversion time
// (object LOCAL without parent).

const noConnect = (flags) => (flags.use_connect ? { ...flags, use_connect: false } : flags);

export function toSpace(space, w, ent, opts = {}) {
  switch (space) {
    case 'WORLD': return w;
    case 'CUSTOM': return opts.custom ? mul(invert(opts.custom), w) : w;
  }
  if (ent.kind === 'object') {
    if (space !== 'LOCAL') return w;
    return mul(invert(ent.parentMatrix ?? polarRotation(opts.w0 ?? w)), w);
  }
  const p = ent.armatureInv ? affine(ent.armatureInv, w) : mul(invert(ent.armatureWorld), w);
  switch (space) {
    case 'POSE': return p;
    case 'LOCAL_WITH_PARENT': return affine(ent.restInv ??= invert(ent.rest), p);
    case 'LOCAL':
      if (ent.offset && fullInherit(ent.flags)) return affine(inverseOf(parentFrame(ent)), p);
      if (ent.offset && ent.parent) return basisFromPoseInto(new Float64Array(16), ent.parent.pose, 0, ent.parent.rest, 0, ent.offset, 0, ent.flags, p);
      return basisFromPose(ent.parent, ent.rest, noConnect(ent.flags), p);
    default: return w;
  }
}

export function fromSpace(space, x, ent, opts = {}) {
  switch (space) {
    case 'WORLD': return x;
    case 'CUSTOM': return opts.custom ? mul(opts.custom, x) : x;
  }
  if (ent.kind === 'object') {
    if (space !== 'LOCAL') return x;
    return mul(ent.parentMatrix ?? polarRotation(opts.w0 ?? x), x);
  }
  switch (space) {
    case 'POSE': return affine(ent.armatureWorld, x);
    case 'LOCAL_WITH_PARENT': return affine(ent.armatureWorld, affine(ent.rest, x));
    case 'LOCAL':
      if (ent.offset && fullInherit(ent.flags)) return affine(ent.armatureWorld, affine(parentFrame(ent), x));
      if (ent.offset && ent.parent) {
        poseFromBasisInto(FRAME, 0, ent.parent.pose, 0, ent.parent.rest, 0, ent.offset, 0, ent.flags, x, 0, false);
        return affine(ent.armatureWorld, FRAME);
      }
      return mul(ent.armatureWorld, poseFromBasis(ent.parent, ent.rest, noConnect(ent.flags), x));
    default: return x;
  }
}

// With default inheritance (rotation, FULL scale, Local Location) a bone's LOCAL space is the frame Pp @ Rp^-1 @ R
// (R without a parent): the pose formula of 00-foundations reduces to it. `ent.offset` holds Rp^-1 @ R.
const fullInherit = (f) => f.use_inherit_rotation !== false && (f.inherit_scale ?? 'FULL') === 'FULL' && f.use_local_location !== false;
const FRAME = new Float64Array(16), INV = new Float64Array(16);
function parentFrame(ent) {
  if (!ent.parent) return ent.rest;
  mulAffine(FRAME, 0, ent.parent.pose, 0, ent.offset, 0);
  return FRAME;
}
function inverseOf(m) {
  invertAffine(INV, 0, m, 0);
  return INV;
}
// Results come from a ring of reused matrices: a conversion's result lives until 512 more conversions have run, far
// beyond one constraint's evaluation, which is as long as it is used.
const RING = Array.from({ length: 512 }, () => new Float64Array(16));
let ringAt = 0;
// A reused matrix from the ring, for results consumed within a bone's stack (see affine).
export const ringMatrix = () => RING[ringAt = (ringAt + 1) & 511];

function affine(a, b) {
  const out = RING[ringAt = (ringAt + 1) & 511];
  mulAffine(out, 0, a, 0, b, 0);
  return out;
}

// Target LOCAL_OWNER_ORIENT: the target bone's LOCAL matrix re-expressed in the owner's rest orientation.
export function localOwnerOrient(targetLocal, targetRest, ownerRest) {
  const c = mul(invert(linear(ownerRest)), linear(targetRest)), ci = invert(c);
  const out = mul(mul(c, linear(targetLocal)), ci);
  return setTranslation(out, transformDir(c, translation(targetLocal)));
}
