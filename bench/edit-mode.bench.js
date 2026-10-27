// Edit Mode on a 100k-face grid: making the edit mesh, extracting its Mesh arrays (as every redraw does), and each
// operator with everything selected, then a modal tool's preview step. usage: node bench/edit-mode.bench.js [runs]
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { SCE_SELECT_FACE } from '../src/bmesh/intern/bmesh-marking.js';
import { EditMesh } from '../src/bmesh/bmesh-wasm.js';
import { meshOperator, operatorPreview } from '../src/editors/mesh/editmesh-tools.js';

const runs = Number(process.argv[2] ?? 3);
const mesh = primitive_add('mesh.primitive_grid_add', { x_subdivisions: 317, y_subdivisions: 317 });

function selectedAll() {
  const edit = EditMesh.fromMesh(mesh, SCE_SELECT_FACE);
  edit.run('mesh.select_all', { action: 'SELECT' });
  return edit;
}

// Median of runs, each on a fresh edit mesh made outside the timing.
function time(fn) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const edit = selectedAll();
    const t = performance.now();
    fn(edit);
    times.push(performance.now() - t);
    edit.free();
  }
  return times.sort((a, b) => a - b)[runs >> 1];
}

const ms = (x) => `${x.toFixed(1)} ms`;
console.log(`grid: ${mesh.faces_num} faces, ${mesh.verts_num} verts`);
console.log(`${'Mesh to edit mesh'.padEnd(30)} ${ms(time(() => EditMesh.fromMesh(mesh, SCE_SELECT_FACE).free()))}`);
console.log(`${'edit mesh to Mesh arrays'.padEnd(30)} ${ms(time((edit) => edit.toMesh()))}`);
const operators = [
  ['mesh.flip_normals', {}],
  ['mesh.normals_make_consistent', {}],
  ['mesh.vertices_smooth', {}],
  ['mesh.quads_convert_to_tris', {}],
  ['mesh.poke', {}],
  ['mesh.subdivide', {}],
  ['mesh.inset', { thickness: 0.01 }],
  ['mesh.extrude_region', {}],
  ['mesh.bevel', { offset: 0.01, affect: 'EDGES' }],
];
for (const [name, props] of operators) {
  try {
    console.log(`${name.padEnd(30)} ${ms(time((edit) => meshOperator(edit, name, props)))}`);
  } catch (error) {
    console.log(`${name.padEnd(30)} failed: ${error.message.split('\n')[0]}`);
  }
}

// A modal tool's step: its preview re-run from the edit mesh as it was, after the first.
for (const [name, props] of operators.filter(([name]) => /bevel|inset/.test(name))) {
  const edit = selectedAll(), preview = operatorPreview(edit, name);
  preview(props);
  const times = Array.from({ length: runs }, () => { const t = performance.now(); preview(props); return performance.now() - t; });
  console.log(`${(name + ' preview').padEnd(30)} ${ms(times.sort((a, b) => a - b)[runs >> 1])}`);
  edit.free();
}
