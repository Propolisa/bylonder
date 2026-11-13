// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Locomotion, the source that plays a character's movement (the guide's Sources): its gaits blend by the movement's
// speed on one shared cycle, each action timed from its left foot's contact so their feet agree, played at the rate
// that keeps a planted foot still (stride matching); a stop finishes its step where the movement comes to rest
// (distance matching); a jump plays from its takeoff, a fall holds its last airborne pose, a landing plays from its
// touchdown. Stances are other maps of actions, blended in.
import { Vector3 } from '@babylonjs/core';
import { defineSource } from './api.js';
import { contactAt, flight } from './contacts.js';
import { damp } from './effects/space.js';

const GAITS = /** @type {const} */ (['walk', 'run', 'sprint']);
const AIR_BLEND = 0.06, LAND_BLEND = 0.12, STANCE_BLEND = 0.15, MIN_RATE = 0.6, MAX_RATE = 1.6;
// A stop hurries its last step to end on the spot, but never past STOP_RATE of the gait's own step rate.
const STOP_RATE = 1.1;
// Turning in place, a foot steps once the body has turned TWIST from it, and feet step in turn until each is within
// SETTLED, at the walk's own step rate however fast the turn. Below STEPPING of the moving gaits' weight (stopping, or
// a pivot) the feet are standing.
const TWIST = (30 * Math.PI) / 180, SETTLED = (8 * Math.PI) / 180, STEPPING = 0.5;

/**
 * @typedef {import('./api.js').Gaits} Gaits
 * @typedef {{ name: string, duration: number, speed: number, start: number, contacts: import('./contacts.js').Contacts,
 *   flight: [number, number] | null, stances: number[], swings: number[] }} Gait an action as locomotion plays it; `start` the left foot's first contact (s)
 * @typedef {{ idle: Gait, moving: Gait[], jump: Gait | null, fall: Gait | null, land: Gait | null }} Set
 */

/** An action as a gait, or null when it is a default name the rig lacks. */
function gait(/** @type {any} */ character, /** @type {string | undefined} */ name, /** @type {boolean} */ required) {
  if (!name) return null;
  /** @type {{ duration: number, contacts: import('./contacts.js').Contacts }} */
  let action;
  try { action = character.action(name); } catch (error) { if (required) throw error; return null; }
  const { duration, contacts } = action, first = contacts.down[0]?.indexOf(1) ?? -1;
  const start = Math.max(first, 0) / contacts.fps;
  return { name, duration, speed: contacts.speed, contacts, start, flight: flight(contacts), stances: midStances(contacts, start, duration),
    swings: contacts.down.map((leg) => midSwing(leg, contacts.fps)) };
}

/** The gaits of a map of actions, `given` naming those the user set (which must exist). @returns {Set} */
function gaitSet(/** @type {any} */ character, /** @type {Gaits} */ actions, /** @type {Gaits} */ given) {
  const get = (/** @type {keyof Gaits} */ key) => gait(character, actions[key], key === 'idle' || key in given);
  const idle = /** @type {Gait} */ (get('idle'));
  const moving = GAITS.map(get).filter((g) => g && g.speed > 0.05).sort((a, b) => /** @type {Gait} */ (a).speed - /** @type {Gait} */ (b).speed);
  return { idle, moving: /** @type {Gait[]} */ (moving), jump: get('jump'), fall: get('fall'), land: get('land') };
}

/**
 * Weights of idle and the moving gaits at `speed`, linear between neighbours, into `out` (idle first).
 * @param {Set} set @param {number} speed @param {Float32Array} out
 */
function gaitWeights(set, speed, out) {
  out.fill(0);
  const { moving } = set;
  if (!moving.length || speed <= 0) { out[0] = 1; return; }
  let below = 0, belowSpeed = 0;
  for (let i = 0; i < moving.length; i++) {
    if (speed <= moving[i].speed) {
      const t = (speed - belowSpeed) / (moving[i].speed - belowSpeed);
      out[below] = 1 - t;
      out[i + 1] = t;
      return;
    }
    below = i + 1;
    belowSpeed = moving[i].speed;
  }
  out[moving.length] = 1;
}

/**
 * The phases of `g`'s cycle where a foot is halfway through a contact, under the body, ascending: where a walk starts
 * from standing and a stop ends, so the planted foot is where standing has it.
 * @param {import('./contacts.js').Contacts} contacts @param {number} start @param {number} duration
 */
function midStances({ down, fps }, start, duration) {
  const out = [];
  for (const leg of down) {
    const frames = leg.length;
    for (let f = 0; f < frames; f++) {
      if (!leg[f] || leg[(f - 1 + frames) % frames]) continue;
      let length = 0;
      while (length < frames && leg[(f + length) % frames]) length++;
      out.push(((((f + length / 2) / fps - start) / duration) % 1 + 1) % 1);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * When a leg is halfway through its swing (s): its foot lifted under the body, the other foot down under it too.
 * @param {Uint8Array} leg @param {number} fps
 */
function midSwing(leg, fps) {
  const frames = leg.length, lift = leg.findIndex((down, f) => !down && !!leg[(f - 1 + frames) % frames]);
  if (lift < 0) return 0;
  let length = 0;
  while (length < frames && !leg[(lift + length) % frames]) length++;
  return (((lift + length / 2) % frames) / fps);
}

/**
 * Where a walk starts from standing: on with a turning step's swing, or with the foot that stepped last planted and
 * the other swinging, so steps keep taking turns.
 * @param {any} state @param {Gait} walk
 */
function startPhase(state, walk) {
  const legs = walk.swings.length;
  if (!legs) return walk.stances[0] ?? 0;
  const time = state.stepLeg >= 0 ? walk.swings[state.stepLeg] + ((state.stepDone - 0.5) * walk.duration) / legs : walk.swings[(state.lastLeg + 1) % legs];
  return ((((time - walk.start) / walk.duration) % 1) + 1) % 1;
}

/** The next of `phases` at or after `phase`, past 1 when it wraps. @param {number[]} phases @param {number} phase */
function nextOf(phases, phase) {
  for (const at of phases) if (at >= phase - 1e-6) return at;
  return phases.length ? phases[0] + 1 : phase;
}

export const locomotion = defineSource({
  name: 'locomotion',
  options: /** @type {Gaits} */ ({ idle: 'Idle', walk: 'Walk', run: 'Run', sprint: 'Sprint', turn: 'Turn', jump: 'Jump', fall: 'Fall', land: 'Land' }),
  init(/** @type {any} */ character) {
    const state = {
      /** Its actions by gait; set before playing or between plays. @type {Gaits} */ actions: {},
      /** Other maps of actions by name, each over `actions`. @type {Record<string, Gaits>} */ stances: {},
      /** The stance it plays: 'stand' or a name of `stances`. */ stance: 'stand',
      /** Top speeds of its walk and run (m/s), which the default input and steering move at. */ speeds: { walk: 1.4, run: 3.5 },
      /** @type {Map<string, Set>} */ sets: new Map(), from: 'stand', to: 'stand', blend: Float32Array.of(1, 0),
      /** The moving gaits' place on their shared cycle, and their rate (1: their own). */ phase: 0, rate: 0, idleTime: 0, moving: 0, air: new Float32Array(2), /** @type {'ground' | 'jump' | 'fall' | 'land'} */ mode: 'ground',
      airTime: 0, weights: new Float32Array(GAITS.length + 1), fromWeights: new Float32Array(GAITS.length + 1),
      predicted: { position: new Vector3(), facing: new Vector3() }, character,
      /** How much each leg (of roles.legs) is down in what it plays now, 0 to 1. */ downs: new Float32Array(8),
      /** Turning in place: the yaw each foot was set down at, the leg stepping (-1 none), how far through, and the leg that stepped last. */
      feetYaw: new Float32Array(8), stepLeg: -1, stepDone: 0, lastLeg: -1, lastYaw: NaN, stepped: false,
      contact: (/** @type {number} */ leg) => state.downs[leg] ?? 0,
      /** @type {import('./api.js').Sample | null} */ sample: null, options: { time: 0 },
      /** @type {{ gait: Gait | null, time: number }} */ airPose: { gait: null, time: 0 },
      /** What played in the air last, held while it gives way. @type {{ gait: Gait | null, time: number }} */ held: { gait: null, time: 0 },
    };
    return state;
  },
  update(dt, { character, sample, options }, state) {
    state.downs.fill(0);
    state.sample = sample;
    const stand = gaitsOf(state, options, 'stand'), current = gaitsOf(state, options, state.stance);
    if (state.stance !== state.to) { state.from = state.to; state.to = state.stance; state.blend.fill(0); }
    const blend = damp(state.blend, 0, 1, STANCE_BLEND, dt);
    const previous = blend < 0.999 ? gaitsOf(state, options, state.from) : null;

    const movement = character.movement, v = movement.velocity, speed = Math.sqrt(v.x * v.x + v.z * v.z);
    // Air: a jump from its takeoff, a fall held on the jump's last airborne pose, a landing from its touchdown.
    const wasAir = state.mode === 'jump' || state.mode === 'fall';
    if (!movement.grounded && !wasAir) { state.mode = v.y > 0.5 ? 'jump' : 'fall'; state.airTime = 0; }
    else if (movement.grounded && wasAir) { state.mode = 'land'; state.airTime = 0; }
    state.airTime += dt;
    const air = airPose(state, current.jump ?? stand.jump, current.fall ?? stand.fall, current.land ?? stand.land);
    if (state.mode === 'land' && !air) state.mode = 'ground';
    // A landing gives way to the gaits as the character moves on, and when it ends, over LAND_BLEND: never a snap.
    const landing = state.mode === 'land', walking = current.moving[0]?.speed ?? stand.moving[0]?.speed ?? 1;
    const want = !air ? 0 : landing ? Math.max(0, 1 - speed / walking) : 1;
    const inAir = damp(state.air, 0, want, landing || !air ? LAND_BLEND : AIR_BLEND, dt);
    if (air) { state.held.gait = air.gait; state.held.time = air.time; }
    if (state.held.gait && inAir > 1e-3) play(state, state.held.gait, inAir, state.held.time);
    else state.held.gait = null;

    // The ground: gaits by speed, on one cycle, at the rate that keeps a planted foot still.
    const ground = 1 - (state.held.gait ? inAir : 0);
    gaitWeights(current, speed, state.weights);
    if (previous) gaitWeights(previous, speed, state.fromWeights);
    const lead = current.moving[0] ? current : stand;
    let cycle = 0, natural = 0, total = 0;
    for (let i = 0; i < lead.moving.length; i++) {
      const w = state.weights[i + 1], g = lead.moving[i];
      cycle += w * g.duration; natural += w * g.speed; total += w;
    }
    if (total > 1e-3) {
      cycle /= total;
      natural /= total;
      if (state.moving < 1e-3) state.phase = startPhase(state, lead.moving[0]);
      let rate = Math.min(MAX_RATE, Math.max(MIN_RATE, speed / natural));
      movement.predict(2, state.predicted);
      const toStop = Vector3.Distance(state.predicted.position, movement.position), step = speed * dt;
      // Stopping: end the step with a foot under the body on the spot where the movement comes to rest.
      if (toStop < speed * 0.8 && step > 1e-5) {
        const target = nextOf(lead.moving[0].stances, state.phase);
        rate = Math.min(STOP_RATE, ((target - state.phase) * cycle * Math.min(1, step / (toStop + step))) / dt);
      }
      state.phase = (state.phase + (dt * rate) / cycle) % 1;
      state.rate = rate;
    }
    if (total <= 1e-3) state.rate = 0;
    state.moving = total;
    state.idleTime += dt;
    const stepping = turnStep(state, movement, total, dt, lead.moving[0], ground);
    playGaits(state, current, state.weights, ground * (previous ? blend : 1) * (1 - stepping));
    if (previous) playGaits(state, previous, state.fromWeights, ground * (1 - blend));
  },
});

/**
 * Turning in place: once the body has turned TWIST from a foot, that foot steps (the walk's pose at its mid-swing, the
 * foot lifted under the body while the other stands, eased in and out over one of the walk's steps), then the other,
 * until both are within SETTLED; the standing foot pivots on its ball meanwhile. Gives the weight the step takes from
 * the gaits.
 * @param {any} state @param {import('./api.js').Movement} movement @param {number} moving the moving gaits' weight
 * @param {number} dt @param {Gait | undefined} walk @param {number} ground
 */
function turnStep(state, movement, moving, dt, walk, ground) {
  const yaw = Math.atan2(movement.facing.x, movement.facing.z), legs = walk ? walk.swings.length : 0;
  const turned = Number.isNaN(state.lastYaw) ? 0 : wrap(yaw - state.lastYaw), spin = Math.abs(turned) / Math.max(dt, 1e-6);
  state.lastYaw = yaw;
  // Walking on, the gaits step; slow enough (a stop, a pivot), the feet stay where they stand and step round.
  if (!walk || moving > STEPPING) {
    state.feetYaw.fill(yaw);
    state.stepLeg = -1;
    return 0;
  }
  // A fast turn steps sooner: by the twist it will have by the step's end, at the turn rate now or the one coming (an
  // eased turn starts slow).
  const length = walk.duration / legs;
  movement.predict(length, state.predicted);
  const rate = Math.max(spin, Math.abs(wrap(Math.atan2(state.predicted.facing.x, state.predicted.facing.z) - yaw)) / length);
  if (state.stepLeg < 0) {
    movement.predict(1, state.predicted);
    const settles = Math.atan2(state.predicted.facing.x, state.predicted.facing.z);
    // The foot furthest behind steps, the feet taking turns.
    let most = SETTLED;
    for (let leg = 0; leg < legs; leg++) {
      const twist = Math.abs(wrap(yaw - state.feetYaw[leg])), ahead = Math.min(twist + 2 * rate * length, Math.abs(wrap(settles - state.feetYaw[leg])));
      if (leg !== state.lastLeg && ahead > most && (ahead > TWIST || state.stepped)) { most = ahead; state.stepLeg = leg; }
    }
    if (state.stepLeg >= 0) state.lastLeg = state.stepLeg;
    state.stepped = state.stepLeg >= 0;
    state.stepDone = 0;
    if (state.stepLeg < 0) return 0;
  }
  // The standing foot pivots on its ball as the body turns over it.
  for (let leg = 0; leg < legs; leg++) if (leg !== state.stepLeg) state.feetYaw[leg] += turned;
  state.stepDone = Math.min(1, state.stepDone + dt / length);
  const weight = Math.sin(Math.PI * state.stepDone);
  play(state, walk, ground * weight, walk.swings[state.stepLeg]);
  if (state.stepDone >= 1) { state.feetYaw[state.stepLeg] = yaw; state.stepLeg = -1; }
  return weight;
}

const wrap = (/** @type {number} */ a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * The gaits of a stance (its map over `actions`, over the defaults), found the first time it plays; the standing ones
 * give the top speeds.
 * @param {any} state @param {Gaits} options @param {string} stance @returns {Set}
 */
function gaitsOf(state, options, stance) {
  let found = state.sets.get(stance);
  if (found) return found;
  const given = { ...state.actions, ...(stance === 'stand' ? {} : state.stances[stance]) };
  found = gaitSet(state.character, { ...options, ...given }, given);
  state.sets.set(stance, found);
  const walk = found.moving[0], run = found.moving[1] ?? walk;
  if (stance === 'stand' && walk) state.speeds = { walk: walk.speed, run: run.speed };
  return found;
}

/** Samples a gait at `time` and adds its contacts. @param {any} state @param {Gait} g @param {number} weight @param {number} time */
function play(state, g, weight, time) {
  state.options.time = time;
  state.sample(g.name, weight, state.options);
  for (let leg = 0; leg < g.contacts.down.length; leg++) state.downs[leg] += weight * contactAt(g.contacts, leg, time);
}

/** Idle on its own clock and the moving gaits on the shared cycle, by `weights`, times `share`. @param {any} state @param {Set} set @param {Float32Array} weights @param {number} share */
function playGaits(state, set, weights, share) {
  if (weights[0] > 0) play(state, set.idle, share * weights[0], state.idleTime % set.idle.duration);
  for (let i = 0; i < set.moving.length; i++) {
    const g = set.moving[i], w = weights[i + 1];
    if (w > 0) play(state, g, share * w, (g.start + state.phase * g.duration) % g.duration);
  }
}

/** `out` set to `gait` at `time`. @param {{ gait: Gait | null, time: number }} out @param {Gait} gait @param {number} time */
function pose(out, gait, time) {
  out.gait = gait;
  out.time = time;
  return out;
}

/**
 * What plays in the air or on landing, or null: a gait and its time, in `state.airPose`.
 * @param {any} state @param {Gait | null} jump @param {Gait | null} fall @param {Gait | null} land
 */
function airPose(state, jump, fall, land) {
  const t = state.airTime, out = state.airPose;
  if (state.mode === 'jump' && jump) {
    const up = jump.flight ? jump.flight[0] : 0, end = (jump.flight ? jump.flight[1] : jump.duration) - 1 / jump.contacts.fps;
    if (up + t < end || !fall) return pose(out, jump, Math.min(up + t, Math.max(up, end)));
  }
  if (state.mode === 'jump' || state.mode === 'fall') {
    if (fall) return pose(out, fall, t % fall.duration);
    if (jump) return pose(out, jump, Math.max(0, (jump.flight ? jump.flight[1] : jump.duration) - 1 / jump.contacts.fps));
    return null;
  }
  if (state.mode !== 'land') return null;
  const landing = land ?? (jump?.flight && jump.flight[1] < jump.duration - 1e-3 ? jump : null);
  if (!landing) return null;
  const from = landing === land ? 0 : /** @type {[number, number]} */ (/** @type {Gait} */ (jump).flight)[1];
  return from + t < landing.duration ? pose(out, landing, from + t) : null;
}
