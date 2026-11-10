import assert from 'node:assert/strict';
import { Camera, FreeCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { orthoScaled } from '../src/io_scene_babylon/runtime/ortho-scale.js';
import { RUNTIME_FILES } from '../src/io_scene_babylon/runtime-files.js';

// An exported orthographic camera spans its Orthographic Scale over the longer side of the canvas, whatever its size.
const sceneOf = (renderWidth, renderHeight) => new Scene(new NullEngine({ renderWidth, renderHeight, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 }));
const bounds = (scene) => {
  const camera = orthoScaled(Object.assign(new FreeCamera('Camera', Vector3.Zero(), scene), { mode: Camera.ORTHOGRAPHIC_CAMERA, metadata: { orthoScale: 6 } }));
  return [camera.orthoLeft, camera.orthoRight, camera.orthoBottom, camera.orthoTop];
};
assert.deepEqual(bounds(sceneOf(400, 800)), [-1.5, 1.5, -3, 3], 'portrait: the scale spans the height');
assert.deepEqual(bounds(sceneOf(800, 400)), [-3, 3, -1.5, 1.5], 'landscape: the scale spans the width');
const scene = sceneOf(800, 400);
const perspective = orthoScaled(new FreeCamera('Perspective', Vector3.Zero(), scene));
assert.equal(perspective.orthoLeft, null, 'a perspective camera keeps its own bounds');
assert.ok(RUNTIME_FILES.includes('ortho-scale.js'), 'every package ships it');
console.log('Ortho scale: exported orthographic cameras span their scale over the canvas\'s longer side');
