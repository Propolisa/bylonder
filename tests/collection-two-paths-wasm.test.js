// A collection linked under two parents has a LayerCollection on each path, with flags of its own: excluded under one
// and included under the other, its objects are in the view layer, shown, and evaluated as Blender evaluates them
// (tests/fixtures/collection-two-paths.blend, from tools/blender-reference/collection-two-paths-fixture.py). Before,
// the first path's flags hid the rig, and Blender's depsgraph skipped its pose: bones kept the file's stored pose.
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { openExample } from './open-example.js';

const { world, sync, node } = openExample(new URL('./fixtures/collection-two-paths.blend', import.meta.url));
sync.view();
const status = world.collections.status(node('Rig'));
assert.ok(status.inLayer && status.visible, 'the rig is in the view layer through its included path, and shown');

const rig = blendData().objects.get('Rig');
assert.ok(rig.visible_get(), "Main's base shows the rig");
const matrix = (name) => Array.from(rig.pose.bones.get(name).matrix);
const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-5);

sync.frameChanged(1);
const start = matrix('Parent');
sync.frameChanged(10);
assert.ok(!near(matrix('Parent'), start), 'the animated bone is posed at the new frame');
assert.ok(near(matrix('Child'), matrix('Parent')), 'its child, with the same rest and no pose of its own, follows it');
console.log('A collection linked under two parents: its rig is shown and posed through the path that includes it');
process.exit(0);
