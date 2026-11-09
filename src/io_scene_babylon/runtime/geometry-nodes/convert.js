// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Implicit conversions between socket types where a link joins two of different types, as Blender's manual describes
// them: a vector read as a number is its components' mean, a number as a vector fills every component, a number is
// true when above zero, a vector when not zero.

const mean = (/** @type {number[]} */ v) => v.reduce((a, b) => a + b, 0) / v.length;
const NUMBER = { VALUE: true, INT: true, BOOLEAN: true }, TUPLE = { VECTOR: 3, RGBA: 4 };

/**
 * One value of socket type `from` as socket type `to` (types as RNA's socket.type names them).
 * @param {any} value
 * @param {string} from
 * @param {string} to
 */
export function convert(value, from, to) {
  if (from === to || value === null || typeof value === 'object' && !Array.isArray(value)) return value;
  const n = Array.isArray(value) ? mean(value) : Number(value);
  switch (to) {
    case 'VALUE': return n;
    case 'INT': return Math.trunc(n);
    case 'BOOLEAN': return Array.isArray(value) ? value.some((x) => x !== 0) : n > 0;
    case 'VECTOR': return Array.isArray(value) ? [value[0], value[1], value[2] ?? 0] : [n, n, n];
    case 'RGBA': return Array.isArray(value) ? (value.length === 4 ? value : [value[0], value[1], value[2], 1]) : [n, n, n, 1];
    default: return value;
  }
}

/** Whether a socket type carries data a field can hold. @param {string} type */
export const isFieldType = (type) => type in NUMBER || type in TUPLE || type === 'ROTATION' || type === 'MATRIX';
