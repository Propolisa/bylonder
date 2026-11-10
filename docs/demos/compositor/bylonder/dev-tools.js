// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Babylon's own editors for what the control panel shows: the Inspector (an object, a light, a camera or a material
// selected), the Node Material Editor and the Node Render Graph Editor. They are Babylon's UMD bundles, which read
// Babylon from the global BABYLON: the page's own modules are given there, so the editors work on the scene's objects.
// They load from Babylon's CDN, or from the package's bylonder-dev-tools/ when the export ships them; nothing else of
// a page goes online.
import '@babylonjs/core/Debug/debugLayer.js';
import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { Tools } from '@babylonjs/core/Misc/tools.js';

/** @typedef {import('./control-panel.js').PanelOptions} PanelOptions */

// Each editor's file, as Babylon's CDN and a package's bylonder-dev-tools/ hold it.
export const DEV_TOOLS = { gui: 'gui/babylon.gui.min.js', inspector: 'inspector/babylon.inspector.bundle.js', nodeEditor: 'nodeEditor/babylon.nodeEditor.js',
  nodeRenderGraphEditor: 'nodeRenderGraphEditor/babylon.nodeRenderGraphEditor.js' };

/** @param {keyof typeof DEV_TOOLS} tool @param {PanelOptions} options */
const urlOf = (tool, { tools = 'CDN', root = globalThis.location?.href }) => (tools === 'PACKAGE'
  ? new URL(`bylonder-dev-tools/${DEV_TOOLS[tool]}`, root).href : `https://cdn.babylonjs.com/v${AbstractEngine.Version}/${DEV_TOOLS[tool]}`);

/** @type {Promise<void> | null} */
let global = null;
// BABYLON, as the editors' bundles read it: the page's own Babylon (the same modules, from its import map or its
// bundle), with Babylon's GUI, which the Inspector needs.
/** @param {PanelOptions} options */
const babylonGlobal = (options) => (global ??= (async () => {
  const g = /** @type {any} */ (globalThis);
  if (!g.BABYLON?.Engine) {
    const core = await import('@babylonjs/core/index.js');
    g.BABYLON = { ...core, Debug: { ...core } };
  }
  if (!g.BABYLON.GUI) await Tools.LoadBabylonScriptAsync(urlOf('gui', options));
})());

/**
 * The Inspector, embedded beside the scene, with `entity` selected.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {any} entity
 * @param {PanelOptions} options
 */
export async function inspect(scene, entity, options) {
  await babylonGlobal(options);
  await scene.debugLayer.show({ embedMode: true, inspectorURL: urlOf('inspector', options) });
  if (entity) scene.debugLayer.select(entity);
}

/**
 * The Node Material Editor of a node material.
 * @param {import('@babylonjs/core').NodeMaterial} material
 * @param {PanelOptions} options
 */
export async function editMaterial(material, options) {
  await babylonGlobal(options);
  await material.edit({ editorURL: urlOf('nodeEditor', options) });
}

/**
 * The Node Render Graph Editor of the scene's compositor.
 * @param {import('@babylonjs/core').NodeRenderGraph} graph
 * @param {PanelOptions} options
 */
export async function editRenderGraph(graph, options) {
  await babylonGlobal(options);
  await graph.edit({ editorURL: urlOf('nodeRenderGraphEditor', options) });
}
