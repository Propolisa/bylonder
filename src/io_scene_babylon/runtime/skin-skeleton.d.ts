/**
 * Makes `skin` follow the rig skeleton `rig` (an id, looked up when drawn: a patch may make the rig again): before each
 * prepare, each bone's local matrix is the rig bone's, and the rig's world matrices are computed for what hangs on it.
 * @param {import('@babylonjs/core').Skeleton} skin @param {string} rig
 * @param {{ getSkeletonById(id: string): import('@babylonjs/core').Skeleton | null }} lookup
 */
export function mirrored(skin: import("@babylonjs/core").Skeleton, rig: string, lookup: {
    getSkeletonById(id: string): import("@babylonjs/core").Skeleton | null;
}): import("@babylonjs/core").Skeleton;
