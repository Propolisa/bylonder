/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {Table} table
 * @param {{ paths: string[], get(path: string): any, write(path: string, value: any): void, frame(): number }} controls
 */
export function createScheduler(scene: import("@babylonjs/core").Scene, table: Table, controls: {
    paths: string[];
    get(path: string): any;
    write(path: string, value: any): void;
    frame(): number;
}): {
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
 */
/** The evaluators by name, each its module, loaded on first use. @type {Record<string, () => Promise<Evaluator>>} */
export const EVALUATORS: Record<string, () => Promise<Evaluator>>;
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
