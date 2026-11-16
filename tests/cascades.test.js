// A cascaded sun's shadow fitted to the depth the view shows (runtime/cascades.js): looking down on a ground 10 m below,
// the cascades end a little past the ground, not at the camera's far plane, in two cascades where one 2048 map covers
// the range finely, and follow the camera when it moves, back to the exported four for a range too long for two.
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
const generator = Object.create(CascadedShadowGenerator.prototype, { shadowMaxZ: { value: camera.maxZ, writable: true }, numCascades: { value: 4, writable: true }, mapSize: { value: 2048 } });
sun.getShadowGenerator = () => generator;
const stop = fitCascades(scene);
scene.render();
assert.ok(generator.shadowMaxZ > 9 && generator.shadowMaxZ < 15, `the cascades end at the ground the view shows: ${generator.shadowMaxZ}`);
assert.equal(generator.numCascades, 2, 'two cascades cover it');
camera.position.y = 20;
scene.render();
assert.ok(generator.shadowMaxZ > 19 && generator.shadowMaxZ < 30, `and follow the camera: ${generator.shadowMaxZ}`);
assert.equal(generator.numCascades, 2);
camera.position.y = 40;
scene.render();
assert.equal(generator.numCascades, 4, 'a longer range keeps the exported four');
stop();
console.log('cascades: a sun\'s cascades end where the view\'s scene does, refitted as the camera moves');
