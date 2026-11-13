/** @param {import('./ir.js').IR} ir @param {Page} page */
export function createScheduler(ir: import("./ir.js").IR, page: Page): {
    /** A property was set. @param {string} path */
    changed: (path: string) => void;
    /** A patch replaced entities (null where gone), graphs, and the objects of those whose implementation `remade` names:
     * each is let go of (`detach`), the order made again, and they, readers of a replaced graph and their readers run.
     * @param {Record<string, import('./ir.js').Entity | null>} replaced @param {string[]} graphs @param {(name: string) => boolean} remade */
    replace(replaced: Record<string, import("./ir.js").Entity | null>, graphs: string[], remade: (name: string) => boolean): void;
    /** The frames IDs show changed (a time offset): what reads the frame runs again. */
    retimed: () => void;
    /** Resolves once every entity set going has run. */
    settled(): Promise<void>;
    dispose: () => boolean;
};
/**
 * An implementation the package ships: it runs an entity on its resolved inputs; `runChain` runs a chain of entities
 * that each read the one before, in one call, giving the last one's outputs; `draw` gives an IR mesh's draw buffers;
 * `detach` lets go of what it holds for an entity a patch replaced or whose objects it made again.
 * @typedef {Record<string, any> | Promise<Record<string, any>>} Outputs
 * @typedef {{ run(inputs: Record<string, any>, context: { frame: number }, entity: import('./ir.js').Entity): Outputs,
 *   runChain?(run: [Record<string, any>, import('./ir.js').Entity][], context: { frame: number }): Outputs,
 *   draw?(mesh: import('./ir.js').Mesh): Promise<import('./mesh.js').DrawBuffers>, settled?(): Promise<void>, detach?(entity: import('./ir.js').Entity): void }} Evaluator
 * @typedef {{ get(path: string): any, write(path: string, value: any): void, set(path: string, value: any): void, frame(id?: string): number }} Controls `frame(id)`: the frame an ID shows (its time offset applied); `set`: a write from outside the scheduler's run, whose readers then run
 * What an implementation loads for: the page's scene, the package's URL, the IR, scene.bin's buffers and the properties.
 * @typedef {{ scene: import('@babylonjs/core').Scene, root: string, ir: import('./ir.js').IR, buffers: import('./buffers.js').Buffers, controls: Controls }} Page
 */
/** The implementations a package ships, by name, each loaded on first use. @type {Record<string, (page: Page) => Promise<Evaluator>>} */
export const EVALUATORS: Record<string, (page: Page) => Promise<Evaluator>>;
/** What Babylon runs itself (`native`: an F-Curve its AnimationGroup plays), which the scheduler leaves to it unless a unit takes over. */
export const NATIVE: string[];
/**
 * An implementation the package ships: it runs an entity on its resolved inputs; `runChain` runs a chain of entities
 * that each read the one before, in one call, giving the last one's outputs; `draw` gives an IR mesh's draw buffers;
 * `detach` lets go of what it holds for an entity a patch replaced or whose objects it made again.
 */
export type Outputs = Record<string, any> | Promise<Record<string, any>>;
/**
 * An implementation the package ships: it runs an entity on its resolved inputs; `runChain` runs a chain of entities
 * that each read the one before, in one call, giving the last one's outputs; `draw` gives an IR mesh's draw buffers;
 * `detach` lets go of what it holds for an entity a patch replaced or whose objects it made again.
 */
export type Evaluator = {
    run(inputs: Record<string, any>, context: {
        frame: number;
    }, entity: import("./ir.js").Entity): Outputs;
    runChain?(run: [Record<string, any>, import("./ir.js").Entity][], context: {
        frame: number;
    }): Outputs;
    draw?(mesh: import("./ir.js").Mesh): Promise<import("./mesh.js").DrawBuffers>;
    settled?(): Promise<void>;
    detach?(entity: import("./ir.js").Entity): void;
};
/**
 * `frame(id)`: the frame an ID shows (its time offset applied); `set`: a write from outside the scheduler's run, whose readers then run
 * What an implementation loads for: the page's scene, the package's URL, the IR, scene.bin's buffers and the properties.
 */
export type Controls = {
    get(path: string): any;
    write(path: string, value: any): void;
    set(path: string, value: any): void;
    frame(id?: string): number;
};
/**
 * An implementation the package ships: it runs an entity on its resolved inputs; `runChain` runs a chain of entities
 * that each read the one before, in one call, giving the last one's outputs; `draw` gives an IR mesh's draw buffers;
 * `detach` lets go of what it holds for an entity a patch replaced or whose objects it made again.
 */
export type Page = {
    scene: import("@babylonjs/core").Scene;
    root: string;
    ir: import("./ir.js").IR;
    buffers: import("./buffers.js").Buffers;
    controls: Controls;
};
