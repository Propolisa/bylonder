// tags: behaviors, sound
// Rock Hard Café's procedural sounds (examples/rock-hard-cafe/src/sounds.js): each builds its Web Audio graph on a
// mocked AudioContext without throwing and draws its variations from the seed it is given, so the same seed builds the
// same graph and another seed another.
import assert from 'node:assert/strict';
import { createSounds, BREW, MATERIALS } from '../examples/rock-hard-cafe/src/sounds.js';

/** A mocked AudioContext that records every node made and every parameter set, in order. */
function mockContext(log) {
  const param = (name) => new Proxy({ value: 0 }, {
    get: (target, key) => (key === 'value' ? target.value : (...args) => log.push(`${name}.${String(key)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(4) : a)).join(',')})`)),
    set: (target, key, value) => { if (key === 'value') { target.value = value; log.push(`${name}=${value.toFixed?.(4) ?? value}`); } return true; },
  });
  let made = 0;
  const node = (kind) => {
    const id = `${kind}${made++}`;
    const self = {
      id, connected: [],
      connect(to) { self.connected.push(to); return to; },
      disconnect() {}, start: (t) => log.push(`${id}.start(${t.toFixed(4)})`), stop: (t) => log.push(`${id}.stop(${t.toFixed(4)})`),
      gain: param(`${id}.gain`), frequency: param(`${id}.frequency`), detune: param(`${id}.detune`), Q: param(`${id}.Q`),
      set type(v) { log.push(`${id}.type=${v}`); }, buffer: null,
    };
    return self;
  };
  return {
    sampleRate: 8000, currentTime: 0,
    createGain: () => node('gain'), createOscillator: () => node('osc'), createBiquadFilter: () => node('filter'), createBufferSource: () => node('source'),
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
  };
}
const build = (seed) => {
  const log = [], context = mockContext(log), destination = { id: 'destination', connect: () => {} };
  const sounds = createSounds({ context, destination }, seed);
  for (const [name, at] of Object.entries(BREW)) sounds[name](at);
  sounds.splash(0);
  for (const material of Object.keys(MATERIALS)) sounds.impact(1, { size: 0.09, speed: 4, material, breaks: material === 'ceramic' });
  return log;
};
const first = build(0.25);
assert.ok(first.length > 200, `the brew and the splash build their graphs: ${first.length} steps`);
assert.deepEqual(build(0.25), first, 'the same seed builds the same sounds');
assert.notDeepEqual(build(0.75), first, 'another seed, other variations');
assert.ok(!first.some((step) => /NaN|Infinity/.test(step)), 'no parameter is NaN or infinite');
console.log(`café sounds: the brew (${Object.keys(BREW).join(', ')}), the splash and the impacts (${Object.keys(MATERIALS).join(', ')}) build on a mocked context, the same for a seed`);
process.exit(0);
