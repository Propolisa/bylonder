/**
 * Input over `map` from a target's key events (a canvas or window), or none for a test.
 * @param {Record<string, string[]>} map @param {EventTarget} [target]
 */
export function createInput(map: Record<string, string[]>, target?: EventTarget): {
    /** True on the frame an action's key went down. @param {string} action */
    pressed: (action: string) => boolean;
    /** True while an action's key is held. @param {string} action */
    held: (action: string) => boolean;
    /** A stick from an action's four keys (up, left, down, right): x right, y forward, each -1 to 1. @param {string} action */
    stick(action: string): {
        x: number;
        y: number;
    };
    /** The next frame: keys that went down since the last are this frame's presses. */
    step(): void;
    /** A test's or a replay's key, by action: `press` for one frame, `hold` until released. @param {string} action @param {boolean} [on] */
    hold(action: string, on?: boolean): void;
    /** @param {string} action */
    press(action: string): void;
    dispose(): void;
};
