// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Babylon's freeze practice and a game engine's static batching for what nothing moves: a mesh no animation plays, no
// physics body carries and no parent of it moves keeps its world matrix frozen, and still meshes that draw alike (one
// material, the same lights, casting no shadow) draw as one merged mesh. Each mesh stays as it was for code and picking, only
// not drawn while its batch draws it. The first time something moves, hides or changes a mesh, it thaws: it and what
// it parents compute their world matrices again, and its batch goes back to its meshes.
import { Mesh } from '@babylonjs/core';

/**
 * Freezes a scene's still meshes and batches those that draw alike.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(node: any) => boolean} moves whether something moves a node itself
 */
export function freezeStill(scene, moves) {
  const frozen = new Set(), thawed = new WeakSet(), batchOf = new Map();
  const still = (/** @type {any} */ node) => { for (let n = node; n; n = n.parent) if (moves(n)) return false; return true; };
  // Frozen already: another part of the page (a native rig) freezes it at the matrix it computes.
  for (const mesh of scene.meshes) if (!mesh.isWorldMatrixFrozen && still(mesh)) { mesh.freezeWorldMatrix(); frozen.add(mesh); }
  for (const members of batches(scene, frozen)) {
    const batch = merge(members);
    if (batch) for (const mesh of members) batchOf.set(mesh, batch);
  }
  const unbatch = (/** @type {any} */ mesh) => { const batch = batchOf.get(mesh); if (batch) { for (const m of batch.members) batchOf.delete(m); batch.undo(); } };
  const thawOne = (/** @type {any} */ node) => { unbatch(node); if (frozen.delete(node)) node.unfreezeWorldMatrix(); };
  return {
    /** A node something moves, hides or changes from now on: it and what it parents thaw. @param {any} node */
    thaw(node) {
      if (!frozen.size || thawed.has(node)) return;
      thawed.add(node);
      thawOne(node);
      for (const child of node.getDescendants?.(false) ?? []) thawOne(child);
    },
    /** Every batch undone and every frozen mesh thawed. */
    dispose() { for (const mesh of [...frozen]) thawOne(mesh); },
  };
}

/** The shadow maps' mesh lists of the scene's lights. @param {import('@babylonjs/core').Scene} scene */
const shadowLists = (scene) => /** @type {any[][]} */ (scene.lights.map((light) => light.getShadowGenerator()?.getShadowMap()?.renderList).filter(Boolean));

/**
 * Groups of two or more frozen meshes that draw alike: plain meshes of one submesh that cast no shadow, enabled and
 * shown, with the same material, vertex data kinds and drawing settings; none where lights are given per mesh
 * (light-reach.js), as a batch would take the lights of its whole extent.
 * @param {import('@babylonjs/core').Scene} scene @param {Set<any>} frozen
 */
function batches(scene, frozen) {
  if (scene.lights.some((light) => light.excludedMeshes.length || light.includedOnlyMeshes.length)) return [];
  const casters = new Set(shadowLists(scene).flat()), groups = new Map();
  for (const mesh of frozen) {
    if (mesh.getClassName() !== 'Mesh' || !mesh.material || mesh.subMeshes?.length !== 1 || mesh.skeleton || mesh.morphTargetManager || mesh.hasThinInstances
      || mesh.hasInstances || mesh.hasLODLevels || !mesh.isEnabled() || !mesh.isVisible || mesh.visibility !== 1 || mesh.billboardMode || mesh.infiniteDistance
      || casters.has(mesh)) continue;
    const key = [mesh.material.uniqueId, mesh.getVerticesDataKinds().sort().join(), mesh.receiveShadows, mesh.layerMask, mesh.renderingGroupId, mesh.alphaIndex,
      mesh.sideOrientation].join('|');
    groups.set(key, [...(groups.get(key) ?? []), mesh]);
  }
  return [...groups.values()].filter((members) => members.length > 1);
}

let batched = 0;
/**
 * One mesh drawing `members` where they are, which do not draw meanwhile (a layer mask no camera sees) but stay for
 * picking and code; its `undo` gives them back their drawing and disposes of it. Null where Babylon cannot merge them.
 * @param {any[]} members
 */
function merge(members) {
  const batch = /** @type {any} */ (Mesh.MergeMeshes(members, false, true));
  if (!batch) return null;
  const [first] = members, masks = members.map((mesh) => mesh.layerMask);
  Object.assign(batch, { id: `bylonder-batch-${++batched}`, name: `${first.name} (batch of ${members.length})`, isPickable: false, receiveShadows: first.receiveShadows,
    layerMask: first.layerMask, renderingGroupId: first.renderingGroupId, alphaIndex: first.alphaIndex, members });
  batch.freezeWorldMatrix();
  for (const mesh of members) mesh.layerMask = 0;
  batch.undo = () => {
    members.forEach((mesh, i) => { mesh.layerMask = masks[i]; });
    batch.dispose();
  };
  return batch;
}
