// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Idle life: the chest rises and falls with the breath. A chest whose action has a sound is left alone, so an actor's
// own breathing wins.
import { defineEffect } from '../api.js';

export const breathe = defineEffect({
  name: 'breathe',
  needs: ['chest'],
  on: 'controls',
  options: {
    /** Breaths per second. */
    rate: 0.25,
    /** How far the chest turns, in radians. */
    depth: 0.02,
  },
  tiers: { C: { depth: 0.01 } },
  update(dt, { pose, roles, time, options, character }) {
    const { chest } = roles;
    if (character.voiced(chest)) return;
    pose.addRotation(chest, 'X', Math.sin(time * options.rate * 2 * Math.PI) * options.depth);
  },
});
