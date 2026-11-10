/**
 * Measures the share of the view each material covers (0 to 1) and its average colour there as shown (a CSS colour),
 * calling `measured` with them by material id.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {(shares: Map<string, number>, colours: Map<string, string>) => void} measured
 */
export function createCoverage(scene: import("@babylonjs/core").Scene, measured: (shares: Map<string, number>, colours: Map<string, string>) => void): {
    dispose(): void;
};
