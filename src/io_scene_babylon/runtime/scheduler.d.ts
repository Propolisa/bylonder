/**
 * @param {Table} table
 * @param {Page} page
 */
export function createScheduler(table: Table, page: Page): {
    /** A control was set. @param {string} path */
    changed(path: string): void;
    /** Resolves once every operation set going has run. */
    settled(): Promise<void>;
    /** Whether a control is written by an operation of the table. @param {string} path */
    writes: (path: string) => boolean;
    dispose: () => boolean;
};
/**
 * An operation of the table: what it reads and writes (indices of the package's controls), the evaluator that runs it
 * and that evaluator's data.
 * @typedef {{ evaluator: string, reads: number[], writes: number[], baked?: string, data: any }} Operation
 * @typedef {{ version: number, operations: Operation[], order: number[] }} Table
 * An evaluator runs an operation and gives what it writes; one that finishes later (in a worker) resolves `settled`.
 * @typedef {{ run(operation: Operation, read: (index: number) => any, frame: number): any[], settled?(): Promise<void> }} Evaluator
 * @typedef {{ paths: string[], defaults: any[], get(path: string): any, write(path: string, value: any): void, frame(): number }} Controls
 * What an evaluator loads for: the page's scene, the package's URL, scene.bin's buffers and the controls.
 * @typedef {{ scene: import('@babylonjs/core').Scene, root: string, buffers: ArrayBufferView[], controls: Controls }} Page
 */
/** The evaluators by name, each loaded on first use. @type {Record<string, (page: Page) => Promise<Evaluator>>} */
export const EVALUATORS: Record<string, (page: Page) => Promise<Evaluator>>;
/**
 * An operation of the table: what it reads and writes (indices of the package's controls), the evaluator that runs it
 * and that evaluator's data.
 */
export type Operation = {
    evaluator: string;
    reads: number[];
    writes: number[];
    baked?: string;
    data: any;
};
/**
 * An evaluator runs an operation and gives what it writes; one that finishes later (in a worker) resolves `settled`.
 */
export type Table = {
    version: number;
    operations: Operation[];
    order: number[];
};
/**
 * An operation of the table: what it reads and writes (indices of the package's controls), the evaluator that runs it
 * and that evaluator's data.
 */
export type Evaluator = {
    run(operation: Operation, read: (index: number) => any, frame: number): any[];
    settled?(): Promise<void>;
};
/**
 * What an evaluator loads for: the page's scene, the package's URL, scene.bin's buffers and the controls.
 */
export type Controls = {
    paths: string[];
    defaults: any[];
    get(path: string): any;
    write(path: string, value: any): void;
    frame(): number;
};
/**
 * An operation of the table: what it reads and writes (indices of the package's controls), the evaluator that runs it
 * and that evaluator's data.
 */
export type Page = {
    scene: import("@babylonjs/core").Scene;
    root: string;
    buffers: ArrayBufferView[];
    controls: Controls;
};
