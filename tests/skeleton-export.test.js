// Deform Bones Only: a pruned skeleton keeps its bones' order, renumbered with their parents, and its meshes' bone
// indices follow, the index past the last bone (no bone) staying past it.
import assert from 'node:assert/strict';
import { VertexBuffer } from '@babylonjs/core';
import { prunedSkeleton, pruneSkeletons, remappedIndices } from '../src/io_scene_babylon/skeleton-export.js';

const bone = (index, parentBoneIndex) => ({ name: `B${index}`, index, parentBoneIndex });
const map = new Map([[0, 0], [2, 1], [3, 2]]);
const pruned = prunedSkeleton({ id: 'Rig', bones: [bone(0, -1), bone(1, 0), bone(2, 0), bone(3, 2)] }, map);
assert.deepEqual(pruned.bones.map((b) => [b.name, b.index, b.parentBoneIndex]), [['B0', 0, -1], ['B2', 1, 0], ['B3', 2, 1]]);
assert.deepEqual([...remappedIndices(VertexBuffer.MatricesIndicesKind, Float32Array.of(3, 2, 0, 4), map, 4)], [2, 1, 0, 3]);
const normals = Float32Array.of(1, 2);
assert.equal(remappedIndices(VertexBuffer.NormalKind, normals, map, 4), normals, 'other buffers untouched');
console.log('Skeleton export: pruned bones renumbered with their parents, bone indices remapped');

const scene = { skeletons: [{ id: 'Rig', bones: [0, 1, 2, 3].map((i) => ({ ...bone(i, i ? 0 : -1), id: `Rig B${i}` })) }],
  animationGroups: [{ targetedAnimations: [{ targetId: 'Rig B1' }, { targetId: 'Rig B2' }, { targetId: 'Cube' }] }] };
pruneSkeletons(scene, new Map([['Rig', map]]));
assert.deepEqual(scene.skeletons[0].bones.map((b) => b.id), ['Rig B0', 'Rig B2', 'Rig B3']);
assert.deepEqual(scene.animationGroups[0].targetedAnimations.map((t) => t.targetId), ['Rig B2', 'Cube'], "a dropped bone's keys go");
console.log('Skeleton export: a scene pruned, the keys of its dropped bones gone');
