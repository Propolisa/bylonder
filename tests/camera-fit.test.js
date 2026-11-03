// A camera frames its image as Blender's camera.cc fits it: Auto fits the sensor's width to the larger side, Horizontal
// and Vertical fit the sensor's width or height to that side, for landscape and portrait output alike.
import assert from 'node:assert/strict';
import { Camera, FreeCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { setCameraLens } from '../src/blenkernel/scene/camera-fit.js';

const camera = new FreeCamera('Camera', Vector3.Zero(), new Scene(new NullEngine()));
const fov = (sensor, lens) => 2 * Math.atan(sensor / 2 / lens);
const LANDSCAPE = { width: 1920, height: 1080 }, PORTRAIT = { width: 256, height: 384 };
for (const [fit, size, vertical, sensor] of [
  ['AUTO', LANDSCAPE, false, 36], ['AUTO', PORTRAIT, true, 36],
  ['HORIZONTAL', LANDSCAPE, false, 36], ['HORIZONTAL', PORTRAIT, false, 36],
  ['VERTICAL', LANDSCAPE, true, 24], ['VERTICAL', PORTRAIT, true, 24],
]) {
  setCameraLens(camera, { sensor_fit: fit, sensor_width: 36, sensor_height: 24, lens: 50 }, size);
  const label = `${fit} at ${size.width}x${size.height}`;
  assert.equal(camera.fovMode, vertical ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED, label);
  assert.ok(Math.abs(camera.fov - fov(sensor, 50)) < 1e-9, label);
}
console.log('Camera fit: Auto, Horizontal and Vertical frame landscape and portrait output as Blender does passed');
