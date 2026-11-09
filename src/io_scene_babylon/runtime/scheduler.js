// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The page's scheduler: when a control is set, the operations of the dependency table that read it (and those reading
// what they write) run in the table's order, each through its evaluator, and write their controls. An operation that
// has run stays live: Babylon's animation plays its baked samples each frame, and the scheduler writes the live value
// back after it. An evaluator's module loads the first time one of its operations runs.

/**
 * An operation of the table: what it reads and writes (indices of the package's controls), the evaluator that runs it
 * and that evaluator's data.
 * @typedef {{ evaluator: string, reads: number[], writes: number[], baked?: string, data: any }} Operation
 * @typedef {{ version: number, operations: Operation[], order: number[] }} Table
 * @typedef {{ run(operation: Operation, read: (index: number) => any, frame: number): any[] }} Evaluator
 */

/** The evaluators by name, each its module, loaded on first use. @type {Record<string, () => Promise<Evaluator>>} */
export const EVALUATORS = {
  driver: () => import('./driver-evaluator.js'),
};

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {Table} table
 * @param {{ paths: string[], get(path: string): any, write(path: string, value: any): void, frame(): number }} controls
 */
export function createScheduler(scene, table, controls) {
  const readers = new Map(), marked = new Set(), live = new Map(), loaded = new Map();
  table.operations.forEach((op, i) => op.reads.forEach((r) => readers.set(r, [...(readers.get(r) ?? []), i])));
  /** @type {Promise<void> | null} */
  let pending = null;

  /** Marks the operations reading a control, and those reading what they write. @param {number} index */
  const mark = (index) => {
    for (const i of readers.get(index) ?? []) {
      if (marked.has(i)) continue;
      marked.add(i);
      table.operations[i].writes.forEach(mark);
    }
  };

  /** @param {string} name */
  const evaluator = (name) => {
    if (!loaded.has(name)) loaded.set(name, EVALUATORS[name]().then((module) => loaded.set(name, module)));
    const value = loaded.get(name);
    return value instanceof Promise ? null : value;
  };

  /** Runs the marked operations in order; those whose evaluator is loading wait for it. */
  const run = () => {
    const read = (/** @type {number} */ index) => controls.get(controls.paths[index]);
    for (const i of table.order) {
      if (!marked.has(i)) continue;
      const op = table.operations[i], module = evaluator(op.evaluator);
      if (!module) {
        pending ??= /** @type {Promise<any>} */ (loaded.get(op.evaluator)).then(() => { pending = null; run(); });
        return;
      }
      marked.delete(i);
      const values = module.run(op, read, controls.frame());
      live.set(i, values);
      op.writes.forEach((w, k) => controls.write(controls.paths[w], values[k]));
    }
  };

  // Babylon's animation plays the baked samples of what a live operation writes: its value is written after them.
  const replay = scene.onAfterAnimationsObservable.add(() => {
    for (const [i, values] of live) table.operations[i].writes.forEach((w, k) => controls.write(controls.paths[w], values[k]));
  });

  return {
    /** A control was set. @param {string} path */
    changed(path) {
      mark(controls.paths.indexOf(path));
      if (marked.size) run();
    },
    /** Resolves once every operation set going has run. */
    settled: async () => { while (pending) await pending; },
    /** Whether a control is written by an operation of the table. @param {string} path */
    writes: (path) => table.operations.some((op) => op.writes.some((w) => controls.paths[w] === path)),
    dispose: () => scene.onAfterAnimationsObservable.remove(replay),
  };
}
