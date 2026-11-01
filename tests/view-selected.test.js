// view3d.view_selected (navigation.js frame): the view centers the selected objects' bounds, not their origins, and fits
// their longest side as view3d_from_minmax does (a text object's origin is at its first letter's baseline).
import assert from 'node:assert/strict';
import { ArcRotateCamera, MeshBuilder, NullEngine, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { createNavigation, LENS_HALF_TAN } from '../src/editors/space_view3d/navigation.js';

globalThis.window = new EventTarget();
const scene = new Scene(new NullEngine());
const camera = new ArcRotateCamera('view', 0, 1, 10, Vector3.Zero(), scene);
camera.attachControl = () => {};
const canvas = { clientWidth: 1600, clientHeight: 800 };
const nav = createNavigation({ camera, engine: scene.getEngine(), canvas, capture: {} });
const close = (a, b) => Math.abs(a - b) < 1e-5;

const text = MeshBuilder.CreateBox('Text', { width: 2, height: 0.1, depth: 0.7 }, scene);
text.bakeTransformIntoVertices(text.getWorldMatrix().clone().setTranslation(new Vector3(1, 0, 0.35)));
nav.frame([text]);
assert(Vector3.Distance(camera.target, new Vector3(1, 0, 0.35)) < 1e-5, `the view centers the text's bounds: ${camera.target}`);
assert(close(camera.radius, (2 / 2) * 1.4 / LENS_HALF_TAN * 2), `the view fits the text's width: ${camera.radius}`);

const empty = new TransformNode('Empty', scene);
empty.position.set(4, 0, 0);
nav.frame([text, empty]);
assert(close(camera.target.x, 2), `the view centers both objects: ${camera.target}`);
console.log('view selected ok');
