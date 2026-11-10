// A default pipeline's effects keep their settings through the export (Still Life's and Orrery's depth of field, Lumen's
// chromatic aberration): Babylon serializes only which effects are on, so a page drew them at their defaults.
import assert from 'node:assert/strict';
import { ArcRotateCamera, DefaultRenderingPipeline, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { parsedPipeline, serializePipeline } from '../src/overrides/babylon/pipeline-effects.js';

const engine = new NullEngine({ renderWidth: 480, renderHeight: 270, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
const cameraOf = (scene) => new ArcRotateCamera('Camera', 0, 1, 5, Vector3.Zero(), scene);

const app = new Scene(engine), lens = new DefaultRenderingPipeline('Lens', true, app, [cameraOf(app)]);
Object.assign(lens, { depthOfFieldEnabled: true, chromaticAberrationEnabled: true });
Object.assign(lens.depthOfField, { focalLength: 60, fStop: 2.2, lensSize: 50, focusDistance: 960 });
lens.chromaticAberration.aberrationAmount = 8;
lens.chromaticAberration.direction.set(0.5, 0.25);
const entry = JSON.parse(JSON.stringify(serializePipeline(lens)));

const scene = new Scene(engine);
cameraOf(scene);
const page = parsedPipeline(DefaultRenderingPipeline.Parse(entry, scene, ''), entry);
const { focalLength, fStop, lensSize, focusDistance } = page.depthOfField;
assert.deepEqual({ focalLength, fStop, lensSize, focusDistance }, { focalLength: 60, fStop: 2.2, lensSize: 50, focusDistance: 960 }, 'depth of field');
assert.equal(page.chromaticAberration.aberrationAmount, 8, 'chromatic aberration');
assert.deepEqual(page.chromaticAberration.direction.asArray(), [0.5, 0.25], 'its direction');
console.log("Pipeline effects: a default pipeline's effect settings reach the page");
process.exit(0);
