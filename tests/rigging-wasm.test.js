import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BlenderMain, blenderModule, OPERATOR_FINISHED, OPERATOR_CANCELLED } from '../src/bmesh/bmesh-wasm.js';
import { registered, module } from '../src/python/bpy_interface.js';
import { setContextPointer, contextStruct, blendData, pointerStruct, structFind } from '../src/python/bpy_rna.js';
import { AnimArea, RGN_TYPE_WINDOW, RGN_TYPE_HEADER, RGN_TYPE_CHANNELS, SPACE_GRAPH, GRAPH_MODES, ACHANNEL_SETTING } from '../src/editors/animation/anim-area.js';
import { regionPanels, panelClosedSet } from '../src/editors/interface/ui-tree.js';
import { hasArmatures } from '../src/blenkernel/armature/armature.js';

// Rigging in Pose Mode as Blender 5.2 does it (tools/blender-reference/rigging-fixtures.py): the pose operators (clears,
// copy and paste, Apply Pose as Rest Pose), bone collections, bone colors, selection sets and constraints, Blender's
// Python operators among them, and keying pose bones with keying sets, the F-Curves and the pose they evaluate to. Then
// the Properties editor's Armature, Bone and Bone Constraints tabs as Blender's panels lay them out, and the 3D View's
// armature tools.
if (!hasArmatures) {
  console.log('Rigging: skipped, this module has no armature-api.cc');
  process.exit(0);
}
const STATUS = { FINISHED: OPERATOR_FINISHED, CANCELLED: OPERATOR_CANCELLED };
const blender = new BlenderMain();
setContextPointer(blender.C);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
blender.view = { viewmat: identity, winmat: identity, winx: 100, winy: 100, persp: false };

const r = (values) => Array.from(values, (v) => Math.round(v * 1e5) / 1e5);
const listOf = (collection) => Array.from({ length: collection.length }, (_, i) => collection[i]);
function state(ob) {
  const arm = ob.data;
  const bones = listOf(arm.bones).map((b) => ({ name: b.name, head: r(b.head_local), tail: r(b.tail_local), collections: listOf(b.collections).map((c) => c.name),
    color: b.color.palette }));
  const pose = listOf(ob.pose.bones).map((p) => ({ name: p.name, location: r(p.location), rotation_quaternion: r(p.rotation_quaternion), scale: r(p.scale),
    select: p.select, color: p.color.palette, constraints: listOf(p.constraints).map((c) => [c.type, c.name]) }));
  const collections = listOf(arm.collections_all).map((c) => ({ name: c.name, is_visible: c.is_visible, is_solo: c.is_solo }));
  const selection_sets = listOf(ob.selection_sets).map((s) => ({ name: s.name, bones: listOf(s.bone_ids).map((b) => b.name) }));
  const ad = ob.animation_data, bag = ad?.action && ad.action.layers[0].strips[0].channelbag(ad.action_slot);
  const fcurves = bag ? listOf(bag.fcurves).map((f) => ({ data_path: f.data_path, index: f.array_index, group: f.group?.name ?? null,
    keys: listOf(f.keyframe_points).map((k) => r(k.co)) })) : [];
  return { mode: ob.mode, bones, pose, collections, selection_sets, active_selection_set: ob.active_selection_set,
    constraints: listOf(ob.constraints).map((c) => [c.type, c.name]), fcurves };
}

const near = (a, b) => (Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((v, i) => near(v, b[i]))
  : a && typeof a === 'object' ? b && typeof b === 'object' && Object.keys(a).every((k) => near(a[k], b[k]))
    : typeof a === 'number' ? Math.abs(a - b) < 1e-3 : a === b);
const failed = [];
const dir = new URL('./fixtures/rigging/', import.meta.url);
const files = fs.readdirSync(dir).sort();
const data = () => blendData();
for (const file of files) {
  const { steps } = JSON.parse(fs.readFileSync(new URL(file, dir)));
  // As Blender's factory settings: no objects, frame 1.
  for (const ob of listOf(data().objects)) data().objects.remove(ob);
  contextStruct().scene.frame_set(1);
  steps.forEach(({ step, result, ...expected }, i) => {
    const label = `${file.replace('.json', '')} ${i} ${step.slice(1).map((s) => JSON.stringify(s)).join(' ')}`;
    const ob = data().objects.get('Armature');
    if (step[0] === 'op') {
      const { status } = blender.run(step[1], step[2]);
      if (status !== STATUS[result[0]]) failed.push(`${label}: status ${status}, Blender ${result}`);
    } else if (step[0] === 'set') {
      const [, path, name, value] = step;
      const owner = path ? ob.path_resolve(path) : ob;
      owner[name] = typeof value === 'string' && value.startsWith('data.') ? ob.path_resolve(value) : value;
    } else {
      contextStruct().scene.frame_set(step[1]);
      blender.evaluate();
    }
    const actual = state(data().objects.get('Armature'));
    for (const key of Object.keys(expected)) if (!near(expected[key], actual[key])) failed.push(`${label}: ${key} ${JSON.stringify(actual[key])}, Blender ${JSON.stringify(expected[key])}`);
  });
}
assert.deepEqual(failed, [], 'Rigging results that differ from Blender');

// The Properties editor: Blender's panels of the Armature, Bone and Bone Constraints tabs over the armature in Pose and
// Edit Mode, with the properties Blender's Python draws.
const area = new AnimArea(blender, 4);
const space = pointerStruct(structFind('SpaceProperties'), 0, blenderModule.exports.anim_area_space(area.pointer) >>> 0);
area.layout(RGN_TYPE_WINDOW, 0, 0, 400, 4000);
area.layout(RGN_TYPE_HEADER, 0, 4000, 400, 26);
const buttons = (node) => (node.kind === 'button' ? [node] : (node.children ?? []).flatMap(buttons));
const panels = () => area.inContext(RGN_TYPE_WINDOW, (C) => regionPanels(C)).panels;
const flat = (list) => list.flatMap((panel) => [panel, ...flat(panel.children ?? [])]);
function tab(context) {
  panels();
  space.context = context;
  for (const panel of flat(panels())) area.inContext(RGN_TYPE_WINDOW, (C) => panelClosedSet(C, panel.id, false));
  for (const panel of flat(panels())) area.inContext(RGN_TYPE_WINDOW, (C) => panelClosedSet(C, panel.id, false));
  return Object.fromEntries(flat(panels()).map((panel) => [panel.id, panel.parts.flatMap((part) => buttons(part.layout)).map((b) => b.rna?.prop ?? (b.operator && 'op:' + b.operator)).filter(Boolean)]));
}
const has = (drawn, id, props) => {
  assert.ok(drawn[id], `${id} draws`);
  for (const prop of props) assert.ok(drawn[id].includes(prop), `${id} shows ${prop}`);
};
blender.run('object.mode_set', { mode: 'POSE' });
blender.run('pose.constraint_add', { type: 'IK' });
blender.run('object.constraint_add', { type: 'COPY_LOCATION' });
let drawn = tab('DATA');
has(drawn, 'DATA_PT_pose', ['pose_position']);
has(drawn, 'DATA_PT_bone_collections', ['is_visible', 'is_solo', 'op:armature.collection_add', 'op:armature.collection_remove', 'op:armature.collection_move',
  'op:armature.collection_assign', 'op:armature.collection_unassign', 'op:armature.collection_select', 'op:armature.collection_deselect']);
has(drawn, 'DATA_PT_display', ['display_type', 'show_names', 'show_bone_custom_shapes', 'show_bone_colors', 'show_in_front', 'show_axes']);
has(drawn, 'DATA_PT_iksolver_itasc', ['ik_solver']);
has(drawn, 'DATA_PT_motion_paths', ['op:pose.paths_calculate']);
has(drawn, 'POSE_PT_selection_sets', ['op:pose.selection_set_add', 'op:pose.selection_set_assign', 'op:pose.selection_set_select']);
has(drawn, 'DATA_PT_custom_props_arm', ['op:wm.properties_add']);
drawn = tab('BONE');
has(drawn, 'BONE_PT_transform', ['location', 'rotation_quaternion', 'rotation_mode', 'scale']);
has(drawn, 'BONE_PT_curved', ['bbone_segments', 'bbone_easein']);
has(drawn, 'BONE_PT_relations', ['parent', 'use_connect']);
has(drawn, 'BONE_PT_collections', ['is_visible', 'op:armature.collection_unassign_named']);
has(drawn, 'BONE_PT_inverse_kinematics', ['lock_ik_x', 'ik_stretch']);
has(drawn, 'BONE_PT_deform', ['use_deform', 'envelope_distance', 'head_radius']);
has(drawn, 'BONE_PT_display', ['hide', 'display_type', 'palette', 'op:armature.copy_bone_color_to_selected']);
has(drawn, 'BONE_PT_display_custom_shape', ['custom_shape', 'custom_shape_scale_xyz']);
has(drawn, 'BONE_PT_custom_props', ['op:wm.properties_add']);
drawn = tab('BONE_CONSTRAINT');
has(drawn, 'BONE_PT_constraints', []);
has(drawn, 'BONE_PT_bKinematicConstraint', ['target', 'pole_target', 'chain_count', 'op:constraint.delete', 'influence']);
drawn = tab('CONSTRAINT');
has(drawn, 'OBJECT_PT_bLocateLikeConstraint', ['target', 'use_offset', 'owner_space', 'influence']);
blender.run('object.mode_set', { mode: 'EDIT' });
drawn = tab('BONE');
has(drawn, 'BONE_PT_transform', ['head', 'tail', 'roll', 'length', 'lock']);
has(drawn, 'BONE_PT_relations', ['parent', 'use_connect']);

// A keyed pose bone's F-Curves are listed in the Graph Editor under the bone's group, as Blender lists them.
blender.run('object.mode_set', { mode: 'POSE' });
blender.run('pose.select_all', { action: 'SELECT' });
blender.run('anim.keyframe_insert');
const graph = new AnimArea(blender, SPACE_GRAPH, GRAPH_MODES.FCURVES);
graph.layout(RGN_TYPE_CHANNELS, 0, 0, 200, 2000);
graph.layout(RGN_TYPE_WINDOW, 200, 0, 600, 2000);
for (let depth = 0; depth < 3; depth++) for (const channel of graph.channels()) graph.channelSetting(channel.index, ACHANNEL_SETTING.EXPAND, 1);
assert.deepEqual(graph.channels().filter((c) => !c.name.startsWith('ArmatureAction')).slice(0, 4).map((c) => c.name), ['Armature', 'Bone', 'X Location (Bone)', 'Y Location (Bone)']);
assert.ok(graph.channels().some((c) => c.name === 'W Quaternion Rotation (Bone.001)'), 'every selected bone is keyed in its group');

// The 3D View's armature tools: Blender's tools of Edit Mode and Pose Mode, each with its icon.
const { VIEW3D_PT_tools_active: tools } = registered;
const toolIcons = (mode) => [...tools.tools_from_context({ mode })].flatMap((item) => [item ?? []].flat()).map((tool) => tool.icon);
const pose = toolIcons('POSE'), edit = toolIcons('EDIT_ARMATURE');
assert.ok(['ops.pose.breakdowner', 'ops.pose.push', 'ops.pose.relax'].every((icon) => pose.includes(icon)), 'Pose Mode has the pose tools');
for (const icon of [...pose, ...edit]) assert.ok(fs.existsSync(new URL(`../public/icons/blender/tools/${icon}.svg`, import.meta.url)), `${icon} has its icon`);
assert.ok(module('keyingsets_builtins'), 'the keying sets are registered');

console.log(`Rigging: ${files.length} cases match Blender 5.2 (pose clears, copy and paste, apply as rest, bone collections, colors, selection sets, constraints, keying pose bones); Armature, Bone and constraint panels; armature tools`);
