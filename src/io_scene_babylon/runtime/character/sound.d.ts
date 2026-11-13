/**
 * The voice of an action with a sound: `time()` is the action's time by the sound (null until it plays), and
 * `play(at)`, `pause()` follow the action. A strip that fails to load warns and leaves the action on the page's clock.
 * @param {{ url: string, start: number, offset: number, volume: number }} strip the strip (BlendScene.sounds), `start`
 *   against the action's first frame @param {{ spatial?: boolean, head?: () => import('@babylonjs/core').Vector3 | null }} options
 * @param {AudioContext | null} [context]
 */
export function createVoice(strip: {
    url: string;
    start: number;
    offset: number;
    volume: number;
}, { spatial, head }?: {
    spatial?: boolean;
    head?: () => import("@babylonjs/core").Vector3 | null;
}, context?: AudioContext | null): {
    /** Whether the sound can play now (loaded and allowed). */
    readonly ready: boolean;
    readonly failed: boolean;
    /** The action's time by the sound, or null while it does not play. */
    time(): number | null;
    /** Plays from the action's time `at` (the strip's part from `at`). @param {number} at */
    play(at: number): void;
    pause(): void;
    /** The head's place, each frame. */
    follow(): void;
    dispose(): void;
};
