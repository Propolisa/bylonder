// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// When each foot of an action is on the ground, found once per action: an `L` or `R` marker starts that foot's
// contact; without markers a foot is down where it is low and moves with the ground (still, or in an action made in
// place sliding back at the action's own speed). The same pass gives the action's ground speed, which locomotion
// matches its stride to.
import { STRIDE } from './pose.js';
import { createWorldPose } from './procedural.js';
import { playedBy } from './roles.js';

/**
 * @typedef {{ names: string[], parents: Int32Array, rest: Float32Array, boneIndex(name: string): number }} Skeleton
 * @typedef {{ down: Uint8Array[], speed: number, fps: number }} Contacts per leg, 1 on each frame its foot is down;
 *   `speed` the ground speed in m/s
 */

const LOW = 0.04, SLIDE = 0.25, HELD = 0.1, SHORTEST = 0.08;
const cache = new WeakMap();

/** The markers that start each leg's contacts, by its index in `roles.legs`. */
const SIDES = ['L', 'R'];

/**
 * An action's contacts for `legs` (the role `legs`: chains of bone names, root to foot).
 * @param {import('./clip.js').Clip} clip @param {Skeleton} skeleton @param {string[][]} legs
 * @returns {Contacts}
 */
export function footContacts(clip, skeleton, legs) {
  const key = legs.map((chain) => chain.at(-1)).join(), known = cache.get(clip);
  if (known?.key === key) return known.contacts;
  const contacts = findContacts(clip, skeleton, legs.map((chain) => chain.map((name) => skeleton.boneIndex(name))));
  cache.set(clip, { key, contacts });
  return contacts;
}

/**
 * An action's contacts: as the export found them from Blender's evaluation of the rig (the package's clip entry), else
 * found now from the action's own pose.
 * @param {{ clip: import('./clip.js').Clip, character: { blend: any, rig: Skeleton, roles: Record<string, any> } }} action
 * @returns {Contacts}
 */
export function contactsOf({ clip, character }) {
  const known = cache.get(clip);
  if (known) return known.contacts;
  const saved = character.blend?.ir?.scene?.time?.clips?.[clip.name]?.contacts;
  if (!saved) return footContacts(clip, character.rig, /** @type {string[][]} */ (character.roles.legs ?? []));
  const down = saved.legs.map((/** @type {{ down: [number, number][] }} */ leg) => {
    const flags = new Uint8Array(clip.frames);
    for (const [start, end] of leg.down) flags.fill(1, start, end);
    return flags;
  });
  const contacts = { down, fps: saved.fps, speed: saved.speed };
  cache.set(clip, { key: 'export', contacts });
  return contacts;
}

/** How much leg `leg` is down at `time` seconds, 0 to 1, between frames linearly. @param {Contacts} contacts */
export function contactAt(contacts, /** @type {number} */ leg, /** @type {number} */ time) {
  const down = contacts.down[leg], last = down.length - 1, at = Math.min(Math.max(time * contacts.fps, 0), last);
  const f = Math.floor(at), t = at - f;
  return down[f] + (down[Math.min(f + 1, last)] - down[f]) * t;
}

/** The longest span with no foot down, as [start, end] in seconds, or null: a jump's flight. @param {Contacts} contacts */
export function flight(contacts) {
  const frames = contacts.down[0].length;
  let best = null, start = -1;
  for (let f = 0; f <= frames; f++) {
    const air = f < frames && contacts.down.every((d) => !d[f]);
    if (air && start < 0) start = f;
    if (!air && start >= 0) {
      if (!best || f - start > best[1] - best[0]) best = [start, f];
      start = -1;
    }
  }
  return best && /** @type {[number, number]} */ ([best[0] / contacts.fps, best[1] / contacts.fps]);
}

/** @param {import('./clip.js').Clip} clip @param {Skeleton} skeleton @param {number[][]} legs bone chains, root to foot */
function findContacts(clip, skeleton, legs) {
  const roleFeet = legs.map((chain) => /** @type {number} */ (chain.at(-1))), feet = roleFeet.map((foot) => movedFoot(clip, skeleton, foot));
  // Each foot touches the ground at its ankle (flat or on the heel) or at its ball, where its toe bone starts.
  const balls = roleFeet.map((foot, k) => { const toe = skeleton.parents.indexOf(foot); return toe >= 0 ? movedFoot(clip, skeleton, toe) : feet[k]; });
  const tracks = footTracks(clip, skeleton, [...feet, ...balls, rootOf(skeleton)]), root = /** @type {number[][]} */ (tracks.pop());
  return contactsFromTracks({ ankles: tracks.slice(0, feet.length), balls: tracks.slice(feet.length), root, fps: clip.fps,
    legLength: restLegLength(skeleton, legs), markers: clip.markers });
}

/**
 * Contacts from the feet's paths in the world (Y up, metres), one point a frame: each leg's ankle and ball, and the
 * body's root; `legLength` scales what counts as low; `markers` (in seconds) start contacts where they are L or R.
 * The export runs it on Blender's evaluation of the deform feet, the page on its own pose where an action has none.
 * @param {{ ankles: number[][][], balls: number[][][], root: number[][], fps: number, legLength: number,
 *   markers?: { name: string, time: number }[] }} paths
 * @returns {Contacts}
 */
export function contactsFromTracks({ ankles, balls, root, fps, legLength, markers = [] }) {
  const n = root.length, duration = (n - 1) / fps;
  // The root's mean ground velocity: zero for an action made in place, the body's speed for one with root motion.
  const rootVelocity = n > 1 ? [(root[n - 1][0] - root[0][0]) / duration, (root[n - 1][2] - root[0][2]) / duration] : [0, 0];
  // A point's velocity at frame f, from its neighbours that are also low (`low`), so a short stance is not averaged
  // with the swing around it; a stance of one frame (a sprint's) from both neighbours.
  const velocity = (/** @type {number[][]} */ p, /** @type {boolean[]} */ low, /** @type {number} */ f) => {
    let from = f > 0 && low[f - 1] ? f - 1 : f, to = f < n - 1 && low[f + 1] ? f + 1 : f;
    if (from === to) { from = Math.max(f - 1, 0); to = Math.min(f + 1, n - 1); }
    if (from === to) return null;
    const a = p[from], b = p[to], span = (to - from) / fps;
    return [(b[0] - a[0]) / span, (b[2] - a[2]) / span];
  };
  const lowFrames = (/** @type {number[][]} */ points) => {
    const lowest = Math.min(...points.map((p) => p[1]));
    return points.map((p) => p[1] < lowest + LOW * legLength);
  };
  const stance = /** @type {number[][]} */ ([]);
  const down = ankles.map((ankle, leg) => {
    const ball = balls[leg], ankleLow = lowFrames(ankle), ballLow = lowFrames(ball);
    // Per frame, how the point it stands on moves (the ball when it is low), or null in the air.
    const moves = ankle.map((_, f) => (ballLow[f] ? velocity(ball, ballLow, f) : ankleLow[f] ? velocity(ankle, ankleLow, f) : null));
    // The ball's frames where it gets down (a heel strike rolls the ankle slower than the ground runs), else the ankle's.
    const ballDown = moves.some((v, f) => v && ballLow[f]);
    const standing = /** @type {number[][]} */ (moves.filter((v, f) => v !== null && (!ballDown || ballLow[f])));
    // The ground under the foot moves as the median of those: still, or sliding back in an action made in place.
    const ground = [median(standing.map((v) => v[0])), median(standing.map((v) => v[1]))], moving = Math.hypot(ground[0], ground[1]);
    // Down where the point it stands on moves with the ground; a marker's contact lasts while it does, so a toe-off
    // that pivots slower than the ground runs (the leg at full stretch) is let go.
    const off = (/** @type {number[] | null} */ v) => (v ? Math.hypot(v[0] - ground[0], v[1] - ground[1]) : Infinity);
    const found = dropBlips(Uint8Array.from(moves, (v) => (off(v) < SLIDE + 0.2 * moving ? 1 : 0)), fps);
    const withGround = moves.map((v) => off(v) < HELD + 0.25 * moving);
    const flags = (SIDES[leg] && fromMarkers(markers, fps, SIDES[leg], moves.map((v) => v !== null), withGround)) || found;
    // The ground's speed from the ball's frames where it is down, else the ankle's: a heel strike rolls the ankle
    // slower than the ground runs.
    const onBall = moves.some((v, f) => v && flags[f] && ballLow[f]);
    const planted = /** @type {number[][]} */ (moves.filter((v, f) => v && flags[f] && (!onBall || ballLow[f])));
    stance.push([median(planted.map((v) => v[0])), median(planted.map((v) => v[1]))]);
    return flags;
  });
  const slide = [median(stance.map((v) => v[0])), median(stance.map((v) => v[1]))];
  return { down, fps, speed: Math.hypot(rootVelocity[0] - slide[0], rootVelocity[1] - slide[1]) };
}

/** Contacts shorter than SHORTEST (a toe pivoting as it lifts) left out, across the loop's end. */
function dropBlips(/** @type {Uint8Array} */ down, /** @type {number} */ fps) {
  const n = down.length, up = down.indexOf(0), shortest = Math.ceil(SHORTEST * fps);
  if (up < 0) return down;
  for (let k = 0; k < n;) {
    const f = (up + k) % n;
    if (!down[f]) { k++; continue; }
    let length = 0;
    while (length < n && down[(f + length) % n]) length++;
    if (length < shortest) for (let j = 0; j < length; j++) down[(f + j) % n] = 0;
    k += length;
  }
  return down;
}

/**
 * Contacts from a side's markers: each is a touchdown, down while the foot stays low, less its tail once the point it
 * stands on no longer moves with the ground (`withGround`): a toe-off pivoting slower than the ground runs, the leg at
 * full stretch.
 */
function fromMarkers(/** @type {{ name: string, time: number }[]} */ markers, /** @type {number} */ fps, /** @type {string} */ side, /** @type {boolean[]} */ low, /** @type {boolean[]} */ withGround) {
  const starts = markers.filter((m) => m.name === side), n = low.length;
  if (!starts.length) return null;
  const down = new Uint8Array(n);
  for (const { time } of starts) {
    const first = Math.round(time * fps);
    let last = first;
    while (last + 1 < first + n && low[(last + 1) % n] && !down[(last + 1) % n]) last++;
    while (last > first && !withGround[last % n]) last--;
    for (let f = first; f <= last; f++) down[f % n] = 1;
  }
  return down;
}

/**
 * The foot bone an action moves: the role's own, or the control or deform bone of its name the action plays it by
 * (CloudRig's FK-Foot.L under Foot.L, which only the rig's constraints move), the one whose path in it is longest.
 */
function movedFoot(/** @type {import('./clip.js').Clip} */ clip, /** @type {Skeleton} */ skeleton, /** @type {number} */ foot) {
  const candidates = playedBy(skeleton.names[foot], (name) => skeleton.boneIndex(name) >= 0).map((name) => skeleton.boneIndex(name));
  if (candidates.length < 2) return foot;
  const tracks = footTracks(clip, skeleton, candidates);
  const travel = (/** @type {number[][]} */ points) => points.reduce((sum, p, f) => (f ? sum + Math.hypot(p[0] - points[f - 1][0], p[1] - points[f - 1][1], p[2] - points[f - 1][2]) : 0), 0);
  const lengths = tracks.map(travel);
  return candidates[lengths.indexOf(Math.max(...lengths))];
}

/**
 * The rig's space turned and scaled as its armature is in the world (Blender's Z up made Babylon's Y up), placed at
 * the origin, so heights are heights and speeds are metres per second.
 */
function rigSpace(/** @type {Skeleton} */ skeleton) {
  const world = createWorldPose(skeleton), rig = /** @type {any} */ (skeleton);
  if (rig.rootWorld) {
    rig.rootWorld(world.root);
    world.root.position = [0, 0, 0];
  }
  return world;
}

/** World positions of `bones` at each frame of `clip`, solved by the rig's runtime where it offers it. */
function footTracks(/** @type {import('./clip.js').Clip} */ clip, /** @type {Skeleton} */ skeleton, /** @type {number[]} */ bones) {
  const world = rigSpace(skeleton), pose = Float32Array.from(skeleton.rest), size = clip.bones.length * STRIDE;
  const solveAt = /** @type {any} */ (skeleton).solveAt, { rotation, scale } = world.root;
  const tracks = bones.map(() => /** @type {number[][]} */ ([]));
  for (let f = 0; f < clip.frames; f++) {
    pose.set(skeleton.rest);
    for (let j = 0; j < clip.bones.length; j++) pose.set(clip.data.subarray(f * size + j * STRIDE, f * size + (j + 1) * STRIDE), clip.bones[j] * STRIDE);
    if (solveAt) {
      const solved = solveAt(pose, clip.bones);
      bones.forEach((bone, k) => { const m = solved(skeleton.names[bone]).m; tracks[k].push(turned(rotation, m[12] * scale, m[13] * scale, m[14] * scale)); });
      continue;
    }
    world.update(pose);
    bones.forEach((bone, k) => tracks[k].push(Array.from(world.position.subarray(bone * 3, bone * 3 + 3))));
  }
  return tracks;
}

/** (x, y, z) turned by quaternion `q`. */
function turned(/** @type {number[]} */ q, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) {
  const [qx, qy, qz, qw] = q, tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}

const rootOf = (/** @type {Skeleton} */ skeleton) => Math.max(0, skeleton.parents.indexOf(-1));
const median = (/** @type {number[]} */ values) => {
  const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
  return !s.length ? 0 : s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** A leg's length at rest, from the head of its chain's first bone to its foot: the scale the thresholds go by. */
function restLegLength(/** @type {Skeleton} */ skeleton, /** @type {number[][]} */ legs) {
  const world = rigSpace(skeleton);
  world.update(skeleton.rest);
  const at = (/** @type {number} */ i) => world.position.subarray(i * 3, i * 3 + 3);
  return Math.max(...legs.map((chain) => { const a = at(chain[0]), b = at(/** @type {number} */ (chain.at(-1))); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }), 1e-3);
}
