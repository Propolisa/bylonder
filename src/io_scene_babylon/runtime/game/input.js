// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A game's mapped input (defineGame's `input`: an action to the keys and buttons that drive it, `Move: ['WASD',
// 'LeftStick']`, `Grab: ['Space', 'MouseLeft', 'South']`): held and pressed this frame, a stick from four keys or a
// gamepad's stick, and the pointer over the canvas. A finger is not a mouse: touches leave the pointer and the mouse
// buttons alone, for the game's own touch controls. A run steps it once a frame; a test drives it by action and point.

/** Each key of a mapping, as KeyboardEvent.code reads it: `WASD` the four of a stick, `E` KeyE, `Space` Space. @param {string} key */
const codes = (key) => (key === 'WASD' ? ['KeyW', 'KeyA', 'KeyS', 'KeyD'] : key === 'Arrows' ? ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']
  : /^[A-Z]$/.test(key) ? [`Key${key}`] : /^\d$/.test(key) ? [`Digit${key}`] : [key]);
/** Mouse buttons by PointerEvent.button, and a standard gamepad's buttons by index, as mappings name them. */
const MOUSE = ['MouseLeft', 'MouseMiddle', 'MouseRight'];
const PAD = ['South', 'East', 'West', 'North', 'LeftShoulder', 'RightShoulder', 'LeftTrigger', 'RightTrigger'];
/** A standard gamepad's sticks: their axes, x right and y down. */
const STICKS = { LeftStick: [0, 1], RightStick: [2, 3] };
const DEAD = 0.15;

/**
 * Input over `map` from a target's key and pointer events (a canvas or window), or none for a test.
 * @param {Record<string, string[]>} map @param {EventTarget} [target]
 */
export function createInput(map, target) {
  const held = new Set(), down = new Set();
  /** @type {Set<string>} */
  let pressedNow = new Set(), padHeld = new Set();
  /** The pointer over the target, in CSS pixels from its top left, as Babylon's scene.pick takes it. @type {{ x: number, y: number } | null} */
  let pointer = null, touched = false;
  /** The gamepad's sticks this frame. @type {Record<string, { x: number, y: number }>} */
  const sticks = {};
  const keysOf = (/** @type {string} */ action) => (map[action] ?? []).flatMap(codes);
  const press = (/** @type {string} */ code) => { if (!held.has(code)) down.add(code); held.add(code); };
  const onDown = (/** @type {any} */ e) => press(e.code);
  const onUp = (/** @type {any} */ e) => held.delete(e.code);
  const onPointer = (/** @type {any} */ e) => {
    if (e.pointerType === 'touch') { touched = true; return; }
    const box = e.currentTarget?.getBoundingClientRect?.();
    pointer = { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
    if (e.type === 'pointerdown' && MOUSE[e.button]) press(MOUSE[e.button]);
    if (e.type === 'pointerup' && MOUSE[e.button]) held.delete(MOUSE[e.button]);
  };
  const listeners = /** @type {[string, (e: any) => void][]} */ ([['keydown', onDown], ['keyup', onUp], ['pointermove', onPointer], ['pointerdown', onPointer], ['pointerup', onPointer]]);
  for (const [type, fn] of listeners) target?.addEventListener(type, fn);
  /** The first connected gamepad's buttons and sticks, read once a frame. */
  const readPad = () => {
    const pad = [...(globalThis.navigator?.getGamepads?.() ?? [])].find(Boolean);
    const now = new Set(pad ? PAD.filter((_, i) => pad.buttons[i]?.pressed) : []);
    for (const code of now) if (!padHeld.has(code)) press(code);
    for (const code of padHeld) if (!now.has(code)) held.delete(code);
    padHeld = now;
    for (const [name, [x, y]] of Object.entries(STICKS)) {
      const ax = pad?.axes[x] ?? 0, ay = pad?.axes[y] ?? 0;
      sticks[name] = Math.hypot(ax, ay) < DEAD ? { x: 0, y: 0 } : { x: ax, y: -ay };
    }
  };
  return {
    /** True on the frame an action's key went down. @param {string} action */
    pressed: (action) => keysOf(action).some((code) => pressedNow.has(code)),
    /** True while an action's key is held. @param {string} action */
    held: (action) => keysOf(action).some((code) => held.has(code)),
    /** A stick from an action's four keys (up, left, down, right) or a gamepad's stick: x right, y forward, each -1 to 1. @param {string} action */
    stick(action) {
      const [up, left, back, right] = keysOf(action).filter((code) => !(code in STICKS)).map((code) => (held.has(code) ? 1 : 0));
      const keys = { x: (right ?? 0) - (left ?? 0), y: (up ?? 0) - (back ?? 0) };
      const pad = (map[action] ?? []).map((name) => sticks[name]).find((s) => s && (s.x || s.y));
      return pad ?? keys;
    },
    /** Where the pointer is over the canvas (CSS pixels from its top left, as `scene.pick` takes them), null before it moved. */
    get pointer() { return pointer; },
    /** Whether a finger has touched the target: a game shows its touch controls from then on. */
    get touch() { return touched; },
    /** The next frame: keys that went down since the last are this frame's presses. */
    step() { readPad(); pressedNow = new Set(down); down.clear(); },
    /** A test's or a replay's key, by action: `press` for one frame, `hold` until released. @param {string} action @param {boolean} [on] */
    hold(action, on = true) { const code = keysOf(action)[0]; if (on) press(code); else held.delete(code); },
    /** @param {string} action */
    press(action) { const code = keysOf(action)[0]; down.add(code); },
    /** A test's or a replay's key by its KeyboardEvent.code (`KeyD`), held or let go. @param {string} code @param {boolean} [on] */
    key(code, on = true) { if (on) press(code); else held.delete(code); },
    /** A test's or a replay's pointer, in CSS pixels. @param {number} x @param {number} y */
    point(x, y) { pointer = { x, y }; },
    dispose() { for (const [type, fn] of listeners) target?.removeEventListener(type, fn); },
  };
}
