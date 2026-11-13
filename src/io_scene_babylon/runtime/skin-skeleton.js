// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A skin skeleton (skeleton-export.js skinSkeletons): the bones a rig's GPU-skinned meshes weight, whose local matrices
// are copied from the rig skeleton's bones of the same names each time Babylon prepares it to draw, so every reader and
// writer of bones (clips, the character, the solvers, drivers) uses the rig, and the skin follows whatever they set.

/**
 * Makes `skin` follow the rig skeleton `rig` (an id, looked up when drawn: a patch may make the rig again): before each
 * prepare, each bone's local matrix is the rig bone's, and the rig's world matrices are computed for what hangs on it.
 * @param {import('@babylonjs/core').Skeleton} skin @param {string} rig
 * @param {{ getSkeletonById(id: string): import('@babylonjs/core').Skeleton | null }} lookup
 */
export function mirrored(skin, rig, lookup) {
  /** @type {import('@babylonjs/core').Skeleton | null} */
  let source = null;
  /** @type {[import('@babylonjs/core').Bone, import('@babylonjs/core').Bone][]} */
  let pairs = [];
  const prepare = skin.prepare.bind(skin);
  Object.assign(skin, {
    rigId: rig,
    /** @param {boolean} [dontCheckFrameId] */
    prepare: (dontCheckFrameId) => {
      const now = lookup.getSkeletonById(rig);
      if (now && now !== source) {
        source = now;
        const byName = new Map(now.bones.map((bone) => [bone.name, bone]));
        pairs = skin.bones.flatMap((bone) => { const from = byName.get(bone.name); return from ? [[bone, from]] : []; });
      }
      for (const [bone, from] of pairs) {
        const local = /** @type {any} */ (from)._matrix, own = /** @type {any} */ (bone)._matrix;
        if (own.equals(local)) continue;
        own.copyFrom(local);
        bone.markAsDirty();
      }
      source?.computeAbsoluteMatrices();
      return prepare(dontCheckFrameId);
    },
  });
  return skin;
}
