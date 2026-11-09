/**
 * Runs a driver operation: its value, through its F-Curve when it has keys.
 * @param {import('./scheduler.js').Operation} operation
 * @param {(index: number) => any} read
 * @param {number} frame
 */
export function run(operation: import("./scheduler.js").Operation, read: (index: number) => any, frame: number): number[];
