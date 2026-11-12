// A rig's description carries the scene's Simplify (rig-description.js `scene.simplify`): its viewport Max Subdivision,
// which caps Subdivision and Multires levels in Blender's viewport and so in the meshes the export compares with (the
// Bar Scene's eyebrows: Subdivision level 1 under a Max Subdivision of 0 keeps their 216 vertices); null with it off.
import assert from 'node:assert/strict';
import { blendData, contextStruct } from '../src/python/bpy_rna.js';
import { rigDescription } from '../src/io_scene_babylon/rig-description.js';
import { openExample } from './open-example.js';

const { sync } = openExample('rigged-character');
const { render } = contextStruct().scene, rig = blendData().objects.get('Rig');
const described = () => rigDescription(rig, [], () => null).scene;
assert.deepEqual(described(), { simplify: null }, 'none with Simplify off');
Object.assign(render, { use_simplify: true, simplify_subdivision: 0, simplify_subdivision_render: 6 });
sync.view();
assert.deepEqual(described(), { simplify: { enabled: true, subdivision: 0 } }, "the viewport's Max Subdivision");
console.log("Rig description: the scene's Simplify carries its viewport Max Subdivision, none with it off");
process.exit(0);
