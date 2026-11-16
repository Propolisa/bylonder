// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Babylon's freeze practice for what nothing moves: a mesh no animation plays, no physics body carries and no parent of
// it moves keeps its world matrix frozen, so Babylon stops computing it and its bounds each frame. The first time
// something moves, hides or changes it, it thaws, and what it parents with it.

/**
 * Freezes the world matrices of a scene's still meshes.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(node: any) => boolean} moves whether something moves a node itself
 */
export function freezeStill(scene, moves) {
  const frozen = new Set(), thawed = new WeakSet();
  const still = (/** @type {any} */ node) => { for (let n = node; n; n = n.parent) if (moves(n)) return false; return true; };
  // Frozen already: another part of the page (a native rig) freezes it at the matrix it computes.
  for (const mesh of scene.meshes) if (!mesh.isWorldMatrixFrozen && still(mesh)) { mesh.freezeWorldMatrix(); frozen.add(mesh); }
  const thawOne = (/** @type {any} */ node) => frozen.delete(node) && node.unfreezeWorldMatrix();
  return {
    /** A node something moves, hides or changes from now on: it and what it parents thaw. @param {any} node */
    thaw(node) {
      if (!frozen.size || thawed.has(node)) return;
      thawed.add(node);
      thawOne(node);
      for (const child of node.getDescendants?.(false) ?? []) thawOne(child);
    },
    /** Every frozen mesh thawed. */
    dispose() { for (const mesh of [...frozen]) thawOne(mesh); },
  };
}
