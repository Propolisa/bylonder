// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's ReflectionProbe for a world baked into it: the probe draws a render target's up and down cube
// faces looking down and up, so a world's light sampled from its cube came out upside down (surfaces facing down took
// the sky's colour, those facing up the ground's), measured against EEVEE; its faces drawn the right way up here
// (ReflectionProbe's own switch), for the app's world and an exported page's; goes when Babylon draws them so.
import { ReflectionProbe, RenderTargetTexture } from '@babylonjs/core';

/**
 * A probe that bakes a world: drawn once, in linear float, with its up and down faces the right way up.
 * @param {string} name @param {number} size @param {import('@babylonjs/core').Scene} scene
 */
export function uprightProbe(name, size, scene) {
  const probe = new ReflectionProbe(name, size, scene, true, true, true);
  /** @type {any} */ (probe)._invertYAxis = true;
  Object.assign(probe.cubeTexture, { gammaSpace: false, refreshRate: RenderTargetTexture.REFRESHRATE_RENDER_ONCE });
  return probe;
}
