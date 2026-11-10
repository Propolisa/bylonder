// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Curves in exported pages (hair, a Curves object's curves): the `curves` implementation of `curves:CURVES` entities. An
// entity gives Main's curves draw as the app draws it (docs/ir.md Geometry), which the package's bylonder-curves/
// (Blender's curve shape functions, GPL) draws in the curves' material, as the app's view does.

import { fillWhatItReads } from '../../overrides/webgpu/missing-attributes.js';

/**
 * Main's curves draw: each evaluated point's position and radius, the drawn segments' indirection, each point's time
 * along its curve, each curve's length, the object's matrix (Blender's), the faces round each segment (the scene's Hair
 * shape), the material's id and a name unique within the object.
 * @typedef {{ pos_rad: Float32Array, indirection: Int32Array, time: Float32Array, length: Float32Array, object_to_world: number[],
 *   faces: number, material: string | null, name: string }} Curves
 */

/** @param {Curves} inputs */
export const run = (inputs) => ({ geometry: { curves: inputs } });

/**
 * The implementation: `run`, and `drawCurves`, which draws an entity's curves once, named by its object's node.
 * @param {import('./scheduler.js').Page} page
 */
export async function load({ root, scene }) {
  const { curvesData, curvesMesh } = await import(new URL('bylonder-curves/curves.js', root).href);
  return {
    run,
    /** @param {string} node @param {Curves} curves */
    drawCurves(node, { pos_rad: posRad, indirection, time, length, object_to_world: objectToWorld, faces, material, name }) {
      const id = `${node}/curves/${name}`;
      if (scene.getMeshById(id)) return;
      const mesh = curvesMesh(scene, id, curvesData(scene, { posRad, indirection, time, length, objectToWorld }), faces);
      mesh.id = id;
      fillWhatItReads(mesh);
      mesh.material = material ? scene.getMaterialById(material) : null;
    },
  };
}
