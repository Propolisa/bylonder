import assert from 'node:assert/strict';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { BM_mesh_bm_from_me } from '../src/bmesh/intern/bmesh-mesh-convert.js';
import { BM_VERT } from '../src/bmesh/intern/bmesh-class.js';
import { Matrix, Vector3 } from '@babylonjs/core';
import { createTransMesh } from '../src/editors/transform/transform-mesh.js';
import { beginEdgeSlide, edge_slide_exec } from '../src/editors/transform/transform-mesh-edge-slide.js';
import { initTransform } from '../src/editors/transform/transform.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE, BM_vert_select_set, BM_mesh_select_mode_flush } from '../src/bmesh/intern/bmesh-marking.js';
import { EDBM_select_pick } from '../src/editors/mesh/editmesh-select.js';
import { EditMesh } from '../src/bmesh/bmesh-wasm.js';

// A view looking down Blender's Z axis: 100 pixels per unit, nothing occluded, faces picked by their center.
const view = { xray: false, project: (co) => [co[0] * 100, -co[1] * 100, 0.5], occluded: () => false, faceAt: () => 0 };
const cube = (selectmode = SCE_SELECT_VERTEX) => EditMesh.fromMesh(primitive_add('mesh.primitive_cube_add'), selectmode);
const count = (edit, name) => edit.toMesh().attribute(name).filter(Boolean).length;
const pick = (edit, mouse, props) => EDBM_select_pick(edit, edit.toMesh(), view, mouse, props);

let edit = cube();
pick(edit, [100, -100]);
assert.equal(count(edit, '.select_vert'), 1, 'a click selects the nearest vertex');
const first = edit.history.at(-1).index;
pick(edit, [100, -100]);
assert.notEqual(edit.history.at(-1).index, first, 'clicking again cycles to the vertex below (select bias)');
pick(edit, [-100, -100], { toggle: true });
assert.equal(count(edit, '.select_vert'), 2, 'Shift click adds');
pick(edit, [5000, 5000]);
assert.equal(count(edit, '.select_vert'), 0, 'clicking empty space deselects all');

edit.run('mesh.select_all', { action: 'SELECT' });
assert.deepEqual([count(edit, '.select_vert'), count(edit, '.select_edge'), count(edit, '.select_poly')], [8, 12, 6]);
edit.run('mesh.select_all', { action: 'DESELECT' });
pick(edit, [100, -100]);
edit.run('mesh.select_all', { action: 'INVERT' });
assert.deepEqual([count(edit, '.select_vert'), count(edit, '.select_poly')], [7, 3], 'invert in vertex mode: 7 verts and the 3 faces not using the vertex');

edit = cube(SCE_SELECT_FACE);
pick(edit, [0, 0]);
assert.deepEqual([count(edit, '.select_vert'), count(edit, '.select_edge'), count(edit, '.select_poly')], [4, 4, 1], 'a face selects its edges and verts');
edit.run('mesh.select_mode', { type: 'EDGE' });
assert.equal(edit.selectmode, SCE_SELECT_EDGE);
assert.deepEqual([count(edit, '.select_edge'), count(edit, '.select_poly')], [4, 1]);
edit.run('mesh.select_mode', { type: 'VERT', use_extend: true });
assert.equal(edit.selectmode, SCE_SELECT_EDGE | SCE_SELECT_VERTEX, 'Shift adds a mode');

edit = cube(SCE_SELECT_FACE);
pick(edit, [0, 0]);
edit.run('mesh.hide', { unselected: false });
assert.equal(count(edit, '.hide_poly'), 1, 'H hides the selected face');
assert.equal(count(edit, '.select_poly'), 0);
edit.run('mesh.reveal');
assert.equal(count(edit, '.select_poly'), 1, 'Alt H shows it again, selected');
edit = EditMesh.fromMesh(primitive_add('mesh.primitive_grid_add', { x_subdivisions: 4, y_subdivisions: 4 }), SCE_SELECT_EDGE);
edit.selectClear(SCE_SELECT_EDGE);
edit.run('mesh.loop_select', { object_index: 0, edge_index: 5 });
assert.equal(count(edit, '.select_edge'), 4, 'Alt click selects the edge loop across the grid');
assert.deepEqual(edit.history.at(-1), { htype: 2, index: 5 }, 'the clicked edge becomes active');
edit = cube();
edit.selectClear(SCE_SELECT_VERTEX);
edit.run('mesh.select_linked_pick', { object_index: 0, index: 0 });
assert.equal(count(edit, '.select_vert'), 8, 'L selects everything linked to the vertex');
console.log('Edit Mode: picking with cycling, Shift toggle, select all and invert, select modes, hide and reveal, loop and linked select passed');

// Edit Mode transform from a top orthographic view: 100 pixels per unit, screen up is Blender +Y.
const top = {
  camera: { mode: 1, orthoTop: 5, orthoBottom: -5, globalPosition: new Vector3(0, 10, 0), getDirection: (v) => (v.z === 1 ? new Vector3(0, -1, 0) : v.y === 1 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)) },
  canvas: { clientHeight: 1000 },
  project: (p) => ({ x: p.x * 100, y: -p.z * 100 }),
};
const identity = { computeWorldMatrix: () => Matrix.Identity() };
const beginMeshTransform = (edit, object, view, mode, mouse) => initTransform(mode, createTransMesh(edit, edit.toMesh(), object), view, mouse);
// Keys as the window manager passes them: Blender's event type, and the typed character.
const KEY_TYPES = { '-': 'minus', '.': 'period', Tab: 'tab', Backspace: 'back_space' };
const type = (t, keys) => { for (const key of keys.split(' ')) t.numinput({ type: KEY_TYPES[key] ?? key.toLowerCase(), value: 'PRESS', native: { key } }); };
const positions = (edit) => edit.toMesh().vert_positions;
const round = (values) => Array.from(values, (x) => Math.round(x * 1e4) / 1e4 + 0);
const coords = (edit) => round(positions(edit));
const topFace = () => {
  const edit = cube(), co = positions(edit), up = [];
  edit.selectClear(SCE_SELECT_VERTEX);
  for (let v = 0; v < co.length / 3; v++) if (co[v * 3 + 2] > 0) up.push(v);
  edit.selectElements(BM_VERT, up, up.map(() => true));
  edit.selectFlush();
  return edit;
};
const moved = (edit, fn) => { const co = positions(edit), out = []; for (let v = 0; v < co.length / 3; v++) out.push(fn(co[v * 3 + 2] > 0, round(co.subarray(v * 3, v * 3 + 3)))); return out; };
const sweep = (t, from, to, steps = 32) => { for (let i = 1; i <= steps; i++) { const a = from + ((to - from) * i) / steps, b = from + ((to - from) * (i - 1)) / steps; t.update(100 * (Math.cos(a) - Math.cos(b)), -100 * (Math.sin(a) - Math.sin(b)), {}); } };

edit = topFace();
const before = coords(edit);
let t = beginMeshTransform(edit, identity, top, 'translate', { x: 0, y: 0 });
t.update(100, 0, {});
assert.ok(moved(edit, (sel, [x, y, z]) => !sel || (Math.abs(x) === 0 || Math.abs(x) === 2) && Math.abs(y) === 1 && z === 1).every(Boolean), 'G moves the selection 1 along X');
t.constrain('AXIS_Y');
assert.ok(moved(edit, (sel, [x]) => !sel || Math.abs(x) === 1).every(Boolean), 'Y constrains to the Y axis');
t.update(0, -100, {});
assert.ok(moved(edit, (sel, [, y]) => !sel || y === 0 || y === 2).every(Boolean), 'dragging up moves along +Y');
t.cancel();
assert.deepEqual(coords(edit), before, 'cancel restores');

t = beginMeshTransform(edit, identity, top, 'rotate', { x: 100, y: 0 });
sweep(t, 0, Math.PI / 2);
assert.deepEqual(moved(edit, (sel, p) => sel && p).filter(Boolean).map(([x, y]) => [x, y]).sort() + '', [[-1, -1], [-1, 1], [1, -1], [1, 1]].sort() + '', 'R by 90 degrees keeps the square');
t.cancel();
const up = [...Array(positions(edit).length / 3).keys()].find((v) => positions(edit)[v * 3 + 2] > 0), corner = [...positions(edit).subarray(up * 3, up * 3 + 3)];
sweep(beginMeshTransform(edit, identity, top, 'rotate', { x: 100, y: 0 }), 0, Math.PI / 4);
const turned_co = positions(edit), turn = Math.atan2(turned_co[up * 3 + 1], turned_co[up * 3]) - Math.atan2(corner[1], corner[0]);
assert.ok(Math.abs(((turn + 2 * Math.PI) % (2 * Math.PI)) - Math.PI / 4) < 1e-6, 'a counterclockwise sweep seen from the top turns counterclockwise about Z');

edit = topFace();
t = beginMeshTransform(edit, identity, top, 'resize', { x: 100, y: 0 });
t.update(100, 0, {});
assert.ok(moved(edit, (sel, [x, y, z]) => !sel || Math.abs(x) === 2 && Math.abs(y) === 2 && z === 1).every(Boolean), 'S doubles about the median point');
t.constrain('PLANE_X');
assert.ok(moved(edit, (sel, [x, y]) => !sel || Math.abs(x) === 1 && Math.abs(y) === 2).every(Boolean), 'Shift X scales across the YZ plane');
console.log('Edit Mode transform: move, axis constraint, rotate, scale, plane constraint and cancel passed');

// Typed values (G 2, G X 2, G -2, G 2 Tab 3, R Z 90, S X 2) and the orientation cycling of repeated axis keys.
const selectedCoords = (edit) => moved(edit, (sel, p) => sel && p).filter(Boolean).sort() + '';
const expect = (fn) => selectedCoords(((b) => (moveAll(b, fn), b))(topFace()));
const moveAll = (edit, fn) => {
  const co = positions(edit), up = [...Array(co.length / 3).keys()].filter((v) => co[v * 3 + 2] > 0);
  edit.setCoords(up, up.flatMap((v) => fn([...co.subarray(v * 3, v * 3 + 3)])));
};
const typed = (mode, keys, object = identity, mouse = { x: 0, y: 0 }) => {
  const edit = topFace(), t = beginMeshTransform(edit, object, top, mode, mouse);
  for (const key of keys) typeof key === 'function' ? key(t) : type(t, key);
  return { edit, t };
};
const axis = (item) => (t) => t.constrain(item);

let r = typed('translate', ['2']);
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x + 2, y, z]), 'G 2 moves 2 along global X');
assert.equal(r.t.header, 'Dx: [2|] = 2 m   Dy: NONE   Dz: NONE (2 m)');
assert.equal(selectedCoords(typed('translate', [axis('AXIS_Y'), '2']).edit), expect(([x, y, z]) => [x, y + 2, z]), 'G Y 2');
r = typed('translate', [axis('AXIS_Z'), '- 1 . 5']);
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x, y, z - 1.5]), 'G Z -1.5');
assert.equal(r.t.header, 'D: [-(1.5|)] = -1.5 m (1.5 m) along global Z');
assert.equal(selectedCoords(typed('translate', ['2 Tab 3']).edit), expect(([x, y, z]) => [x + 2, y + 3, z]), 'G 2 Tab 3');
assert.equal(selectedCoords(typed('translate', [axis('PLANE_Z'), '1 Tab 2']).edit), expect(([x, y, z]) => [x + 1, y, z]), 'G Shift Z 1 Tab 2 moves along X only, as Blender 5.2 does');
assert.equal(selectedCoords(typed('translate', ['3 Backspace 2']).edit), expect(([x, y, z]) => [x + 2, y, z]), 'Backspace removes a digit');

// The object turned 90 degrees about Z, its local X along world -Y (vertex coordinates are local).
const turned = { computeWorldMatrix: () => Matrix.RotationY(Math.PI / 2) };
const local = (keys) => { const edit = topFace(); const t = beginMeshTransform(edit, turned, top, 'translate', { x: 0, y: 0 }); for (const k of keys) typeof k === 'function' ? k(t) : type(t, k); return { edit, t }; };
r = local([axis('AXIS_X'), '2']);
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x, y + 2, z]), 'G X 2 is global X, the turned object\'s local Y');
assert.match(r.t.header, / along global X$/);
r = local([axis('AXIS_X'), axis('AXIS_X'), '2']);
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x + 2, y, z]), 'G X X 2 moves along the local X');
assert.match(r.t.header, / along local X$/);
r = local([axis('AXIS_X'), axis('AXIS_X'), axis('AXIS_X'), '2']);
assert.equal(r.t.constrained, false, 'a third X turns the constraint off');
assert.equal(selectedCoords(local([axis('AXIS_X'), axis('AXIS_Y'), '2']).edit), expect(([x, y, z]) => [x - 2, y, z]), 'another axis goes back to global');

const spin = (deg) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return ([x, y, z]) => [x * c - y * s, x * s + y * c, z]; };
r = typed('rotate', [axis('AXIS_Z'), '9 0'], identity, { x: 100, y: 0 });
assert.equal(selectedCoords(r.edit), expect(spin(90)), 'R Z 90 turns counterclockwise about global Z');
assert.equal(r.t.header, 'Rotation: [90|] = 90°  along global Z ');
assert.equal(selectedCoords(typed('rotate', ['9 0'], identity, { x: 100, y: 0 }).edit), expect(spin(-90)), 'R 90 turns about the view axis, clockwise from the top');
assert.equal(selectedCoords(typed('rotate', ['- 4 5'], identity, { x: 100, y: 0 }).edit), expect(spin(45)), 'R -45');

r = typed('resize', ['2'], identity, { x: 100, y: 0 });
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x * 2, y * 2, 1]), 'S 2 scales all axes about the median point');
assert.equal(r.t.header, 'Scale X: [2|] = 2   Y: [2|] = 2  Z: [2|] = 2 ', 'untyped components follow the first');
r = typed('resize', [axis('AXIS_X'), '2'], identity, { x: 100, y: 0 });
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x * 2, y, z]), 'S X 2');
assert.equal(r.t.header, 'Scale: [2|] = 2 along global X ');
assert.equal(selectedCoords(typed('resize', [axis('PLANE_Z'), '0']).edit), expect(([, , z]) => [0, 0, z]), 'S Shift Z 0 flattens onto the Z axis');

// Ctrl snaps to whole units (a tenth with Shift) and the mouse gives the value again once Backspace clears it.
r = typed('translate', []);
r.t.update(123, 0, { ctrlKey: true });
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x + 1, y, z]), 'Ctrl snaps to 1');
r.t.update(0, 0, { ctrlKey: true, shiftKey: true });
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x + 1.2, y, z]), 'Shift Ctrl snaps to 0.1');
type(r.t, '5');
assert.equal(selectedCoords(r.edit), expect(([x, y, z]) => [x + 5, y, z]), 'typing replaces the mouse');
r.t.cancel();
assert.equal(selectedCoords(r.edit), expect((p) => p), 'cancel restores');
// G G 0.5: Edge Slide takes a typed factor too.
// Edge Slide is a JS port, sliding a JS BMesh.
const slid = (fn) => { const b = BM_mesh_bm_from_me(primitive_add('mesh.primitive_cube_add')); for (let v = 0; v < b.v.size; v++) if (b.v.co[v * 3] > 0 && b.v.co[v * 3 + 1] > 0) BM_vert_select_set(b, v, true); BM_mesh_select_mode_flush(b); fn(b); return round(b.v.co) + ''; };
let header;
const typedSlide = slid((b) => { const s = beginEdgeSlide(b, identity, top, { x: 0, y: -50 }); type(s, '. 5'); header = s.header; });
assert.ok([0.5, -0.5].some((value) => slid((b) => edge_slide_exec(b, { value })) === typedSlide), 'G G .5 slides half way');
assert.equal(header, 'Edge Slide: [.5|] = 0.5');
console.log('Transform values: typed values, negation, Tab, orientation cycling, rotate, scale and edge slide values and increments passed');
