import { createLight, createWorld } from '@workbench/sdk';
import { counter } from './src/counter.js';

// A project of several files: this entry, its modules in src/ and its text in content/.
export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  counter(scene);

  const camera = new BABYLON.FreeCamera('Camera', new BABYLON.Vector3(4, 3, -5), scene);
  camera.setTarget(new BABYLON.Vector3(0, 0.8, 0));
  camera.minZ = 0.1;

  const light = createLight('Light', 'POINT', { energy: 800, shadow_soft_size: 0.2 }, scene);
  light.position.set(2, 4, -2);
  createWorld(scene);
  return scene;
};
