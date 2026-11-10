// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's post process parser (PostProcess.Parse): god rays built as their class, with their samples and the pass that draws their source, as VolumetricLightScatteringPostProcess has no parser of its own and parses as a plain post process whose shader does not compile; goes when Babylon parses god rays.
import { PostProcess, SerializationHelper, VolumetricLightScatteringPostProcess } from '@babylonjs/core';

/**
 * A serialized post process parsed as Babylon's loader parses it, god rays as their class.
 * @param {any} entry @param {import('@babylonjs/core').Scene} scene @param {string} rootUrl
 */
export function parsePostProcess(entry, scene, rootUrl) {
  if (entry.customType !== 'BABYLON.VolumetricLightScatteringPostProcess') return PostProcess.Parse(entry, scene, rootUrl);
  const samples = Number(/NUM_SAMPLES (\d+)/.exec(entry.defines ?? '')?.[1]) || undefined;
  return SerializationHelper.Parse(() => new VolumetricLightScatteringPostProcess(entry.name, entry.options, scene.getCameraById(entry.cameraId),
    scene.getMeshById(entry.mesh), samples, entry.renderTargetSamplingMode, undefined, entry.reusable, scene), entry, scene, rootUrl);
}
