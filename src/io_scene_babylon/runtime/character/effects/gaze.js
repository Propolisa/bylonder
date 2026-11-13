// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Attention: of its targets within `near` metres and the intent's `look`, the character watches the most interesting
// one, scored by nearness, motion and how far in front it is, the intent's `look` above all. It watches only what it can
// turn to face: the head turns at most `turn` (about the vertical, shared down the neck and chest, and up or down), and a
// target farther round than that is out of view. The eyes lead and the head follows more slowly, the chest a little; a
// new target must beat the current one clearly and the current one is kept at least a moment, so attention does not
// flicker. Now and then the eyes glance away, unless `stare`.
import { Vector3 } from '@babylonjs/core';
import { defineEffect } from '../api.js';
import { aimChain, createEye, forwardIn } from './aim.js';
import { damp, facing } from './space.js';

/** @typedef {import('@babylonjs/core').TransformNode | import('@babylonjs/core').Camera | Vector3} Target */

// A watched target stays in view a little past the turn (radians), so attention does not flicker at its edge.
const KEEP = 1.2, BETTER = 1.25, PAST = 0.26;

/** A target's world position into `out`. */
function placeOf(/** @type {Target} */ target, /** @type {Vector3} */ out) {
  if (target instanceof Vector3) return out.copyFrom(target);
  const camera = /** @type {any} */ (target).globalPosition;
  return out.copyFrom(camera ?? /** @type {any} */ (target).getAbsolutePosition());
}


export const gaze = defineEffect({
  name: 'gaze',
  needs: ['head'],
  on: 'controls',
  options: {
    /** Nodes, cameras or points worth looking at; empty entries (a scene without a camera yet) are skipped. */
    targets: /** @type {(Target | null | undefined)[]} */ ([]),
    /** How near a target must be to be looked at, in metres. */
    near: 10,
    /** Never glance away. */
    stare: false,
    /** Turn the eyes (else the head alone). */
    eyes: true,
    /** The most the head turns from the body's forward, in radians: about the vertical, and up or down. */
    turn: { yaw: 1.2, pitch: 0.7 },
  },
  tiers: { B: { stare: true }, C: { stare: true, eyes: false } },
  init(character, roles) {
    const all = character.boneRoles(), head = roles.head;
    const eyeBones = ['eye.L', 'eye.R'].map((role) => all[role]).filter((bone) => bone >= 0);
    const chain = ['chest', 'neck'].map((role) => all[role]).filter((bone) => bone >= 0 && bone !== head);
    const headForward = forwardIn(character, head, eyeBones, head);
    return {
      chain: [...chain, head], shares: [...chain.map(() => 0.25), 1].slice(-chain.length - 1),
      headForward, eyes: eyeBones.map((eye) => createEye(character, eye, head, eyeBones)),
      // The point the eyes and the head look at, each eased: eyes fast, the head slower.
      eyeAt: new Vector3(), headAt: new Vector3(), springs: new Float32Array(12), amount: new Float32Array(4),
      current: /** @type {Target | null} */ (null), since: 0, glance: 2, glanceYaw: 0, glancePitch: 0,
      last: new Float32Array(48), at: new Vector3(), from: new Vector3(), front: new Vector3(),
    };
  },
  update(dt, { pose, options, character, time }, state) {
    const { at, from, front } = state, look = character.intent?.look ?? null;
    const seen = Math.cos(options.turn.yaw), kept = Math.cos(options.turn.yaw + PAST);
    character.node.getAbsolutePosition().addToRef(Vector3.UpReadOnly, from);
    facing(character, front);
    // Score the targets; the intent's look wins outright.
    let best = /** @type {Target | null} */ (look), bestScore = look ? Infinity : 0, currentScore = 0;
    for (let i = 0; i < options.targets.length; i++) {
      const target = options.targets[i];
      if (!target) continue;
      placeOf(target, at);
      const k = (i % 16) * 3, dx = at.x - state.last[k], dy = at.y - state.last[k + 1], dz = at.z - state.last[k + 2], moved = dt > 0 ? Math.sqrt(dx * dx + dy * dy + dz * dz) / dt : 0;
      state.last[k] = at.x; state.last[k + 1] = at.y; state.last[k + 2] = at.z;
      at.subtractInPlace(from);
      const distance = at.length();
      if (distance > options.near) continue;
      const ahead = Vector3.Dot(at, front) / (distance || 1);
      if (ahead < (target === state.current ? kept : seen)) continue;
      const score = (1 / (1 + distance)) * (1 + Math.min(moved, 3)) * (0.6 + 0.4 * ahead);
      if (target === state.current) currentScore = score;
      if (score > bestScore) { best = target; bestScore = score; }
    }
    state.since += dt;
    if (best !== state.current && (best === look || !state.current || state.since > KEEP && bestScore > currentScore * BETTER || currentScore === 0)) {
      state.current = best;
      state.since = 0;
    }
    // Even the intent's look is let go once behind, rather than twisting the neck.
    if (state.current) {
      placeOf(state.current, at);
      if (Vector3.Dot(at.subtractInPlace(from).normalize(), front) < kept) state.current = null;
    }
    const wanted = state.current ? 1 : 0, eyes = damp(state.amount, 0, wanted, 0.08, dt), head = damp(state.amount, 2, wanted, 0.3, dt);
    if (state.current) {
      placeOf(state.current, at);
      // A first target is looked at from where it is, not from where the last one was.
      if (state.amount[2] < 1e-3) for (let c = 0; c < 12; c += 2) { state.springs[c] = c % 6 === 0 ? at.x : c % 6 === 2 ? at.y : at.z; state.springs[c + 1] = 0; }
      state.eyeAt.set(damp(state.springs, 0, at.x, 0.04, dt), damp(state.springs, 2, at.y, 0.04, dt), damp(state.springs, 4, at.z, 0.04, dt));
      state.headAt.set(damp(state.springs, 6, at.x, 0.25, dt), damp(state.springs, 8, at.y, 0.25, dt), damp(state.springs, 10, at.z, 0.25, dt));
    }
    if (head > 1e-3) aimChain(pose, state.chain, state.shares, state.headForward, state.headAt, options.turn, head);
    if (!options.eyes || eyes < 1e-3) return;
    // Glances: every few seconds the eyes look a little away for a moment.
    if (time >= state.glance) {
      const away = !options.stare && state.glanceYaw === 0;
      state.glanceYaw = away ? (character.random() - 0.5) * 0.5 : 0;
      state.glancePitch = away ? (character.random() - 0.5) * 0.2 : 0;
      state.glance = time + (away ? 0.3 + 0.3 * character.random() : 2 + 3 * character.random());
    }
    for (const eye of state.eyes) {
      eye.lookAt(pose, state.eyeAt, eyes);
      if (state.glanceYaw || state.glancePitch) eye.glance(pose, state.glanceYaw * eyes, state.glancePitch * eyes);
    }
  },
});
