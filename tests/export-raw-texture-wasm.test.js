// A texture made from code reaches the exported page (Lumen's floor grid): Babylon's serializer leaves out a texture
// without a name, so the page drew the floor's emission without it.
import assert from 'node:assert/strict';
import { NullEngine, Scene, FreeCamera, MeshBuilder, RawTexture, StandardMaterial, Vector3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';

const scene = new Scene(new NullEngine());
const camera = new FreeCamera('Camera', new Vector3(0, 2, -8), scene), floor = MeshBuilder.CreateGround('Floor', { width: 10, height: 10 }, scene);
floor.material = new StandardMaterial('Grid', scene);
floor.material.emissiveTexture = RawTexture.CreateRGBATexture(new Uint8Array(4 * 4 * 4).fill(200), 4, 4, scene);
const animation = createAnimationModel(), objects = Object.assign([floor, asObject(camera)], { scene }), world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);

const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
assert.ok(blend.scene.getMaterialByName('Grid').emissiveTexture, 'the page draws the grid');
assert.equal(floor.material.emissiveTexture.name, '', "the app's texture keeps its name");
blend.dispose();
written.remove();
console.log('Export: a texture made from code reaches the page');
process.exit(0);
