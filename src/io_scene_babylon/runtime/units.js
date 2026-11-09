// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The registry of units: implementations of the IR's computed entities by type key (docs/ir.md). A page or a script
// registers a unit before it loads a scene; the scheduler then runs every entity of that type with it, ahead of what
// the package ships (a clean-room unit, Babylon's own, Blender's fallback) and of the baked snapshot.

/**
 * A unit takes an entity's inputs as plain values (numbers, arrays, an IR mesh) and gives its outputs by name; it may
 * answer later (a Promise). It never sees Blender's structures.
 * @typedef {{ run(inputs: Record<string, any>, context: { frame: number }): Record<string, any> | Promise<Record<string, any>> }} Unit
 */

/** @type {Map<string, Unit>} */
const units = new Map();

/**
 * Registers `unit` for a type key (`modifier:BEVEL`), or for every key with a prefix (`driver:*`).
 * @param {string} type
 * @param {Unit} unit
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
 * @returns {Unit | undefined}
 */
export function unitFor(type) {
  if (units.has(type)) return units.get(type);
  const prefixes = [...units.keys()].filter((key) => key.endsWith('*') && type.startsWith(key.slice(0, -1)));
  return units.get(prefixes.sort((a, b) => b.length - a.length)[0] ?? '');
}
