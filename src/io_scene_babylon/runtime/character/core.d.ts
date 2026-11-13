/** A pseudo-random sequence from a seed (mulberry32): idle life and glances repeat for the same seed. @param {number} seed */
export function random(seed: number): () => number;
/** An action of the character as a source: its clip on its own clock. */
export class Action {
    /** @param {Character} character @param {Clip} clip @param {ActionOptions} options */
    constructor(character: Character, clip: Clip, options: ActionOptions);
    name: string;
    clip: import("./clip.js").Clip;
    options: import("./api.js").ActionOptions;
    character: Character<string>;
    time: number;
    paused: boolean;
    ended: boolean;
    /** Seconds held on the last pose between loops (`loop`). */
    held: number;
    /** The frame this clock last advanced, so several layers advance it once. */
    frame: number;
    pose: Float32Array<ArrayBuffer>;
    written: Uint8Array<ArrayBuffer>;
    /** @type {(() => void)[]} */
    endWaiters: (() => void)[];
    /** Its sound (sound.js): the clock it follows while the sound plays. */
    voice: {
        readonly ready: boolean;
        readonly failed: boolean;
        time(): number | null;
        play(at: number): void;
        pause(): void;
        follow(): void;
        dispose(): void;
    } | null;
    /** Its length in seconds. */
    get duration(): number;
    /** Its markers, in seconds from its start. */
    get markers(): {
        name: string;
        time: number;
    }[];
    /** When each leg (of the role `legs`) is down (contacts.js). */
    get contacts(): import("./contacts.js").Contacts;
    pause(): void;
    resume(): void;
    /** @param {number} seconds */
    seek(seconds: number): void;
    /** Advances the clock once a frame, telling its markers and its end. @param {number} dt @param {number} frame */
    update(dt: number, frame: number): void;
}
/** Actions placed on a value; setting `value` eases there over the blend time. */
export class Mix {
    /** @param {Character} character @param {Record<string, number>} points */
    constructor(character: Character, points: Record<string, number>);
    name: string;
    character: Character<string>;
    points: {
        action: Action;
        at: number;
    }[];
    target: number;
    current: number;
    frame: number;
    pose: Float32Array<ArrayBuffer>;
    written: Uint8Array<ArrayBuffer>;
    set value(value: number);
    get value(): number;
    /** @param {number} dt @param {number} frame */
    update(dt: number, frame: number): void;
}
/** A source of defineSource on a character: its update blends actions into its pose with `sample`. */
export class Custom {
    /** @param {Character} character @param {import('./api.js').Source} source */
    constructor(character: Character, source: import("./api.js").Source);
    name: string;
    source: import("./api.js").Source<any>;
    character: Character<string>;
    /** @type {any} */
    state: any;
    time: number;
    frame: number;
    pose: Float32Array<ArrayBuffer>;
    written: Uint8Array<ArrayBuffer>;
    scratch: Float32Array<ArrayBuffer>;
    /** @type {((pose: Float32Array) => void) | null} */
    mirror: ((pose: Float32Array) => void) | null;
    /** Each action's phase in this source, in seconds. @type {Map<string, number>} */
    phases: Map<string, number>;
    dt: number;
    /** @type {import('./api.js').Sample} */
    sample: import("./api.js").Sample;
    /** @param {number} dt @param {number} frame */
    update(dt: number, frame: number): void;
    dispose(): void;
}
/** A layer: a mask, a weight and a mode, playing one source at a time. */
export class Layer {
    /**
     * @param {Character} character @param {string} name
     * @param {{ group?: string, roles?: string[], bones?: string[], weight?: number, add?: boolean | { from: 'rest' | string } }} options
     */
    constructor(character: Character, name: string, options: {
        group?: string;
        roles?: string[];
        bones?: string[];
        weight?: number;
        add?: boolean | {
            from: "rest" | string;
        };
    });
    name: string;
    character: Character<string>;
    mask: Float32Array<ArrayBuffer>;
    add: boolean | {
        from: "rest" | string;
    };
    weightNow: number;
    /** @type {{ to: number, rate: number } | null} */
    fading: {
        to: number;
        rate: number;
    } | null;
    /** @type {Action | Mix | Custom | null} */
    source: Action | Mix | Custom | null;
    /** @type {((done: Done) => void) | null} */
    settle: ((done: Done) => void) | null;
    onEnd: Observable<any>;
    out: Float32Array<ArrayBuffer>;
    last: Float32Array<ArrayBuffer>;
    beforeLast: Float32Array<ArrayBuffer>;
    reference: Float32Array<ArrayBuffer>;
    delta: Float32Array<ArrayBuffer>;
    from: Float32Array<ArrayBuffer>;
    velocity: Float32Array<ArrayBuffer>;
    blendTime: number;
    blendElapsed: number;
    stopping: boolean;
    set weight(weight: number);
    get weight(): number;
    /** @param {number} weight @param {number} seconds */
    fade(weight: number, seconds: number): this;
    /** @param {string | Action | Mix | import('./api.js').Source} source @param {PlayOptions} [options] */
    play(source: string | Action | Mix | import("./api.js").Source, options?: PlayOptions): Layer & {
        done: Promise<import("./api.js").Done>;
    };
    /** Where the body's action lands its marker (rootmotion.js). */
    warpTo: ({
        marker: string;
    } & ({
        node: import("./api.js").TransformNode;
    } | {
        position: import("./api.js").Vector3;
        facing?: import("./api.js").Vector3;
    })) | undefined;
    /** @param {{ blend?: number }} [options] */
    stop({ blend }?: {
        blend?: number;
    }): void;
    /** @param {Done} result */
    finish(result: Done): void;
    /** The additive reference: the source's first frame, the rest pose, or another action's first frame. @param {Action | Mix | Custom} source */
    setReference(source: Action | Mix | Custom): void;
    /** Dead blending from the pose shown last, by its velocity. @param {number} blend */
    startBlend(blend: number): void;
    /** Runs the from-pose on by its decaying velocity, and blends `out` from it. @param {number} dt */
    applyBlend(dt: number): void;
    /** This layer over `pose` (step 4). @param {Float32Array} pose @param {number} dt */
    apply(pose: Float32Array, dt: number): void;
}
/**
 * A character from an armature of the scene, by name: its names (actions, markers, bone collections, roles, keyed
 * properties) are the package's for that armature (names.d.ts).
 * @template {import('./names.js').ArmatureName} [N=string]
 */
export class Character<N extends import("./names.js").ArmatureName = string> {
    /** @type {'auto' | import('./api.js').Tier} */ static quality: "auto" | import("./api.js").Tier;
    /** @type {import('./api.js').Tier} */ static tier: import("./api.js").Tier;
    static "__#5@#pickTier": (tier: import("./api.js").Tier, ms: number) => import("./api.js").Tier;
    static "__#5@#lastFrame": number;
    /** Feeds the page's frame time once a frame (the first character to tick takes it). @param {number} ms @param {number} frameId */
    static frameTime(ms: number, frameId: number): void;
    /**
     * @param {any} blend the loaded scene (load's result)
     * @param {N} armature
     * @param {{ roles?: Record<string, string | string[] | string[][]>, input?: 'default' | (() => Intent) | null,
     *   responsiveness?: number, ground?: (string | RegExp)[], idle?: boolean, seed?: number, manual?: boolean,
     *   preset?: { body?: string, effects?: [string, object][] } }} [options]
     * `manual`: updated by `update(seconds)` (a recording's clock, Node) instead of each frame the scene draws.
     */
    constructor(blend: any, armature: N, options?: {
        roles?: Record<string, string | string[] | string[][]>;
        input?: "default" | (() => Intent) | null;
        responsiveness?: number;
        ground?: (string | RegExp)[];
        idle?: boolean;
        seed?: number;
        manual?: boolean;
        preset?: {
            body?: string;
            effects?: [string, object][];
        };
    });
    blend: any;
    armature: N;
    rig: import("./rig.js").Rig;
    clips: Map<string, import("./clip.js").Clip>;
    roles: Record<string, string | string[] | string[][]>;
    random: () => number;
    /** @type {'default' | (() => Intent) | null} */
    input: "default" | (() => Intent) | null;
    speed: number;
    /** The armature's node, which the movement moves (a node of its own where the scene has none). */
    node: TransformNode;
    /** The movement (movement.js) that owns the root. */
    movement: import("./api.js").Movement & {
        responsiveness: number;
        push(by: Vector3): void;
        place(position: Vector3, facing: Vector3, seconds: number): Promise<void>;
        turnTo(facing: Vector3, seconds: number): Promise<void>;
        dispose(): void;
    };
    velocity: Vector3;
    /** @type {((() => Intent) & { dispose(): void }) | null} */
    keys: ((() => Intent) & {
        dispose(): void;
    }) | null;
    /** @type {{ update(dt: number): void } | null} */
    rootMotion: {
        update(dt: number): void;
    } | null;
    /** This frame's intent (step 1). @type {Intent} */
    intent: Intent;
    /** @type {{ effect: import('./api.js').Effect, handle: any, roles: Record<string, number | number[]>, before: Float32Array }[]} */
    effects: {
        effect: import("./api.js").Effect;
        handle: any;
        roles: Record<string, number | number[]>;
        before: Float32Array;
    }[];
    /** @type {Record<string, any[]>} each step's effects in run order, remade when one is added or removed */
    phases: Record<string, any[]>;
    /** @type {Map<string, number>} */
    legs: Map<string, number>;
    /** @type {Map<string, string[]> | null} the rig's bone collections, read when a mask first names one */
    groups: Map<string, string[]> | null;
    /** @type {Map<string, TransformNode>} the nodes bone() made */
    followers: Map<string, TransformNode>;
    /** @type {any} */
    debugging: any;
    poseApi: import("./api.js").Pose;
    pose: Float32Array<ArrayBuffer>;
    onMarker: Observable<any>;
    dt: number;
    frame: number;
    time: number;
    /** @type {Map<string, Action>} */
    actions: Map<string, Action>;
    /** @type {Map<import('./api.js').Source, Custom>} */
    customs: Map<import("./api.js").Source, Custom>;
    /** @type {Layer[]} */
    layers: Layer[];
    body: Layer;
    /** Locomotion (locomotion.js): its state's fields (actions, stances, stance, speeds) are its own. */
    locomotion: any;
    schedule: {
        onScreen: () => boolean;
        step(dt: number): number;
    };
    ticking: any;
    /** The package's own clips of this rig stop: the character plays its actions from now on. */
    offTimeline(): void;
    /** An action by name with its options; the same name and options give the same source. @param {import('./names.js').ActionOf<N>} name @param {ActionOptions} [options] */
    action(name: import("./names.js").ActionOf<N>, options?: ActionOptions): Action;
    /** @param {Partial<Record<import('./names.js').ActionOf<N>, number>>} points */
    mix(points: Partial<Record<import("./names.js").ActionOf<N>, number>>): Mix;
    set responsiveness(seconds: number);
    get responsiveness(): number;
    /**
     * @param {import('@babylonjs/core').TransformNode | Vector3} target
     * @returns {Intent}
     */
    steer(target: import("@babylonjs/core").TransformNode | Vector3): Intent;
    /**
     * @param {import('@babylonjs/core').TransformNode | Vector3} target @param {{ run?: boolean }} [options]
     * @returns {Promise<void>}
     */
    walkTo(target: import("@babylonjs/core").TransformNode | Vector3, options?: {
        run?: boolean;
    }): Promise<void>;
    /**
     * @param {import('@babylonjs/core').TransformNode} node @param {{ seconds?: number }} [options]
     * @returns {Promise<void>}
     */
    place(node: import("@babylonjs/core").TransformNode, options?: {
        seconds?: number;
    }): Promise<void>;
    /**
     * @param {import('@babylonjs/core').TransformNode | Vector3} target @param {{ seconds?: number }} [options]
     * @returns {Promise<void>}
     */
    turnTo(target: import("@babylonjs/core").TransformNode | Vector3, options?: {
        seconds?: number;
    }): Promise<void>;
    /**
     * How much a foot is down, 0 to 1, by its role (`'foot.L'`), from the body's action or its source's own
     * `contact(leg)`.
     * @param {import('./names.js').RoleOf<N>} foot
     */
    contact(foot: import("./names.js").RoleOf<N>): any;
    /** The index in roles.legs of the leg ending in a foot role, or -1; found once per role. @param {string} foot */
    legOf(foot: string): number;
    /** A bone by role or name: a role's own bone, a chain's end. @param {string} roleOrName @returns {string} */
    boneName(roleOrName: string): string;
    /** A node that follows a bone (by role or name) as drawn, for props and hit volumes; one per bone. @param {string} roleOrName */
    bone(roleOrName: string): TransformNode;
    /** What moves a bone, and the rig drawn by Babylon's SkeletonViewer while `show` is set. */
    get debug(): any;
    /** Whether a bone is posed by an action with a sound (an actor's own eyes and breathing win). @param {number} bone */
    voiced(bone: number): boolean;
    /**
     * Attaches an effect: its roles resolved to bones (throwing for one the rig lacks), its state from `init`, run each
     * frame at its step, scaled by its weight.
     * @template {import('./api.js').Effect<any>} E @param {E} effect @param {{ weight?: number }} [options]
     */
    add<E extends import("./api.js").Effect<any>>(effect: E, { weight }?: {
        weight?: number;
    }): any;
    /** The roles as bones (indices in the pose), as effects and sources get them. */
    boneRoles(): Record<string, any>;
    /** An attached effect's handle by name. @param {string} name */
    effect(name: string): any;
    /** The effects at one step, in order: those named in `order` first, as listed, then the rest as added. @param {'controls' | 'deform'} on @param {number} dt */
    runEffects(on: "controls" | "deform", dt: number): void;
    /** The effects of one step in run order: ORDER's, then others in the order added. @param {string} on */
    ordered(on: string): {
        effect: import("./api.js").Effect;
        handle: any;
        roles: Record<string, number | number[]>;
        before: Float32Array;
    }[];
    /** A source of defineSource, run once per character. @param {import('./api.js').Source} source */
    custom(source: import("./api.js").Source): Custom;
    /**
     * @param {string} name
     * @param {{ group?: import('./names.js').GroupOf<N>, roles?: import('./names.js').RoleOf<N>[], bones?: string[], weight?: number,
     *   add?: boolean | { from: 'rest' | import('./names.js').ActionOf<N> } }} [options]
     */
    layer(name: string, options?: {
        group?: import("./names.js").GroupOf<N>;
        roles?: import("./names.js").RoleOf<N>[];
        bones?: string[];
        weight?: number;
        add?: boolean | {
            from: "rest" | import("./names.js").ActionOf<N>;
        };
    }): Layer;
    /** Whether a layer plays this source now. @param {Action | Mix | Custom} source */
    playing(source: Action | Mix | Custom): boolean;
    /**
     * A layer's mask: all bones, or those of a bone collection, roles or names, each with the bones under it.
     * @param {{ group?: string, roles?: string[], bones?: string[] }} options
     */
    mask({ group, roles, bones }: {
        group?: string;
        roles?: string[];
        bones?: string[];
    }): Float32Array<ArrayBuffer>;
    /** @param {Action} action */
    onEnd(action: Action): void;
    /** @param {Action} action @param {string} name */
    marker(action: Action, name: string): void;
    /** A keyed custom property of the body's action at its current time (0 when it keys none). @param {import('./names.js').PropertyOf<N>} name */
    property(name: import("./names.js").PropertyOf<N>): number;
    /**
     * The voice of an action's sound strip, timed against the action's first frame, from the head.
     * @param {string} action @param {string} name @param {boolean} spatial
     */
    voiceOf(action: string, name: string, spatial: boolean): {
        readonly ready: boolean;
        readonly failed: boolean;
        time(): number | null;
        play(at: number): void;
        pause(): void;
        follow(): void;
        dispose(): void;
    };
    /** One frame, in the guide's order; `speed` scales the movement's and the sources' time. @param {number} dt */
    update(dt: number): void;
    dispose(): void;
}
export type Intent = import("./api.js").Intent;
export type ActionOptions = import("./api.js").ActionOptions;
export type PlayOptions = import("./api.js").PlayOptions;
export type Done = import("./api.js").Done;
export type Clip = import("./clip.js").Clip;
import { Observable } from '@babylonjs/core';
import { TransformNode } from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';
