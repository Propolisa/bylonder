// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Leaning into acceleration and turns, as a body keeps its balance: the spine tilts forward as the character speeds
// up and back as it slows, and sideways into a turn, by the angle whose tangent is the acceleration over gravity.
import { Quaternion, Vector3 } from '@babylonjs/core';
import { defineEffect } from '../api.js';
import { about, damp, facing, turnWorld } from './space.js';

const G = 9.81;

/** The balanced lean for an acceleration, in radians, within the limit. */
const tilt = (/** @type {number} */ acceleration, /** @type {{ amount: number, limit: number }} */ { amount, limit }) => Math.max(-limit, Math.min(limit, Math.atan((acceleration * amount) / G)));

export const lean = defineEffect({
  name: 'lean',
  needs: ['spine', 'chest'],
  on: 'controls',
  options: {
    /** How much of a balanced lean, 1 being physical. */
    amount: 1,
    /** The largest lean, in radians (12 degrees). */
    limit: 0.21,
    halfLife: 0.12,
  },
  init(character, roles) {
    return { bones: [roles.spine, roles.chest], last: new Vector3(), angles: new Float32Array(4), front: new Vector3(), side: new Vector3(), turn: new Quaternion(), started: false };
  },
  update(dt, { pose, roles, options, character }, state) {
    const velocity = character.movement?.velocity;
    if (!velocity || dt <= 0) return;
    if (!state.started) { state.last.copyFrom(velocity); state.started = true; }
    const { front, side, turn } = state;
    facing(character, front);
    Vector3.CrossToRef(Vector3.UpReadOnly, front, side);
    // The acceleration, along the facing and across it.
    const ax = (velocity.x - state.last.x) / dt, az = (velocity.z - state.last.z) / dt;
    state.last.copyFrom(velocity);
    const pitch = damp(state.angles, 0, tilt(ax * front.x + az * front.z, options), options.halfLife, dt);
    const roll = damp(state.angles, 2, tilt(ax * side.x + az * side.z, options), options.halfLife, dt);
    if (Math.abs(pitch) + Math.abs(roll) < 1e-4) return;
    // Forward about the side axis, top toward the front; into a turn about the front axis, top toward the turn's centre.
    for (const bone of state.bones) {
      turnWorld(pose, bone, about(side, pitch / 2, turn));
      turnWorld(pose, bone, about(front, -roll / 2, turn));
    }
  },
});
