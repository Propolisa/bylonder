// The asteroid: a fireball falling at sunset, breaking up in the air, its fragments falling far out to sea, the large
// ones striking as hard as it, and its main chunk striking the island's far shoulder glancingly; its strike, which
// blasts that side to glass and sends a great wave racing out; the burning debris it throws over the ridge, which
// lights the forest above the nest; all as layers of particles, with the fire light that moves with them.
import { createMesh } from '@workbench/sdk';
import { createParticles, together, pop, swell, glowOf, direction, rnd } from './particles.js';
import { createPuffs, setMatrices, place } from './sky.js';
import { heightAt } from './island.js';
import { BEAT, OMEN, STRIKE, WAVE, FRAGMENTS, IMPACTS, waveReach, islandShadow, landAt, IMPACT, NEST, smoothstep, lerp, falling, fireFront, fireAngle, burning, flash, sinceStrike } from './story.js';

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
// An impact's great wave at a side of it: its crest's distance and height, a few seconds on (the sea's foam agrees).
const waveRadius = (impact, age, side) => 1 + 16 * impact.size * Math.max(0, age) ** 0.75 * waveReach(side);
const waveHeight = (impact, age, side) => (age < 0 ? 0 : 1.4 * impact.size ** 1.5 * Math.exp(-age / 6) * Math.min(1, age * 3) * Math.max(0, waveReach(side)) ** 1.2);
// Thrown out of an impact, more of it downrange.
const DOWNRANGE = new Vector3(Math.cos(WAVE.downrange), 0, Math.sin(WAVE.downrange));
const thrown = (r, up, speed) => direction(r, up).add(DOWNRANGE.scale(0.6)).normalize().scale(speed);
const around = (impact, radius, angle, y) => new Vector3(impact.x + Math.cos(angle) * radius, y, impact.z + Math.sin(angle) * radius);

// The asteroid: a white-hot core in yellow and orange shells, flame shed behind it in three layers, a smoke trail that
// hangs in the sky long after, and sparks.
function createFireball(scene, toon) {
  const T0 = BEAT.streak, T1 = BEAT.impact, path = (r, birth) => fireballAt(birth).add(new Vector3(2 * r(20) - 1, 2 * r(21) - 1, 2 * r(22) - 1).scale(0.8));
  const near = (birth) => 1 + falling(birth);
  const shells = [['Asteroid Core', [2.6, 2.5, 2.2], 0.8], ['Asteroid Shell', [2.6, 1.5, 0.35], 1.15], ['Asteroid Glow', [2.2, 0.6, 0.08], 1.5]].map(([name, glow, size]) => {
    const puff = createPuffs(scene, toon, name, '#000000', 1, (day, time) => [time >= T0 && time < T1 ? [fireballAt(time), size * near(time) * (1 + 0.08 * Math.sin(time * 40))] : HIDDEN]);
    puff.material.setColor3('glow', glowOf(...glow));
    return puff;
  });
  const flame = (name, glow, rate, life, peak) => createParticles(scene, toon, { name, color: '#000000', glow: glowOf(...glow), seed: rate, start: T0, end: T1, rate, life,
    origin: path, velocity: (r) => direction(r).scale(1.5), drag: 2, gravity: 0.4, size: pop(peak, 0.05), strength: near });
  return together(...shells,
    flame('Trail Flame Hot', [2.6, 2.1, 0.9], 90, [0.15, 0.3], 0.8), flame('Trail Flame', [2.4, 0.9, 0.12], 70, [0.3, 0.6], 1.1), flame('Trail Flame Red', [1.6, 0.25, 0.04], 50, [0.5, 1], 1.4),
    createParticles(scene, toon, { name: 'Trail Smoke', color: '#58525e', underglow: glowOf(0.9, 0.3, 0.06), seed: 4, start: T0, end: T1 - 0.4, rate: 60, life: [5, 8],
      origin: path, velocity: (r) => direction(r).scale(0.6), drag: 0.6, gravity: 0.05, turbulence: 0.2, size: swell(0.6, 2.6) }),
    createParticles(scene, toon, { name: 'Trail Sparks', color: '#000000', glow: glowOf(2.6, 2.0, 0.8), seed: 5, start: T0, end: T1, rate: 120, life: [0.5, 1.2],
      origin: path, velocity: (r) => direction(r).scale(4 + 5 * r(3)), gravity: -6, size: pop(0.14), strength: near }));
}

// Where each fragment breaks off and falls: from the asteroid's path, ever faster down to the sea.
const PIECES = FRAGMENTS.map((f) => {
  const split = BEAT.streak + f.part * (BEAT.impact - BEAT.streak);
  return { ...f, split, from: fireballAt(split), to: new Vector3(f.x, 0.1, f.z) };
});
const fragmentAt = (f, time) => Vector3.Lerp(f.from, f.to, Math.min(1, Math.max(0, (time - f.split) / (f.land - f.split))) ** 1.6);
// The fragments in the air: a hot head in a glowing shell, the large ones nearly the asteroid's own, each its own
// streamer of flame and smoke, with sparks where it shears off.
function createFragments(scene, toon) {
  const falling = (f, time) => time >= f.split && time < f.land, near = (f, time) => f.size * (1 + 0.6 * Math.min(1, (time - f.split) / (f.land - f.split)));
  const heads = [['Fragment Core', [2.6, 2.4, 1.8], 0.8], ['Fragment Shell', [2.6, 1.5, 0.35], 1.15], ['Fragment Glow', [2.3, 0.8, 0.12], 1.5]].map(([name, glow, size]) => {
    const puff = createPuffs(scene, toon, name, '#000000', PIECES.length, (day, time) => PIECES.map((f) => (falling(f, time) ? [fragmentAt(f, time), size * near(f, time)] : HIDDEN)));
    puff.material.setColor3('glow', glowOf(...glow));
    return puff;
  });
  const fracture = createParticles(scene, toon, { name: 'Fracture Sparks', color: '#000000', glow: glowOf(2.8, 2.2, 1.2), seed: 80, start: Math.min(...PIECES.map((f) => f.split)), end: Math.max(...PIECES.map((f) => f.split)) + 0.1,
    rate: 300, life: [0.4, 1], origin: (r, birth) => fireballAt(birth), velocity: (r) => direction(r).scale(6 + 8 * r(3)), drag: 1.5, size: pop(0.25),
    strength: (birth) => (PIECES.some((f) => birth >= f.split && birth < f.split + 0.1) ? 1 : 0) });
  const streamers = PIECES.flatMap((f, k) => {
    const path = (r, birth) => fragmentAt(f, birth).add(new Vector3(2 * r(20) - 1, 2 * r(21) - 1, 2 * r(22) - 1).scale(0.4 * f.size));
    return [
      createParticles(scene, toon, { name: `Fragment Flame ${k + 1}`, color: '#000000', glow: glowOf(2.4, 0.9, 0.12), seed: 81 + k, start: f.split, end: f.land, rate: 220, life: [0.25, 0.6],
        origin: path, velocity: (r) => direction(r).scale(0.8), drag: 2, size: pop(1.1 * f.size, 0.05) }),
      createParticles(scene, toon, { name: `Fragment Smoke ${k + 1}`, color: '#8a8490', underglow: glowOf(0.8, 0.28, 0.06), seed: 91 + k, start: f.split, end: f.land, rate: 70, life: [3, 5],
        origin: path, velocity: (r) => direction(r).scale(0.3), drag: 0.6, turbulence: 0.15, size: swell(0.2 * f.size, 1.1 * f.size) }),
    ];
  });
  return together(...heads, fracture, ...streamers);
}

// An impact on the sea, as large as what struck: a flash; for a large one a fireball billowing up in three layers and
// glowing debris thrown in arcs trailing embers; a column of sea thrown up, spray, a ring of vapor racing out; the wave,
// its crest breaking where it meets the island and hidden behind it, foam along it; and steam over the boiling sea.
function createImpact(scene, toon, impact, name, seed) {
  const T = impact.time, S = impact.size, large = S >= 0.75, centre = new Vector3(impact.x, 0.2, impact.z), until = (birth, from, to) => 1 - smoothstep(from, to, birth);
  const at = (r) => centre.add(new Vector3(2 * r(30) - 1, 0, 2 * r(31) - 1).scale(1.5 * S));
  const flash = createPuffs(scene, toon, `${name} Flash`, '#000000', 1, (day, time) => {
    const age = time - T;
    return [age >= 0 && age < 1.8 ? [centre, 9 * S * Math.min(1, age / 0.15) * (1 - smoothstep(0.3, 1.8, age))] : HIDDEN];
  });
  flash.material.setColor3('glow', glowOf(3, 2.8, 2.4));
  const layers = [flash,
    createParticles(scene, toon, { name: `${name} Water Column`, color: '#e6f4ff', seed: seed + 1, start: T + 0.05, end: T + 0.6, rate: 500 * S, life: [3, 5],
      origin: at, velocity: (r) => { const a = r(11) * 2 * Math.PI; return new Vector3(Math.cos(a) * (2 + 4 * r(4)), 14 + 14 * r(3), Math.sin(a) * (2 + 4 * r(4))).add(DOWNRANGE.scale(4 + 3 * r(5))).scale(S); },
      gravity: -9.8, drag: 0.15, size: swell(0.2 * S, 0.75 * S) }),
    createParticles(scene, toon, { name: `${name} Spray`, color: '#ffffff', seed: seed + 2, start: T + 0.05, end: T + 1.2, rate: 500 * S, life: [1.5, 3],
      origin: at, velocity: (r) => thrown(r, 0.3, (14 + 12 * r(3)) * S), gravity: -9.8, drag: 0.3, size: pop(0.18 * S) }),
    createParticles(scene, toon, { name: `${name} Vapor`, color: '#dfe7f2', seed: seed + 3, start: T + 0.05, end: T + 0.2, rate: 1100 * S, life: [2, 3.5],
      origin: (r) => centre.add(new Vector3(0, (0.3 + r(5)) * S, 0)), velocity: (r) => { const a = r(11) * 2 * Math.PI; return new Vector3(Math.cos(a), 0.05, Math.sin(a)).scale((20 + 8 * r(3)) * S * waveReach(a)); },
      drag: 1.3, gravity: 0.4, size: swell(0.4 * S, 1.1 * S) }),
    createParticles(scene, toon, { name: `${name} Steam`, color: '#f2f5fa', seed: seed + 4, start: T + 0.5, end: T + 30, rate: 14 * S, life: [5, 8],
      origin: (r) => centre.add(new Vector3(2 * r(30) - 1, 0, 2 * r(31) - 1).scale(4.5 * S)), velocity: (r) => new Vector3(0, 2 + r(3), 0), drag: 0.5, gravity: 0.6,
      wind: new Vector3(-0.3, 0, -0.15), turbulence: 0.4, size: swell(0.3 * S, 1.4 * S), strength: (birth) => until(birth, T + 12, T + 30) })];
  if (!large) return together(...layers);

  const billow = (title, glow, count, speed, peak, life, k) => createParticles(scene, toon, { name: `${name} ${title}`, color: '#000000', glow: glowOf(...glow), seed: seed + k, start: T, end: T + 0.3,
    rate: count / 0.3, life, origin: at, velocity: (r) => thrown(r, 0.25, speed * S * (0.5 + r(3))), drag: 1.6, gravity: 3, turbulence: 0.5, size: swell(peak * S * 0.3, peak * S) });
  const DEBRIS = Math.round(80 * S), TRAIL = 6, debrisAt = (j, age) => {
    const r = (k) => rnd(seed, j, k), a = r(1) * 2 * Math.PI, out = (5 + 9 * r(2)) * S * waveReach(a) ** 2, up = (7 + 10 * r(3)) * S;
    const p = centre.add(new Vector3(Math.cos(a) * out * age, up * age - 4.9 * age * age, Math.sin(a) * out * age));
    return { p, landed: p.y < Math.max(0, heightAt(p.x, p.z)) && age > 0.3, size: (0.15 + 0.25 * r(4)) * S };
  };
  const debris = createPuffs(scene, toon, `${name} Debris`, '#2b2228', DEBRIS * (TRAIL + 1), (day, time) => {
    const age = time - T, out = [];
    for (let j = 0; j < DEBRIS; j++) for (let k = 0; k <= TRAIL; k++) {
      const { p, landed, size } = debrisAt(j, age - k * 0.06);
      out.push(age - k * 0.06 > 0 && age < 5 && !landed ? [p, (k ? 0.6 * size * (1 - k / (TRAIL + 1)) : size) * (1 - smoothstep(3.5, 5, age))] : HIDDEN);
    }
    return out;
  });
  debris.material.setColor3('glow', glowOf(1.9, 0.5, 0.06));

  const SEGMENTS = 96, segment = createMesh(`${name} Wave`, {
    vertices: [[-0.5, -0.3, 0], [-0.5, 0, 1], [-0.5, 0.45, 0.15], [0.5, -0.3, 0], [0.5, 0, 1], [0.5, 0.45, 0.15]],
    faces: [[0, 1, 4, 3], [1, 2, 5, 4], [0, 3, 5, 2], [0, 2, 1], [3, 4, 5]],
  }, scene);
  segment.material = toon.plain(`${name} Wave`, '#bfe6f7');
  const buffer = setMatrices(segment, SEGMENTS);
  // The leading crest, in segments that follow its lobes, each a little higher or lower, broken by the island (the sea
  // draws the train behind).
  const wave = (day, time) => {
    const age = time - T;
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * 2 * Math.PI, R = waveRadius(impact, age, a), j = rnd(seed + 66, i, 0), p = around(impact, R, a, -0.05);
      const h = waveHeight(impact, age, a) * (0.8 + 0.4 * j) * (0.9 + 0.1 * Math.sin(age * (2 + 3 * j) + 6.28 * j)) * (1 - islandShadow(impact, p.x, p.z));
      const length = (2 * Math.PI * R) / SEGMENTS * (1.2 + 0.15 * j), lean = Math.atan2(waveRadius(impact, age, a + 0.01) - waveRadius(impact, age, a - 0.01), 0.02 * R);
      place(buffer, i, p, h > 0.02 ? new Vector3(length, h, 2.5 + 1.5 * h) : new Vector3(1e-4, 1e-4, 1e-4), Quaternion.RotationAxis(Vector3.Up(), -a + Math.PI / 2 - lean));
    }
    segment.thinInstanceBufferUpdated('matrix');
  };
  // Foam along the crest, and where it breaks on the shore, surf thrown high.
  const crest = (r, birth) => { const a = r(11) * 2 * Math.PI; return around(impact, waveRadius(impact, birth - T, a), a, 0); };
  const open = (r, birth) => { const p = crest(r, birth); return 1 - islandShadow(impact, p.x, p.z); };
  const breaking = (r, birth) => { const p = crest(r, birth); return landAt(p.x, p.z) * (1 - landAt(lerp(impact.x, p.x, 0.85), lerp(impact.z, p.z, 0.85))); };
  return together(...layers, debris, wave,
    billow('Fire Hot', [2.6, 2.2, 1.0], 70, 8, 1.8, [1.2, 2.5], 21), billow('Fire', [2.4, 0.9, 0.12], 110, 11, 2.4, [2, 3.6], 22),
    billow('Fire Red', [1.4, 0.22, 0.04], 120, 14, 2.9, [2.5, 4.5], 23),
    createParticles(scene, toon, { name: `${name} Sparks`, color: '#000000', glow: glowOf(2.8, 2.4, 1.2), seed: seed + 25, start: T, end: T + 0.15, rate: 1200 * S, life: [0.8, 2],
      origin: at, velocity: (r) => thrown(r, 0.3, (12 + 14 * r(3)) * S), gravity: -9.8, drag: 0.4, size: pop(0.12 * S) }),
    createParticles(scene, toon, { name: `${name} Wave Foam`, color: '#ffffff', seed: seed + 64, start: T + 0.3, end: T + 22, rate: 260, life: [0.6, 1.2],
      origin: (r, birth) => crest(r, birth).add(new Vector3(0, waveHeight(impact, birth - T, r(11) * 2 * Math.PI) * 0.9, 0)),
      velocity: (r) => new Vector3((2 * r(32) - 1) * 0.6, 1.5 + 1.5 * r(3), (2 * r(33) - 1) * 0.6), gravity: -5,
      size: (age, r, birth) => pop(0.28 * S)(age, r) * Math.min(1, Math.max(0, waveReach(r(11) * 2 * Math.PI)) ** 1.5) * open(r, birth),
      strength: (birth) => Math.min(1, waveHeight(impact, birth - T, WAVE.downrange) / 0.6) }),
    createParticles(scene, toon, { name: `${name} Surf`, color: '#ffffff', seed: seed + 65, start: T + 0.3, end: T + 22, rate: 400, life: [0.8, 1.6],
      origin: (r, birth) => crest(r, birth).add(new Vector3(0, 0.2, 0)), velocity: (r) => new Vector3((2 * r(32) - 1) * 1.2, 3 + 4 * r(3), (2 * r(33) - 1) * 1.2), gravity: -6, drag: 0.4,
      size: (age, r, birth) => swell(0.15 * S, 0.6 * S)(age, r) * breaking(r, birth),
      strength: (birth) => Math.min(1, waveHeight(impact, birth - T, WAVE.downrange) / 0.5) }));
}

// The main strike's smoke: a column lit from below rising into a mushroom cap.
function createStrikeSmoke(scene, toon) {
  const T = BEAT.impact, at = (r) => STRIKE_AT.add(new Vector3(2 * r(30) - 1, 0, 2 * r(31) - 1).scale(1.5));
  return together(
    createParticles(scene, toon, { name: 'Strike Column', color: '#3c3843', underglow: glowOf(1.4, 0.45, 0.08), seed: 26, start: T + 0.2, end: T + 12, rate: 40, life: [6, 9],
      origin: at, velocity: (r) => new Vector3((2 * r(32) - 1) * 0.8, 6 + 3 * r(3), (2 * r(33) - 1) * 0.8), drag: 0.35, gravity: 0.6,
      wind: new Vector3(-0.4, 0, -0.2), turbulence: 0.4, size: swell(0.6, 2.2), strength: (birth) => 1 - smoothstep(T + 6, T + 12, birth) }),
    createParticles(scene, toon, { name: 'Strike Cap', color: '#6e6977', underglow: glowOf(0.9, 0.3, 0.06), seed: 27, start: T + 2, end: T + 18, rate: 14, life: [8, 12],
      origin: (r) => STRIKE_AT.add(new Vector3(0, 15 + 4 * r(3), 0)), velocity: (r) => { const a = r(11) * 2 * Math.PI; return new Vector3(Math.cos(a), 0.15, Math.sin(a)).scale(2 + 2 * r(4)); },
      drag: 0.4, gravity: 0.1, turbulence: 0.5, size: swell(1, 3), strength: (birth) => 1 - smoothstep(T + 8, T + 16, birth) }));
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
  return together(createFireball(scene, toon), createFragments(scene, toon), ...IMPACTS.map((impact, k) => createImpact(scene, toon, impact, k ? `Fragment ${k}` : 'Strike', 200 + 40 * k)), createStrikeSmoke(scene, toon), createEmberRain(scene, toon), createGroundFire(scene, toon), createAfter(scene, toon));
}
