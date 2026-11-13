// A rig's two skeletons in a package. The rig skeleton holds every bone of the armature: clips, the character, the
// solvers, drivers and objects hung on bones read and write it, and no mesh skins to it. The skin skeleton holds only
// the bones its GPU-skinned meshes weight and every bone above them, so its matrix texture fits every device; the page
// copies each of its bones' local matrices from the rig's before it draws (runtime/skin-skeleton.js).
import { VertexBuffer } from '@babylonjs/core';

/** The serialized skeleton with only its kept bones, renumbered. */
export function prunedSkeleton(entry, map) {
  return { ...entry, bones: entry.bones.filter((b) => map.has(b.index)).map((b) => ({ ...b, index: map.get(b.index), parentBoneIndex: b.parentBoneIndex < 0 ? -1 : map.get(b.parentBoneIndex) })) };
}

/**
 * A skinned mesh's bone indices renumbered for its skin skeleton (`count` its old bone count: the index past the
 * last bone is Babylon's identity, for weights left to no bone).
 * @param {string} kind @param {Float32Array} data @param {Map<number, number>} map @param {number} count
 */
export function remappedIndices(kind, data, map, count) {
  if (kind !== VertexBuffer.MatricesIndicesKind && kind !== VertexBuffer.MatricesIndicesExtraKind) return data;
  return Float32Array.from(data, (i) => (i >= count ? map.size : map.get(i) ?? map.size));
}

// The most bones a skin skeleton may hold: Babylon keeps its matrices in one row of 4 RGBA texels a bone (and one more),
// and 8192 texels is the widest texture every WebGL 2 device draws.
export const MAX_SKIN_BONES = 8192 / 4 - 1;

/**
 * Each rig skeleton that skins meshes gets its skin skeleton (`<rig id> skin`): the bones the meshes weight and every
 * bone above them, renumbered, with ids of their own and no keys; the meshes skin to it. Gives Map(rig id, { id, map })
 * (map: rig bone index to skin bone index), which the meshes' bone indices follow (remappedIndices). Fails an export
 * whose skin skeleton would still pass MAX_SKIN_BONES.
 * @param {import('@babylonjs/core').Scene} scene @param {any} data the serialized scene, before Deform Bones Only
 */
export function skinSkeletons(scene, data) {
  const out = new Map(), skins = [];
  for (const entry of data.skeletons ?? []) {
    const skinned = data.meshes.filter((m) => m.skeletonId === entry.id), skeleton = scene.getSkeletonById(entry.id);
    if (!skinned.length || !skeleton) continue;
    const kept = new Set(), bones = skeleton.bones;
    const keep = (bone) => { for (let at = bone; at && !kept.has(at); at = at.getParent()) kept.add(at); };
    for (const mesh of skinned.map((m) => scene.getMeshByUniqueId(m.uniqueId)).filter(Boolean)) {
      for (const [indexKind, weightKind] of [[VertexBuffer.MatricesIndicesKind, VertexBuffer.MatricesWeightsKind], [VertexBuffer.MatricesIndicesExtraKind, VertexBuffer.MatricesWeightsExtraKind]]) {
        const indices = mesh.getVerticesData(indexKind), weights = mesh.getVerticesData(weightKind);
        if (indices && weights) for (let i = 0; i < indices.length; i++) if (weights[i] > 0 && bones[indices[i]]) keep(bones[indices[i]]);
      }
    }
    const map = new Map(), id = `${entry.id} skin`;
    bones.forEach((bone, i) => { if (kept.has(bone)) map.set(i, map.size); });
    if (map.size > MAX_SKIN_BONES) {
      throw new Error(`Skeleton "${id}" has ${map.size} bones, more than the ${MAX_SKIN_BONES} a device with 8192-texel textures skins on its GPU (its meshes would not draw there): its meshes are weighted to too many bones`);
    }
    const skin = prunedSkeleton(entry, map);
    skins.push({ ...skin, id, name: id, rig: entry.id, animations: [],
      bones: skin.bones.map(({ animation, linkedTransformNodeId, ...bone }) => ({ ...bone, id: `${id} ${bone.name}` })) });
    for (const m of skinned) m.skeletonId = id;
    out.set(entry.id, { id, map });
  }
  data.skeletons.push(...skins);
  return out;
}
