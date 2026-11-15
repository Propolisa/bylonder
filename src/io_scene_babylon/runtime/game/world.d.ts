/**
 * A stick's `{ x, y }` on the ground as `camera` shows it: x toward the screen's right, y toward its top (forward for a
 * camera behind, up the screen for one looking down); as the scene's x and z without a camera.
 * @param {import('@babylonjs/core').Camera | null | undefined} camera @param {number} x @param {number} y
 */
export function onGround(camera: import("@babylonjs/core").Camera | null | undefined, x: number, y: number): Vector3;
/**
 * The run's clock for a behaviour or system.
 * @typedef {{ readonly now: number, wait(seconds: number): Promise<void>, every(seconds: number): boolean, pick<T>(list: T | T[]): T, random(): number }} Time
 * An object of the run as game code reaches it.
 * @typedef {{
 *   key: string, name: string, node: any, readonly position: Vector3, readonly rotation: Vector3, readonly scaling: Vector3,
 *   hide(): void, show(): void, readonly visible: boolean, material(): MaterialHandle, play(action: string): void,
 *   authored: { readonly position: Vector3, material(): { get(name: string): any, readonly baseColor: any } },
 * }} Entity
 * @typedef {{ set(name: string, value: any): void, get(name: string): any, readonly baseColor: any }} MaterialHandle
 * The run, as behaviours and systems reach it.
 * @typedef {{
 *   get(system: System): any, all(behavior: Behavior): any[], near(from: Entity, radius: number, behavior: Behavior, filter?: (handle: any) => boolean): any,
 *   on(behavior: Behavior, event: string, fn: (data: any, from: any) => void): void, emit(target: any, event: string, data?: any): void,
 *   play(sound: string, options?: { at?: Entity, rate?: number, volume?: number }): void, end(result?: any): void,
 *   spawn(collection: string, options?: { at?: Entity, attachTo?: any, jitter?: number }): Entity | null,
 *   camera: { follow(entity: Entity, options?: { pitch?: number, distance?: number, height?: number }): void, controls: boolean, onGround(stick: { x: number, y: number }): Vector3 },
 * }} Game
 */
/**
 * A run of `behaviors` (by name) and the game's systems over `host`.
 * `havok`: Havok's wasm instance, for a game with `physics: 'havok'` (game/physics.js).
 * @param {{ host: Host, behaviors: Behavior[], game?: import('./define.js').GameDefinition, seed?: number, engine?: import('@babylonjs/core').AbstractEngine,
 *   kept?: { states?: Map<string, any>, saved?: Map<string, any> }, input?: Input, assets?: Assets, havok?: any, dev?: boolean, report?: (error: unknown, where: string) => void }} options
 */
export function createWorld({ host, behaviors, game: composition, seed, engine, kept, input, assets, havok, dev, report }: {
    host: Host;
    behaviors: Behavior[];
    game?: import("./define.js").GameDefinition;
    seed?: number;
    engine?: import("@babylonjs/core").AbstractEngine;
    kept?: {
        states?: Map<string, any>;
        saved?: Map<string, any>;
    };
    input?: Input;
    assets?: Assets;
    havok?: any;
    dev?: boolean;
    report?: (error: unknown, where: string) => void;
}): {
    game: Game;
    timeFor: (who: {
        made: Set<{
            dispose(): void;
        }>;
        listeners: Set<() => void>;
        disposed: boolean;
        label: string;
    }) => Time;
    entityOf: (object: HostObject) => Entity;
    /** The run's result once a system ended it, else undefined. */
    readonly ended: any;
    readonly now: number;
    /** The behaviours' instances, by `objectKey/Behavior`. */
    instances: Map<string, {
        key: string;
        definition: Behavior;
        entity: any;
        state: any;
        owner: {
            made: Set<{
                dispose(): void;
            }>;
            listeners: Set<() => void>;
            disposed: boolean;
            label: string;
        };
        handlers: any;
    }>;
    start: () => void;
    /** Advances the run by `dt` seconds: waits due resume, physics steps, then each behaviour's and system's `update`. @param {number} dt */
    step(dt: number): Promise<void>;
    /** What a hot swap carries to the next run: each instance's state and each system's save(). */
    keep: () => {
        states: Map<string, any>;
        saved: Map<string, any>;
    };
    /**
     * Swaps in new definitions: every instance and system made again from them, with the same state. Where a `create`
     * throws, the run goes back to the definitions it had, its state as it was, and the errors are returned.
     * @param {Behavior[]} next @param {import('./define.js').GameDefinition} [nextGame] @returns {unknown[]}
     */
    swap(next: Behavior[], nextGame?: import("./define.js").GameDefinition): unknown[];
    /** Adds the behaviours of an object that appeared (spawned, duplicated while playing), with fresh state. @param {HostObject} object */
    added(object: HostObject): void;
    /** Disposes the behaviours of an object that went. @param {string} key */
    removed(key: string): void;
    /**
     * Follows the scene after an edit reached the run: behaviours of objects that appeared (Shift D: props copied, state
     * fresh) are created, those of objects or behaviours that went are disposed.
     */
    sync(): void;
    dispose(): void;
};
export function idleInput(): Input;
/**
 * An object of the run as game code reaches it.
 */
export type Time = {
    readonly now: number;
    wait(seconds: number): Promise<void>;
    every(seconds: number): boolean;
    pick<T>(list: T | T[]): T;
    random(): number;
};
/**
 * The run's clock for a behaviour or system.
 */
export type Entity = {
    key: string;
    name: string;
    node: any;
    readonly position: Vector3;
    readonly rotation: Vector3;
    readonly scaling: Vector3;
    hide(): void;
    show(): void;
    readonly visible: boolean;
    material(): MaterialHandle;
    play(action: string): void;
    authored: {
        readonly position: Vector3;
        material(): {
            get(name: string): any;
            readonly baseColor: any;
        };
    };
};
/**
 * The run, as behaviours and systems reach it.
 */
export type MaterialHandle = {
    set(name: string, value: any): void;
    get(name: string): any;
    readonly baseColor: any;
};
/**
 * The run's clock for a behaviour or system.
 */
export type Game = {
    get(system: System): any;
    all(behavior: Behavior): any[];
    near(from: Entity, radius: number, behavior: Behavior, filter?: (handle: any) => boolean): any;
    on(behavior: Behavior, event: string, fn: (data: any, from: any) => void): void;
    emit(target: any, event: string, data?: any): void;
    play(sound: string, options?: {
        at?: Entity;
        rate?: number;
        volume?: number;
    }): void;
    end(result?: any): void;
    spawn(collection: string, options?: {
        at?: Entity;
        attachTo?: any;
        jitter?: number;
    }): Entity | null;
    camera: {
        follow(entity: Entity, options?: {
            pitch?: number;
            distance?: number;
            height?: number;
        }): void;
        controls: boolean;
        onGround(stick: {
            x: number;
            y: number;
        }): Vector3;
    };
};
/**
 * The scene a run plays, as game/blend-host.js gives it from a package's controller.
 */
export type Host = {
    scene: import("@babylonjs/core").Scene;
    objects: () => HostObject[];
    bodies?: () => HostObject[];
    value: (object: string, behavior: string, prop: string) => any;
    play?: (action: string, object: string) => void;
    playSound?: (sound: string, at?: Entity, options?: {
        rate?: number;
        volume?: number;
    }) => void;
    played?: string[];
    spawn?: (collection: string) => HostObject[];
    blend?: any;
};
/**
 * The scene a run plays, as game/blend-host.js gives it from a package's controller.
 */
export type HostObject = {
    key: string;
    name: string;
    node: import("@babylonjs/core").TransformNode | null;
    behaviors: string[];
    rigid?: Record<string, any> | null;
};
/**
 * The scene a run plays, as game/blend-host.js gives it from a package's controller.
 */
export type Behavior = import("./define.js").Behavior;
/**
 * The scene a run plays, as game/blend-host.js gives it from a package's controller.
 */
export type System = import("./define.js").System;
/**
 * The scene a run plays, as game/blend-host.js gives it from a package's controller.
 */
export type Babylon = {
    scene: import("@babylonjs/core").Scene;
    engine: import("@babylonjs/core").AbstractEngine;
};
/**
 * The project's files a run reads (an Ink story, a GUI layout): `url(path)`, and `text(path)` read.
 */
export type Input = {
    pressed(action: string): boolean;
    held(action: string): boolean;
    stick(action: string): {
        x: number;
        y: number;
    };
    readonly pointer?: {
        x: number;
        y: number;
    } | null;
    step?: () => void;
};
/**
 * The scene a run plays, as game/blend-host.js gives it from a package's controller.
 */
export type Assets = {
    url(path: string): string;
    text(path: string): Promise<string>;
};
import { Vector3 } from '@babylonjs/core';
