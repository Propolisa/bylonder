// A render target that is its scene's environment (a reflection probe's cube) draws the scene without it, as WebGPU
// rejects a pass whose materials sample the texture it draws into, and is the environment again after.
import assert from 'node:assert/strict';
import { NullEngine, ReflectionProbe, Scene } from '@babylonjs/core';
import '../src/overrides/babylon/environment-probe.js';

const scene = new Scene(new NullEngine());
const probe = new ReflectionProbe('Room Probe', 16, scene), cube = probe.cubeTexture, during = [];
cube.onBeforeRenderObservable.add(() => during.push(scene.environmentTexture));
scene.environmentTexture = cube;
cube.render();
assert.ok(during.length && during.every((texture) => texture === null), 'drawn without the environment');
assert.equal(scene.environmentTexture, cube, 'the environment again after');
console.log('Environment probe: a probe that is the environment draws the scene without itself');
