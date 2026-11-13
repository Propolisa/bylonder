// An action's sound (runtime/character/sound.js, the guide's Sound) with a stand-in Web Audio: until sound is allowed
// the action runs on the page's clock, or holds its first frame with waitForSound; once the sound plays, its clock
// drives the action, in step with where the strip starts against the action's first frame; pause stops the sound;
// an unknown strip throws naming those there are; a strip that fails to load leaves the action on the page's clock.
import assert from 'node:assert/strict';
import { basicBlend } from './fixtures/basic-blend.js';
import { Character } from '../src/io_scene_babylon/runtime/character/core.js';

// A stand-in AudioContext: suspended until resumed, its time moved by the test.
class FakeAudio {
  state = 'suspended';
  currentTime = 0;
  outputLatency = 0;
  destination = {};
  started = [];
  resume() { this.state = 'running'; return Promise.resolve(); }
  decodeAudioData() { return Promise.resolve({ duration: 10 }); }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createPanner() { return { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, connect() {}, disconnect() {} }; }
  createBufferSource() {
    const started = this.started;
    return { buffer: null, connect() {}, start(when, offset) { started.push({ when, offset }); }, stop() { started.push('stop'); } };
  }
}
const audio = new FakeAudio();
globalThis.AudioContext = function () { return audio; };
globalThis.fetch = async (url) => (String(url).includes('missing') ? Promise.reject(new Error('404')) : { arrayBuffer: async () => new ArrayBuffer(8) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const DT = 1 / 30;

const blend = basicBlend();
blend.sounds = { Line: { url: 'line.mp3', start: 0.5, offset: 0, duration: 3, volume: 1 }, Lost: { url: 'missing.mp3', start: 0, offset: 0, duration: 1, volume: 1 } };
const hero = new Character(blend, 'Armature', { manual: true });
assert.throws(() => hero.action('Idle', { sound: 'Song' }), /No sound strip "Song": the scene has "Line", "Lost"/, 'an unknown strip names those there are');

// waitForSound: the first frame holds until sound is allowed.
const line = hero.action('Idle', { sound: 'Line', waitForSound: true });
hero.body.play(line, { blend: 0 });
await settle();
for (let k = 0; k < 10; k++) hero.update(DT);
assert.equal(line.time, 0, 'waitForSound holds the first frame while sound is not allowed');

// Allowed: the sound starts at the action's time, and its clock drives the action.
await audio.resume();
hero.update(DT);
assert.equal(audio.started.length, 1, 'the sound starts once allowed');
assert.ok(Math.abs(audio.started[0].when - 0.5) < 1e-9 && audio.started[0].offset === 0, 'from where its strip starts against the action (0.5 s in)');
audio.currentTime = 1.25;
hero.update(DT);
assert.ok(Math.abs(line.time - 1.25) < 1e-9, `the sound's clock drives the action (${line.time})`);
line.pause();
assert.equal(audio.started.at(-1), 'stop', 'pause stops the sound');
line.resume();
hero.update(DT);
assert.ok(audio.started.at(-1).offset !== undefined && Math.abs(audio.started.at(-1).offset - 0.75) < 1e-9, 'resume starts it again where the action is (0.75 s into the strip)');
line.seek(1.5);
hero.update(DT);
assert.ok(Math.abs(audio.started.at(-1).offset - 1) < 1e-9, 'seek moves the sound with the action (1.5 s in: 1 s into the strip)');
assert.ok(Math.abs(line.time - 1.5) < 0.05, `and the action goes on from where it was sought (${line.time})`);

// Without waitForSound, an action plays on the page's clock until its sound can play; a failed load warns.
const warnings = [];
const warn = console.warn;
console.warn = (message) => warnings.push(message);
const lost = hero.action('Walk', { sound: 'Lost' });
hero.body.play(lost, { blend: 0 });
await settle();
await settle();
for (let k = 0; k < 6; k++) hero.update(DT);
console.warn = warn;
assert.ok(Math.abs(lost.time - 6 * DT) < 1e-9, 'an action whose sound failed runs on the page\'s clock');
assert.ok(warnings.some((w) => /missing\.mp3 did not load/.test(w)), 'and the failure is told');
console.log("Character sound: waitForSound holds, the sound's clock drives its action from where the strip starts, pause stops it, resume and seek restart it in step, a failure falls back to the page's clock");
