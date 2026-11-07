// Curve and text Edit Mode overlays draw in their own materials in Solid shading: Workbench, which gives the view's
// objects its lit material, leaves overlays alone, so a curve's handle lines do not fill as dark triangles.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createWorkbench } from '../src/draw/workbench.js';
import { createEditCurveOverlay } from '../src/draw/overlay-edit-curve.js';
import { createEditTextOverlay } from '../src/draw/overlay-edit-text.js';

const scene = new Scene(new NullEngine()), camera = new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
const curve = MeshBuilder.CreateBox('Swoosh', { size: 1 }, scene), text = MeshBuilder.CreateBox('Text', { size: 1 }, scene);
// A selected Bezier point with its handles.
const point = { co: [0, 0, 0], handle_left: [-1, 0, 0], handle_right: [1, 0, 1], handle_left_type: 'ALIGNED', handle_right_type: 'ALIGNED',
  select_control_point: true, select_left_handle: true, select_right_handle: true };
createEditCurveOverlay(curve).update({ splines: [{ bezier_points: [point, { ...point, co: [2, 0, 0] }] }] });
createEditTextOverlay(text);
const workbench = createWorkbench(scene);
workbench.setShading(camera, 'solid');
const overlays = scene.meshes.filter((mesh) => mesh.parent === curve || mesh.parent === text);
assert.equal(overlays.length, 4, 'the curve overlay lines, points and handle points, and the text overlay');
assert.ok(overlays.some((mesh) => mesh.getTotalVertices() > 0), 'the curve overlay has its lines');
for (const mesh of overlays) assert.equal(mesh.getMaterialForRenderPass(camera.renderPassId), undefined, `${mesh.name} keeps its own material`);
assert.equal(curve.getMaterialForRenderPass(camera.renderPassId)?.name, '__workbenchSolid', 'the object itself is Solid');
console.log('Edit overlays: curve and text Edit Mode overlays keep their own materials in Solid shading');
