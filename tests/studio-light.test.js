// Material Preview's studio light turns as Blender's lookdev turns it (eevee_lookdev.cc rotate_world): by the view's
// studio light Rotation, fixed in the world unless it turns with the view (use_studiolight_view_rotation).
import assert from 'node:assert/strict';
import { FreeCamera, Matrix, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createWorldRenderer } from '../src/blenkernel/scene/world-babylon.js';

// The studio light's file never loads here: its orientation is what is tested.
globalThis.XMLHttpRequest ??= class { open() {} send() {} abort() {} addEventListener() {} removeEventListener() {} setRequestHeader() {} };
const scene = new Scene(new NullEngine());
const camera = new FreeCamera('View', new Vector3(0, 2, -5), scene);
camera.setTarget(Vector3.Zero());
const renderer = createWorldRenderer(scene, { studioLight: 'studio.env' });
renderer.setPreview(true);
const studio = scene.environmentTexture;
const near = (a, b) => a.m.every((v, i) => Math.abs(v - b.m[i]) < 1e-6);
const view = (studioSettings) => {
  renderer.setStudio(studioSettings);
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  return studio.getReflectionTextureMatrix();
};
assert.ok(near(view({ viewRotation: false, rotateZ: 0 }), Matrix.RotationY(-Math.PI / 2)), 'fixed in the world');
assert.ok(near(view({ viewRotation: false, rotateZ: 0.5 }), Matrix.RotationY(-Math.PI / 2 - 0.5)), 'turned by its Rotation');
const rotation = new Matrix();
camera.getViewMatrix().getRotationMatrixToRef(rotation);
assert.ok(near(view({ viewRotation: true, rotateZ: 0 }), rotation.multiply(Matrix.RotationY(-Math.PI / 2))), 'turning with the view');
renderer.setPreview(false);
console.log("Studio light: Material Preview's studio light is fixed in the world, or turns with the view, and by its rotation, as Blender's lookdev");
