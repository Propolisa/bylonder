// The meteor: a fireball falling on the island late in the day, its strike, and the fire it lights, as layers of particles;
// with the fire light that moves with them and the air and sky they change.
import { createParticles, together, pop, swell, glowOf, direction } from './particles.js';
import { createPuffs } from './sky.js';
import { heightAt } from './island.js';
import { BEAT, OMEN, IMPACT, NEST, smoothstep, falling, fireFront, fireAngle, burning, flash } from './story.js';

const { Vector3, Color3 } = BABYLON;
const HIDDEN = [new Vector3(0, -100, 0), 0];

// The fireball's path: from far out along the new star's direction down to the strike, ever faster.
const IMPACT_AT = new Vector3(IMPACT.x, IMPACT.ground + 0.1, IMPACT.z);
const FROM = IMPACT_AT.add(new Vector3(OMEN.x, OMEN.y, OMEN.z).scale(110));
export const fireballAt = (time) => Vector3.Lerp(FROM, IMPACT_AT, falling(time) ** 1.8);
// A point on the fire's line `r` from the centre, `across` it.
const onFire = (r, across) => {
  const a = fireAngle(r) + across / Math.max(r, 0.5), x = Math.cos(a) * r, z = Math.sin(a) * r;
  return new Vector3(x, heightAt(x, z), z);
};

// The fireball: a white-hot core in yellow and orange shells, flame shed behind it in three layers, a smoke trail that
// hangs in the sky long after, and sparks.
function createFireball(scene, toon) {
  const T0 = BEAT.streak, T1 = BEAT.impact, path = (r, birth) => fireballAt(birth).add(new Vector3((2 * r(20) - 1), (2 * r(21) - 1), (2 * r(22) - 1)).scale(0.25));
  const near = (birth) => 0.6 + 2.4 * falling(birth);
  const shells = [['Fireball Core', [2.6, 2.5, 2.2], 0.55], ['Fireball Shell', [2.6, 1.5, 0.35], 0.85], ['Fireball Glow', [2.2, 0.6, 0.08], 1.25]].map(([name, glow, size]) => {
    const puff = createPuffs(scene, toon, name, '#000000', 1, (day, time) => [time >= T0 && time < T1 ? [fireballAt(time), size * near(time) * (1 + 0.08 * Math.sin(time * 40))] : HIDDEN]);
    puff.material.setColor3('glow', glowOf(...glow));
    return puff;
  });
  const flame = (name, glow, rate, life, peak) => createParticles(scene, toon, { name, color: '#000000', glow: glowOf(...glow), seed: rate, start: T0, end: T1, rate, life,
    origin: path, velocity: (r) => direction(r).scale(0.6), drag: 2, gravity: 0.4, size: pop(peak, 0.05), strength: near });
  return together(...shells,
    flame('Trail Flame Hot', [2.6, 2.1, 0.9], 90, [0.12, 0.25], 0.45), flame('Trail Flame', [2.4, 0.9, 0.12], 70, [0.25, 0.5], 0.6), flame('Trail Flame Red', [1.6, 0.25, 0.04], 50, [0.4, 0.8], 0.75),
    createParticles(scene, toon, { name: 'Trail Smoke', color: '#58525e', underglow: glowOf(0.9, 0.3, 0.06), seed: 4, start: T0, end: T1 - 0.4, rate: 60, life: [4, 6],
      origin: path, velocity: (r) => direction(r).scale(0.4), drag: 0.6, gravity: 0.05, turbulence: 0.12, size: swell(0.3, 1.4), strength: (birth) => 1 - falling(birth) ** 3 }),
    createParticles(scene, toon, { name: 'Trail Sparks', color: '#000000', glow: glowOf(2.6, 2.0, 0.8), seed: 5, start: T0, end: T1, rate: 80, life: [0.5, 1.1],
      origin: path, velocity: (r) => direction(r).scale(2 + 3 * r(3)), gravity: -6, size: pop(0.07), strength: near }));
}

// The strike: a flash, a billowing fireball of flame, glowing debris thrown in arcs trailing embers, a ring of dust
// racing out along the ground, sparks, and a column of smoke lit from below that stands over the island into the night.
function createImpact(scene, toon) {
  const T = BEAT.impact, at = () => IMPACT_AT, burst = (rate, duration) => ({ start: T, end: T + duration, rate });
  const flashBall = createPuffs(scene, toon, 'Impact Flash', '#000000', 1, (day, time) => {
    const age = time - T;
    return [age >= 0 && age < 0.7 ? [IMPACT_AT, 2.2 * Math.min(1, age / 0.08) * (1 - smoothstep(0.12, 0.7, age))] : HIDDEN];
  });
  flashBall.material.setColor3('glow', glowOf(3, 2.8, 2.4));
  const billow = (name, glow, count, speed, peak, life, seed) => createParticles(scene, toon, { name, color: '#000000', glow: glowOf(...glow), seed, ...burst(count / 0.15, 0.15), life,
    origin: at, velocity: (r) => direction(r, 0.35).scale(speed * (0.5 + r(3))), drag: 2.6, gravity: 1.8, turbulence: 0.2, size: swell(peak * 0.3, peak) });
  // Debris: ballistic chunks, each with a trail of embers behind it along its own arc.
  const DEBRIS = 36, TRAIL = 6, debrisAt = (j, age) => {
    const r = (k) => Math.abs(Math.sin(j * 12.9898 + k * 78.233) * 43758.5453) % 1, a = r(1) * 2 * Math.PI, out = 2.5 + 5 * r(2), up = 3 + 6 * r(3);
    const p = IMPACT_AT.add(new Vector3(Math.cos(a) * out * age, up * age - 4.9 * age * age, Math.sin(a) * out * age));
    return { p, landed: p.y < heightAt(p.x, p.z) && age > 0.2, size: 0.07 + 0.08 * r(4) };
  };
  const debris = createPuffs(scene, toon, 'Debris', '#2b2228', DEBRIS * (TRAIL + 1), (day, time) => {
    const age = time - T, out = [];
    for (let j = 0; j < DEBRIS; j++) for (let k = 0; k <= TRAIL; k++) {
      const { p, landed, size } = debrisAt(j, age - k * 0.045);
      out.push(age - k * 0.045 > 0 && age < 3 && !landed ? [p, (k ? 0.6 * size * (1 - k / (TRAIL + 1)) : size) * (1 - smoothstep(2, 3, age))] : HIDDEN);
    }
    return out;
  });
  debris.material.setColor3('glow', glowOf(1.9, 0.5, 0.06));
  return together(flashBall, debris,
    billow('Impact Fire Hot', [2.6, 2.2, 1.0], 26, 4, 1.3, [0.6, 1.2], 21), billow('Impact Fire', [2.4, 0.9, 0.12], 44, 6, 1.9, [1.0, 1.9], 22),
    billow('Impact Fire Red', [1.4, 0.22, 0.04], 50, 7.5, 2.3, [1.5, 2.6], 23),
    createParticles(scene, toon, { name: 'Shockwave Dust', color: '#b8a690', seed: 24, ...burst(90 / 0.1, 0.1), life: [2.5, 4],
      origin: (r) => IMPACT_AT.add(new Vector3((2 * r(30) - 1) * 0.3, 0, (2 * r(31) - 1) * 0.3)),
      velocity: (r) => { const a = r(11) * 2 * Math.PI; return new Vector3(Math.cos(a), 0.06, Math.sin(a)).scale(11 + 6 * r(3)); },
      drag: 2.4, gravity: 0.25, ground: 0.12, size: swell(0.25, 1.3) }),
    createParticles(scene, toon, { name: 'Impact Sparks', color: '#000000', glow: glowOf(2.8, 2.4, 1.2), seed: 25, ...burst(900, 0.1), life: [0.6, 1.5],
      origin: at, velocity: (r) => direction(r, 0.4).scale(7 + 8 * r(3)), gravity: -9.8, drag: 0.4, size: pop(0.06) }),
    createParticles(scene, toon, { name: 'Smoke Column', color: '#3c3843', underglow: glowOf(1.2, 0.4, 0.08), seed: 26, start: T + 0.1, end: BEAT.sea - 1, rate: 45, life: [3.5, 5],
      origin: (r) => IMPACT_AT.add(new Vector3((2 * r(30) - 1) * 0.5, 0.2, (2 * r(31) - 1) * 0.5)),
      velocity: (r) => new Vector3((2 * r(32) - 1) * 0.4, 2 + 1.5 * r(3), (2 * r(33) - 1) * 0.4), drag: 0.35, gravity: 0.25,
      wind: new Vector3(-0.35, 0, -0.2), turbulence: 0.25, size: swell(0.12, 0.75), strength: (birth) => 1 - smoothstep(BEAT.sea - 3, BEAT.sea, birth) }),
    createParticles(scene, toon, { name: 'Smoke Column Pale', color: '#6e6977', seed: 27, start: T + 0.4, end: BEAT.sea - 2, rate: 18, life: [4, 5.5],
      origin: (r) => IMPACT_AT.add(new Vector3(0, 1.5 + r(3), 0)), velocity: (r) => new Vector3(0, 1.6 + r(4), 0), drag: 0.3, gravity: 0.2,
      wind: new Vector3(-0.5, 0, -0.25), turbulence: 0.35, size: swell(0.2, 0.95), strength: (birth) => 1 - smoothstep(BEAT.sea - 4, BEAT.sea, birth) }));
}

// The fire running down the slope: flames in three colors along its front, smoke, and embers rising.
function createGroundFire(scene, toon) {
  const along = (r, birth) => {
    const front = fireFront(birth);
    return onFire(Math.max(IMPACT.r, front - 1.4 * r(30)), (2 * r(31) - 1) * 0.55).add(new Vector3(0, 0.05, 0));
  };
  const strength = (birth) => (birth > BEAT.impact ? burning(birth) : 0);
  const flame = (name, glow, rate, life, peak, seed) => createParticles(scene, toon, { name, color: '#000000', glow: glowOf(...glow), seed, start: BEAT.impact, end: BEAT.heal, rate, life,
    origin: along, velocity: (r) => new Vector3((2 * r(32) - 1) * 0.2, 1.2 + r(3), (2 * r(33) - 1) * 0.2), drag: 1.5, gravity: 1.2, turbulence: 0.15, size: pop(peak, 0.2), strength });
  return together(flame('Fire Hot', [2.6, 1.9, 0.6], 40, [0.3, 0.6], 0.22, 31), flame('Fire', [2.3, 0.75, 0.1], 36, [0.5, 0.9], 0.3, 32), flame('Fire Red', [1.3, 0.2, 0.04], 24, [0.7, 1.2], 0.36, 33),
    createParticles(scene, toon, { name: 'Fire Smoke', color: '#46414d', underglow: glowOf(1, 0.32, 0.06), seed: 34, start: BEAT.impact, end: BEAT.sea, rate: 16, life: [2.5, 4],
      origin: along, velocity: (r) => new Vector3(0, 1 + r(3), 0), drag: 0.5, gravity: 0.3, wind: new Vector3(-0.4, 0, -0.2), turbulence: 0.3, size: swell(0.06, 0.38), strength }),
    createParticles(scene, toon, { name: 'Fire Embers', color: '#000000', glow: glowOf(2.6, 1.2, 0.2), seed: 35, start: BEAT.impact, end: BEAT.heal, rate: 30, life: [1.5, 3],
      origin: along, velocity: (r) => new Vector3((2 * r(32) - 1) * 0.6, 1.5 + 1.5 * r(3), (2 * r(33) - 1) * 0.6), drag: 0.8, gravity: 0.5, turbulence: 0.5, size: pop(0.045), strength }));
}

// After: grey ash drifting down over the island; through the night, embers rising from where the nest tree fell, up
// and up until they are lost among the stars.
function createAfter(scene, toon) {
  const top = new Vector3(NEST.x, NEST.ground + 1.2, NEST.z);
  return together(
    createParticles(scene, toon, { name: 'Ash', color: '#9b97a3', seed: 41, start: BEAT.climax - 1, end: BEAT.heal + 1, rate: 70, life: [5, 7],
      origin: (r) => new Vector3((2 * r(30) - 1) * 11, 6 + 3 * r(3), (2 * r(31) - 1) * 11),
      velocity: () => new Vector3(0, -0.9, 0), wind: new Vector3(-0.3, 0, -0.15), turbulence: 0.35, size: pop(0.05, 0.1),
      strength: (birth) => smoothstep(BEAT.climax - 1, BEAT.climax + 1, birth) * (1 - smoothstep(BEAT.heal - 1, BEAT.heal + 1, birth)) }),
    createParticles(scene, toon, { name: 'Rising Embers', color: '#000000', glow: glowOf(2.4, 1.0, 0.25), seed: 42, start: BEAT.gone, end: BEAT.heal, rate: 8, life: [5, 7],
      origin: (r) => top.add(new Vector3((2 * r(30) - 1) * 0.4, 0, (2 * r(31) - 1) * 0.4)),
      velocity: (r) => new Vector3((2 * r(32) - 1) * 0.2, 1.4 + 0.8 * r(3), (2 * r(33) - 1) * 0.2), turbulence: 0.25,
      size: (age, r) => 0.05 * (0.7 + 0.6 * r(1)) * Math.min(1, age * 6) * (1 - age) ** 1.5 }));
}

// The fire light: the fireball as it comes, the strike's flash, then the burning front with a flicker, dying with the
// night. Its color carries its strength.
export function fireLight(time) {
  const fall = falling(time), F = flash(time), burn = time >= BEAT.impact ? burning(time) : 0;
  if (fall > 0) return { position: fireballAt(time), color: new Color3(2.4, 1.2, 0.35).scale(0.05 + 1.4 * fall ** 4) };
  if (burn <= 0) return { position: new Vector3(0, -50, 0), color: Color3.Black() };
  const flicker = 0.85 + 0.15 * Math.sin(time * 23) * Math.sin(time * 7.3), front = fireFront(time);
  const position = Vector3.Lerp(onFire(Math.max(IMPACT.r, front - 0.4), 0).add(new Vector3(0, 0.9, 0)), IMPACT_AT.add(new Vector3(0, 1.2, 0)), F);
  return { position, color: new Color3(2.4, 1.0, 0.3).scale(burn * 0.45 * flicker).add(new Color3(3, 2.6, 2.2).scale(2 * F)) };
}

export function createMeteor(scene, toon) {
  return together(createFireball(scene, toon), createImpact(scene, toon), createGroundFire(scene, toon), createAfter(scene, toon));
}
