// The asteroid: a fireball falling at sunset into the sea off the island's far side; its strike, which blasts that
// side to glass and sends a great wave racing out; the burning debris it throws over the ridge, which lights the forest
// above the nest; all as layers of particles, with the fire light that moves with them.
import { createMesh } from '@workbench/sdk';
import { createParticles, together, pop, swell, glowOf, direction } from './particles.js';
import { createPuffs, setMatrices, place } from './sky.js';
import { heightAt } from './island.js';
import { BEAT, OMEN, STRIKE, IMPACT, NEST, smoothstep, falling, fireFront, fireAngle, burning, flash, sinceStrike } from './story.js';

const { Vector3, Color3, Quaternion } = BABYLON;
const HIDDEN = [new Vector3(0, -100, 0), 0];

// The asteroid's path: from far out along the star's direction down to the sea, ever faster.
const STRIKE_AT = new Vector3(STRIKE.x, 0.2, STRIKE.z);
const FROM = STRIKE_AT.add(new Vector3(OMEN.x, OMEN.y, OMEN.z).scale(150));
export const fireballAt = (time) => Vector3.Lerp(FROM, STRIKE_AT, falling(time) ** 1.8);
// A point on the fire's line `r` from the centre, `across` it.
const onFire = (r, across) => {
  const a = fireAngle(r) + across / Math.max(r, 0.5), x = Math.cos(a) * r, z = Math.sin(a) * r;
  return new Vector3(x, heightAt(x, z), z);
};
// The great wave: its crest's distance from the strike and its height, a few seconds on (the sea's foam ring agrees).
export const waveRadius = (age) => 1 + 16 * Math.max(0, age) ** 0.75;
const waveHeight = (age) => (age < 0 ? 0 : 1.4 * Math.exp(-age / 6) * Math.min(1, age * 3));
const around = (radius, angle, y) => new Vector3(STRIKE.x + Math.cos(angle) * radius, y, STRIKE.z + Math.sin(angle) * radius);

// The asteroid: a white-hot core in yellow and orange shells, flame shed behind it in three layers, a smoke trail that
// hangs in the sky long after, and sparks.
function createFireball(scene, toon) {
  const T0 = BEAT.streak, T1 = BEAT.impact, path = (r, birth) => fireballAt(birth).add(new Vector3(2 * r(20) - 1, 2 * r(21) - 1, 2 * r(22) - 1).scale(0.8));
  const near = (birth) => 1 + 1.6 * falling(birth);
  const shells = [['Asteroid Core', [2.6, 2.5, 2.2], 0.8], ['Asteroid Shell', [2.6, 1.5, 0.35], 1.15], ['Asteroid Glow', [2.2, 0.6, 0.08], 1.5]].map(([name, glow, size]) => {
    const puff = createPuffs(scene, toon, name, '#000000', 1, (day, time) => [time >= T0 && time < T1 ? [fireballAt(time), size * near(time) * (1 + 0.08 * Math.sin(time * 40))] : HIDDEN]);
    puff.material.setColor3('glow', glowOf(...glow));
    return puff;
  });
  const flame = (name, glow, rate, life, peak) => createParticles(scene, toon, { name, color: '#000000', glow: glowOf(...glow), seed: rate, start: T0, end: T1, rate, life,
    origin: path, velocity: (r) => direction(r).scale(1.5), drag: 2, gravity: 0.4, size: pop(peak, 0.05), strength: near });
  return together(...shells,
    flame('Trail Flame Hot', [2.6, 2.1, 0.9], 90, [0.15, 0.3], 1.1), flame('Trail Flame', [2.4, 0.9, 0.12], 70, [0.3, 0.6], 1.5), flame('Trail Flame Red', [1.6, 0.25, 0.04], 50, [0.5, 1], 1.9),
    createParticles(scene, toon, { name: 'Trail Smoke', color: '#58525e', underglow: glowOf(0.9, 0.3, 0.06), seed: 4, start: T0, end: T1 - 0.4, rate: 60, life: [5, 8],
      origin: path, velocity: (r) => direction(r).scale(0.6), drag: 0.6, gravity: 0.05, turbulence: 0.2, size: swell(0.6, 2.6) }),
    createParticles(scene, toon, { name: 'Trail Sparks', color: '#000000', glow: glowOf(2.6, 2.0, 0.8), seed: 5, start: T0, end: T1, rate: 120, life: [0.5, 1.2],
      origin: path, velocity: (r) => direction(r).scale(4 + 5 * r(3)), gravity: -6, size: pop(0.14), strength: near }));
}

// The strike, on fire: a flash; a fireball billowing up in three layers; glowing debris thrown in arcs trailing embers;
// a column of smoke lit from below rising into a mushroom cap.
function createBlast(scene, toon) {
  const T = BEAT.impact, at = (r) => STRIKE_AT.add(new Vector3(2 * r(30) - 1, 0, 2 * r(31) - 1).scale(1.5));
  const flashBall = createPuffs(scene, toon, 'Strike Flash', '#000000', 1, (day, time) => {
    const age = time - T;
    return [age >= 0 && age < 1.8 ? [STRIKE_AT, 9 * Math.min(1, age / 0.15) * (1 - smoothstep(0.3, 1.8, age))] : HIDDEN];
  });
  flashBall.material.setColor3('glow', glowOf(3, 2.8, 2.4));
  const billow = (name, glow, count, speed, peak, life, seed) => createParticles(scene, toon, { name, color: '#000000', glow: glowOf(...glow), seed, start: T, end: T + 0.3, rate: count / 0.3, life,
    origin: at, velocity: (r) => direction(r, 0.25).scale(speed * (0.5 + r(3))), drag: 1.6, gravity: 3, turbulence: 0.5, size: swell(peak * 0.3, peak) });
  const DEBRIS = 80, TRAIL = 6, debrisAt = (j, age) => {
    const r = (k) => Math.abs(Math.sin(j * 12.9898 + k * 78.233) * 43758.5453) % 1, a = r(1) * 2 * Math.PI, out = 5 + 9 * r(2), up = 7 + 10 * r(3);
    const p = STRIKE_AT.add(new Vector3(Math.cos(a) * out * age, up * age - 4.9 * age * age, Math.sin(a) * out * age));
    return { p, landed: p.y < Math.max(0, heightAt(p.x, p.z)) && age > 0.3, size: 0.15 + 0.25 * r(4) };
  };
  const debris = createPuffs(scene, toon, 'Debris', '#2b2228', DEBRIS * (TRAIL + 1), (day, time) => {
    const age = time - T, out = [];
    for (let j = 0; j < DEBRIS; j++) for (let k = 0; k <= TRAIL; k++) {
      const { p, landed, size } = debrisAt(j, age - k * 0.06);
      out.push(age - k * 0.06 > 0 && age < 5 && !landed ? [p, (k ? 0.6 * size * (1 - k / (TRAIL + 1)) : size) * (1 - smoothstep(3.5, 5, age))] : HIDDEN);
    }
    return out;
  });
  debris.material.setColor3('glow', glowOf(1.9, 0.5, 0.06));
  return together(flashBall, debris,
    billow('Blast Fire Hot', [2.6, 2.2, 1.0], 70, 8, 1.8, [1.2, 2.5], 21), billow('Blast Fire', [2.4, 0.9, 0.12], 110, 11, 2.4, [2, 3.6], 22),
    billow('Blast Fire Red', [1.4, 0.22, 0.04], 120, 14, 2.9, [2.5, 4.5], 23),
    createParticles(scene, toon, { name: 'Blast Sparks', color: '#000000', glow: glowOf(2.8, 2.4, 1.2), seed: 25, start: T, end: T + 0.15, rate: 1200, life: [0.8, 2],
      origin: at, velocity: (r) => direction(r, 0.3).scale(12 + 14 * r(3)), gravity: -9.8, drag: 0.4, size: pop(0.12) }),
    createParticles(scene, toon, { name: 'Strike Column', color: '#3c3843', underglow: glowOf(1.4, 0.45, 0.08), seed: 26, start: T + 0.2, end: T + 12, rate: 40, life: [6, 9],
      origin: at, velocity: (r) => new Vector3((2 * r(32) - 1) * 0.8, 6 + 3 * r(3), (2 * r(33) - 1) * 0.8), drag: 0.35, gravity: 0.6,
      wind: new Vector3(-0.4, 0, -0.2), turbulence: 0.4, size: swell(0.6, 2.2), strength: (birth) => 1 - smoothstep(T + 6, T + 12, birth) }),
    createParticles(scene, toon, { name: 'Strike Cap', color: '#6e6977', underglow: glowOf(0.9, 0.3, 0.06), seed: 27, start: T + 2, end: T + 18, rate: 14, life: [8, 12],
      origin: (r) => STRIKE_AT.add(new Vector3(0, 15 + 4 * r(3), 0)), velocity: (r) => { const a = r(11) * 2 * Math.PI; return new Vector3(Math.cos(a), 0.15, Math.sin(a)).scale(2 + 2 * r(4)); },
      drag: 0.4, gravity: 0.1, turbulence: 0.5, size: swell(1, 3), strength: (birth) => 1 - smoothstep(T + 8, T + 16, birth) }));
}

// The strike, on water: a column of sea thrown up and falling back, spray, a ring of vapor racing out over the sea,
// the great wave with foam along its crest, and steam over the boiling sea for long after.
function createWater(scene, toon) {
  const T = BEAT.impact, at = (r) => STRIKE_AT.add(new Vector3(2 * r(30) - 1, 0, 2 * r(31) - 1).scale(2));
  const SEGMENTS = 96, segment = createMesh('Wave', {
    vertices: [[-0.5, -0.3, 0], [-0.5, 0, 1], [-0.5, 0.45, 0.15], [0.5, -0.3, 0], [0.5, 0, 1], [0.5, 0.45, 0.15]],
    faces: [[0, 1, 4, 3], [1, 2, 5, 4], [0, 3, 5, 2], [0, 2, 1], [3, 4, 5]],
  }, scene);
  segment.material = toon.plain('Wave', '#bfe6f7');
  const buffer = setMatrices(segment, SEGMENTS);
  const wave = (day, time) => {
    const age = time - T, R = waveRadius(age), h = waveHeight(age), length = (2 * Math.PI * R) / SEGMENTS * 1.08;
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * 2 * Math.PI, turn = Quaternion.RotationAxis(Vector3.Up(), -a + Math.PI / 2);
      place(buffer, i, around(R, a, -0.05), h > 0.02 ? new Vector3(length, h, 2.5 + 1.5 * h) : new Vector3(1e-4, 1e-4, 1e-4), turn);
    }
    segment.thinInstanceBufferUpdated('matrix');
  };
  return together(wave,
    createParticles(scene, toon, { name: 'Water Column', color: '#e6f4ff', seed: 61, start: T + 0.05, end: T + 0.6, rate: 500, life: [3, 5],
      origin: at, velocity: (r) => { const a = r(11) * 2 * Math.PI; return new Vector3(Math.cos(a) * (2 + 4 * r(4)), 14 + 14 * r(3), Math.sin(a) * (2 + 4 * r(4))); },
      gravity: -9.8, drag: 0.15, size: swell(0.2, 0.75) }),
    createParticles(scene, toon, { name: 'Water Spray', color: '#ffffff', seed: 62, start: T + 0.05, end: T + 1.2, rate: 500, life: [1.5, 3],
      origin: at, velocity: (r) => direction(r, 0.3).scale(14 + 12 * r(3)), gravity: -9.8, drag: 0.3, size: pop(0.18) }),
    createParticles(scene, toon, { name: 'Shock Vapor', color: '#dfe7f2', seed: 63, start: T + 0.05, end: T + 0.2, rate: 1100, life: [2, 3.5],
      origin: (r) => STRIKE_AT.add(new Vector3(0, 0.3 + r(5), 0)), velocity: (r) => { const a = r(11) * 2 * Math.PI; return new Vector3(Math.cos(a), 0.05, Math.sin(a)).scale(20 + 8 * r(3)); },
      drag: 1.3, gravity: 0.4, size: swell(0.4, 1.1) }),
    createParticles(scene, toon, { name: 'Wave Foam', color: '#ffffff', seed: 64, start: T + 0.3, end: T + 22, rate: 260, life: [0.6, 1.2],
      origin: (r, birth) => around(waveRadius(birth - T), r(11) * 2 * Math.PI, waveHeight(birth - T) * 0.9),
      velocity: (r) => new Vector3((2 * r(32) - 1) * 0.6, 1.5 + 1.5 * r(3), (2 * r(33) - 1) * 0.6), gravity: -5, size: pop(0.28),
      strength: (birth) => Math.min(1, waveHeight(birth - T) / 0.6) }),
    createParticles(scene, toon, { name: 'Strike Steam', color: '#f2f5fa', seed: 65, start: T + 0.5, end: BEAT.heal + 4, rate: 14, life: [5, 8],
      origin: (r) => STRIKE_AT.add(new Vector3(2 * r(30) - 1, 0, 2 * r(31) - 1).scale(4.5)), velocity: (r) => new Vector3(0, 2 + r(3), 0), drag: 0.5, gravity: 0.6,
      wind: new Vector3(-0.3, 0, -0.15), turbulence: 0.4, size: swell(0.3, 1.4), strength: (birth) => 1 - smoothstep(BEAT.sea, BEAT.heal + 4, birth) }));
}

// Burning debris and embers carried over the ridge on the shockwave, falling on the nest's side of the island; the
// first of them lights the forest above the nest.
function createEmberRain(scene, toon) {
  const over = (r) => new Vector3(NEST.x * 0.6 + (2 * r(30) - 1) * 3.5, 9 + 4 * r(3), NEST.z * 0.6 + (2 * r(31) - 1) * 3.5);
  const strength = (birth) => smoothstep(BEAT.impact + 3, BEAT.impact + 6, birth) * (1 - smoothstep(BEAT.embers + 2, BEAT.embers + 6, birth));
  return together(
    createParticles(scene, toon, { name: 'Falling Embers', color: '#000000', glow: glowOf(2.6, 1.1, 0.15), seed: 71, start: BEAT.impact + 3, end: BEAT.embers + 6, rate: 40, life: [4, 6],
      origin: over, velocity: () => new Vector3(Math.cos(NEST.angle) * 0.8, -2, Math.sin(NEST.angle) * 0.8), turbulence: 0.5, ground: 0.05, size: pop(0.07, 0.05), strength }),
    createParticles(scene, toon, { name: 'Burning Debris', color: '#2b2228', glow: glowOf(1.9, 0.5, 0.06), seed: 72, start: BEAT.impact + 4, end: BEAT.embers + 1, rate: 4, life: [3, 4],
      origin: over, velocity: () => new Vector3(Math.cos(NEST.angle) * 0.5, -3, Math.sin(NEST.angle) * 0.5), gravity: -1.5, ground: 0.1, size: pop(0.16, 0.05), strength }));
}

// The fire running down the slope: flames in three colors along its front, smoke, and embers rising.
function createGroundFire(scene, toon) {
  const along = (r, birth) => {
    const front = fireFront(birth);
    return onFire(Math.max(IMPACT.r, front - 1.4 * r(30)), (2 * r(31) - 1) * 0.55).add(new Vector3(0, 0.05, 0));
  };
  const strength = (birth) => (birth > BEAT.embers ? burning(birth) : 0);
  const flame = (name, glow, rate, life, peak, seed) => createParticles(scene, toon, { name, color: '#000000', glow: glowOf(...glow), seed, start: BEAT.embers, end: BEAT.heal, rate, life,
    origin: along, velocity: (r) => new Vector3((2 * r(32) - 1) * 0.2, 1.2 + r(3), (2 * r(33) - 1) * 0.2), drag: 1.5, gravity: 1.2, turbulence: 0.15, size: pop(peak, 0.2), strength });
  return together(flame('Fire Hot', [2.6, 1.9, 0.6], 40, [0.3, 0.6], 0.22, 31), flame('Fire', [2.3, 0.75, 0.1], 36, [0.5, 0.9], 0.3, 32), flame('Fire Red', [1.3, 0.2, 0.04], 24, [0.7, 1.2], 0.36, 33),
    createParticles(scene, toon, { name: 'Fire Smoke', color: '#46414d', underglow: glowOf(1, 0.32, 0.06), seed: 34, start: BEAT.embers, end: BEAT.sea, rate: 16, life: [2.5, 4],
      origin: along, velocity: (r) => new Vector3(0, 1 + r(3), 0), drag: 0.5, gravity: 0.3, wind: new Vector3(-0.4, 0, -0.2), turbulence: 0.3, size: swell(0.06, 0.38), strength }),
    createParticles(scene, toon, { name: 'Fire Embers', color: '#000000', glow: glowOf(2.6, 1.2, 0.2), seed: 35, start: BEAT.embers, end: BEAT.heal, rate: 30, life: [1.5, 3],
      origin: along, velocity: (r) => new Vector3((2 * r(32) - 1) * 0.6, 1.5 + 1.5 * r(3), (2 * r(33) - 1) * 0.6), drag: 0.8, gravity: 0.5, turbulence: 0.5, size: pop(0.045), strength }));
}

// After: grey ash drifting down over the island; through the night, embers rising from where the nest tree fell, up
// and up until they are lost among the stars.
function createAfter(scene, toon) {
  const top = new Vector3(NEST.x, NEST.ground + 1.2, NEST.z);
  return together(
    createParticles(scene, toon, { name: 'Ash', color: '#9b97a3', seed: 41, start: BEAT.impact + 2, end: BEAT.heal + 1, rate: 70, life: [5, 7],
      origin: (r) => new Vector3((2 * r(30) - 1) * 11, 6 + 3 * r(3), (2 * r(31) - 1) * 11),
      velocity: () => new Vector3(0, -0.9, 0), wind: new Vector3(-0.3, 0, -0.15), turbulence: 0.35, size: pop(0.05, 0.1),
      strength: (birth) => smoothstep(BEAT.impact + 2, BEAT.impact + 6, birth) * (1 - smoothstep(BEAT.heal - 1, BEAT.heal + 1, birth)) }),
    createParticles(scene, toon, { name: 'Rising Embers', color: '#000000', glow: glowOf(2.4, 1.0, 0.25), seed: 42, start: BEAT.gone, end: BEAT.heal, rate: 8, life: [5, 7],
      origin: (r) => top.add(new Vector3((2 * r(30) - 1) * 0.4, 0, (2 * r(31) - 1) * 0.4)),
      velocity: (r) => new Vector3((2 * r(32) - 1) * 0.2, 1.4 + 0.8 * r(3), (2 * r(33) - 1) * 0.2), turbulence: 0.25,
      size: (age, r) => 0.05 * (0.7 + 0.6 * r(1)) * Math.min(1, age * 6) * (1 - age) ** 1.5 }));
}

// The fire light: the asteroid as it comes; the strike's flash and its afterglow beyond the volcano; then the burning
// front by the nest with a flicker, dying with the night. Its color carries its strength.
export function fireLight(time) {
  const fall = falling(time), age = sinceStrike(time);
  if (fall > 0) return { position: fireballAt(time), color: new Color3(2.4, 1.2, 0.35).scale(0.1 + 2 * fall ** 3) };
  if (age < 0) return { position: new Vector3(0, -50, 0), color: Color3.Black() };
  const strike = new Color3(3, 2.6, 2.2).scale(10 * flash(time)).add(new Color3(2.4, 0.9, 0.25).scale(2.5 * Math.exp(-age / 7)));
  const burn = time >= BEAT.embers ? burning(time) : 0, flicker = 0.85 + 0.15 * Math.sin(time * 23) * Math.sin(time * 7.3);
  const fire = new Color3(2.4, 1.0, 0.3).scale(burn * 0.45 * flicker);
  if (strike.r > fire.r * 2) return { position: STRIKE_AT.add(new Vector3(0, 6, 0)), color: strike };
  return { position: onFire(Math.max(IMPACT.r, fireFront(time) - 0.4), 0).add(new Vector3(0, 0.9, 0)), color: fire };
}

export function createMeteor(scene, toon) {
  return together(createFireball(scene, toon), createBlast(scene, toon), createWater(scene, toon), createEmberRain(scene, toon), createGroundFire(scene, toon), createAfter(scene, toon));
}
