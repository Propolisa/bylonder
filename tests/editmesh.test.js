import assert from 'node:assert/strict';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../src/bmesh/intern/bmesh-mesh-convert.js';
import { BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_elem_flag_test } from '../src/bmesh/intern/bmesh-class.js';
import { Matrix, Vector3 } from '@babylonjs/core';
import { beginMeshTransform } from '../src/editors/transform/transform-mesh.js';
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
  camera: { mode: 1, orthoTop: 5, orthoBottom: -5, getDirection: (v) => (v.z === 1 ? new Vector3(0, -1, 0) : v.y === 1 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)) },
  canvas: { clientHeight: 1000 },
  project: (p) => ({ x: p.x * 100, y: -p.z * 100 }),
};
const identity = { computeWorldMatrix: () => Matrix.Identity() };
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
t.constrain('y', false);
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
t.constrain('x', true);
assert.ok(moved(bm, (sel, [x, y]) => !sel || Math.abs(x) === 1 && Math.abs(y) === 2).every(Boolean), 'Shift X scales across the YZ plane');
console.log('Edit Mode transform: move, axis constraint, rotate, scale, plane constraint and cancel passed');
