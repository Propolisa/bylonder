/**
 * The 'default' input of a character, as a function giving its intent each frame.
 * @param {import('./api.js').Character} character
 * @returns {(() => import('./api.js').Intent) & { dispose(): void }}
 */
export function defaultInput(character: import("./api.js").Character): (() => import("./api.js").Intent) & {
    dispose(): void;
};
/** The ground's forward and right as the scene's camera sees them (world +Z and +X without one). */
export function groundAxes(scene: import("@babylonjs/core").Scene, forward: Vector3, right: Vector3): void;
import { Vector3 } from '@babylonjs/core';
