// A camera whose Look At point is keyed loads in its exported page and looks where the app's does (Island's flight):
// Babylon writes no camera's locked target, so the page animates the point whole, as a component alone has nothing to set.
import assert from 'node:assert/strict';
import { NullEngine, Scene, TargetCamera, Vector3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { bindProperties, registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';

const scene = new Scene(new NullEngine());
const camera = Object.assign(new TargetCamera('Camera', new Vector3(0, 2, -8), scene), { lockedTarget: new Vector3(0, 1, 0) });
const animation = createAnimationModel(), objects = Object.assign([asObject(camera)], { scene }), world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);
animation.time.configure({ frameStart: 1, frameEnd: 20 });
const x = bindProperties(animation, camera, { id: 'camera', properties: { lockedTarget: { label: 'Look At' } } }).ref('lockedTarget.x');
animation.insert([x], 1, 0);
animation.insert([x], 20, 4);
animation.seek(1);

const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene.getCameraByName('Camera'), group = blend.scene.animationGroups[0];
group.start(false, 1, 20, 20);
group.goToFrame(20);
assert.ok(Math.abs(page.lockedTarget?.x - 4) < 1e-3, 'the page looks at the last key');
blend.dispose();
written.remove();
console.log('Export: a keyed Look At point loads and aims the page camera');
process.exit(0);
