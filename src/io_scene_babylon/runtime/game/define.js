// @ts-check
/// <reference path="./names.d.ts" />
// SPDX-License-Identifier: MIT OR Apache-2.0
// What a game is written with (the `bylonder` module): behaviours on objects, game-wide systems, the game's composition
// and the props an artist sets in Blender's Object properties > Behaviors. Definitions are data; game/world.js runs them.

/**
 * @typedef {'float' | 'int' | 'bool' | 'enum' | 'color' | 'object' | 'action' | 'sound' | 'knot' | 'collection'} PropType
 * @typedef {{ min?: number, max?: number, step?: number, unit?: string, description?: string }} PropOptions
 * @typedef {{ type: PropType, default: any, options?: string[] } & PropOptions} Prop
 * @typedef {Record<string, Prop>} PropSchema
 */
/**
 * The project's names, which types/blend.d.ts (written from the .blend and the project's Ink) fills in as
 * `interface BylonderNames { action: 'Wobble' | ... }`: a name that is not one of them does not type-check, and an
 * editor completes them. Without it any string is taken.
 * @typedef {BylonderNames extends { action: infer A } ? A : string} ActionName
 * @typedef {BylonderNames extends { sound: infer A } ? A : string} SoundName
 * @typedef {BylonderNames extends { collection: infer A } ? A : string} CollectionName
 * @typedef {BylonderNames extends { object: infer A } ? A : string} ObjectName
 * @typedef {BylonderNames extends { knot: infer A } ? A : string} KnotName
 * @typedef {BylonderNames extends { scene: infer A } ? A : string} SceneName
 */
/**
 * The values of a schema's props, as `props` gives them to code.
 * @template {PropSchema} P
 * @typedef {{ -readonly [K in keyof P]: P[K]['default'] }} PropValues
 */

/**
 * @template T
 * @param {PropType} type @param {T} value @param {PropOptions & { options?: string[] }} [options]
 * @returns {Prop & { default: T }}
 */
const prop = (type, value, options = {}) => ({ type, default: value, ...options });

/** A number the artist sets, with its limits and unit (`'s'`, `'m'`, `'kg'`) as Blender shows them. @param {number} [value] @param {PropOptions} [options] */
export const float = (value = 0, options) => prop('float', value, options);
/** A whole number. @param {number} [value] @param {PropOptions} [options] */
export const int = (value = 0, options) => prop('int', Math.round(value), options);
/** A checkbox. @param {boolean} [value] @param {PropOptions} [options] */
export const bool = (value = false, options) => prop('bool', value, options);
/** One of `options`, by name. @template {string} T @param {readonly T[]} options @param {T} [value] @param {PropOptions} [more] */
export const enumOf = (options, value = options[0], more) => prop('enum', value, { ...more, options: [...options] });
/** A colour, linear RGB from 0 to 1, drawn as Blender's colour picker. @param {[number, number, number]} [value] @param {PropOptions} [options] */
export const color = (value = [1, 1, 1], options) => prop('color', value, options);
/** Another object of the scene, by name. @param {ObjectName} [name] @param {PropOptions} [options] */
export const object = (name = /** @type {ObjectName} */ (''), options) => prop('object', name, options);
/** One of the .blend's actions, by name, which `entity.play()` plays. @param {ActionName} [name] @param {PropOptions} [options] */
export const action = (name = /** @type {ActionName} */ (''), options) => prop('action', name, options);
/**
 * A sound of the .blend, or several to pick one from with `time.pick`.
 * @template {SoundName | SoundName[]} T @param {T} [names] @param {PropOptions} [options]
 */
export const sound = (names = /** @type {T} */ (''), options) => prop('sound', names, options);
/** A knot of the project's Ink stories, which a subtitles system says. @param {KnotName} [name] @param {PropOptions} [options] */
export const knot = (name = /** @type {KnotName} */ (''), options) => prop('knot', name, options);
/**
 * A collection of the .blend, a prefab `game.spawn()` makes copies of, or several to pick one from with `time.pick`.
 * @template {CollectionName | CollectionName[]} T @param {T} [names] @param {PropOptions} [options]
 */
export const collection = (names = /** @type {T} */ (''), options) => prop('collection', names, options);

/**
 * What a behaviour's or a system's `create` receives.
 * @template [V=Record<string, any>]
 * @typedef {{
 *   entity: import('./world.js').Entity, props: V, state: Record<string, any>, game: import('./world.js').Game,
 *   time: import('./world.js').Time, input: import('./world.js').Input, assets: import('./world.js').Assets, babylon: import('./world.js').Babylon,
 *   blend: any,
 * }} BehaviorContext
 */
/**
 * What `create` returns: `update(dt)` each frame, a function per event it receives (named after the event), and any
 * members others read (`barista.holding`).
 * @typedef {Record<string, any> & { update?: (dt: number) => void | Promise<void> }} Handlers
 */
/**
 * A behaviour as defined: its props' schema `P`, the events it sends `E`, and what its `create` returns `H`.
 * @template {PropSchema} [P=PropSchema]
 * @template {string} [E=string]
 * @template {Handlers} [H=Handlers]
 * @typedef {{
 *   name: string, props?: P, events?: readonly E[], requires?: string[], phase?: 'early' | 'late',
 *   create: (this: { emit(event: E, data?: any): void }, context: BehaviorContext<PropValues<P>>) => H,
 * }} BehaviorDefinition
 */
/**
 * @template {PropSchema} [P=PropSchema]
 * @template {string} [E=string]
 * @template {Handlers} [H=Handlers]
 * @typedef {BehaviorDefinition<P, E, H> & { kind: 'behavior' }} Behavior
 */

/**
 * Logic attached to an object: one instance per object it is added to, per run. Its props are custom properties of
 * the object (Object properties > Behaviors); its `state` survives a hot swap of the code and is gone on Reset.
 * `create` returns its handlers: `update(dt)` each frame, and a function per event it receives, named after it.
 * @template {PropSchema} [P={}]
 * @template {string} [E=never]
 * @template {Handlers} [H={}]
 * @param {BehaviorDefinition<P, E, H>} definition
 * @returns {Behavior<P, E, H>}
 */
export function defineBehavior(definition) {
  if (!definition?.name) throw new Error('defineBehavior needs a name: defineBehavior({ name: \'Rock\', create() { ... } })');
  if (typeof definition.create !== 'function') throw new Error(`Behavior ${definition.name} needs create({ entity, props, ... })`);
  return { ...definition, kind: 'behavior' };
}

/**
 * @typedef {{
 *   name: string, props?: PropSchema,
 *   create: (context: Omit<BehaviorContext, 'entity' | 'state'> & { saved: any }) => Handlers & { save?: () => any },
 * }} SystemDefinition
 * @typedef {SystemDefinition & { kind: 'system', values: Record<string, any>, with(values: Record<string, any>): System }} System
 */

/**
 * Game-wide logic and state, one per run, reached with `game.get(System)`. Its `save()` is what a hot swap carries.
 * @template {SystemDefinition} D
 * @param {D} definition
 * @returns {D & System}
 */
export function defineSystem(definition) {
  if (!definition?.name) throw new Error('defineSystem needs a name');
  /** @param {Record<string, any>} values @returns {any} */
  const make = (values) => ({ ...definition, kind: 'system', values, with: (/** @type {Record<string, any>} */ more) => make({ ...values, ...more }) });
  return make({});
}

/**
 * @typedef {{ start?: string, systems?: System[], ui?: any[], input?: Record<string, string[]>, physics?: 'havok' }} GameDefinition
 * The game's composition: the scene it starts in, its systems, its UI, its input map and its physics (`'havok'`:
 * Babylon's Havok on `babylon.scene`, stepped in fixed steps by the run's clock). Behaviours are found by being added
 * to objects in the .blend, not listed here.
 * @param {GameDefinition} definition
 * @returns {GameDefinition & { kind: 'game' }}
 */
export function defineGame(definition) {
  return { systems: [], ui: [], input: {}, ...definition, kind: 'game' };
}

/**
 * An enum option's value as Blender keeps it (an enum ID property's item value): its own, from its name, so reordering
 * the options in code keeps what objects chose. @param {string} name
 */
export function enumValue(name) {
  let hash = 0;
  for (const c of name) hash = (Math.imul(hash, 31) + /** @type {number} */ (c.codePointAt(0))) | 0;
  return hash & 0x7fffffff;
}

/** A prop's value from what the .blend holds, or its default where it holds none or one of another type. @param {Prop} schema @param {any} value */
export function propValue(schema, value) {
  if (value === undefined || value === null) return schema.default;
  switch (schema.type) {
    case 'float': return typeof value === 'number' ? value : schema.default;
    case 'int': return typeof value === 'number' ? Math.round(value) : schema.default;
    case 'bool': return typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : schema.default;
    case 'color': return Array.isArray(value) && value.length >= 3 ? value.slice(0, 3) : schema.default;
    case 'enum': {
      const name = typeof value === 'number' ? schema.options?.find((option) => enumValue(option) === value) : value;
      return schema.options?.includes(name) ? name : schema.default;
    }
    default: return value;
  }
}

/**
 * Effects game code adds to a Character, `entity.character.add(reach({ hand: 'hand.R', target }))`, and defines
 * (defineEffect). The character runtime is entered through its api.js, before any effect.
 */
export { defineEffect } from '../character/api.js';
export { reach } from '../character/effects/reach.js';
