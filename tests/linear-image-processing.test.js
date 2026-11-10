// A scene's own pipeline displays once in a rendered view, as Blender does (Dusk Coast's, Orrery's and Still Life's
// Lens): its image processing passes scene linear on to the display transform while the scene's image processing applies
// by post process, and applies as Babylon's otherwise.
import assert from 'node:assert/strict';
import { ArcRotateCamera, DefaultRenderingPipeline, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import '../src/overrides/babylon/linear-image-processing.js';

const scene = new Scene(new NullEngine());
const camera = new ArcRotateCamera('Camera', 0, 1, 5, Vector3.Zero(), scene);
const pipeline = new DefaultRenderingPipeline('Lens', true, scene, [camera]);
const ip = scene.imageProcessingConfiguration;
Object.assign(ip, { toneMappingEnabled: true, exposure: 1.4, contrast: 1.1 });
const defines = () => pipeline.imageProcessing.getEffect().defines;
ip.applyByPostProcess = true;
assert.doesNotMatch(defines(), /IMAGEPROCESSING;|FROMLINEARSPACE|TONEMAPPING 1|EXPOSURE|CONTRAST/, 'scene linear passes through');
ip.applyByPostProcess = false;
assert.match(defines(), /FROMLINEARSPACE/, "Babylon's otherwise");
console.log("Linear image processing: a scene's pipeline displays once in a rendered view");
process.exit(0);
