// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// How much of the view each material covers and the colour it shows there, for the control panel's materials: the scene
// drawn small, each material a flat colour of its own, read back with the frame shown at the same size a few times a
// second while the panel is open and not at all otherwise.
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { seen } from './control-panel-model.js';

// The pass's width in pixels (its height follows the canvas) and how often it is read, in milliseconds.
const WIDTH = 64, EVERY = 400;

/**
 * Measures the share of the view each material covers (0 to 1) and its average colour there as shown (a CSS colour),
 * calling `measured` with them by material id.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(shares: Map<string, number>, colours: Map<string, string>) => void} measured
 */
export function createCoverage(scene, measured) {
  const engine = scene.getEngine(), canvas = /** @type {HTMLCanvasElement} */ (engine.getRenderingCanvas());
  const heightOf = () => Math.max(1, Math.round((WIDTH * engine.getRenderHeight()) / Math.max(1, engine.getRenderWidth())));
  let height = heightOf();
  const target = new RenderTargetTexture('__coverage', { width: WIDTH, height }, scene, { generateMipMaps: false });
  // The frame shown, scaled down on the GPU to the pass's size and read back from there.
  const frame = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
  const resized = engine.onResizeObservable.add(() => { height = heightOf(); target.resize({ width: WIDTH, height }); });
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
      // The frame drawn with this pass, copied before the browser shows it (and may clear it).
      await new Promise((resolve) => target.onAfterRenderObservable.addOnce(() => engine.onEndFrameObservable.addOnce(() => {
        Object.assign(frame.canvas, { width: WIDTH, height });
        frame.drawImage(canvas, 0, 0, WIDTH, height);
        resolve(null);
      })));
      const ids = /** @type {Uint8Array} */ (await target.readPixels()), shown = frame.getImageData(0, 0, WIDTH, height).data;
      /** @type {Map<string, number>} */
      const shares = new Map();
      /** @type {Map<string, string>} */
      const colours = new Map();
      for (const [id, { share, colour }] of seen(ids, shown)) {
        const material = materials[id - 1];
        if (material) { shares.set(material.id, share); colours.set(material.id, colour); }
      }
      measured(shares, colours);
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
      engine.onResizeObservable.remove(resized);
      scene.customRenderTargets.splice(scene.customRenderTargets.indexOf(target), 1);
      target.dispose();
      for (const m of [...flats, ...multis.values()]) m.dispose();
    },
  };
}
