// Blender's Armature data (DNA_armature_types.h) in the module's Main (tools/blender-port/wasm/armature-api.cc), as
// Bylonder holds it in RNA's terms:
//   { bones: [{ name, parent (a bone's name or null), head, tail, roll (armature space), envelope_distance, head_radius,
//     tail_radius, the EditBone booleans of BONE_FLAGS, pose: { location, rotation_mode, rotation_quaternion,
//     rotation_euler, scale, select, hide } }], active (a bone's name or null) }
// Edit Mode's edit bones are the bones while editing. What Blender's overlay draws of them is armatureDraw's.
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { moduleAccess } from '../../bmesh/bmesh-wasm.js';

const { x, withArrays, withString, cString } = moduleAccess;
// Whether the module has armatures (armature-api.cc).
export const hasArmatures = typeof x.armature_bones_get === 'function';

const BONE_INTS = 4, BONE_FLOATS = 23;
// eBone_Flag bits behind EditBone's RNA booleans (rna_armature.cc), negative where RNA inverts the bit.
const BONE_FLAGS = {
  select: 1 << 0, select_head: 1 << 1, select_tail: 1 << 2, use_connect: 1 << 4, use_inherit_rotation: -(1 << 9), hide: 1 << 10,
  use_envelope_multiply: 1 << 11, use_deform: -(1 << 12), use_cyclic_offset: -(1 << 18), lock: 1 << 19, hide_select: 1 << 21,
  use_local_location: -(1 << 22), use_relative_parent: 1 << 23,
};
const BONE_HIDDEN_P = 1 << 6, POSE_SELECTED = 1 << 6;
const ROTATION_MODES = { [-1]: 'AXIS_ANGLE', 0: 'QUATERNION', 1: 'XYZ', 2: 'XZY', 3: 'YXZ', 4: 'YZX', 5: 'ZXY', 6: 'ZYX' };
const rotationMode = (id) => Number(Object.keys(ROTATION_MODES).find((value) => ROTATION_MODES[value] === id));

// An armature object's data (in Edit Mode its edit bones).
export function armatureData(ob) {
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
    return { name: names[i], parent: parent >= 0 ? names[parent] : null, head, tail, roll, envelope_distance, head_radius, tail_radius, ...flags, pose };
  });
  return { bones, active: active >= 0 ? names[active] : null };
}

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
  if (floats.length !== bones.length * BONE_FLOATS) throw new Error('armature data: bones need a head and a tail');
  withArrays([ints, floats], ([i, f]) => withString(bones.map((bone) => bone.name + '\n').join(''), (names) =>
    x.armature_bones_set(bmain, ob, bones.length, i, f, names, index.get(active) ?? -1)));
}

// The depth (0 to 1) at which a click at (px, py) in a view's pixels from its top left hits the bones an armature draws
// in Object Mode, or null (armature-draw.cc armature_pick_depth). view: regionView3D's.
export function armaturePickDepth(C, ob, { viewmat, winmat, winx, winy }, px, py) {
  const depth = withArrays([Float32Array.from(viewmat), Float32Array.from(winmat)], ([v, w]) => x.armature_pick_depth(C, ob, v, w, winx, winy, px, winy - py));
  return depth < 0 ? null : depth;
}

// An armature object's bounds as View Selected frames it (armature-api.cc armature_view_bounds: its bones, in Pose Mode
// the selected ones), in world space and Babylon's axes ({ min, max }), or null.
export function armatureViewBounds(C, ob) {
  const bounds = withArrays([new Float32Array(6)], ([p]) => (x.armature_view_bounds(C, ob, p) ? Array.from(new Float32Array(x.memory.buffer, p, 6)) : null));
  if (!bounds) return null;
  const [x0, y0, z0, x1, y1, z1] = bounds;
  return { min: new Vector3(x0, z0, y0), max: new Vector3(x1, z1, y1) };
}

// The overlay's buffers (armature-draw.cc) by name, with their floats per instance: bone matrices with packed colors
// (BoneInstanceData), envelope spheres (BoneEnvelopeData), stick ends and colors (BoneStickData), lines as vertex pairs
// (VertexData), axes and degrees of freedom (ExtraInstanceData).
export const DRAW_BUFFERS = {
  sphere_fill: 16, sphere_outline: 16, octahedral_fill: 16, octahedral_outline: 16, bbones_fill: 16, bbones_outline: 16,
  envelope_fill: 20, envelope_outline: 20, envelope_distance: 20, stick: 24, wire: 16, arrows: 20,
  degrees_of_freedom_fill: 20, degrees_of_freedom_wire: 20, relations: 16,
};
// armature_draw's flags: a selection sync, X-ray or Wireframe, and the View3D overlay's relationship lines, outline of
// selected objects and text.
export const DRAW = { SELECTING: 1, TRANSPARENT: 2, SHOW_RELATIONS: 4, SHOW_OUTLINE: 8, SHOW_TEXT: 16 };
// A custom shape's passes and geometries (armature-draw.cc ShapeGeometry).
const SHAPE_PASSES = ['fill', 'outline', 'wire'];
export const SHAPE_GEOMETRY = ['surface', 'edge_detection', 'loose_edges', 'all_edges', 'plain_axes', 'single_arrow', 'cube', 'circle', 'empty_sphere', 'empty_cone', 'arrows'];

// What Blender's overlay draws of an armature object (armature-draw.cc armature_draw) in Main's context C, synced with
// `flags` (DRAW), as copies: { transparent (in the overlay's transparent passes), inFront (drawn over the scene),
// buffers (by DRAW_BUFFERS name: { data, ids }, world space in Blender's axes, a select id per instance), customs
// (custom shapes: { pass, mesh, geometry, data, ids }), texts (bone names: { co, color (sRGB bytes), name }) }.
export function armatureDraw(C, ob, flags) {
  const at = x.armature_draw(C, ob, flags) >>> 0, memory = x.memory.buffer;
  const header = new Int32Array(memory, at, 2 + Object.keys(DRAW_BUFFERS).length * 3 + 4);
  const copy = (count, data, ids, stride) => ({ data: new Float32Array(memory, data >>> 0, count * stride).slice(), ids: new Uint32Array(memory, ids >>> 0, count).slice() });
  const buffers = Object.fromEntries(Object.entries(DRAW_BUFFERS).map(([name, stride], i) => [name, copy(...header.subarray(2 + i * 3, 5 + i * 3), stride)]));
  const [customsNum, customsAt, textsNum, textsAt] = header.subarray(header.length - 4);
  const customs = Array.from({ length: customsNum }, (_, i) => {
    const [pass, mesh, geometry, count, data, ids] = new Int32Array(memory, (customsAt >>> 0) + i * 24, 6);
    return { pass: SHAPE_PASSES[pass], mesh: mesh >>> 0, geometry: SHAPE_GEOMETRY[geometry], ...copy(count, data, ids, 16) };
  });
  const texts = Array.from({ length: textsNum }, (_, i) => {
    const text = (textsAt >>> 0) + i * 20;
    return { co: Array.from(new Float32Array(memory, text, 3)), color: Array.from(new Uint8Array(memory, text + 12, 4)), name: cString(new Uint32Array(memory, text + 16, 1)[0]) };
  });
  return { transparent: !!header[0], inFront: !!header[1], buffers, customs, texts };
}

// A custom shape's mesh as its geometry draws it (armature-draw.cc armature_shape_mesh), as copies: { positions,
// normals (the surface's, per corner), indices }.
export function armatureShapeMesh(mesh, geometry) {
  const at = x.armature_shape_mesh(mesh, SHAPE_GEOMETRY.indexOf(geometry)) >>> 0, memory = x.memory.buffer;
  const [points, positions, normals, count, indices] = new Int32Array(memory, at, 5);
  return { positions: new Float32Array(memory, positions >>> 0, points * 3).slice(),
    normals: geometry === 'surface' ? new Float32Array(memory, normals >>> 0, points * 3).slice() : null, indices: new Uint32Array(memory, indices >>> 0, count).slice() };
}
