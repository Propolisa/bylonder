/**
 * Makes the scene's active camera follow `character`, after its frame.
 * @param {import('./api.js').Character} character
 * @param {{ pitch?: number, distance?: number, height?: number, ease?: number }} [options] `pitch` above the ground,
 *   `distance` from the point it looks at, `height` of that point above the character, `ease` how fast it catches up
 */
export function followCamera(character: import("./api.js").Character, { pitch, distance, height, ease }?: {
    pitch?: number;
    distance?: number;
    height?: number;
    ease?: number;
}): {
    yaw: number;
    pitch: number;
    distance: number;
};
