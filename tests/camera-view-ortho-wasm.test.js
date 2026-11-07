// Camera view through an orthographic camera shows what Blender's does at the default camera zoom: the output's frame
// at half the region, so the region spans twice the Orthographic Scale; outside camera view the scale fills the view.
import assert from 'node:assert/strict';
import { Camera, NullEngine, Scene } from '@babylonjs/core';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { contextStruct, inPythonContext } from '../src/python/bpy_rna.js';

// A file with an orthographic camera of scale 4, made by Blender's own data API, then opened.
const main = new BlenderMain();
inPythonContext(main.C, () => {
  const C = contextStruct(), data = C.blend_data.cameras.new('Ortho');
  Object.assign(data, { type: 'ORTHO', ortho_scale: 4 });
  C.scene.collection.objects.link(C.blend_data.objects.new('Camera', data));
});
const bytes = main.writeBlend('/ortho.blend');
const scene = new Scene(new NullEngine());
const sync = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: createBlenderIDs(new BlenderMain()) });
const camera = sync.readBlend(bytes, scene).nodes.find((node) => node.name === 'Camera');
assert.equal(camera.mode, Camera.ORTHOGRAPHIC_CAMERA, 'the camera is orthographic');

const frame = sync.viewCamera(camera, { width: 1920, height: 1080 }, { width: 1920, height: 1080 });
assert.ok(Math.abs(frame.width - 0.5) < 1e-6, 'the frame takes half the region');
assert.ok(Math.abs(camera.orthoRight - 4) < 1e-4 && Math.abs(camera.orthoTop - 4 * 1080 / 1920) < 1e-4, `the region spans twice the scale: ${camera.orthoRight}, ${camera.orthoTop}`);
sync.fitCamera(camera, { width: 1920, height: 1080 });
assert.ok(Math.abs(camera.orthoRight - 2) < 1e-4, 'a render spans the scale');
console.log('Camera view: an orthographic camera frames its Orthographic Scale at half the region, as in Blender');
