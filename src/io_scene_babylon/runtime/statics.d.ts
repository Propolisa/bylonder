/**
 * Freezes a scene's still meshes and batches those that draw alike.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(node: any) => boolean} moves whether something moves a node itself
 */
export function freezeStill(scene: import("@babylonjs/core").Scene, moves: (node: any) => boolean): {
    /** A node something moves, hides or changes from now on: it and what it parents thaw. @param {any} node */
    thaw(node: any): void;
    /** Every batch undone and every frozen mesh thawed. */
    dispose(): void;
};
