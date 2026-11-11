// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `pose-kernels` implementation of `constraints:POSE` entities: an armature's pose after its bone constraints by
// Blender's kernels (bylonder-constraints/: constraints.wasm and its loader, GPL), evaluated as Main's depsgraph
// evaluates it, run by pose-constraints.js in place of its own solvers: the same inputs, with the rig as the export
// read it (`kernels`, rig-export.js) in place of the stacks, and its constraints' influences by bone as the page's
// controls set them. A constraint type with a unit registered for
// `constraint:<TYPE>` (units.js) runs on it in Blender's place: given the owner's and its targets' matrices in the
// constraint's spaces (Blender's, column-major) and its settings by RNA name, it gives the owner's (`matrix`).
import { Matrix } from '@babylonjs/core';
import { unitFor } from './units.js';
import { swapped } from './constraints-evaluator.js';

/**
 * @typedef {{ bones: { name: string, parent: number, rest: Matrix }[], locals: Matrix[], mesh: Matrix, space: Matrix,
 *   kernels: any, influences?: Record<string, number[]>, nodeWorld: (id: string) => Matrix | null, frame?: number }} KernelPose
 */

const IDENTITY = Matrix.Identity().asArray();
const blender = (/** @type {Matrix} */ m) => swapped(m).asArray();
const babylon = (/** @type {ArrayLike<number>} */ m, /** @type {number} */ at) => Matrix.FromArray(Array.from(m).slice(at, at + 16));

/**
 * A solver on loaded kernels (polyfill/constraints.js loadConstraints): each bone's Babylon local matrix after the
 * rig's constraints, by the skeleton's index.
 * @param {any} kernels
 * @returns {(pose: KernelPose) => Map<number, Matrix>}
 */
export function kernelSolve(kernels) {
  /** Each rig the kernels hold, by the spec it was made from, with its constraint types. */
  const rigs = new WeakMap();
  /** The unit each type is handed to, so a unit registered later takes over and one removed hands back. */
  const handed = new Map();
  const handUnits = (/** @type {Iterable<string>} */ types) => {
    for (const type of types) {
      const unit = unitFor(`constraint:${type}`);
      if (handed.get(type) === unit) continue;
      kernels.use(type, unit ? { run: (/** @type {any} */ inputs) => /** @type {any} */ (unit.run(inputs, { frame: 0 })).matrix } : null);
      handed.set(type, unit);
    }
  };
  return ({ bones, locals, mesh, space, kernels: spec, influences = {}, nodeWorld, frame = 0 }) => {
    if (!rigs.has(spec)) rigs.set(spec, { rig: kernels.rig(spec), types: new Set(spec.bones.flatMap((/** @type {any} */ b) => b.constraints.map((/** @type {any} */ c) => c.type))) });
    const { rig, types } = rigs.get(spec);
    handUnits(types);
    spec.bones.forEach((/** @type {any} */ b, /** @type {number} */ i) => influences[b.name]?.forEach((/** @type {number} */ v, /** @type {number} */ k) => rig.influence(i, k, v)));
    const index = new Map(bones.map((b, i) => [b.name, i]));
    const order = spec.bones.map((/** @type {any} */ b) => index.get(b.name) ?? -1);
    const channels = new Float32Array(order.length * 16);
    order.forEach((/** @type {number} */ i, /** @type {number} */ k) => channels.set(i < 0 ? IDENTITY : blender(locals[i].multiply(Matrix.Invert(bones[i].rest))), k * 16));
    const nodes = (/** @type {string} */ id) => { const m = nodeWorld(id); return m ? blender(m) : IDENTITY; };
    const posed = rig.evaluate(frame, channels, blender(space.multiply(mesh)), nodes);
    const at = new Map(order.map((/** @type {number} */ i, /** @type {number} */ k) => [i, k]));
    /** @type {Map<number, Matrix>} */
    const result = new Map();
    for (const [i, k] of at) {
      if (i < 0) continue;
      const own = babylon(posed, k * 16), parent = at.get(bones[i].parent);
      result.set(i, parent === undefined ? swapped(own).multiply(space) : swapped(own.multiply(Matrix.Invert(babylon(posed, parent * 16)))));
    }
    return result;
  };
}

/**
 * The page's implementation: pose-constraints.js on the package's kernels, loaded from `bylonder-constraints/`.
 * @param {import('./scheduler.js').Page} page
 */
export async function load(page) {
  const folder = new URL('bylonder-constraints/', page.root);
  const [{ loadConstraints }, pose] = await Promise.all([import(/* @vite-ignore */ new URL('constraints.js', folder).href), import('./pose-constraints.js')]);
  return pose.load(page, kernelSolve(await loadConstraints(new URL('constraints.wasm', folder))));
}
