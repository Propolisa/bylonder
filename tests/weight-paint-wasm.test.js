// Weight Paint Mode as in Blender 5.2 (tools/blender-reference/weight-paint-fixtures.py): a grid parented to a two bone
// armature With Automatic Weights gets Blender's weights; Weight Paint Mode puts the armature in Pose Mode; through
// Blender's window, an Alt click selects a bone (picked by Blender's GPU selection, gpu-select.cc) and makes its vertex
// group active, a left drag paints it and a Ctrl click paints the inverse, each vertex's weight as Blender's. The
// weights the overlay draws are extract_weights' (mesh_paint_weights).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { BlenderMain, datafiles } from '../src/bmesh/bmesh-wasm.js';
import { blendData, contextStruct, setContextPointer } from '../src/python/bpy_rna.js';
import { registered } from '../src/python/bpy_interface.js';
import { Window, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/weight-paint/grid.json', import.meta.url), 'utf8'));
await datafiles;

const main = new BlenderMain();
setContextPointer(main.C);
main.view = fixture.view;
main.run('mesh.primitive_grid_add', { x_subdivisions: 8, y_subdivisions: 8, size: 2, location: [0, 0, 1], rotation: [1.5707963, 0, 0] });
main.run('object.armature_add', { location: [0, 0, 0] });
const data = blendData(), grid = data.objects.get('Grid'), rig = data.objects.get('Armature');
main.run('object.mode_set', { mode: 'EDIT' });
rig.data.edit_bones[0].tail = [0, 0, 1];
main.run('armature.extrude_move', { TRANSFORM_OT_translate: { value: [0, 0, 1] } });
main.run('object.mode_set', { mode: 'OBJECT' });
grid.select_set(true);
rig.select_set(true);
contextStruct().view_layer.objects.active = rig;
assert.equal(main.run('object.parent_set', { type: 'ARMATURE_AUTO' }).status, 4);

const ID_OB = 0x424f;
const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 2e-3);
function state() {
  const groups = [...grid.vertex_groups].map((g) => g.name), weights = Object.fromEntries(groups.map((name) => [name, new Array(grid.data.vertices.length).fill(0)]));
  for (const v of grid.data.vertices) for (const g of v.groups) weights[groups[g.group]][v.index] = g.weight;
  return { mode: grid.mode, rig_mode: rig.mode, selected: [...rig.pose.bones].filter((b) => b.select).map((b) => b.name), active_group: grid.vertex_groups.active?.name ?? null, weights };
}
const failed = [];
function compare(label, actual, expected) {
  for (const key of ['mode', 'rig_mode', 'selected', 'active_group']) if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) failed.push(`${label}: ${key} ${JSON.stringify(actual[key])}, Blender ${JSON.stringify(expected[key])}`);
  for (const [name, weights] of Object.entries(expected.weights)) if (!near(actual.weights[name] ?? [], weights)) failed.push(`${label}: weights of ${name} differ from Blender's`);
}
compare('automatic weights', state(), fixture.start);

contextStruct().view_layer.objects.active = grid;
assert.equal(main.run('paint.weight_paint_toggle').status, 4);
const window = new Window(main);
const { winx, winy } = fixture.view;
window.size = { width: winx, height: winy };
loadKeyconfig(main.C);
window.allow(['paint.weight_paint', 'view3d.select']);
const view = window.area(SPACE_VIEW3D);
const rect = { x: 0, y: 0, width: winx, height: winy };
view.layout(rect, { [RGN_TYPE_WINDOW]: rect });
view.view3d = fixture.view;

const KEYS = { LEFT_ALT: ['AltLeft', 'Alt'], LEFT_CTRL: ['ControlLeft', 'Control'] };
function send([type, value, x, y]) {
  window.event('pointermove', [x, winy - 1 - y]);
  if (type === 'LEFTMOUSE') window.event(value === 'PRESS' ? 'buttondown' : 'buttonup', [0]);
  else if (type in KEYS) window.event(value === 'PRESS' ? 'keydown' : 'keyup', [], { code: KEYS[type][0], key: KEYS[type][1] });
}
for (const { name, events, ...expected } of fixture.cases) {
  events.forEach(send);
  compare(name, state(), expected);
}

const ob = main.ids(ID_OB).find((id) => main.name(id) === 'Grid');
// The overlay's weights: each vertex's weight in the active group (Bone, after the Alt click on the lower bone), the
// Zero Weights alert (-1) where it has none, as the tool settings' default shows (vertex_group_user ACTIVE).
const mesh = main.evaluatedMesh(ob), shown = main.paintWeights(ob, mesh.verts_num), alert = contextStruct().tool_settings.vertex_group_user === 'ACTIVE';
const painted = fixture.cases.at(-1).weights.Bone.map((w) => (w === 0 && alert ? -1 : w));
assert.deepEqual(failed, [], 'Weight Paint results that differ from Blender');
assert.ok(near(Array.from(shown), painted), 'the overlay draws the active group\'s weights');

// Weight Paint's tools are Blender's, each with its icon shipped (tools/blender-ui/tool_icons.py).
const icons = [...registered.VIEW3D_PT_tools_active.tools_from_context({ mode: 'PAINT_WEIGHT' })].flatMap((item) => [item ?? []].flat()).map((tool) => tool.icon);
assert.ok(icons.includes('ops.paint.weight_gradient'), 'Weight Paint has its tools');
for (const icon of icons) assert.ok(existsSync(new URL(`../public/icons/blender/tools/${icon}.svg`, import.meta.url)), `${icon} has its icon`);
console.log(`weight paint: automatic weights, Alt click bone selection, a stroke and an inverted click match Blender's (${fixture.cases.length} steps)`);
