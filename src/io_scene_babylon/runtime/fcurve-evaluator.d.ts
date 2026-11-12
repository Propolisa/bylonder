/**
 * Keys as scene.bin holds them.
 * @param {import('./drivers/fcurve.js').KeyframeInput[]} keyframes
 */
export function packKeys(keyframes: import("./drivers/fcurve.js").KeyframeInput[]): Float32Array<ArrayBuffer>;
/**
 * The keys of a buffer of packKeys.
 * @param {ArrayLike<number>} data
 * @returns {import('./drivers/fcurve.js').KeyframeInput[]}
 */
export function unpackKeys(data: ArrayLike<number>): import("./drivers/fcurve.js").KeyframeInput[];
/**
 * The F-Curve's value at the frame.
 * @param {Record<string, any>} inputs its `curve` (fcurve.js FCurveInput, its keyframes a buffer of packKeys) and `frame`
 * @param {{ frame: number }} context
 * @param {object} entity
 */
export function run({ curve, frame }: Record<string, any>, context: {
    frame: number;
}, entity: object): {
    value: number;
};
/**
 * A curve's value at a frame: an integer or boolean property's (`whole`) rounded, as Blender evaluates its F-Curve.
 * @param {{ whole?: boolean }} input @param {import('./drivers/fcurve.js').FCurve} prepared @param {number} frame
 */
export function curveValue(input: {
    whole?: boolean;
}, prepared: import("./drivers/fcurve.js").FCurve, frame: number): number;
export const INTERPOLATIONS: string[];
export const EASINGS: string[];
export const HANDLE_TYPES: string[];
/** A key's floats: co, handle_left, handle_right, interpolation, easing, handle types (left, right), back, amplitude, period. */
export const KEY_SIZE: 13;
