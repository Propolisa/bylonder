// Steering a character (runtime/character/movement.js steer, walkTo; input.js): walkTo brings it to a point and stops it
// there, its input given back; the default input moves it along the camera's view at locomotion's speeds and jumps on
// Space, once per press.
import assert from 'node:assert/strict';
import { NullEngine, Scene, TransformNode, Vector3, MeshBuilder, FreeCamera } from '@babylonjs/core';
import { createMovement, walkTo } from '../src/io_scene_babylon/runtime/character/movement.js';
import { defaultInput } from '../src/io_scene_babylon/runtime/character/input.js';

const DT = 1 / 60;
const scene = new Scene(new NullEngine());
MeshBuilder.CreateGround('Floor', { width: 100, height: 100 }, scene).computeWorldMatrix(true);
const node = new TransformNode('Hero', scene);
/** The part of a Character steering uses, ticked as the character's frame does (steps intent and movement). */
const hero = { node, movement: createMovement(scene, { node }), input: null, locomotion: { speeds: { walk: 1.2, run: 3.5 } } };
const tick = (seconds) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) hero.movement.update(DT, typeof hero.input === 'function' ? hero.input() : { move: Vector3.Zero() });
};

let arrived = false;
const own = () => ({ move: Vector3.Zero() });
hero.input = own;
const trip = walkTo(hero, new Vector3(3, 0, 4)).then(() => { arrived = true; });
tick(1);
const midway = hero.movement.velocity.length();
assert.ok(midway > 1.1 && midway <= 1.2 + 1e-6, `walks at the walk speed: ${midway}`);
tick(6);
await trip;
assert.ok(arrived, 'arrived');
assert.ok(Vector3.Distance(hero.movement.position, new Vector3(3, 0, 4)) < 0.05, `stopped on the point: ${hero.movement.position}`);
assert.equal(hero.input, own, 'input given back');

// The default input, the camera looking along -X: W walks toward -X; Shift runs; Space jumps once per press.
const camera = new FreeCamera('Camera', new Vector3(10, 2, 0), scene);
camera.setTarget(new Vector3(0, 2, 0));
scene.activeCamera = camera;
camera.computeWorldMatrix(true);
// A page's window, for its key events.
const page = new EventTarget();
for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[name] = page[name].bind(page);
const keys = (type, code) => globalThis.dispatchEvent(Object.assign(new Event(type), { code }));
hero.input = defaultInput(hero);
keys('keydown', 'KeyW');
tick(1);
assert.ok(hero.movement.velocity.x < -1.15 && Math.abs(hero.movement.velocity.z) < 1e-3, `W moves along the view: ${hero.movement.velocity}`);
keys('keydown', 'ShiftLeft');
tick(1);
assert.ok(hero.movement.velocity.x < -3.4, `Shift runs: ${hero.movement.velocity}`);
keys('keyup', 'KeyW');
keys('keyup', 'ShiftLeft');
keys('keydown', 'Space');
tick(DT);
assert.ok(!hero.movement.grounded, 'Space jumps');
tick(2);
assert.ok(hero.movement.grounded, 'held Space does not jump again');
hero.input.dispose();
console.log('character steer ok');
