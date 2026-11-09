/** @param {FCurveInput} input @returns {FCurve} sorted keys with recalculated handles */
export function prepareFCurve(input: FCurveInput): FCurve;
/** @param {FCurve} curve @param {number} time */
export function evaluateFCurve(curve: FCurve, time: number): number;
/**
 * Evaluates an F-Curve description at the given times.
 * @param {FCurveInput & { times?: number[] }} input
 */
export function evaluateFCurveRequest(input: FCurveInput & {
    times?: number[];
}): {
    values: number[];
    handles: {
        co: Point;
        handle_left: Point;
        handle_right: Point;
        handle_left_type: HandleType;
        handle_right_type: HandleType;
    }[];
};
/**
 * constant + sum of coefficient * unknown
 */
export type Linear = {
    constant: number;
    terms: Map<number, number>;
};
export type Point = [number, number];
export type HandleType = "FREE" | "ALIGNED" | "VECTOR" | "AUTO" | "AUTO_CLAMPED";
export type KeyframeInput = {
    co: Point;
    handle_left?: Point;
    handle_right?: Point;
    interpolation?: string;
    easing?: string;
    handle_left_type?: HandleType;
    handle_right_type?: HandleType;
    back?: number;
    amplitude?: number;
    period?: number;
    select?: boolean[];
};
export type Key = {
    co: Point;
    left: Point;
    right: Point;
    leftType: HandleType;
    rightType: HandleType;
    interpolation: string;
    easing: string;
    back: number;
    amplitude: number;
    period: number;
    leftSelected: boolean;
};
export type CyclesInput = {
    mode_before?: string;
    mode_after?: string;
    cycles_before?: number;
    cycles_after?: number;
};
export type Cycles = {
    mode_before: string;
    mode_after: string;
    cycles_before: number;
    cycles_after: number;
};
export type FCurveInput = {
    keyframes: KeyframeInput[];
    extrapolation?: string;
    cycles?: boolean | CyclesInput;
    auto_smoothing?: string;
};
export type FCurve = {
    keys: Key[];
    extrapolation: string;
    cycles: Cycles | null;
};
