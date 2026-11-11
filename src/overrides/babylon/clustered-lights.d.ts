export function sceneLights(scene: import('@babylonjs/core').Scene): import('@babylonjs/core').Light[];
export function nodeById(scene: import('@babylonjs/core').Scene, id: string): import('@babylonjs/core').Node | null;
export function clusterLights(scene: import('@babylonjs/core').Scene, lights: readonly import('@babylonjs/core').Light[], budget: number, exact?: (light: import('@babylonjs/core').Light) => boolean): { container: import('@babylonjs/core').ClusteredLightContainer, cutPerTile: import('@babylonjs/core').Light[] } | null;
