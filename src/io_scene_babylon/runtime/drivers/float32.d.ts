/** @typedef {number[][]} Mat3 rows of a 3x3 matrix acting on column vectors */
export const f: (x: number) => number;
export function dot(a: number[], b: number[]): number;
export function mul3(a: Mat3, b: Mat3): Mat3;
export function apply3(a: Mat3, v: number[]): number[];
export function column(a: Mat3, c: number): number[];
export function length(v: number[]): number;
export function det3(a: Mat3): number;
/**
 * rows of a 3x3 matrix acting on column vectors
 */
export type Mat3 = number[][];
