// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `constraints` implementation of `constraints:OBJECT` entities: an object's constraints that Babylon's matrices
// give exactly (Track To, Copy Location, Copy Rotation, Child Of, in world space at full influence), applied to its node
// before each frame draws, after Babylon's animation and the page's F-Curves, so the object follows its targets as they
// move. The export keeps a stack here only where it gives Main's world matrix at every frame of the range.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';

/**
 * A constraint as the export writes it: its type and target node, and for each type its settings in Blender's terms.
 * @typedef {{ type: 'TRACK_TO' | 'COPY_LOCATION' | 'COPY_ROTATION' | 'CHILD_OF', target: string, track_axis?: string,
 *   up_axis?: string, use_target_z?: boolean, use?: boolean[], invert?: boolean[], use_offset?: boolean,
 *   inverse_matrix?: number[] }} Constraint
 */

// Babylon's axes are Blender's with y and z swapped: a matrix in one is S M S in the other.
const SWAP = Matrix.FromValues(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
export const swapped = (/** @type {Matrix} */ m) => SWAP.multiply(m).multiply(SWAP);
const AXES = ['X', 'Y', 'Z'];

/**
 * A row of a matrix (a local axis in world space, or the translation for 3), in Blender's axes.
 * @param {Matrix} m @param {number} i
 */
const row = (m, i) => new Vector3(m.m[i * 4], m.m[i * 4 + 1], m.m[i * 4 + 2]);

/**
 * A matrix in Blender's axes from its three axis rows and translation.
 * @param {Vector3[]} axes @param {Vector3} at
 */
const fromRows = (axes, at) => Matrix.FromArray([...axes.flatMap((a) => [a.x, a.y, a.z, 0]), at.x, at.y, at.z, 1]);

/**
 * Track To: the owner keeps its place and scale, its track axis pointing at the target and its up axis as near the
 * world's (or the target's) Z as that allows.
 * @param {Matrix} owner @param {Matrix} target @param {Constraint} c
 */
function trackTo(owner, target, c) {
  const at = row(owner, 3), scale = [0, 1, 2].map((i) => row(owner, i).length());
  const track = AXES.indexOf(/** @type {string} */ (c.track_axis).slice(-1)), up = AXES.indexOf(/** @type {string} */ (c.up_axis).slice(-1));
  let toward = row(target, 3).subtract(at);
  if (toward.lengthSquared() === 0 || track === up) return owner;
  toward.normalize();
  if (c.track_axis?.includes('NEGATIVE')) toward = toward.negate();
  const worldUp = c.use_target_z ? row(target, 2).normalize() : new Vector3(0, 0, 1);
  const upward = worldUp.subtract(toward.scale(Vector3.Dot(worldUp, toward)));
  if (upward.lengthSquared() < 1e-12) return owner;
  upward.normalize();
  const axes = /** @type {Vector3[]} */ ([]);
  axes[track] = toward;
  axes[up] = upward;
  const third = 3 - track - up;
  axes[third] = Vector3.Cross(axes[(third + 1) % 3], axes[(third + 2) % 3]);
  return fromRows(axes.map((a, i) => a.scale(scale[i])), at);
}

/**
 * The owner's world matrix (Blender's axes) after one constraint, its target's world matrix given.
 * @param {Matrix} owner @param {Matrix} target @param {Constraint} c
 */
function constrain(owner, target, c) {
  if (c.type === 'TRACK_TO') return trackTo(owner, target, c);
  // Blender's target times inverse times owner, by rows.
  if (c.type === 'CHILD_OF') return owner.multiply(Matrix.FromArray(/** @type {number[]} */ (c.inverse_matrix))).multiply(target);
  if (c.type === 'COPY_LOCATION') {
    const at = row(owner, 3).asArray(), from = row(target, 3).asArray();
    const placed = at.map((v, i) => (c.use?.[i] === false ? v : (c.use_offset ? v : 0) + (c.invert?.[i] ? -from[i] : from[i])));
    return fromRows([0, 1, 2].map((i) => row(owner, i)), Vector3.FromArray(placed));
  }
  // Copy Rotation, replacing all three axes: the target's rotation at the owner's place and scale.
  const turn = new Quaternion(), scale = [0, 1, 2].map((i) => row(owner, i).length());
  target.decompose(undefined, turn);
  const axes = Matrix.Identity();
  turn.toRotationMatrix(axes);
  return fromRows([0, 1, 2].map((i) => row(axes, i).scale(scale[i])), row(owner, 3));
}

/**
 * The world matrix (Blender's axes) of an owner after its constraints, from its own world matrix and its targets'.
 * @param {Matrix} owner @param {Constraint[]} constraints @param {(id: string) => Matrix} targetOf
 */
export function constrained(owner, constraints, targetOf) {
  return constraints.reduce((m, c) => constrain(m, targetOf(c.target), c), owner);
}

/** Each scene's constrained nodes, in the IR's order, and the transform each was last given. */
const scenes = new WeakMap();

/**
 * Places a node at its world matrix after its constraints, from its own transform, before each frame draws.
 * @param {Record<string, any>} inputs `node` and `constraints`
 * @param {{ frame: number }} context
 * @param {object} entity
 * @param {import('@babylonjs/core').Scene} scene
 */
function attach({ node: id, constraints }, context, entity, scene) {
  if (!scenes.has(scene)) {
    const list = /** @type {any[]} */ ([]);
    scenes.set(scene, list);
    scene.onBeforeRenderObservable.add(() => list.forEach(apply));
  }
  const list = scenes.get(scene);
  if (!list.some((/** @type {any} */ e) => e.entity === entity)) list.push({ entity, node: scene.getNodeById(id), constraints, scene });
  return {};
}

const blenderWorld = (/** @type {any} */ node) => swapped(node.computeWorldMatrix(true));

/**
 * Applies a node's constraints: its own transform is what the page or its animation last set, else what it had
 * before the constraints last moved it.
 * @param {any} entry
 */
function apply(entry) {
  const { node, constraints, scene } = entry;
  if (!node) return;
  const parts = ['position', 'rotationQuaternion', 'scaling'];
  if (entry.placed && parts.every((p) => node[p]?.equals(entry.placed[p]))) parts.forEach((p) => node[p].copyFrom(entry.own[p]));
  entry.own = Object.fromEntries(parts.map((p) => [p, node[p].clone()]));
  const world = swapped(constrained(blenderWorld(node), constraints, (id) => blenderWorld(scene.getNodeById(id))));
  const local = node.parent ? world.multiply(Matrix.Invert(node.parent.computeWorldMatrix(true))) : world;
  local.decompose(node.scaling, node.rotationQuaternion, node.position);
  node.computeWorldMatrix(true);
  entry.placed = Object.fromEntries(parts.map((p) => [p, node[p].clone()]));
}

/** @param {{ scene: import('@babylonjs/core').Scene }} page */
export function load({ scene }) {
  return { run: (/** @type {any} */ inputs, /** @type {any} */ context, /** @type {object} */ entity) => attach(inputs, context, entity, scene) };
}
