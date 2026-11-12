// An instanced object of several material slots draws each slot's faces in its material, as its source does: a cube
// whose top is Red and the rest Blue, instanced twice (tests/fixtures/objects/instanced-slots.blend, written by
// tools/blender-reference/instanced-slots-fixture.py).
import assert from 'node:assert/strict';
import { openExample } from './open-example.js';

const { scene, sync } = openExample(new URL('./fixtures/objects/instanced-slots.blend', import.meta.url));
sync.view();
const [cubes] = scene.meshes.filter((m) => m.name.startsWith('__instances'));
assert.equal(cubes.thinInstanceCount, 2);
assert.deepEqual(cubes.subMeshes.map((s) => [s.getMaterial()?.name, s.indexCount]), [['Blue', 30], ['Red', 6]], "each slot's faces in its material");
console.log('Instances: an instanced object draws each material slot in its material');
