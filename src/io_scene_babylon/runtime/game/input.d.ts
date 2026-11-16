/**
 * Input over `map` from a target's key and pointer events (a canvas or window), or none for a test.
 * @param {Record<string, string[]>} map @param {EventTarget} [target]
 */
export function createInput(map: Record<string, string[]>, target?: EventTarget): {
    /** True on the frame an action's key went down. @param {string} action */
    pressed: (action: string) => boolean;
    /** True while an action's key is held. @param {string} action */
    held: (action: string) => boolean;
    /** A stick from an action's four keys (up, left, down, right) or a gamepad's stick: x right, y forward, each -1 to 1. @param {string} action */
    stick(action: string): {
        x: number;
        y: number;
    };
    /** Where the pointer is over the canvas (CSS pixels from its top left, as `scene.pick` takes them), null before it moved. */
    readonly pointer: {
        x: number;
        y: number;
    } | null;
    /** Whether a finger has touched the target: a game shows its touch controls from then on. */
    readonly touch: boolean;
    /** The next frame: keys that went down since the last are this frame's presses. */
    step(): void;
    /** A test's or a replay's key, by action: `press` for one frame, `hold` until released. @param {string} action @param {boolean} [on] */
    hold(action: string, on?: boolean): void;
    /** @param {string} action */
    press(action: string): void;
    /** A test's or a replay's key by its KeyboardEvent.code (`KeyD`), held or let go. @param {string} code @param {boolean} [on] */
    key(code: string, on?: boolean): void;
    /** A test's or a replay's pointer, in CSS pixels. @param {number} x @param {number} y */
    point(x: number, y: number): void;
    dispose(): void;
};
