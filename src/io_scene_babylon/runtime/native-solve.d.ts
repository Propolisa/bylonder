/**
 * The solver: `solve(pose)` gives each bone's Babylon local matrix after the rig's constraints and drivers.
 * @returns {(pose: NativePose) => Map<number, Matrix>}
 */
export function nativeSolve(): (pose: NativePose) => Map<number, Matrix>;
export function load(page: any): {
    run: (inputs: any, context: any, entity: any) => {};
};
export type NativePose = {
    bones: {
        name: string;
        parent: number;
        rest: Matrix;
    }[];
    locals: Matrix[];
    mesh: Matrix;
    space: Matrix;
    native: {
        description: Uint8Array;
        arrays: ArrayLike<number>[];
        armature: string;
        objects?: Record<string, string>;
    };
    properties?: Record<string, number>;
    frame?: number;
    nodeWorld?: (id: string) => Matrix | null;
};
import { Matrix } from '@babylonjs/core';
