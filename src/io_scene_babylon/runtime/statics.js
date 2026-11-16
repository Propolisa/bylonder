// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Babylon's freeze practice for what nothing moves: a mesh no animation plays, no physics body carries and no parent of
// it moves keeps its world matrix frozen, so Babylon stops computing it and its bounds each frame. Before each frame's
// meshes are evaluated, a frozen mesh whose position, rotation or scaling changed, or whose parent moved, thaws, and
// what it parents with it: code may move any node it holds, which a frozen node would not show.

const SIZE = 11; // position, rotation (a quaternion's four, or an Euler's three), scaling, the parent's matrix flag

const values = new Float64Array(SIZE); // read each frame for every frozen mesh: one array, not one each
/** A mesh's transform written to `out` at `at`, or compared with it there: true when it differs. */
function differs(/** @type {any} */ mesh, /** @type {Float64Array} */ out, /** @type {number} */ at, write = false) {
  const { position: p, scaling: s } = mesh, r = mesh.rotationQuaternion ?? mesh.rotation;
  values[0] = p.x; values[1] = p.y; values[2] = p.z; values[3] = r.x; values[4] = r.y; values[5] = r.z; values[6] = r.w ?? 0;
  values[7] = s.x; values[8] = s.y; values[9] = s.z; values[10] = mesh.parent?.getWorldMatrix().updateFlag ?? -1;
  let changed = false;
  for (let i = 0; i < SIZE; i++) {
    if (out[at + i] !== values[i]) changed = true;
    if (write) out[at + i] = values[i];
  }
  return changed;
}

/**
 * Freezes the world matrices of a scene's still meshes until each moves. Returns what thaws them all.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(node: any) => boolean} moves whether something moves a node itself
 */
export function freezeStill(scene, moves) {
  const still = (/** @type {any} */ node) => { for (let n = node; n; n = n.parent) if (moves(n)) return false; return true; };
  // Frozen already: another part of the page (a native rig) freezes it at the matrix it computes.
  const meshes = scene.meshes.filter((mesh) => !mesh.isWorldMatrixFrozen && still(mesh)), was = new Float64Array(meshes.length * SIZE);
  meshes.forEach((mesh, i) => { mesh.freezeWorldMatrix(); differs(mesh, was, i * SIZE, true); });
  const frozen = new Set(meshes);
  const thaw = (/** @type {any} */ node) => { for (const n of [node, ...(node.getDescendants?.(false) ?? [])]) if (frozen.delete(n)) n.unfreezeWorldMatrix(); };
  const check = scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
    if (!frozen.size) return;
    meshes.forEach((mesh, i) => { if (frozen.has(mesh) && !mesh.isDisposed() && differs(mesh, was, i * SIZE)) thaw(mesh); });
  });
  return () => {
    scene.onBeforeActiveMeshesEvaluationObservable.remove(check);
    for (const mesh of frozen) mesh.unfreezeWorldMatrix();
    frozen.clear();
  };
}
