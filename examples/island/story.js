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
  omen: 109, leave: 121, streak: 122, entry: 126, impact: 134, embers: 143, crack: 150.5, climax: 155, blast: 155.6, gone: 156.4,
  mourn: 161.5, sleep: 166, dawn: 171, wake: 173, call: 176.5, cave: 181.5, rescue: 184, reunion: 188, after: 195,
};
export const FPS = 24, LENGTH = 208;
// Slow motion: [first story second, last, story seconds a second of film shows there], eased in and out over 0.6 s.
const SLOW = [[133.4, 136.2, 0.3], [154.5, 157, 0.35], [187.6, 189.2, 0.5]];
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
  [123, 0.06], [125, dusk], [127, 0.004], [140, 0.003], [148, 0.004], [169, 0.003], [170.5, after], [172.5, after], [173.5, 0.004], [208, 0.004],
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
  [BEAT.impact, 0.475, 0.2], [BEAT.wake, 0.03, 0.15]];
const SPEEDS = keys(TIMES.reduce((solved, [second, fraction, near], i) => {
  const at = (v) => integrate(keys([...solved, v, ...TIMES.slice(i + 1).map(([, , n]) => n)]))[Math.round(second * FPS) + 1];
  const a = at(0), slope = at(1) - a, n = Math.round(a + near * slope - fraction);
  return [...solved, (n + fraction - a) / slope];
}, []));
const DAYS = integrate(SPEEDS);
export const speed = (frame) => speedOf(SPEEDS, seconds(frame));
export const days = (frame) => sample(DAYS, seconds(frame) * FPS + 1);
// The day at a second of story.
export const dayAt = (second) => sample(DAYS, second * FPS + 1);

// The eruption: lava runs from the crater to the sea over its first day and a half, the crater glows until day three.
export const eruption = (day) => 1 - smoothstep(2.2, 3, day);
// The day the grass reaches a place `s` of the way from the centre to the shore, after which a tree there may grow.
export const grassDay = (s) => 3.4 + 2 * Math.max(0, 1 - s / 0.85);

// The nest tree: a big blossom tree on the slope between two of the first lava channels.
export const NEST = (() => {
  const angle = 0.93, r = 3.0, x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return { angle, r, x, z, ground: heightAt(x, z) - 0.03, size: 1.75 };
})();
// Where the father and the chick come down after the blast: the beach below the nest, aside from the fire's path to
// the sea, looking up at where the tree stood.
export const MOURN = (() => {
  const angle = NEST.angle - 0.7, r = 0.82 * shore(angle), x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  return { angle, x, z, ground: heightAt(x, z) };
})();
// A sea cave on the coast where the blasted land meets the green, round the island from the beach: a hump of dark rock
// with its mouth at the waterline, open to the sea. The wreck of the tree drifts into it overnight.
export const SEA_CAVE = (() => {
  const angle = NEST.angle - 2.5, r = shore(angle);
  return { angle, r, x: Math.cos(angle) * r, z: Math.sin(angle) * r };
})();
// A low shelf of rock at the water beside the cave's mouth, where they come together.
export const SHELF = (() => {
  const a = SEA_CAVE.angle, along = [-Math.sin(a), Math.cos(a)], x = Math.cos(a) * (SEA_CAVE.r + 0.35) + along[0] * 1.35, z = Math.sin(a) * (SEA_CAVE.r + 0.35) + along[1] * 1.35;
  return { angle: Math.atan2(z, x), x, z, ground: 0.18 };
})();
// Halfway round the shore from the beach to the cave, where they pass in the morning.
export const PATH = (() => { const angle = lerp(MOURN.angle, SEA_CAVE.angle, 0.5), r = 0.84 * shore(angle), x = Math.cos(angle) * r, z = Math.sin(angle) * r; return { angle, x, z, ground: heightAt(x, z) }; })();
// The turtle hauls out of the sea on the green side, in the last wide shot: [from, to] as parts of the shore's radius.
export const TURTLE = { angle: SEA_CAVE.angle + 0.45, from: 1.03, to: 0.88, start: BEAT.after - 3, end: LENGTH };
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
// The asteroid's path: from far out along the star's direction down to the sea, slowly at first, ever faster.
const STRIKE_AT = { x: STRIKE.x, y: 0.2, z: STRIKE.z }, FROM = { x: STRIKE.x + OMEN.x * 150, y: 0.2 + OMEN.y * 150, z: STRIKE.z + OMEN.z * 150 };
export const fireballAt = (time) => { const u = falling(time) ** 1.8; return new BABYLON.Vector3(lerp(FROM.x, STRIKE_AT.x, u), lerp(FROM.y, STRIKE_AT.y, u), lerp(FROM.z, STRIKE_AT.z, u)); };
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
// The mountain cracks: a glowing fissure runs down the fire's line from high on the slope to the nest tree's foot,
// slowly, then racing, and bursts there.
export const crackReach = (time) => lerp(IMPACT.r - 0.2, NEST.r - 0.15, Math.min(1, Math.max(0, (time - BEAT.crack) / (BEAT.blast - 0.3 - BEAT.crack))) ** 1.25);
// It runs its own way, apart from the fire's: from high on the slope off to one side, bending down to the tree.
export const crackAngle = (r) => NEST.angle - 0.45 * smoothstep(NEST.r, IMPACT.r - 0.2, r) + 0.04 * Math.sin(r * 7);
export const crackAt = (time) => { const r = crackReach(time), a = crackAngle(r), x = Math.cos(a) * r, z = Math.sin(a) * r; return new BABYLON.Vector3(x, heightAt(x, z), z); };
// The strike's aftermath, for good: ash settling over everything, smoke and haze in the air.
export const aftermath = (time) => smoothstep(BEAT.impact + 1, BEAT.impact + 12, time);
// The burning: hot through the night, out by the morning after.
export const burning = (time) => 1 - smoothstep(BEAT.mourn + 4, BEAT.wake + 1, time);

// The camera, shot by shot: [start second, center, angle round it, distance, height, look-at height, move]. Each shot
// makes one move at one steady pace, cutting on it rather than settling: 'left' or 'right' round its center, 'in' or
// 'out' toward it, 'rise', each a part of the shot's size each second (a number after it scales that), or 'hold'. A
// crane, { to: [center, angle, distance, height, look] }, carries the camera to another framing, easing in and out.
// Cuts change the angle by 30 degrees or the size by half (tests/examples.test.js checks), and keep a sequence's
// direction round its subject.
const PACE = 0.04;
export const SHOTS = [
  // The island is born, the star low over its far side; the camera circles it as it grows.
  [0, 'island', 1.3, 27, 4, 3, 'in left'], [7, 'island', 2.2, 14, 2.4, 2.2, 'left'], [13, 'island', 3.0, 21, 6, 1.6, 'left'],
  [19, 'island', 4.1, 10, 13, 0.5, 'out'], [26, 'island', 4.9, 19, 5, 1.4, 'left'],
  // A bird comes to the young island; her mate follows; they court.
  [34, 'island', 0.2, 24, 8, 2, 'in left'], [40, 'nest', 1.6, 6.5, 2.2, 1.4, 'in'], [46, 'nest', -0.3, 1.8, 2.3, 1.75, 'right 0.5'],
  // The nest, the egg, a night's vigil.
  [57, 'island', 0.9, 19, 9, 1.6, 'left'], [62, 'nest', 1.6, 1.5, 2.25, 1.7, 'right 0.5'], [76, 'island', 1.3, 14, 3, 2.5, 'out'],
  // It hatches at dawn; it is fed; it grows.
  [79, 'nest', 0.6, 1.2, 2.27, 1.72, 'in 0.5'], [86, 'nest', 2.2, 1.65, 2.3, 1.75, 'left 0.5'], [93, 'island', 1.6, 12, 2.2, 1.2, 'left'],
  // The flying lesson; it tries and fails; its mother comforts it.
  [99, 'nest', 1.1, 3.6, 2.0, 1.9, 'out right'], [104.5, 'nest', 0.3, 1.35, 2.3, 1.75, 'in 0.5'],
  // The star grows night by night; the flock grows uneasy and leaves in waves; the family watch it.
  [110, 'island', 1.4, 22, 4, 3.5, 'out'], [113.5, 'nest', 1.61, 2.4, 1.3, 2.4, 'in'], [117, 'island', 2.3, 17, 6, 3, 'left'],
  [119.5, 'nest', 0.4, 5.5, 0.6, 2.4, 'out 0.5'],
  // It comes: the star breaks into a streak and grows over the sea, the island small under it; the family on their
  // tree, tiny under the sky; the fireball shedding fragments; their faces; the strike.
  [122, 'island', 1.62, 30, 1.2, 9, 'in 0.5'], [126, 'nest', 1.61, 6.5, 0.4, 3.4, 'in 0.5'], [128.5, 'island', 1.9, 42, 4, 7, 'in'],
  [131, 'nest', 1.35, 1.6, 2.3, 1.95, 'in'], [132.4, 'island', 0.25, 34, 6, 3, 'out'],
  // The far side burnt to glass, the wave racing out; the family alive in the lee of the volcano.
  [139, 'island', 4.3, 30, 8, 2, 'left'], [143, 'nest', 0.6, 1.65, 2.3, 1.75, 'in'],
  // Burning debris lights the forest above the nest; the chick tries again and fails. The mountain cracks: a glowing
  // fissure races down the slope at the tree. She sees it, cries out, and shoves the chick from the nest; the blast
  // hurls the tree out over the sea with her on it.
  [147, 'nest', 0.55, 7.5, 1.8, 1.8, 'in'], [150, 'nest', NEST.angle - 0.75, 4.2, 2.4, 1.4, 'in 1.5'], [153, 'nest', 1.35, 1.7, 2.3, 1.8, 'in'],
  [154.4, 'nest', 2.45, 2.9, 1.5, 1.7, 'out 2'], [155.5, 'nest', NEST.angle + 1.3, 6.5, 1.0, 1.1, 'out 1.5'],
  // The father and the chick come down on the beach and call up at the smoke; nothing answers. The wreck drifts past
  // out at sea in the dark. They fall asleep pressed together; the night passes.
  [158.5, 'shore', MOURN.angle + 0.35, 4.6, 0.7, 0.35, 'in'], [163, 'island', MOURN.angle - 0.15, 14, 1.4, 1.2, 'left 0.5'],
  [166, 'shore', MOURN.angle + 1.3, 1.25, 0.32, 0.12, 'in 0.5'], [169.5, 'island', NEST.angle - 1.1, 21, 9, 1.4, 'left'],
  // Morning: they wake, and look about them. A faint call. They go round the shore to it, the chick in short hops,
  // and find her on the wreck in a sea cave; the father hauls it in and she climbs out to them.
  [172.5, 'shore', MOURN.angle + 1.3, 1.1, 0.3, 0.12, 'hold'], [175, 'shore', MOURN.angle + 0.5, 1.8, 0.45, 0.2, 'right 0.5'],
  [177.4, 'path', PATH.angle + 0.15, 2.8, 0.7, 0.25, 'right 1.5'], [181.5, 'cave', SEA_CAVE.angle - 0.1, 3.6, 0.5, 0.25, 'in'],
  [184, 'shelf', SEA_CAVE.angle - 0.65, 2.2, 0.5, 0.2, 'in 0.5'], [188, 'shelf', SEA_CAVE.angle + 0.35, 0.95, 0.3, 0.22, 'right 0.5'],
  // The camera draws back from them and up over the island: the wasted far side, the sea strewn with rubble, the
  // green lee, a turtle coming ashore, a whale and her calf.
  [BEAT.after, 'shelf', SEA_CAVE.angle + 0.95, 1.6, 0.45, 0.22, { to: ['island', SEA_CAVE.angle + 0.1, 30, 11, 0.5] }],
];
const at = ({ x, z, ground = 0 }) => ({ x, y: ground, z });
const CENTERS = { nest: at(NEST), shore: at(MOURN), path: at(PATH), cave: at(SEA_CAVE), shelf: at(SHELF), island: { x: 0, y: 0, z: 0 } };
// A shot's framing `t` seconds in: [center, angle, distance, height, look].
export function framing([start, center, angle, distance, height, look, move], t, end) {
  if (typeof move === 'object') {
    const u = smoothstep(0, 1, t / (end - start)), [to, a1, d1, h1, l1] = move.to, c0 = CENTERS[center], c1 = CENTERS[to];
    const c = { x: lerp(c0.x, c1.x, u), y: lerp(c0.y, c1.y, u), z: lerp(c0.z, c1.z, u) };
    return [c, lerp(angle, a1, u), distance * (d1 / distance) ** u, height * (h1 / height) ** u, lerp(look, l1, u)];
  }
  const [, scale = 1] = move.match(/([\d.]+)$/) ?? [], k = PACE * Number(scale) * t, has = (word) => move.includes(word);
  return [CENTERS[center], angle + k * (has('left') ? 1 : has('right') ? -1 : 0), distance * Math.exp(k * (has('in') ? -1 : has('out') ? 1 : 0)),
    height * Math.exp(has('rise') ? k : 0), look];
}
// The camera's place and target at a second of film, and the end of the shot it is in.
export function shotAt(time) {
  // By frame, so a shot starts on the frame its second rounds to.
  const frame = frameAt(time), i = SHOTS.findLastIndex(([start]) => frame >= frameAt(start)), end = SHOTS[i + 1]?.[0] ?? LENGTH;
  const [c, angle, distance, height, look] = framing(SHOTS[i], time - SHOTS[i][0], end);
  const x = c.x + Math.cos(angle) * distance, z = c.z + Math.sin(angle) * distance;
  // Clear of the ground: as far above it as the shot's own height, up to 0.6.
  return { position: [x, Math.max(c.y + height, heightAt(x, z) + Math.min(0.6, height)), z], target: [c.x, c.y + look, c.z], end };
}
// The camera's angle round the island at a frame.
export const shotAngle = (frame) => { const { position: [x, , z] } = shotAt(seconds(frame)); return Math.atan2(z, x); };
