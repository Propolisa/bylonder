// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `driver` implementation of `driver:*` entities: a Blender driver run by the clean-room driver units (drivers/,
// written from Blender's observed behavior only, docs/clean-room/), on its resolved inputs: its driver, with each single
// property's value, the objects its transform variables read, its F-Curve and the frame when its expression reads it.
import { evaluateDriver } from './drivers/driver.js';
import { evaluateFCurve, prepareFCurve } from './drivers/fcurve.js';

/** Each entity's F-Curve, prepared once. @type {WeakMap<object, any>} */
const curves = new WeakMap();

/**
 * A driver's value, through its F-Curve when it has keys.
 * @param {Record<string, any>} inputs
 * @param {{ frame: number }} context
 * @param {object} entity
 */
export function run({ driver, curve, objects, frame }, context, entity) {
  const { value } = evaluateDriver(driver, { frame: frame ?? context.frame, objects });
  if (!curve) return { value };
  if (!curves.has(entity)) curves.set(entity, prepareFCurve(curve));
  return { value: evaluateFCurve(curves.get(entity), value) };
}
