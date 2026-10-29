// Blender's modal transform in the module's Edit Mode, used from the keyboard as in Blender: typed values, axis
// constraints and their orientation cycling, the header it shows, Ctrl snapping and cancel. A top orthographic view
// of 100 pixels per unit, its center at the region's.
import assert from 'node:assert/strict';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { EditMesh, OPERATOR_RUNNING_MODAL } from '../src/bmesh/bmesh-wasm.js';
import { SCE_SELECT_VERTEX } from '../src/bmesh/intern/bmesh-marking.js';
import { BM_VERT } from '../src/bmesh/intern/bmesh-class.js';
import '../src/python/bpy_interface.js';
import { modalItem } from '../src/windowmanager/keyconfig.js';

const TOP = { viewmat: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1], winmat: [0.2, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, -0.02, 0, 0, 0, 0, 1], winx: 1000, winy: 1000, persp: false };
const CENTER = [500, 500];
// Keys by what they type, as Blender's event types.
const KEYS = { '-': 'MINUS', '.': 'PERIOD', Tab: 'TAB', Backspace: 'BACK_SPACE', ...Object.fromEntries(['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'].map((t, i) => [i, t])) };

const round = (values) => Array.from(values, (v) => Math.round(v * 1e4) / 1e4 + 0);
// The cube's top face selected, in a top view, its object at the origin.
function topFace(objectToWorld) {
  const edit = EditMesh.fromMesh(primitive_add('mesh.primitive_cube_add'), SCE_SELECT_VERTEX), co = edit.toMesh().vert_positions, up = [];
  edit.view = TOP;
  if (objectToWorld) edit.objectToWorld = objectToWorld;
  edit.selectClear(SCE_SELECT_VERTEX);
  for (let v = 0; v < co.length / 3; v++) if (co[v * 3 + 2] > 0) up.push(v);
  edit.selectElements(BM_VERT, up, up.map(() => true));
  edit.selectFlush();
  return edit;
}
const selected = (edit) => {
  const mesh = edit.toMesh(), sel = mesh.attribute('.select_vert'), out = [];
  for (let v = 0; v < mesh.verts_num; v++) if (sel[v]) out.push(round(mesh.vert_positions.subarray(v * 3, v * 3 + 3)));
  return out.sort() + '';
};
const expect = (fn) => [[-1, -1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, 1]].map((p) => round(fn(p))).sort() + '';

// Runs a transform from the view's center over `keys`: a string types its characters, one in braces is a key of the
// Transform Modal Map ({x} is X, {X} Shift X, {ctrl} Ctrl held), a pair [dx, dy] moves the mouse by that many pixels.
// Ends with Enter unless `end` is 'esc'. Returns the edit mesh and the header shown before the end.
function transform(idname, keys, { end = 'ret', mouse = CENTER, object } = {}) {
  const edit = topFace(object);
  let [x, y] = mouse, modifier = 0;
  const { op, keymap, status } = edit.invoke(idname, {}, { type: 'MOUSEMOVE', value: 'NOTHING', x, y });
  assert.ok(op && status & OPERATOR_RUNNING_MODAL, `${idname} runs modally`);
  const send = (type, text = '', value = 'PRESS') => {
    const item = modalItem(keymap, { type: type.toLowerCase(), value, shift: !!(modifier & 1), ctrl: !!(modifier & 2), alt: false, oskey: false }, (id) => edit.modalItem(op, id) >= 0);
    edit.modal(op, { type, value, x, y, modifier, text, ...(item ? { modal: edit.modalItem(op, item) } : {}) });
  };
  // The window manager gives a modal operator the pointer's place at once (WM_event_add_mousemove).
  send('MOUSEMOVE', '', 'NOTHING');
  for (const step of keys) {
    if (Array.isArray(step)) { [x, y] = [x + step[0], y + step[1]]; send('MOUSEMOVE', '', 'NOTHING'); continue; }
    for (const token of step.match(/\{[^}]+\}|Tab|Backspace|./g)) {
      if (token === '{ctrl}') { modifier |= 2; send('LEFT_CTRL'); continue; }
      const axis = token.match(/^\{([xyzXYZ])\}$/)?.[1];
      if (axis) {
        const shift = axis === axis.toUpperCase();
        if (shift) modifier |= 1;
        send(axis.toUpperCase(), shift ? '' : axis);
        modifier &= ~1;
      } else send(KEYS[token] ?? token.toUpperCase(), token.length === 1 ? token : '');
    }
  }
  const header = edit.status;
  send(end === 'esc' ? 'ESC' : 'RET');
  return { edit, header };
}

let r = transform('transform.translate', ['2']);
assert.equal(r.header, 'Dx: [2|] = 2    Dy: NONE   Dz: NONE (2.0000 )');
assert.equal(selected(r.edit), expect(([x, y, z]) => [x + 2, y, z]), 'G 2 moves 2 along global X');
assert.equal(selected(transform('transform.translate', ['{y}2']).edit), expect(([x, y, z]) => [x, y + 2, z]), 'G Y 2');
assert.equal(selected(transform('transform.translate', ['{z}-1.5']).edit), expect(([x, y, z]) => [x, y, z - 1.5]), 'G Z -1.5');
assert.equal(selected(transform('transform.translate', ['2Tab3']).edit), expect(([x, y, z]) => [x + 2, y + 3, z]), 'G 2 Tab 3');
assert.equal(selected(transform('transform.translate', ['3Backspace2']).edit), expect(([x, y, z]) => [x + 2, y, z]), 'Backspace removes a digit');
assert.equal(selected(transform('transform.translate', ['{Z}1Tab2']).edit), expect(([x, y, z]) => [x + 1, y, z]), 'G Shift Z 1 Tab 2 moves along X only, as Blender 5.2 does');
// The object turned 90 degrees about Z, its local X along global Y (vertex coordinates are local).
const turned = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
r = transform('transform.translate', ['{x}2'], { object: turned });
assert.equal(selected(r.edit), expect(([x, y, z]) => [x, y - 2, z]), 'G X 2 is global X, the turned object\'s local -Y');
assert.match(r.header, / along global X$/);
r = transform('transform.translate', ['{x}{x}2'], { object: turned });
assert.equal(selected(r.edit), expect(([x, y, z]) => [x + 2, y, z]), 'G X X 2 moves along the local X');
assert.match(r.header, / along local X$/);
assert.doesNotMatch(transform('transform.translate', ['{x}{x}{x}2'], { object: turned }).header, /along/, 'a third X turns the constraint off');
const spin = (deg) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return ([x, y, z]) => [x * c - y * s, x * s + y * c, z]; };
assert.equal(selected(transform('transform.rotate', ['{z}90']).edit), expect(spin(90)), 'R Z 90 turns counterclockwise about global Z');
assert.equal(selected(transform('transform.rotate', ['90']).edit), expect(spin(-90)), 'R 90 turns about the view axis, clockwise from the top');
assert.equal(selected(transform('transform.resize', ['2']).edit), expect(([x, y]) => [x * 2, y * 2, 1]), 'S 2 scales about the median point');
assert.equal(selected(transform('transform.resize', ['{x}2']).edit), expect(([x, y, z]) => [x * 2, y, z]), 'S X 2');
assert.equal(selected(transform('transform.resize', ['{Z}0']).edit), expect(([, , z]) => [0, 0, z]), 'S Shift Z 0 flattens onto the Z axis');
assert.equal(selected(transform('transform.translate', [[123, 0]]).edit), expect(([x, y, z]) => [x + 1.23, y, z]), 'the mouse moves the selection');
assert.equal(selected(transform('transform.translate', ['{ctrl}', [123, 0]]).edit), expect(([x, y, z]) => [x + 1, y, z]), 'Ctrl snaps to whole units');
assert.equal(selected(transform('transform.translate', ['5'], { end: 'esc' }).edit), expect((p) => p), 'Esc restores');
console.log('Transform in the module: typed values, Tab, Backspace, axis and plane constraints, orientation cycling, rotate, scale, the mouse, Ctrl snapping and cancel passed');
