// A Blender camera frames its image as Blender's camera.cc fits it, computed by the module (main-api.cc
// camera_view_fov): Auto fits the sensor's width to the larger side, Horizontal and Vertical fit the sensor's width or
// height to that side, for landscape and portrait output alike; its lens settings stay Main's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Camera, NullEngine, Scene } from '@babylonjs/core';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createCurveObjects } from '../src/editors/curve/curve-objects.js';

// The gallery's .blend opened as a project's code opens it, then the world's slices and its scene sync.
const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(new BlenderMain()) });
const reader = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
const objects = reader.readBlend(new Uint8Array(readFileSync(new URL('../examples/shader-gallery/shader_gallery.blend', import.meta.url))), scene).nodes;
objects.scene = scene;
const world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => scene.cameras, get: () => scene.activeCamera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.worlds = createWorlds(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
world.curves = createCurveObjects(world);
registerObjects(animation, objects);
const rna = createRNA({ world, selection: createSelection(scene, objects) });
const sync = world.mainSync = createMainSync({ rna, ids: animation.ids });

const camera = scene.getCameraByName('Perspective'), data = rna.pointer('Camera', camera);
assert.equal(camera.metadata.wbHome, 'BLENDER', "a camera from a .blend is Blender's");
const fov = (sensor) => 2 * Math.atan(sensor / 2 / 50);
const LANDSCAPE = { width: 1920, height: 1080 }, PORTRAIT = { width: 256, height: 384 };
for (const [fit, size, vertical, sensor] of [
  ['AUTO', LANDSCAPE, false, 36], ['AUTO', PORTRAIT, true, 36],
  ['HORIZONTAL', LANDSCAPE, false, 36], ['HORIZONTAL', PORTRAIT, false, 36],
  ['VERTICAL', LANDSCAPE, true, 24], ['VERTICAL', PORTRAIT, true, 24],
]) {
  data.sensor_fit = fit;
  sync.fitCamera(camera, size);
  const label = `${fit} at ${size.width}x${size.height}`;
  assert.equal(camera.fovMode, vertical ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED, label);
  assert.ok(Math.abs(camera.fov - fov(sensor)) < 1e-5, `${label}: ${camera.fov}`);
  assert.equal(data.sensor_fit, fit, "the fit stays Main's");
}
console.log('Camera fit: Auto, Horizontal and Vertical frame landscape and portrait output as Blender computes them passed');
