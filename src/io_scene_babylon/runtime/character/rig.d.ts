/**
 * The armature object's skeleton in a loaded package: the one its constraints pose (the IR's pose entity names it),
 * else the one named for it: its id is the object's name, or '<name> <mesh>' where the armature skins meshes in
 * different spaces (one skeleton each).
 * @param {any} blend @param {string} armature
 */
export function skeletonOf(blend: any, armature: string): any;
/**
 * A package's armature as a rig: its bones (B-Bone segment joints, `bone#k`, excluded: the constraints place them).
 * @param {any} blend the controller (`load()`'s BlendScene) @param {string} armature the armature object's name
 * @returns {Rig}
 */
export function babylonRig(blend: any, armature: string): Rig;
/**
 * The clips of a package that animate a rig's bones, by action name, from its animation groups (Babylon's matrices of
 * each bone at each key, on the clip's frames from its start) and the IR's markers.
 * @param {any} blend @param {string} armature @param {Rig} rig
 * @returns {Map<string, import('./clip.js').Clip>}
 */
export function rigClips(blend: any, armature: string, rig: Rig): Map<string, import("./clip.js").Clip>;
export function skinnedBy(scene: import("@babylonjs/core").Scene, skeleton: import("@babylonjs/core").Skeleton): import("@babylonjs/core").AbstractMesh | null;
export type Rig = {
    names: string[];
    parents: Int32Array;
    rest: Float32Array;
    boneIndex(name: string): number;
    setLocalPose(pose: Float32Array, offset?: number, only?: Uint8Array): void;
    readLocalPose(out: Float32Array): Float32Array;
    readWorld(out: Float32Array): Float32Array;
    onSolved: import("@babylonjs/core").Observable<any> | null;
    solveAt: ((pose: Float32Array, bones: ArrayLike<number>) => ((name: string) => import("@babylonjs/core").Matrix | null)) | null;
    rootWorld(out: {
        position: number[];
        rotation: number[];
        scale: number;
    }): void;
    setInfluence(bone: string, constraint: string, value: number): void;
    setTarget(object: string, position: {
        x: number;
        y: number;
        z: number;
    }): void;
    root: import("@babylonjs/core").TransformNode | null;
    attach(node: import("@babylonjs/core").TransformNode, bone: number): void;
};
