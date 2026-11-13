export const impact: (options?: Partial<{
    /** The share of an impulse each joint takes up, the rest passing to its parent. */
    absorb: number;
    /** How stiffly offsets spring back, per second squared. */
    stiffness: number;
    /** The impulse, in newton seconds, from which a hit shoves the character into a step. */
    step: number;
    /** How many joints up from the hit bone react. */
    joints: number;
}> | undefined) => import("../api.js").Effect<any>;
