// The extras overlay draws a light's shape at its object's world matrix: a rotated Area light's rectangle lies in its
// object's XY plane and its line points down its -Z, as Blender's overlay_light.hh draws it.
import assert from 'node:assert/strict';
import { FreeCamera, Matrix, NullEngine, Quaternion, Scene, Vector3 } from '@babylonjs/core';
import { createLight } from '../src/blenkernel/light/light-home.js';
import { setEvaluatedMatrix } from '../src/runtime/object-transform.js';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { createExtrasOverlay } from '../src/draw/overlay-extra.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 5, -10), scene).setTarget(Vector3.Zero());
const area = createLight('Area', 'AREA', { size: 2 }, scene);
// Blender's matrix_world (column-major, as Main gives it): 90 degrees about X, at (1, 2, 3).
const blender = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2), new Vector3(1, 2, 3));
setEvaluatedMatrix(area, babylonMatrix(Array.from(blender.m)));
const overlay = createExtrasOverlay(scene, { objects: () => [] });
overlay.setEnabled(true);
const square = overlay.meshes.find((mesh) => mesh.metadata.extra.shape === 'light_area_square_lines');
for (let i = 0; i < 20 && !square.material.getEffect()?.isReady(); i++) { scene.render(); await new Promise((r) => setTimeout(r, 50)); }
scene.render();
// The shape's matrix in Blender's axes, columns x, y, z, location.
const m = Array.from(square.metadata.extra.matrix, (v) => Math.round(v * 1e6) / 1e6 + 0);
const column = (i) => m.slice(i * 4, i * 4 + 3);
assert.deepEqual(column(0), [1, 0, 0], "the rectangle's width along the object's X");
assert.deepEqual(column(1), [0, 0, 1], "its height along the object's Y, turned up to the world's Z");
assert.deepEqual(column(2), [0, -1, 0], "it faces the object's Z, turned to the world's -Y");
assert.deepEqual(column(3), [1, 2, 3], "at the object's location");
console.log('Extras overlay: a rotated Area light drawn at its object matrix passed');
