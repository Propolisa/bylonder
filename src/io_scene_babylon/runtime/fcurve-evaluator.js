// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The `fcurve` implementation of `animation:FCURVE` entities: an F-Curve Babylon cannot play exactly (an Euler rotation,
// an easing, another extrapolation, a Cycles modifier it cannot repeat), run by the clean-room F-Curve unit
// (drivers/fcurve.js) at the frame. Its keys are a buffer of scene.bin, KEY_SIZE floats per key.
import { evaluateFCurve, prepareFCurve } from './drivers/fcurve.js';

export const INTERPOLATIONS = ['CONSTANT', 'LINEAR', 'BEZIER', 'SINE', 'QUAD', 'CUBIC', 'QUART', 'QUINT', 'EXPO', 'CIRC', 'BACK', 'BOUNCE', 'ELASTIC'];
export const EASINGS = ['AUTO', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'];
export const HANDLE_TYPES = ['FREE', 'ALIGNED', 'VECTOR', 'AUTO', 'AUTO_CLAMPED'];
/** A key's floats: co, handle_left, handle_right, interpolation, easing, handle types (left, right), back, amplitude, period. */
export const KEY_SIZE = 13;

/**
 * Keys as scene.bin holds them.
 * @param {import('./drivers/fcurve.js').KeyframeInput[]} keyframes
 */
export function packKeys(keyframes) {
  const out = new Float32Array(keyframes.length * KEY_SIZE);
  keyframes.forEach((k, i) => out.set([...k.co, ...(k.handle_left ?? k.co), ...(k.handle_right ?? k.co), INTERPOLATIONS.indexOf(k.interpolation ?? 'BEZIER'),
    EASINGS.indexOf(k.easing ?? 'AUTO'), HANDLE_TYPES.indexOf(k.handle_left_type ?? 'AUTO_CLAMPED'), HANDLE_TYPES.indexOf(k.handle_right_type ?? 'AUTO_CLAMPED'),
    k.back ?? 1.70158, k.amplitude ?? 0.8, k.period ?? 4.1], i * KEY_SIZE));
  return out;
}

/**
 * The keys of a buffer of packKeys.
 * @param {ArrayLike<number>} data
 * @returns {import('./drivers/fcurve.js').KeyframeInput[]}
 */
export function unpackKeys(data) {
  return Array.from({ length: data.length / KEY_SIZE }, (_, i) => {
    const k = Array.from(data).slice(i * KEY_SIZE, (i + 1) * KEY_SIZE);
    return { co: [k[0], k[1]], handle_left: [k[2], k[3]], handle_right: [k[4], k[5]], interpolation: INTERPOLATIONS[k[6]], easing: EASINGS[k[7]],
      handle_left_type: /** @type {any} */ (HANDLE_TYPES[k[8]]), handle_right_type: /** @type {any} */ (HANDLE_TYPES[k[9]]), back: k[10], amplitude: k[11], period: k[12] };
  });
}

/** Each entity's F-Curve, prepared once. @type {WeakMap<object, import('./drivers/fcurve.js').FCurve>} */
const curves = new WeakMap();

/**
 * The F-Curve's value at the frame.
 * @param {Record<string, any>} inputs its `curve` (fcurve.js FCurveInput, its keyframes a buffer of packKeys) and `frame`
 * @param {{ frame: number }} context
 * @param {object} entity
 */
export function run({ curve, frame }, context, entity) {
  if (!curves.has(entity)) curves.set(entity, prepareFCurve({ ...curve, keyframes: unpackKeys(curve.keyframes) }));
  return { value: curveValue(curve, /** @type {import('./drivers/fcurve.js').FCurve} */ (curves.get(entity)), frame ?? context.frame) };
}

/**
 * A curve's value at a frame: an integer or boolean property's (`whole`) rounded, as Blender evaluates its F-Curve.
 * @param {{ whole?: boolean }} input @param {import('./drivers/fcurve.js').FCurve} prepared @param {number} frame
 */
export function curveValue(input, prepared, frame) {
  const value = evaluateFCurve(prepared, frame);
  return input.whole ? Math.floor(value + 0.5) : value;
}
