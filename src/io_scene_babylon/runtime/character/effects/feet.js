// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Feet on the ground: each foot follows the ground's height under it, turned to its slope while it is down, and locks
// the ball of the foot where it lands while the body's action says it has contact, so it never slides (beyond a trail, dragged smoothly); the body lowers when a foot must reach
// down. All of it eased by springs, so steps on and off ledges do not pop. The action is taken to be made on flat
// ground where the character stands.
import { Quaternion, Vector3 } from '@babylonjs/core';
import { defineEffect } from '../api.js';
import { createLimb } from './limbs.js';
import { between, damp, moveWorld } from './space.js';

const UP = new Vector3(0, 1, 0), IDENTITY = Quaternion.Identity();
const free = new Vector3(), toward = new Vector3(), tried = new Vector3();

/**
 * The bone that carries the whole body, which the feet lower for a foot to reach down: the top of the hips' chain, under
 * the armature's root bone where it has one (a rig's torso control, or the hips where they are the top). A control
 * lower down, such as a rig's own hips control, stretches the spine when moved without the chest.
 * @param {any} character @param {number} hips
 */
function bodyOf(character, hips) {
  const { parents } = character.rig;
  let body = hips;
  while (parents[body] >= 0 && parents[parents[body]] >= 0) body = parents[body];
  return body;
}

export const feet = defineEffect({
  name: 'feet',
  needs: ['hips', 'legs'],
  on: 'controls',
  options: {
    /** Highest step up or down a foot follows, in metres. */
    reach: 0.5,
    /** Seconds the height and lock springs take to go half way. */
    halfLife: 0.08,
    /** How much a planted foot turns to the ground's slope, 0 to 1. */
    align: 0.7,
    /** How much more bent or straighter than the action a held foot may make its leg, as the knee's angle in radians. */
    give: 0.17,
  },
  init(character, roles) {
    const { names } = character.rig, feetRoles = Object.keys(character.roles).filter((role) => role.startsWith('foot.'));
    const legs = roles.legs.map((chain) => ({
      limb: createLimb(character, chain), foot: feetRoles.find((role) => character.roles[role] === names[chain[chain.length - 1]]) ?? null,
      height: new Float32Array(2), hold: new Float32Array(2), locked: new Vector3(), isLocked: false,
      played: new Vector3(), ankle: new Vector3(), target: new Vector3(), normal: new Vector3(0, 1, 0), slope: new Quaternion(),
    }));
    return { legs, body: bodyOf(character, roles.hips), hips: new Float32Array(2), offset: new Vector3() };
  },
  update(dt, { pose, roles, options, character }, state) {
    // The ground the action was made on: where the character stands (its origin may be authored above it).
    const floor = character.movement?.position.y ?? character.node.getAbsolutePosition().y, active = character.effect('feet').weight > 1e-3;
    // Airborne, the ground is out of the feet's reach: they go as the action has them, and nothing holds them.
    const grounded = character.movement?.grounded ?? true;
    let lowest = 0;
    for (const leg of state.legs) {
      leg.limb.ballAt(pose, leg.played);
      const ground = character.movement?.ground(leg.played.x, leg.played.z) ?? null;
      const want = ground && grounded ? Math.max(-options.reach, Math.min(options.reach, ground.height - floor)) : 0;
      if (ground) leg.normal.set(ground.normal.x, ground.normal.y, ground.normal.z);
      lowest = Math.min(lowest, damp(leg.height, 0, want, options.halfLife, dt));
    }
    const hips = damp(state.hips, 0, lowest, options.halfLife, dt);
    if (hips < -1e-5) moveWorld(pose, state.body, state.offset.set(0, hips, 0));
    // A held foot stays where it landed while its leg reaches it bent as the action bends it, within `give` either
    // way; beyond, it slides toward where it is played just as far as that takes.
    const fit = (/** @type {typeof state.legs[0]} */ leg) => {
      const { limb, ankle, locked } = leg, played = limb.extension(pose, limb.endAt(pose, free).addInPlaceFromFloats(0, leg.height[0], 0));
      const bend = limb.bend(pose), most = Math.max(played, limb.span(Math.max(0, bend - options.give)));
      const least = Math.min(played, limb.span(Math.min(Math.PI, bend + options.give)));
      const outside = (/** @type {Vector3} */ at) => { const reach = limb.extension(pose, at); return reach > most || reach < least; };
      if (!outside(ankle)) return;
      free.subtractToRef(ankle, toward);
      let low = 0, high = 1;
      for (let k = 0; k < 10; k++) {
        const mid = (low + high) / 2;
        if (outside(toward.scaleToRef(mid, tried).addInPlace(ankle))) low = mid; else high = mid;
      }
      toward.scaleInPlace(high);
      ankle.addInPlace(toward);
      locked.x += toward.x; locked.z += toward.z;
    };
    for (const leg of state.legs) {
      const contact = active && grounded && leg.foot ? character.contact(leg.foot) : 0;
      leg.target.copyFrom(leg.played);
      leg.target.y += leg.height[0];
      const { locked, target } = leg;
      // Planted where the foot is now, let go eased, so a lifting foot blends back onto its swing.
      if (contact > 0.5) {
        const hold = leg.isLocked ? leg.hold[0] : 0;
        locked.x = target.x + (locked.x - target.x) * hold;
        locked.z = target.z + (locked.z - target.z) * hold;
        leg.isLocked = true;
        leg.hold[0] = 1; leg.hold[1] = 0;
      } else if (!grounded) { leg.isLocked = false; leg.hold.fill(0); }
      else if (leg.isLocked && damp(leg.hold, 0, 0, options.halfLife, dt) < 1e-3) leg.isLocked = false;
      if (leg.isLocked) {
        target.x += (locked.x - target.x) * leg.hold[0];
        target.z += (locked.z - target.z) * leg.hold[0];
      }
      between(UP, leg.normal, leg.slope);
      Quaternion.SlerpToRef(IDENTITY, leg.slope, options.align * Math.min(1, contact), leg.slope);
      // The ankle goes where it keeps the ball there: a heel the action lifts rolls about the held ball.
      leg.limb.endAt(pose, leg.ankle).addInPlace(target).subtractInPlace(leg.played);
      if (leg.isLocked) fit(leg);
      leg.limb.reach(pose, leg.ankle, 1, leg.slope);
    }
  },
});
