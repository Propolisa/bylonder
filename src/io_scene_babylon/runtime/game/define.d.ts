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
export function defineBehavior<P extends PropSchema = {}, E extends string = never, H extends Handlers = {}>(definition: BehaviorDefinition<P, E, H>): Behavior<P, E, H>;
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
export function defineSystem<D extends SystemDefinition>(definition: D): D & System;
/**
 * @typedef {{ start?: string, systems?: System[], ui?: any[], input?: Record<string, string[]>, physics?: 'havok' }} GameDefinition
 * The game's composition: the scene it starts in, its systems, its UI, its input map and its physics (`'havok'`:
 * Babylon's Havok on `babylon.scene`, stepped in fixed steps by the run's clock). Behaviours are found by being added
 * to objects in the .blend, not listed here.
 * @param {GameDefinition} definition
 * @returns {GameDefinition & { kind: 'game' }}
 */
export function defineGame(definition: GameDefinition): GameDefinition & {
    kind: "game";
};
/**
 * An enum option's value as Blender keeps it (an enum ID property's item value): its own, from its name, so reordering
 * the options in code keeps what objects chose. @param {string} name
 */
export function enumValue(name: string): number;
/** A prop's value from what the .blend holds, or its default where it holds none or one of another type. @param {Prop} schema @param {any} value */
export function propValue(schema: Prop, value: any): any;
export function float(value?: number, options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: number;
};
export function int(value?: number, options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: number;
};
export function bool(value?: boolean, options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: boolean;
};
export function enumOf<T extends string>(options: readonly T[], value?: T, more?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: T;
};
export function color(value?: [number, number, number], options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: [number, number, number];
};
export function object(name?: ObjectName, options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: string;
};
export function action(name?: ActionName, options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: string;
};
export function sound<T extends SoundName | SoundName[]>(names?: T, options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: T;
};
export function knot(name?: KnotName, options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: string;
};
export function collection<T extends CollectionName | CollectionName[]>(names?: T, options?: PropOptions): {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions & {
    default: T;
};
export { defineEffect } from "../character/api.js";
export { reach } from "../character/effects/reach.js";
/**
 * What a behaviour's or a system's `create` receives.
 */
export type BehaviorContext<V = Record<string, any>> = {
    entity: import("./world.js").Entity;
    props: V;
    state: Record<string, any>;
    game: import("./world.js").Game;
    time: import("./world.js").Time;
    input: import("./world.js").Input;
    assets: import("./world.js").Assets;
    babylon: import("./world.js").Babylon;
    blend: any;
};
/**
 * What `create` returns: `update(dt)` each frame, a function per event it receives (named after the event), and any
 * members others read (`barista.holding`).
 */
export type Handlers = Record<string, any> & {
    update?: (dt: number) => void | Promise<void>;
};
/**
 * A behaviour as defined: its props' schema `P`, the events it sends `E`, and what its `create` returns `H`.
 */
export type BehaviorDefinition<P extends PropSchema = PropSchema, E extends string = string, H extends Handlers = Handlers> = {
    name: string;
    props?: P;
    events?: readonly E[];
    requires?: string[];
    phase?: "early" | "late";
    create: (this: {
        emit(event: E, data?: any): void;
    }, context: BehaviorContext<PropValues<P>>) => H;
};
export type Behavior<P extends PropSchema = PropSchema, E extends string = string, H extends Handlers = Handlers> = BehaviorDefinition<P, E, H> & {
    kind: "behavior";
};
export type SystemDefinition = {
    name: string;
    props?: PropSchema;
    create: (context: Omit<BehaviorContext, "entity" | "state"> & {
        saved: any;
    }) => Handlers & {
        save?: () => any;
    };
};
export type System = SystemDefinition & {
    kind: "system";
    values: Record<string, any>;
    with(values: Record<string, any>): System;
};
/**
 * The game's composition: the scene it starts in, its systems, its UI, its input map and its physics (`'havok'`:
 * Babylon's Havok on `babylon.scene`, stepped in fixed steps by the run's clock). Behaviours are found by being added
 * to objects in the .blend, not listed here.
 */
export type GameDefinition = {
    start?: string;
    systems?: System[];
    ui?: any[];
    input?: Record<string, string[]>;
    physics?: "havok";
};
export type PropType = "float" | "int" | "bool" | "enum" | "color" | "object" | "action" | "sound" | "knot" | "collection";
export type PropOptions = {
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    description?: string;
};
export type Prop = {
    type: PropType;
    default: any;
    options?: string[];
} & PropOptions;
export type PropSchema = Record<string, Prop>;
/**
 * The project's names, which types/blend.d.ts (written from the .blend and the project's Ink) fills in as
 * `interface BylonderNames { action: 'Wobble' | ... }`: a name that is not one of them does not type-check, and an
 * editor completes them. Without it any string is taken.
 */
export type ActionName = BylonderNames extends {
    action: infer A;
} ? A : string;
/**
 * The project's names, which types/blend.d.ts (written from the .blend and the project's Ink) fills in as
 * `interface BylonderNames { action: 'Wobble' | ... }`: a name that is not one of them does not type-check, and an
 * editor completes them. Without it any string is taken.
 */
export type SoundName = BylonderNames extends {
    sound: infer A;
} ? A : string;
/**
 * The project's names, which types/blend.d.ts (written from the .blend and the project's Ink) fills in as
 * `interface BylonderNames { action: 'Wobble' | ... }`: a name that is not one of them does not type-check, and an
 * editor completes them. Without it any string is taken.
 */
export type CollectionName = BylonderNames extends {
    collection: infer A;
} ? A : string;
/**
 * The project's names, which types/blend.d.ts (written from the .blend and the project's Ink) fills in as
 * `interface BylonderNames { action: 'Wobble' | ... }`: a name that is not one of them does not type-check, and an
 * editor completes them. Without it any string is taken.
 */
export type ObjectName = BylonderNames extends {
    object: infer A;
} ? A : string;
/**
 * The project's names, which types/blend.d.ts (written from the .blend and the project's Ink) fills in as
 * `interface BylonderNames { action: 'Wobble' | ... }`: a name that is not one of them does not type-check, and an
 * editor completes them. Without it any string is taken.
 */
export type KnotName = BylonderNames extends {
    knot: infer A;
} ? A : string;
/**
 * The project's names, which types/blend.d.ts (written from the .blend and the project's Ink) fills in as
 * `interface BylonderNames { action: 'Wobble' | ... }`: a name that is not one of them does not type-check, and an
 * editor completes them. Without it any string is taken.
 */
export type SceneName = BylonderNames extends {
    scene: infer A;
} ? A : string;
/**
 * The values of a schema's props, as `props` gives them to code.
 */
export type PropValues<P extends PropSchema> = { -readonly [K in keyof P]: P[K]["default"]; };
