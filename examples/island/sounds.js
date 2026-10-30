// The film's sounds, made from noise so the example needs no files: the asteroid's roar as it comes, the strike's
// boom, the fragments' distant thuds and the surf when the wave breaks on the island. Each is mono PCM,
// { samples, sampleRate }.
import { random } from './random.js';

const RATE = 44100, lerp = (a, b, t) => a + (b - a) * t;

// A sound `seconds` long, each sample from `at(t, noise)`, normalized to a peak of 0.9.
function sound(seconds, seed, at) {
  const rand = random(seed), noise = () => 2 * rand() - 1, samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = at(i / RATE, noise);
  const peak = samples.reduce((max, v) => Math.max(max, Math.abs(v)), 1e-9);
  for (let i = 0; i < samples.length; i++) samples[i] *= 0.9 / peak;
  return { samples: [samples], sampleRate: RATE };
}

// A low-pass filter of two one-pole stages at `cutoff` Hz: call it with each sample in turn.
function lowpass(cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y1 = 0, y2 = 0;
  return (x) => { y1 += a * (x - y1); y2 += a * (y1 - y2); return y2; };
}

// A blow: a crack of bright noise, a body of low noise and a falling sub tone, and a rumble that rolls on. Far away the
// air takes the crack (`far` 0 near, 1 far).
function blow(seconds, seed, far) {
  const body = lowpass(lerp(260, 90, far)), rumble = lowpass(55), crack = lowpass(lerp(6000, 600, far));
  return sound(seconds, seed, (t, noise) => {
    const n = noise(), sub = Math.sin(2 * Math.PI * (34 * t + 18 * (1 - Math.exp(-t * 2)))) * Math.exp(-t / 1.4);
    return (1 - far) * 0.8 * crack(n) * Math.exp(-t * 28) + 3.2 * body(n) * Math.min(1, t * 60) * Math.exp(-t / 1.8)
      + 0.5 * sub * Math.min(1, t * 40) + 7 * rumble(n) * Math.min(1, t * 4) * Math.exp(-t / (seconds / 3));
  });
}

export const createSounds = () => ({
  boom: blow(9, 81, 0),
  thud: blow(5, 82, 1),
  // Its roar as it falls, rising to a tearing crackle.
  roar: (() => {
    const low = lowpass(320), high = lowpass(2200), length = 6.2;
    return sound(length, 83, (t, noise) => {
      const n = noise(), u = t / length, crackle = noise() > 0.995 - 0.02 * u ? noise() : 0;
      return (0.2 + u * u * 1.8) * (2.5 * low(n) + 0.25 * u * high(n)) + 0.6 * u * crackle;
    });
  })(),
  // The wave breaking on the shore: swells of hiss over a low wash.
  surf: (() => {
    const wash = lowpass(140), hiss = lowpass(900);
    return sound(7, 84, (t, noise) => {
      const n = noise(), swell = 0.6 + 0.4 * Math.sin(t * 2.3) * Math.sin(t * 0.9 + 1);
      return (2.5 * wash(n) + 0.6 * swell * hiss(n)) * Math.min(1, t * 2.5) * Math.exp(-t / 2.8);
    });
  })(),
});
