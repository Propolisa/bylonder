// SPDX-License-Identifier: MIT OR Apache-2.0
// The character animation system's public shapes (docs/character-animation.md, API reference) and the seams its parts
// build against: the frame's eight steps, the pose an effect writes, the sample a source blends with, and the movement
// that owns the root. Character and Layer are core.js's, followCamera camera.js's.

import { Character, Layer } from './core.js';

/** The frame's steps in order (the guide's Every frame); each part does its work at its step. */
const STEPS = /** @type {const} */ (['intent', 'movement', 'sources', 'layers', 'controls', 'solve', 'deform', 'draw']);

/**
 * @typedef {import('@babylonjs/core').Vector3} Vector3
 * @typedef {import('@babylonjs/core').Quaternion} Quaternion
 * @typedef {import('@babylonjs/core').Matrix} Matrix
 * @typedef {import('@babylonjs/core').TransformNode} TransformNode
 * @typedef {import('@babylonjs/core').Camera} Camera
 * @typedef {import('@babylonjs/core').Observable<any>} Observable
 * @typedef {typeof STEPS[number]} Step
 * @typedef {'A' | 'B' | 'C'} Tier
 */

/**
 * What the character wants this frame (step 1): a move as a velocity in world space (m/s), never a position.
 * @typedef {{ move: Vector3, facing?: Vector3, look?: TransformNode | Vector3, jump?: boolean }} Intent
 */

/**
 * A bone as effects and sources name it: its index in the character's pose.
 * @typedef {number} Bone
 */

/**
 * The pose an effect writes (steps 5 and 7), each bone in its own (local) space. Effects write at full strength; the
 * core scales what they wrote by their weight.
 * @typedef {object} Pose
 * @property {(bone: Bone, rotation: Quaternion) => void} setRotation
 * @property {(bone: Bone, axis: 'X' | 'Y' | 'Z' | Vector3, angle: number) => void} addRotation
 * @property {(bone: Bone, location: Vector3) => void} setLocation
 * @property {(bone: Bone, offset: Vector3) => void} addLocation
 * @property {(bone: Bone, scale: Vector3) => void} setScale
 * @property {(bone: Bone) => Matrix} world the bone's world matrix so far, with this step's earlier writes (read only)
 * @property {(bone: Bone, out: Quaternion) => Quaternion} rotation its local rotation so far
 * @property {(bone: Bone, out: Vector3) => Vector3} location its local location so far
 */

/**
 * How a source blends an action into its pose (step 3). Each action keeps its own phase in the source, advanced at
 * `rate` (1) unless `time` sets it; `mirror` flips it left for right.
 * @typedef {(action: string, weight: number, options?: { rate?: number, time?: number, mirror?: boolean }) => void} Sample
 */

/**
 * The movement that owns the root (steps 1 and 2): a critically damped spring toward the intent, on the ground and out
 * of walls, predicting the next second. Locomotion reads it; an action or `place` owns the root instead while it runs.
 * @typedef {object} Movement
 * @property {Vector3} position the root on the ground
 * @property {Vector3} facing unit, horizontal
 * @property {Vector3} velocity m/s; its y rises in a jump and falls in a fall
 * @property {boolean} grounded
 * @property {'movement' | 'action' | 'place'} owner who moves the root this frame
 * @property {(owner: 'movement' | 'action' | 'place') => void} own an action or `place` takes the root, or gives it back
 * @property {(dt: number, position: Vector3, facing: Vector3) => void} follow where the owner put the root; velocity
 *   follows it, so the spring takes over continuously; intent waits, keeping a jump asked in its last 0.3 s
 * @property {(seconds: number, out: { position: Vector3, facing: Vector3 }) => void} predict where it will be
 * @property {(x: number, z: number, top?: number) => { height: number, normal: { x: number, y: number, z: number } } | null} ground the character's ground there, below `top` when given
 * @property {(by: Vector3) => void} push shoves the root (a hit's step)
 * @property {(dt: number, intent: Intent) => void} update called by the character at step 'movement'
 */

/**
 * @typedef {{ once?: boolean, loop?: number, sound?: string, waitForSound?: boolean, spatial?: boolean }} ActionOptions
 * @typedef {ActionOptions & { blend?: number, with?: Layer, warpTo?: { marker: string } &
 *   ({ node: TransformNode } | { position: Vector3, facing?: Vector3 }) }} PlayOptions
 * @typedef {{ idle?: string, walk?: string, run?: string, sprint?: string, turn?: string, jump?: string, fall?: string,
 *   land?: string }} Gaits
 * @typedef {{ ended?: true, interrupted?: true }} Done
 */

/**
 * A source of a layer (step 3) as defineSource makes one; actions and mixes are the core's.
 * @template [S=any]
 * @typedef {object} Source
 * @property {string} name
 * @property {Record<string, any>} options
 * @property {(character: Character, roles: Partial<RoleBones>, options: any) => S} [init] once, when a character first plays it: its state
 * @property {(dt: number, frame: { character: Character, sample: Sample, time: number, options: any }, state: S) => void} update
 * @property {(state: S) => void} [dispose]
 */

/**
 * The roles as bones: a single bone's role is its Bone, a limb's its chain root to end, `arms` and `legs` every such
 * chain, a lid its [upper, lower] controls; a rig's own role (a cat's `tail`) is a chain.
 * @typedef {{ hips: Bone, spine: Bone, chest: Bone, neck: Bone, head: Bone, jaw: Bone, 'eye.L': Bone, 'eye.R': Bone,
 *   'hand.L': Bone, 'hand.R': Bone, 'foot.L': Bone, 'foot.R': Bone, 'arm.L': Bone[], 'arm.R': Bone[], 'leg.L': Bone[],
 *   'leg.R': Bone[], 'lid.L': [Bone, Bone], 'lid.R': [Bone, Bone], arms: Bone[][], legs: Bone[][] }} RoleBones
 */

/**
 * The bones of roles `R`, each typed by its role.
 * @template {string} R
 * @typedef {{ [K in R]: K extends keyof RoleBones ? RoleBones[K] : Bone[] }} Roles
 */

/**
 * An effect (steps 5 and 7), as defineEffect makes one.
 * @template [F={}] the fields its handle adds (`reached`, `hit`)
 * @typedef {object} Effect
 * @property {string} name
 * @property {string[]} needs roles; attaching throws when the rig lacks one
 * @property {'controls' | 'deform'} on step 5 (before the solve) or step 7 (after it)
 * @property {Record<string, any>} options
 * @property {Partial<Record<Tier, Record<string, any>>>} [tiers]
 * @property {(character: Character, roles: Record<string, unknown>, options: any) => F} [init] once on attach: the effect's state, whose fields its handle shows
 * @property {(dt: number, frame: EffectFrame, state: F) => void} update
 * @property {(state: F) => void} [dispose]
 */

/**
 * What an effect sees each frame. Through `character`: its movement (ground, velocity, intent), its rig (`rig`, with the
 * IR's constraints in `character.blend.ir`), `contact(leg)` (0 to 1, from the body's action), `voiced(bone)` (a bone
 * whose action has a sound) and the tier (`Character.tier`).
 * @typedef {{ pose: Pose, roles: Record<string, unknown>, time: number, options: any, character: Character }} EffectFrame
 */

/**
 * @typedef {object} EffectHandle
 * @property {number} weight
 * @property {(weight: number, seconds: number) => EffectHandle} fade
 * @property {(options?: { blend?: number }) => void} remove
 */

/**
 * An effect from plain parts: `options` are its defaults, overridden by the factory's argument and, on a tier, by
 * `tiers[tier]`.
 * @template {Record<string, any>} O @template {string} R
 * @template [S=any]
 * @param {{ name: string, needs: R[], on: 'controls' | 'deform', options: O, tiers?: Partial<Record<Tier, Partial<O>>>,
 *   init?(character: Character, roles: Roles<R>, options: O): S,
 *   update(dt: number, frame: { pose: Pose, roles: Roles<R>, time: number, options: O, character: Character }, state: S): void,
 *   dispose?(state: S): void }} effect
 * @returns {(options?: Partial<O>) => Effect<S>}
 */
export function defineEffect(effect) {
  if (effect.on !== 'controls' && effect.on !== 'deform') throw new Error(`${effect.name}: on is 'controls' or 'deform'`);
  return (options = {}) => /** @type {Effect<S>} */ (/** @type {unknown} */ ({ ...effect, options: { ...effect.options, ...options } }));
}

/**
 * A source from plain parts: `update` blends actions into its pose with `sample`; `init(character)`, optional, gives
 * its state, passed to `update` and `dispose`.
 * @template {Record<string, any>} O @template [S=any]
 * @param {{ name: string, options: O, init?(character: Character, roles: Partial<RoleBones>, options: O): S,
 *   update(dt: number, frame: { character: Character, sample: Sample, time: number, options: O }, state: S): void,
 *   dispose?(state: S): void }} source
 * @returns {(options?: Partial<O>) => Source<S>}
 */
export function defineSource(source) {
  return (options = {}) => /** @type {Source<S>} */ (/** @type {unknown} */ ({ ...source, options: { ...source.options, ...options } }));
}

export { Character, Layer };

export { followCamera } from './camera.js';
