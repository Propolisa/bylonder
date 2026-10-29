import assert from 'node:assert/strict';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../src/bmesh/intern/bmesh-marking.js';
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

