// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// What an exported page draws over its camera (rendering pipelines and post processes, volumes, the compositor, the
// display transform) belongs to the scene: it is on whichever camera is active, in the order it was added, so a camera
// the page makes active (a game's own) shows the file's look, and the camera left keeps none of it.

/** @typedef {import('@babylonjs/core').Camera} Camera */
/** @typedef {import('@babylonjs/core').Scene} Scene */
/** @typedef {import('@babylonjs/core').PostProcess} PostProcess */
/** @typedef {{ attach(camera: Camera): void, detach(camera: Camera): void }} CameraEffect */

/** @type {WeakMap<Scene, ReturnType<typeof makeEffects>>} */
const EFFECTS = new WeakMap();

/** @param {Scene} scene */
function makeEffects(scene) {
  /** @type {CameraEffect[]} */
  const effects = [];
  let shown = scene.activeCamera;
  scene.onActiveCameraChanged.add(() => {
    // None active (a scene disposing): the effects stay with the camera that had them, which disposes them.
    const next = scene.activeCamera;
    if (!next || next === shown) return;
    if (shown) for (const effect of [...effects].reverse()) effect.detach(shown);
    for (const effect of effects) effect.attach(next);
    shown = next;
  });
  return {
    /** The camera the effects are on. */
    get camera() { return shown; },
    /**
     * Adds an effect after those added before, on the active camera unless `attached` (made on it already).
     * @template {CameraEffect} T @param {T} effect @param {boolean} [attached] @returns {T}
     */
    add(effect, attached = false) {
      effects.push(effect);
      if (shown && !attached) effect.attach(shown);
      return effect;
    },
    /** Takes an effect off the active camera and out of the scene's. @param {CameraEffect} effect */
    remove(effect) {
      const at = effects.indexOf(effect);
      if (at < 0) return;
      effects.splice(at, 1);
      if (shown) effect.detach(shown);
    },
  };
}

/** The scene's camera effects, made once its active camera is set. @param {Scene} scene */
export function cameraEffects(scene) {
  let effects = EFFECTS.get(scene);
  if (!effects) EFFECTS.set(scene, (effects = makeEffects(scene)));
  return effects;
}

/**
 * A post process as a camera effect (`post`), before `before` where that one is on the camera.
 * @param {PostProcess} post @param {PostProcess} [before] @returns {CameraEffect & { post: PostProcess }}
 */
export const postProcessEffect = (post, before) => ({
  post,
  attach: (camera) => { camera.attachPostProcess(post, before ? camera._postProcesses.indexOf(before) : null); },
  detach: (camera) => { camera.detachPostProcess(post); },
});

/** A rendering pipeline of the scene's manager as a camera effect. @param {Scene} scene @param {string} name @returns {CameraEffect} */
export const pipelineEffect = (scene, name) => ({
  attach: (camera) => scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(name, camera),
  detach: (camera) => scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(name, camera),
});
