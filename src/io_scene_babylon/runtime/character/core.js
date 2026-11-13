// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The character animation system's core (docs/character-animation.md): a character from an armature of the scene,
// its layers, and the action and mix sources, run each frame in the guide's order. Each source has one clock, however
// many layers play it; each layer switch is dead blending (Holden, "Dead Blending", 2023): the pose shown last runs on
// by its velocity, decaying, while the new source blends in, so pose and velocity stay continuous.
import { Matrix, Observable, SkeletonViewer, TransformNode, Vector3 } from '@babylonjs/core';
import { babylonRig, rigClips, skeletonOf, skinnedBy } from './rig.js';
import { sampleClip, markersPassed } from './clip.js';
import { STRIDE, blendPoses, blendBone, addPose, deltaPose, accumulatePose, clearPose, finishPose } from './pose.js';
import { findRoles, playedBy } from './roles.js';
import { createMovement, restFront, steer, walkTo, place, turnTo } from './movement.js';
import { defaultInput } from './input.js';
import { contactsOf, contactAt } from './contacts.js';
import { locomotion } from './locomotion.js';
import { createPoseApi } from './pose-api.js';
import { createVoice } from './sound.js';
import { createRootMotion } from './rootmotion.js';
import { mirrorPose } from './mirror.js';
import { breathe, eyes } from './effects/index.js';
import { boneCollections } from './collections.js';
import { createSchedule, createTierPicker } from './quality.js';

/** @typedef {import('./api.js').Intent} Intent @typedef {import('./api.js').ActionOptions} ActionOptions */
/** @typedef {import('./api.js').PlayOptions} PlayOptions @typedef {import('./api.js').Done} Done */
/** @typedef {import('./clip.js').Clip} Clip */

const BLEND = 0.3;
// Dead blending's velocity half-life, as a share of the blend time.
const DECAY = 0.25;

/** A pseudo-random sequence from a seed (mulberry32): idle life and glances repeat for the same seed. @param {number} seed */
export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An action of the character as a source: its clip on its own clock. */
export class Action {
  /** @param {Character} character @param {Clip} clip @param {ActionOptions} options */
  constructor(character, clip, options) {
    this.name = clip.name;
    this.clip = clip;
    this.options = options;
    this.character = character;
    this.time = 0;
    this.paused = false;
    this.ended = false;
    /** Seconds held on the last pose between loops (`loop`). */
    this.held = 0;
    /** The frame this clock last advanced, so several layers advance it once. */
    this.frame = -1;
    this.pose = new Float32Array(character.rig.names.length * STRIDE);
    this.written = new Uint8Array(character.rig.names.length);
    for (const bone of clip.bones) this.written[bone] = 1;
    /** @type {(() => void)[]} */
    this.endWaiters = [];
    /** Its sound (sound.js): the clock it follows while the sound plays. */
    this.voice = options.sound ? character.voiceOf(clip.name, options.sound, options.spatial ?? true) : null;
  }

  /** Its length in seconds. */
  get duration() { return this.clip.duration; }
  /** Its markers, in seconds from its start. */
  get markers() { return this.clip.markers; }
  /** When each leg (of the role `legs`) is down (contacts.js). */
  get contacts() { return contactsOf(this); }

  pause() { this.paused = true; this.voice?.pause(); }
  resume() { this.paused = false; }
  /** @param {number} seconds */
  seek(seconds) {
    this.time = Math.max(0, Math.min(seconds, this.clip.duration));
    this.ended = false;
    this.held = 0;
    this.voice?.pause();
  }

  /** Advances the clock once a frame, telling its markers and its end. @param {number} dt @param {number} frame */
  update(dt, frame) {
    if (this.frame === frame) return;
    this.frame = frame;
    const voice = this.voice;
    voice?.follow();
    // Waiting for its sound: the first frame holds until the sound can start.
    const waiting = !!voice && !!this.options.waitForSound && !voice.ready && !voice.failed;
    if (!this.paused && !this.ended && !waiting) {
      const from = this.time, duration = this.clip.duration;
      let to = from + dt;
      // While its sound plays, the sound is the clock; it joins in step once allowed.
      if (voice?.ready) {
        const heard = voice.time();
        if (heard === null) voice.play(from);
        else to = heard;
      }
      if (to >= duration) {
        this.voice?.pause();
        if (this.options.once) {
          to = duration;
          this.ended = true;
        } else if ((this.held += to - duration) >= (this.options.loop ?? 0)) {
          to = this.held - (this.options.loop ?? 0);
          this.held = 0;
          this.character.onEnd(this);
        } else to = duration;
      }
      markersPassed(this.clip, from, to, (marker) => this.character.marker(this, marker.name));
      this.time = to;
      if (this.ended) {
        this.character.onEnd(this);
        for (const done of this.endWaiters.splice(0)) done();
      }
    }
    sampleClip(this.clip, this.time, this.pose);
  }
}

/** Actions placed on a value; setting `value` eases there over the blend time. */
export class Mix {
  /** @param {Character} character @param {Record<string, number>} points */
  constructor(character, points) {
    this.name = Object.keys(points).join('+');
    this.character = character;
    this.points = Object.entries(points).map(([name, at]) => ({ action: character.action(name), at })).sort((a, b) => a.at - b.at);
    this.target = this.points[0].at;
    this.current = this.target;
    this.frame = -1;
    this.pose = new Float32Array(character.rig.names.length * STRIDE);
    this.written = new Uint8Array(character.rig.names.length);
    for (const { action } of this.points) action.written.forEach((w, i) => { if (w) this.written[i] = 1; });
  }

  get value() { return this.current; }
  set value(value) { this.target = value; }

  /** @param {number} dt @param {number} frame */
  update(dt, frame) {
    if (this.frame === frame) return;
    this.frame = frame;
    this.current += (this.target - this.current) * (1 - Math.exp(-dt / (BLEND / 3)));
    const { points } = this, v = Math.max(points[0].at, Math.min(points.at(-1)?.at ?? 0, this.current));
    let k = 0;
    while (k < points.length - 2 && points[k + 1].at < v) k++;
    const a = points[k], b = points[Math.min(k + 1, points.length - 1)], w = b.at > a.at ? (v - a.at) / (b.at - a.at) : 0;
    a.action.update(dt, frame);
    if (b !== a) b.action.update(dt, frame);
    blendPoses(this.pose, a.action.pose, b.action.pose, w);
  }
}

/** A source of defineSource on a character: its update blends actions into its pose with `sample`. */
export class Custom {
  /** @param {Character} character @param {import('./api.js').Source} source */
  constructor(character, source) {
    const count = character.rig.names.length;
    this.name = source.name;
    this.source = source;
    this.character = character;
    /** @type {any} */
    this.state = source.init?.(character, character.boneRoles(), source.options);
    // The source's state's fields are the source's (locomotion's actions, stances, stance, speeds).
    for (const key of Object.keys(this.state ?? {})) {
      if (!(key in this)) Object.defineProperty(this, key, { get: () => this.state[key], set: (value) => { this.state[key] = value; }, enumerable: true });
    }
    this.time = 0;
    this.frame = -1;
    this.pose = new Float32Array(count * STRIDE);
    this.written = new Uint8Array(count);
    this.scratch = new Float32Array(count * STRIDE);
    /** @type {((pose: Float32Array) => void) | null} */
    this.mirror = null;
    /** Each action's phase in this source, in seconds. @type {Map<string, number>} */
    this.phases = new Map();
    this.dt = 0;
    /** @type {import('./api.js').Sample} */
    this.sample = (name, weight, { rate = 1, time, mirror = false } = {}) => {
      const clip = clipOf(this.character, name);
      let phase = time ?? (this.phases.get(name) ?? 0) + this.dt * rate;
      if (time === undefined && clip.duration > 0) phase %= clip.duration;
      this.phases.set(name, phase);
      if (weight <= 0) return;
      this.scratch.set(this.character.rig.rest);
      sampleClip(clip, phase, this.scratch);
      if (mirror) (this.mirror ??= mirrorPose(this.character.rig))(this.scratch);
      for (const bone of clip.bones) this.written[bone] = 1;
      accumulatePose(this.pose, this.scratch, weight);
    };
  }

  /** @param {number} dt @param {number} frame */
  update(dt, frame) {
    if (this.frame === frame) return;
    this.frame = frame;
    this.dt = dt;
    this.time += dt;
    clearPose(this.pose);
    this.source.update(dt, { character: this.character, sample: this.sample, time: this.time, options: this.source.options }, this.state);
    finishPose(this.pose);
  }

  dispose() { this.source.dispose?.(this.state); }
}

/** An action's clip by name, throwing with the names there are. @param {Character} character @param {string} name */
function clipOf(character, name) {
  const clip = character.clips.get(name);
  if (!clip) throw new Error(`No action "${name}" on ${character.armature}: it has ${[...character.clips.keys()].map((n) => `"${n}"`).join(', ') || 'none'}`);
  return clip;
}

/** A layer: a mask, a weight and a mode, playing one source at a time. */
export class Layer {
  /**
   * @param {Character} character @param {string} name
   * @param {{ group?: string, roles?: string[], bones?: string[], weight?: number, add?: boolean | { from: 'rest' | string } }} options
   */
  constructor(character, name, options) {
    const count = character.rig.names.length;
    this.name = name;
    this.character = character;
    this.mask = character.mask(options);
    this.add = options.add ?? false;
    this.weightNow = options.weight ?? 1;
    /** @type {{ to: number, rate: number } | null} */
    this.fading = null;
    /** @type {Action | Mix | Custom | null} */
    this.source = null;
    /** @type {((done: Done) => void) | null} */
    this.settle = null;
    this.onEnd = new Observable();
    this.out = new Float32Array(count * STRIDE);
    this.last = new Float32Array(count * STRIDE);
    this.beforeLast = new Float32Array(count * STRIDE);
    this.reference = new Float32Array(count * STRIDE);
    this.delta = new Float32Array(count * STRIDE);
    // Dead blending: the pose shown last, run on by its velocity.
    this.from = new Float32Array(count * STRIDE);
    this.velocity = new Float32Array(count * 6);
    this.blendTime = 0;
    this.blendElapsed = Infinity;
    this.stopping = false;
  }

  get weight() { return this.weightNow; }
  set weight(weight) { this.weightNow = weight; this.fading = null; }

  /** @param {number} weight @param {number} seconds */
  fade(weight, seconds) {
    if (seconds <= 0) this.weight = weight;
    else this.fading = { to: weight, rate: Math.abs(weight - this.weightNow) / seconds };
    return this;
  }

  /** @param {string | Action | Mix | import('./api.js').Source} source @param {PlayOptions} [options] */
  play(source, options = {}) {
    const { blend = BLEND, with: other, warpTo, ...actionOptions } = options;
    const next = typeof source === 'string' ? this.character.action(source, actionOptions)
      : source instanceof Action || source instanceof Mix || source instanceof Custom ? source : this.character.custom(/** @type {import('./api.js').Source} */ (source));
    /** @type {Promise<Done>} */
    let done;
    if (next === this.source) done = new Promise((settle) => { this.settle = settle; });
    else {
      this.settle?.({ interrupted: true });
      if (this.source) this.startBlend(blend);
      if (next instanceof Action) {
        const shared = /** @type {Layer | undefined} */ (/** @type {unknown} */ (other))?.source;
        if (shared instanceof Action && shared.clip === next.clip) next.time = shared.time;
        else if (!this.character.playing(next)) next.seek(0);
      }
      this.source = next;
      // The body's source owns the root from this frame on: an action, or the movement again.
      const { movement } = this.character;
      if (this === this.character.body && movement.owner !== 'place') movement.own(next instanceof Action ? 'action' : 'movement');
      /** Where the body's action lands its marker (rootmotion.js). */
      this.warpTo = warpTo;
      this.stopping = false;
      done = new Promise((settle) => { this.settle = settle; });
      if (next instanceof Action && next.options.once) next.endWaiters.push(() => { if (this.source === next) this.finish({ ended: true }); });
      if (this.add) this.setReference(next);
    }
    return Object.assign(/** @type {Layer} */ (this), { done });
  }

  /** @param {{ blend?: number }} [options] */
  stop({ blend = BLEND } = {}) {
    this.fade(0, blend);
    this.stopping = true;
  }

  /** @param {Done} result */
  finish(result) {
    const settle = this.settle;
    this.settle = null;
    settle?.(result);
  }

  /** The additive reference: the source's first frame, the rest pose, or another action's first frame. @param {Action | Mix | Custom} source */
  setReference(source) {
    const from = typeof this.add === 'object' ? this.add.from : null;
    this.reference.set(this.character.rig.rest);
    const clip = from && from !== 'rest' ? clipOf(this.character, from) : source instanceof Action ? source.clip : source instanceof Mix ? source.points[0].action.clip : null;
    if (clip && from !== 'rest') sampleClip(clip, 0, this.reference);
  }

  /** Dead blending from the pose shown last, by its velocity. @param {number} blend */
  startBlend(blend) {
    this.from.set(this.last);
    const dt = this.character.dt || 1 / 60, v = this.velocity, a = this.last, b = this.beforeLast;
    for (let i = 0, n = this.mask.length; i < n; i++) {
      const o = i * STRIDE, k = i * 6;
      for (let c = 0; c < 3; c++) v[k + c] = (a[o + c] - b[o + c]) / dt;
      // Angular velocity: the rotation from the frame before to the last, as an axis times angle per second.
      const qw = a[o + 6] * b[o + 6] + a[o + 3] * b[o + 3] + a[o + 4] * b[o + 4] + a[o + 5] * b[o + 5];
      const s = qw < 0 ? -1 : 1;
      const x = s * (b[o + 6] * a[o + 3] - b[o + 3] * a[o + 6] - b[o + 4] * a[o + 5] + b[o + 5] * a[o + 4]);
      const y = s * (b[o + 6] * a[o + 4] + b[o + 3] * a[o + 5] - b[o + 4] * a[o + 6] - b[o + 5] * a[o + 3]);
      const z = s * (b[o + 6] * a[o + 5] - b[o + 3] * a[o + 4] + b[o + 4] * a[o + 3] - b[o + 5] * a[o + 6]);
      const sin = Math.sqrt(x * x + y * y + z * z), angle = 2 * Math.atan2(sin, Math.abs(qw)), f = sin > 1e-9 ? angle / sin / dt : 0;
      v[k + 3] = x * f; v[k + 4] = y * f; v[k + 5] = z * f;
    }
    this.blendTime = blend;
    this.blendElapsed = blend > 0 ? 0 : Infinity;
  }

  /** Runs the from-pose on by its decaying velocity, and blends `out` from it. @param {number} dt */
  applyBlend(dt) {
    if (this.blendElapsed >= this.blendTime) return;
    this.blendElapsed += dt;
    const decay = Math.exp((-dt * Math.LN2) / (DECAY * this.blendTime)), t = Math.min(1, this.blendElapsed / this.blendTime);
    const w = t * t * (3 - 2 * t), f = this.from, v = this.velocity;
    for (let i = 0, n = this.mask.length; i < n; i++) {
      if (!this.mask[i]) continue;
      const o = i * STRIDE, k = i * 6;
      for (let c = 0; c < 3; c++) { f[o + c] += v[k + c] * dt; v[k + c] *= decay; }
      const ax = v[k + 3] * dt, ay = v[k + 4] * dt, az = v[k + 5] * dt, angle = Math.sqrt(ax * ax + ay * ay + az * az);
      if (angle > 1e-9) {
        const s = Math.sin(angle / 2) / angle, qx = ax * s, qy = ay * s, qz = az * s, qw = Math.cos(angle / 2);
        const x = f[o + 3], y = f[o + 4], z = f[o + 5], ww = f[o + 6];
        f[o + 3] = qw * x + qx * ww + qy * z - qz * y;
        f[o + 4] = qw * y - qx * z + qy * ww + qz * x;
        f[o + 5] = qw * z + qx * y - qy * x + qz * ww;
        f[o + 6] = qw * ww - qx * x - qy * y - qz * z;
      }
      for (let c = 3; c < 6; c++) v[k + c] *= decay;
      blendBone(this.out, f, this.out, i, w);
    }
  }

  /** This layer over `pose` (step 4). @param {Float32Array} pose @param {number} dt */
  apply(pose, dt) {
    if (this.fading) {
      const { to, rate } = this.fading, step = rate * dt;
      this.weightNow = Math.abs(to - this.weightNow) <= step ? to : this.weightNow + Math.sign(to - this.weightNow) * step;
      if (this.weightNow === to) this.fading = null;
    }
    if (this.stopping && this.weightNow === 0 && !this.fading) {
      this.finish({ interrupted: true });
      this.source = null;
      this.stopping = false;
    }
    const source = this.source;
    if (!source || this.weightNow <= 0) return;
    const out = this.out;
    if (this.add) {
      deltaPose(this.delta, source.pose, this.reference);
      for (let i = 0, n = this.mask.length; i < n; i++) if (!source.written[i]) this.delta.set(IDENTITY, i * STRIDE);
      addPose(pose, this.delta, this.weightNow, this.mask);
      return;
    }
    out.set(pose);
    for (let i = 0, n = this.mask.length; i < n; i++) {
      if (this.mask[i] && source.written[i]) for (let k = i * STRIDE, end = k + STRIDE; k < end; k++) out[k] = source.pose[k];
    }
    this.applyBlend(dt);
    this.beforeLast.set(this.last);
    this.last.set(out);
    blendPoses(pose, pose, out, this.weightNow, this.mask);
  }
}

const IDENTITY = Float32Array.of(0, 0, 0, 0, 0, 0, 1, 1, 1, 1);
/** No intent: standing still. */
const STILL = Object.freeze({ move: Vector3.Zero() });

// The order the frame runs effects in at each step: those named here first, as listed, then the rest in the order added.
const ORDER = {
  controls: ['impact', 'warp', 'reach', 'feet', 'lean', 'gaze', 'eyes'],
  deform: ['springs'],
};

/**
 * A character from an armature of the scene, by name: its names (actions, markers, bone collections, roles, keyed
 * properties) are the package's for that armature (names.d.ts).
 * @template {import('./names.js').ArmatureName} [N=string]
 */
export class Character {
  /** @type {'auto' | import('./api.js').Tier} */ static quality = 'auto';
  /** @type {import('./api.js').Tier} */ static tier = 'A';
  static #pickTier = createTierPicker();
  static #lastFrame = -1;
  /** Feeds the page's frame time once a frame (the first character to tick takes it). @param {number} ms @param {number} frameId */
  static frameTime(ms, frameId) {
    if (frameId === Character.#lastFrame) return;
    Character.#lastFrame = frameId;
    if (Character.quality === 'auto') Character.tier = Character.#pickTier(Character.tier, ms);
  }

  /**
   * @param {any} blend the loaded scene (load's result)
   * @param {N} armature
   * @param {{ roles?: Record<string, string | string[] | string[][]>, input?: 'default' | (() => Intent) | null,
   *   responsiveness?: number, ground?: (string | RegExp)[], idle?: boolean, seed?: number, manual?: boolean,
   *   preset?: { body?: string, effects?: [string, object][] } }} [options]
   * `manual`: updated by `update(seconds)` (a recording's clock, Node) instead of each frame the scene draws.
   */
  constructor(blend, armature, options = {}) {
    this.blend = blend;
    this.armature = armature;
    this.rig = babylonRig(blend, armature);
    this.clips = rigClips(blend, armature, this.rig);
    this.roles = findRoles(this.rig.names, options.roles, this.rig.parents);
    this.random = random(options.seed ?? 1);
    /** @type {'default' | (() => Intent) | null} */
    this.input = options.input ?? null;
    this.speed = 1;
    /** The armature's node, which the movement moves (a node of its own where the scene has none). */
    this.node = this.rig.root ?? new TransformNode(armature, blend.scene);
    /** The movement (movement.js) that owns the root. */
    this.movement = createMovement(blend.scene, { node: this.node, front: restFront(this.rig, /** @type {string[][]} */ (this.roles.legs ?? [])), responsiveness: options.responsiveness ?? 0.1, ground: options.ground ?? null });
    this.velocity = this.movement.velocity;
    /** @type {((() => Intent) & { dispose(): void }) | null} */
    this.keys = null;
    /** @type {{ update(dt: number): void } | null} */
    this.rootMotion = null;
    /** This frame's intent (step 1). @type {Intent} */
    this.intent = STILL;
    /** @type {{ effect: import('./api.js').Effect, handle: any, roles: Record<string, number | number[]>, before: Float32Array }[]} */
    this.effects = [];
    /** @type {Record<string, any[]>} each step's effects in run order, remade when one is added or removed */
    this.phases = {};
    /** @type {Map<string, number>} */
    this.legs = new Map();
    /** @type {Map<string, string[]> | null} the rig's bone collections, read when a mask first names one */
    this.groups = null;
    /** @type {Map<string, TransformNode>} the nodes bone() made */
    this.followers = new Map();
    /** @type {any} */
    this.debugging = null;
    this.poseApi = createPoseApi(this.pose = new Float32Array(this.rig.names.length * STRIDE), this.rig.parents, () => this.node.getWorldMatrix());
    this.onMarker = new Observable();
    this.dt = 0;
    this.frame = 0;
    this.time = 0;
    /** @type {Map<string, Action>} */
    this.actions = new Map();
    /** @type {Map<import('./api.js').Source, Custom>} */
    this.customs = new Map();
    /** @type {Layer[]} */
    this.layers = [];
    this.body = this.layer('body');
    /** Locomotion (locomotion.js): its state's fields (actions, stances, stance, speeds) are its own. */
    this.locomotion = /** @type {any} */ (this.custom(locomotion()));
    this.offTimeline();
    this.rootMotion = createRootMotion(/** @type {any} */ (this));
    // Idle life: a frozen idle reads as dead.
    if (options.idle !== false) {
      if (this.roles.chest) this.add(breathe());
      if (this.roles['eye.L'] || this.roles['lid.L']) this.add(eyes());
    }
    const scene = blend.scene;
    const engine = scene.getEngine();
    this.schedule = createSchedule(this);
    this.ticking = options.manual ? null : scene.onBeforeRenderObservable.add(() => {
      Character.frameTime(engine.getDeltaTime(), engine.frameId);
      this.update(Math.min(engine.getDeltaTime() / 1000, 0.1));
    });
  }

  /** The package's own clips of this rig stop: the character plays its actions from now on. */
  offTimeline() {
    const skeleton = skeletonOf(this.blend, this.armature);
    for (const group of this.blend.scene.animationGroups) {
      if (group.targetedAnimations.some((/** @type {any} */ t) => t.target.getSkeleton?.() === skeleton)) group.stop();
    }
  }

  /** An action by name with its options; the same name and options give the same source. @param {import('./names.js').ActionOf<N>} name @param {ActionOptions} [options] */
  action(name, options = {}) {
    const key = `${name} ${JSON.stringify(options)}`;
    let action = this.actions.get(key);
    if (!action) this.actions.set(key, (action = new Action(this, clipOf(this, name), options)));
    return action;
  }

  /** @param {Partial<Record<import('./names.js').ActionOf<N>, number>>} points */
  mix(points) { return new Mix(/** @type {any} */ (this), /** @type {Record<string, number>} */ (points)); }

  get responsiveness() { return this.movement.responsiveness; }
  set responsiveness(seconds) { this.movement.responsiveness = seconds; }

  /**
   * @param {import('@babylonjs/core').TransformNode | Vector3} target
   * @returns {Intent}
   */
  steer(target) { return steer(this, target); }
  /**
   * @param {import('@babylonjs/core').TransformNode | Vector3} target @param {{ run?: boolean }} [options]
   * @returns {Promise<void>}
   */
  walkTo(target, options) { return walkTo(this, target, options); }
  /**
   * @param {import('@babylonjs/core').TransformNode} node @param {{ seconds?: number }} [options]
   * @returns {Promise<void>}
   */
  place(node, options) { return place(this, node, options); }
  /**
   * @param {import('@babylonjs/core').TransformNode | Vector3} target @param {{ seconds?: number }} [options]
   * @returns {Promise<void>}
   */
  turnTo(target, options) { return turnTo(this, target, options); }

  /**
   * How much a foot is down, 0 to 1, by its role (`'foot.L'`), from the body's action or its source's own
   * `contact(leg)`.
   * @param {import('./names.js').RoleOf<N>} foot
   */
  contact(foot) {
    const leg = this.legOf(foot);
    if (leg < 0) {
      const legs = /** @type {string[][]} */ (this.roles.legs ?? []);
      throw new Error(`No foot "${foot}" on ${this.armature}: its legs end in ${legs.map((c) => `"${c.at(-1)}"`).join(', ') || 'none'}`);
    }
    const source = this.body.source;
    if (source instanceof Action) return contactAt(source.contacts, leg, source.time);
    if (source instanceof Custom) return source.state?.contact?.(leg) ?? 0;
    return 0;
  }

  /** The index in roles.legs of the leg ending in a foot role, or -1; found once per role. @param {string} foot */
  legOf(foot) {
    let leg = this.legs.get(foot);
    if (leg === undefined) {
      const end = this.roles[foot];
      leg = /** @type {string[][]} */ (this.roles.legs ?? []).findIndex((chain) => chain[chain.length - 1] === end);
      this.legs.set(foot, leg);
    }
    return leg;
  }

  /** A bone by role or name: a role's own bone, a chain's end. @param {string} roleOrName @returns {string} */
  boneName(roleOrName) {
    const role = this.roles[roleOrName];
    const name = typeof role === 'string' ? role : Array.isArray(role) && typeof role[role.length - 1] === 'string' ? /** @type {string} */ (role[role.length - 1]) : roleOrName;
    if (this.rig.boneIndex(name) < 0) throw new Error(`No bone or role "${roleOrName}" on ${this.armature}: its roles are ${Object.keys(this.roles).join(', ')}`);
    return name;
  }

  /** A node that follows a bone (by role or name) as drawn, for props and hit volumes; one per bone. @param {string} roleOrName */
  bone(roleOrName) {
    const name = this.boneName(roleOrName);
    let node = this.followers.get(name);
    if (!node) {
      node = new TransformNode(`${this.armature} ${name}`, this.blend.scene);
      this.rig.attach(node, this.rig.boneIndex(name));
      this.followers.set(name, node);
    }
    return node;
  }

  /** What moves a bone, and the rig drawn by Babylon's SkeletonViewer while `show` is set. */
  get debug() {
    const character = this;
    return (this.debugging ??= {
      /** The layers and effects that move a bone (by role or name) this frame, with their weights. @param {string} roleOrName */
      who(roleOrName) {
        const i = character.rig.boneIndex(character.boneName(roleOrName));
        const layers = character.layers.filter((l) => l.weight > 0 && l.mask[i] && l.source).map((l) => ({ by: l.name, source: /** @type {any} */ (l.source).name, weight: l.weight }));
        const effects = character.effects.filter((/** @type {any} */ e) => e.entry.weightNow > 0 && [Object.values(e.entry.roles)].flat(3).includes(i)).map((/** @type {any} */ e) => ({ by: e.effect.name, weight: e.entry.weightNow }));
        return [...layers, ...effects];
      },
      /** @type {SkeletonViewer | null} */ viewer: null,
      get show() { return !!this.viewer; },
      set show(on) {
        const skeleton = skeletonOf(character.blend, character.armature), mesh = skinnedBy(character.blend.scene, skeleton);
        if (on && !this.viewer && skeleton && mesh) this.viewer = new SkeletonViewer(skeleton, mesh, character.blend.scene, true, 1, { displayMode: SkeletonViewer.DISPLAY_SPHERE_AND_SPURS });
        if (!on && this.viewer) { this.viewer.dispose(); this.viewer = null; }
      },
    });
  }

  /** Whether a bone is posed by an action with a sound (an actor's own eyes and breathing win). @param {number} bone */
  voiced(bone) {
    for (const layer of this.layers) if (layer.weight > 0 && layer.mask[bone] && layer.source instanceof Action && layer.source.options.sound) return true;
    return false;
  }

  /**
   * Attaches an effect: its roles resolved to bones (throwing for one the rig lacks), its state from `init`, run each
   * frame at its step, scaled by its weight.
   * @template {import('./api.js').Effect<any>} E @param {E} effect @param {{ weight?: number }} [options]
   */
  add(effect, { weight = 1 } = {}) {
    for (const role of effect.needs) {
      if (this.roles[role] === undefined) throw new Error(`${effect.name} needs the role "${role}", which ${this.armature} lacks: it has ${Object.keys(this.roles).join(', ')}`);
    }
    const all = this.boneRoles(), roles = Object.fromEntries(effect.needs.map((role) => [role, all[role]]));
    // The options the effect runs with: its own, with its tier's merged in when the tier changes (kept, not remade).
    const live = { ...effect.options, .../** @type {any} */ (effect.tiers)?.[Character.tier] };
    const state = effect.init?.(/** @type {any} */ (this), /** @type {any} */ (roles), live);
    const entry = { effect, roles, state, live, tier: /** @type {string} */ (Character.tier), before: new Float32Array(this.pose.length), weightNow: weight, fading: /** @type {{ to: number, rate: number } | null} */ (null), removing: false, /** @type {any} */ context: null };
    const handle = Object.assign(Object.create(state && typeof state === 'object' ? state : null), {
      name: effect.name,
      options: effect.options,
      /** @param {number} to @param {number} seconds */
      fade(to, seconds) { entry.fading = seconds > 0 ? { to, rate: Math.abs(to - entry.weightNow) / seconds } : null; if (seconds <= 0) entry.weightNow = to; return handle; },
      /** @param {{ blend?: number }} [options] */
      remove: ({ blend = BLEND } = {}) => { handle.fade(0, blend); entry.removing = true; },
    });
    // Live, not copied as Object.assign would.
    Object.defineProperty(handle, 'weight', { get: () => entry.weightNow, set: (value) => { entry.weightNow = value; entry.fading = null; }, enumerable: true });
    // Each option is the handle's too: `hero.effect('gaze').targets = [...]` sets it.
    for (const key of Object.keys(effect.options)) {
      Object.defineProperty(handle, key, { get: () => effect.options[key], set: (value) => { effect.options[key] = value; entry.tier = ''; }, enumerable: true });
    }
    this.effects.push(/** @type {any} */ ({ ...entry, handle, entry }));
    this.phases = {};
    return handle;
  }

  /** The roles as bones (indices in the pose), as effects and sources get them. */
  boneRoles() {
    /** @type {(n: any) => any} */
    const index = (n) => (Array.isArray(n) ? n.map(index) : this.rig.boneIndex(n));
    return /** @type {Record<string, any>} */ (Object.fromEntries(Object.entries(this.roles).map(([role, names]) => [role, index(names)])));
  }

  /** An attached effect's handle by name. @param {string} name */
  effect(name) {
    const found = this.effects.find((e) => e.effect.name === name);
    if (!found) throw new Error(`No effect "${name}" on ${this.armature}: it has ${this.effects.map((e) => `"${e.effect.name}"`).join(', ') || 'none'}`);
    return found.handle;
  }

  /** The effects at one step, in order: those named in `order` first, as listed, then the rest as added. @param {'controls' | 'deform'} on @param {number} dt */
  runEffects(on, dt) {
    const ordered = (this.phases[on] ??= this.ordered(on));
    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i];
      const { effect, entry } = item;
      if (effect.on !== on) continue;
      if (entry.fading) {
        const { to, rate } = entry.fading, step = rate * dt;
        entry.weightNow = Math.abs(to - entry.weightNow) <= step ? to : entry.weightNow + Math.sign(to - entry.weightNow) * step;
        if (entry.weightNow === to) entry.fading = null;
      }
      if (entry.removing && entry.weightNow === 0) {
        effect.dispose?.(entry.state);
        this.effects.splice(this.effects.indexOf(item), 1);
        this.phases = {};
        continue;
      }
      if (entry.weightNow <= 0) continue;
      if (entry.tier !== Character.tier) {
        entry.tier = Character.tier;
        Object.assign(entry.live, effect.options, /** @type {any} */ (effect.tiers)?.[Character.tier]);
      }
      if (entry.weightNow < 1) entry.before.set(this.pose);
      const context = (entry.context ??= { pose: this.poseApi, roles: entry.roles, time: 0, options: entry.live, character: /** @type {any} */ (this) });
      context.time = this.time;
      effect.update(dt, context, entry.state);
      if (entry.weightNow < 1) blendPoses(this.pose, entry.before, this.pose, entry.weightNow);
    }
  }

  /** The effects of one step in run order: ORDER's, then others in the order added. @param {string} on */
  ordered(on) {
    const order = /** @type {Record<string, string[]>} */ (ORDER)[on] ?? [], rank = (/** @type {any} */ e) => { const k = order.indexOf(e.effect.name); return k < 0 ? order.length : k; };
    return this.effects.filter((e) => e.effect.on === on).sort((a, b) => rank(a) - rank(b));
  }

  /** A source of defineSource, run once per character. @param {import('./api.js').Source} source */
  custom(source) {
    let run = this.customs.get(source);
    if (!run) this.customs.set(source, (run = new Custom(this, source)));
    return run;
  }

  /**
   * @param {string} name
   * @param {{ group?: import('./names.js').GroupOf<N>, roles?: import('./names.js').RoleOf<N>[], bones?: string[], weight?: number,
   *   add?: boolean | { from: 'rest' | import('./names.js').ActionOf<N> } }} [options]
   */
  layer(name, options = {}) {
    const layer = new Layer(this, name, options);
    this.layers.push(layer);
    return layer;
  }

  /** Whether a layer plays this source now. @param {Action | Mix | Custom} source */
  playing(source) { return this.layers.some((layer) => layer.source === source); }

  /**
   * A layer's mask: all bones, or those of a bone collection, roles or names, each with the bones under it.
   * @param {{ group?: string, roles?: string[], bones?: string[] }} options
   */
  mask({ group, roles, bones }) {
    const { names, parents } = this.rig, mask = new Float32Array(names.length);
    if (!group && !roles && !bones) return mask.fill(1);
    /** @type {string[]} */
    const chosen = [...(bones ?? [])];
    for (const role of roles ?? []) {
      const found = this.roles[role];
      if (found === undefined) throw new Error(`No role "${role}" on ${this.armature}: it has ${Object.keys(this.roles).join(', ')}`);
      const has = (/** @type {string} */ n) => this.rig.boneIndex(n) >= 0;
      for (const name of /** @type {string[]} */ ([found].flat(2))) chosen.push(...playedBy(name, has));
    }
    if (group) {
      const groups = (this.groups ??= boneCollections(this.blend.ir, this.armature) ?? new Map()), members = groups.get(group);
      if (!members) throw new Error(`No bone collection "${group}" on ${this.armature}: it has ${[...groups.keys()].map((n) => `"${n}"`).join(', ') || 'none'}`);
      chosen.push(...members);
    }
    for (const name of chosen) {
      const i = this.rig.boneIndex(name);
      if (i < 0) throw new Error(`No bone "${name}" on ${this.armature}`);
      mask[i] = 1;
    }
    // A bone under a masked one is masked too (bones are listed parents first).
    for (let i = 0; i < names.length; i++) if (parents[i] >= 0 && mask[parents[i]]) mask[i] = 1;
    return mask;
  }

  /** @param {Action} action */
  onEnd(action) {
    for (const layer of this.layers) if (layer.source === action) layer.onEnd.notifyObservers(action.name);
  }

  /** @param {Action} action @param {string} name */
  marker(action, name) {
    if (this.body.source === action || this.layers.some((l) => l.source === action)) this.onMarker.notifyObservers({ name, action: action.name });
  }

  /** A keyed custom property of the body's action at its current time (0 when it keys none). @param {import('./names.js').PropertyOf<N>} name */
  property(name) {
    const source = this.body.source;
    const action = source instanceof Action ? source : null, values = action?.clip.properties?.[`objects[${JSON.stringify(this.armature)}][${JSON.stringify(name)}]`];
    if (values === undefined || !action) return 0;
    return typeof values === 'number' ? values : values[Math.min(values.length - 1, Math.round(action.time * action.clip.fps))];
  }

  /**
   * The voice of an action's sound strip, timed against the action's first frame, from the head.
   * @param {string} action @param {string} name @param {boolean} spatial
   */
  voiceOf(action, name, spatial) {
    const strips = this.blend.sounds ?? {}, strip = strips[name];
    if (!strip) throw new Error(`No sound strip "${name}": the scene has ${Object.keys(strips).map((n) => `"${n}"`).join(', ') || 'none'}`);
    const time = this.blend.ir?.scene?.time ?? {}, info = time.clips?.[action] ?? {}, seconds = (/** @type {number} */ f) => (f * (time.fps_base ?? 1)) / (time.fps ?? 24);
    const start = strip.start - seconds((info.frame_start ?? time.frame_start ?? 0) - (time.frame_start ?? 0));
    const head = this.roles.head ? this.rig.boneIndex(/** @type {string} */ (this.roles.head)) : -1;
    return createVoice({ ...strip, start }, { spatial, head: () => (head >= 0 ? this.poseApi.world(head).getTranslation() : null) });
  }

  /** One frame, in the guide's order; `speed` scales the movement's and the sources' time. @param {number} dt */
  update(dt) {
    if (Character.quality !== 'auto') Character.tier = Character.quality;
    dt = this.schedule.step(dt);
    if (dt < 0) return;
    this.dt = dt;
    this.frame++;
    const scaled = dt * this.speed;
    this.time += scaled;
    // Steps 1 and 2: intent, then the movement that owns the root.
    if (this.input === 'default') this.keys ??= defaultInput(this);
    const intent = this.input === 'default' ? /** @type {() => Intent} */ (this.keys)() : typeof this.input === 'function' ? this.input() : STILL;
    this.intent = intent;
    this.movement.update(scaled, intent);
    // The node's world matrix now, for the effects and sources this frame (Babylon updates it only when drawing).
    this.node.computeWorldMatrix(true);
    // Step 3: each source's clock once.
    for (const layer of this.layers) layer.source?.update(scaled, this.frame);
    // Step 4: the body's root motion moves the character while an action owns the root (rootmotion.js: taken out of
    // the action's own pose), then the layers in the order made, over the rest pose.
    this.rootMotion?.update(scaled);
    // Off screen: clocks and root only.
    if (!this.schedule.onScreen()) return;
    const pose = this.pose;
    pose.set(this.rig.rest);
    for (const layer of this.layers) layer.apply(pose, dt);
    // Step 5, then the rig's own solve (step 6) and step 7, where the rig is solved in the page.
    this.runEffects('controls', dt);
    this.runEffects('deform', dt);
    this.rig.setLocalPose(pose);
  }

  dispose() {
    this.ticking?.remove();
    for (const node of this.followers.values()) node.dispose();
    if (this.debugging) this.debugging.show = false;
    this.keys?.dispose();
    this.movement.dispose();
    for (const layer of this.layers) layer.finish({ interrupted: true });
    for (const custom of this.customs.values()) custom.dispose();
    for (const action of this.actions.values()) action.voice?.dispose();
  }
}
