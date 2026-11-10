// An object without a material draws in its exported page as in the app (City's Ground): Blender's default surface,
// where the page drew Babylon's white default.
import assert from 'node:assert/strict';
import { NullEngine, Scene, FreeCamera, MeshBuilder, Vector3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';

const scene = new Scene(new NullEngine());
const camera = new FreeCamera('Camera', new Vector3(0, 2, -8), scene), ground = MeshBuilder.CreateGround('Ground', { width: 10, height: 10 }, scene);
const animation = createAnimationModel(), objects = Object.assign([ground, asObject(camera)], { scene }), world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.materials = createMaterialLibrary(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);

const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
const app = scene.defaultMaterial, page = blend.scene.defaultMaterial;
assert.equal(page.getClassName(), app.getClassName(), "the page's default material is the app's");
assert.deepEqual(page.albedoColor.asArray(), app.albedoColor.asArray(), 'in its color');
blend.dispose();
written.remove();
console.log('Export: an object without a material draws as in the app');
process.exit(0);
