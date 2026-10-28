// The tool system (windowmanager/wm-toolsystem.js): Blender's own tool definitions (space_toolsystem_toolbar.py,
// transpiled) list the 3D View's tools per mode as Blender does, Blender's Python sets the active tool through the
// WorkSpaceTool RNA, W cycles the select tools, and the active tool's keymap runs before the 3D View's with the
// settings the tool stores.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, Camera } from '@babylonjs/core';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createContext } from '../src/blenkernel/context.js';
import { createToolSystem } from '../src/windowmanager/wm-toolsystem.js';
import { keymapHandler } from '../src/windowmanager/keyconfig.js';
import { registerOperator, invokeOperator } from '../src/windowmanager/wm-operators.js';
import { boxRegion, lassoRegion, circleRegion } from '../src/editors/space_view3d/view3d-select.js';

const engine = new NullEngine(), scene = new Scene(engine);
const cube = MeshBuilder.CreateBox('Cube', { size: 2 }, scene);
const objects = [cube];
objects.scene = scene;
const world = { scene, objects, editMode: { object: null, get active() { return !!this.object; } } };
const selection = createSelection(scene, objects);
const changes = [];
const r = createRNA({ world, selection, update: () => {} });
const view = { state: { shading: 'solid', overlays: true, show_region_toolbar: true, show_region_ui: false }, editorCamera: { mode: Camera.PERSPECTIVE_CAMERA }, sync() {} };
const context = () => createContext(r, { space: view });
world.toolsystem = createToolSystem({ context, changed: (ref) => changes.push(ref.idname) });
const { panel } = world.toolsystem;

// Blender's toolbar per mode: groups in parentheses, separators as -.
const listing = (mode) => [...panel.tools_from_context({ mode })]
  .map((item) => (item === null ? '-' : Array.isArray(item) ? `(${item.map((tool) => tool.idname).join(' ')})` : item.idname)).join(' ');
const COMMON = '(builtin.select builtin.select_box builtin.select_circle builtin.select_lasso) builtin.cursor - builtin.move builtin.rotate ' +
  '(builtin.scale builtin.scale_cage) builtin.transform - (builtin.annotate builtin.annotate_line builtin.annotate_polygon builtin.annotate_eraser) ' +
  'builtin.measure - (builtin.primitive_cube_add builtin.primitive_cone_add builtin.primitive_cylinder_add builtin.primitive_uv_sphere_add builtin.primitive_ico_sphere_add)';
assert.equal(listing('OBJECT'), COMMON + ' - (builtin.breakdowner builtin.push builtin.relax)');
assert.equal(listing('EDIT_MESH'), COMMON + ' - (builtin.extrude_region builtin.extrude_manifold builtin.extrude_along_normals ' +
  'builtin.extrude_individual builtin.extrude_to_cursor) builtin.inset_faces builtin.bevel (builtin.loop_cut builtin.offset_edge_loop_cut) ' +
  '(builtin.knife builtin.bisect) builtin.poly_build builtin.spin (builtin.smooth builtin.randomize) (builtin.edge_slide builtin.vertex_slide) ' +
  '(builtin.shrink_fatten builtin.push_pull) (builtin.shear builtin.to_sphere) (builtin.rip_region builtin.rip_edge)');

// The default tool is Select Box, set up by Blender's activate_by_id with its keymap and the select group's fallback.
const active = world.toolsystem.active('OBJECT');
assert.equal(active.idname, 'builtin.select_box');
assert.deepEqual(world.toolsystem.keymaps('OBJECT'), ['3D View Tool: Select Box']);
assert.equal(context().workspace.tools.from_space_view3d_mode('OBJECT').idname, 'builtin.select_box');

// Drawing the toolbar (draw_cls, into a layout that only takes its calls) remembers each group's shown tool.
const layout = { column: () => layout, row: () => layout, label() {}, operator: () => ({}), operator_menu_hold: () => ({}) };
const drawToolbar = () => panel.draw_cls(layout, createContext(r, { space: view, region: { type: 'TOOLS', width: 56 } }));
// wm.tool_set_by_id, as the toolbar's buttons and Blender's keymap run it: W cycles the select group.
// Blender redraws the toolbar after each change; a cycle goes on from the tool it shows.
const set = (props) => { const result = invokeOperator('wm.tool_set_by_id', props, {}); drawToolbar(); return result; };
drawToolbar();
for (const expected of ['builtin.select_circle', 'builtin.select_lasso', 'builtin.select', 'builtin.select_box']) {
  set({ name: 'builtin.select_box', cycle: true });
  assert.equal(world.toolsystem.active('OBJECT').idname, expected);
}
set({ name: 'builtin.move' });
assert.equal(world.toolsystem.active('OBJECT').idname, 'builtin.move');
assert.equal(world.toolsystem.active('OBJECT').gizmo_group, 'VIEW3D_GGT_xform_gizmo');
// Off its gizmo the Move tool drags with the fallback tool, the select tool the toolbar shows.
assert.deepEqual(world.toolsystem.keymaps('OBJECT', { visible: true }), ['3D View Tool: Select Box (fallback)', '3D View Tool: Move']);
assert.deepEqual(world.toolsystem.keymaps('OBJECT', { visible: true, highlight: true }), ['3D View Tool: Move', '3D View Tool: Select Box (fallback)']);
assert.equal(set({ name: 'builtin.no_such_tool' }), 'CANCELLED');
// A mode keeps its own tool.
world.editMode.object = cube;
assert.equal(context().mode, 'EDIT_MESH');
assert.equal(world.toolsystem.active('EDIT_MESH').idname, 'builtin.select_box');
set({ name: 'builtin.extrude_region' });
assert.equal(world.toolsystem.active('EDIT_MESH').keymap, '3D View Tool: Edit Mesh, Extrude Region');
assert.equal(world.toolsystem.active('OBJECT').idname, 'builtin.move');
world.editMode.object = null;

// The active tool's keymap runs first, with the settings the tool stores (the Select Box mode in the tool header).
const ran = [];
registerOperator('view3d.select_box', { run: (props) => { ran.push(['box', props.mode ?? 'SET']); } });
registerOperator('view3d.select', { run: (props) => { ran.push(['select', !!props.deselect_all]); return props.select_passthrough ? 'PASS_THROUGH' : 'FINISHED'; } });
registerOperator('transform.translate', { run: (props) => { ran.push(['move', !!props.release_confirm]); } });
const mode = () => context().mode;
const keys = keymapHandler(() => [...world.toolsystem.keymaps(mode()), 'Object Mode', '3D View'], () => true,
  (name, idname) => world.toolsystem.keymapProperties(mode(), name, idname));
const event = (value, modifiers = {}) => ({ type: 'leftmouse', value, shift: false, ctrl: false, alt: false, ...modifiers });
set({ name: 'builtin.select_box' });
const tool = context().workspace.tools.from_space_view3d_mode('OBJECT');
tool.operator_properties('view3d.select_box').mode = 'XOR';
assert.equal(tool.operator_properties('view3d.select_box').mode, 'XOR');
assert.ok(keys(event('CLICK_DRAG')) && keys(event('CLICK_DRAG', { shift: true })));
assert.ok(keys(event('CLICK')));
set({ name: 'builtin.move' });
assert.ok(keys(event('CLICK_DRAG')));
set({ name: 'builtin.select' });
assert.equal(keys(event('PRESS')), false, 'the Tweak press selects and passes through, so a drag can follow');
// Circle select paints from the press (wait_for_input off) with the tool's radius; lasso begins at a drag.
registerOperator('view3d.select_circle', { run: (props) => { ran.push(['circle', props.wait_for_input, props.radius ?? 25, props.mode ?? 'SET']); } });
registerOperator('view3d.select_lasso', { run: (props) => { ran.push(['lasso', props.mode ?? 'SET']); } });
set({ name: 'builtin.select_circle' });
context().workspace.tools.from_space_view3d_mode('OBJECT').operator_properties('view3d.select_circle').radius = 40;
assert.ok(keys(event('PRESS')) && keys(event('PRESS', { ctrl: true })));
set({ name: 'builtin.select_lasso' });
assert.ok(keys(event('CLICK_DRAG', { shift: true, ctrl: true })));
assert.deepEqual(ran, [['box', 'XOR'], ['box', 'ADD'], ['select', true], ['move', true], ['select', true],
  ['circle', false, 40, 'SET'], ['circle', false, 40, 'SUB'], ['lasso', 'AND']]);

// The regions box, lasso and circle select test points and edges against, in pixels.
const box = boxRegion({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }), lasso = lassoRegion([[0, 0], [10, 0], [0, 10]]), circle = circleRegion([0, 0], 5);
assert.ok(box.point([5, 5]) && !box.point([11, 5]) && box.edge([-5, 5], [15, 5]) && !box.edge([-5, -5], [-1, 20]));
assert.ok(lasso.point([2, 2]) && !lasso.point([8, 8]) && lasso.edge([-5, 2], [20, 2]));
assert.ok(circle.point([3, 4]) && !circle.point([4, 4]) && circle.edge([-10, 1], [10, 1]) && !circle.edge([-10, 6], [10, 6]) && !circle.edgesInsideFirst);
assert.ok(changes.length >= 8);

scene.dispose();
engine.dispose();
console.log('Tool system: Blender\'s toolbar lists for Object and Edit Mode, default and cycled tools, and the active tool\'s keymap with its settings passed');
