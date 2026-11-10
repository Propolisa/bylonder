// God rays in an exported page stream from their source as in the app (Dusk Coast's sun): Babylon parses them as a
// plain post process, without their samples or the pass that draws their mesh, whose shader does not compile; the
// page builds them as their class, with the settings and samples the app's have. Post-processing Off in File > Export's
// Branches leaves them out.
import assert from 'node:assert/strict';
import { NullEngine, Scene, FreeCamera, MeshBuilder, Vector3, VolumetricLightScatteringPostProcess } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';

const engine = new NullEngine(), scene = new Scene(engine);
const camera = new FreeCamera('Camera', new Vector3(0, 2, -8), scene), disc = MeshBuilder.CreateDisc('Sun Disc', {}, scene);
scene.activeCamera = camera;
const rays = Object.assign(new VolumetricLightScatteringPostProcess('God Rays', 0.5, camera, disc, 60, undefined, engine, false, scene), { decay: 0.97, exposure: 0.22 });
const animation = createAnimationModel(), objects = Object.assign([disc, asObject(camera)], { scene }), world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);
scene.render();

const files = await exportModule(world);
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const drawn = blend.scene.postProcesses.filter((pp) => pp.name === 'God Rays'), page = drawn[0];
assert.equal(drawn.length, 1, 'once');
assert.ok(page instanceof VolumetricLightScatteringPostProcess, 'the page draws them as god rays');
assert.equal(page.mesh?.name, 'Sun Disc', 'from their source');
assert.deepEqual([page.decay, page.exposure], [rays.decay, rays.exposure], 'with their settings');
assert.match(page.getEffect()?.defines ?? '', /NUM_SAMPLES 60/, 'and samples');
blend.dispose();
written.remove();
const off = await exportModule(world, { branches: { postProcessing: { state: 'OFF', instances: {} } } });
assert.match(off['scene.js'], /const POST_PROCESSES = \[\];/, 'Off ships no post-processes');
console.log('Export: god rays stream from their source in the page as in the app');
process.exit(0);
