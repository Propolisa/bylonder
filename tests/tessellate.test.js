import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createMesh } from '../src/blenkernel/mesh/mesh.js';
import { BLI_polyfill_calc } from '../src/blenkernel/mesh/mesh-tessellate.js';

const dir = 'tests/fixtures/mesh/';
let compared = 0;
for (const file of await readdir(dir)) {
  const fixture = JSON.parse(await readFile(dir + file, 'utf8'));
  if (!fixture.corner_tris) continue;
  const mesh = createMesh({
    vert_positions: Float32Array.from(fixture.positions.flat()), edges: new Int32Array(),
    face_offsets: Int32Array.from(fixture.face_offsets), corner_verts: Int32Array.from(fixture.corner_verts), corner_edges: new Int32Array(),
  });
  assert.deepEqual(Array.from(mesh.corner_tris()), fixture.corner_tris.flat(), file + ': corner triangles');
  compared++;
}
assert.ok(compared >= 100);
console.log(`Tessellation: ${compared} meshes triangulate exactly as Blender 5.2 (Blender's corner_tris_calc in WebAssembly)`);

// The polygon filler alone: a concave arrow, its triangles as vertex indices.
const arrow = Float32Array.of(0, 0, 2, 0, 2, -1, 4, 1, 2, 3, 2, 2, 0, 2);
const tris = new Uint32Array(5 * 3);
BLI_polyfill_calc(arrow, 7, 0, tris);
const area = (a, b, c) => ((arrow[b * 2] - arrow[a * 2]) * (arrow[c * 2 + 1] - arrow[a * 2 + 1]) - (arrow[c * 2] - arrow[a * 2]) * (arrow[b * 2 + 1] - arrow[a * 2 + 1])) / 2;
const areas = Array.from({ length: 5 }, (_, t) => area(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]));
assert.ok(areas.every((a) => a < 0) || areas.every((a) => a > 0), 'one winding');
assert.equal(Math.abs(areas.reduce((a, b) => a + b)), 8);
console.log('Tessellation: BLI_polyfill_calc fills a concave polygon with its exact area');
