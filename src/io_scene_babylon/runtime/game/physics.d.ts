/**
 * Havok's wasm instance from `load` (`(options) => HavokPhysics(options)`), made once per loader.
 * @param {(options?: any) => Promise<any>} load @param {any} [options]
 */
export function havokFrom(load: (options?: any) => Promise<any>, options?: any): Promise<any>;
/**
 * Havok on `scene`, which the run steps (`step(dt)`), not the scene's render. `onBody` hears each body made.
 * @param {import('@babylonjs/core').Scene} scene @param {any} havok @param {(body: { dispose(): void }) => void} onBody
 */
export function enablePhysics(scene: import("@babylonjs/core").Scene, havok: any, onBody: (body: {
    dispose(): void;
}) => void): {
    /** Advances by `dt` seconds of the run's clock, in whole fixed steps. @param {number} dt */
    step(dt: number): void;
    dispose(): void;
};
/** The fixed step, in seconds. */
export const PHYSICS_STEP: number;
