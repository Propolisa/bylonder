/**
 * A solver on loaded kernels (polyfill/constraints.js loadConstraints): each bone's Babylon local matrix after the
 * rig's constraints, by the skeleton's index.
 * @param {any} kernels
 * @returns {(pose: KernelPose) => Map<number, Matrix>}
 */
export function kernelSolve(kernels: any): (pose: KernelPose) => Map<number, Matrix>;
/**
 * The page's implementation: pose-constraints.js on the package's kernels, loaded from `bylonder-constraints/`.
 * @param {import('./scheduler.js').Page} page
 */
export function load(page: import("./scheduler.js").Page): Promise<{
    run: (inputs: any, context: any, entity: any) => {};
}>;
export type KernelPose = {
    bones: {
        name: string;
        parent: number;
        rest: Matrix;
    }[];
    locals: Matrix[];
    mesh: Matrix;
    space: Matrix;
    kernels: any;
    influences?: Record<string, number[]>;
    nodeWorld: (id: string) => Matrix | null;
    frame?: number;
};
import { Matrix } from '@babylonjs/core';
