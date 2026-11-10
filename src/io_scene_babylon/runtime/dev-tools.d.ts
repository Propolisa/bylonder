/**
 * The Inspector, embedded beside the scene, with `entity` selected.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {any} entity
 * @param {PanelOptions} options
 */
export function inspect(scene: import("@babylonjs/core").Scene, entity: any, options: PanelOptions): Promise<void>;
/**
 * The Node Material Editor of a node material.
 * @param {import('@babylonjs/core').NodeMaterial} material
 * @param {PanelOptions} options
 */
export function editMaterial(material: import("@babylonjs/core").NodeMaterial, options: PanelOptions): Promise<void>;
/**
 * The Node Render Graph Editor of the scene's compositor.
 * @param {import('@babylonjs/core').NodeRenderGraph} graph
 * @param {PanelOptions} options
 */
export function editRenderGraph(graph: import("@babylonjs/core").NodeRenderGraph, options: PanelOptions): Promise<void>;
export namespace DEV_TOOLS {
    let gui: string;
    let inspector: string;
    let nodeEditor: string;
    let nodeRenderGraphEditor: string;
}
export type PanelOptions = import("./control-panel.js").PanelOptions;
