export const feet: (options?: Partial<{
    /** Highest step up or down a foot follows, in metres. */
    reach: number;
    /** Seconds the height and lock springs take to go half way. */
    halfLife: number;
    /** How much a planted foot turns to the ground's slope, 0 to 1. */
    align: number;
    /** How much more bent or straighter than the action a held foot may make its leg, as the knee's angle in radians. */
    give: number;
}> | undefined) => import("../api.js").Effect<any>;
