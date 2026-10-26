import assert from 'node:assert/strict';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../src/bmesh/intern/bmesh-mesh-convert.js';
import { BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_elem_flag_test } from '../src/bmesh/intern/bmesh-class.js';
import { Matrix, Vector3 } from '@babylonjs/core';
import { createTransMesh } from '../src/editors/transform/transform-mesh.js';
import { beginEdgeSlide, edge_slide_exec } from '../src/editors/transform/transform-mesh-edge-slide.js';
import { BM_mesh_select_mode_flush } from '../src/bmesh/intern/bmesh-marking.js';
import { initTransform } from '../src/editors/transform/transform.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE, BM_vert_select_set } from '../src/bmesh/intern/bmesh-marking.js';
import { EDBM_select_pick, mesh_select_all, mesh_select_mode } from '../src/editors/mesh/editmesh-select.js';
import { EDBM_mesh_hide, EDBM_mesh_reveal } from '../src/editors/mesh/editmesh-utils.js';

// A view looking down Blender's Z axis: 100 pixels per unit, nothing occluded, faces picked by their center.
const view = { xray: false, project: (co) => [co[0] * 100, -co[1] * 100, 0.5], occluded: () => false, faceAt: () => 0 };
const cube = () => { const bm = BM_mesh_bm_from_me(primitive_add('mesh.primitive_cube_add')); bm.selectmode = SCE_SELECT_VERTEX; return bm; };
const count = (bm, pool) => { let n = 0; for (let i = 0; i < bm[pool].size; i++) if (bm[pool].alive[i] && BM_elem_flag_test(bm[pool], i, BM_ELEM_SELECT)) n++; return n; };

let bm = cube();
EDBM_select_pick(bm, view, [100, -100]);
assert.equal(count(bm, 'v'), 1, 'a click selects the nearest vertex');
const first = bm.selected.at(-1).ele;
EDBM_select_pick(bm, view, [100, -100]);
assert.notEqual(bm.selected.at(-1).ele, first, 'clicking again cycles to the vertex below (select bias)');
EDBM_select_pick(bm, view, [-100, -100], { toggle: true });
assert.equal(count(bm, 'v'), 2, 'Shift click adds');
EDBM_select_pick(bm, view, [5000, 5000]);
assert.equal(count(bm, 'v'), 0, 'clicking empty space deselects all');

mesh_select_all(bm, 'SELECT');
assert.deepEqual([count(bm, 'v'), count(bm, 'e'), count(bm, 'f')], [8, 12, 6]);
mesh_select_all(bm, 'DESELECT');
EDBM_select_pick(bm, view, [100, -100]);
mesh_select_all(bm, 'INVERT');
assert.deepEqual([count(bm, 'v'), count(bm, 'f')], [7, 3], 'invert in vertex mode: 7 verts and the 3 faces not using the vertex');

bm = cube();
bm.selectmode = SCE_SELECT_FACE;
EDBM_select_pick(bm, view, [0, 0]);
assert.deepEqual([count(bm, 'v'), count(bm, 'e'), count(bm, 'f')], [4, 4, 1], 'a face selects its edges and verts');
mesh_select_mode(bm, 'EDGE');
assert.equal(bm.selectmode, SCE_SELECT_EDGE);
assert.deepEqual([count(bm, 'e'), count(bm, 'f')], [4, 1]);
assert.equal(mesh_select_mode(bm, 'VERT', { use_extend: true }), SCE_SELECT_EDGE | SCE_SELECT_VERTEX, 'Shift adds a mode');

bm = cube();
bm.selectmode = SCE_SELECT_FACE;
EDBM_select_pick(bm, view, [0, 0]);
EDBM_mesh_hide(bm, bm.selectmode, false);
let hidden = 0;
for (let f = 0; f < bm.f.size; f++) if (BM_elem_flag_test(bm.f, f, BM_ELEM_HIDDEN)) hidden++;
assert.equal(hidden, 1, 'H hides the selected face');
assert.equal(count(bm, 'f'), 0);
EDBM_mesh_reveal(bm, bm.selectmode);
assert.equal(count(bm, 'f'), 1, 'Alt H shows it again, selected');
const mesh = BM_mesh_bm_to_me(bm);
assert.equal(mesh.attribute('.select_poly').filter(Boolean).length, 1, 'selection is stored on the Mesh');
console.log('Edit Mode: picking with cycling, Shift toggle, select all and invert, select modes, hide and reveal passed');

// Edit Mode transform from a top orthographic view: 100 pixels per unit, screen up is Blender +Y.
const top = {
  camera: { mode: 1, orthoTop: 5, orthoBottom: -5, globalPosition: new Vector3(0, 10, 0), getDirection: (v) => (v.z === 1 ? new Vector3(0, -1, 0) : v.y === 1 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)) },
  canvas: { clientHeight: 1000 },
  project: (p) => ({ x: p.x * 100, y: -p.z * 100 }),
};
const identity = { computeWorldMatrix: () => Matrix.Identity() };
const beginMeshTransform = (bm, object, view, mode, mouse) => initTransform(mode, createTransMesh(bm, object), view, mouse);
// Keys as the window manager passes them: Blender's event type, and the typed character.
const KEY_TYPES = { '-': 'minus', '.': 'period', Tab: 'tab', Backspace: 'back_space' };
const type = (t, keys) => { for (const key of keys.split(' ')) t.numinput({ type: KEY_TYPES[key] ?? key.toLowerCase(), value: 'PRESS', native: { key } }); };
const coords = (bm) => [...bm.v.co].map((x) => Math.round(x * 1e4) / 1e4 + 0);
const topFace = () => {
  const bm = cube();
  for (let v = 0; v < bm.v.size; v++) if (bm.v.co[v * 3 + 2] > 0) BM_vert_select_set(bm, v, true);
  return bm;
};
const moved = (bm, fn) => { const out = []; for (let v = 0; v < bm.v.size; v++) out.push(fn(bm.v.co[v * 3 + 2] > 0, [...bm.v.co.subarray(v * 3, v * 3 + 3)].map((x) => Math.round(x * 1e4) / 1e4 + 0))); return out; };
const sweep = (t, from, to, steps = 32) => { for (let i = 1; i <= steps; i++) { const a = from + ((to - from) * i) / steps, b = from + ((to - from) * (i - 1)) / steps; t.update(100 * (Math.cos(a) - Math.cos(b)), -100 * (Math.sin(a) - Math.sin(b)), {}); } };

bm = topFace();
const before = coords(bm);
let t = beginMeshTransform(bm, identity, top, 'translate', { x: 0, y: 0 });
t.update(100, 0, {});
assert.ok(moved(bm, (sel, [x, y, z]) => !sel || (Math.abs(x) === 0 || Math.abs(x) === 2) && Math.abs(y) === 1 && z === 1).every(Boolean), 'G moves the selection 1 along X');
t.constrain('AXIS_Y');
assert.ok(moved(bm, (sel, [x]) => !sel || Math.abs(x) === 1).every(Boolean), 'Y constrains to the Y axis');
t.update(0, -100, {});
assert.ok(moved(bm, (sel, [, y]) => !sel || y === 0 || y === 2).every(Boolean), 'dragging up moves along +Y');
t.cancel();
assert.deepEqual(coords(bm), before, 'cancel restores');

t = beginMeshTransform(bm, identity, top, 'rotate', { x: 100, y: 0 });
sweep(t, 0, Math.PI / 2);
assert.deepEqual(moved(bm, (sel, p) => sel && p).filter(Boolean).map(([x, y]) => [x, y]).sort() + '', [[-1, -1], [-1, 1], [1, -1], [1, 1]].sort() + '', 'R by 90 degrees keeps the square');
t.cancel();
const up = [...Array(bm.v.size).keys()].find((v) => bm.v.co[v * 3 + 2] > 0), corner = [...bm.v.co.subarray(up * 3, up * 3 + 3)];
sweep(beginMeshTransform(bm, identity, top, 'rotate', { x: 100, y: 0 }), 0, Math.PI / 4);
const turn = Math.atan2(bm.v.co[up * 3 + 1], bm.v.co[up * 3]) - Math.atan2(corner[1], corner[0]);
assert.ok(Math.abs(((turn + 2 * Math.PI) % (2 * Math.PI)) - Math.PI / 4) < 1e-6, 'a counterclockwise sweep seen from the top turns counterclockwise about Z');

bm = topFace();
t = beginMeshTransform(bm, identity, top, 'resize', { x: 100, y: 0 });
t.update(100, 0, {});
assert.ok(moved(bm, (sel, [x, y, z]) => !sel || Math.abs(x) === 2 && Math.abs(y) === 2 && z === 1).every(Boolean), 'S doubles about the median point');
t.constrain('PLANE_X');
assert.ok(moved(bm, (sel, [x, y]) => !sel || Math.abs(x) === 1 && Math.abs(y) === 2).every(Boolean), 'Shift X scales across the YZ plane');
console.log('Edit Mode transform: move, axis constraint, rotate, scale, plane constraint and cancel passed');

// Typed values (G 2, G X 2, G -2, G 2 Tab 3, R Z 90, S X 2) and the orientation cycling of repeated axis keys.
const selectedCoords = (bm) => moved(bm, (sel, p) => sel && p).filter(Boolean).sort() + '';
const expect = (fn) => selectedCoords(((b) => (moveAll(b, fn), b))(topFace()));
const moveAll = (bm, fn) => { for (let v = 0; v < bm.v.size; v++) if (bm.v.co[v * 3 + 2] > 0) bm.v.co.set(fn([...bm.v.co.subarray(v * 3, v * 3 + 3)]), v * 3); };
const typed = (mode, keys, object = identity, mouse = { x: 0, y: 0 }) => {
  const bm = topFace(), t = beginMeshTransform(bm, object, top, mode, mouse);
  for (const key of keys) typeof key === 'function' ? key(t) : type(t, key);
  return { bm, t };
};
const axis = (item) => (t) => t.constrain(item);

let r = typed('translate', ['2']);
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x + 2, y, z]), 'G 2 moves 2 along global X');
assert.equal(r.t.header, 'Dx: [2|] = 2 m   Dy: NONE   Dz: NONE (2 m)');
assert.equal(selectedCoords(typed('translate', [axis('AXIS_Y'), '2']).bm), expect(([x, y, z]) => [x, y + 2, z]), 'G Y 2');
r = typed('translate', [axis('AXIS_Z'), '- 1 . 5']);
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x, y, z - 1.5]), 'G Z -1.5');
assert.equal(r.t.header, 'D: [-(1.5|)] = -1.5 m (1.5 m) along global Z');
assert.equal(selectedCoords(typed('translate', ['2 Tab 3']).bm), expect(([x, y, z]) => [x + 2, y + 3, z]), 'G 2 Tab 3');
assert.equal(selectedCoords(typed('translate', [axis('PLANE_Z'), '1 Tab 2']).bm), expect(([x, y, z]) => [x + 1, y, z]), 'G Shift Z 1 Tab 2 moves along X only, as Blender 5.2 does');
assert.equal(selectedCoords(typed('translate', ['3 Backspace 2']).bm), expect(([x, y, z]) => [x + 2, y, z]), 'Backspace removes a digit');

// The object turned 90 degrees about Z, its local X along world -Y (vertex coordinates are local).
const turned = { computeWorldMatrix: () => Matrix.RotationY(Math.PI / 2) };
const local = (keys) => { const bm = topFace(); const t = beginMeshTransform(bm, turned, top, 'translate', { x: 0, y: 0 }); for (const k of keys) typeof k === 'function' ? k(t) : type(t, k); return { bm, t }; };
r = local([axis('AXIS_X'), '2']);
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x, y + 2, z]), 'G X 2 is global X, the turned object\'s local Y');
assert.match(r.t.header, / along global X$/);
r = local([axis('AXIS_X'), axis('AXIS_X'), '2']);
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x + 2, y, z]), 'G X X 2 moves along the local X');
assert.match(r.t.header, / along local X$/);
r = local([axis('AXIS_X'), axis('AXIS_X'), axis('AXIS_X'), '2']);
assert.equal(r.t.constrained, false, 'a third X turns the constraint off');
assert.equal(selectedCoords(local([axis('AXIS_X'), axis('AXIS_Y'), '2']).bm), expect(([x, y, z]) => [x - 2, y, z]), 'another axis goes back to global');

const spin = (deg) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return ([x, y, z]) => [x * c - y * s, x * s + y * c, z]; };
r = typed('rotate', [axis('AXIS_Z'), '9 0'], identity, { x: 100, y: 0 });
assert.equal(selectedCoords(r.bm), expect(spin(90)), 'R Z 90 turns counterclockwise about global Z');
assert.equal(r.t.header, 'Rotation: [90|] = 90°  along global Z ');
assert.equal(selectedCoords(typed('rotate', ['9 0'], identity, { x: 100, y: 0 }).bm), expect(spin(-90)), 'R 90 turns about the view axis, clockwise from the top');
assert.equal(selectedCoords(typed('rotate', ['- 4 5'], identity, { x: 100, y: 0 }).bm), expect(spin(45)), 'R -45');

r = typed('resize', ['2'], identity, { x: 100, y: 0 });
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x * 2, y * 2, 1]), 'S 2 scales all axes about the median point');
assert.equal(r.t.header, 'Scale X: [2|] = 2   Y: [2|] = 2  Z: [2|] = 2 ', 'untyped components follow the first');
r = typed('resize', [axis('AXIS_X'), '2'], identity, { x: 100, y: 0 });
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x * 2, y, z]), 'S X 2');
assert.equal(r.t.header, 'Scale: [2|] = 2 along global X ');
assert.equal(selectedCoords(typed('resize', [axis('PLANE_Z'), '0']).bm), expect(([, , z]) => [0, 0, z]), 'S Shift Z 0 flattens onto the Z axis');

// Ctrl snaps to whole units (a tenth with Shift) and the mouse gives the value again once Backspace clears it.
r = typed('translate', []);
r.t.update(123, 0, { ctrlKey: true });
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x + 1, y, z]), 'Ctrl snaps to 1');
r.t.update(0, 0, { ctrlKey: true, shiftKey: true });
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x + 1.2, y, z]), 'Shift Ctrl snaps to 0.1');
type(r.t, '5');
assert.equal(selectedCoords(r.bm), expect(([x, y, z]) => [x + 5, y, z]), 'typing replaces the mouse');
r.t.cancel();
assert.equal(selectedCoords(r.bm), expect((p) => p), 'cancel restores');
// G G 0.5: Edge Slide takes a typed factor too.
const slid = (fn) => { const b = cube(); for (let v = 0; v < b.v.size; v++) if (b.v.co[v * 3] > 0 && b.v.co[v * 3 + 1] > 0) BM_vert_select_set(b, v, true); BM_mesh_select_mode_flush(b); fn(b); return coords(b) + ''; };
let header;
const typedSlide = slid((b) => { const s = beginEdgeSlide(b, identity, top, { x: 0, y: -50 }); type(s, '. 5'); header = s.header; });
assert.ok([0.5, -0.5].some((value) => slid((b) => edge_slide_exec(b, { value })) === typedSlide), 'G G .5 slides half way');
assert.equal(header, 'Edge Slide: [.5|] = 0.5');
console.log('Transform values: typed values, negation, Tab, orientation cycling, rotate, scale and edge slide values and increments passed');
