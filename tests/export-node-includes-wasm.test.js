// A node material whose blocks emit Babylon's helperFunctions include (a TransformBlock of a direction, as the Materials
// example's) loads in its exported page: the page imports the include, which the blocks use without importing.
import assert from 'node:assert/strict';
import { NullEngine, Scene, FreeCamera, MeshBuilder, NodeMaterial, Vector3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const scene = new Scene(new NullEngine());
const camera = new FreeCamera('Camera', new Vector3(0, 2, -8), scene), surface = MeshBuilder.CreateGround('Surface', { width: 10, height: 10 }, scene);
const material = new NodeMaterial('Surface', scene);
material.setToDefault();
material.build();
surface.material = material;
const animation = createAnimationModel(), objects = Object.assign([surface, asObject(camera)], { scene }), world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.materials = createMaterialLibrary(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);

const files = await exportModule(world);
for (const language of ['Shaders', 'ShadersWGSL']) assert.match(String(files['scene.js']), new RegExp(`import '@babylonjs/core/${language}/ShadersInclude/helperFunctions.js'`), `the page imports ${language}/ helperFunctions`);
console.log('Export: a node material whose blocks emit helperFunctions loads in its page');
process.exit(0);
