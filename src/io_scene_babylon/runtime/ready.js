// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A scene's shaders compiled before its first frames, so they do not stall on them. A load never waits forever: a mesh
// whose shader fails to compile draws with the default material from then on, and the failure is reported (on the page
// as an error event, which a page's failure display shows). One that is only slow (parallel compilation, a cold shader
// cache) draws with the default material after `patience` until its own is ready, then gets it back.

/** Reports a failure without throwing: an error event on a page, the console elsewhere. @param {string} message */
function report(message) {
  const error = new Error(message);
  if (typeof reportError === 'function') reportError(error); else console.error(error.message);
}

/** The meshes the scene waits for. @param {import('@babylonjs/core').Scene} scene */
const waiting = (scene) => scene.meshes.filter((mesh) => mesh.isEnabled() && mesh.isVisible && !mesh.isReady(true));

/** A mesh's compile error, if its effect reported one. @param {import('@babylonjs/core').AbstractMesh} mesh */
const compileError = (mesh) => (mesh.subMeshes ?? []).map((sub) => sub.effect?.getCompilationError?.()).find(Boolean);

/**
 * Meshes whose shader failed to compile draw with the default material; reported. @param {import('@babylonjs/core').Scene} scene
 * @returns {string[]} what fell back
 */
export function fallBack(scene) {
  /** @type {string[]} */ const failed = [];
  for (const mesh of scene.meshes) {
    const error = mesh.material && compileError(mesh);
    if (!error || !mesh.material) continue;
    failed.push(`${mesh.material.name} (on ${mesh.name}): its shader failed to compile (${error.split('\n')[0]}), so it draws with the default material.`);
    mesh.material = null;
  }
  for (const message of failed) report(message);
  return failed;
}

/**
 * Slow meshes draw with the default material while their own keeps compiling (asked before each frame), and get it
 * back once it is ready.
 * @param {import('@babylonjs/core').Scene} scene @param {import('@babylonjs/core').AbstractMesh[]} meshes
 */
export function standIn(scene, meshes) {
  const pending = new Map(meshes.filter((mesh) => mesh.material).map((mesh) => [mesh, /** @type {import('@babylonjs/core').Material} */ (mesh.material)]));
  for (const mesh of pending.keys()) mesh.material = null;
  if (!pending.size) return;
  const observer = scene.onBeforeRenderObservable.add(() => {
    for (const [mesh, material] of pending) if (material.isReady(mesh, true)) { mesh.material = material; pending.delete(mesh); }
    if (!pending.size) scene.onBeforeRenderObservable.remove(observer);
  });
}

/**
 * Resolves once the scene is ready to draw, or after `patience` with what is still compiling standing in.
 * @param {import('@babylonjs/core').Scene} scene @param {{ every?: number, patience?: number }} [options] ms
 */
export async function whenDrawable(scene, { every = 50, patience = 8000 } = {}) {
  const started = performance.now();
  while (!scene.isReady(true)) {
    fallBack(scene);
    if (performance.now() - started > patience) {
      const slow = waiting(scene);
      if (slow.length) console.warn(`Still compiling after ${(patience / 1000).toFixed(0)} s, drawn with the default material until ready: ${slow.map((m) => `${m.name} (${m.material?.name ?? 'no material'})`).slice(0, 12).join(', ')}`);
      standIn(scene, slow);
      return;
    }
    await new Promise((done) => setTimeout(done, every));
  }
}
