export const lean: (options?: Partial<{
    /** How much of a balanced lean, 1 being physical. */
    amount: number;
    /** The largest lean, in radians (12 degrees). */
    limit: number;
    halfLife: number;
}> | undefined) => import("../api.js").Effect<any>;
