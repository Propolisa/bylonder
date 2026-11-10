/**
 * Measures the share of the view each material covers, calling `measured` with them by material id (0 to 1).
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(shares: Map<string, number>) => void} measured
 */
export function createCoverage(scene: import("@babylonjs/core").Scene, measured: (shares: Map<string, number>) => void): {
    dispose(): void;
};
