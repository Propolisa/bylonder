export const breathe: (options?: Partial<{
    /** Breaths per second. */
    rate: number;
    /** How far the chest turns, in radians. */
    depth: number;
}> | undefined) => import("../api.js").Effect<any>;
