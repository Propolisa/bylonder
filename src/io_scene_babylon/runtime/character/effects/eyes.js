// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Idle life of the eyes: small saccades, held a moment each, and blinks every few seconds (now and then twice), each
// blink moving the upper lid control most of the way to the lower one and the lower a little up, so the rig's own lid
// limits apply. Without lid roles it does saccades only. Bones whose action has a sound are left alone.
import { Vector3 } from '@babylonjs/core';
import { defineEffect } from '../api.js';
import { createEye } from './aim.js';
import { moveWorld, worldOf } from './space.js';

const CLOSE = 0.05, SHUT = 0.04, OPEN = 0.1, UPPER = 0.8;
const upper = new Vector3(), lower = new Vector3(), gap = new Vector3();

/** How closed a blink is `t` seconds in: quickly shut, held a moment, then open more slowly. */
const closed = (/** @type {number} */ t) => (t < 0 ? 0 : t < CLOSE ? t / CLOSE : t < CLOSE + SHUT ? 1 : t < CLOSE + SHUT + OPEN ? 1 - (t - CLOSE - SHUT) / OPEN : 0);

export const eyes = defineEffect({
  name: 'eyes',
  needs: [],
  on: 'controls',
  options: {
    /** Seconds between blinks, on average. */
    blinkEvery: 4,
  },
  init(character) {
    const all = character.boneRoles(), head = all.head;
    const eyeBones = ['eye.L', 'eye.R'].map((role) => all[role]).filter((bone) => bone >= 0);
    const lids = ['lid.L', 'lid.R'].map((role) => all[role]).filter((pair) => Array.isArray(pair));
    if (!lids.length) console.info(`eyes: ${character.armature} has no lid roles (lid.L, lid.R), so its eyes do not blink`);
    return {
      eyes: head >= 0 ? eyeBones.map((eye) => ({ bone: eye, eye: createEye(character, eye, head, eyeBones) })) : [],
      lids: /** @type {number[][]} */ (lids), blink: 1 + character.random() * 3, twice: false, look: 0, yaw: 0, pitch: 0,
    };
  },
  update(dt, { pose, time, options, character }, state) {
    // Saccades: a new small offset every half second or so, held until the next.
    if (time >= state.look) {
      state.yaw = (character.random() - 0.5) * 0.1;
      state.pitch = (character.random() - 0.5) * 0.06;
      state.look = time + 0.4 + character.random();
    }
    for (const { bone, eye } of state.eyes) if (!character.voiced(bone)) eye.glance(pose, state.yaw, state.pitch);
    // Blinks: shut and open; one in six comes twice.
    if (time > state.blink + CLOSE + SHUT + OPEN) {
      state.twice = !state.twice && character.random() < 1 / 6;
      state.blink = time + (state.twice ? 0.12 : options.blinkEvery * (0.5 + character.random()));
    }
    const amount = closed(time - state.blink);
    if (amount <= 0) return;
    for (const [top, bottom] of state.lids) {
      if (character.voiced(top)) continue;
      worldOf(pose, top, upper);
      worldOf(pose, bottom, lower);
      lower.subtractToRef(upper, gap);
      moveWorld(pose, top, gap.scaleInPlace(UPPER * amount));
      moveWorld(pose, bottom, gap.scaleInPlace(-(1 - UPPER) / UPPER));
    }
  },
});
