// File > Export's Deform Bones Only: a rig's skeleton keeps only the bones that skin (armature.js skinningBones: the
// deforming bones, their B-Bones' segment joints, and every bone above them), the bones whose transforms drivers read
// or its objects hang from, and is renumbered; its meshes' bone indices follow, and the dropped bones' keys and pose
// controls go. A production rig's mechanism and control bones
// (Snow has 2799 bones and joints, 400-odd skin) then cost the page nothing. A rig whose constraints run in the page
// (a constraints:POSE entity) keeps every bone, which they read and pose.
import { VertexBuffer } from '@babylonjs/core';
import { skinningBones } from '../runtimes/armature.js';
import { sceneOf } from './controls-export.js';
import { bonesDriversRead } from './driver-export.js';

/**
 * Each prunable skeleton's kept bones: Map(skeleton id, Map(old index, new index)). `live`: the armature node ids whose
 * constraints run in the page.
 * @param {any} world @param {any} data the serialized scene @param {Set<string>} live
 */
export function deformSkeletons(world, data, live) {
  const sync = world.mainSync, arms = sync ? [...sceneOf(sync).objects].filter((ob) => ob.type === 'ARMATURE') : [];
  const parented = new Map();
  for (const entry of [...data.transformNodes, ...data.meshes]) if (entry.parentBone) parented.set(entry.parentBone.skeletonId, [...(parented.get(entry.parentBone.skeletonId) ?? []), entry.parentBone.index]);
  const out = new Map();
  for (const entry of data.skeletons ?? []) {
    const skeleton = world.scene.getSkeletonById(entry.id), arm = arms.find((ob) => entry.name === ob.name || entry.name.startsWith(`${ob.name} `));
    if (!skeleton || !arm || [...live].some((id) => id === arm.name || world.scene.getNodeById(id)?.name === arm.name)) continue;
    const kept = skinningBones(arm, skeleton), read = bonesDriversRead(arm), hung = new Set(parented.get(entry.id) ?? []);
    skeleton.bones.forEach((bone, i) => {
      if (!read.has(bone.name) && !hung.has(i)) return;
      for (let at = bone; at && !kept.has(at); at = at.getParent()) kept.add(at);
    });
    if (kept.size === skeleton.bones.length) continue;
    const map = new Map();
    skeleton.bones.forEach((bone, i) => { if (kept.has(bone)) map.set(i, map.size); });
    out.set(entry.id, map);
  }
  return out;
}

/** The serialized scene's skeletons pruned (`pruned`, deformSkeletons), and its animations' keys of dropped bones gone. */
export function pruneSkeletons(data, pruned) {
  if (!pruned.size) return;
  const dropped = new Set(data.skeletons.flatMap((entry) => (pruned.has(entry.id) ? entry.bones.filter((b) => !pruned.get(entry.id).has(b.index)).map((b) => b.id) : [])));
  data.skeletons = data.skeletons.map((entry) => (pruned.has(entry.id) ? prunedSkeleton(entry, pruned.get(entry.id)) : entry));
  for (const group of data.animationGroups) group.targetedAnimations = group.targetedAnimations.filter((t) => !dropped.has(t.targetId));
}

/** The serialized skeleton with only its kept bones, renumbered. */
export function prunedSkeleton(entry, map) {
  return { ...entry, bones: entry.bones.filter((b) => map.has(b.index)).map((b) => ({ ...b, index: map.get(b.index), parentBoneIndex: b.parentBoneIndex < 0 ? -1 : map.get(b.parentBoneIndex) })) };
}

/**
 * A skinned mesh's bone indices renumbered for its pruned skeleton (`count` its old bone count: the index past the
 * last bone is Babylon's identity, for weights left to no bone).
 * @param {string} kind @param {Float32Array} data @param {Map<number, number>} map @param {number} count
 */
export function remappedIndices(kind, data, map, count) {
  if (kind !== VertexBuffer.MatricesIndicesKind && kind !== VertexBuffer.MatricesIndicesExtraKind) return data;
  return Float32Array.from(data, (i) => (i >= count ? map.size : map.get(i) ?? map.size));
}
