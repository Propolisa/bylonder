// A pipeline's chromatic aberration measures its pixels on the image it draws (Lumen's Lens, made while the app's
// canvas had no size): Babylon kept the 1 by 1 screen it was made with, moving red and blue off the picture.
import assert from 'node:assert/strict';
import { ArcRotateCamera, DefaultRenderingPipeline, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import '../src/overrides/babylon/chromatic-aberration-size.js';

const engine = new NullEngine({ renderWidth: 1, renderHeight: 1, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
const scene = new Scene(engine);
const camera = new ArcRotateCamera('Camera', 0, 1, 5, Vector3.Zero(), scene);
const lens = new DefaultRenderingPipeline('Lens', true, scene, [camera]);
lens.chromaticAberrationEnabled = true;
assert.equal(lens.chromaticAberration.screenWidth, 1, 'made on a 1 by 1 screen');
// The image it then draws: a Render Image of 480 by 270.
Object.assign(engine, { getRenderWidth: () => 480, getRenderHeight: () => 270 });
// Its effect is never compiled here (blocked compilation): binding fails after it measures.
try { lens.chromaticAberration._effectWrapper.bind(); } catch {}
assert.deepEqual([lens.chromaticAberration.screenWidth, lens.chromaticAberration.screenHeight], [480, 270], 'drawn at the image size');
console.log('Chromatic aberration: measured on the image it draws');
process.exit(0);
