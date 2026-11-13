// A character's schedule (runtime/character/quality.js createSchedule): off screen it advances only its clocks and
// root, its pose left as last drawn; on tier C a small one (far from the camera) poses every other frame, the skipped
// time running with the next, so its clocks keep time; near, or on tier A, every frame.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, Vector3 } from '@babylonjs/core';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';

const DT = 1 / 60;
/** The basic rig with a skinned body mesh and a camera at `eye` looking at `target`. */
function make(eye, target = new Vector3(0, 1, 0)) {
  const blend = basicBlend(), { scene } = blend;
  const body = MeshBuilder.CreateBox('Body', { width: 0.5, height: 1.8, depth: 0.3 }, scene);
  body.position.y = 0.9;
  body.skeleton = scene.skeletons[0];
  const camera = new FreeCamera('camera', eye, scene);
  camera.setTarget(target);
  scene.activeCamera = camera;
  const hero = new Character(blend, 'Armature', { manual: true, idle: false });
  const walk = hero.action('Walk');
  hero.body.play(walk, { blend: 0 });
  const frame = () => { scene.updateTransformMatrix(true); hero.update(DT); };
  return { hero, walk, camera, frame };
}
const same = (a, b) => a.every((v, i) => v === b[i]);

{
  const { hero, walk, camera, frame } = make(new Vector3(0, 1.5, 4));
  for (let k = 0; k < 10; k++) frame();
  const drawn = Float32Array.from(hero.pose), time = walk.time;
  camera.setTarget(new Vector3(0, 1.5, 20));
  for (let k = 0; k < 30; k++) frame();
  assert.ok(same(hero.pose, drawn), 'off screen the pose is left as it was');
  assert.ok(Math.abs((((walk.time - time) % 1) + 1) % 1 - 30 * DT) < 1e-5, `its clock runs on (${(walk.time - time).toFixed(3)} s)`);
  camera.setTarget(new Vector3(0, 1, 0));
  frame();
  assert.ok(!same(hero.pose, drawn), 'back on screen it poses again');
}

for (const [quality, distance, every] of [['C', 60, 2], ['C', 4, 1], ['A', 60, 1]]) {
  Character.quality = quality;
  const { hero, walk, frame } = make(new Vector3(0, 1.5, distance));
  let posed = 0, last = Float32Array.from(hero.pose);
  const start = walk.time;
  for (let k = 0; k < 50; k++) { frame(); if (!same(hero.pose, last)) { posed++; last = Float32Array.from(hero.pose); } }
  assert.equal(posed, 50 / every, `tier ${quality} at ${distance} m poses ${50 / every} of 50 frames`);
  const ran = (((walk.time - start) % 1) + 1) % 1;
  assert.ok(Math.abs(ran - 50 * DT) < 1e-5, `and keeps time (${ran.toFixed(4)} s)`);
}
Character.quality = 'auto';
Character.tier = 'A';
console.log('character schedule: ok');
