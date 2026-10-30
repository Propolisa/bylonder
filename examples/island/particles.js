// Particles, each a function of the film's time: particle i of a layer is born at start + i / rate, lives a lifetime of
// its own, and moves from where and how it was thrown under gravity, drag, wind and a little turbulence. Nothing is
// simulated step by step, so any frame renders the same alone as in playback. A layer is one mesh and color (a
// low-poly puff, Blender's Ico Sphere); effects are several layers together.
import { createPuffs } from './sky.js';
import { heightAt } from './island.js';

const { Vector3, Color3 } = BABYLON;
const HIDDEN = [new Vector3(0, -100, 0), 0];

// Particle i's k-th random number in [0, 1), and in [-1, 1).
export const rnd = (seed, i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233 + seed * 37.719) * 43758.5453; return x - Math.floor(x); };
export const signed = (seed, i, k) => 2 * rnd(seed, i, k) - 1;
// A random direction; `up` above 0 keeps it at least that far up (1: straight up).
export const direction = (r, up = 0) => {
  const a = r(11) * 2 * Math.PI, y = up > 0 ? up + (1 - up) * r(12) : r(12) * 2 - 1, s = Math.sqrt(1 - y * y);
  return new Vector3(Math.cos(a) * s, y, Math.sin(a) * s);
};

// spec: { name, color, glow (Color3), underglow (Color3), seed, start, end, rate (per second), life: [min, max],
//   origin(r, birth), velocity(r, birth), gravity (up is +), drag, wind (Vector3), turbulence, ground (stay above it),
//   size(age 0..1, r, birth), strength(birth) }; r(k) is the particle's k-th random number.
export function createParticles(scene, toon, spec) {
  const { rate, life: [shortest, longest], start, end, seed = 1, drag = 0, gravity = 0, turbulence = 0 } = spec;
  const wind = spec.wind ?? Vector3.Zero(), strength = spec.strength ?? (() => 1), capacity = Math.ceil(rate * Math.min(longest, end - start)) + 2;
  const at = (r, birth, age) => {
    const v0 = spec.velocity?.(r, birth) ?? Vector3.Zero(), g = new Vector3(0, gravity, 0);
    let p;
    if (drag > 0) {
      const f = (1 - Math.exp(-drag * age)) / drag;
      p = spec.origin(r, birth).add(v0.scale(f)).add(g.add(wind.scale(drag)).scale((age - f) / drag));
    } else p = spec.origin(r, birth).add(v0.scale(age)).add(g.scale(0.5 * age * age)).add(wind.scale(age));
    if (turbulence) p.addInPlace(new Vector3(Math.sin(age * 1.7 + 6.28 * r(5)), 0.5 * Math.sin(age * 1.3 + 6.28 * r(6)), Math.cos(age * 1.9 + 6.28 * r(7))).scale(turbulence * age));
    if (spec.ground) p.y = Math.max(p.y, heightAt(p.x, p.z) + spec.ground);
    return p;
  };
  const puffs = createPuffs(scene, toon, spec.name, spec.color, capacity, (day, time) => {
    const out = new Array(capacity).fill(HIDDEN);
    const first = Math.max(0, Math.floor((time - start - longest) * rate)), last = Math.floor((Math.min(time, end) - start) * rate);
    for (let i = first; i <= last; i++) {
      const birth = start + i / rate, r = (k) => rnd(seed, i, k), life = shortest + (longest - shortest) * r(0), age = time - birth;
      if (age < 0 || age >= life) continue;
      const size = spec.size(age / life, r, birth) * strength(birth);
      if (size > 0) out[i % capacity] = [at(r, birth, age), size];
    }
    return out;
  });
  if (spec.glow) puffs.material.setColor3('glow', spec.glow);
  if (spec.underglow) puffs.material.setColor3('underglow', spec.underglow);
  return puffs;
}

// Sizes over a particle's life: grows in, holds, shrinks out; or swells and fades.
export const pop = (peak, rise = 0.15) => (age, r) => peak * (0.7 + 0.6 * r(1)) * Math.min(1, age / rise) * (1 - age) ** 0.7;
export const swell = (from, to) => (age, r) => (from + (to - from) * Math.sqrt(age)) * (0.75 + 0.5 * r(1)) * Math.min(1, age * 8) * (1 - age ** 3);
export const glowOf = (r, g, b) => new Color3(r, g, b);

// Effects run together: one function for all their layers.
export const together = (...layers) => (day, time) => { for (const layer of layers) layer(day, time); };
