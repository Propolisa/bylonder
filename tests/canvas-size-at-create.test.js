// A project's scene is made with the engine at its view's size (Still Life's glow layer, Dusk Coast's god rays): made
// on the app's 1 by 1 working canvas, their textures were empty, which WebGPU fails along with the frame's other passes
// (Still Life's and Orrery's Render Image drew black).
import assert from 'node:assert/strict';
import { GlowLayer, NullEngine, Scene } from '@babylonjs/core';
import { sizeToCanvas } from '../src/workspace/render-settings.js';

const engine = new NullEngine({ renderWidth: 1, renderHeight: 1, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
// The working canvas's size, as a canvas-backed engine reports what setSize gave it.
let size = [1, 1];
Object.assign(engine, { setSize: (w, h) => { size = [w, h]; }, getRenderWidth: () => size[0], getRenderHeight: () => size[1], getHardwareScalingLevel: () => 0.5 });
// As WebGPU's, which sizes textures without rounding to powers of two.
Object.defineProperty(engine, 'needPOTTextures', { value: false });
sizeToCanvas(engine, { clientWidth: 640, clientHeight: 360 });
assert.deepEqual(size, [1280, 720], 'device pixels of the view');
const glow = new GlowLayer('Flame Glow', new Scene(engine));
assert.deepEqual(glow._mainTextureDesiredSize, { width: 640, height: 360 }, "the glow layer's texture is the view's, at its ratio");
sizeToCanvas(engine, { clientWidth: 0, clientHeight: 0 });
assert.deepEqual(size, [1, 1], 'a view not laid out yet still gives a size');
console.log('Canvas size at create: a project sizes its render targets from its view');
process.exit(0);
