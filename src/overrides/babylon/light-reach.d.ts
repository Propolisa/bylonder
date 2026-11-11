export type ReachingLight = { id: number | string, position: number[] | null, reach?: number, power?: number };
export type MeshSphere = { id: number | string, center: number[], radius: number };
export function lightBudget(engine: import('@babylonjs/core').AbstractEngine): number;
export function chooseLights(lights: ReachingLight[], meshes: MeshSphere[], budget: number, reaches?: (light: ReachingLight, mesh: MeshSphere) => boolean): { chosen: Map<number | string, Set<number | string>>, crowded: (number | string)[] };
export function lightsMeshes(light: import('@babylonjs/core').Light): boolean;
export function createLightReach(scene: import('@babylonjs/core').Scene, options?: { owns?: (light: import('@babylonjs/core').Light) => boolean, warn?: (message: string) => void }): { update(budget?: number): void };
export function reachLights(scene: import('@babylonjs/core').Scene, lights: import('@babylonjs/core').Light[]): void;
