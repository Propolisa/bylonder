// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A game's mapped input (defineGame's `input`: an action to the keys that drive it, `Move: ['WASD']`, `Use: ['E']`):
// keys held and pressed this frame, a stick from four keys. A run steps it once a frame; a test drives it by action.

/** Each key of a mapping, as KeyboardEvent.code reads it: `WASD` the four of a stick, `E` KeyE, `Space` Space. @param {string} key */
const codes = (key) => (key === 'WASD' ? ['KeyW', 'KeyA', 'KeyS', 'KeyD'] : key === 'Arrows' ? ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']
  : /^[A-Z]$/.test(key) ? [`Key${key}`] : /^\d$/.test(key) ? [`Digit${key}`] : [key]);

/**
 * Input over `map` from a target's key events (a canvas or window), or none for a test.
 * @param {Record<string, string[]>} map @param {EventTarget} [target]
 */
export function createInput(map, target) {
  const held = new Set(), down = new Set();
  /** @type {Set<string>} */
  let pressedNow = new Set();
  const keysOf = (/** @type {string} */ action) => (map[action] ?? []).flatMap(codes);
  const onDown = (/** @type {any} */ e) => { if (!held.has(e.code)) down.add(e.code); held.add(e.code); };
  const onUp = (/** @type {any} */ e) => held.delete(e.code);
  target?.addEventListener('keydown', onDown);
  target?.addEventListener('keyup', onUp);
  return {
    /** True on the frame an action's key went down. @param {string} action */
    pressed: (action) => keysOf(action).some((code) => pressedNow.has(code)),
    /** True while an action's key is held. @param {string} action */
    held: (action) => keysOf(action).some((code) => held.has(code)),
    /** A stick from an action's four keys (up, left, down, right): x right, y forward, each -1 to 1. @param {string} action */
    stick(action) {
      const [up, left, back, right] = keysOf(action).map((code) => (held.has(code) ? 1 : 0));
      return { x: (right ?? 0) - (left ?? 0), y: (up ?? 0) - (back ?? 0) };
    },
    /** The next frame: keys that went down since the last are this frame's presses. */
    step() { pressedNow = new Set(down); down.clear(); },
    /** A test's or a replay's key, by action: `press` for one frame, `hold` until released. @param {string} action @param {boolean} [on] */
    hold(action, on = true) { const code = keysOf(action)[0]; if (on) { if (!held.has(code)) down.add(code); held.add(code); } else held.delete(code); },
    /** @param {string} action */
    press(action) { const code = keysOf(action)[0]; down.add(code); },
    dispose() { target?.removeEventListener('keydown', onDown); target?.removeEventListener('keyup', onUp); },
  };
}
