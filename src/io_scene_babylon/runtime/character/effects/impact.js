// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Hit reactions: `hit({ bone, at, impulse })` kicks the hit bone and its parents up to the hips, each joint absorbing a
// share of what reaches it, as damped springs that return each offset to what is played. An offset is a swing across
// the bone and a twist about it, each limited softly (the rig's IK limits, else by role), so repeated hits saturate and
// never wrap. What reaches the hips of a large hit shoves the character through its movement, so it steps.
import { Quaternion, Vector3 } from '@babylonjs/core';
import { defineEffect } from '../api.js';
import { poseBones } from './limbs.js';
import { restPose } from './aim.js';
import { worldOf } from './space.js';

const DEG = Math.PI / 180, STEP = 1 / 120, HITS = 8;
/** Swing limits by role, in radians; twist is 10 degrees for all. */
const SWING = { hips: 20 * DEG, spine: 20 * DEG, chest: 20 * DEG, neck: 25 * DEG, head: 25 * DEG };
const SHOULDER = 35 * DEG, OTHER = 30 * DEG, TWIST = 10 * DEG;
/** A body's mass and a joint's, in kg: how far an impulse turns a joint and shoves the character. */
const BODY = 70, JOINT = 8;

const axis = new Vector3(), arm = new Vector3(), kick = new Vector3(), here = new Vector3(), point = new Vector3(), spin = new Quaternion(), swing = new Quaternion(), twist = new Quaternion();

/** Each bone's soft limits (swing, twist), from the rig's IK limits, else by role. */
function limitsOf(/** @type {any} */ character) {
  const { names } = character.rig, bones = poseBones(character), limits = new Float32Array(names.length * 2);
  const role = new Map();
  for (const [name, value] of Object.entries(character.roles)) {
    if (name in SWING) role.set(value, SWING[/** @type {keyof typeof SWING} */ (name)]);
    if (/^arm\.[LR]$/.test(name) && Array.isArray(value)) role.set(value[0], SHOULDER);
  }
  names.forEach((/** @type {string} */ name, /** @type {number} */ i) => {
    const b = bones.get(name), range = (/** @type {string} */ k) => (b?.[`use_ik_limit_${k}`] ? Math.max(Math.abs(b[`ik_min_${k}`]), Math.abs(b[`ik_max_${k}`])) : null);
    limits[i * 2] = Math.min(range('x') ?? Infinity, range('z') ?? Infinity, role.get(name) ?? OTHER);
    limits[i * 2 + 1] = range('y') ?? TWIST;
  });
  return limits;
}

/** Each bone's own axis (toward its first child at rest, else its Y), the axis it twists about. */
function axesOf(/** @type {any} */ rig) {
  const rest = restPose(rig), axes = new Float32Array(rig.names.length * 3), head = new Vector3(), tip = new Vector3(), turn = new Quaternion();
  for (let i = 0; i < rig.names.length; i++) {
    const child = rig.parents.indexOf(i);
    if (child < 0) { axes[i * 3 + 1] = 1; continue; }
    worldOf(rest, i, head, turn);
    worldOf(rest, child, tip);
    tip.subtractInPlace(head).rotateByQuaternionToRef(Quaternion.Inverse(turn), tip).normalize();
    axes.set([tip.x, tip.y, tip.z], i * 3);
  }
  return axes;
}

/** The soft limit: `angle` eased to at most `limit`, never past it. */
const soft = (/** @type {number} */ angle, /** @type {number} */ limit) => limit * Math.tanh(angle / limit);

export const impact = defineEffect({
  name: 'impact',
  needs: ['hips'],
  on: 'controls',
  options: {
    /** The share of an impulse each joint takes up, the rest passing to its parent. */
    absorb: 0.4,
    /** How stiffly offsets spring back, per second squared. */
    stiffness: 120,
    /** The impulse, in newton seconds, from which a hit shoves the character into a step. */
    step: 6,
    /** How many joints up from the hit bone react. */
    joints: Infinity,
  },
  tiers: { B: { joints: 2 }, C: { joints: 1 } },
  init(character, roles) {
    const count = character.rig.names.length, hips = roles.hips;
    const state = {
      // Per bone: swing (x, z across its axis) and twist, as a rotation vector, then its angular velocity.
      springs: new Float32Array(count * 6), active: new Uint8Array(count), limits: limitsOf(character), axes: axesOf(character.rig),
      pending: new Float32Array(HITS * 7), hits: 0, left: 0, hips,
      /**
       * Hits the character: `bone` (a role or a bone's name) takes `impulse` (N s, world space) at `at` (world, else the
       * bone's place).
       * @param {{ bone: string, at?: Vector3, impulse: Vector3 }} hit
       */
      hit({ bone, at, impulse }) {
        const role = character.roles[bone], index = character.rig.boneIndex(typeof role === 'string' ? role : bone);
        if (index < 0) throw new Error(`impact: no bone or role "${bone}" on ${character.armature}`);
        if (state.hits === HITS) return;
        const o = state.hits++ * 7;
        state.pending[o] = index;
        state.pending[o + 1] = at ? at.x : NaN; state.pending[o + 2] = at ? at.y : NaN; state.pending[o + 3] = at ? at.z : NaN;
        state.pending[o + 4] = impulse.x; state.pending[o + 5] = impulse.y; state.pending[o + 6] = impulse.z;
      },
    };
    return state;
  },
  update(dt, { pose, options, character }, state) {
    const { springs, active, limits, axes, pending } = state, { parents } = character.rig;
    // New hits: angular kicks up the chain, each joint taking its share of what reaches it.
    for (let h = 0; h < state.hits; h++) {
      const o = h * 7, bone = pending[o], impulse = kick.set(pending[o + 4], pending[o + 5], pending[o + 6]);
      if (Number.isNaN(pending[o + 1])) worldOf(pose, bone, point);
      else point.set(pending[o + 1], pending[o + 2], pending[o + 3]);
      let left = 1;
      for (let j = bone, n = 0; j >= 0 && n < options.joints; j = parents[j], n++) {
        const share = j === state.hips ? left : left * options.absorb;
        worldOf(pose, j, here, spin);
        point.subtractToRef(here, arm);
        const reach = Math.max(arm.lengthSquared(), 0.01);
        // ω = r × J / (m r²), turned into the joint's own space.
        Vector3.CrossToRef(arm, impulse, arm).scaleInPlace(share / (JOINT * reach)).rotateByQuaternionToRef(Quaternion.InverseToRef(spin, spin), arm);
        springs[j * 6 + 3] += arm.x; springs[j * 6 + 4] += arm.y; springs[j * 6 + 5] += arm.z;
        active[j] = 1;
        left -= share;
        if (j === state.hips) break;
      }
      if (impulse.length() > options.step) character.movement?.push(arm.set(impulse.x / BODY, 0, impulse.z / BODY));
    }
    state.hits = 0;
    // Springs back to the played pose, at a fixed step; damped just under critical, so a hit rocks once.
    const k = options.stiffness, c = 2 * 0.7 * Math.sqrt(k);
    state.left = Math.min(state.left + dt, 0.1);
    for (; state.left >= STEP; state.left -= STEP) {
      for (let i = 0; i < active.length; i++) {
        if (!active[i]) continue;
        const o = i * 6;
        for (let a = 0; a < 3; a++) {
          springs[o + 3 + a] += (-k * springs[o + a] - c * springs[o + 3 + a]) * STEP;
          springs[o + a] += springs[o + 3 + a] * STEP;
        }
      }
    }
    // Each offset as a swing across the bone, then a twist about it, each within its soft limit.
    for (let i = 0; i < active.length; i++) {
      if (!active[i]) continue;
      const o = i * 6, along = axis.set(axes[i * 3], axes[i * 3 + 1], axes[i * 3 + 2]);
      const t = Vector3.Dot(here.set(springs[o], springs[o + 1], springs[o + 2]), along);
      here.subtractInPlace(arm.copyFrom(along).scaleInPlace(t));
      const s = here.length();
      if (s + Math.abs(t) + Math.abs(springs[o + 3]) + Math.abs(springs[o + 4]) + Math.abs(springs[o + 5]) < 1e-5) { active[i] = 0; springs.fill(0, o, o + 6); continue; }
      if (s > 1e-9) Quaternion.RotationAxisToRef(here.scaleInPlace(1 / s), soft(s, limits[i * 2]), swing); else swing.set(0, 0, 0, 1);
      Quaternion.RotationAxisToRef(along, soft(t, limits[i * 2 + 1]), twist);
      pose.rotation(i, spin);
      spin.multiplyToRef(swing, spin).multiplyToRef(twist, spin);
      pose.setRotation(i, spin);
      // Wind-up past three limits adds nothing visible: keep the springs there, so they come back in time.
      const most = 3 * limits[i * 2], twisted = 3 * limits[i * 2 + 1];
      if (s > most) { springs[o] -= here.x * (s - most); springs[o + 1] -= here.y * (s - most); springs[o + 2] -= here.z * (s - most); }
      if (Math.abs(t) > twisted) { const back = t - Math.sign(t) * twisted; springs[o] -= along.x * back; springs[o + 1] -= along.y * back; springs[o + 2] -= along.z * back; }
    }
  },
});
