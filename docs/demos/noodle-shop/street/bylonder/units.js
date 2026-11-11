// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The registry of units: implementations of the IR's computed entities by type key (docs/ir.md). A page or a script
// registers a unit before it loads a scene; the scheduler then runs every entity of that type with it, ahead of what
// the package ships (a clean-room unit, Babylon's own, Blender's kernels) and of the baked snapshot.
import * as z from './zod.js';
import { explain } from './ir.js';

/**
 * A unit takes an entity's inputs as plain values (numbers, arrays, an IR mesh) and gives its outputs by name; it may
 * answer later (a Promise). It never sees Blender's structures. With an `inputs` schema, its inputs are parsed with it
 * first: defaults filled, and an entity it cannot take reported by path.
 * @template [I=Record<string, any>]
 * @typedef {{ inputs?: z.ZodMiniType<I, any>, run(inputs: I, context: { frame: number }): Record<string, any> | Promise<Record<string, any>> }} Unit
 */

/** @type {Map<string, Unit<any>>} */
const units = new Map();

/**
 * Registers `unit` for a type key (`modifier:BEVEL`), or for every key with a prefix (`driver:*`).
 * @template [I=Record<string, any>]
 * @param {string} type
 * @param {Unit<I>} unit
 */
export function register(type, unit) {
  units.set(type, unit);
}

/** @param {string} type */
export function unregister(type) {
  units.delete(type);
}

/**
 * The unit registered for a type key: its own, else the longest prefix key that covers it.
 * @param {string} type
 * @returns {Unit<any> | undefined}
 */
export function unitFor(type) {
  if (units.has(type)) return units.get(type);
  const prefixes = [...units.keys()].filter((key) => key.endsWith('*') && type.startsWith(key.slice(0, -1)));
  return units.get(prefixes.sort((a, b) => b.length - a.length)[0] ?? '');
}

/**
 * Runs a unit on an entity's resolved inputs, parsed with its schema when it has one.
 * @param {Unit<any>} unit
 * @param {Record<string, any>} inputs
 * @param {{ frame: number }} context
 * @param {string} key the entity's, named when its inputs do not fit
 */
export function runUnit(unit, inputs, context, key) {
  if (!unit.inputs) return unit.run(inputs, context);
  const parsed = z.safeParse(unit.inputs, inputs, { reportInput: true });
  if (!parsed.success) throw new Error(explain(parsed.error, `${key} inputs`));
  return unit.run(parsed.data, context);
}
