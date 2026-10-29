// Blender's Armature data (DNA_armature_types.h) in the module's Main (tools/blender-port/wasm/armature-api.cc), as
// Bylonder holds it in RNA's terms:
//   { bones: [{ name, parent (a bone's name or null), head, tail, roll (armature space), envelope_distance, head_radius,
//     tail_radius, the EditBone booleans of BONE_FLAGS, pose: { location, rotation_mode, rotation_quaternion,
//     rotation_euler, scale, select, hide } }], active (a bone's name or null) }
// Edit Mode's edit bones are the bones while editing. What Blender draws of each bone is read with `drawn`: its
// matrix in armature space (the edit bone's, else the evaluated pose's) and its length.
import { moduleAccess } from '../../bmesh/bmesh-wasm.js';

const { x, withArrays, withString, cString } = moduleAccess;
// Whether the module has armatures (armature-api.cc).
export const hasArmatures = typeof x.armature_bones_get === 'function';

const BONE_INTS = 4, BONE_FLOATS = 40, SET_FLOATS = 23;
// eBone_Flag bits behind EditBone's RNA booleans (rna_armature.cc), negative where RNA inverts the bit.
const BONE_FLAGS = {
  select: 1 << 0, select_head: 1 << 1, select_tail: 1 << 2, use_connect: 1 << 4, use_inherit_rotation: -(1 << 9), hide: 1 << 10,
  use_envelope_multiply: 1 << 11, use_deform: -(1 << 12), use_cyclic_offset: -(1 << 18), lock: 1 << 19, hide_select: 1 << 21,
  use_local_location: -(1 << 22), use_relative_parent: 1 << 23,
};
const BONE_HIDDEN_P = 1 << 6, POSE_SELECTED = 1 << 6;
const ROTATION_MODES = { [-1]: 'AXIS_ANGLE', 0: 'QUATERNION', 1: 'XYZ', 2: 'XZY', 3: 'YXZ', 4: 'YZX', 5: 'ZXY', 6: 'ZYX' };
const rotationMode = (id) => Number(Object.keys(ROTATION_MODES).find((value) => ROTATION_MODES[value] === id));

// The bones as armature_bones_get gives them, with what Blender draws.
function read(ob) {
  const header = x.armature_bones_get(ob) >>> 0;
  const [count, intsAt, floatsAt, namesAt, active] = new Int32Array(x.memory.buffer, header, 5);
  const ints = new Int32Array(x.memory.buffer, intsAt >>> 0, count * BONE_INTS), floats = new Float32Array(x.memory.buffer, floatsAt >>> 0, count * BONE_FLOATS);
  const names = cString(namesAt >>> 0).split('\n');
  const bones = Array.from({ length: count }, (_, i) => {
    const [parent, flag, poseFlag, rotmode] = ints.subarray(i * BONE_INTS, (i + 1) * BONE_INTS);
    let at = i * BONE_FLOATS;
    const take = (n) => Array.from(floats.subarray(at, (at += n)));
    const [head, tail, [roll, envelope_distance, head_radius, tail_radius]] = [take(3), take(3), take(4)];
    const pose = { location: take(3), rotation_quaternion: take(4), rotation_euler: take(3), scale: take(3), rotation_mode: ROTATION_MODES[rotmode],
      select: !!(poseFlag & POSE_SELECTED), hide: !!(flag & BONE_HIDDEN_P) };
    const flags = Object.fromEntries(Object.entries(BONE_FLAGS).map(([name, bit]) => [name, bit < 0 ? !(flag & -bit) : !!(flag & bit)]));
    return { name: names[i], parent: parent >= 0 ? names[parent] : null, head, tail, roll, envelope_distance, head_radius, tail_radius, ...flags, pose,
      drawn: { matrix: take(16), length: take(1)[0] } };
  });
  return { bones, active: active >= 0 ? names[active] : null };
}

// An armature object's data (in Edit Mode its edit bones).
export function armatureData(ob) {
  const { bones, active } = read(ob);
  return { bones: bones.map(({ drawn, ...bone }) => bone), active };
}
// What Blender draws of each bone: its name, selection and hidden state, matrix (column-major, armature space) and length.
export const armatureDrawn = (ob) => read(ob).bones.map(({ name, select, select_head, select_tail, hide, pose, drawn }) =>
  ({ name, select, select_head, select_tail, hide, pose_select: pose.select, pose_hide: pose.hide, ...drawn }));

// Replaces an armature object's bones and their pose with the data's (the edit bones in Edit Mode); `bmain` is Main's.
export function setArmatureData(bmain, ob, { bones, active = null }) {
  const index = new Map(bones.map((bone, i) => [bone.name, i]));
  const ints = Int32Array.from(bones.flatMap((bone) => {
    const flag = Object.entries(BONE_FLAGS).reduce((bits, [name, bit]) => ((bone[name] ?? bit < 0) !== (bit < 0) ? bits | Math.abs(bit) : bits), bone.pose?.hide ? BONE_HIDDEN_P : 0);
    return [index.get(bone.parent) ?? -1, flag, bone.pose?.select ? POSE_SELECTED : 0, rotationMode(bone.pose?.rotation_mode ?? 'QUATERNION')];
  }));
  const floats = Float32Array.from(bones.flatMap(({ head, tail, roll = 0, envelope_distance = 0.25, head_radius = 0.1, tail_radius = 0.05, pose = {} }) => [
    ...head, ...tail, roll, envelope_distance, head_radius, tail_radius,
    ...(pose.location ?? [0, 0, 0]), ...(pose.rotation_quaternion ?? [1, 0, 0, 0]), ...(pose.rotation_euler ?? [0, 0, 0]), ...(pose.scale ?? [1, 1, 1])]));
  if (floats.length !== bones.length * SET_FLOATS) throw new Error('armature data: bones need a head and a tail');
  withArrays([ints, floats], ([i, f]) => withString(bones.map((bone) => bone.name + '\n').join(''), (names) =>
    x.armature_bones_set(bmain, ob, bones.length, i, f, names, index.get(active) ?? -1)));
}

// A click on a bone (its index in the data's order, -1 for none; `part` 0 for its body, 1 its head, 2 its tail) in
// Edit or Pose Mode, as Blender's view3d.select applies it, in Main's context C: whether it found a bone or changed the
// selection.
export const selectBone = (C, ob, index, { part = 0, sel_op, deselect_all = false, select_passthrough = false }) =>
  !!x.armature_select_pick(C, ob, index, part, sel_op, deselect_all, select_passthrough);
