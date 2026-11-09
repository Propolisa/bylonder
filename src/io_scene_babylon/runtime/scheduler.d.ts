/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {Table} table
 * @param {Controls} controls
 * @param {string} root the package's URL, which evaluators load their files from
 */
export function createScheduler(scene: import("@babylonjs/core").Scene, table: Table, controls: Controls, root: string): {
    /** A control was set. @param {string} path */
    changed(path: string): void;
    /** Resolves once every operation set going has run. */
    settled: () => Promise<void>;
    /** Whether a control is written by an operation of the table. @param {string} path */
    writes: (path: string) => boolean;
    dispose: () => boolean;
};
/**
 * An operation of the table: what it reads and writes (indices of the package's controls), the evaluator that runs it
 * and that evaluator's data.
 * @typedef {{ evaluator: string, reads: number[], writes: number[], baked?: string, data: any }} Operation
 * @typedef {{ version: number, operations: Operation[], order: number[] }} Table
 * @typedef {{ run(operation: Operation, read: (index: number) => any, frame: number): any[] }} Evaluator
 * @typedef {{ paths: string[], defaults: any[], get(path: string): any, write(path: string, value: any): void, frame(): number }} Controls
 */
/**
 * The evaluators by name, each loaded on first use for the page's scene, the package's URL and its controls.
 * @type {Record<string, (scene: import('@babylonjs/core').Scene, root: string, controls: Controls) => Promise<Evaluator>>}
 */
export const EVALUATORS: Record<string, (scene: import("@babylonjs/core").Scene, root: string, controls: Controls) => Promise<Evaluator>>;
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
 * An operation of the table: what it reads and writes (indices of the package's controls), the evaluator that runs it
 * and that evaluator's data.
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
};
/**
 * An operation of the table: what it reads and writes (indices of the package's controls), the evaluator that runs it
 * and that evaluator's data.
 */
export type Controls = {
    paths: string[];
    defaults: any[];
    get(path: string): any;
    write(path: string, value: any): void;
    frame(): number;
};
