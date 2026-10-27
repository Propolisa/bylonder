// Edit Mode operators in Blender's own code (src/bmesh/bmesh-wasm.js) against Blender 5.2's results: every fixture of an
// operator the module has must match exactly.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { editMeshFromMesh, editMeshFree, editMeshOperators, meshFromEditMesh, select, selectClear, selectFlush } from '../src/bmesh/bmesh-wasm.js';

const dir = new URL('./fixtures/mesh/', import.meta.url);
// Select mode (SCE_SELECT_*) and element type (BM_*) per fixture select mode.
const SELECT = { VERT: [1, 1], EDGE: [2, 2], FACE: [4, 8] };
const near = (a, b) => Math.abs(a - b) < 1e-5;

const failures = [];
let matched = 0;
for (const file of await readdir(dir)) {
  const fixture = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
  if (!fixture.edit || !editMeshOperators[fixture.edit.operator] || (fixture.edit.pre && !editMeshOperators[fixture.edit.pre.operator])) continue;
  const bm = editMeshFromMesh(primitive_add(fixture.operator, fixture.props), SELECT[fixture.edit.select_mode][0]);
  for (const step of [fixture.edit.pre, fixture.edit].filter(Boolean)) {
    const [mode, htype] = SELECT[step.select_mode];
    selectClear(bm, mode);
    for (const i of step.select) select(bm, htype, i);
    selectFlush(bm);
    editMeshOperators[step.operator](bm, step.props);
  }
  const mesh = meshFromEditMesh(bm);
  editMeshFree(bm);
  const differs = [
    !(mesh.vert_positions.length === fixture.positions.length * 3 && fixture.positions.flat().every((x, i) => near(mesh.vert_positions[i], x))) && 'positions',
    JSON.stringify(Array.from(mesh.edges)) !== JSON.stringify(fixture.edges.flat()) && 'edges',
    JSON.stringify(Array.from(mesh.face_offsets)) !== JSON.stringify(fixture.face_offsets) && 'face offsets',
    JSON.stringify(Array.from(mesh.corner_verts)) !== JSON.stringify(fixture.corner_verts) && 'corner verts',
    JSON.stringify(Array.from(mesh.corner_edges)) !== JSON.stringify(fixture.corner_edges) && 'corner edges',
  ].filter(Boolean);
  if (differs.length) failures.push(`${file}: ${differs.join(', ')}`);
  else matched++;
}
assert.deepEqual(failures, [], `Edit Mode fixtures differ from Blender:\n${failures.join('\n')}`);
assert.ok(matched >= 8);
console.log(`Edit Mode in WebAssembly: ${matched} operator results match Blender 5.2 exactly (${Object.keys(editMeshOperators).length} operators)`);
