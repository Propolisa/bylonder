/**
 * Makes `skin` follow the rig skeleton `rig` (an id, looked up when drawn: a patch may make the rig again): before each
 * prepare, each bone's local matrix is the rig bone's, and the rig's world matrices are computed for what hangs on it.
 * @param {import('@babylonjs/core').Skeleton} skin @param {string} rig
 * @param {{ getSkeletonById(id: string): import('@babylonjs/core').Skeleton | null }} lookup
 */
export function mirrored(skin: import("@babylonjs/core").Skeleton, rig: string, lookup: {
    getSkeletonById(id: string): import("@babylonjs/core").Skeleton | null;
}): import("@babylonjs/core").Skeleton;
/**
 * Hangs `node` from a bone (an object parented to a bone), which follows the rig skeleton's bone, the one clips, the
 * character and the solve write. A rig skeleton skins no mesh (its skin does), so Babylon's prepare leaves its bones'
 * final matrices alone: they are computed here from `referal`'s pose matrix, the mesh the node is placed relative to.
 * @param {import('@babylonjs/core').TransformNode} node @param {import('@babylonjs/core').Bone} bone @param {import('@babylonjs/core').AbstractMesh} referal
 */
export function hangFromBone(node: import("@babylonjs/core").TransformNode, bone: import("@babylonjs/core").Bone, referal: import("@babylonjs/core").AbstractMesh): import("@babylonjs/core").TransformNode;
