// Blender's own Edit Mode operators in WebAssembly (src/bmesh/bmesh-wasm.js) against Blender 5.2's results: every fixture of an
// operator the module has must match exactly, UVs, sharp faces and selection included. ONLY=prefix runs the fixtures
// whose names start with it.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { editMeshFromMesh, editMeshFree, hasOperator, meshFromEditMesh, runOperator, select, selectClear, selectFlush } from '../src/bmesh/bmesh-wasm.js';

const dir = new URL('./fixtures/mesh/', import.meta.url);
// Select mode (SCE_SELECT_*) and element type (BM_*) per fixture select mode.
const SELECT = { VERT: [1, 1], EDGE: [2, 2], FACE: [4, 8] };
const near = (a, b) => Math.abs(a - b) < 1e-5;
const selected = (mesh, name) => Array.from(mesh.attribute(name), Boolean).flatMap((x, i) => (x ? [i] : []));

const failures = [];
let matched = 0;
// What of a fixture's result differs from Blender's; an error (a Blender function not in the module) is its difference.
function differences(fixture) {
  const bm = editMeshFromMesh(primitive_add(fixture.operator, fixture.props), SELECT[fixture.edit.select_mode][0]);
  try {
    for (const step of [fixture.edit.pre, fixture.edit].filter(Boolean)) {
      const [mode, htype] = SELECT[step.select_mode];
      selectClear(bm, mode);
      for (const i of step.select) select(bm, htype, i);
      selectFlush(bm);
      runOperator(bm, step.operator, step.props);
    }
  } catch (error) {
    return [error.message.split('\n')[0]];
  }
  const mesh = meshFromEditMesh(bm);
  editMeshFree(bm);
  return [
    !(mesh.vert_positions.length === fixture.positions.length * 3 && fixture.positions.flat().every((x, i) => near(mesh.vert_positions[i], x))) && 'positions',
    JSON.stringify(Array.from(mesh.edges)) !== JSON.stringify(fixture.edges.flat()) && 'edges',
    JSON.stringify(Array.from(mesh.face_offsets)) !== JSON.stringify(fixture.face_offsets) && 'face offsets',
    JSON.stringify(Array.from(mesh.corner_verts)) !== JSON.stringify(fixture.corner_verts) && 'corner verts',
    JSON.stringify(Array.from(mesh.corner_edges)) !== JSON.stringify(fixture.corner_edges) && 'corner edges',
    fixture.uv && !fixture.uv.flat().every((x, i) => near(mesh.attribute('UVMap')?.[i], x)) && 'UVs',
    fixture.sharp_face && fixture.sharp_face.some((sharp, i) => sharp !== Boolean(mesh.attribute('sharp_face')[i])) && 'sharp faces',
    fixture.selection && JSON.stringify(['.select_vert', '.select_edge', '.select_poly'].map((name) => selected(mesh, name))) !== JSON.stringify(fixture.selection) && 'selection',
  ].filter(Boolean);
}

for (const file of await readdir(dir)) {
  const fixture = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
  if (process.env.ONLY && !file.startsWith(process.env.ONLY)) continue;
  if (!fixture.edit || !hasOperator(fixture.edit.operator) || (fixture.edit.pre && !hasOperator(fixture.edit.pre.operator))) continue;
  const differs = differences(fixture);
  if (differs.length) failures.push(`${file}: ${differs.join(', ')}`);
  else matched++;
}
assert.deepEqual(failures, [], `Edit Mode fixtures differ from Blender:\n${failures.join('\n')}`);
assert.ok(process.env.ONLY || matched >= 8);
console.log(`Edit Mode in WebAssembly: ${matched} operator results match Blender 5.2 exactly, run by Blender's own operators`);
