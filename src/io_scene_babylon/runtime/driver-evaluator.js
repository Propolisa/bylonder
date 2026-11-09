// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `driver` evaluator of the dependency table: a Blender driver run by the clean-room driver units (drivers/,
// written from Blender's observed behavior only, docs/clean-room/), its inputs read from the package's controls.
import { evaluateDriver } from './drivers/driver.js';
import { evaluateFCurve, prepareFCurve } from './drivers/fcurve.js';

/** Each operation's F-Curve, prepared once. @type {WeakMap<object, any>} */
const curves = new WeakMap();

/**
 * An object of the operation as the driver units take it: its transform from the controls, its static parts as given.
 * @param {any} data
 * @param {(index: number) => any} read
 */
function objectOf(data, read) {
  const { controls, ...rest } = data;
  return { ...rest, ...Object.fromEntries(Object.entries(controls).map(([name, indices]) => [name, indices.map(read)])) };
}

/**
 * Runs a driver operation: its value, through its F-Curve when it has keys.
 * @param {import('./scheduler.js').Operation} operation
 * @param {(index: number) => any} read
 * @param {number} frame
 */
export function run(operation, read, frame) {
  const { driver, curve, objects } = operation.data;
  // A single property's target is the control it reads (its index); the units take its value.
  const variables = driver.variables.map((/** @type {any} */ variable) => ({
    ...variable, targets: variable.targets.map((/** @type {any} */ t) => (t.control !== undefined ? { value: read(t.control) } : t)),
  }));
  const objectsData = Object.fromEntries(Object.entries(objects).map(([name, data]) => [name, objectOf(data, read)]));
  const { value } = evaluateDriver({ ...driver, variables }, { frame, objects: objectsData });
  if (!curve) return [value];
  if (!curves.has(operation)) curves.set(operation, prepareFCurve(curve));
  return [evaluateFCurve(curves.get(operation), value)];
}
