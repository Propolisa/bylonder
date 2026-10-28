import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { primitiveOperators, primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../src/bmesh/intern/bmesh-mesh-convert.js';
import { hasOperator } from '../src/bmesh/bmesh-wasm.js';

const dir = 'tests/fixtures/mesh/';
const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance;
let compared = 0;
// Primitives whose element order differs from Blender's, with the reason: compared as geometry (positions, edge set).
const KNOWN_ORDER = { 'uv-sphere': "Blender's UV sphere orders its faces and edges differently after its spin and merge", 'uv-sphere-small': "same" };
const edgeSet = (edges) => new Set(Array.from({ length: edges.length / 2 }, (_, i) => [edges[i * 2], edges[i * 2 + 1]].sort((a, b) => a - b).join('-')));
for (const file of await readdir(dir)) {
  const fixture = JSON.parse(await readFile(dir + file, 'utf8'));
  if (fixture.edit || !(primitiveOperators[fixture.operator] || hasOperator(fixture.operator))) continue;
  const mesh = primitive_add(fixture.operator, fixture.props);
  const name = file.replace('.json', '');
  assert.equal(mesh.verts_num, fixture.positions.length, name + ': vertex count');
  fixture.positions.forEach((p, v) => p.forEach((x, a) => assert.ok(near(mesh.vert_positions[v * 3 + a], x), `${name}: vertex ${v} ${mesh.vert_positions.subarray(v * 3, v * 3 + 3)} vs ${p}`)));
  if (KNOWN_ORDER[name]) {
    assert.deepEqual([...edgeSet(mesh.edges)].sort(), [...edgeSet(fixture.edges.flat())].sort(), name + ': edge set');
    assert.equal(mesh.faces_num, fixture.face_offsets.length - 1, name + ': face count');
    compared++;
    continue;
  }
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
assert.ok(compared >= 18);
console.log(`Mesh: ${compared - Object.keys(KNOWN_ORDER).length} primitives match Blender 5.2 exactly (topology, order, positions, UVs) and round-trip through BMesh; ${Object.keys(KNOWN_ORDER).length} match as geometry (${KNOWN_ORDER['uv-sphere']})`);

// Babylon sees the same outward faces: its own normals from our winding point the way ours do.
import { mesh_batch_cache_vertex_data, mesh_batch_cache_edge_detection } from '../src/draw/mesh-batch-cache.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
const data = mesh_batch_cache_vertex_data(primitive_add('mesh.primitive_cube_add'));
const computed = [];
VertexData.ComputeNormals(data.positions, data.indices, computed);
for (let i = 0; i < data.normals.length; i++) assert.ok(near(computed[i], data.normals[i], 1e-4), 'Babylon winding matches normals at ' + i);
assert.ok(data.positions.length === 24 * 3 && data.indices.length === 36);
console.log('Mesh: draw cache maps Blender axes onto Babylon with outward winding');

// The outline's X-ray prepass: the cube's 12 edges and 6 face diagonals, each between two triangles, across the
// face corners Babylon splits its vertices into.
const adjacency = mesh_batch_cache_edge_detection({ getIndices: () => data.indices, getVerticesData: () => data.positions });
assert.equal(adjacency.length, 18 * 4);
for (let e = 0; e < 18; e++) assert.notDeepEqual(data.positions.subarray(adjacency[e * 4] * 3, adjacency[e * 4] * 3 + 3), data.positions.subarray(adjacency[e * 4 + 3] * 3, adjacency[e * 4 + 3] * 3 + 3), 'edge ' + e + ' has two triangles');
console.log('Mesh: edge detection pairs every edge of the cube with both its triangles');
