// The shapes Blender's overlay expands each particle into (overlay_particle_shape_vert.glsl), and a hair path's
// segment, as Babylon meshes the view thin-instances (main-view.js drawInstances): in Babylon's axes, at unit size
// (each instance's matrix scales a particle's by its display size). Dot is Blender's world-sized point, a small ball
// here; Circle lies in the particle's plane, where Blender's faces the camera.
import { Mesh, MeshBuilder, VertexData } from '@babylonjs/core';

const CIRCLE_RESOLUTION = 32;
const lines = (positions, colors) => Object.assign(new VertexData(), {
  positions, indices: Array.from({ length: positions.length / 3 }, (_, i) => i), ...(colors && { colors }),
});
const BUILD = {
  DOT: (scene) => MeshBuilder.CreateIcoSphere('DOT', { radius: 0.5, subdivisions: 1 }, scene),
  CROSS: () => lines([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]),
  // Blender's X, Y and Z red, green and blue: Babylon's X, Z and Y.
  AXIS: () => lines([0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0], [1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1]),
  CIRCLE: () => lines(Array.from({ length: CIRCLE_RESOLUTION }, (_, i) => [i, i + 1]).flat()
    .flatMap((k) => [Math.cos((2 * Math.PI * k) / CIRCLE_RESOLUTION), 0, Math.sin((2 * Math.PI * k) / CIRCLE_RESOLUTION)])),
  // Blender's Z: Babylon's Y.
  SEGMENT: () => lines([0, 0, 0, 0, 1, 0]),
};
export const drawsLines = (shape) => shape !== 'DOT';

// A scene's mesh of a shape, made once and never drawn itself.
const made = new WeakMap();
export function shapeMesh(scene, shape) {
  const meshes = made.get(scene) ?? made.set(scene, new Map()).get(scene);
  if (!meshes.has(shape)) {
    const data = BUILD[shape](scene), mesh = data instanceof Mesh ? data : new Mesh(shape, scene);
    if (!(data instanceof Mesh)) data.applyToMesh(mesh);
    Object.assign(mesh, { name: '__shape ' + shape, isPickable: false });
    mesh.setEnabled(false);
    meshes.set(shape, mesh);
  }
  return meshes.get(shape);
}
