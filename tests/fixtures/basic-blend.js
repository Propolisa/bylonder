// The basic test rig (basic-rig.js) as a loaded scene stands in for one: a Babylon skeleton named "Armature" with its
// rest pose, and each action as a clip's animation group of the bones' matrices, with the IR's clip entries. It is
// exactly what a Character reads of a package's load(), so the character runs on it by its one path.
import { Animation, AnimationGroup, Bone, Matrix, NullEngine, Quaternion, Scene, Skeleton, Vector3 } from '@babylonjs/core';
import { STRIDE } from '../../src/io_scene_babylon/runtime/character/pose.js';
import { basicRig } from './basic-rig.js';

const matrixOf = (/** @type {Float32Array} */ pose, /** @type {number} */ o) => Matrix.Compose(new Vector3(pose[o + 7], pose[o + 8], pose[o + 9]),
  new Quaternion(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]), new Vector3(pose[o], pose[o + 1], pose[o + 2]));

/**
 * A stand-in for load()'s result, with the basic rig as "Armature". `torso`: the hips and the spine hang side by side
 * from a Torso bone under a root bone, as in a Rigify rig, so moving the hips alone stretches the waist.
 */
export function basicBlend({ torso = false } = {}) {
  const { skeleton: rig, clips } = basicRig();
  const scene = new Scene(new NullEngine());
  const skeleton = new Skeleton('Armature', 'Armature', scene);
  /** @type {Bone[]} */
  const bones = [];
  const top = torso && new Bone('Torso', skeleton, new Bone('root', skeleton, null, Matrix.Identity()), Matrix.Identity());
  const hips = rig.boneIndex('mixamorig:Hips'), spine = rig.boneIndex('mixamorig:Spine');
  // Under the Torso, the spine starts where it did on the hips at rest.
  const lift = (/** @type {Matrix} */ local) => local.setTranslation(local.getTranslation().addInPlace(matrixOf(rig.rest, hips * STRIDE).getTranslation()));
  rig.names.forEach((/** @type {string} */ name, /** @type {number} */ i) => {
    const local = matrixOf(rig.rest, i * STRIDE);
    if (top && i === spine) lift(local);
    const parent = top && (i === hips || i === spine) ? top : rig.parents[i] >= 0 ? bones[rig.parents[i]] : null;
    bones.push(new Bone(name, skeleton, parent, local, local.clone(), local.clone()));
  });
  /** @type {Record<string, object>} */
  const entries = {};
  for (const [name, clip] of clips) {
    const group = new AnimationGroup(name, scene);
    clip.bones.forEach((/** @type {number} */ index, /** @type {number} */ j) => {
      const animation = new Animation(`${name} ${rig.names[index]}`, '_matrix', clip.fps, Animation.ANIMATIONTYPE_MATRIX);
      const key = (/** @type {number} */ f) => matrixOf(clip.data, (f * clip.bones.length + j) * STRIDE);
      animation.setKeys(Array.from({ length: clip.frames }, (_, f) => ({ frame: f, value: top && index === spine ? lift(key(f)) : key(f) })));
      group.addTargetedAnimation(animation, bones[index]);
    });
    group.normalize(0, clip.frames - 1);
    group.metadata = { bylonder: { clip: true, action: name, frame_start: 0 } };
    entries[name] = { action: name, frame_start: 0, frame_end: clip.frames - 1, markers: [] };
  }
  return { scene, ir: { scene: { time: { clips: entries } } }, nodeOf: () => null, set() {}, get() { return 0; } };
}
