// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Point clouds in exported pages: the `pointcloud` implementation of `pointcloud:POINTCLOUD` entities. An entity gives
// the points Main's instances hold as the app draws them (docs/ir.md Geometry), which the package's
// bylonder-pointclouds/ (Blender's point cloud drawing, GPL) draws as spheres in the point cloud's material, as the
// app's view does.
import { Matrix, Quaternion } from '@babylonjs/core';

/**
 * A point cloud: 4 floats per point (its position in Blender's axes and its radius), its matrix in its object's space
 * (Babylon's layout), the material's id or name and a name unique within the object.
 * @typedef {{ points: Float32Array, matrix: number[], material: string | null, name: string }} PointCloud
 */

/** @param {PointCloud} inputs */
export const run = (inputs) => ({ geometry: { pointcloud: inputs } });

/**
 * The implementation: `run`, and `drawPointCloud`, which draws an entity's points once, under its object's node.
 * @param {import('./scheduler.js').Page} page
 */
export async function load({ root, scene }) {
  const { drawPointClouds } = await import(new URL('bylonder-pointclouds/pointcloud.js', root).href);
  return {
    run,
    /** @param {string} node @param {PointCloud} cloud */
    drawPointCloud(node, { points, matrix, material, name }) {
      const id = `${node}/pointcloud/${name}`;
      if (scene.getMeshById(id)) return;
      /** @type {Map<string, import('@babylonjs/core').Mesh>} */
      const drawn = new Map();
      drawPointClouds(scene, [{ key: id, matrix: Matrix.Identity().asArray(), material, points }], drawn, () => (material ? scene.getMaterialById(material) ?? scene.getMaterialByName(material) : null));
      const mesh = /** @type {import('@babylonjs/core').Mesh} */ (drawn.get(id));
      mesh.id = id;
      mesh.unfreezeWorldMatrix();
      mesh.parent = scene.getNodeById(node);
      Matrix.FromArray(matrix).decompose(mesh.scaling, mesh.rotationQuaternion = new Quaternion(), mesh.position);
    },
  };
}
