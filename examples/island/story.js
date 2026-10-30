// The story's clock and beats. The story is told in seconds of story time, which the film plays at its own pace: in
// slow motion at its hardest moments, as Blender's time remapping plays a scene slower. Island time is in days, a
// time-lapse only between the story's moments (and while the island forms): within a moment it nearly stops, so its
// light holds. Everything that happens is a function of these.
import { heightAt, shore } from './island.js';

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// The story in seconds of story time.
export const BEAT = {
  arrive: 40, mate: 47, court: 51, nest: 57, egg: 64, hatch: 82.5, feed: 86, lesson: 99, tryFly: 105.5,
  omen: 109, leave: 121, streak: 128, impact: 134, embers: 143, climax: 155, fall: 155.8, gone: 156.6,
  mourn: 161.5, dawn: 171, found: 174, reunion: 178.6, after: 186,
};
export const FPS = 24, LENGTH = 200;
// Slow motion: [first story second, last, story seconds a second of film shows there], eased in and out over 0.6 s.
const SLOW = [[133.4, 136.2, 0.3], [154.7, 157.2, 0.35], [178.2, 179.4, 0.5]];
export const rateAt = (s) => SLOW.reduce((rate, [a, b, slow]) => Math.min(rate, lerp(1, slow, smoothstep(a - 0.6, a, s) * (1 - smoothstep(b, b + 0.6, s)))), 1);
// Film seconds at each step of story time, and back.
const STEP = 1 / 240, FILM = new Float64Array(Math.ceil(LENGTH / STEP) + 2);
for (let i = 1; i < FILM.length; i++) FILM[i] = FILM[i - 1] + STEP / rateAt((i - 0.5) * STEP);
const sample = (table, i) => { const k = Math.min(table.length - 2, Math.max(0, Math.floor(i))); return lerp(table[k], table[k + 1], Math.min(1, i - k)); };
export const filmAt = (s) => sample(FILM, s / STEP);
const storyAt = (film) => {
  let lo = 0, hi = FILM.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (FILM[mid] <= film) lo = mid; else hi = mid; }
  return (lo + Math.min(1, Math.max(0, (film - FILM[lo]) / (FILM[hi] - FILM[lo])))) * STEP;
};
export const FRAMES = Math.round(filmAt(LENGTH) * FPS);
// The story second a frame shows, and the frame that shows a story second.
export const seconds = (frame) => storyAt(Math.max(0, frame - 1) / FPS);
export const frameAt = (s) => Math.round(filmAt(s) * FPS) + 1;

// Days per second of story: [second, speed] keys, linear between. The time-lapse runs while the island forms, then
// only in short bursts between the story's moments; within one the sun barely moves. The bursts' speeds are solved in
// turn so they court in the morning, the egg comes one morning, its vigil and the star's last night are at night, the
// chick hatches at dawn, the lesson is in the morning, the flock leaves at dawn, the asteroid strikes just after sunset,
// and the night of mourning ends at sunrise.
const keys = ([morning, build, vigil, dawn, grow, night, leave, dusk, after]) => [
  [0, 0.12], [5, 0.135], [10, 0.16], [15, 0.215], [20, 0.29], [25, 0.38], [30, 0.5], [35, morning], [40, morning], [43, 0.005], [56, 0.005],
  [58, build], [62, build], [64, 0.006], [66, vigil], [75, vigil], [77, 0.3], [79, dawn], [80.5, 0.003], [85, 0.003], [86.5, 0.005], [92, 0.005],
  [93.5, grow], [97.5, grow], [99, 0.004], [109, 0.004], [111, 0.3], [113, night], [115, 0.006], [117, 0.006], [119, leave], [121, 0.006],
  [123, 0.06], [125, dusk], [127, 0.004], [140, 0.003], [148, 0.004], [169, 0.003], [170.5, after], [172.5, after], [173.5, 0.004], [200, 0.004],
];
const speedOf = (k, t) => {
  const i = k.findIndex(([s], j) => t >= s && t <= (k[j + 1]?.[0] ?? Infinity));
  const [s0, v0] = k[i], [s1, v1] = k[i + 1] ?? k[i];
  return s1 === s0 ? v0 : lerp(v0, v1, (t - s0) / (s1 - s0));
};
const integrate = (k) => {
  const table = new Float64Array(LENGTH * FPS + 2);
  for (let f = 2; f < table.length; f++) table[f] = table[f - 1] + (speedOf(k, (f - 2) / FPS) + speedOf(k, (f - 1) / FPS)) / (2 * FPS);
  return table;
};
// Each speed in turn brings the day at its moment to a time of day (a fraction), the speed nearest a guess: the day is
// linear in it, and later speeds do not change earlier moments.
const TIMES = [[48, 0.3, 0.3], [BEAT.egg, 0.1, 0.25], [70, 0.75, 0.05], [81.5, 0.02, 0.3], [BEAT.lesson, 0.06, 0.5], [116, 0.75, 0.3], [BEAT.leave, 0.02, 0.15],
  [BEAT.impact, 0.475, 0.2], [BEAT.found, 0.03, 0.15]];
const SPEEDS = keys(TIMES.reduce((solved, [second, fraction, near], i) => {
  const at = (v) => integrate(keys([...solved, v, ...TIMES.slice(i + 1).map(([, , n]) => n)]))[Math.round(second * FPS) + 1];
  const a = at(0), slope = at(1) - a, n = Math.round(a + near * slope - fraction);
  return [...solved, (n + fraction - a) / slope];
}, []));
const DAYS = integrate(SPEEDS);
export const speed = (frame) => speedOf(SPEEDS, seconds(frame));
export const days = (frame) => sample(DAYS, seconds(frame) * FPS + 1);

// The eruption: lava runs from the crater to the sea over its first day and a half, the crater glows until day three.
export const eruption = (day) => 1 - smoothstep(2.2, 3, day);
// The day the grass reaches a place `s` of the way from the centre to the shore, after which a tree there may grow.
export const grassDay = (s) => 3.4 + 2 * Math.max(0, 1 - s / 0.85);

// The nest tree: a big blossom tree on the slope between two of the first lava channels.
export const NEST = (() => {
  const angle = 0.93, r = 3.0, x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return { angle, r, x, z, ground: heightAt(x, z) - 0.03, size: 1.75 };
})();
// Where the father and the chick come down after the fall: the beach below the nest, aside from the fire's path to
// the sea, looking up at the fallen tree.
export const MOURN = (() => {
  const angle = NEST.angle - 0.7, r = 0.82 * shore(angle), x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return { angle, x, z, ground: heightAt(x, z) };
})();
// The mouth of an old lava tube on the slope below the nest, where the tree's crown lands as it falls: it throws the
// mother in, and the fire passes over her. It faces down the slope.
export const CAVE = (() => {
  const angle = NEST.angle - 0.18, r = NEST.r + 1.45, x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return { angle, x, z, ground: heightAt(x, z) };
})();
// Where the three come together, on the slope's foot between the beach and the cave.
export const HUDDLE = (() => {
  const x = lerp(MOURN.x, CAVE.x, 0.35), z = lerp(MOURN.z, CAVE.z, 0.35);
  return { angle: Math.atan2(z, x), x, z, ground: heightAt(x, z) };
})();
// Up the slope from the huddle, toward the cave.
const UPHILL = Math.atan2(CAVE.z - HUDDLE.z, CAVE.x - HUDDLE.x);
// The turtle's crawl up out of the sea onto the beach below them: [from, to] as parts of the shore's radius.
export const TURTLE = (() => { const angle = HUDDLE.angle; return { angle, from: 0.97, to: 0.86, start: BEAT.after - 3, end: LENGTH }; })();
// The asteroid: an odd-colored star with a faint trail, in the sky over the far side of the island from the first
// frame. It grows through the film, fast in its last nights, then falls in the dusk just after sunset onto the island's
// far shoulder, behind the volcano from the nest.
export const OMEN = (() => { const a = 4.75, e = 0.3; return { x: Math.cos(a) * Math.cos(e), y: Math.sin(e), z: Math.sin(a) * Math.cos(e) }; })();
// It comes in low out of the omen's side, heading downrange, and strikes glancingly: just off the far side's shoulder,
// ploughing up onto the coast rather than at the island's heart.
export const STRIKE = (() => {
  const angle = NEST.angle + Math.PI - 0.5, r = 6.4;
  return { angle, r, x: Math.cos(angle) * r, z: Math.sin(angle) * r, heading: Math.atan2(-OMEN.z, -OMEN.x) };
})();
// Its wave is no ring: it runs farthest and highest downrange, weakest back toward where the asteroid came from, its
// crest lumpy all round (lobes: [harmonic, amount, phase] round the strike).
export const WAVE = { downrange: STRIKE.heading, lobes: [[1, 0.38, 0], [2, 0.12, 1.1], [3, 0.08, 2.4], [5, 0.05, 0.4], [8, 0.03, 4.1], [13, 0.02, 1.7]],
  // The wave train behind the leading crest: [how far it has run, as part of the first's run; its height].
  train: [[1, 1], [0.8, 0.55], [0.63, 0.3]] };
export const waveReach = (side) => 1 + WAVE.lobes.reduce((sum, [k, amount, phase]) => sum + amount * Math.cos(k * (side - WAVE.downrange) + phase), 0);
// The asteroid breaks up as it hits the thick air. Its pieces fall far out to sea on the island's far side, before and
// after the main chunk, the largest nearly its size: [part of the fall when it breaks off, second it lands, how far
// downrange and across of the strike, size].
export const FRAGMENTS = [[0.26, 132.5, -34, 46, 0.85], [0.3, 132.1, -38, 22, 0.4], [0.33, 133.4, 52, 40, 0.9], [0.34, 132.8, -18, 40, 0.5],
  [0.36, 133.3, 22, 30, 0.55], [0.42, 133.7, -4, 58, 0.4], [0.45, 134.7, 20, 74, 0.8], [0.5, 134.6, 42, 18, 0.6], [0.55, 135.3, 64, 30, 0.45],
  [0.6, 135.8, 10, 92, 0.35]].map(([part, land, along, across, size]) => {
  const h = STRIKE.heading;
  return { part, land, size, x: STRIKE.x + along * Math.cos(h) - across * Math.sin(h), z: STRIKE.z + along * Math.sin(h) + across * Math.cos(h) };
});
// Every impact: the main chunk's and the fragments'.
export const IMPACTS = [{ x: STRIKE.x, z: STRIKE.z, time: BEAT.impact, size: 1 }, ...FRAGMENTS.map(({ x, z, land, size }) => ({ x, z, time: land, size }))];
// How far the island hides a point of sea from an impact, 0 in open water to 1 behind the land: its waves break on it.
export const SHADOW_SAMPLES = 8;
export const landAt = (x, z) => 1 - smoothstep(0.8, 0.95, Math.hypot(x, z) / shore(Math.atan2(z, x)));
export function islandShadow(from, x, z) {
  let shadow = 0;
  for (let k = 1; k <= SHADOW_SAMPLES; k++) { const t = k / (SHADOW_SAMPLES + 1); shadow = Math.max(shadow, landAt(lerp(from.x, x, t), lerp(from.z, z, t))); }
  return shadow;
}
export const omen = (time) => (0.1 + 0.12 * smoothstep(0, BEAT.omen, time) + 0.55 * smoothstep(BEAT.omen, BEAT.leave, time) + 0.23 * smoothstep(BEAT.leave, BEAT.streak, time)) * (1 - smoothstep(BEAT.streak, BEAT.streak + 0.6, time));
export const falling = (time) => (time < BEAT.streak || time > BEAT.impact ? 0 : (time - BEAT.streak) / (BEAT.impact - BEAT.streak));
// Seconds since the strike, and how far its blast has spread across the land then (it races out and slows).
export const sinceStrike = (time) => time - BEAT.impact;
export const blastRadius = (time) => (time < BEAT.impact ? 0 : 6.2 * (1 - Math.exp(-sinceStrike(time) * 2.2)));
export const fromStrike = (x, z) => Math.hypot(x - STRIKE.x, z - STRIKE.z);
// The camera shaking where it stands: the asteroid's roar as it comes, then each impact's blow, reaching it later and
// weaker the farther away it is.
export const SHOCK_SPEED = 30;
export function shake(time, x, z) {
  let sum = 0.12 * smoothstep(BEAT.streak + 2, BEAT.impact, time) * (time < BEAT.impact ? 1 : 0);
  for (const impact of IMPACTS) {
    const d = Math.hypot(x - impact.x, z - impact.z), u = time - impact.time - d / SHOCK_SPEED;
    if (u > 0) sum += (impact.size ** 2 * 1.6 / (1 + d / 15)) * Math.min(1, u * 10) * Math.exp(-u * 1.2);
  }
  return sum;
}
// The ground shaking: the asteroid's roar as it comes, the blow when it strikes, the wave reaching the shore.
export const tremor = (time) => 0.25 * smoothstep(BEAT.streak + 2, BEAT.impact, time) * (time < BEAT.impact ? 1 : 0)
  + (time >= BEAT.impact + 0.4 ? 1.2 * Math.exp(-(time - BEAT.impact - 0.4) * 1.1) : 0);
// The strike's flash, a white burst that fades over a second and a half.
export const flash = (time) => (time >= BEAT.impact ? Math.exp(-(time - BEAT.impact) * 2.5) : 0);
// The shockwave over the volcano: a gust that reaches the nest a moment after the flash.
export const gust = (time) => smoothstep(BEAT.impact + 0.5, BEAT.impact + 0.8, time) * (1 - smoothstep(BEAT.impact + 1.2, BEAT.impact + 2.6, time));

// The fire on the nest's side: burning debris thrown over the ridge lands up the slope from the nest tree, and the fire
// runs down through the forest past the tree to the sea along one line; its front reaches the tree at the climax.
export const fireAngle = (r) => NEST.angle + 0.12 * (Math.sin(r * 1.9 + 1) - Math.sin(NEST.r * 1.9 + 1));
export const IMPACT = (() => {
  const r = 1.3, angle = fireAngle(r), x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return { r, angle, x, z, ground: heightAt(x, z) };
})();
const FIRE = [[BEAT.embers, IMPACT.r], [BEAT.climax - 0.4, NEST.r], [BEAT.mourn + 6, 6.4]];
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
// The burning: hot through the night, out by the morning after.
export const burning = (time) => 1 - smoothstep(BEAT.mourn + 4, BEAT.found + 1, time);

// The camera, shot by shot: [start second, center ('island' or 'nest'), angle round it, distance, height, look-at height,
// angle at the end, distance at the end]. Each shot eases from its start to its end framing and cuts to the next.
export const SHOTS = [
  // The island is born, the star low over its far side.
  [0, 'island', 1.3, 27, 4, 3, 1.55, 22], [6, 'island', 1.55, 21, 7, 1.6, 2.1, 16], [11, 'island', 2.1, 15, 2.6, 2.4, 2.6, 18],
  [16, 'island', 2.6, 18, 5, 1.8, 3.3, 13], [22, 'island', 3.3, 13, 15, 0.5, 4.1, 19], [28, 'island', 4.1, 19, 5.5, 1.4, 4.9, 22],
  // A bird comes to the young island; her mate follows; they court.
  [34, 'island', 0.2, 24, 8, 2, 0.7, 17], [40, 'nest', 1.6, 6.5, 2.2, 1.4, 1.2, 5.2], [46, 'nest', -0.3, 1.8, 2.3, 1.75, 0.0, 1.5],
  // The nest, the egg, a night's vigil.
  [57, 'island', 0.9, 19, 9, 1.6, 1.5, 21], [62, 'nest', 1.6, 1.5, 2.25, 1.7, 1.9, 1.35], [76, 'island', 1.3, 14, 3, 2.5, 1.6, 16],
  // It hatches at dawn; it is fed; it grows.
  [79, 'nest', 0.6, 1.2, 2.27, 1.72, 0.8, 1.42], [86, 'nest', 2.2, 1.65, 2.3, 1.75, 2.0, 1.88], [93, 'island', 1.6, 12, 2.2, 1.2, 2.3, 14],
  // The flying lesson; it tries and fails; its mother comforts it.
  [99, 'nest', 1.1, 3.6, 2.0, 1.9, 0.6, 4.2], [104.5, 'nest', 0.3, 1.35, 2.3, 1.75, 0.5, 1.5],
  // The star grows night by night, over the volcano from the nest; the flock leaves; the island waits.
  [110, 'island', 1.4, 22, 4, 3.5, 1.6, 25], [113.5, 'nest', 1.61, 2.4, 1.3, 2.4, 1.75, 3.0], [119, 'nest', 0.4, 5.5, 0.6, 2.4, 0.2, 6.5],
  [124, 'island', 1.6, 16, 3, 2.5, 1.4, 18],
  // Just after sunset it falls. The family watch it come; it strikes the sea beyond the volcano.
  [127.5, 'nest', 1.61, 3.2, 1.2, 2.8, 1.75, 3.6], [131.5, 'island', 0.25, 34, 6, 3, 0.1, 38],
  // The far side burnt to glass and cratered, the wave racing out; the family alive in the lee of the volcano.
  [139, 'island', 4.3, 30, 8, 2, 4.6, 27], [143, 'nest', 0.6, 1.65, 2.3, 1.75, 0.8, 1.95],
  // Burning debris lights the forest above the nest; the fire comes down; the chick tries again and fails.
  [147, 'nest', 0.55, 7.5, 1.8, 1.8, 0.85, 6.2], [150, 'nest', 1.35, 2.47, 2.3, 1.75, 1.05, 2.17],
  // The climax: the tree catches fire, the chick is pushed and flies, the tree falls with its mother.
  [152.5, 'nest', 2.45, 3.6, 1.2, 1.75, 2.6, 4.2], [156.6, 'nest', 1.5, 7.5, 2.2, 1.0, 1.3, 9.5],
  // The chick turns back for her and will not leave: on the beach below, it calls up at the burning tree and nothing
  // answers; the father comes down beside it; the night goes on.
  [159.4, 'shore', MOURN.angle + 0.35, 4.6, 0.7, 0.35, MOURN.angle + 0.15, 3.6], [164.5, 'shore', MOURN.angle - 0.3, 1.1, 0.3, 0.15, MOURN.angle - 0.15, 0.85],
  [168.5, 'island', MOURN.angle - 0.25, 12, 1.6, 1.3, MOURN.angle - 0.1, 13.5],
  // Sunrise. A faint call from up the slope: out of the cave she comes, a wing bent and her face scarred, and the three
  // huddle together.
  [173.5, 'shore', MOURN.angle - 0.3, 1.1, 0.3, 0.15, MOURN.angle - 0.2, 0.95], [175.4, 'cave', CAVE.angle - 0.25, 1.5, 0.45, 0.15, CAVE.angle - 0.1, 1.25],
  [177, 'huddle', UPHILL - 2.4, 2.0, 0.5, 0.15, UPHILL - 2.1, 1.7], [178.6, 'huddle', UPHILL - 1.85, 1.05, 0.35, 0.18, UPHILL - 1.6, 0.9],
  // The camera draws back over them and up: a turtle hauls out on the beach below; the wasted island, the sea strewn
  // with floating rubble, the lee still green, a whale and her calf out beyond.
  [BEAT.after, 'huddle', UPHILL + Math.PI + 0.3, 1.4, 0.4, 0.15, UPHILL + Math.PI + 0.1, 4], [190.5, 'island', STRIKE.angle - 0.8, 15, 7.5, 0.8, STRIKE.angle - 0.3, 27],
];
const at = ({ x, z, ground }) => ({ x, y: ground, z });
const CENTERS = { nest: at({ ...NEST }), shore: at(MOURN), cave: at(CAVE), huddle: at(HUDDLE), island: { x: 0, y: 0, z: 0 } };
// The camera's place and target at a second of film, and the end of the shot it is in.
export function shotAt(time) {
  // By frame, so a shot starts on the frame its second rounds to.
  const frame = frameAt(time), i = SHOTS.findLastIndex(([start]) => frame >= frameAt(start)), [start, center, a0, d0, height, look, a1, d1] = SHOTS[i];
  const end = SHOTS[i + 1]?.[0] ?? LENGTH, t = smoothstep(0, 1, (time - start) / (end - start)) * 0.9 + 0.1 * (time - start) / (end - start);
  const c = CENTERS[center], angle = lerp(a0, a1, t), distance = lerp(d0, d1, t);
  const x = c.x + Math.cos(angle) * distance, z = c.z + Math.sin(angle) * distance;
  // Clear of the ground: as far above it as the shot's own height, up to 0.6.
  return { position: [x, Math.max(c.y + height, heightAt(x, z) + Math.min(0.6, height)), z], target: [c.x, c.y + look, c.z], end };
}
// The camera's angle round the island at a frame.
export const shotAngle = (frame) => { const { position: [x, , z] } = shotAt(seconds(frame)); return Math.atan2(z, x); };
