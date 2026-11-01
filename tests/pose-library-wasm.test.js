// The pose library's asset shelf as in Blender 5.2 (tools/blender-reference/pose-library-fixtures.py): in Pose Mode
// the 3D View's asset shelf is Blender's (VIEW3D_AST_pose_library), hidden until View > Asset Shelf shows it at Blender's
// height; its layout lists the pose asset Pose > Create Pose Asset made; a click on its tile applies the pose
// (the shelf's activate operator) and a drag from it blends the pose by how far the pointer goes (its drag operator,
// Blend Pose Asset, through Blender's window), each pose as Blender's.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlenderMain, datafiles } from '../src/bmesh/bmesh-wasm.js';
import { blendData, contextStruct, setContextPointer } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';
import { Window, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW, RGN_TYPE_ASSET_SHELF, RGN_TYPE_ASSET_SHELF_HEADER } from '../src/windowmanager/wm-window.js';
import { regionLayout, buttonPress, viewItemDrag, viewItemContextMenu } from '../src/editors/interface/ui-tree.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/pose-library/shelf.json', import.meta.url), 'utf8'));
await datafiles;

const main = new BlenderMain();
setContextPointer(main.C);
main.run('object.armature_add');
main.run('object.mode_set', { mode: 'EDIT' });
const ob = contextStruct().object, arm = ob.data;
for (const bone of [...arm.edit_bones]) arm.edit_bones.remove(bone);
for (const [name, head, tail, parent] of fixture.bones) {
  const bone = arm.edit_bones.new(name);
  [bone.head, bone.tail] = [head, tail];
  if (parent) [bone.parent, bone.use_connect] = [arm.edit_bones.get(parent), true];
}
main.run('object.mode_set', { mode: 'POSE' });
main.run('pose.select_all', { action: 'SELECT' });
for (const [name, rotation] of Object.entries(fixture.pose)) ob.pose.bones.get(name).rotation_quaternion = rotation;
assert.equal(main.run('poselib.create_pose_asset', { pose_name: 'Bent' }).status, 4);
main.run('pose.rot_clear');

const window = new Window(main);
const [, , winx, winy] = fixture.cases.shown.regions.WINDOW;
window.size = { width: winx, height: winy };
loadKeyconfig(main.C);
const view = window.area(SPACE_VIEW3D);
const SHELF = [RGN_TYPE_ASSET_SHELF, RGN_TYPE_ASSET_SHELF_HEADER];
const whole = { x: 0, y: 0, width: winx, height: winy };
view.layout(whole, { [RGN_TYPE_WINDOW]: whole });

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 2e-3);
const rotations = () => Object.fromEntries([...ob.pose.bones].map((b) => [b.name, [...b.rotation_quaternion]]));
const failed = [];
const compare = (name, expected) => {
  const actual = rotations();
  for (const [bone, rotation] of Object.entries(expected)) if (!near(actual[bone], rotation)) failed.push(`${name}: ${bone} ${actual[bone].map((v) => v.toFixed(5))}, Blender ${rotation}`);
};

// Hidden in Pose Mode until View > Asset Shelf shows it, at Blender's heights.
assert.deepEqual(view.regionsShown(SHELF), {}, 'the asset shelf starts hidden, as Blender creates the pose library shelf');
view.inContext(RGN_TYPE_WINDOW, () => { contextStruct().space_data.show_region_asset_shelf = true; });
// Page rectangles from the top: the shelf at the bottom of the view, its header above it.
const layout = (heights) => view.layout(whole, { [RGN_TYPE_WINDOW]: whole,
  [RGN_TYPE_ASSET_SHELF]: { x: 0, y: winy - heights[RGN_TYPE_ASSET_SHELF], width: winx, height: heights[RGN_TYPE_ASSET_SHELF] },
  [RGN_TYPE_ASSET_SHELF_HEADER]: { x: 0, y: winy - heights[RGN_TYPE_ASSET_SHELF] - heights[RGN_TYPE_ASSET_SHELF_HEADER], width: winx, height: heights[RGN_TYPE_ASSET_SHELF_HEADER] } });
// Its first layout sizes the shelf to its tiles' rows, as Blender's does.
layout(view.regionsShown(SHELF));
view.inContext(RGN_TYPE_ASSET_SHELF, (C) => regionLayout(C));
const heights = view.regionsShown(SHELF), { ASSET_SHELF: shelf, ASSET_SHELF_HEADER: header } = fixture.cases.shown.regions;
assert.deepEqual(heights, { [RGN_TYPE_ASSET_SHELF]: shelf[3], [RGN_TYPE_ASSET_SHELF_HEADER]: header[3] }, 'View > Asset Shelf shows it at Blender\'s heights');
layout(heights);

// The shelf's grid: the pose asset's tile (a grid view's item named after the pose, with its preview) once the window's
// job has read the asset library, as Blender's reads it.
const buttons = (node) => (node.kind === 'button' ? [node] : (node.children ?? []).flatMap(buttons));
const tiles = () => view.inContext(RGN_TYPE_ASSET_SHELF, (C) => regionLayout(C)).flatMap(buttons);
for (let i = 0; i < 50 && !tiles().length && window.pending; i++) {
  await new Promise((done) => setTimeout(done, 20));
  window.tick();
}
const tile = () => tiles().find((b) => b.type === 'VIEW_ITEM' && b.label === 'Bent');
assert.ok(tile() && tiles().some((b) => b.type === 'PREVIEW_TILE'), 'the shelf shows the pose asset');

assert.ok(view.inContext(RGN_TYPE_ASSET_SHELF, (C) => buttonPress(C, tile())) >= 0);
compare('click', fixture.cases.click.rotations);

// A drag starts once the pointer leaves the press (its first move): the shelf's drag operator, invoked from there as the
// page's window manager invokes it, then blends by the pointer's way from there until the release. Events are in the
// shelf's pixels, which are the 3D View's here (the shelf at its bottom).
main.run('pose.rot_clear');
const [, , ...moves] = fixture.cases.drag.events;
const release = moves.pop();
const call = view.inContext(RGN_TYPE_ASSET_SHELF, (C) => viewItemDrag(C, tile()));
assert.equal(call?.operator, 'poselib.blend_pose_asset', 'a drag starts Blend Pose Asset');
const properties = Object.fromEntries(Object.entries(call.properties).filter(([, value]) => value !== null));
const event = ([type, value, x, y]) => ({ type, value, x, y });
const { op } = view.inContext(RGN_TYPE_WINDOW, () => main.invoke(call.operator, properties, event(['LEFTMOUSE', 'PRESS', ...moves[0].slice(2)])));
assert.ok(op, 'Blend Pose Asset runs modally');
view.inContext(RGN_TYPE_WINDOW, () => [...moves.slice(1), release].forEach((e) => main.modal(op, event(e))));
compare('drag', fixture.cases.drag.rotations);

// Its context menu: the pose library's own entries (Apply Pose, Apply Pose Flipped, Blend Pose, Select Pose Bones, ...).
const menu = view.inContext(RGN_TYPE_ASSET_SHELF, (C) => viewItemContextMenu(C, tile())).children.flatMap(buttons);
assert.ok(['Apply Pose', 'Apply Pose Flipped', 'Blend Pose', 'Select Pose Bones'].every((text) => menu.some((b) => b.text === text)), 'the tile\'s context menu is the pose library\'s');

assert.deepEqual(failed, [], 'poses that differ from Blender\'s');

// Pose > Create Pose Asset as the page invokes it: Blender's dialog, with Current File as its library (Bylonder has no
// User Library on disk), so a pose asset lives in the project's file.
const dialog = main.invoke('poselib.create_pose_asset', { asset_library_reference: 'LOCAL' }, { type: 'LEFTMOUSE', value: 'PRESS', x: 0, y: 0 });
assert.equal(dialog.popup?.type, 'PROPS', 'Create Pose Asset opens its dialog');
assert.ok(dialog.popup.text.includes('"text":"Current File"') && dialog.popup.text.includes('"prop":"pose_name"'), 'the dialog asks a name and saves into the Current File');
main.finishPopup(dialog.dialog, false);

// A pose asset in the Current File survives a .blend save and reopening, and applies there.
const reopened = new BlenderMain();
reopened.readBlend(main.writeBlend('/poses.blend'));
setContextPointer(reopened.C);
assert.ok(blendData().actions.get('Bent')?.asset_data, 'the pose asset is in the saved file');
reopened.run('object.mode_set', { mode: 'POSE' });
reopened.run('pose.select_all', { action: 'SELECT' });
reopened.run('pose.rot_clear');
assert.equal(reopened.run('poselib.apply_pose_asset', { asset_library_type: 'LOCAL', asset_library_identifier: '', relative_asset_identifier: 'Action/Bent' }).status, 4);
const root = contextStruct().object.pose.bones.get('Root');
assert.ok(near([...root.rotation_quaternion], fixture.cases.click.rotations.Root), 'the reopened pose asset applies');
console.log('pose library: the asset shelf shows as Blender shows it; a click on a pose applies it and a drag blends it as Blender does');
