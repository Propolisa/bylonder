// The Snow test rig (snow-rig.json, Snow by Blender Studio, CC BY 4.0): the bones of Snow's limbs, spine, head, eyes
// and lids with their IK, copy and track constraints, as a character's rig and IR give them to effects. `ik` sets the
// limbs' IK/FK switch (the influence of their "Copy Transforms IK"), 0 being FK as the example's actions play.
import { Matrix } from '@babylonjs/core';
import { createPose, STRIDE } from '../../src/io_scene_babylon/runtime/character/pose.js';
import bones from './snow-rig.json' with { type: 'json' };

/** A character's view of Snow: `rig`, `blend` (its IR and `get`) and `armature`, with roles by name, and its `root`. */
export function snowRig({ ik = 0 } = {}) {
  const names = bones.map((b) => b.name), index = new Map(names.map((n, i) => [n, i]));
  const parents = Int32Array.from(bones.map((b) => (b.parent ? index.get(b.parent) ?? -1 : -1)));
  const rest = createPose(names.length);
  bones.forEach((b, i) => rest.set(b.rest, i * STRIDE));
  const rig = { names, parents, rest, boneIndex: (/** @type {string} */ name) => index.get(name) ?? -1 };
  const ir = { ids: { 'OB:RIG-Snow': { data: { pose: { bones: bones.map((b) => ({ ...b, parent: b.parent && { struct: `pose.bones[${JSON.stringify(b.parent)}]` } })) } } } } };
  const blend = { ir, get: (/** @type {string} */ path) => (path.endsWith('.constraints["Copy Transforms IK"].influence') ? ik : 0) };
  const roles = {
    hips: 'TORSO-Spine', spine: 'FK-Spine', chest: 'FK-Chest', neck: 'FK-Neck', head: 'FK-Head',
    'eye.L': 'Eye.L', 'eye.R': 'Eye.R', 'lid.L': ['MSTR-Eyelid_Upper.L', 'MSTR-Eyelid_Lower.L'], 'lid.R': ['MSTR-Eyelid_Upper.R', 'MSTR-Eyelid_Lower.R'],
    'arm.L': ['UpperArm.L', 'Forearm.L', 'Wrist.L'], 'arm.R': ['UpperArm.R', 'Forearm.R', 'Wrist.R'],
    'leg.L': ['Thigh.L', 'Knee.L', 'Foot.L'], 'leg.R': ['Thigh.R', 'Knee.R', 'Foot.R'],
  };
  // Blender's Z up as Babylon's Y up, so Snow faces +Z as an exported package places it.
  const root = Matrix.RotationX(-Math.PI / 2);
  return { rig, blend, armature: 'RIG-Snow', roles, root, node: { computeWorldMatrix: () => root } };
}
