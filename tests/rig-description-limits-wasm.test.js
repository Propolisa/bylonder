// A rig's custom properties carry their hard limits into its description (rig-description.js `properties_ui`), read
// from Blender's UI data (id_properties_ui), so the native runtime clamps animation and driver writes as Blender does
// (tests/fixtures/property-limits.blend, from tools/blender-reference/property-limits-fixture.py).
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { rigDescription } from '../src/io_scene_babylon/rig-description.js';
import { openExample } from './open-example.js';

const { sync } = openExample(new URL('./fixtures/property-limits.blend', import.meta.url));
sync.view();
const rig = rigDescription(blendData().objects.get('Rig'), [], () => null).objects.find((o) => o.name === 'Rig');
assert.deepEqual(rig.properties_ui, { slider: { min: -1, max: 2 } }, "the object's float slider, -1 to 2");
assert.deepEqual(rig.pose.bones.find((b) => b.name === 'Properties').properties_ui, { ik_parents: { min: 0, max: 3 } }, "the pose bone's int switch, 0 to 3");
console.log('Rig description: custom properties carry their hard limits (an object float, a pose bone int)');
process.exit(0);
