// The café's procedural sounds, plain Web Audio graphs on the run's audio (game.audio): the machine's burr grinder,
// pump, pour with bubbles, high-pressure steam and done bell, a small splash, and the impacts of whatever is hit (by
// size, speed and material, breaking or not). Each takes the time to start at (the context's clock) and draws its
// variations from a random of its own, seeded from the run's, so a replay sounds the same.

/** A seeded random in [0, 1) (mulberry32). @param {number} seed */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sounds, over `audio` ({ context, destination }), their variations drawn from `seed` (take one from the run's random). */
export function createSounds({ context: c, destination }, seed) {
  const random = seeded(seed * 4294967296);
  const rnd = (a, b) => a + random() * (b - a);
  const noise = (seconds) => {
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate), d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    return src;
  };
  const env = (g, t, attack, hold, release, peak) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  };
  const output = (level) => { const out = c.createGain(); out.gain.value = level; out.connect(destination); return out; };

  const sounds = {
    /** Bubbles: sine blips whose pitch rises quickly, as air bubbles do. */
    bubbles(t) {
      const out = output(0.25);
      for (let i = 0, n = Math.floor(rnd(5, 11)); i < n; i++) {
        const o = c.createOscillator(), g = c.createGain(), f = rnd(250, 700), len = rnd(0.04, 0.09);
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * rnd(1.6, 2.6), t + len);
        o.connect(g).connect(out);
        env(g, t, 0.005, 0.01, len, 0.8);
        o.start(t);
        o.stop(t + len + 0.05);
        t += rnd(0.03, 0.12);
      }
    },
    /**
     * High-pressure steam: a bright, broadband hiss with no moving resonance (a sweeping band sounds like a breath),
     * opened by a valve's sharp "psst", roughened by fast turbulent flutter, then the valve closes.
     */
    steam(t) {
      const hold = rnd(1.4, 2.2), release = rnd(0.5, 0.8), total = 0.03 + hold + release;
      const src = noise(total + 0.3), hp = c.createBiquadFilter(), lp = c.createBiquadFilter(), g = c.createGain();
      hp.type = 'highpass'; hp.frequency.value = rnd(3200, 4200); hp.Q.value = 0.5;
      lp.type = 'lowpass'; lp.frequency.value = rnd(10000, 12000); lp.Q.value = 0.5;
      const flutter = noise(total + 0.3), fl = c.createBiquadFilter(), fg = c.createGain();
      fl.type = 'lowpass'; fl.frequency.value = rnd(25, 40); fg.gain.value = 0.35;
      flutter.connect(fl).connect(fg).connect(g.gain);
      src.connect(hp).connect(lp).connect(g).connect(destination);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.03);
      g.gain.linearRampToValueAtTime(0.13, t + 0.25);
      g.gain.setValueAtTime(0.13, t + 0.03 + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + total);
      for (const n of [src, flutter]) { n.start(t); n.stop(t + total + 0.3); }
    },
    /** A small splash: a short noise burst, then a few droplets. */
    splash(t) {
      const out = output(0.3), src = noise(0.4), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(rnd(2500, 5000), t);
      f.frequency.exponentialRampToValueAtTime(600, t + 0.3);
      src.connect(f).connect(g).connect(out);
      env(g, t, 0.005, 0.02, rnd(0.15, 0.3), 0.7);
      src.start(t);
      src.stop(t + 0.4);
      for (let i = 0, n = Math.floor(rnd(3, 7)); i < n; i++) {
        const dt = t + rnd(0.06, 0.45), o = c.createOscillator(), dg = c.createGain(), fr0 = rnd(700, 1600);
        o.frequency.setValueAtTime(fr0, dt);
        o.frequency.exponentialRampToValueAtTime(fr0 * 1.8, dt + 0.04);
        o.connect(dg).connect(out);
        env(dg, dt, 0.003, 0.005, 0.05, 0.35);
        o.start(dt);
        o.stop(dt + 0.1);
      }
    },
    /**
     * The grinder, as a burr grinder sounds: a fast electric motor's whine (a few hundred hertz with bright harmonics)
     * that spins up, drops in pitch and wavers while the beans load it, rises again as they run out, then spins down;
     * over it, the beans cracking, as dense irregular crunches, never a regular pulse.
     */
    grinder(t) {
      const out = output(0.16);
      const spinUp = 0.25, load = rnd(1.4, 2.0), empty = rnd(0.3, 0.5), spinDown = 0.5, total = spinUp + load + empty + spinDown;
      const free = rnd(330, 420), loaded = free * rnd(0.82, 0.88);
      const motor = c.createGain(), body = c.createBiquadFilter();
      body.type = 'bandpass'; body.frequency.value = free * 2; body.Q.value = 0.8;
      motor.connect(body).connect(out);
      for (const [type, detune, level] of [['sawtooth', 0, 0.5], ['square', 7, 0.25], ['sawtooth', -5, 0.3]]) {
        const o = c.createOscillator(), g = c.createGain(), f = o.frequency;
        o.type = type; o.detune.value = detune; g.gain.value = level;
        f.setValueAtTime(free * 0.15, t);
        f.exponentialRampToValueAtTime(free, t + spinUp);
        f.exponentialRampToValueAtTime(loaded, t + spinUp + 0.2);
        for (let s = t + spinUp + 0.3; s < t + spinUp + load; s += 0.12) f.linearRampToValueAtTime(loaded * rnd(0.97, 1.03), s);
        f.exponentialRampToValueAtTime(free, t + spinUp + load + 0.15);
        f.setValueAtTime(free, t + spinUp + load + empty);
        f.exponentialRampToValueAtTime(free * 0.1, t + total);
        o.connect(g).connect(motor);
        o.start(t);
        o.stop(t + total + 0.05);
      }
      motor.gain.setValueAtTime(0, t);
      motor.gain.linearRampToValueAtTime(0.5, t + spinUp);
      motor.gain.setValueAtTime(0.5, t + total - spinDown);
      motor.gain.exponentialRampToValueAtTime(0.0001, t + total);
      // The beans: many short, randomly timed, randomly bright crunches while the grinder is loaded.
      for (let s = t + spinUp; s < t + spinUp + load; s += rnd(0.006, 0.03)) {
        const crunch = noise(0.03), f = c.createBiquadFilter(), g = c.createGain();
        f.type = 'bandpass'; f.frequency.value = rnd(1500, 6000); f.Q.value = rnd(1, 4);
        crunch.connect(f).connect(g).connect(out);
        env(g, s, 0.001, 0.002, rnd(0.008, 0.025), rnd(0.15, 0.6));
        crunch.start(s);
        crunch.stop(s + 0.04);
      }
    },
    /** The pump: a vibrating buzz at mains rhythm, as espresso machines have. */
    pump(t) {
      const len = rnd(1.2, 2), o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(), am = c.createOscillator(), amg = c.createGain();
      o.type = 'square'; o.frequency.value = rnd(48, 52);
      lp.type = 'lowpass'; lp.frequency.value = 400;
      am.type = 'sine'; am.frequency.value = rnd(3, 6); amg.gain.value = 0.25;
      am.connect(amg.gain);
      o.connect(lp).connect(amg).connect(g).connect(destination);
      env(g, t, 0.08, len - 0.3, 0.2, 0.25);
      for (const n of [o, am]) { n.start(t); n.stop(t + len + 0.1); }
    },
    /** The pour: a thin trickle into the cup, its pitch rising as the cup fills. */
    pour(t) {
      const len = rnd(1.4, 2.2), src = noise(len + 0.2), bp = c.createBiquadFilter(), g = c.createGain();
      bp.type = 'bandpass'; bp.Q.value = 9;
      bp.frequency.setValueAtTime(rnd(500, 700), t);
      bp.frequency.linearRampToValueAtTime(rnd(1100, 1500), t + len);
      src.connect(bp).connect(g).connect(destination);
      env(g, t, 0.1, len - 0.4, 0.3, 0.9);
      src.start(t);
      src.stop(t + len + 0.2);
      for (let i = 0, n = Math.floor(rnd(4, 9)); i < n; i++) {
        const dt = t + rnd(0.1, len), o = c.createOscillator(), dg = c.createGain(), f0 = rnd(600, 1200);
        o.frequency.setValueAtTime(f0, dt);
        o.frequency.exponentialRampToValueAtTime(f0 * 1.7, dt + 0.04);
        o.connect(dg).connect(destination);
        env(dg, dt, 0.003, 0.005, 0.05, 0.08);
        o.start(dt);
        o.stop(dt + 0.1);
      }
    },
    /**
     * Done: the small mechanical bell of an old machine. A soft clunk of the striker, then a struck metal bell:
     * inharmonic partials (as a real bell has), each slightly detuned and fading at its own rate, with a slow wobble.
     */
    ding(t) {
      const base = rnd(1150, 1350), out = output(0.18);
      const clunk = noise(0.06), lp = c.createBiquadFilter(), cg = c.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      clunk.connect(lp).connect(cg).connect(out);
      env(cg, t, 0.002, 0.005, 0.04, 0.5);
      clunk.start(t);
      clunk.stop(t + 0.06);
      const wobble = c.createOscillator(), wg = c.createGain();
      wobble.frequency.value = rnd(4, 6); wg.gain.value = rnd(1.5, 3);
      wobble.connect(wg);
      for (const [ratio, level, decay] of [[1, 1, 1.6], [2.76, 0.45, 0.9], [5.4, 0.2, 0.5], [8.93, 0.08, 0.3]]) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine';
        o.frequency.value = base * ratio * rnd(0.995, 1.005);
        wg.connect(o.frequency);
        o.connect(g).connect(out);
        env(g, t + 0.01, 0.003, 0.01, decay * rnd(0.85, 1.15), level);
        o.start(t + 0.01);
        o.stop(t + 0.01 + decay * 1.2 + 0.1);
      }
      wobble.start(t);
      wobble.stop(t + 2);
    },
    /**
     * A struck thing rings at modes set by its size (metres; larger is lower) and material; the speed of the hit
     * (m/s) sets how loud and bright; a break adds a crack and a shower of small shards.
     * @param {number} t @param {{ size: number, speed: number, material: keyof typeof MATERIALS, breaks?: boolean }} hit
     */
    impact(t, { size, speed, material, breaks }) {
      const m = MATERIALS[material], out = output(0);
      const loud = Math.min(1, speed / 4), bright = 0.4 + 0.6 * loud, f0 = m.base * (0.09 / size) * rnd(0.97, 1.03);
      out.gain.value = 0.25 * (0.15 + 0.85 * loud);
      m.ratios.forEach((ratio, i) => {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f0 * ratio * rnd(0.995, 1.005);
        o.connect(g).connect(out);
        env(g, t, 0.001, 0.002, m.decay * Math.pow(0.7, i) * rnd(0.85, 1.15), Math.pow(m.damp * bright, i));
        o.start(t);
        o.stop(t + m.decay * 1.5 + 0.1);
      });
      const tick = noise(0.05), bp = c.createBiquadFilter(), tg = c.createGain();
      bp.type = 'bandpass'; bp.frequency.value = f0 * 2 * bright; bp.Q.value = 1.5;
      tick.connect(bp).connect(tg).connect(out);
      env(tg, t, 0.001, 0.001, 0.02, m.noise * bright);
      tick.start(t);
      tick.stop(t + 0.05);
      if (!breaks) return;
      const crack = noise(0.12), hp = c.createBiquadFilter(), cg = c.createGain();
      hp.type = 'highpass'; hp.frequency.value = 1500;
      crack.connect(hp).connect(cg).connect(out);
      env(cg, t + 0.005, 0.001, 0.01, 0.08, 0.9);
      crack.start(t);
      crack.stop(t + 0.15);
      for (let i = 0, shards = Math.round(6 + 10 * loud); i < shards; i++) {
        const s = t + 0.03 + Math.pow(random(), 1.6) * 0.6, o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f0 * rnd(2.5, 7);
        o.connect(g).connect(out);
        env(g, s, 0.001, 0.001, rnd(0.03, 0.09), rnd(0.15, 0.45) * (1 - (s - t) / 0.8));
        o.start(s);
        o.stop(s + 0.12);
      }
    },
  };
  return sounds;
}

/** How each material rings: modal ratios, the lowest mode's decay (s), damping per higher mode, base frequency for a 9 cm thing, noise. */
export const MATERIALS = {
  ceramic: { ratios: [1, 2.32, 4.25, 6.63], decay: 0.18, damp: 0.6, base: 1400, noise: 0.25 },
  glass: { ratios: [1, 2.76, 5.4, 8.93], decay: 0.35, damp: 0.75, base: 1900, noise: 0.15 },
  wood: { ratios: [1, 2.6, 4.1], decay: 0.06, damp: 0.5, base: 380, noise: 0.6 },
  ground: { ratios: [1, 1.7], decay: 0.04, damp: 0.4, base: 160, noise: 0.9 },
  // A palm slapping a big plastic button: a dull low thump from the button's body, a bright tick of skin on plastic.
  button: { ratios: [1, 1.9, 3.3], decay: 0.07, damp: 0.35, base: 220, noise: 1.0 },
};

/** The brew's parts and when each starts, in seconds from the brew's start (the cup is ready at the bell). */
export const BREW = { grinder: 0, pump: 3.2, pour: 3.4, bubbles: 3.6, steam: 5.6, ding: 8.4 };
