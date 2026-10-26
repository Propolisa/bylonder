import assert from 'node:assert/strict';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../src/bmesh/intern/bmesh-mesh-convert.js';
import { BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_elem_flag_test } from '../src/bmesh/intern/bmesh-class.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../src/bmesh/intern/bmesh-marking.js';
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
