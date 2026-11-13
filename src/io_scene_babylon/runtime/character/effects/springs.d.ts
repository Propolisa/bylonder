export const springs: (options?: Partial<{
    /** The bones (by name) that swing. */
    bones: string[];
    /** How hard each is pulled back to its pose, per second squared. */
    stiffness: number;
    /** How quickly swinging dies out, per second. */
    damping: number;
    /** Gravity's pull on the masses, in metres per second squared. */
    gravity: number;
    /** How many of the bones swing, from the root. */
    count: number;
}> | undefined) => import("../api.js").Effect<any>;
