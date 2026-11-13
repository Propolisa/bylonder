// followCamera (runtime/character/camera.js): the scene's camera starts behind the character looking at a point above
// it, keeps its distance as it moves, and the default input then walks it away from the camera.
import assert from 'node:assert/strict';
import { NullEngine, Scene, TransformNode, Vector3, MeshBuilder, FreeCamera } from '@babylonjs/core';
import { createMovement } from '../src/io_scene_babylon/runtime/character/movement.js';
import { followCamera } from '../src/io_scene_babylon/runtime/character/camera.js';
import { groundAxes } from '../src/io_scene_babylon/runtime/character/input.js';

for (const rightHanded of [false, true]) {
  const scene = new Scene(new NullEngine());
  scene.useRightHandedSystem = rightHanded;
  MeshBuilder.CreateGround('Floor', { width: 100, height: 100 }, scene).computeWorldMatrix(true);
  scene.activeCamera = new FreeCamera('Camera', new Vector3(0, 5, 5), scene);
  const node = new TransformNode('Hero', scene);
  node.rotationQuaternion = null;
  node.rotation.y = Math.PI / 2;
  const hero = { node, movement: createMovement(scene, { node }), dt: 1 / 60 };
  const orbit = followCamera(hero);
  const camera = scene.activeCamera, behind = camera.position.subtract(hero.movement.position);
  assert.ok(behind.x < -3.5 && Math.abs(behind.z) < 1e-6 && behind.y > 1, `behind it (facing +X): ${behind}`);
  const forward = new Vector3(), right = new Vector3();
  camera.computeWorldMatrix(true);
  groundAxes(scene, forward, right);
  assert.ok(forward.x > 0.999, `the camera's forward is the character's: ${forward}`);
  assert.ok(Math.abs(Vector3.Cross(forward, right).y) > 0.999, 'right is a quarter turn about up');
  for (let i = 0; i < 120; i++) { hero.movement.update(1 / 60, { move: new Vector3(2, 0, 0) }); scene.render(); }
  const after = camera.position.subtract(hero.movement.position);
  assert.ok(Math.abs(after.length() - orbit.distance) < 0.8, `follows at its distance: ${after.length()}`);
  scene.dispose();
}
console.log('character camera ok');
