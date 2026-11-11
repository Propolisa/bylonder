// Production rigs' files export: a mesh's loose vertices and a bone shape's loose edges (which have no face corners, so
// no UVs) get a UV for every vertex Babylon draws, and a collection's custom property that is a group is left out
// while its numbers export. Fixture: tests/fixtures/io/loose-points.blend, made in Blender 5.2 (a quad with a loose
// vertex and a UV map, a mesh of two loose edges with a UV map, in a collection with `speed` = 1.5 and `settings`, a
// group).
import assert from 'node:assert/strict';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';

const { world, node } = openExample(new URL('./fixtures/io/loose-points.blend', import.meta.url));
for (const name of ['Quad', 'Wire']) {
  const mesh = node(name), uv = mesh.getVerticesData('uv');
  assert.ok(mesh.getTotalVertices() > 0, `${name} draws its points`);
  assert.equal(uv?.length, mesh.getTotalVertices() * 2, `${name}: a UV for each of its ${mesh.getTotalVertices()} vertices`);
}
assert.equal(node('Quad').getTotalVertices(), 5, 'four corners and the loose vertex');

const files = await exportModule(world);
const ir = JSON.parse(files['scene.ir.json']);
const props = Object.values(ir.collections ?? {}).find((c) => c.name === 'Props');
assert.ok(props, 'the collection exports');
assert.equal(props.custom?.speed, 1.5, 'its number exports');
assert.equal(props.custom?.settings, undefined, 'its group does not');
console.log('Loose points and grouped custom properties export');
process.exit(0);
