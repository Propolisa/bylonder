/**
 * Turns an IK chain (Blender's matrices, root first) so that its tip's tail reaches `goal`: the chain as posed turned
 * as one about its root to point at the goal (and face the pole), then, for a chain of two, bent at its middle joint
 * in the plane it bends in and turned in that plane until its end is on the goal.
 * @param {Matrix[]} chain @param {number[]} lengths @param {Vector3} goal @param {Vector3 | null} pole @param {number} poleAngle
 */
export function reach(chain: Matrix[], lengths: number[], goal: Vector3, pole: Vector3 | null, poleAngle: number): Matrix[];
/**
 * An armature's pose after its bone constraints: the Babylon local matrix of each bone they move, by index. Bones are
 * placed parents first, a constraint's targets before it, an IK chain once its root and the bones down to its tip
 * are placed with their own constraints (Blender's order).
 * @param {Pose} pose
 * @returns {Map<number, Matrix>}
 */
export function solvePose({ bones, locals, mesh, space, stacks, nodeWorld }: Pose): Map<number, Matrix>;
/**
 * @param {{ scene: import('@babylonjs/core').Scene, controls: { get(path: string): any, frame(id?: string): number, write(path: string, value: any): void } }} page
 * @param {(pose: any) => Map<number, Matrix>} [solve] what poses a rig: this file's solvers, or Blender's kernels (pose-kernels.js)
 */
export function load(page: {
    scene: import("@babylonjs/core").Scene;
    controls: {
        get(path: string): any;
        frame(id?: string): number;
        write(path: string, value: any): void;
    };
}, solve?: (pose: any) => Map<number, Matrix>): {
    run: (inputs: any, context: any, entity: any) => {};
    /** Forgets an entity a patch replaced or removed, or whose skeleton, mesh or morph targets it made again (the scheduler attaches it again on its next run). @param {any} entity */
    detach: (entity: any) => void;
};
/**
 * A bone constraint as the export writes it, in Blender's terms. IK names its chain's bones, root first.
 */
export type Target = {
    bone: string;
} | {
    node: string;
};
/**
 * The pose to solve, in Babylon's matrices: each bone's parent (an index before it, or -1), rest matrix relative to its
 * parent (Bone.getRestMatrix), length and rotation mode; each bone's local matrix before its constraints (its
 * location, rotation and scale, then its rest: Bone's _matrix); the skinned mesh's world matrix, the armature's matrix relative to it, each bone's constraints, and
 * a node's world matrix by id.
 */
export type PoseConstraint = {
    type: string;
    influence: number;
    target?: Target;
    pole?: Target;
    pole_angle?: number;
    chain?: string[];
    head_tail?: number;
    track_axis?: string;
    up_axis?: string;
    use_target_z?: boolean;
    owner_space?: string;
    target_space?: string;
    euler_order?: string;
    limits?: ([number, number] | null)[];
};
/**
 * Where a constraint reads its target: a bone of the armature (at `head_tail` along it), or an object's node.
 */
export type Pose = {
    bones: {
        name: string;
        parent: number;
        rest: Matrix;
        length: number;
        mode: string;
    }[];
    locals: Matrix[];
    mesh: Matrix;
    space: Matrix;
    stacks: Record<string, PoseConstraint[]>;
    nodeWorld: (id: string) => Matrix | null;
};
import { Matrix } from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';
