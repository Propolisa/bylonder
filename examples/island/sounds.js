// The film's sounds, made from noise and tones so the example needs no files: the beds that loop under it (the sea,
// the wind, the eruption, steam, night insects, the forest fire), the birds' calls and the chick's peeps, the whales,
// and the asteroid's roar, booms and thuds. Each is mono PCM, { samples, sampleRate }.
import { random } from './random.js';

const RATE = 32000, TAU = 2 * Math.PI, lerp = (a, b, t) => a + (b - a) * t;

// A sound `seconds` long, each sample from `at(t, noise)` in turn, normalized to a peak of 0.9.
function sound(seconds, seed, at) {
  const rand = random(seed), noise = () => 2 * rand() - 1, samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = at(i / RATE, noise);
  const peak = samples.reduce((max, v) => Math.max(max, Math.abs(v)), 1e-9);
  for (let i = 0; i < samples.length; i++) samples[i] *= 0.9 / peak;
  return { samples: [samples], sampleRate: RATE };
}

// A sound that loops without a seam: made a second longer, its tail faded into its start.
function loop(seconds, seed, at) {
  const { samples: [long] } = sound(seconds + 1, seed, at), n = Math.round(seconds * RATE), samples = long.slice(0, n);
  for (let i = 0; i < RATE; i++) samples[i] = samples[i] * (i / RATE) + long[n + i] * (1 - i / RATE);
  return { samples: [samples], sampleRate: RATE };
}

// A low-pass filter of two one-pole stages at `cutoff` Hz: call it with each sample in turn.
function lowpass(cutoff) {
  const a = 1 - Math.exp((-TAU * cutoff) / RATE);
  let y1 = 0, y2 = 0;
  return (x) => { y1 += a * (x - y1); y2 += a * (y1 - y2); return y2; };
}
// A band of noise between two frequencies.
const band = (low, high) => { const a = lowpass(high), b = lowpass(low); return (x) => a(x) - b(x); };

// A blow: a crack of bright noise, a body of low noise and a falling sub tone, and a rumble that rolls on. Far away the
// air takes the crack (`far` 0 near, 1 far).
function blow(seconds, seed, far) {
  const body = lowpass(lerp(260, 90, far)), rumble = lowpass(55), crack = lowpass(lerp(6000, 600, far));
  return sound(seconds, seed, (t, noise) => {
    const n = noise(), sub = Math.sin(TAU * (34 * t + 18 * (1 - Math.exp(-t * 2)))) * Math.exp(-t / 1.4);
    return (1 - far) * 0.8 * crack(n) * Math.exp(-t * 28) + 3.2 * body(n) * Math.min(1, t * 60) * Math.exp(-t / 1.8)
      + 0.5 * sub * Math.min(1, t * 40) + 7 * rumble(n) * Math.min(1, t * 4) * Math.exp(-t / (seconds / 3));
  });
}

// A bird's voice: `notes` [start, length, from Hz, to Hz] glides of a reedy tone (a few harmonics and a little breath),
// each swelling and fading.
function voice(seconds, seed, notes, { reed = 0.45, breath = 0.06 } = {}) {
  let phase = 0;
  const air = band(1500, 5000);
  return sound(seconds, seed, (t, noise) => {
    const note = notes.find(([start, length]) => t >= start && t < start + length), n = air(noise());
    if (!note) return 0;
    const [start, length, from, to] = note, u = (t - start) / length, f = lerp(from, to, Math.sin((u * Math.PI) / 2));
    phase += (TAU * f * (1 + 0.012 * Math.sin(t * 38))) / RATE;
    const swell = Math.sin(Math.PI * u) ** 0.6;
    return swell * (Math.sin(phase) + reed * Math.sin(2 * phase) + reed * 0.4 * Math.sin(3 * phase) + breath * 8 * n);
  });
}
// A seabird's cry, "kee-ow": up to its height, then down, `pitch` times a gull's.
const cry = (seed, pitch, notes = [[0, 0.42]]) => voice(1, seed, notes.flatMap(([start, length]) => [[start, length * 0.25, 1500 * pitch, 2300 * pitch], [start + length * 0.25, length * 0.75, 2300 * pitch, 1250 * pitch]]));

export function createSounds() {
  return {
    // The beds.
    sea: (() => { const wash = lowpass(380), hiss = band(900, 3000); return loop(12, 101, (t, noise) => { const n = noise(), swell = 0.55 + 0.45 * Math.sin((TAU * t) / 4) ** 2; return swell * (2.2 * wash(n) + 0.5 * swell * hiss(n)); }); })(),
    wind: (() => { const air = band(150, 900); return loop(10, 102, (t, noise) => (0.6 + 0.4 * Math.sin((TAU * t) / 5) * Math.sin((TAU * t) / 10 + 1)) * air(noise())); })(),
    eruption: (() => {
      const rumble = lowpass(70), roar = band(80, 400), pop = lowpass(900);
      let since = 1;
      return loop(8, 103, (t, noise) => { const n = noise(); since = noise() > 0.9993 ? 0 : since + 1 / RATE; return 6 * rumble(n) + 1.2 * roar(n) + 2 * pop(n) * Math.exp(-since * 25); });
    })(),
    steam: (() => { const hiss = band(1800, 7000); return loop(6, 104, (t, noise) => (0.7 + 0.3 * Math.sin((TAU * t) / 3)) * hiss(noise())); })(),
    insects: (() => {
      // Two crickets chirping at their own rates, three pulses a chirp.
      const chirp = (t, every, f, offset) => { const u = (t + offset) % every; return u < 0.09 ? Math.sin(TAU * f * t) * (Math.sin((Math.PI * u) / 0.03) > 0 ? 1 : 0.1) : 0; };
      return loop(6, 105, (t) => chirp(t, 0.6, 4600, 0) + 0.7 * chirp(t, 0.75, 5200, 0.2));
    })(),
    fire: (() => {
      const roar = lowpass(220), snap = band(1200, 6000);
      let since = 1;
      return loop(6, 106, (t, noise) => { const n = noise(); since = noise() > 0.9985 ? 0 : since + 1 / RATE; return 2.5 * roar(n) + 3 * snap(n) * Math.exp(-since * 140); });
    })(),
    // The birds.
    mother: cry(111, 1),
    father: cry(112, 0.86),
    alarm: cry(113, 1.08, [[0, 0.13], [0.17, 0.13], [0.34, 0.13], [0.51, 0.16]]),
    coo: voice(0.8, 114, [[0, 0.32, 820, 700], [0.38, 0.36, 760, 640]], { reed: 0.25, breath: 0.03 }),
    peep: voice(0.35, 115, [[0, 0.09, 3300, 4300], [0.15, 0.09, 3400, 4400]], { reed: 0.2, breath: 0.02 }),
    sad: voice(0.6, 116, [[0, 0.32, 4000, 2700]], { reed: 0.2, breath: 0.02 }),
    flock: (() => {
      const voices = [0, 1, 2, 3, 4, 5].map((k) => cry(120 + k, 0.85 + 0.07 * k).samples[0]), starts = [0, 0.35, 0.8, 1.1, 1.5, 1.9];
      return sound(3, 126, (t) => voices.reduce((sum, v, k) => { const i = Math.round((t - starts[k]) * RATE); return sum + (i >= 0 && i < v.length ? v[i] * (0.5 + 0.1 * k) : 0); }, 0));
    })(),
    crack: (() => { const click = band(2000, 9000); return sound(0.6, 131, (t, noise) => [0, 0.18, 0.4].reduce((sum, at) => sum + (t >= at ? Math.exp(-(t - at) * 160) : 0), 0) * click(noise())); })(),
    // The tree: its trunk groaning, then its fall.
    creak: (() => { let phase = 0; const body = lowpass(500); return sound(1.2, 141, (t, noise) => { phase += (TAU * (95 - 30 * t + 6 * noise())) / RATE; return body((phase % TAU) / Math.PI - 1) * Math.sin((Math.PI * t) / 1.2); }); })(),
    crash: blow(4, 142, 0.35),
    // The whales: a song gliding up and down, and a blow.
    song: (() => {
      let phase = 0;
      return sound(5, 151, (t) => {
        const f = 170 + 220 * Math.sin((Math.PI * t) / 2.6) ** 2 + 60 * Math.sin(t * 1.3), swell = Math.sin((Math.PI * t) / 5) ** 0.8;
        phase += (TAU * f * (1 + 0.02 * Math.sin(t * 31))) / RATE;
        return swell * (Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.5 * Math.sin(phase / 2));
      });
    })(),
    spout: (() => { const air = band(250, 2200); return sound(1.4, 152, (t, noise) => air(noise()) * Math.min(1, t * 20) * Math.exp(-t * 2.5)); })(),
    // The asteroid.
    roar: (() => {
      const low = lowpass(320), high = lowpass(2200), length = 6.2;
      return sound(length, 83, (t, noise) => {
        const n = noise(), u = t / length, crackle = noise() > 0.995 - 0.02 * u ? noise() : 0;
        return (0.2 + u * u * 1.8) * (2.5 * low(n) + 0.25 * u * high(n)) + 0.6 * u * crackle;
      });
    })(),
    boom: blow(9, 81, 0),
    thud: blow(5, 82, 1),
    // The wave breaking on the shore: swells of hiss over a low wash.
    surf: (() => {
      const wash = lowpass(140), hiss = lowpass(900);
      return sound(7, 84, (t, noise) => {
        const n = noise(), swell = 0.6 + 0.4 * Math.sin(t * 2.3) * Math.sin(t * 0.9 + 1);
        return (2.5 * wash(n) + 0.6 * swell * hiss(n)) * Math.min(1, t * 2.5) * Math.exp(-t / 2.8);
      });
    })(),
  };
}
