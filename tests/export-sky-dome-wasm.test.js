// A code-built scene's sky dome reaches its exported page as the app renders it (Dusk Coast's Sky): the app shows it only
// in rendered views, so the export writes the world as a rendered view has it, and the page draws the dome and the
// probe that bakes it.
import assert from 'node:assert/strict';
import { NullEngine, Scene, FreeCamera, MeshBuilder, Mesh, ReflectionProbe, Vector3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';

const scene = new Scene(new NullEngine());
const camera = new FreeCamera('Camera', new Vector3(0, 2, -8), scene);
const dome = Object.assign(MeshBuilder.CreateSphere('Sky', { diameter: 100, sideOrientation: Mesh.BACKSIDE }, scene), { infiniteDistance: true });
const probe = new ReflectionProbe('Sky Probe', 16, scene);
probe.renderList.push(dome);
scene.environmentTexture = probe.cubeTexture;
const animation = createAnimationModel(), objects = Object.assign([dome, asObject(camera)], { scene }), world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.worlds = createWorlds(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);
world.worlds.setViewportActive(false);
assert.equal(dome.isEnabled(false), false, 'the app hides the dome outside rendered views');

const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene.getMeshByName('Sky');
assert.ok(page.isEnabled(false), 'the page draws the dome');
assert.equal(blend.scene.environmentTexture, blend.scene.reflectionProbes[0].cubeTexture, 'and lights with the probe that bakes it');
blend.dispose();
written.remove();
console.log('Export: a sky dome reaches the page as the app renders it');
process.exit(0);
