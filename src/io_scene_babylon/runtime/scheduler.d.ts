/**
 * @param {import('./ir.js').IR} ir
 * @param {Page} page
 */
export function createScheduler(ir: import("./ir.js").IR, page: Page): {
    /** A property was set. @param {string} path */
    changed(path: string): void;
    /** Resolves once every entity set going has run. */
    settled(): Promise<void>;
    dispose: () => boolean;
};
/**
 * An implementation the package ships: it runs an entity on its resolved inputs; `draw` gives an IR mesh's draw buffers.
 * @typedef {{ run(inputs: Record<string, any>, context: { frame: number }, entity: import('./ir.js').Entity): Record<string, any> | Promise<Record<string, any>>,
 *   draw?(mesh: import('./ir.js').Mesh): Promise<import('./mesh.js').DrawBuffers>, settled?(): Promise<void> }} Evaluator
 * @typedef {{ paths: string[], defaults: any[], get(path: string): any, write(path: string, value: any): void, frame(): number }} Controls
 * What an implementation loads for: the page's scene, the package's URL, scene.bin's buffers and the properties.
 * @typedef {{ scene: import('@babylonjs/core').Scene, root: string, buffers: ArrayBufferView[], controls: Controls }} Page
 */
/** The implementations a package ships, by name, each loaded on first use. @type {Record<string, (page: Page) => Promise<Evaluator>>} */
export const EVALUATORS: Record<string, (page: Page) => Promise<Evaluator>>;
/** What Babylon runs itself (`animation`: the AnimationGroup), which the scheduler leaves to it unless a unit takes over. */
export const NATIVE: string[];
/**
 * An implementation the package ships: it runs an entity on its resolved inputs; `draw` gives an IR mesh's draw buffers.
 */
export type Evaluator = {
    run(inputs: Record<string, any>, context: {
        frame: number;
    }, entity: import("./ir.js").Entity): Record<string, any> | Promise<Record<string, any>>;
    draw?(mesh: import("./ir.js").Mesh): Promise<import("./mesh.js").DrawBuffers>;
    settled?(): Promise<void>;
};
/**
 * What an implementation loads for: the page's scene, the package's URL, scene.bin's buffers and the properties.
 */
export type Controls = {
    paths: string[];
    defaults: any[];
    get(path: string): any;
    write(path: string, value: any): void;
    frame(): number;
};
/**
 * An implementation the package ships: it runs an entity on its resolved inputs; `draw` gives an IR mesh's draw buffers.
 */
export type Page = {
    scene: import("@babylonjs/core").Scene;
    root: string;
    buffers: ArrayBufferView[];
    controls: Controls;
};
