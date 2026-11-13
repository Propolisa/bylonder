// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Secondary motion (as VRM's spring bones and Unreal's AnimDynamics): each listed bone points at a mass that a spring
// pulls toward where the pose puts the bone's tip, with damping and gravity, so hair, tails and props lag, swing and
// settle. Integrated by Verlet at a fixed 120 Hz, root to tip, after the rig's solve.
import { Quaternion, Vector3 } from '@babylonjs/core';
import { defineEffect } from '../api.js';
import { restPose } from './aim.js';
import { between, turnWorld, worldOf } from './space.js';

const STEP = 1 / 120, TELEPORT = 1;
const head = new Vector3(), tip = new Vector3(), along = new Vector3(), to = new Vector3(), turn = new Quaternion(), rotation = new Quaternion();

/** The bones' chain: each one's index, its axis toward its first child at rest (else its Y) and its length, and a mass. */
function chainOf(/** @type {any} */ character, /** @type {string[]} */ names) {
  const { rig } = character, rest = restPose(rig);
  return names.map((name) => {
    const bone = rig.boneIndex(name);
    if (bone < 0) throw new Error(`springs: no bone "${name}" on ${character.armature}`);
    const child = rig.parents.indexOf(bone), axis = new Vector3(0, 1, 0);
    let size = 0.1;
    if (child >= 0) {
      worldOf(rest, bone, head, rotation);
      worldOf(rest, child, tip);
      size = Vector3.Distance(head, tip);
      tip.subtractInPlace(head).rotateByQuaternionToRef(Quaternion.Inverse(rotation), axis).normalize();
    }
    return { bone, axis, size, now: new Vector3(), before: new Vector3(), next: new Vector3() };
  }).sort((a, b) => a.bone - b.bone);
}

export const springs = defineEffect({
  name: 'springs',
  needs: [],
  on: 'deform',
  options: {
    /** The bones (by name) that swing. */
    bones: /** @type {string[]} */ ([]),
    /** How hard each is pulled back to its pose, per second squared. */
    stiffness: 120,
    /** How quickly swinging dies out, per second. */
    damping: 6,
    /** Gravity's pull on the masses, in metres per second squared. */
    gravity: 2,
    /** How many of the bones swing, from the root. */
    count: Infinity,
  },
  tiers: { B: { count: 2 }, C: { count: 1 } },
  init(character, roles, options) {
    return { chain: chainOf(character, options.bones), left: 0, fresh: true };
  },
  update(dt, { pose, options, character }, state) {
    const { stiffness, damping, gravity } = options, count = Math.min(state.chain.length, options.count);
    for (let k = 0; k < count; k++) {
      const link = state.chain[k];
      goal(pose, link, tip);
      if (state.fresh || Vector3.Distance(tip, link.now) > TELEPORT) { link.now.copyFrom(tip); link.before.copyFrom(tip); }
    }
    state.fresh = false;
    state.left = Math.min(state.left + dt, 0.1);
    for (; state.left >= STEP; state.left -= STEP) {
      for (let k = 0; k < count; k++) {
        const link = state.chain[k], { now, before, next } = link;
        goal(pose, link, tip);
        // Verlet: the velocity damped, the spring's pull toward the pose, gravity down.
        next.copyFrom(now).subtractInPlace(before).scaleInPlace(1 - damping * STEP).addInPlace(now);
        next.addInPlace(tip.subtractInPlace(now).scaleInPlace(stiffness * STEP * STEP));
        next.y -= gravity * STEP * STEP;
        before.copyFrom(now);
        now.copyFrom(next);
      }
    }
    // Each bone turned to point at its mass, root first, so a child starts from its turned parent.
    for (let k = 0; k < count; k++) {
      const link = state.chain[k];
      worldOf(pose, link.bone, head, rotation);
      link.axis.rotateByQuaternionToRef(rotation, along);
      link.now.subtractToRef(head, to).normalize();
      turnWorld(pose, link.bone, between(along, to, turn));
    }
  },
});

/** Where the pose puts a link's tip now, into `out`. */
function goal(/** @type {import('../api.js').Pose} */ pose, /** @type {{ bone: number, axis: Vector3, size: number }} */ link, /** @type {Vector3} */ out) {
  worldOf(pose, link.bone, out, rotation);
  return out.addInPlace(link.axis.rotateByQuaternionToRef(rotation, along).scaleInPlace(link.size * scaleOf(pose, link.bone)));
}

/** A bone's world scale (the character's), so tips are placed in metres. */
function scaleOf(/** @type {import('../api.js').Pose} */ pose, /** @type {number} */ bone) {
  const m = pose.world(bone).m;
  return Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
}
