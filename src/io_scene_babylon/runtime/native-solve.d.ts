/**
 * The solver: `solve(pose)` gives each bone's Babylon local matrix after the rig's constraints and drivers, and deforms
 * the description's meshes in `scene`; `solve.deformed(native, name)`, a mesh's positions as the last solve deforms them
 * (Blender's object space, each evaluated vertex's xyz); `solve.pass(entry)`, the page's pass over a skeleton.
 * @param {import('@babylonjs/core').Scene | null} [scene] @param {{ get(path: string): any, set(path: string, value: number): void } | null} [controls] the page's, which get
 * the custom properties the rig's drivers set
 * @returns {((pose: NativePose) => Map<number, Matrix>) & { pass(entry: any): void, detach(entry: any): void, deformed(native: NativePose['native'], name: string): Float64Array }}
 */
export function nativeSolve(scene?: import("@babylonjs/core").Scene | null, controls?: {
    get(path: string): any;
    set(path: string, value: number): void;
} | null): ((pose: NativePose) => Map<number, Matrix>) & {
    pass(entry: any): void;
    detach(entry: any): void;
    deformed(native: NativePose["native"], name: string): Float64Array;
};
export function load(page: any): {
    run: (inputs: any, context: any, entity: any) => {};
    detach: (entity: any) => void;
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
        published?: {
            property: string;
            path?: string;
            bone?: string | null;
            name?: string;
            mesh?: string;
            key?: string;
            range?: [number, number];
        }[];
    };
    properties?: Record<string, number>;
    frame?: number;
    nodeWorld?: (id: string) => Matrix | null;
};
import { Matrix } from '@babylonjs/core';
