/**
 * Runs `code` (its behaviours and its game) on `blend`. `canvas` gives the keys; `step: false` leaves stepping to the
 * caller (a test's clock), else the run steps before each frame while `paused()` is false.
 * @param {any} blend the loaded scene (BlendScene)
 * @param {{ behaviors: import('./define.js').Behavior[], game?: import('./define.js').GameDefinition }} code
 * @param {{ canvas?: EventTarget, assets?: import('./world.js').Assets, seed?: number, engine?: import('@babylonjs/core').AbstractEngine,
 *   kept?: { states?: Map<string, any>, saved?: Map<string, any> }, step?: boolean, paused?: () => boolean, report?: (error: unknown, where: string) => void }} [options]
 */
export function runGame(blend: any, code: {
    behaviors: import("./define.js").Behavior[];
    game?: import("./define.js").GameDefinition;
}, { canvas, assets, seed, engine, kept, step, paused, report }?: {
    canvas?: EventTarget;
    assets?: import("./world.js").Assets;
    seed?: number;
    engine?: import("@babylonjs/core").AbstractEngine;
    kept?: {
        states?: Map<string, any>;
        saved?: Map<string, any>;
    };
    step?: boolean;
    paused?: () => boolean;
    report?: (error: unknown, where: string) => void;
}): {
    world: {
        game: import("./world.js").Game;
        timeFor: (who: {
            made: Set<{
                dispose(): void;
            }>;
            listeners: Set<() => void>;
            disposed: boolean;
            label: string;
        }) => import("./world.js").Time;
        entityOf: (object: import("./world.js").HostObject) => import("./world.js").Entity;
        readonly ended: any;
        readonly now: number;
        instances: Map<string, {
            key: string;
            definition: import("./world.js").Behavior;
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
        step(dt: number): Promise<void>;
        keep: () => {
            states: Map<string, any>;
            saved: Map<string, any>;
        };
        swap(next: import("./world.js").Behavior[], nextGame?: import("./define.js").GameDefinition): unknown[];
        added(object: import("./world.js").HostObject): void;
        removed(key: string): void;
        sync(): void;
        dispose(): void;
    };
    input: {
        pressed: (action: string) => boolean;
        held: (action: string) => boolean;
        stick(action: string): {
            x: number;
            y: number;
        };
        step(): void;
        hold(action: string, on?: boolean): void;
        press(action: string): void;
        dispose(): void;
    };
    blend: any;
    dispose(): void;
};
/** The behaviours the runtime brings, which a project adds to objects without writing them. */
export const BUILTINS: import("./define.js").Behavior[];
