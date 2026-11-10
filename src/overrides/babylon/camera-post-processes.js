// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's SceneSerializer for post processes: a camera's own written in place of the scene's every one (a pipeline's, Bylonder's film, and the camera's again), each with the defines its effect compiles with (god rays' samples), which Babylon writes only once they change; goes when Babylon serializes a camera's post processes with their defines.

/**
 * `json` (SceneSerializer's) with `postProcesses` alone as its post processes.
 * @param {any} json @param {import('@babylonjs/core').PostProcess[]} postProcesses
 */
export function writePostProcesses(json, postProcesses) {
  json.postProcesses = postProcesses.map((pp) => ({ ...pp.serialize(), ...(pp.getEffect()?.defines && { defines: pp.getEffect().defines }) }));
}
