// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The scene's world in an exported page: what lights the scene from all around and shows behind it. A world of one
// color lights through a cube of that color with its spherical harmonics; a world of nodes is its material drawn on a
// box around the eye, baked once into a reflection probe, filtered with Babylon's HDRFiltering, which then lights the
// scene.
import { Color4, Constants, CubeMapToSphericalPolynomialTools, HDRFiltering, MeshBuilder, ReflectionProbe, RenderTargetTexture } from '@babylonjs/core';

/** @typedef {import('@babylonjs/core').Scene} Scene */
/** @typedef {import('@babylonjs/core').Material} Material */

/**
 * A world of one color (linear, times its strength), lighting the scene; `set` changes it.
 * @param {Scene} scene
 * @param {number[]} color
 */
export function worldColor(scene, color) {
  const texture = new RenderTargetTexture('world', 1, scene, { isCube: true, type: Constants.TEXTURETYPE_FLOAT, generateMipMaps: false, doNotChangeAspectRatio: true });
  Object.assign(texture, { gammaSpace: false, renderList: [], refreshRate: RenderTargetTexture.REFRESHRATE_RENDER_ONCE });
  scene.customRenderTargets.push(texture);
  scene.environmentTexture = texture;
  const world = {
    /** @param {number[]} rgb */
    set([r, g, b]) {
      texture.clearColor = new Color4(r, g, b, 1);
      texture.resetRefreshCounter();
      const face = Float32Array.of(r, g, b, 1);
      texture.sphericalPolynomial = CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
        size: 1, right: face, left: face, up: face, down: face, front: face, back: face, format: Constants.TEXTUREFORMAT_RGBA, type: Constants.TEXTURETYPE_FLOAT, gammaSpace: false });
    },
  };
  world.set(color);
  return world;
}

/**
 * A world of nodes: its material on a box around the eye, and baked into the probe that lights the scene once its
 * shader is ready (a GPU's work: a page without one shows the box but bakes nothing).
 * @param {Scene} scene
 * @param {Material} material
 */
export function worldNodes(scene, material) {
  const box = MeshBuilder.CreateBox('world', { size: 2 }, scene);
  Object.assign(box, { material, infiniteDistance: true, isPickable: false, applyFog: false, alwaysSelectAsActiveMesh: true });
  const bake = async () => {
    if (!box.subMeshes.every((subMesh) => material.isReadyForSubMesh(box, subMesh))) return void scene.onBeforeRenderObservable.addOnce(bake);
    const probe = new ReflectionProbe('world', 256, scene, true, true, true), drawn = probe.cubeTexture;
    Object.assign(drawn, { gammaSpace: false, refreshRate: RenderTargetTexture.REFRESHRATE_RENDER_ONCE });
    probe.renderList?.push(box);
    if (scene.activeCamera) probe.position.copyFrom(scene.activeCamera.globalPosition);
    // The probe takes the world clamped (its Sun Threshold), as the export's `world:probe` input says.
    const clamp = /** @type {any} */ (material).getBlockByName?.('world:probe');
    if (clamp) clamp.value = 1;
    drawn.render();
    if (clamp) clamp.value = 0;
    const polynomial = await CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(drawn);
    await new HDRFiltering(scene.getEngine()).prefilter(drawn);
    drawn.sphericalPolynomial = polynomial;
    scene.environmentTexture = drawn;
  };
  scene.onBeforeRenderObservable.addOnce(bake);
  return { box };
}
