// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `blender` evaluator of the dependency table: Blender itself, for what only Blender evaluates (a Geometry Nodes
// modifier's input). Loaded on the first set of such a control, it fetches the package's scene.blend and the Blender
// fallback (bylonder-blender/: Blender's module and the code that draws Main's results into the page, GPL, shipped
// only when the export includes its source .blend), opens one in the other, and from then on sets in Main, by RNA
// path, every control changed since it last ran, and draws what Main evaluated.
import { readBytes } from './buffers.js';

/**
 * The Blender fallback's interface (bylonder-blender/blender.js).
 * @typedef {{ set(path: string, value: any): void, evaluate(frame: number): void }} Blend
 */

/**
 * @param {import('./scheduler.js').Page} page its controls' defaults are what Main holds in scene.blend
 * @returns {Promise<import('./scheduler.js').Evaluator>}
 */
export async function load({ scene, root, controls: { paths, defaults } }) {
  const [fallback, bytes] = await Promise.all([import(new URL('bylonder-blender/blender.js', root).href), readBytes(new URL('scene.blend', root))]);
  /** @type {Blend} */
  const blend = await fallback.openBlend(scene, bytes);
  const held = [...defaults];
  return {
    run(operation, read, frame) {
      paths.forEach((path, i) => {
        const value = read(i);
        if (value === held[i]) return;
        held[i] = value;
        // A control Blender's RNA does not take as it is (an image as its URL) stays the page's.
        try { blend.set(path, value); } catch { /* the page's alone */ }
      });
      blend.evaluate(frame);
      return [];
    },
  };
}
