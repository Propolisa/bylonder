// A camera turned by its animation turns in its exported page as in the app (Dusk Coast's flight): the page animates its
// rotation as a quaternion, which Babylon's parser does not give a camera; the page gives it one.
import assert from 'node:assert/strict';
import { NullEngine, Scene, FreeCamera, Quaternion, Vector3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { asObject } from '../src/runtime/object-transform.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';

const scene = new Scene(new NullEngine());
const camera = Object.assign(new FreeCamera('Camera', new Vector3(0, 2, -8), scene), { rotationQuaternion: Quaternion.Identity() });
const animation = createAnimationModel(), objects = Object.assign([asObject(camera)], { scene }), world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
world.renderSettings = createRenderSettings(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
registerObjects(animation, objects);
animation.time.configure({ frameStart: 1, frameEnd: 20 });
const yaw = animation.ref('object:Camera', 'rotation.y');
animation.insert([yaw], 1, 0);
animation.insert([yaw], 20, 1);
animation.seek(1);

const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene.getCameraByName('Camera');
const turn = blend.scene.animationGroups.flatMap((g) => g.targetedAnimations).find((t) => t.target === page && t.animation.targetProperty === 'rotationQuaternion');
assert.ok(turn, "the camera's turn is a quaternion animation");
assert.ok(page.rotationQuaternion, 'which the page camera has');
blend.playhead.pause();
blend.playhead.seek(20);
assert.ok(Math.abs(page.rotationQuaternion.toEulerAngles().y - 1) < 1e-3, 'turned at the last frame');
blend.dispose();
written.remove();
console.log('Export: an animated camera turns in the page');
process.exit(0);
