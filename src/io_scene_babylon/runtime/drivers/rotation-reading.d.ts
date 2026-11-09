/** Euler angles of a rotation matrix, for an order "ABC" (A applied first). @param {Mat3} n @param {string} order */
export function matrixToEuler(n: Mat3, order: string): number[];
/** Quaternion (w, x, y, z), w >= 0, of a matrix whose columns are normalized. @param {Mat3} n */
export function matrixToQuaternion(n: Mat3): number[];
/** @param {Mat3} n */
export function rawQuaternion(n: Mat3): {
    q: number[];
    m: number[][];
};
/**
 * One rotation channel (ROT_W, ROT_X, ROT_Y, ROT_Z) of a matrix whose columns are normalized.
 * @param {Mat3} n @param {string} mode the target's rotation mode: AUTO, an Euler order, QUATERNION or SWING_TWIST_*
 * @param {string} channel @param {string} objectMode the object's own rotation mode (used by AUTO)
 * @param {number[]} objectEuler the object's rotation_euler (the AUTO reference)
 */
export function readRotation(n: Mat3, mode: string, channel: string, objectMode: string, objectEuler: number[]): number;
/** Angle between two rotations given as matrices whose columns are normalized. @param {Mat3} a @param {Mat3} b */
export function rotationDifference(a: Mat3, b: Mat3): number;
/** @type {Record<string, number>} */
export const AXIS: Record<string, number>;
/**
 * rows of a 3x3 matrix acting on column vectors
 */
export type Mat3 = number[][];
