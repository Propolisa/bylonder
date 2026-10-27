// Edit Mode on a 100k-face grid: the Mesh to BMesh round trip, and each operator with everything selected, timed
// apart from the conversion. usage: node bench/edit-mode.bench.js [runs]
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../src/bmesh/intern/bmesh-mesh-convert.js';
import { BM_mesh_elem_hflag_enable_all, BM_mesh_select_mode_flush, SCE_SELECT_FACE } from '../src/bmesh/intern/bmesh-marking.js';
import { BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT } from '../src/bmesh/intern/bmesh-class.js';
import { meshOperators, operatorPreview } from '../src/editors/mesh/editmesh-tools.js';

const runs = Number(process.argv[2] ?? 3);
const mesh = primitive_add('mesh.primitive_grid_add', { x_subdivisions: 317, y_subdivisions: 317 });

function selectedAll() {
  const bm = BM_mesh_bm_from_me(mesh);
  bm.selectmode = SCE_SELECT_FACE;
  BM_mesh_elem_hflag_enable_all(bm, BM_VERT | BM_EDGE | BM_FACE, BM_ELEM_SELECT);
  BM_mesh_select_mode_flush(bm);
  return bm;
}

// Median of runs, each on a fresh BMesh made outside the timing.
function time(fn) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const bm = selectedAll();
    const t = performance.now();
    fn(bm);
    times.push(performance.now() - t);
  }
  return times.sort((a, b) => a - b)[runs >> 1];
}

const ms = (x) => `${x.toFixed(1)} ms`;
console.log(`grid: ${mesh.faces_num} faces, ${mesh.verts_num} verts`);
console.log(`Mesh to BMesh  ${ms(time(() => BM_mesh_bm_from_me(mesh)))}`);
console.log(`BMesh to Mesh  ${ms(time((bm) => BM_mesh_bm_to_me(bm)))}`);
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
  if (!meshOperators[name]) continue;
  try {
    console.log(`${name.padEnd(30)} ${ms(time((bm) => meshOperators[name](bm, props)))}`);
  } catch (error) {
    console.log(`${name.padEnd(30)} failed: ${error.message.split('\n')[0]}`);
  }
}

// A modal tool's step: its preview re-run from the edit mesh as it was, after the first.
for (const [name, props] of operators.filter(([name]) => /bevel|inset/.test(name))) {
  const bm = selectedAll(), preview = operatorPreview(bm, name);
  preview(props);
  const times = Array.from({ length: runs }, () => { const t = performance.now(); preview(props); return performance.now() - t; });
  console.log(`${(name + ' preview').padEnd(30)} ${ms(times.sort((a, b) => a - b)[runs >> 1])}`);
}
