/**
 * Track To: the owner keeps its place and scale, its track axis pointing at the target and its up axis as near the
 * world's (or the target's) Z as that allows.
 * @param {Matrix} owner @param {Matrix} target @param {Constraint} c
 */
export function trackTo(owner: Matrix, target: Matrix, c: Constraint): Matrix;
/**
 * The world matrix (Blender's axes) of an owner after its constraints, from its own world matrix and its targets'.
 * @param {Matrix} owner @param {Constraint[]} constraints @param {(id: string) => Matrix} targetOf
 */
export function constrained(owner: Matrix, constraints: Constraint[], targetOf: (id: string) => Matrix): Matrix;
/** @param {{ scene: import('@babylonjs/core').Scene }} page */
export function load({ scene }: {
    scene: import("@babylonjs/core").Scene;
}): {
    run: (inputs: any, context: any, entity: object) => {};
};
export function swapped(m: Matrix): Matrix;
/**
 * A constraint as the export writes it: its type and target node, and for each type its settings in Blender's terms.
 */
export type Constraint = {
    type: "TRACK_TO" | "COPY_LOCATION" | "COPY_ROTATION" | "CHILD_OF";
    target: string;
    track_axis?: string;
    up_axis?: string;
    use_target_z?: boolean;
    use?: boolean[];
    invert?: boolean[];
    use_offset?: boolean;
    inverse_matrix?: number[];
};
import { Matrix } from '@babylonjs/core';
