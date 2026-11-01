import assert from 'node:assert/strict';
import fs from 'node:fs';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import { hasArmatures, armatureDraw, DRAW, DRAW_BUFFERS } from '../src/blenkernel/armature/armature.js';
import { idStruct } from '../src/python/bpy_rna.js';

// What Blender's armature overlay draws (overlay_armature.cc in the module, armature-draw.cc), per display type and
// mode, against Blender 5.2's own data for the same rig (tools/blender-reference/armature-draw-fixtures.py): three bones,
// the middle one a curved B-Bone of four segments, the last one unconnected, posed, with names and axes shown.
if (!hasArmatures) {
  console.log('Armature drawing: skipped, this module has no armature-api.cc');
  process.exit(0);
}
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/armature-draw.json', import.meta.url)));
const blender = blenderMain();
const ID_OB = 0x424f;
const before = new Set(blender.ids(ID_OB));
blender.run('object.armature_add');
const ob = blender.ids(ID_OB).find((id) => !before.has(id)), arm = idStruct(blender.data(ob));
// Values set through RNA, with the object and its data tagged as RNA's updates tag them, and evaluated.
const set = (fn) => { fn(); blender.tag(ob); blender.tag(blender.data(ob)); blender.evaluate(); };
blender.run('object.mode_set', { mode: 'EDIT' });
for (let i = 0; i < 2; i++) {
  blender.run('armature.extrude', { forked: false });
  blender.run('transform.translate', { value: [0, 0.5, 1] });
}
set(() => Object.assign(arm.edit_bones.get('Bone.002'), { use_connect: false, head: [0, 0.5, 2.2] }));
blender.run('object.mode_set', { mode: 'OBJECT' });
set(() => {
  Object.assign(arm.bones.get('Bone.001'), { bbone_segments: 4, bbone_curveinx: 0.3, bbone_curveoutz: -0.2 });
  Object.assign(arm, { show_names: true, show_axes: true });
});
blender.run('object.mode_set', { mode: 'POSE' });
blender.run('pose.select_all', { action: 'DESELECT' });
set(() => {
  idStruct(ob).pose.bones.get('Bone.001').select = true;
  arm.bones.active = arm.bones.get('Bone.001');
});
blender.run('transform.rotate', { value: 0.6, orient_axis: 'X', orient_type: 'GLOBAL' });
blender.evaluate();

const failed = [];
const check = (label, actual, wanted, tolerance = 2e-4) => {
  const a = [actual].flat(3), w = [wanted].flat(3);
  if (a.length !== w.length || a.some((v, i) => !(Math.abs(v - w[i]) < tolerance))) failed.push(`${label}: ${a.map((v) => (typeof v === "number" ? +v.toFixed(4) : v))}, Blender ${w}`);
};
const columns = (m, at = 0) => [0, 1, 2, 3].map((c) => Array.from(m.slice(at + c * 4, at + c * 4 + 3)));
const apply = (m, [x, y, z], w = 1) => [0, 1, 2].map((i) => m[0][i] * x + m[1][i] * y + m[2][i] * z + (w ? m[3][i] : 0));
const world = expected.matrix_world;
const pose = expected.pose, poseMatrix = (bone) => bone.matrix.map((c, i) => (i < 3 ? apply(world, c, 0) : apply(world, c)));
// overlay_common_lib.glsl extract_matrix_packed_data: two colors, a byte a channel, in the matrix's fourth row.
const packed = (data, at) => [3, 7, 11, 15].flatMap((k) => [data[at + k] & 0xff, data[at + k] >> 8]).map((v) => v / 255);
// draw_cache: Blender's sRGB theme colors as the overlay reads them, linear.
const linear = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const sync = (mode, flags = DRAW.SHOW_RELATIONS | DRAW.SHOW_TEXT | DRAW.SHOW_OUTLINE) => {
  if (blender.mode(ob) !== mode) blender.run('object.mode_set', { mode });
  blender.evaluate();
  return armatureDraw(blender.C, ob, flags);
};
const displayType = (type) => set(() => { arm.display_type = type; });

// Pose Mode, Octahedral: each bone's octahedron at its pose matrix scaled by its length, solid in the theme's bone
// color (the selected active bone's state in Bone Pose Active), joints at heads and tails, names and axes.
let drawn = sync('POSE');
check('octahedra', drawn.buffers.octahedral_fill.ids.length, 3);
pose.forEach((bone, i) => {
  const m = poseMatrix(bone), got = columns(drawn.buffers.octahedral_fill.data, i * 16);
  check(`${bone.name} octahedron`, got, [...m.slice(0, 3).map((c) => c.map((v) => v * bone.length)), m[3]]);
});
const [state, solid] = [packed(drawn.buffers.octahedral_fill.data, 16).slice(0, 4), packed(drawn.buffers.octahedral_fill.data, 16).slice(4)];
check('bone solid color', solid.slice(0, 3), linear(expected.theme.bone_solid), 1 / 255 + 1e-3);
check('active bone outline color', packed(drawn.buffers.octahedral_outline.data, 16).slice(4, 7), linear(expected.theme.bone_pose_active), 1 / 255 + 1e-3);
check('active bone hint color', state.slice(0, 3), linear(expected.theme.bone_pose_active).map((c) => c * c * 0.1), 1 / 255 + 1e-3);
check('names', drawn.texts.length, 3);
pose.forEach((bone, i) => check(`${bone.name} name`, drawn.texts[i].co, apply(world, bone.head.map((h, k) => (h + bone.tail[k]) / 2))));
assert.deepEqual(drawn.texts.map((t) => t.name), pose.map((b) => b.name));
check('axes', drawn.buffers.arrows.ids.length, 3);
check('joints (the connected bone has no head)', drawn.buffers.sphere_fill.ids.length, 5);
// Pose Mode draws a parent line only for an unconnected bone whose parent or itself is selected: here Bone.002's, from
// its parent's tail.
check('relationship lines', drawn.buffers.relations.ids.length, 1);
check('relationship line', [drawn.buffers.relations.data.subarray(0, 3), drawn.buffers.relations.data.subarray(8, 11)].map((v) => Array.from(v)),
  [apply(world, pose[1].tail), apply(world, pose[2].head)]);

// B-Bone: Bone.001's four segments start at Blender's B-Bone segment points and run to the next, their width the bone's.
displayType('BBONE');
drawn = sync('POSE');
check('B-Bone boxes', drawn.buffers.bbones_fill.ids.length, 6);
const bbone = pose[1], bboneMatrix = poseMatrix(bbone);
for (let k = 0; k < 4; k++) {
  const [x, y, , origin] = columns(drawn.buffers.bbones_fill.data, (1 + k) * 16), [from, to] = [bbone.bbone_points[k], bbone.bbone_points[k + 1]].map((p) => apply(bboneMatrix, p));
  const direction = to.map((v, i) => v - from[i]), length = Math.hypot(...direction);
  check(`B-Bone segment ${k} start`, origin, from);
  check(`B-Bone segment ${k} direction`, y.map((v) => v / Math.hypot(...y)), direction.map((v) => v / length), 2e-3);
  check(`B-Bone segment ${k} width`, Math.hypot(...x), bbone.bbone_x);
}
check('B-Bone joints are drawn in Edit Mode only', drawn.buffers.sphere_fill.ids.length, 0);

// Wire: a line per B-Bone segment, from its start along it, a segment's length long.
displayType('WIRE');
drawn = sync('POSE');
check('wire lines', drawn.buffers.wire.ids.length, 6);
{
  const [from, next] = [bbone.bbone_points[0], bbone.bbone_points[1]].map((p) => apply(bboneMatrix, p)), along = next.map((v, i) => v - from[i]);
  const step = bbone.length / 4 / Math.hypot(...along);
  check('wire segment', [drawn.buffers.wire.data.subarray(16, 19), drawn.buffers.wire.data.subarray(24, 27)].map((v) => Array.from(v)),
    [from, from.map((v, i) => v + along[i] * step)]);
}

// Stick: from each bone's head to its tail.
displayType('STICK');
drawn = sync('POSE');
check('sticks', drawn.buffers.stick.ids.length, 3);
pose.forEach((bone, i) => check(`${bone.name} stick`, [drawn.buffers.stick.data.subarray(i * 24, i * 24 + 3), drawn.buffers.stick.data.subarray(i * 24 + 4, i * 24 + 7)].map((v) => Array.from(v)),
  [apply(world, bone.head), apply(world, bone.tail)]));

// Envelope: each bone's capsule between its head and tail spheres, the selected bone's distance around it.
displayType('ENVELOPE');
drawn = sync('POSE');
check('envelopes', drawn.buffers.envelope_fill.ids.length, 3);
check('envelope distance of the selected bone', drawn.buffers.envelope_distance.ids.length, 1);
const distance = drawn.buffers.envelope_distance.data;
check('envelope distance spheres', [distance[3], distance[7]], [pose[0].tail_radius + bbone.envelope_distance, bbone.tail_radius + bbone.envelope_distance]);

// Object Mode: joints filled without outlines, no relationship lines.
displayType('OCTAHEDRAL');
drawn = sync('OBJECT', DRAW.SHOW_RELATIONS);
check('Object Mode octahedra', drawn.buffers.octahedral_fill.ids.length, 3);
check('Object Mode joints', [drawn.buffers.sphere_fill.ids.length, drawn.buffers.sphere_outline.ids.length], [5, 0]);
check('Object Mode relationship lines', drawn.buffers.relations.ids.length, 0);

// Edit Mode: the edit bones' matrices, joints with their selection, every unconnected child's parent line.
drawn = sync('EDIT');
expected.edit.forEach((bone, i) => {
  const m = bone.matrix.map((c, k) => (k < 3 ? apply(world, c, 0) : apply(world, c)));
  check(`${bone.name} edit octahedron`, columns(drawn.buffers.octahedral_fill.data, i * 16), [...m.slice(0, 3).map((c) => c.map((v) => v * bone.length)), m[3]]);
});
check('Edit Mode joints', drawn.buffers.sphere_fill.ids.length, 5);
check('Edit Mode relationship lines', drawn.buffers.relations.ids.length, 1);
// Each joint's outline in the vertex color, or the vertex select color as Blender selected it (a selection sync draws
// the same instances, with ids).
const joints = drawn.buffers.sphere_outline, jointIds = sync('EDIT', DRAW.SELECTING).buffers.sphere_outline.ids;
jointIds.forEach((id, i) => {
  const bone = expected.edit[(id & 0x1fffffff) >>> 16], selected = id & (1 << 29) ? bone.select_head : bone.select_tail;
  check(`${bone.name} ${id & (1 << 29) ? 'head' : 'tail'} joint color`, packed(joints.data, i * 16).slice(4, 7), linear(expected.theme[selected ? 'vertex_select' : 'vertex']), 1 / 255 + 1e-3);
});
// Selection syncs give each part its id: the bone's index and BONESEL_BONE, ROOT or TIP.
const ids = sync('EDIT', DRAW.SELECTING).buffers;
assert.deepEqual([...ids.octahedral_fill.ids].map((id) => [(id & 0x1fffffff) >>> 16, id >>> 31]), [[0, 1], [1, 1], [2, 1]]);
assert.ok([...ids.sphere_fill.ids].every((id) => id & (3 << 29)), 'joints are heads and tails');
assert.equal(Object.keys(DRAW_BUFFERS).length, 15);

// A hidden edit bone is hidden in Edit Mode only, a hidden pose bone in Pose Mode only.
set(() => { arm.edit_bones.get('Bone.002').hide = true; });
check('a hidden edit bone', sync('EDIT').buffers.octahedral_fill.ids.length, 2);
check('shows in Pose Mode', sync('POSE').buffers.octahedral_fill.ids.length, 3);
set(() => { idStruct(ob).pose.bones.get('Bone.001').hide = true; });
check('a hidden pose bone', sync('POSE').buffers.octahedral_fill.ids.length, 2);

blender.run('object.mode_set', { mode: 'OBJECT' });
assert.deepEqual(failed, [], 'Armature drawing that differs from Blender');
console.log('Armature drawing: Octahedral, B-Bone (segments as Blender evaluates them), Wire, Stick and Envelope in Object, Edit and Pose Mode match Blender 5.2; names, axes, relationship lines, hidden bones, selection ids');
