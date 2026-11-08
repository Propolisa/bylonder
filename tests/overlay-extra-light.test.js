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
// A Spot light's blend circle sits where its own Spot Blend puts it (overlay_light.hh: the root of its attenuation).
const spot = createLight('Spot', 'SPOT', { spot_size: 1.0, spot_blend: 0.8, shadow_buffer_clip_start: 0.2 }, scene);
spot.position.set(0, 3, 0);
scene.render();
const cone = overlay.meshes.find((mesh) => mesh.metadata.extra.shape === 'light_spot_lines');
for (let i = 0; i < 20 && !cone.material.getEffect()?.isReady(); i++) { scene.render(); await new Promise((r) => setTimeout(r, 50)); }
scene.render();
const shape = Array.from(cone.metadata.extra.matrix), [a, b] = [Math.cos(0.5), 0.8], c = a * b - a - b;
assert.ok(Math.abs(shape[7] - Math.sqrt((a * a - a * a * c * c) / (c * c - a * a * c * c))) < 1e-6, 'the blend circle at its Spot Blend');
assert.ok(Math.abs(shape[11] - 0.2) < 1e-6, 'its clip start');
// A Spot light parented to a bone (Robot Arm's Work Light) points its cone down its evaluated -Z, not its local one.
const parented = createLight('Work Light', 'SPOT', {}, scene);
parented.direction = new Vector3(1, 0, 0);
setEvaluatedMatrix(parented, babylonMatrix(Array.from(blender.m)));
overlay.changed();
overlay.setEnabled(true);
scene.render();
const turned = overlay.meshes.find((mesh) => mesh.metadata.extra.entry.node === parented && mesh.metadata.extra.shape === 'light_spot_lines');
for (let i = 0; i < 20 && !turned.material.getEffect()?.isReady(); i++) { scene.render(); await new Promise((r) => setTimeout(r, 50)); }
scene.render();
const spotMatrix = Array.from(turned.metadata.extra.matrix, (v) => Math.round(v * 1e6) / 1e6 + 0);
assert.deepEqual(spotMatrix.slice(8, 11).map((v) => v / 10), [0, -1, 0], "the cone along the object's evaluated Z");
assert.deepEqual(spotMatrix.slice(12, 15), [1, 2, 3], "at the object's evaluated location");
console.log('Extras overlay: a rotated Area light drawn at its object matrix, a Spot light by its own settings and a parented one at its evaluated matrix passed');
