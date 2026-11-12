// A material with Fresnel parameters (Coast's sea) loads in its exported page: the page imports FresnelParameters,
// which Babylon's StandardMaterial parse reads through its class registry.
import assert from 'node:assert/strict';
import { NullEngine, Scene, FreeCamera, FresnelParameters, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const scene = new Scene(new NullEngine());
const camera = new FreeCamera('Camera', new Vector3(0, 2, -8), scene), sea = MeshBuilder.CreateGround('Sea', { width: 10, height: 10 }, scene);
sea.material = Object.assign(new StandardMaterial('Sea', scene), { emissiveFresnelParameters: new FresnelParameters({ bias: 0.2, power: 2 }) });
const animation = createAnimationModel(), objects = Object.assign([sea, asObject(camera)], { scene }), world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.materials = createMaterialLibrary(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);

const files = await exportModule(world);
assert.match(String(files['scene.js']), /import ['"]@babylonjs\/core\/Materials\/fresnelParameters\.js['"]/, 'the page imports FresnelParameters');
console.log('Export: a material with Fresnel parameters loads in its page');
process.exit(0);
