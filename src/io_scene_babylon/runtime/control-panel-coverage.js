// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// How much of the view each material covers, for the control panel's order of materials: the scene drawn small, each
// material a flat colour of its own, read back a few times a second while the panel is open and not at all otherwise.
import { Color3, Color4, ImageProcessingConfiguration, MultiMaterial, RenderTargetTexture, StandardMaterial } from '@babylonjs/core';

// The pass's width in pixels (its height follows the canvas) and how often it is read, in milliseconds.
const WIDTH = 64, EVERY = 400;

/**
 * Measures the share of the view each material covers, calling `measured` with them by material id (0 to 1).
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(shares: Map<string, number>) => void} measured
 */
export function createCoverage(scene, measured) {
  const engine = scene.getEngine();
  const height = Math.max(1, Math.round((WIDTH * engine.getRenderHeight()) / Math.max(1, engine.getRenderWidth())));
  const target = new RenderTargetTexture('__coverage', { width: WIDTH, height }, scene, { generateMipMaps: false });
  target.clearColor = new Color4(0, 0, 0, 0);
  target.refreshRate = 0;
  /** @type {import('@babylonjs/core').Material[]} */
  const materials = [];
  /** @type {StandardMaterial[]} */
  const flats = [];
  // Colours as they are: no tone mapping, exposure or fog.
  const plain = new ImageProcessingConfiguration();
  plain.isEnabled = false;
  /** Each multi-material's stand-in. @type {Map<MultiMaterial, MultiMaterial>} */
  const multis = new Map();
  // A material's flat colour: its index plus one in the red and green bytes.
  const flat = (/** @type {import('@babylonjs/core').Material | null} */ material) => {
    if (!material) return null;
    let index = materials.indexOf(material);
    if (index < 0) {
      index = materials.push(material) - 1;
      const id = index + 1, made = new StandardMaterial(`__coverage ${id}`, scene);
      Object.assign(made, { imageProcessingConfiguration: plain, fogEnabled: false, disableLighting: true, emissiveColor: new Color3((id & 255) / 255, (id >> 8) / 255, 0), diffuseColor: Color3.Black(), specularColor: Color3.Black() });
      flats.push(made);
    }
    return flats[index];
  };
  const assign = () => {
    target.renderList = scene.meshes.filter((m) => m.isEnabled() && m.isVisible && !!m.material);
    for (const mesh of target.renderList) {
      const material = /** @type {any} */ (mesh.material);
      if (material instanceof MultiMaterial) {
        let multi = multis.get(material);
        if (!multi) {
          multis.set(material, multi = new MultiMaterial(`__coverage ${material.name}`, scene));
          multi.subMaterials = material.subMaterials.map(flat);
        }
        target.setMaterialForRendering(mesh, multi);
      } else target.setMaterialForRendering(mesh, flat(material) ?? undefined);
    }
  };
  let reading = false;
  const read = async () => {
    if (reading || !scene.activeCamera) return;
    reading = true;
    try {
      target.activeCamera = scene.activeCamera;
      assign();
      target.resetRefreshCounter();
      await new Promise((resolve) => target.onAfterRenderObservable.addOnce(resolve));
      const pixels = /** @type {Uint8Array} */ (await target.readPixels());
      const counts = new Map(), total = WIDTH * height;
      for (let i = 0; i < pixels.length; i += 4) {
        const id = pixels[i] + (pixels[i + 1] << 8);
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      /** @type {Map<string, number>} */
      const shares = new Map();
      for (const [id, count] of counts) if (materials[id - 1]) shares.set(materials[id - 1].id, count / total);
      measured(shares);
    } finally {
      reading = false;
    }
  };
  scene.customRenderTargets.push(target);
  const timer = setInterval(read, EVERY);
  read();
  return {
    dispose() {
      clearInterval(timer);
      scene.customRenderTargets.splice(scene.customRenderTargets.indexOf(target), 1);
      target.dispose();
      for (const m of [...flats, ...multis.values()]) m.dispose();
    },
  };
}
