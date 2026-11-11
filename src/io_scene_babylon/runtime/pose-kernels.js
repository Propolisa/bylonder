// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `pose-kernels` implementation of `constraints:POSE` entities: an armature's pose after its bone constraints by
// Blender's kernels (bylonder-constraints/: constraints.wasm and its loader, GPL), evaluated as Main's depsgraph
// evaluates it, run by pose-constraints.js in place of its own solvers: the same inputs, with the rig as the export
// compiled it (`kernels`: rig-export.js's rig as JSON in scene.bin, parsed once) in place of the stacks, and its constraints' influences and its B-Bones' own
// shapes (`shapes`, by path) by bone as the page's controls set them. A constraint type with a unit registered for
// `constraint:<TYPE>` (units.js) runs on it in Blender's place: given the owner's and its targets' matrices in the
// constraint's spaces (Blender's, column-major) and its settings by RNA name, it gives the owner's (`matrix`). The
// segment joints (`bone#k`) of the B-Bones in `segments` are posed by their segments as the kernels shape them, or as a
// unit registered for `bbone:SEGMENTS` does: given the bone's pose and rest matrices (armature space, column-major)
// and length, its handle bones' (`prev`, `next`, or null) and its Bone's and PoseBone's settings by RNA name, it gives
// its segments' matrices in its rest space (`matrices`, Blender's bbone_segment_matrix).
import { Matrix } from '@babylonjs/core';
import { unitFor } from './units.js';
import { swapped } from './constraints-evaluator.js';

/**
 * @typedef {{ bones: { name: string, parent: number, rest: Matrix }[], locals: Matrix[], mesh: Matrix, space: Matrix,
 *   kernels: any, influences?: Record<string, number[]>, shapes?: Record<string, Record<string, number>>, segments?: string[],
 *   nodeWorld: (id: string) => Matrix | null, frame?: number }} KernelPose
 */

const IDENTITY = Matrix.Identity().asArray();

/**
 * A B-Bone's handle bones in a rig as the export read it, by index (-1 for none): its custom handles, else, for an
 * automatic handle, its parent and its child connected to it (Blender's BKE_pchan_bbone_handles_get).
 * @param {any} spec @param {number} at
 */
function handlesOf(spec, at) {
  const b = spec.bones[at], [start, end] = b.handles ?? [-1, -1];
  const child = spec.bones.findIndex((/** @type {any} */ c) => c.parent === at && c.bone.use_connect);
  return [b.bone.bbone_handle_type_start === 'AUTO' ? (b.bone.use_connect ? b.parent : -1) : start, b.bone.bbone_handle_type_end === 'AUTO' ? child : end];
}
const blender = (/** @type {Matrix} */ m) => swapped(m).asArray();
const babylon = (/** @type {ArrayLike<number>} */ m, /** @type {number} */ at) => Matrix.FromArray(Array.from(m).slice(at, at + 16));

/**
 * A solver on loaded kernels (polyfill/constraints.js loadConstraints): each bone's Babylon local matrix after the
 * rig's constraints, by the skeleton's index.
 * @param {any} kernels
 * @returns {((pose: KernelPose) => Map<number, Matrix>) & { segments?: (spec: any, bone: string) => number[][] }}
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
  /** @param {KernelPose} pose */
  const solve = ({ bones, locals, mesh, space, kernels: compiled, influences = {}, shapes = {}, segments: shaped = [], nodeWorld, frame = 0 }) => {
    if (!rigs.has(compiled)) {
      // The rig as the export compiled it (JSON in scene.bin), else as it read it: parsed and built once.
      const spec = ArrayBuffer.isView(compiled) ? JSON.parse(new TextDecoder().decode(compiled)) : compiled;
      rigs.set(compiled, { spec, rig: kernels.rig(spec), types: new Set(spec.bones.flatMap((/** @type {any} */ b) => b.constraints.map((/** @type {any} */ c) => c.type))) });
    }
    const { spec, rig, types } = rigs.get(compiled);
    handUnits(types);
    spec.bones.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
      influences[b.name]?.forEach((/** @type {number} */ v, /** @type {number} */ k) => rig.influence(i, k, v));
      if (shapes[b.name]) rig.pose(i, shapes[b.name]);
    });
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
    // The segment joints (`bone#k`, children of the bone) of each B-Bone the export found the kernels shape as Main
    // does: each at its segment's matrix in the bone's space, from a unit registered for `bbone:SEGMENTS` where there
    // is one, else from the kernels.
    const unit = unitFor('bbone:SEGMENTS'), segments = new Map();
    const segmentsOf = (/** @type {number} */ at) => {
      if (!unit) return rig.bboneSegments(at).matrices;
      const handle = (/** @type {number} */ j) => (j < 0 ? null : { pose: Array.from(posed.subarray(j * 16, j * 16 + 16)), rest: spec.bones[j].bone.matrix_local, length: spec.bones[j].bone.length });
      const [prev, next] = handlesOf(spec, at), b = spec.bones[at];
      return /** @type {any} */ (unit.run({ ...handle(at), prev: handle(prev), next: handle(next), bone: b.bone, pose_bone: { ...b.pose, ...shapes[b.name] } }, { frame })).matrices;
    };
    bones.forEach(({ name, parent }, i) => {
      const [, bone, k] = /^(.*)#(\d+)$/.exec(name) ?? [], at = shaped.includes(bone) && bones[parent]?.name === bone ? spec.bones.findIndex((/** @type {any} */ b) => b.name === bone) : -1;
      if (at < 0) return;
      if (!segments.has(at)) segments.set(at, segmentsOf(at));
      const matrix = segments.get(at)[Number(k)];
      if (matrix) result.set(i, swapped(Matrix.FromArray(matrix)));
    });
    return result;
  };
  /** A B-Bone's segments after the last solve of a rig: its segments' matrices in its rest space. @param {any} spec @param {string} bone */
  solve.segments = (spec, bone) => rigs.get(spec)?.rig.bboneSegments(spec.bones.findIndex((/** @type {any} */ b) => b.name === bone)).matrices;
  return solve;
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
