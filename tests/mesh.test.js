import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { primitiveOperators, primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../src/bmesh/intern/bmesh-mesh-convert.js';

const dir = 'tests/fixtures/mesh/';
const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance;
let compared = 0;
for (const file of await readdir(dir)) {
  const fixture = JSON.parse(await readFile(dir + file, 'utf8'));
  if (fixture.edit || !primitiveOperators[fixture.operator]) continue;
  const mesh = primitive_add(fixture.operator, fixture.props);
  const name = file.replace('.json', '');
  assert.equal(mesh.verts_num, fixture.positions.length, name + ': vertex count');
  fixture.positions.forEach((p, v) => p.forEach((x, a) => assert.ok(near(mesh.vert_positions[v * 3 + a], x), `${name}: vertex ${v} ${mesh.vert_positions.subarray(v * 3, v * 3 + 3)} vs ${p}`)));
  assert.deepEqual(Array.from(mesh.edges), fixture.edges.flat(), name + ': edges');
  assert.deepEqual(Array.from(mesh.face_offsets), fixture.face_offsets, name + ': face offsets');
  assert.deepEqual(Array.from(mesh.corner_verts), fixture.corner_verts, name + ': corner verts');
  assert.deepEqual(Array.from(mesh.corner_edges), fixture.corner_edges, name + ': corner edges');
  const uv = mesh.attribute('UVMap');
  fixture.uv?.forEach((p, c) => p.forEach((x, a) => assert.ok(near(uv[c * 2 + a], x), `${name}: uv ${c} ${uv.subarray(c * 2, c * 2 + 2)} vs ${p}`)));
  assert.deepEqual(Array.from(mesh.attribute('sharp_face') ?? [], Boolean), fixture.sharp_face, name + ': sharp faces');

  const round = BM_mesh_bm_to_me(BM_mesh_bm_from_me(mesh));
  for (const key of ['vert_positions', 'edges', 'face_offsets', 'corner_verts', 'corner_edges']) assert.deepEqual(round[key], mesh[key], name + ': round trip ' + key);
  compared++;
}
assert.ok(compared >= 13);
console.log(`Mesh: ${compared} primitives match Blender 5.2 exactly (topology, order, positions, UVs) and round-trip through BMesh`);

// Babylon sees the same outward faces: its own normals from our winding point the way ours do.
import { mesh_batch_cache_vertex_data } from '../src/draw/mesh-batch-cache.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
const data = mesh_batch_cache_vertex_data(primitive_add('mesh.primitive_cube_add'));
const computed = [];
VertexData.ComputeNormals(data.positions, data.indices, computed);
for (let i = 0; i < data.normals.length; i++) assert.ok(near(computed[i], data.normals[i], 1e-4), 'Babylon winding matches normals at ' + i);
assert.ok(data.positions.length === 24 * 3 && data.indices.length === 36);
console.log('Mesh: draw cache maps Blender axes onto Babylon with outward winding');

// Edit Mode operators on Blender's own selection, compared with Blender's result.
import { meshOperators } from '../src/editors/mesh/editmesh-tools.js';
import { BM_elem_select_set, BM_mesh_select_mode_flush, SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../src/bmesh/intern/bmesh-marking.js';
import { BM_VERT, BM_EDGE, BM_FACE } from '../src/bmesh/intern/bmesh-class.js';
const SELECT = { VERT: [SCE_SELECT_VERTEX, BM_VERT], EDGE: [SCE_SELECT_EDGE, BM_EDGE], FACE: [SCE_SELECT_FACE, BM_FACE] };
// Order-free form of a Mesh: vertices, edges and faces (winding kept) named by rounded position.
function geometry(positions, edges, face_offsets, corner_verts) {
  const key = (v) => Array.from(positions.slice(v * 3, v * 3 + 3), (x) => Math.round(x * 1e4) / 1e4 + 0).join(',');
  const faces = [];
  for (let f = 0; f + 1 < face_offsets.length; f++) {
    const ring = Array.from(corner_verts.slice(face_offsets[f], face_offsets[f + 1]), key);
    const start = ring.indexOf([...ring].sort()[0]);
    faces.push(ring.slice(start).concat(ring.slice(0, start)).join(' '));
  }
  const verts = Array.from({ length: positions.length / 3 }, (_, v) => key(v));
  const pairs = Array.from({ length: edges.length / 2 }, (_, e) => [key(edges[e * 2]), key(edges[e * 2 + 1])].sort().join(' '));
  return { verts: verts.sort(), edges: pairs.sort(), faces: faces.sort() };
}

// Operators whose resulting selection is compared with Blender's too.
const SELECTION_CHECKED = /select/;
let edited = 0, geometric = 0;
for (const file of await readdir(dir)) {
  const fixture = JSON.parse(await readFile(dir + file, 'utf8'));
  if (!fixture.edit) continue;
  const name = file.replace('.json', ''), { select_mode, select, operator, props, move } = fixture.edit;
  const bm = BM_mesh_bm_from_me(primitive_add(fixture.operator, fixture.props));
  const [mode, htype] = SELECT[select_mode];
  bm.selectmode = mode;
  for (const i of select) BM_elem_select_set(bm, htype, i, true);
  BM_mesh_select_mode_flush(bm);
  meshOperators[operator](bm, props);
  if (move) for (let v = 0; v < bm.v.size; v++) if (bm.v.alive[v] && bm.v.hflag[v] & 1) move.forEach((d, a) => (bm.v.co[v * 3 + a] += d));
  const mesh = BM_mesh_bm_to_me(bm);
  assert.equal(mesh.verts_num, fixture.positions.length, name + ': vertex count');
  if (SELECTION_CHECKED.test(operator) && fixture.selection) {
    const selected = (attr) => Array.from(mesh.attribute(attr) ?? [], Boolean).flatMap((x, i) => (x ? [i] : []));
    assert.deepEqual([selected('.select_vert'), selected('.select_edge'), selected('.select_poly')], fixture.selection, name + ': selection');
  }
  if (move) {
    assert.deepEqual(geometry(mesh.vert_positions, mesh.edges, mesh.face_offsets, mesh.corner_verts), geometry(fixture.positions.flat(), fixture.edges.flat(), fixture.face_offsets, fixture.corner_verts), name + ': geometry');
    geometric++;
    continue;
  }
  fixture.positions.forEach((p, v) => p.forEach((x, a) => assert.ok(near(mesh.vert_positions[v * 3 + a], x), `${name}: vertex ${v}`)));
  assert.deepEqual(Array.from(mesh.edges), fixture.edges.flat(), name + ': edges');
  assert.deepEqual(Array.from(mesh.face_offsets), fixture.face_offsets, name + ': face offsets');
  assert.deepEqual(Array.from(mesh.corner_verts), fixture.corner_verts, name + ': corner verts');
  assert.deepEqual(Array.from(mesh.corner_edges), fixture.corner_edges, name + ': corner edges');
  edited++;
}
assert.ok(edited >= 7 && geometric >= 7);
console.log(`Mesh: ${edited} Edit Mode operator results match Blender 5.2 exactly, ${geometric} extrudes match as geometry (Blender's order there varies by run)`);
