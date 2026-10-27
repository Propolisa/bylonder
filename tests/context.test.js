// The context and RNA boundary (blenkernel/context.js, makesrna/rna-bylonder.js): Blender's own 3D View menus draw in
// Object and Edit Mode from the context built over a Babylon scene, and bound properties read and write through in
// Blender's axes.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, TransformNode, Vector3, Camera } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA, propBinding } from '../src/makesrna/rna-bylonder.js';
import { createContext } from '../src/blenkernel/context.js';
import { drawMenu } from '../src/editors/interface/ui-layout.js';
import { menuUI, menuClasses } from '../src/windowmanager/wm-operators.js';
import * as spaceView3d from '../src/bl_ui/space_view3d.js';
import { registerObjectOperators } from '../src/editors/object/object-operators.js';
import * as dataModifier from '../src/bl_ui/properties_data_modifier.js';

const engine = new NullEngine(), scene = new Scene(engine);
const cube = MeshBuilder.CreateBox('Cube', { size: 2 }, scene), empty = new TransformNode('Empty', scene);
cube.metadata = { wbId: 'cube' };
const objects = [cube, empty];
objects.scene = scene;
const world = { scene, objects, animation: createAnimationModel() };
world.sceneSettings = createSceneSettings(world);
world.renderSettings = createRenderSettings(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
// Edit Mode as editors/object/object-edit.js gives it.
world.editMode = { object: null, selectmode: 1, get active() { return !!this.object; }, get stats() { return this.object && { verts: [8, 8], edges: [12, 12], faces: [6, 6] }; } };
const selection = createSelection(scene, objects);
const updates = [], undo = [];
const host = { world, selection, update: (struct, name) => updates.push(`${struct}.${name}`), undoPush: (name) => undo.push(name) };
const view = { state: { shading: 'solid', overlays: true, cameraView: false }, editorCamera: { mode: Camera.PERSPECTIVE_CAMERA }, sync() {} };
const r = createRNA(host);
const context = () => createContext(r, { space: view });

// Stub operators: every one supported and enabled, so every entry and submenu draws.
const ui = { ...menuUI({ menus: menuClasses(spaceView3d, dataModifier), context, prop: propBinding(host) }), supported: () => true, poll: () => true, run: () => {}, keys: () => undefined };
function drawAll() {
  const ids = new Set();
  const walk = (items, depth) => items.forEach((item) => {
    if (item === '-') return;
    ids.add(item.blender);
    item.enabled?.();
    item.checked?.();
    void item.keys;
    if (item.items && depth < 6) walk(typeof item.items === 'function' ? item.items() : item.items, depth + 1);
  });
  const top = drawMenu('VIEW3D_MT_editor_menus', ui);
  walk(top, 0);
  return { top: top.filter((item) => item !== '-').map((item) => item.blender), ids };
}

selection.replace([cube]);
const object = drawAll();
assert.deepEqual(object.top, ['VIEW3D_MT_view', 'VIEW3D_MT_select_object', 'VIEW3D_MT_add', 'VIEW3D_MT_object']);
assert.ok(object.ids.has('VIEW3D_MT_object_apply') && object.ids.has('VIEW3D_MT_mesh_add') && object.ids.has('object.delete'));
world.editMode.object = cube;
const edit = drawAll();
assert.ok(['VIEW3D_MT_view', 'VIEW3D_MT_select_edit_mesh', 'VIEW3D_MT_mesh_add', 'VIEW3D_MT_edit_mesh', 'VIEW3D_MT_edit_mesh_vertices', 'VIEW3D_MT_edit_mesh_edges', 'VIEW3D_MT_edit_mesh_faces'].every((id) => edit.top.includes(id)));
assert.ok(edit.ids.has('mesh.extrude_region_move') || edit.ids.has('VIEW3D_MT_edit_mesh_extrude'));

const c = context();
assert.equal(c.mode, 'EDIT_MESH');
assert.equal(c.edit_object, c.active_object, 'one struct per object');
assert.deepEqual([...c.edit_object.data.count_selected_items()], [8, 12, 6]);
world.editMode.object = null;
assert.equal(context().mode, 'OBJECT');
assert.equal(context().edit_object, null);
assert.equal(context().sculpt_object, null, 'context members the editor lacks are None');

// Object transforms in Blender's axes: Babylon's (x, y, z) is Blender's (x, z, y).
const ob = c.object;
assert.equal(ob.type, 'MESH');
assert.equal(ob.py_metatype, 'MESH', 'Transcrypt renames type');
ob.location = [1, 2, 3];
assert.deepEqual(cube.position.asArray(), [1, 3, 2]);
ob.location[2] = 5;
assert.equal(cube.position.y, 5);
assert.equal(ob.location.z, 5);
ob.scale.y = 4;
assert.equal(cube.scaling.z, 4);
assert.throws(() => { ob.type = 'EMPTY'; }, TypeError, 'read-only');
// Babylon's Euler rotation is Blender's YXZ order: applied Y, X, then Z about Blender's axes.
ob.rotation_euler = [0.3, -0.7, 1.1];
assert.equal(ob.rotation_mode, 'YXZ');
ob.location = [0, 0, 0];
ob.scale = [1, 1, 1];
const [x, y, z] = [...ob.rotation_euler];
const rot = (axis, a) => (v) => { const [i, j] = [[1, 2], [2, 0], [0, 1]][axis], out = [...v], s = Math.sin(a), k = Math.cos(a); out[i] = k * v[i] - s * v[j]; out[j] = s * v[i] + k * v[j]; return out; };
const blender = rot(2, z)(rot(0, x)(rot(1, y)([1, 2, 3])));
const babylon = Vector3.TransformCoordinates(new Vector3(1, 3, 2), cube.computeWorldMatrix(true));
[babylon.x, babylon.z, babylon.y].forEach((value, i) => assert.ok(Math.abs(value - blender[i]) < 1e-6, 'rotation in Blender axes'));
const [w, ...xyz] = [...ob.rotation_quaternion];
assert.ok(Math.abs(Math.hypot(w, ...xyz) - 1) < 1e-9);
ob.rotation_quaternion = [w, ...xyz];
[...ob.rotation_euler].forEach((value, i) => assert.ok(Math.abs(value - [x, y, z][i]) < 1e-9, 'quaternion round trip'));
ob.select_set(false);
assert.equal(selection.has(cube), false);
assert.equal(context().object, null);
ob.select_set(true);

// Scene, tool settings, render and units write into Bylonder's slices; unbound properties read as Blender's defaults.
const s = c.scene;
s.frame_current = 42;
assert.equal(world.animation.time.frame, 42);
assert.equal(s.frame_end, 250);
s.tool_settings.mesh_select_mode = [false, true, true];
assert.equal(world.editMode.selectmode, 6);
c.tool_settings.mesh_select_mode[0] = true;
assert.equal(world.editMode.selectmode, 7);
assert.deepEqual([...c.tool_settings.mesh_select_mode], [true, true, true]);
assert.equal(c.tool_settings.use_snap, false, 'unbound: Blender default');
assert.equal(s.render.resolution_x, 1920);
s.render.resolution_percentage = 50;
assert.equal(world.renderSettings.state.render.resolutionPercentage, 50);
s.unit_settings.scale_length = 2;
assert.equal(world.sceneSettings.state.unitSettings.scale, 2);
assert.equal(s.render.image_settings.file_format, 'PNG', 'never-None pointer: Blender defaults');
assert.equal(s.objects.length, 2);
world.modifiers.add(cube);
assert.equal(ob.modifiers[0].type, 'NODES');
assert.equal(ob.modifiers.get('Array (Nodes)'), ob.modifiers[0]);

// The 3D Viewport's shading and overlays; layout.prop edits are undo steps.
assert.equal(c.space_data.shading.type, 'SOLID');
c.space_data.shading.type = 'WIREFRAME';
assert.equal(view.state.shading, 'wire');
assert.equal(c.space_data.overlay.show_floor, true, 'unbound: Blender default');
assert.equal(c.region_data.view_perspective, 'PERSP');
const overlays = propBinding(host)(c.space_data.overlay, 'show_overlays');
overlays.set(!overlays.get());
assert.equal(view.state.overlays, false);
assert.equal(propBinding(host)(c.space_data.overlay, 'show_floor'), null, 'unbound properties are not shown');
assert.deepEqual(undo, ['Show Overlays']);
assert.ok(['Object.location', 'Scene.frame_current', 'ToolSettings.mesh_select_mode', 'View3DOverlay.show_overlays'].every((u) => updates.includes(u)));

// Blender's Object menu runs Bylonder's actions by the operators they name, and leaves out what they do not run.
const ran = [];
const action = (id, blender, keys = []) => ({ id, blender, label: id, keys, run: () => ran.push(id) });
const registry = {
  actions: [action('delete', 'object.delete', ['X', 'Delete']), action('parent', ['object.parent_set', 'object.parent_set:OBJECT'], ['Ctrl+P']),
    action('hide', 'object.hide_view_set'), action('hide-others', 'object.hide_view_set'), action('rename', 'TOPBAR_PT_name'),
    action('group'), action('ungroup'), action('edit-text'), action('creation', 'screen.redo_last')],
  invoke(id) { this.actions.find((a) => a.id === id).run(); },
};
registerObjectOperators(registry);
const keymaps = () => ['Object Mode', 'Object Non-modal', '3D View', '3D View Generic', 'Frames', 'Screen', 'Window'];
const objectMenu = drawMenu('VIEW3D_MT_object', menuUI({ menus: menuClasses(spaceView3d), context, prop: propBinding(host), keymaps }));
const entry = (items, label) => items.find((item) => item.label === label);
assert.equal(entry(objectMenu, 'Delete').keys, 'X');
assert.equal(entry(objectMenu, 'Delete Global').enabled(), false, 'use_global is not run: shown, greyed out');
assert.deepEqual(['Join', 'Delete Global', 'Apply', 'Link/Transfer Data'].map((label) => entry(objectMenu, label).keys), ['Ctrl J', 'Shift X', 'Ctrl A', 'Ctrl L'], "shortcuts from Blender's keymap");
assert.equal(entry(objectMenu, 'Join').enabled(), false, 'what Bylonder lacks is shown, greyed out');
const parentMenu = entry(objectMenu, 'Parent').items();
entry(parentMenu, 'Object').run();
entry(entry(objectMenu, 'Show/Hide').items(), 'Hide Unselected').run();
entry(objectMenu, 'group').run();
assert.deepEqual(ran, ['parent', 'hide-others', 'group']);

world.modifiers.dispose();
scene.dispose();
engine.dispose();
console.log(`Context and RNA: Blender's 3D View menus draw ${object.ids.size} ids in Object Mode and ${edit.ids.size} in Edit Mode from Bylonder's data; bound properties read and write through`);
