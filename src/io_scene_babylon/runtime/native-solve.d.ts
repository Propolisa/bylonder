/**
 * The solver: `solve(pose)` gives each bone's Babylon local matrix after the rig's constraints and drivers, and deforms
 * the description's meshes in `scene`; `solve.deformed(native, name)`, a mesh's positions as the last solve deforms them
 * (Blender's object space, each evaluated vertex's xyz); `solve.pass(entry)`, the page's pass over a skeleton.
 * @param {import('@babylonjs/core').Scene | null} [scene]
 * @returns {((pose: NativePose) => Map<number, Matrix>) & { pass(entry: any): void, deformed(native: NativePose['native'], name: string): Float64Array }}
 */
export function nativeSolve(scene?: import("@babylonjs/core").Scene | null): ((pose: NativePose) => Map<number, Matrix>) & {
    pass(entry: any): void;
    deformed(native: NativePose["native"], name: string): Float64Array;
};
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
        meshes?: Record<string, string>;
    };
    properties?: Record<string, number>;
    frame?: number;
    nodeWorld?: (id: string) => Matrix | null;
};
import { Matrix } from '@babylonjs/core';
