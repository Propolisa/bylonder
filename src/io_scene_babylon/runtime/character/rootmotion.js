// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The body's source owns the root (the guide's rules): while the body plays an action, the movement follows the
// action's root motion (its top bone's move over the ground and turn about up, taken out of the action's pose so the
// body does not move twice), or holds still for an action made in place; intent waits meanwhile. `warpTo` spreads the
// difference between where the action would put a marker and where it should be over the motion before the marker,
// by distance travelled, so a standing part does not slide.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { STRIDE } from './pose.js';
import { facingOf } from './movement.js';

const TRAVELS = 0.1, TURNS = (10 * Math.PI) / 180;

/**
 * @typedef {{ name: string, fps: number, frames: number, duration: number, bones: Int32Array, data: Float32Array,
 *   markers: { name: string, time: number }[] }} Clip
 * @typedef {{ name: string, time: number, clip: Clip, pose: Float32Array, markers: { name: string, time: number }[] }} Action
 * @typedef {{ track: Float32Array, moves: boolean, top: number }} Track per frame the top bone's ground move (along
 *   the two axes) and turn from its first frame
 */

/**
 * The root motion of a character's body actions.
 * @param {import('./api.js').Character & { rig: import('./rig.js').Rig, body: { source: unknown, warpTo?: any } }} character
 */
export function createRootMotion(character) {
  const { rig } = character;
  // The character's right, forward and up in the armature's space, as it stands when made.
  const toArmature = (rig.root?.computeWorldMatrix(true) ?? Matrix.Identity()).clone().invert(), { facing: front } = character.movement;
  const axis = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => Vector3.TransformNormal(new Vector3(x, y, z), toArmature).normalize();
  const up = axis(0, 1, 0), across = axis(front.z, 0, -front.x), ahead = axis(front.x, 0, front.z);
  /** @type {WeakMap<Clip, Track>} */
  const tracks = new WeakMap();
  const turn = new Quaternion(), own = new Quaternion(), step = new Vector3(), world = new Vector3(), to = new Vector3(), facing = new Vector3();
  const q = new Quaternion(), v = new Vector3();

  /** @param {Clip} clip @returns {Track} */
  const trackOf = (clip) => {
    let found = tracks.get(clip);
    if (found) return found;
    const top = Array.from(clip.bones).find((b) => rig.parents[b] < 0) ?? -1, track = new Float32Array(clip.frames * 3);
    const size = clip.bones.length * STRIDE, j = Array.from(clip.bones).indexOf(top);
    for (let f = 0; top >= 0 && f < clip.frames; f++) {
      const o = f * size + j * STRIDE;
      v.set(clip.data[o], clip.data[o + 1], clip.data[o + 2]);
      q.set(clip.data[o + 3], clip.data[o + 4], clip.data[o + 5], clip.data[o + 6]);
      const forward = ahead.applyRotationQuaternion(q);
      let yaw = Math.atan2(Vector3.Dot(forward, across), Vector3.Dot(forward, ahead));
      if (f > 0) yaw = track[(f - 1) * 3 + 2] + wrap(yaw - track[(f - 1) * 3 + 2] - track[2]) + track[2];
      track.set([Vector3.Dot(v, across), Vector3.Dot(v, ahead), yaw], f * 3);
    }
    for (let f = clip.frames - 1; f >= 0; f--) for (let k = 0; k < 3; k++) track[f * 3 + k] -= track[k];
    const end = (clip.frames - 1) * 3;
    found = { track, top, moves: Math.hypot(track[end], track[end + 1]) > TRAVELS || Math.abs(track[end + 2]) > TURNS };
    tracks.set(clip, found);
    return found;
  };
  /** The track at `time` into `out` [a, b, yaw]. */
  const at = (/** @type {Clip} */ clip, /** @type {Float32Array} */ track, /** @type {number} */ time, /** @type {number[]} */ out) => {
    const x = Math.min(Math.max(time * clip.fps, 0), clip.frames - 1), f = Math.floor(x), g = Math.min(f + 1, clip.frames - 1), t = x - f;
    for (let k = 0; k < 3; k++) out[k] = track[f * 3 + k] + (track[g * 3 + k] - track[f * 3 + k]) * t;
    return out;
  };

  const before = [0, 0, 0], now = [0, 0, 0], end = [0, 0, 0];
  /** @type {{ action: Action, track: Track, last: number, warp: { until: number, position: Vector3, yaw: number | null } | null } | null} */
  let playing = null;

  /** A ground step to the character's right `a` and forward `b`, in the world when it faces `yaw`. */
  const toWorld = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ yaw, /** @type {Vector3} */ out) =>
    out.set(a * Math.cos(yaw) + b * Math.sin(yaw), 0, -a * Math.sin(yaw) + b * Math.cos(yaw));

  const from_ = [0, 0, 0], to_ = [0, 0, 0], path = { move: new Vector3(), turn: 0, length: 0 };
  /** The action's root move, turn and path length from `from` to `until` seconds, its root facing `yaw` at `from`. */
  const travel = (/** @type {Clip} */ clip, /** @type {Float32Array} */ track, /** @type {number} */ from, /** @type {number} */ until, /** @type {number} */ yaw) => {
    path.move.setAll(0);
    path.length = 0;
    const start = at(clip, track, from, from_)[2];
    for (let t = from; t < until - 1e-9;) {
      const next = Math.min(until, t + 1 / clip.fps), da = -from_[0], db = -from_[1], turned = from_[2];
      at(clip, track, next, from_);
      path.move.addInPlace(toWorld(da + from_[0], db + from_[1], yaw + turned - start, step));
      path.length += Math.hypot(da + from_[0], db + from_[1]);
      t = next;
    }
    path.turn = from_[2] - start;
    return path;
  };

  const start = (/** @type {Action} */ action) => {
    const warpTo = character.body.warpTo;
    playing = { action, track: trackOf(action.clip), last: action.time, warp: null };
    character.movement.own('action');
    if (!warpTo) return;
    const marker = action.markers.find((m) => m.name === warpTo.marker);
    if (!marker) throw new Error(`warpTo: no marker "${warpTo.marker}" in ${action.name}: it has ${action.markers.map((m) => `"${m.name}"`).join(', ') || 'none'}`);
    const wanted = warpTo.node ? facingOf(warpTo.node) : warpTo.facing;
    playing.warp = {
      until: marker.time,
      position: (warpTo.node ? warpTo.node.getAbsolutePosition() : warpTo.position).clone(),
      yaw: wanted ? Math.atan2(wanted.x, wanted.z) : null,
    };
  };

  /**
   * Bends this frame's move (`world`, turning by `dyaw`) so the root lands on the warp's target at its marker: what is
   * still off is shared out by the path left, so a standing part does not slide.
   * @param {Clip} clip @param {Float32Array} track @param {number} time @param {{ until: number, position: Vector3, yaw: number | null }} warp
   */
  const bend = (clip, track, time, warp, /** @type {number} */ yaw, /** @type {number} */ dyaw, /** @type {number} */ stepLength) => {
    const left = travel(clip, track, Math.min(time, warp.until), warp.until, yaw + dyaw), position = character.movement.position;
    const share = time >= warp.until ? 1 : stepLength / (stepLength + left.length || 1);
    to.copyFrom(warp.position).subtractInPlace(position).subtractInPlace(world).subtractInPlace(left.move);
    world.addInPlace(to.scaleInPlace(share));
    return warp.yaw === null ? 0 : wrap(warp.yaw - (yaw + dyaw + left.turn)) * share;
  };

  return {
    /** Moves the root by the body's action this frame and takes that motion out of its pose. @param {number} dt */
    update(dt) {
      const { movement, body } = character, source = /** @type {any} */ (body.source);
      const action = source && source.clip && source.pose ? /** @type {Action} */ (source) : null;
      if (!action || movement.owner === 'place') {
        if (playing && movement.owner === 'action') movement.own('movement');
        playing = null;
        return;
      }
      if (playing?.action !== action || action.time < playing.last - 1e-6 && !playing.track.moves) start(action);
      const run = /** @type {NonNullable<typeof playing>} */ (playing), { clip } = action, { track, moves, top } = run.track;
      if (!moves || top < 0) { movement.follow(dt, movement.position, movement.facing); run.last = action.time; return; }
      // Through a loop's end: to the end, then from the start.
      at(clip, track, run.last, before);
      at(clip, track, action.time, now);
      if (action.time < run.last) {
        at(clip, track, clip.duration, end);
        for (let k = 0; k < 3; k++) before[k] -= end[k];
      }
      const da = now[0] - before[0], db = now[1] - before[1];
      let dyaw = now[2] - before[2];
      const facingYaw = Math.atan2(movement.facing.x, movement.facing.z);
      toWorld(da, db, facingYaw, world);
      if (run.warp) {
        dyaw += bend(clip, track, action.time, run.warp, facingYaw, dyaw, Math.hypot(da, db));
        if (action.time >= run.warp.until) run.warp = null;
      }
      run.last = action.time;
      const yaw = facingYaw + dyaw;
      movement.follow(dt, movement.position.add(world), facing.set(Math.sin(yaw), 0, Math.cos(yaw)));
      // The motion taken out of the pose: the top bone back over its first frame, unturned.
      const o = top * STRIDE, pose = action.pose;
      v.set(pose[o], pose[o + 1], pose[o + 2]).subtractInPlace(across.scale(now[0])).subtractInPlace(ahead.scale(now[1]));
      pose[o] = v.x; pose[o + 1] = v.y; pose[o + 2] = v.z;
      Quaternion.RotationAxisToRef(up, -now[2], turn);
      own.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
      turn.multiplyToRef(own, own);
      pose[o + 3] = own.x; pose[o + 4] = own.y; pose[o + 5] = own.z; pose[o + 6] = own.w;
    },
  };
}

const wrap = (/** @type {number} */ a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
