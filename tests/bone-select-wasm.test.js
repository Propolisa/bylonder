// Selecting bones as in Blender 5.2 (tools/blender-reference/bone-select-fixtures.py): Blender's clicks, Select Box tool
// drags, L, Ctrl click, circle and lasso in Pose and Edit Mode, the same events through Blender's window in the module,
// which picks by Blender's GPU selection answered from the bones the overlay draws (gpu-select.cc); after each, the same
// bones and joints are selected.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlenderMain, datafiles } from '../src/bmesh/bmesh-wasm.js';
import { blendData, contextStruct, setContextPointer } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';
import { Window, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/bone-select/rig.json', import.meta.url), 'utf8'));
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

const window = new Window(main);
const { winx, winy } = fixture.view;
window.size = { width: winx, height: winy };
loadKeyconfig(main.C);
window.allow(['view3d.select', 'view3d.select_box', 'view3d.select_circle', 'view3d.select_lasso', 'pose.select_linked_pick',
  'armature.select_linked_pick', 'armature.shortest_path_pick']);
const view = window.area(SPACE_VIEW3D);
const rect = { x: 0, y: 0, width: winx, height: winy };
view.layout(rect, { [RGN_TYPE_WINDOW]: rect });
view.view3d = fixture.view;
main.view = fixture.view;

// Blender's event types as the page's: buttons by number, keys by code; region pixels from the bottom as page pixels from the top.
const BUTTONS = { LEFTMOUSE: 0 };
const KEYS = { LEFT_SHIFT: ['ShiftLeft', 'Shift'], LEFT_CTRL: ['ControlLeft', 'Control'], ESC: ['Escape', 'Escape'], L: ['KeyL', 'l'], C: ['KeyC', 'c'] };
function send([type, value, x, y]) {
  window.event('pointermove', [x, winy - 1 - y]);
  if (type in BUTTONS) window.event(value === 'PRESS' ? 'buttondown' : 'buttonup', [BUTTONS[type]]);
  else if (type in KEYS) window.event(value === 'PRESS' ? 'keydown' : 'keyup', [], { code: KEYS[type][0], key: KEYS[type][1] });
}
// A Ctrl (Shift) right drag: the 3D View keymap's lasso, as the page runs it (main-modes.js): Bylonder's window
// manager draws the gesture, then view3d.select_lasso's exec selects inside its path.
function lasso(events) {
  const held = new Set(events.filter(([type, value]) => value === 'PRESS' && type.startsWith('LEFT_')).map(([type]) => type));
  const path = events.slice(events.findIndex(([type]) => type === 'RIGHTMOUSE')).filter(([type]) => type === 'MOUSEMOVE').map(([, , x, y]) => [x, y]);
  main.view = fixture.view;
  main.lassoPath = path;
  main.run('view3d.select_lasso', { mode: held.has('LEFT_SHIFT') ? 'SUB' : 'ADD' });
}
const selection = () => (ob.mode === 'EDIT' ? Object.fromEntries([...arm.edit_bones].map((b) => [b.name, [b.select, b.select_head, b.select_tail]]))
  : Object.fromEntries([...ob.pose.bones].map((b) => [b.name, b.select])));

const failed = [];
for (const [mode, cases] of Object.entries(fixture.cases)) {
  main.run('object.mode_set', { mode });
  main.run(mode === 'EDIT' ? 'armature.select_all' : 'pose.select_all', { action: 'DESELECT' });
  for (const { name, events, selection: expected } of cases) {
    if (events.some(([type]) => type === 'RIGHTMOUSE')) lasso(events);
    else events.forEach(send);
    const actual = selection();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failed.push(`${mode} ${name}: ${JSON.stringify(actual)}, Blender ${JSON.stringify(expected)}`);
  }
}
assert.deepEqual(failed, [], 'bone selections that differ from Blender');
const count = Object.values(fixture.cases).flat().length;
console.log(`bone select: ${count} clicks, boxes, circles, lassos, L and Ctrl clicks in Pose and Edit Mode select as Blender's`);
