// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The character's movement (the guide's step 2): critically damped springs take its velocity toward the intent's move
// and its facing toward the intent's facing (else where it moves), as in Holden's "Spring-It-On", so the next second is
// known in closed form (`predict`). The ground is a ray down onto the scene's meshes, walls are those meshes against a
// capsule above the step height (collision.js), behind a body seam (`cast`, `move`) a physics engine's character
// controller can take. An action or `place` can own the root; the springs follow it, so the hand back is
// continuous.
import { Quaternion, Vector3 } from '@babylonjs/core';
import { collisionWorld, shown } from './collision.js';
import { createWorldPose } from './procedural.js';

// A move that swings past PIVOT from the way it goes is a pivot: it stops, turns in place at most PIVOT_RATE (rad/s),
// then goes once it faces within SQUARED of the move.
const PIVOT = (120 * Math.PI) / 180, SQUARED = (30 * Math.PI) / 180, PIVOT_RATE = 2.5, TURNING = 0.3, GRAVITY = 9.81, JUMP_HEIGHT = 0.9, KEEP_JUMP = 0.3, STEP = 0.35, MAX_SLOPE = Math.cos((50 * Math.PI) / 180);
// How fast a character steps out of what it stands in (handed over inside a prop), in metres a second.
const STEP_OUT = 1;

const wrap = (/** @type {number} */ a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const flatYaw = (/** @type {Vector3} */ v, /** @type {number} */ otherwise) => (v.x * v.x + v.z * v.z > 1e-8 ? Math.atan2(v.x, v.z) : otherwise);
const smooth = (/** @type {number} */ t) => t * t * (3 - 2 * t);

/** Where a node faces, flat: its -Z, which is Blender's front (-Y) as the export turns it. */
export function facingOf(/** @type {import('@babylonjs/core').TransformNode} */ node, out = new Vector3()) {
  Vector3.TransformNormalFromFloatsToRef(0, 0, -1, node.computeWorldMatrix(true), out);
  out.y = 0;
  return out.lengthSquared() > 1e-8 ? out.normalize() : out.set(0, 0, -1);
}

/**
 * Where a rig faces in its own space, flat: from its ankles to its toes at rest (the role `legs`' feet and their
 * first children), else -Z (Blender's front as exported).
 * @param {{ names: string[], parents: Int32Array, rest: Float32Array, boneIndex(name: string): number }} rig @param {string[][]} legs
 */
export function restFront(rig, legs) {
  const world = createWorldPose(rig), front = new Vector3();
  world.update(rig.rest);
  for (const chain of legs) {
    const foot = rig.boneIndex(/** @type {string} */ (chain.at(-1))), toe = rig.parents.indexOf(foot);
    if (foot < 0 || toe < 0) continue;
    front.x += world.position[toe * 3] - world.position[foot * 3];
    front.z += world.position[toe * 3 + 2] - world.position[foot * 3 + 2];
  }
  return front.lengthSquared() > 1e-8 ? front.normalize() : front.set(0, 0, -1);
}

/**
 * One axis of a velocity spring after `t` seconds: position offset, velocity and acceleration from velocity `v`,
 * acceleration `a`, goal velocity `goal` and the spring's `y` (half its damping).
 */
function springAxis(/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ goal, /** @type {number} */ y, /** @type {number} */ t, /** @type {number[]} */ out) {
  const j0 = v - goal, j1 = a + j0 * y, e = Math.exp(-y * t);
  out[0] = e * (-j1 / (y * y) - (j0 + j1 * t) / y) + j1 / (y * y) + j0 / y + goal * t;
  out[1] = e * (j0 + j1 * t) + goal;
  out[2] = e * (a - j1 * y * t);
}

/** `speed` kept between 0 and `limit`. @param {number} speed @param {number} limit */
const within = (speed, limit) => Math.min(Math.max(speed, Math.min(limit, 0)), Math.max(limit, 0));

/**
 * The movement's body without a physics engine, on the scene's collision world (collision.js): the ground under it by
 * a ray, walls by three spheres up a capsule pushed out sideways. A physics engine's character controller can take its
 * place through the same members (`cast`, `move`, `dispose`).
 * @param {import('@babylonjs/core').Scene} scene @param {(mesh: import('@babylonjs/core').AbstractMesh) => boolean} isGround
 * @param {{ height: number, radius: number }} capsule
 */
function worldBody(scene, isGround, { height, radius }) {
  const world = collisionWorld(scene, STEP), push = [0, 0], spheres = [STEP + radius, (STEP + height) / 2, height - radius];
  let mine = new Uint8Array(0), allowed = new Uint8Array(0);
  /** The meshes this character stands on and bumps into, among the world's, as shown now. */
  const meshes = () => {
    if (mine.length !== world.meshes.length) { mine = Uint8Array.from(world.meshes, (e) => (isGround(e.mesh) ? 1 : 0)); allowed = new Uint8Array(mine.length); }
    for (let m = 0; m < mine.length; m++) allowed[m] = mine[m] && shown(world.meshes[m].mesh) ? 1 : 0;
    return allowed;
  };
  const cast = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ top, /** @type {number} */ length) => world.ground(x, z, top, length, meshes());
  return {
    cast,
    /** Moves `at` by (dx, dz) along the ground and out of walls, `state` holding its vertical speed and grounding. */
    move(/** @type {Vector3} */ at, /** @type {number} */ dx, /** @type {number} */ dz, /** @type {number} */ dt, /** @type {{ vy: number, grounded: boolean }} */ state) {
      const x = at.x, z = at.z;
      at.x += dx;
      at.z += dz;
      const mx = at.x, mz = at.z;
      for (let k = 0; k < spheres.length; k++) {
        world.push(at.x, at.y + spheres[k], at.z, radius, meshes(), push);
        at.x += push[0];
        at.z += push[1];
      }
      // Out of what this step walked into at once, out of what it already stood in at STEP_OUT.
      const out = Math.hypot(at.x - mx, at.z - mz), most = Math.hypot(dx, dz) + STEP_OUT * dt;
      if (out > most) { at.x = mx + ((at.x - mx) * most) / out; at.z = mz + ((at.z - mz) * most) / out; }
      const under = cast(at.x, at.z, at.y + STEP, 2 * STEP);
      const tooSteep = state.grounded && under && under.height > at.y + 0.01 && under.normal.y < MAX_SLOPE;
      if (tooSteep) { at.x = x; at.z = z; }
      if (state.grounded && state.vy <= 0) {
        const below = tooSteep ? cast(at.x, at.z, at.y + STEP, 2 * STEP) : under;
        if (below) at.y = below.height;
        else state.grounded = false;
        state.vy = 0;
        return;
      }
      state.vy -= GRAVITY * dt;
      at.y += state.vy * dt;
      const floor = cast(at.x, at.z, at.y + STEP - state.vy * dt, STEP * 2 - state.vy * dt);
      if (floor && state.vy <= 0 && at.y <= floor.height) { at.y = floor.height; state.vy = 0; state.grounded = true; }
    },
    dispose() {},
  };
}

/**
 * A character's movement on `node`, which it moves and turns, `front` (the way the character faces in the node's own
 * space, restFront) to the facing.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {{ node: import('@babylonjs/core').TransformNode, front?: Vector3, responsiveness?: number,
 *   ground?: (string | RegExp)[] | null, height?: number, radius?: number }} options `ground` limits the ground and walls
 *   to meshes of those names
 * @returns {import('./api.js').Movement & { responsiveness: number, push(by: Vector3): void, place(position: Vector3, facing: Vector3, seconds: number): Promise<void>,
 *   turnTo(facing: Vector3, seconds: number): Promise<void>, dispose(): void }}
 */
export function createMovement(scene, { node, front = new Vector3(0, 0, 1), responsiveness = 0.1, ground = null, height = 1.8, radius = 0.3 }) {
  const named = (/** @type {string} */ name) => !ground || ground.some((n) => (typeof n === 'string' ? n === name : n.test(name)));
  const isGround = (/** @type {import('@babylonjs/core').AbstractMesh} */ mesh) => !mesh.isDescendantOf(node) && named(mesh.name);
  const position = node.getAbsolutePosition().clone(), facing = facingOfNode(node, front), velocity = new Vector3(), frontYaw = flatYaw(front, 0);
  const body = worldBody(scene, isGround, { height, radius });
  const vertical = { vy: 0, grounded: true };
  const start = body.cast(position.x, position.z, position.y + STEP, 2 * STEP);
  // The armature's authored height over the ground under it (a rig whose origin is above its soles), kept wherever it
  // walks; up to a step, so a character dropped from the air still lands.
  const lift = start ? Math.max(-STEP, Math.min(STEP, position.y - start.height)) : 0;
  if (start) position.y = start.height;
  const goal = new Vector3(), axis = [0, 0, 0];
  let pivoting = false, yaw = flatYaw(facing, 0), goalYaw = yaw, endYaw = yaw, spin = 0, ax = 0, az = 0, time = 0, jumpAt = -Infinity, jumpHeld = false;
  /** @type {{ from: Vector3, to: Vector3, fromYaw: number, toYaw: number, seconds: number, t: number, done: () => void } | null} */
  let tween = null;
  const springY = () => (2 * Math.LN2) / Math.max(movement.responsiveness, 1e-3);
  const place = new Vector3(), toward = new Vector3();

  const show = () => {
    node.position.copyFrom(position);
    node.position.y += lift;
    node.rotationQuaternion ??= new Quaternion();
    Quaternion.RotationYawPitchRollToRef(yaw - frontYaw, 0, 0, node.rotationQuaternion);
    facing.set(Math.sin(yaw), 0, Math.cos(yaw));
  };
  const runTween = (/** @type {number} */ dt) => {
    if (!tween) return;
    tween.t = Math.min(1, tween.t + dt / tween.seconds);
    const k = smooth(tween.t);
    Vector3.LerpToRef(tween.from, tween.to, k, place);
    movement.follow(dt, place, toward.set(Math.sin(tween.fromYaw + k * tween.toYaw), 0, Math.cos(tween.fromYaw + k * tween.toYaw)));
    if (tween.t < 1) return;
    const { done } = tween;
    tween = null;
    // Eased to rest: what it hands back is still.
    velocity.setAll(0);
    spin = 0;
    movement.own('movement');
    done();
  };
  const startTween = (/** @type {Vector3} */ to, /** @type {Vector3} */ toFacing, /** @type {number} */ seconds) => new Promise((resolve) => {
    tween?.done();
    movement.own('place');
    tween = { from: position.clone(), to: to.clone(), fromYaw: yaw, toYaw: wrap(flatYaw(toFacing, yaw) - yaw), seconds: Math.max(seconds, 1e-3), t: 0, done: () => resolve(undefined) };
  });

  const movement = {
    position, facing, velocity, responsiveness,
    /** @type {'movement' | 'action' | 'place'} */ owner: 'movement',
    get grounded() { return vertical.grounded; },
    own(/** @type {'movement' | 'action' | 'place'} */ owner) { movement.owner = owner; },
    follow(/** @type {number} */ dt, /** @type {Vector3} */ to, /** @type {Vector3} */ toFacing) {
      if (dt > 0) {
        to.subtractToRef(position, velocity).scaleInPlace(1 / dt);
        spin = wrap(flatYaw(toFacing, yaw) - yaw) / dt;
      }
      ax = az = 0;
      position.copyFrom(to);
      yaw = goalYaw = endYaw = flatYaw(toFacing, yaw);
      const under = body.cast(position.x, position.z, position.y + 0.05, 0.1);
      vertical.grounded = !!under;
      vertical.vy = under ? 0 : velocity.y;
      show();
    },
    update(/** @type {number} */ dt, /** @type {import('./api.js').Intent} */ intent) {
      if (dt <= 0) return;
      time += dt;
      if (intent.jump && !jumpHeld) jumpAt = time;
      jumpHeld = !!intent.jump;
      if (movement.owner === 'place') runTween(dt);
      if (movement.owner !== 'movement') return;
      goal.set(intent.move.x, 0, intent.move.z);
      const moving = velocity.x * velocity.x + velocity.z * velocity.z > TURNING ** 2, wants = goal.lengthSquared() > 0.0025;
      endYaw = intent.facing ? flatYaw(intent.facing, yaw) : wants ? flatYaw(goal, yaw) : endYaw;
      // A pivot: stopping facing the way it went, turning in place (the feet step round), going once it faces the move.
      if (!intent.facing && wants && moving && Math.abs(wrap(flatYaw(goal, yaw) - flatYaw(velocity, yaw))) > PIVOT) pivoting = true;
      if (pivoting && (!wants || intent.facing || (!moving && Math.abs(wrap(yaw - endYaw)) < SQUARED))) pivoting = false;
      if (pivoting) goal.setAll(0);
      goalYaw = pivoting && moving ? flatYaw(velocity, yaw) : endYaw;
      const y = springY();
      springAxis(velocity.x, ax, goal.x, y, dt, axis);
      const dx = axis[0];
      velocity.x = axis[1]; ax = axis[2];
      springAxis(velocity.z, az, goal.z, y, dt, axis);
      const dz = axis[0];
      velocity.z = axis[1]; az = axis[2];
      const turn = wrap(yaw - goalYaw), j1 = spin + turn * y, e = Math.exp(-y * dt), was = yaw;
      yaw = wrap(goalYaw + e * (turn + j1 * dt));
      spin = e * (spin - j1 * y * dt);
      // A pivot turns no faster than the feet can step round.
      if (pivoting && Math.abs(wrap(yaw - was)) > PIVOT_RATE * dt) {
        yaw = wrap(was + Math.sign(wrap(yaw - was)) * PIVOT_RATE * dt);
        spin = Math.sign(spin) * Math.min(Math.abs(spin), PIVOT_RATE);
      }
      if (vertical.grounded && time - jumpAt <= KEEP_JUMP) {
        vertical.vy = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
        vertical.grounded = false;
        jumpAt = -Infinity;
      }
      const x0 = position.x, z0 = position.z;
      body.move(position, dx, dz, dt, vertical);
      // Held by a wall: the springs carry on from what it allowed. Being pushed out of one gives it no speed.
      const blockedX = Math.abs(position.x - x0 - dx) > 1e-4, blockedZ = Math.abs(position.z - z0 - dz) > 1e-4;
      if (blockedX) { velocity.x = within((position.x - x0) / dt, velocity.x); ax = 0; }
      if (blockedZ) { velocity.z = within((position.z - z0) / dt, velocity.z); az = 0; }
      velocity.y = vertical.vy;
      show();
    },
    predict(/** @type {number} */ seconds, /** @type {{ position: Vector3, facing: Vector3 }} */ out) {
      const y = springY(), moving = movement.owner === 'movement';
      springAxis(velocity.x, ax, moving ? goal.x : 0, y, seconds, axis);
      out.position.x = position.x + axis[0];
      springAxis(velocity.z, az, moving ? goal.z : 0, y, seconds, axis);
      out.position.z = position.z + axis[0];
      out.position.y = position.y;
      // Toward where it will face once its velocity has turned.
      const turn = wrap(yaw - endYaw), at = wrap(endYaw + Math.exp(-y * seconds) * (turn + (spin + turn * y) * seconds));
      out.facing.set(Math.sin(at), 0, Math.cos(at));
      // place and turnTo: where their easing ends, once it has.
      if (tween) {
        const k = smooth(Math.min(1, tween.t + seconds / tween.seconds)), end = tween.fromYaw + k * tween.toYaw;
        Vector3.LerpToRef(tween.from, tween.to, k, out.position);
        out.facing.set(Math.sin(end), 0, Math.cos(end));
      }
    },
    /** Adds to its velocity (a shove); the springs then bring it back to the intent. Up lifts it off the ground. */
    push(/** @type {Vector3} */ by) {
      if (movement.owner !== 'movement') return;
      velocity.x += by.x;
      velocity.z += by.z;
      if (by.y > 0) { vertical.vy += by.y; vertical.grounded = false; }
    },
    /** The ground under (x, z) from `top` (a metre above the character) down. */
    ground(/** @type {number} */ x, /** @type {number} */ z, top = position.y + 1) { return body.cast(x, z, top, 50); },
    /** Moves the root onto `to`, facing `toFacing`, over `seconds`, eased; the movement owns it again after. */
    place: (/** @type {Vector3} */ to, /** @type {Vector3} */ toFacing, /** @type {number} */ seconds) => startTween(to, toFacing, seconds),
    /** Turns the root in place to `toFacing` over `seconds`. */
    turnTo: (/** @type {Vector3} */ toFacing, /** @type {number} */ seconds) => startTween(position, toFacing, seconds),
    dispose() { tween?.done(); body.dispose(); },
  };
  show();
  return movement;
}

/** The facing a character starts with: its front as its node is turned, flat. */
function facingOfNode(/** @type {import('@babylonjs/core').TransformNode} */ node, /** @type {Vector3} */ front) {
  const out = Vector3.TransformNormal(front, node.computeWorldMatrix(true));
  out.y = 0;
  return out.lengthSquared() > 1e-8 ? out.normalize() : new Vector3(0, 0, 1);
}

const ARRIVED = 0.05, BRAKING = 2;
/** @typedef {import('@babylonjs/core').TransformNode | Vector3} Target */
const pointOf = (/** @type {Target} */ target) => (target instanceof Vector3 ? target : target.getAbsolutePosition());

/**
 * Intent toward `target` at walking (or running) speed, braking at BRAKING m/s² to stop on it.
 * @param {import('./api.js').Character} character @param {Target} target @param {{ run?: boolean }} [options]
 * @returns {import('./api.js').Intent}
 */
export function steer(character, target, { run = false } = {}) {
  const to = pointOf(target).subtract(character.movement.position);
  to.y = 0;
  const distance = to.length(), speeds = character.locomotion?.speeds ?? DEFAULT_SPEEDS;
  const speed = Math.min(run ? speeds.run : speeds.walk, Math.sqrt(2 * BRAKING * distance), 4 * distance);
  return { move: distance > 1e-6 ? to.scaleInPlace(speed / distance) : to };
}
/** Top speeds without locomotion's own (m/s). */
export const DEFAULT_SPEEDS = { walk: 1.4, run: 3.5 };

/**
 * Steers the character to `target` in place of its input, which it gets back on arrival.
 * @param {import('./api.js').Character} character @param {Target} target @param {{ run?: boolean }} [options]
 * @returns {Promise<void>}
 */
export function walkTo(character, target, options) {
  const before = character.input;
  return new Promise((resolve) => {
    character.input = () => {
      const intent = steer(character, target, options), { movement } = character;
      if (intent.move.length() < ARRIVED && movement.velocity.length() < ARRIVED) {
        character.input = before;
        resolve();
      }
      return intent;
    };
  });
}

/**
 * Moves the character onto `node`'s place and facing, eased over `seconds`.
 * @param {import('./api.js').Character} character @param {import('@babylonjs/core').TransformNode} node @param {{ seconds?: number }} [options]
 * @returns {Promise<void>}
 */
export function place(character, node, { seconds = 0.6 } = {}) {
  return character.movement.place(node.getAbsolutePosition(), facingOf(node), seconds);
}

/**
 * Turns the character in place toward `target`, eased over `seconds`.
 * @param {import('./api.js').Character} character @param {Target} target @param {{ seconds?: number }} [options]
 * @returns {Promise<void>}
 */
export function turnTo(character, target, { seconds = 0.5 } = {}) {
  const { movement } = character;
  return movement.turnTo(pointOf(target).subtract(movement.position), seconds);
}
