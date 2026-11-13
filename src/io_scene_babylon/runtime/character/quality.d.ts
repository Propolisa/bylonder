/**
 * A picker fed each frame's time; it returns the tier to use. `budget`: the frame time to keep under (ms).
 * @param {{ budget?: number, down?: number, up?: number }} [options]
 */
export function createTierPicker({ budget, down, up }?: {
    budget?: number;
    down?: number;
    up?: number;
}): (tier: import("./api.js").Tier, ms: number) => import("./api.js").Tier;
/**
 * When a character updates and how much: `step(dt)` gives the seconds to run this frame, or -1 to skip it (tier C, a
 * small character, every other frame; the skipped time runs with the next), and `onScreen()` whether any of its meshes
 * is in the camera's view (true before the first frame is drawn, or without a camera).
 * @param {any} character
 */
export function createSchedule(character: any): {
    onScreen: () => boolean;
    /** @param {number} dt */
    step(dt: number): number;
};
