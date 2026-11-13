// An object disabled in viewports (Object > Visibility > Viewports off, as a rig's render-only meshes: Snow's eyes) is
// not drawn in the 3D Viewport, as in Blender, and is drawn again when enabled. Before, the app drew it.
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
const body = blendData().objects.get('Body'), node = world.objects.find((n) => n.name === 'Body');
assert.equal(node.isVisible, true, 'drawn while enabled');
body.hide_viewport = true;
sync.view();
assert.equal(node.isVisible, false, 'not drawn while disabled in viewports');
body.hide_viewport = false;
sync.view();
assert.equal(node.isVisible, true, 'drawn again when enabled');
console.log('Viewport disabled: an object disabled in viewports is not drawn, as in Blender');
process.exit(0);
