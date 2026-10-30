// The story's clock and beats. Film time is in seconds; island time in days, a time-lapse whose speed follows the
// story: it races while the island is born, slows to watch a family of seabirds, stops almost dead when a meteor
// falls on the island, and races once more as the island heals. Everything that happens is a function of these.
import { heightAt } from './island.js';

export const FPS = 24, LENGTH = 120, FRAMES = LENGTH * FPS;
export const seconds = (frame) => Math.max(0, frame - 1) / FPS;
export const frameAt = (s) => Math.round(s * FPS) + 1;

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// The story in seconds of film.
export const BEAT = {
  arrive: 34, mate: 41, nest: 47, egg: 52, hatch: 62, omen: 76, leave: 84, streak: 92, impact: 95.5, climax: 105, fall: 105.8,
  gone: 106.6, sea: 110, heal: 113, sapling: 114.5, home: 117.6,
};

// Days per second of film: [second, speed] keys, linear between; two speeds are solved so the climax falls at
// sunset and the homecoming at first light, the sun rising as the film ends.
const keys = (v, w) => [
  [0, 0.12], [5, 0.135], [10, 0.16], [15, 0.215], [20, 0.29], [25, 0.38], [30, 0.5], [36, 0.35], [42, 0.16], [58, 0.16],
  [62, 0.25], [64, v], [78, v], [84, 0.08], [90, 0.008], [108, 0.008], [112, 0.06], [114.5, w], [116.6, w], [117.6, 0.08], [120, 0.03],
];
const speedOf = (k, t) => {
  const i = k.findIndex(([s], j) => t >= s && t <= (k[j + 1]?.[0] ?? Infinity));
  const [s0, v0] = k[i], [s1, v1] = k[i + 1] ?? k[i];
  return s1 === s0 ? v0 : lerp(v0, v1, (t - s0) / (s1 - s0));
};
const integrate = (k) => {
  const table = new Float64Array(FRAMES + 2);
  for (let f = 2; f < table.length; f++) table[f] = table[f - 1] + (speedOf(k, (f - 2) / FPS) + speedOf(k, (f - 1) / FPS)) / (2 * FPS);
  return table;
};
// The speed that brings day `at(frame)` to a time of day (its fraction), nearest `near`: days are linear in it.
const solve = (table0, table1, frame, fraction, near) => {
  const a = table0[frame], slope = table1[frame] - a;
  const n = Math.round((a + near * slope - fraction));
  return (n + fraction - a) / slope;
};
const SUNSET = 0.43, DAWN = 0.97;
const V = solve(integrate(keys(0, 0)), integrate(keys(1, 0)), frameAt(BEAT.climax), SUNSET, 0.3);
const W = solve(integrate(keys(V, 0)), integrate(keys(V, 1)), frameAt(BEAT.home), DAWN, 0.9);
const SPEEDS = keys(V, W), DAYS = integrate(SPEEDS);
export const speed = (frame) => speedOf(SPEEDS, seconds(frame));
export const days = (frame) => DAYS[Math.min(DAYS.length - 1, Math.max(1, Math.round(frame)))];

// The eruption: lava runs from the crater to the sea over its first day and a half, the crater glows until day three.
export const eruption = (day) => 1 - smoothstep(2.2, 3, day);
// The meteor: an odd-colored star with a faint trail, low in the sky behind the island from the first frame, that
// grows through the film and fast in the nights before it falls, then a fireball streaking down late in the day.
export const OMEN = (() => { const a = 2.38, e = 0.07; return { x: Math.cos(a) * Math.cos(e), y: Math.sin(e), z: Math.sin(a) * Math.cos(e) }; })();
export const omen = (time) => (0.1 + 0.12 * smoothstep(0, BEAT.omen, time) + 0.55 * smoothstep(BEAT.omen, BEAT.leave, time) + 0.23 * smoothstep(BEAT.leave, BEAT.streak, time)) * (1 - smoothstep(BEAT.streak, BEAT.streak + 0.6, time));
export const falling = (time) => (time < BEAT.streak || time > BEAT.impact ? 0 : (time - BEAT.streak) / (BEAT.impact - BEAT.streak));
// The ground shaking: the fireball's roar as it comes, the blow when it strikes.
export const tremor = (time) => 0.25 * smoothstep(BEAT.streak + 1, BEAT.impact, time) * (time < BEAT.impact ? 1 : 0)
  + (time >= BEAT.impact ? Math.exp(-(time - BEAT.impact) * 1.6) : 0);
// The strike's flash, a white burst that fades in a second.
export const flash = (time) => (time >= BEAT.impact ? Math.exp(-(time - BEAT.impact) * 6) : 0);
// The day the grass reaches a place `s` of the way from the centre to the shore, after which a tree there may grow.
export const grassDay = (s) => 3.4 + 2 * Math.max(0, 1 - s / 0.85);

// The nest tree: a big blossom tree on the slope between two of the first lava channels.
export const NEST = (() => {
  const angle = 0.93, r = 3.0, x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return { angle, r, x, z, ground: heightAt(x, z) - 0.03, size: 1.75 };
})();
// Where the meteor strikes: up the slope from the nest tree. The fire it lights runs down through the forest past the
// tree to the sea along one line; its front's distance from the centre at a time reaches the tree at the climax.
export const fireAngle = (r) => NEST.angle + 0.12 * (Math.sin(r * 1.9 + 1) - Math.sin(NEST.r * 1.9 + 1));
export const IMPACT = (() => {
  const r = 1.3, angle = fireAngle(r), x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return { r, angle, x, z, ground: heightAt(x, z) };
})();
const FIRE = [[BEAT.impact, IMPACT.r], [BEAT.climax - 0.4, NEST.r], [BEAT.sea, 6.4]];
export function fireFront(time) {
  if (time < FIRE[0][0]) return 0;
  const i = time < FIRE[1][0] ? 0 : 1, [t0, r0] = FIRE[i], [t1, r1] = FIRE[i + 1];
  return lerp(r0, r1, Math.min(1, (time - t0) / (t1 - t0)));
}
// When the fire reaches a distance from the centre.
export const fireReaches = (r) => (r <= NEST.r ? lerp(FIRE[0][0], FIRE[1][0], (r - IMPACT.r) / (NEST.r - IMPACT.r)) : lerp(FIRE[1][0], FIRE[2][0], (r - NEST.r) / (6.4 - NEST.r)));
// How far a place is from the fire's line, across it.
export const fromFire = (x, z) => {
  const r = Math.hypot(x, z), d = Math.atan2(z, x) - fireAngle(r);
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * r;
};
// The burning: hot until the night falls, embers after.
export const burning = (time) => 1 - smoothstep(BEAT.sea, BEAT.heal + 0.5, time);
// The burnt ground heals and grass grows back, after the night.
export const healing = (time) => smoothstep(BEAT.heal, BEAT.heal + 4, time);

// The camera, shot by shot: [start second, center ('island' or 'nest'), angle round it, distance, height, look-at height,
// angle at the end, distance at the end]. Each shot eases from its start to its end framing and cuts to the next.
export const SHOTS = [
  [0, 'island', -0.6, 27, 8, 2.2, -0.15, 21], [4.6, 'island', -0.15, 21, 7, 1.6, 0.55, 15], [8.75, 'island', 0.55, 15, 2.6, 2.4, 1.05, 18],
  [12.5, 'island', 1.05, 18, 5, 1.8, 1.7, 13], [17.5, 'island', 1.7, 13, 15, 0.5, 2.5, 19], [22, 'island', 2.5, 19, 5.5, 1.4, 3.6, 22],
  // A bird comes to the young island.
  [30, 'island', 0.2, 24, 8, 2, 0.7, 17], [37.5, 'nest', 1.6, 6.5, 2.2, 1.4, 1.2, 5.2],
  // The pair, the nest, the egg; a night under the trees.
  [44, 'nest', -0.3, 2.6, 1.8, 1.75, 0.1, 2.2], [50, 'island', 0.9, 19, 9, 1.6, 1.5, 21], [56, 'nest', 1.6, 2.1, 2.6, 1.7, 1.9, 1.9],
  // The chick, its first meal, a flying lesson and its first try, which fails.
  [62, 'nest', 0.6, 2.0, 2.6, 1.7, 0.9, 2.4], [68, 'island', 1.6, 12, 2.2, 1.2, 2.3, 14], [74, 'nest', 1.1, 3.6, 2.0, 1.9, 0.6, 4.2],
  // The star grows night by night; the flock leaves; late in the day it falls, seen from where the film began.
  [79.5, 'island', 0.1, 23, 6, 2.5, -0.2, 26], [81, 'nest', -0.69, 2.4, 1.4, 1.85, -0.85, 3.0], [84.5, 'nest', 0.4, 5.5, 0.6, 2.4, 0.2, 6.5],
  [88.5, 'island', 1.2, 18, 4, 2.2, 1.0, 20], [91.5, 'island', -0.5, 24, 2.6, 3.2, -0.72, 21],
  [96.2, 'nest', 0.55, 7.5, 1.8, 1.8, 0.85, 6.2], [99.5, 'nest', 1.35, 3.3, 1.7, 1.75, 1.05, 2.9],
  // The climax: the tree catches fire, the chick is pushed and flies, the tree falls.
  [103, 'nest', 2.45, 3.6, 1.2, 1.75, 2.6, 4.2], [106.6, 'nest', 1.5, 7.5, 2.2, 1.0, 1.3, 9.5],
  // The night after; the island heals; home.
  [109, 'island', 1.35, 15.5, 3.3, 2.6, 1.55, 17], [113, 'island', 0.6, 20, 9, 1.4, 0.9, 16], [116.5, 'nest', 0.9, 2.3, 0.8, 0.7, 1.05, 2.8],
  // Sunrise over the healed island; the flock home, a whale and her calf.
  [118.8, 'island', 1.05, 12, 2.4, 1.8, 1.0, 17],
];
const centerOf = (name) => (name === 'nest' ? { x: NEST.x, y: NEST.ground, z: NEST.z } : { x: 0, y: 0, z: 0 });
// The camera's place and target at a second of film, and the end of the shot it is in.
export function shotAt(time) {
  // By frame, so a shot starts on the frame its second rounds to.
  const frame = Math.round(time * FPS) + 1, i = SHOTS.findLastIndex(([start]) => frame >= frameAt(start)), [start, center, a0, d0, height, look, a1, d1] = SHOTS[i];
  const end = SHOTS[i + 1]?.[0] ?? LENGTH, t = smoothstep(0, 1, (time - start) / (end - start)) * 0.9 + 0.1 * (time - start) / (end - start);
  const c = centerOf(center), angle = lerp(a0, a1, t), distance = lerp(d0, d1, t);
  const x = c.x + Math.cos(angle) * distance, z = c.z + Math.sin(angle) * distance;
  return { position: [x, Math.max(c.y + height, heightAt(x, z) + 0.6), z], target: [c.x, c.y + look, c.z], end };
}
// The camera's angle round the island at a frame.
export const shotAngle = (frame) => { const { position: [x, , z] } = shotAt(seconds(frame)); return Math.atan2(z, x); };
