// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// One constraint of a compiled stack, on the owner's world matrix (00-foundations, Evaluating one constraint): the
// generic path shared by every type. Returns the new world matrix, or null for no change.
import { toSpace, fromSpace, localOwnerOrient } from '../spaces.js';

// `local`: the owner already in its owner space (the stack stays there between same-space constraints);
// `keepLocal`: return the result in owner space instead of world.
export function runConstraint(inst, e, w0, ent, rotationMode, local = null, keepLocal = false) {
  const { type, s } = e;
  const ownerSpace = s.owner_space ?? 'WORLD', targetSpace = s.target_space ?? 'WORLD';
  const custom = (ownerSpace === 'CUSTOM' || targetSpace === 'CUSTOM') && e.custom ? inst.target(e.custom, 0, e.cbuf ??= new Float64Array(16), e.crec ??= {}).world : null;
  let target = null;
  if (e.targets) target = e.targets.map((t) => ({ ...t, ...inst.target(t.ref) }));
  else if (e.target) target = targetInSpace(inst.target(e.target, s.head_tail ?? 0, e.tbuf ??= new Float64Array(16), e.trec ??= {}, !!s.use_bbone_shape), targetSpace, custom, ent);
  else if (type.targets === 'one') return null;
  // One context object per entry, refilled per call (no closures per evaluation).
  const spaces = e.spaces ??= new Spaces(e);
  spaces.inst = inst; spaces.ent = ent; spaces.ownerSpace = ownerSpace; spaces.targetSpace = targetSpace;
  spaces.custom = custom; spaces.w0 = w0; spaces.rotationMode = rotationMode ?? 'XYZ';
  spaces.opts.custom = custom; spaces.opts.w0 = w0;
  const result = type.evaluate(ownerSpace === 'WORLD' ? w0 : local ?? spaces.toOwner(w0), target, s, spaces);
  if (!result || keepLocal) return result;
  return type.resultInWorld || ownerSpace === 'WORLD' ? result : spaces.fromOwner(result);
}

class Spaces {
  constructor(e) { this.e = e; this.opts = { custom: null, w0: null }; }
  // Values Blender writes back onto the constraint (stretch_to rest_length, child_of inverse_matrix).
  store(key, value) { this.e.s[key] = value; this.e.raw[key] = value; }
  toOwner(w) { return toSpace(this.ownerSpace, w, this.ent, this.opts); }
  fromOwner(x) { return fromSpace(this.ownerSpace, x, this.ent, this.opts); }
}

function targetInSpace(t, space, custom, ownerEnt) {
  if (space === 'LOCAL_OWNER_ORIENT') {
    if (t.ent.kind !== 'bone' || ownerEnt.kind !== 'bone') return t.world;
    return localOwnerOrient(toSpace('LOCAL', t.world, t.ent), t.ent.rest, ownerEnt.rest);
  }
  return toSpace(space, t.world, t.ent, { custom, w0: t.world });
}
