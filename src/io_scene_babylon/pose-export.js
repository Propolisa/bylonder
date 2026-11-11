// An armature's bone constraints as the page runs them (runtime/pose-constraints.js): read from RNA where the page has
// a solver for each, and kept only where the page's pose is the one Main evaluated at every frame the export samples.
import { posedBone } from './runtime/blend-scene.js';
import { solvePose } from './runtime/pose-constraints.js';
import { key } from './controls-export.js';

const AXES = ['x', 'y', 'z'];
// The spaces the page converts between, for a bone and for an object target.
const BONE_SPACES = ['WORLD', 'POSE', 'LOCAL'];
// Matrices equal to the IK solver's own tolerance.
const TOLERANCE = 1e-3;

// What a constraint reads, as the page finds it: a bone of the armature, or an object's node; undefined where it
// cannot; null where there is none.
const targetOf = (arm, ob, sub, nodeOf) => {
  if (!ob) return null;
  if (ob.name === arm.name && sub) return arm.pose.bones.get(sub) ? { bone: sub } : undefined;
  const node = !sub && nodeOf(ob);
  return node ? { node: node.id } : undefined;
};

// The IK chain of a pose bone's constraint, root first, when the page solves it: one or two bones.
function ikChain(pose, c) {
  const chain = [];
  for (let bone = pose; bone && (c.chain_count === 0 || chain.length < c.chain_count); bone = bone.parent) chain.unshift(bone);
  const plain = chain.every((b) => !b.ik_stretch && !b.lock_ik_x && !b.lock_ik_y && !b.lock_ik_z && !b.use_ik_limit_x && !b.use_ik_limit_y && !b.use_ik_limit_z);
  return chain.length <= 2 && plain ? chain.map((b) => b.name) : null;
}

// Each type's settings as the page reads them, or null where it does not solve it so.
const SETTINGS = {
  IK: (c, pose) => c.use_tail && !c.use_rotation && c.pole_target !== undefined && { chain: ikChain(pose, c), pole_angle: c.pole_angle },
  DAMPED_TRACK: (c) => ({ track_axis: c.track_axis, head_tail: c.head_tail }),
  TRACK_TO: (c) => ({ track_axis: c.track_axis, up_axis: c.up_axis, use_target_z: c.use_target_z, head_tail: c.head_tail }),
  COPY_ROTATION: (c) => (AXES.every((a) => c[`use_${a}`] && !c[`invert_${a}`]) && c.mix_mode === 'REPLACE' ? { head_tail: 0 } : null),
  LIMIT_ROTATION: (c) => (!c.use_legacy_behavior ? { euler_order: c.euler_order, limits: AXES.map((a) => (c[`use_limit_${a}`] ? [c[`min_${a}`], c[`max_${a}`]] : null)) } : null),
};

// An armature's bone constraints by bone, as the page runs them, or null where one is not run so.
export function poseStacks(arm, nodeOf) {
  if (arm.pose.ik_solver !== 'LEGACY') return null;
  const stacks = {};
  for (const pose of arm.pose.bones) {
    const list = [];
    for (const c of [...pose.constraints].filter((c) => !c.mute && c.enabled !== false)) {
      const settings = SETTINGS[c.type]?.(c, pose), target = targetOf(arm, c.target, c.subtarget, nodeOf);
      const spaces = BONE_SPACES.includes(c.owner_space) && (target?.node ? c.target_space === 'WORLD' : BONE_SPACES.includes(c.target_space));
      if (!settings || target === undefined || !spaces || (c.type === 'IK' && !settings.chain)) return null;
      const pole = c.type === 'IK' && targetOf(arm, c.pole_target, c.pole_subtarget, nodeOf);
      if (pole === undefined) return null;
      list.push({ name: c.name, type: c.type, influence: c.influence, owner_space: c.owner_space, target_space: c.target_space, ...settings, ...(target && { target }), ...(pole && { pole }) });
    }
    if (list.length) stacks[pose.name] = list;
  }
  return Object.keys(stacks).length ? stacks : null;
}

// A pose bone's own matrix (its location, rotation and scale after its rest), as blend-scene.js poses a Babylon Bone.
export const ownMatrix = (pose, bone) => posedBone({ mode: pose.rotation_mode }, (name) => [...pose[name]], bone.getRestMatrix());

// The constraints with their influences read from their controls (controls-export.js poseControls), so that a driver or
// the page sets them.
const influenced = (arm, stacks) => Object.fromEntries(Object.entries(stacks).map(([bone, list]) => [bone, list.map((c) => ({ ...c,
  influence: { property: `objects${key(arm.name)}.pose.bones${key(bone)}.constraints${key(c.name)}.influence` } }))]));

const close = (a, b) => a.asArray().every((v, i) => Math.abs(v - b.asArray()[i]) <= TOLERANCE);

// For an armature drawn by one skeleton, its bone constraints as the page runs them: `check(evaluated)` compares the
// page's pose with Main's at the frame Main is on (`evaluated`: each bone's local matrix as the skeleton holds it),
// recording each bone's own matrix; `entity()` the IR entity's inputs once every check held, else null, the bones'
// own matrices those of the frame Main is on then; `moved`, the bones the constraints move, and `own(bone)` a bone's
// own matrices at the frames checked. `meshWorld()` gives the skinned mesh's
// world matrix and `nodeWorld(id)` a node's, at the frame Main is on.
export function livePoseConstraints(arm, skeleton, mesh, { nodeOf, meshWorld, nodeWorld }) {
  const stacks = poseStacks(arm, nodeOf);
  if (!stacks) return null;
  const bones = skeleton.bones, poses = bones.map((bone) => arm.pose.bones.get(bone.name));
  if (poses.some((pose) => !pose || pose.rotation_mode === 'AXIS_ANGLE')) return null;
  const shape = bones.map((bone, i) => ({ name: bone.name, parent: bone.getParent() ? bones.indexOf(bone.getParent()) : -1, rest: bone.getRestMatrix(),
    length: arm.data.bones.get(bone.name).length, mode: poses[i].rotation_mode }));
  const moved = new Set(), owns = new Map(bones.map((bone) => [bone, []]));
  let checked = 0, held = true;
  return {
    moved,
    own: (bone) => owns.get(bone),
    check(evaluated) {
      const locals = bones.map((bone, i) => ownMatrix(poses[i], bone));
      bones.forEach((bone, i) => owns.get(bone).push(locals[i]));
      const result = solvePose({ bones: shape, locals, mesh: meshWorld(), space: skeleton.space, stacks, nodeWorld });
      for (const [i, local] of result) {
        moved.add(bones[i]);
        held &&= close(local, evaluated[i]);
      }
      checked++;
    },
    entity: () => (checked && held ? {
      skeleton: skeleton.id, mesh: mesh.id, space: skeleton.space.asArray(), constraints: influenced(arm, stacks),
      bones: Object.fromEntries(shape.map(({ name, length, mode }, i) => [name, { length, mode, ...(moved.has(bones[i]) && { own: ownMatrix(poses[i], bones[i]).asArray() }) }])),
    } : null),
  };
}
