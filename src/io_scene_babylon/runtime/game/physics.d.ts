/**
 * A Havok body for an object's rigid body as Blender sets it (Physics properties > Rigid Body, the IR's `rigid_body`):
 * Active is dynamic with its mass, Passive static, and Animated (`kinematic`) follows its node as code or an action
 * moves it. @param {import('@babylonjs/core').TransformNode} node @param {Record<string, any>} rigid
 */
export function rigidBody(node: import("@babylonjs/core").TransformNode, rigid: Record<string, any>): import("@babylonjs/core").PhysicsBody;
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
    /** Havok gone with every body on it, so a node disposed after it (the scene's own) asks nothing of it. */
    dispose(): void;
};
/** The fixed step, in seconds. */
export const PHYSICS_STEP: number;
