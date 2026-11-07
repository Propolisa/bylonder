// Edit Mode's overlay is pulled toward the eye by Blender's ndc offset (overlay_edit_mesh_vert.glsl, GPU_polygon_offset_calc):
// an offset in clip space, so in depth it shrinks with distance as depth precision does. A fixed offset in window depth
// showed Impact Fracture's back edges through its cube from afar.
import assert from 'node:assert/strict';
import { Matrix, Vector3 } from '@babylonjs/core';
import { polygonOffsetFactor } from '../src/draw/overlay-edit-mesh.js';

// Blender's default 3D Viewport: 50 mm lens, clip 0.01 to 1000.
const near = 0.01, far = 1000, projection = Matrix.PerspectiveFovLH(0.69, 16 / 9, near, far);
const factor = polygonOffsetFactor(projection);
assert.ok(Math.abs(factor - (2 * far * near / (far - near)) * 0.0025 * 0.5) < 1e-9, "Blender's unit: its share of the perspective's depth term");

// A point's window depth at view distance z, pulled by `offset` units as the overlay's vertex shader pulls it.
const depth = (z, offset = 0) => {
  const clip = Vector3.TransformCoordinates(new Vector3(0, 0, z), projection);
  const w = z, zc = clip.z * w - factor * offset;
  return (zc / w) * 0.5 + 0.5;
};
// The cube's front face 30 m away, its back 2 m behind: an edge (offset 1) wins against the face it lies on and stays
// behind the face in front of it.
for (const z of [3, 30, 300]) {
  assert.ok(depth(z, 1) < depth(z), `an edge on its face draws over it at ${z} m`);
  assert.ok(depth(z + 2, 1) > depth(z), `a back edge stays hidden behind a face 2 m in front at ${z} m`);
}
assert.ok(depth(302) - depth(300) < 4e-5, 'where a fixed window-depth bias (the old 4e-5 for edges) showed the back edge');
const ortho = Matrix.OrthoLH(20, 10, -100, 100);
assert.ok(Math.abs(polygonOffsetFactor(ortho) - 0.00001 * 0.5 * 5) < 1e-12, 'orthographic: a share of its smaller half extent');
console.log("Edit Mode overlay depth: Blender's ndc offset keeps edges over their faces and back edges hidden at any distance");
