// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Reaching: a hand eases onto a node or point through its arm (limbs.js: the rig's IK control, else a two-bone solve),
// keeping the hand's played rotation. `reached` resolves true when the hand arrives, false when it stops at full
// extension short of the target.
import { Vector3 } from '@babylonjs/core';
import { defineEffect } from '../api.js';
import { createLimb } from './limbs.js';
import { damp } from './space.js';

/** @typedef {import('@babylonjs/core').TransformNode | Vector3} Target */

const ARRIVED = 0.01;

export const reach = defineEffect({
  name: 'reach',
  needs: ['arms'],
  on: 'controls',
  options: {
    /** The hand's role. */
    hand: 'hand.R',
    /** A node or point to reach. */
    target: /** @type {Target | null} */ (null),
    /** Seconds the hand takes to go half way. */
    halfLife: 0.15,
  },
  init(character, roles, options) {
    const { names } = character.rig, hands = [];
    let limb = null;
    for (const chain of roles.arms) {
      const hand = Object.keys(character.roles).find((role) => role.startsWith('hand.') && character.roles[role] === names[chain[chain.length - 1]]);
      hands.push(hand);
      if (hand === options.hand) limb = createLimb(character, chain);
    }
    if (!limb) throw new Error(`reach: no hand "${options.hand}" on ${character.armature}: it has ${hands.join(', ')}`);
    /** @type {(value: boolean) => void} */
    let settle = () => {};
    const reached = new Promise((resolve) => { settle = resolve; });
    return { reached, settle, limb, amount: new Float32Array(2), at: new Vector3(), hand: new Vector3(), done: false };
  },
  update(dt, { pose, options }, state) {
    const { limb } = state;
    const target = options.target;
    if (!target) return;
    state.at.copyFrom(target instanceof Vector3 ? target : target.getAbsolutePosition());
    const amount = damp(state.amount, 0, 1, options.halfLife, dt), short = limb.reach(pose, state.at, amount);
    if (state.done || amount < 0.98) return;
    const arrived = Vector3.Distance(limb.endAt(pose, state.hand), state.at) < ARRIVED;
    if (arrived || short > 0) { state.done = true; state.settle(arrived); }
  },
});
