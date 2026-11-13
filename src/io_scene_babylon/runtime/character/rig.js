// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The rig a character controller drives, behind a narrow interface any evaluation can offer: set every bone's own
// pose at once (pose.js layout), set a constraint's influence or move its target, and read the solved pose. This file's
// rig is a package's Babylon skeleton, whose bone constraints the page then solves (pose-constraints.js or Blender's
// kernels) from the pose set here; another evaluation offers the same members. A rig its runtime solves in the page
// (the native rig runtime) tells `onSolved` each frame once it has, before it deforms: what is set then is the result.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { STRIDE } from './pose.js';
import { createClip } from './clip.js';
import { isClip } from '../clips.js';

/**
 * @typedef {{
 *   names: string[], parents: Int32Array, rest: Float32Array,
 *   boneIndex(name: string): number,
 *   setLocalPose(pose: Float32Array, offset?: number, only?: Uint8Array): void,
 *   readLocalPose(out: Float32Array): Float32Array,
 *   readWorld(out: Float32Array): Float32Array,
 *   onSolved: import('@babylonjs/core').Observable<any> | null,
 *   solveAt: ((pose: Float32Array, bones: ArrayLike<number>) => ((name: string) => import('@babylonjs/core').Matrix | null)) | null,
 *   rootWorld(out: { position: number[], rotation: number[], scale: number }): void,
 *   setInfluence(bone: string, constraint: string, value: number): void,
 *   setTarget(object: string, position: { x: number, y: number, z: number }): void,
 *   root: import('@babylonjs/core').TransformNode | null,
 *   attach(node: import('@babylonjs/core').TransformNode, bone: number): void,
 * }} Rig
 */

const scale = new Vector3(), turn = new Quaternion(), at = new Vector3(), at_ = new Vector3(), composed = new Matrix();

/** Writes a matrix's location, rotation and scale into `out` at `o`. @param {Matrix} m @param {Float32Array} out @param {number} o */
function decomposeInto(m, out, o) {
  m.decompose(scale, turn, at);
  out[o] = at.x; out[o + 1] = at.y; out[o + 2] = at.z;
  out[o + 3] = turn.x; out[o + 4] = turn.y; out[o + 5] = turn.z; out[o + 6] = turn.w;
  out[o + 7] = scale.x; out[o + 8] = scale.y; out[o + 9] = scale.z;
}

/**
 * The armature object's skeleton in a loaded package: the one its constraints pose (the IR's pose entity names it),
 * else the one named for it: its id is the object's name, or '<name> <mesh>' where the armature skins meshes in
 * different spaces (one skeleton each).
 * @param {any} blend @param {string} armature
 */
export function skeletonOf(blend, armature) {
  const posed = blend.ir?.entities?.[`OB:${armature}/constraints/pose`]?.inputs?.skeleton;
  // A skin skeleton (`rigId`, skin-skeleton.js) only follows its rig: the rig is the one read and written.
  const rigs = blend.scene.skeletons.filter((/** @type {any} */ s) => !s.rigId);
  const skeleton = rigs.find((/** @type {any} */ s) => s.id === posed) ?? rigs.find((/** @type {any} */ s) => s.id === armature || s.id.startsWith(`${armature} `));
  if (!skeleton) throw new Error(`No skeleton for armature "${armature}": the scene's are ${blend.scene.skeletons.map((/** @type {any} */ s) => `"${s.id}"`).join(', ') || 'none'}`);
  return skeleton;
}

/**
 * A mesh a rig skeleton skins, directly or through its skin skeleton (skin-skeleton.js), or null.
 * @param {import('@babylonjs/core').Scene} scene @param {import('@babylonjs/core').Skeleton} skeleton
 */
export const skinnedBy = (scene, skeleton) => scene.meshes.find((/** @type {any} */ m) => m.skeleton === skeleton || m.skeleton?.rigId === skeleton.id) ?? null;

/**
 * A package's armature as a rig: its bones (B-Bone segment joints, `bone#k`, excluded: the constraints place them).
 * @param {any} blend the controller (`load()`'s BlendScene) @param {string} armature the armature object's name
 * @returns {Rig}
 */
export function babylonRig(blend, armature) {
  const skeleton = skeletonOf(blend, armature);
  /** @type {import('@babylonjs/core').Bone[]} */
  const bones = skeleton.bones.filter((/** @type {any} */ b) => !b.name.includes('#'));
  const names = bones.map((b) => b.name), index = new Map(names.map((n, i) => [n, i]));
  const parents = Int32Array.from(bones.map((b) => { const p = b.getParent(); return p ? names.indexOf(p.name) : -1; }));
  const rest = new Float32Array(bones.length * STRIDE);
  bones.forEach((b, i) => decomposeInto(b.getRestMatrix(), rest, i * STRIDE));
  const mesh = skinnedBy(blend.scene, skeleton);
  const world = bones.map(() => new Matrix()), written = new Float32Array(bones.length * STRIDE).fill(NaN);
  const path = (/** @type {string} */ bone, /** @type {string} */ constraint) => `objects[${JSON.stringify(armature)}].pose.bones[${JSON.stringify(bone)}].constraints[${JSON.stringify(constraint)}].influence`;

  return {
    names, parents, rest,
    // The armature object's node, which its meshes hang under: moving it moves the character.
    root: blend.nodeOf?.(`OB:${armature}`) ?? mesh,
    boneIndex: (name) => index.get(name) ?? -1,
    get onSolved() { return /** @type {any} */ (skeleton).bylonderRig?.onSolved ?? null; },
    // The rig solved offline for a pose's `bones` (its runtime's solveAt, once it has run a frame): each bone's world matrix.
    get solveAt() {
      const at = /** @type {any} */ (skeleton).bylonderRig?.solveAt;
      if (!at) return null;
      return (/** @type {Float32Array} */ pose, /** @type {ArrayLike<number>} */ only) => at(new Map(Array.from(only, (i) => {
        const o = i * STRIDE;
        at_.set(pose[o], pose[o + 1], pose[o + 2]);
        turn.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
        scale.set(pose[o + 7], pose[o + 8], pose[o + 9]);
        return [names[i], Matrix.Compose(scale, turn, at_)];
      })));
    },
    setLocalPose(pose, offset = 0, only) {
      // A production rig has thousands of bones the clips hold still: only those whose values changed are composed.
      // With `only`, just those bones, over the solved pose, which the next pose set does not compare against.
      for (let i = 0; i < bones.length; i++) {
        const o = offset + i * STRIDE, w = i * STRIDE;
        if (only) {
          if (!only[i]) continue;
        } else {
          let same = true;
          for (let k = 0; k < STRIDE && same; k++) same = written[w + k] === pose[o + k];
          if (same) continue;
          for (let k = 0; k < STRIDE; k++) written[w + k] = pose[o + k];
        }
        at.set(pose[o], pose[o + 1], pose[o + 2]);
        turn.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
        scale.set(pose[o + 7], pose[o + 8], pose[o + 9]);
        Matrix.ComposeToRef(scale, turn, at, composed);
        /** @type {any} */ (bones[i])._matrix.copyFrom(composed);
        bones[i].markAsDirty();
      }
    },
    readLocalPose(out) {
      bones.forEach((b, i) => decomposeInto(/** @type {any} */ (b)._matrix, out, i * STRIDE));
      return out;
    },
    // The node follows the bone as drawn, the rig's solve included.
    attach(node, bone) {
      if (mesh) node.attachToBone(bones[bone], mesh);
      else node.parent = blend.scene.getTransformNodeByName?.(skeleton.id) ?? null;
    },
    readWorld(out) {
      const meshWorld = mesh?.computeWorldMatrix(true) ?? Matrix.IdentityReadOnly;
      for (let i = 0; i < bones.length; i++) {
        const p = parents[i];
        /** @type {any} */ (bones[i])._matrix.multiplyToRef(p >= 0 ? world[p] : meshWorld, world[i]);
        world[i].copyToArray(out, i * 16);
      }
      return out;
    },
    rootWorld(out) {
      (mesh?.computeWorldMatrix(true) ?? Matrix.IdentityReadOnly).decompose(scale, turn, at);
      out.position[0] = at.x; out.position[1] = at.y; out.position[2] = at.z;
      out.rotation[0] = turn.x; out.rotation[1] = turn.y; out.rotation[2] = turn.z; out.rotation[3] = turn.w;
      out.scale = scale.x;
    },
    setInfluence: (bone, constraint, value) => blend.set(path(bone, constraint), value),
    setTarget(object, position) {
      const node = blend.nodeOf(object);
      if (!node) throw new Error(`No object "${object}" to move`);
      node.setAbsolutePosition(new Vector3(position.x, position.y, position.z));
    },
  };
}

/**
 * The clips of a package that animate a rig's bones, by action name, from its animation groups (Babylon's matrices of
 * each bone at each key, on the clip's frames from its start) and the IR's markers.
 * @param {any} blend @param {string} armature @param {Rig} rig
 * @returns {Map<string, import('./clip.js').Clip>}
 */
export function rigClips(blend, armature, rig) {
  const skeleton = skeletonOf(blend, armature);
  /** @type {Map<string, import('./clip.js').Clip>} */
  const clips = new Map();
  for (const group of blend.scene.animationGroups) {
    if (!isClip(group)) continue;
    const animated = group.targetedAnimations.filter((/** @type {any} */ t) => t.animation.targetProperty === '_matrix' && t.target.getSkeleton?.() === skeleton && rig.boneIndex(t.target.name) >= 0);
    if (!animated.length) continue;
    const { action } = group.metadata.bylonder, info = blend.ir.scene.time.clips[action] ?? {}, fps = animated[0].animation.framePerSecond;
    const frames = Math.round(group.to - group.from) + 1, boneIds = animated.map((/** @type {any} */ t) => rig.boneIndex(t.target.name));
    const data = new Float32Array(frames * boneIds.length * STRIDE), key = new Matrix(), next = new Matrix();
    animated.forEach((/** @type {any} */ t, /** @type {number} */ j) => {
      const keys = t.animation.getKeys();
      let k = 0;
      for (let f = 0; f < frames; f++) {
        const frame = group.from + f;
        while (k < keys.length - 1 && keys[k + 1].frame <= frame) k++;
        const a = keys[k], b = keys[Math.min(k + 1, keys.length - 1)], span = b.frame - a.frame, w = span > 0 ? Math.min(1, Math.max(0, (frame - a.frame) / span)) : 0;
        key.copyFrom(a.value);
        if (w > 0) { next.copyFrom(b.value); Matrix.DecomposeLerpToRef(key, next, w, key); }
        decomposeInto(key, data, (f * boneIds.length + j) * STRIDE);
      }
    });
    const start = info.frame_start ?? group.metadata.bylonder.frame_start ?? 0;
    const clip = createClip(action, fps, boneIds, data, (info.markers ?? []).map((/** @type {any} */ m) => ({ name: m.name, frame: m.frame - start })));
    clips.set(action, Object.assign(clip, { properties: group.metadata.bylonder.properties ?? null }));
  }
  return clips;
}
