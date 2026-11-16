// A cascaded sun's shadow fitted to the depth the view shows (runtime/cascades.js): looking down on a ground 10 m below,
// the cascades end a little past the ground, not at the camera's far plane, and follow the camera when it moves.
import assert from 'node:assert/strict';
import { CascadedShadowGenerator, DirectionalLight, FreeCamera, MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { fitCascades } from '../src/io_scene_babylon/runtime/cascades.js';

const engine = new NullEngine(), scene = new Scene(engine);
const camera = Object.assign(new FreeCamera('Camera', new Vector3(0, 10, 0), scene), { minZ: 0.1, maxZ: 1000 });
camera.setTarget(new Vector3(0, 0, 0.001));
MeshBuilder.CreateGround('Ground', { width: 200, height: 200 }, scene);
MeshBuilder.CreateBox('Rock', { size: 1 }, scene);
const sun = new DirectionalLight('Sun', new Vector3(0.3, -1, 0.2), scene);
// A cascaded generator as the page parses one (a NullEngine supports none): its depth range is what is fitted.
const generator = Object.create(CascadedShadowGenerator.prototype, { shadowMaxZ: { value: camera.maxZ, writable: true } });
sun.getShadowGenerator = () => generator;
const stop = fitCascades(scene);
scene.render();
assert.ok(generator.shadowMaxZ > 9 && generator.shadowMaxZ < 15, `the cascades end at the ground the view shows: ${generator.shadowMaxZ}`);
camera.position.y = 20;
scene.render();
assert.ok(generator.shadowMaxZ > 19 && generator.shadowMaxZ < 30, `and follow the camera: ${generator.shadowMaxZ}`);
stop();
console.log('cascades: a sun\'s cascades end where the view\'s scene does, refitted as the camera moves');
