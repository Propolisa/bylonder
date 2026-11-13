// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// An action's sound (docs/character-animation.md, Sound): the .blend's sound strip of that name, played from the
// character's head through a Web Audio panner, and the clock the action follows while it plays. Until the browser
// allows sound (the first gesture), the action runs on the page's clock and the sound joins it in step.

/** Where a strip starts against its action's first frame, and its decoded audio, per URL. @type {Map<string, Promise<AudioBuffer>>} */
const decoded = new Map();

/** The page's audio context, made once and resumed at the first gesture. @type {AudioContext | null} */
let shared = null;
/** @returns {AudioContext | null} */
function audioContext() {
  const Context = /** @type {typeof AudioContext | undefined} */ (globalThis.AudioContext);
  if (!Context) return null;
  if (!shared) {
    shared = new Context();
    const unlock = () => { shared?.resume(); for (const type of ['pointerdown', 'keydown', 'touchend']) globalThis.removeEventListener?.(type, unlock); };
    for (const type of ['pointerdown', 'keydown', 'touchend']) globalThis.addEventListener?.(type, unlock);
  }
  return shared;
}

/**
 * The voice of an action with a sound: `time()` is the action's time by the sound (null until it plays), and
 * `play(at)`, `pause()` follow the action. A strip that fails to load warns and leaves the action on the page's clock.
 * @param {{ url: string, start: number, offset: number, volume: number }} strip the strip (BlendScene.sounds), `start`
 *   against the action's first frame @param {{ spatial?: boolean, head?: () => import('@babylonjs/core').Vector3 | null }} options
 * @param {AudioContext | null} [context]
 */
export function createVoice(strip, { spatial = true, head = () => null } = {}, context = audioContext()) {
  /** @type {AudioBuffer | null} */
  let buffer = null;
  /** @type {AudioBufferSourceNode | null} */
  let playing = null;
  let startedAt = 0, from = 0, wanted = /** @type {number | null} */ (null), failed = false;
  if (context && !decoded.has(strip.url)) {
    decoded.set(strip.url, fetch(strip.url).then((r) => r.arrayBuffer()).then((bytes) => context.decodeAudioData(bytes)));
  }
  decoded.get(strip.url)?.then((b) => { buffer = b; if (wanted !== null) voice.play(wanted); }, (error) => {
    failed = true;
    console.warn(`The sound ${strip.url} did not load (${error?.message ?? error}): its action plays on the page's clock`);
  });
  const panner = context && spatial ? context.createPanner() : null;
  const gain = context?.createGain() ?? null;
  if (gain && context) {
    gain.gain.value = strip.volume;
    if (panner) {
      gain.connect(panner);
      panner.connect(context.destination);
    } else gain.connect(context.destination);
  }

  const voice = {
    /** Whether the sound can play now (loaded and allowed). */
    get ready() { return !!buffer && context?.state === 'running'; },
    get failed() { return failed || !context; },
    /** The action's time by the sound, or null while it does not play. */
    time() {
      if (!playing || !context) return null;
      const latency = /** @type {any} */ (context).outputLatency ?? 0;
      return from + (context.currentTime - latency - startedAt);
    },
    /** Plays from the action's time `at` (the strip's part from `at`). @param {number} at */
    play(at) {
      wanted = at;
      if (!buffer || !context || !gain) return;
      voice.pause();
      const into = at - strip.start;
      if (into >= buffer.duration) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      startedAt = context.currentTime + Math.max(0, -into);
      from = Math.max(0, into) + strip.start;
      source.start(startedAt, strip.offset + Math.max(0, into));
      playing = source;
    },
    pause() {
      playing?.stop();
      playing = null;
    },
    /** The head's place, each frame. */
    follow() {
      const at = head();
      if (at && panner) { panner.positionX.value = at.x; panner.positionY.value = at.y; panner.positionZ.value = at.z; }
    },
    dispose() { voice.pause(); gain?.disconnect(); panner?.disconnect(); },
  };
  return voice;
}
