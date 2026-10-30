// The family: a seabird finds the young island and settles on a big blossom tree; her mate follows; they court, build
// a nest and keep a night's vigil over the egg; it hatches at dawn and they feed the chick; it fails its first try at
// flying. The asteroid's blast is broken by the volcano, but its burning debris lights the forest above them. When the
// fire reaches the tree, the mother pushes the chick, who has not yet flown, off the branch; she watches it fall and
// catch the air before she opens her wings, and the tree falls with her. The chick turns back for her and sits on the
// beach below calling up at the tree through the night, the father beside it. At first light a faint call comes from
// up the slope: the falling crown threw her into an old lava tube, and the fire passed over her. She limps out, a wing
// bent and her face scarred, and the three, sooty from the fire, huddle together. Their heads say what they feel: where they look,
// how they bow, sleep, nuzzle and look back.
import { createMesh } from '@workbench/sdk';
import { KINDS, cone, blob, grow, createTreeFire } from './forest.js';
import { createBirdKit, headingOf } from './life.js';
import { createParticles, together, pop, glowOf, direction } from './particles.js';
import { setMatrices, place, createPuffs } from './sky.js';
import { heightAt } from './island.js';
import { BEAT, NEST, OMEN, IMPACT, MOURN, CAVE, HUDDLE, LENGTH, smoothstep, lerp, tremor, gust, fireFront, fireAngle } from './story.js';
import { fireballAt } from './meteor.js';

const { Vector3, Quaternion, Color3 } = BABYLON;

// Places: the tree's foot, the nest on its crown, the seat on the nest and perches either side; out to sea.
const BASE = new Vector3(NEST.x, NEST.ground, NEST.z), NEST_AT = BASE.add(new Vector3(0, 0.99 * NEST.size - 0.02, 0)), SEAT = NEST_AT.add(new Vector3(0, 0.14, 0));
const OUT = NEST.angle, around = (a, d, dy = 0) => NEST_AT.add(new Vector3(Math.cos(a) * d, dy, Math.sin(a) * d));
// Perches on the nest's rim.
const PERCH_A = around(OUT + 2.2, 0.22, 0.14), PERCH_B = around(OUT - 1.1, 0.22, 0.14);
const sea = (a, d, y) => new Vector3(Math.cos(a) * d, y, Math.sin(a) * d);
// The tree falls away downhill, out toward the sea.
const FALL_AXIS = Vector3.Cross(Vector3.Up(), new Vector3(Math.cos(OUT), 0, Math.sin(OUT))).normalize();
const treeFall = (time) => 1.5 * smoothstep(BEAT.fall, BEAT.fall + 0.75, time) ** 2;
const onTree = (point, time) => {
  const turn = new BABYLON.Matrix();
  BABYLON.Matrix.FromQuaternionToRef(Quaternion.RotationAxis(FALL_AXIS, -treeFall(time)), turn);
  return BASE.add(Vector3.TransformCoordinates(point.subtract(BASE), turn));
};

// A flight: [second, point, pose] keys ('fly', 'sit' with wings folded, 'spread'); a smooth path through them that
// stays still between two equal points, with the heading along it.
function flight(keys) {
  const pointAt = (time) => {
    const i = Math.max(0, keys.findLastIndex(([t]) => t <= time));
    const [t1, p1] = keys[i], [t2, p2] = keys[i + 1] ?? keys[i];
    if (t2 === t1 || p1.equals(p2)) return p1.clone();
    const [t0, p0] = keys[i - 1] ?? keys[i], [t3, p3] = keys[i + 2] ?? keys[i + 1];
    const u = (time - t1) / (t2 - t1), d = t2 - t1;
    const m1 = p0.equals(p1) || t1 === t0 ? Vector3.Zero() : p2.subtract(p0).scale(d / (t2 - t0)), m2 = p3.equals(p2) || t3 === t2 ? Vector3.Zero() : p3.subtract(p1).scale(d / (t3 - t1));
    return Vector3.Hermite(p1, m1, p2, m2, u);
  };
  const poseAt = (time) => keys[Math.max(0, keys.findLastIndex(([t]) => t <= time))][2] ?? 'fly';
  return { pointAt, poseAt, velocityAt: (time) => pointAt(time + 0.05).subtract(pointAt(time - 0.05)).scale(10) };
}

// Fishing: off the perch, out over the sea, a touch at the water, and back; `k` shortens it.
const fishing = (start, a, back, k = 1) => [[start, back, 'sit'], [start + 0.6 * k, back.add(new Vector3(0.4, 0.6, 0.3))], [start + 2.4 * k, sea(a, 9, 1.3)],
  [start + 3.3 * k, sea(a + 0.05, 10.5, 0.12)], [start + 4.8 * k, sea(a - 0.2, 7.5, 2.6)], [start + 6.3 * k, back.add(new Vector3(-0.5, 0.7, 0.4))], [start + 7 * k, back, 'sit']];
const raised = (h) => SEAT.add(new Vector3(0, h, 0));

const MOTHER = flight([
  [0, sea(OUT + 0.4, 70, 9)], [36, sea(OUT + 0.38, 30, 8)], [38.5, sea(OUT + 0.1, 15, 6)], [41, sea(OUT - 0.5, 7, 4.8)],
  [43, PERCH_A.add(new Vector3(0.9, 0.7, -0.6))], [44.2, PERCH_A, 'sit'],
  // Courting: each in turn opens its wings to the other.
  [51, PERCH_A, 'sit'], [51.6, PERCH_A, 'spread'], [53.2, PERCH_A, 'sit'], [54.6, PERCH_A, 'spread'], [55.6, PERCH_A, 'sit'],
  // The nest; the egg under her; in the night she rises to turn it.
  [57.6, PERCH_A, 'sit'], [58.3, SEAT, 'sit'], [71.6, SEAT, 'sit'], [71.9, raised(0.07), 'sit'], [73, raised(0.07), 'sit'], [73.3, SEAT, 'sit'],
  // It hatches; she steps aside to see it.
  [82.6, SEAT, 'sit'], [83.1, PERCH_A, 'sit'], ...fishing(93.6, OUT + 0.6, PERCH_A, 0.5).slice(1),
  // The flying lesson: a loop round the tree, then a branch to watch the chick try from; then back to it.
  [99, PERCH_A, 'sit'], [99.6, around(OUT + 1.2, 1.2, 0.6)], [100.4, around(OUT - 0.2, 1.1, 0.85)], [101.2, around(OUT - 1.4, 0.9, 0.5)],
  [101.9, around(OUT + 0.6, 0.8, 0.7)], [102.6, PERCH_A, 'sit'], [106.8, PERCH_A, 'sit'], [107.3, SEAT, 'sit'],
  // The star's last nights, and the strike: her wings over the chick.
  [113.5, SEAT, 'sit'], [114, SEAT, 'shelter'], [118.5, SEAT, 'shelter'], [119, SEAT, 'sit'], [131.5, SEAT, 'sit'], [132.4, SEAT, 'shelter'],
  [140, SEAT, 'shelter'], [140.6, SEAT, 'sit'],
  // The push: she rises over the chick, watches it fall and catch the air, and only then opens her wings.
  [154.8, SEAT, 'sit'], [154.95, raised(0.06), 'sit'], [155.62, raised(0.08), 'sit'], [155.7, raised(0.1), 'spread'], [157, raised(0.1), 'spread'],
]);
// The father circles the tree, ever wider and faster, from when the fire is lit until it reaches the tree.
const circling = (time) => {
  const t = time - BEAT.embers, wild = smoothstep(BEAT.climax - 4, BEAT.climax, time), r = 1.4 + 0.5 * wild, a = t * (1.6 + 1.6 * wild);
  return NEST_AT.add(new Vector3(Math.cos(a) * r, 1.1 + 0.35 * Math.sin(t * 2.3) - 0.4 * wild * Math.abs(Math.sin(t * 1.7)), Math.sin(a) * r));
};
const FATHER = flight([
  [0, sea(OUT - 0.8, 70, 9)], [44, sea(OUT - 0.8, 40, 9)], [46, sea(OUT - 0.9, 14, 6)], [47.6, sea(OUT - 0.3, 6, 4.4)], [48.8, PERCH_B.add(new Vector3(-0.8, 0.8, 0.5))],
  [49.6, PERCH_B, 'sit'], [51, PERCH_B, 'sit'], [51.2, PERCH_B, 'spread'], [52.6, PERCH_B, 'sit'], [54, PERCH_B, 'spread'], [55.2, PERCH_B, 'sit'],
  // Twigs for the nest from under the trees.
  [57.6, PERCH_B, 'sit'], [58, PERCH_B.add(new Vector3(0.3, 0.5, 0.2))], [59.2, around(OUT + 0.4, 1.6, -1.5)], [60.2, PERCH_B.add(new Vector3(-0.3, 0.5, 0.3))],
  [60.8, PERCH_B, 'sit'], [61.2, PERCH_B.add(new Vector3(0.3, 0.5, -0.2))], [62.2, around(OUT - 0.5, 1.5, -1.4)], [63, PERCH_B.add(new Vector3(-0.2, 0.5, 0.3))], [63.5, PERCH_B, 'sit'],
  // Food for the chick, and more as it grows.
  ...fishing(84.6, OUT - 0.5, PERCH_B, 0.45), ...fishing(94.2, OUT - 0.2, PERCH_B, 0.5).slice(1),
  // The island waits; he cannot settle.
  [124.4, PERCH_B, 'sit'], [124.9, PERCH_B.add(new Vector3(0.3, 0.6, 0.2))], [125.6, around(OUT + 0.5, 1.4, 1.1)], [126.5, around(OUT - 0.8, 1.3, 0.9)], [127.3, PERCH_B, 'sit'],
  // The gust over the ridge throws him off his perch; he beats his way back.
  [134.6, PERCH_B, 'sit'], [135, PERCH_B.add(new Vector3(Math.cos(OUT) * 0.8, -0.5, Math.sin(OUT) * 0.8))], [135.8, around(OUT - 1.1, 1.3, -0.6)],
  [136.8, around(OUT - 0.3, 1, 0.6)], [137.6, PERCH_B, 'sit'], [BEAT.embers, PERCH_B, 'sit'], [BEAT.embers + 0.6, circling(BEAT.embers + 0.6)],
]);
// The ground under a point, where a bird stands on it.
const onGround = (v) => new Vector3(v.x, heightAt(v.x, v.z) + 0.08, v.z);
// The beach below where they mourn, each facing the fallen tree.
const ROCK_C = onGround(new Vector3(MOURN.x, 0, MOURN.z)), ROCK_F = onGround(ROCK_C.add(new Vector3(-Math.sin(MOURN.angle), 0, Math.cos(MOURN.angle)).scale(0.32)));
const TO_TREE = headingOf(BASE.subtract(ROCK_C));
// The lava tube's mouth, down the slope from the cave; and the huddle: the chick between them, its mother facing it
// from the cave's side, the father at its shoulder.
const CAVE_AT = new Vector3(CAVE.x, CAVE.ground, CAVE.z), DOWN = new Vector3(Math.cos(CAVE.angle), 0, Math.sin(CAVE.angle));
const INSIDE = onGround(CAVE_AT.add(DOWN.scale(0.1))), MOUTH = onGround(CAVE_AT.add(DOWN.scale(0.42)));
const HUD = new Vector3(HUDDLE.x, 0, HUDDLE.z), TOWARD = CAVE_AT.subtract(HUD).multiplyByFloats(1, 0, 1).normalize(), SIDE = new Vector3(-TOWARD.z, 0, TOWARD.x);
const HC = onGround(HUD), HM = onGround(HUD.add(TOWARD.scale(0.3))), HF = onGround(HUD.add(SIDE.scale(0.24)).add(TOWARD.scale(-0.12)));
const MEETING = onGround(Vector3.Lerp(ROCK_C, HC, 0.55));
// After the fall: the father follows the chick down to the beach and stays beside it through the night; in the
// morning he goes to her.
const ESCAPE = flight([
  [155.4, circling(155.4)], [156.2, NEST_AT.add(new Vector3(Math.cos(OUT) * 1.4, -0.9, Math.sin(OUT) * 1.4))], [157.2, sea(OUT + 0.05, 6.5, 2.2)],
  [159.2, sea(MOURN.angle + 0.1, 9.5, 2.8)], [160.8, ROCK_F.add(new Vector3(0.4, 0.6, 0.2))], [161.6, ROCK_F, 'sit'], [176.8, ROCK_F, 'sit'],
  [178.8, HF, 'sit'], [LENGTH + 1, HF, 'sit'],
]);
// The chick wheels back toward the tree and comes down on the beach. At the call it starts up the slope, stops, unsure,
// then runs to her.
const BESIDE = new Vector3(-Math.sin(OUT) * 0.45, -0.12, Math.cos(OUT) * 0.45);
const MOURNING = flight([
  [157.2, sea(OUT + 0.05, 6.5, 2.2).add(BESIDE)], [158.6, sea(OUT - 0.25, 7.5, 2.7)], [159.8, sea(MOURN.angle - 0.1, 7.2, 1.4)], [160.6, ROCK_C, 'sit'],
  [175.2, ROCK_C, 'sit'], [176.2, MEETING, 'sit'], [177.2, MEETING, 'sit'], [178.6, HC, 'sit'], [LENGTH + 1, HC, 'sit'],
]);
// The mother, saved: out of the dark of the tube, limping on her bent wing's side down to them.
const SAVED = flight([
  [175.4, INSIDE, 'sit'], [176.2, MOUTH, 'sit'], [176.9, MOUTH, 'sit'], [178.6, HM, 'sit'], [LENGTH + 1, HM, 'sit'],
]);
// Walking: a hop at each step.
const walking = (path, time, rate = 14) => {
  const point = path.pointAt(time), velocity = path.velocityAt(time), pose = path.poseAt(time);
  const walks = pose === 'sit' && velocity.length() > 0.05;
  return { point: walks ? point.add(new Vector3(0, 0.025 * Math.abs(Math.sin(time * rate)), 0)) : point, pose, velocity: walks || pose !== 'sit' ? velocity : null };
};
const facing = (from, to) => headingOf(to.subtract(from));
const motherAt = (time) => {
  if (time < BEAT.found) {
    const point = MOTHER.pointAt(time);
    return { point: time > BEAT.fall ? onTree(point, time) : point, pose: MOTHER.poseAt(time), velocity: MOTHER.velocityAt(time) };
  }
  // Slow and uneven on her hurt side.
  const step = walking(SAVED, time, 8);
  return { ...step, heading: step.velocity ? undefined : facing(HM, HC), bent: 0.3, scarred: true };
};
const fatherAt = (time) => {
  // In the star's last nights he turns on his branch to face it.
  if (time > 112.5 && time < BEAT.leave) return { point: PERCH_B, pose: 'sit', heading: headingOf(new Vector3(OMEN.x, 0, OMEN.z)) };
  if (time < BEAT.embers + 0.6) return { point: FATHER.pointAt(time), pose: FATHER.poseAt(time), velocity: FATHER.velocityAt(time), tumble: time > 134.6 && time < 135.4 ? (time - 134.6) * 6 : 0 };
  if (time < 155.4) return { point: circling(time), pose: 'fly', velocity: circling(time + 0.05).subtract(circling(time - 0.05)).scale(10) };
  const step = walking(ESCAPE, time);
  return { ...step, heading: step.velocity ? undefined : time < BEAT.found ? TO_TREE : facing(HF, HM) };
};
// The chick: in the nest beside its mother, begging when food comes, flapping to practise; it tries after the lesson
// and fails, tries again as the fire comes and fails; pushed, it falls, then flies at the father's side.
const NESTLING = SEAT.add(new Vector3(Math.cos(OUT) * 0.11, -0.02, Math.sin(OUT) * 0.11));
const chickAt = (time) => {
  const hop = (t0, h, drift = 0) => { const u = (time - t0) / 0.8; return u > 0 && u < 1 ? new Vector3(Math.cos(OUT) * drift * u, h * Math.sin(Math.PI * u), Math.sin(OUT) * drift * u) : null; };
  if (time < BEAT.climax) {
    const tries = hop(BEAT.tryFly, 0.18, 0.06) ?? hop(150.5, 0.32, 0.12), beg = hop(88, 0.04) ?? hop(88.9, 0.04) ?? hop(97.3, 0.04);
    const flutter = (a, b) => smoothstep(a, a + 0.2, time) * (1 - smoothstep(b - 0.2, b, time));
    const wings = tries ? 1 : Math.max(flutter(103, 103.8), beg ? 0.5 : 0);
    return { point: NESTLING.add(tries ?? beg ?? Vector3.Zero()), pose: wings ? 'flutter' : 'sit', wings, heading: headingOf(new Vector3(Math.cos(OUT + 0.8), 0, Math.sin(OUT + 0.8))) };
  }
  // Pushed off the nest's edge: it tumbles and falls, then its wings catch and it rises to the father.
  const u = time - BEAT.climax, edge = NESTLING.add(new Vector3(Math.cos(OUT) * 0.35, 0.05, Math.sin(OUT) * 0.35));
  const fall = edge.add(new Vector3(Math.cos(OUT) * 0.5 * u, -4.2 * u * u, Math.sin(OUT) * 0.5 * u));
  if (time > 157.2) {
    const step = walking(MOURNING, time);
    return { ...step, wings: 1, heading: step.velocity ? undefined : time < BEAT.found ? TO_TREE : facing(HC, HM) };
  }
  const caught = smoothstep(0.55, 1.3, u), father = fatherAt(time);
  const flying = u < 0.55 ? fall : Vector3.Lerp(edge.add(new Vector3(Math.cos(OUT) * 0.27, -1.27, Math.sin(OUT) * 0.27)), father.point.add(BESIDE), caught);
  return { point: flying, pose: 'fly', tumble: u < 0.6 ? u * 9 : 0, wings: 1, velocity: father.velocity };
};

// Where each of the family is at a second: the mother riding the falling tree, then saved; the father; the chick.
export const whereIs = (who, time) => (who === 'mother' ? motherAt(time) : who === 'father' ? fatherAt(time) : chickAt(time)).point;
// Where each looks, when: [from second, to second, what], what(time, birds) giving { look: a point, tuck, nod }; at the
// start of a span the head turns from where it looked over a third of a second.
function gaze(spans) {
  const span = (time) => spans.findLast(([from, to]) => time >= from && time < to);
  const at = (time, birds) => ({ look: null, tuck: 0, nod: 0, ...span(time)?.[2](time, birds) });
  return (time, birds) => {
    const now = at(time, birds), current = span(time), k = current ? 1 - smoothstep(current[0], current[0] + 0.35, time) : 0;
    const before = k ? at(current[0] - 0.01, birds) : null;
    if (!before?.look || !now.look) return now;
    return { look: Vector3.Lerp(now.look, before.look, k), tuck: lerp(now.tuck, before.tuck, k), nod: lerp(now.nod, before.nod, k) };
  };
}
const STAR = new Vector3(OMEN.x, OMEN.y, OMEN.z).scale(60).add(NEST_AT), ABOVE = sea(OUT, 20, 12), BEYOND = new Vector3(0, 8, 0);
const head = (bird) => bird.point.add(new Vector3(0, 0.1, 0));
const fireAt = (time) => {
  const r = Math.max(IMPACT.r, fireFront(time) - 0.3), a = fireAngle(r), x = Math.cos(a) * r, z = Math.sin(a) * r;
  return new Vector3(x, heightAt(x, z) + 0.3, z);
};
const look = (point, extra = {}) => () => ({ look: point, ...extra });
const at = (who, extra = {}) => (time, birds) => ({ look: head(birds[who]), ...(typeof extra === 'function' ? extra(time) : extra) });
const asleep = () => ({ tuck: 1 });

const MOTHER_GAZE = gaze([
  [44.2, 47.5, (t) => ({ look: sea(OUT + Math.sin(t * 0.7), 20, 2) })], [47.5, 51, at('father')], [51, 55.4, at('father', (t) => ({ nod: 0.25 * Math.sin(t * 3) }))],
  [55.4, 56.6, at('father', { nod: -0.2 })], [58.3, 64, look(NEST_AT, { nod: -0.3 })], [64, 66, look(NESTLING, { nod: -0.2 })], [66, 71.6, asleep],
  [71.6, 73.3, look(NESTLING, { nod: -0.4 })], [73.3, 78, asleep], [80.5, 82.5, look(NESTLING, { nod: -0.3 })], [82.5, 86, at('chick', { nod: -0.2 })],
  [86, 90, at('father')], [90, 93.6, at('chick')], [99, 106.8, at('chick')], [107.3, 109, at('chick', (t) => ({ nod: -0.35 + 0.1 * Math.sin(t * 4) }))],
  [114, 118.5, at('chick', { nod: -0.2 })], [121, 123, look(ABOVE)], [128, 134, (t, b) => ({ look: b.fireball })], [134, 136, look(BEYOND)],
  [136, 143, at('chick', { nod: -0.3 })], [143, 154.8, (t, b) => ({ look: t % 3 < 1.6 ? fireAt(t) : head(b.chick) })], [154.8, 155.05, at('chick', { nod: -0.5 })],
  [155.05, 157, at('chick')], [175.4, 176.9, at('chick', { nod: 0.15 })], [176.9, 178.6, at('chick')],
  [178.6, 186, at('chick', (t) => ({ nod: -0.35 + 0.12 * Math.sin(t * 2.2), tuck: 0.2 }))], [186, LENGTH + 1, at('chick', { nod: -0.25, tuck: 0.2 })],
]);
const FATHER_GAZE = gaze([
  [47.6, 49.6, at('mother')], [49.6, 55.4, at('mother', (t) => ({ nod: 0.25 * Math.sin(t * 3 + 1) }))], [55.4, 56.6, at('mother', { nod: -0.2 })],
  [64, 66, look(NESTLING, { nod: -0.3 })], [66, 78, asleep], [82.5, 84.6, at('chick', { nod: -0.3 })], [87.75, 90.5, at('chick', (t) => ({ nod: -0.45 + 0.15 * Math.sin(t * 8) }))],
  [99, 108.5, (t, b) => ({ look: head(t < 102.6 ? b.mother : b.chick) })], [112.5, 121, look(STAR)], [121, 123, look(ABOVE)], [128, 134, (t, b) => ({ look: b.fireball })],
  [137.6, 143, look(BEYOND)], [143, 155.4, (t) => ({ look: fireAt(t) })], [155.4, 157, (t) => ({ look: onTree(SEAT, t) })], [157, 162, at('chick')],
  [162, 165, (t) => ({ look: onTree(SEAT, t) })], [165, 171, at('chick', { nod: -0.3 })], [171, 174.6, at('chick')],
  [174.6, 176.8, look(MOUTH)], [176.8, 182, at('mother', { nod: -0.25 })], [182, LENGTH + 1, at('mother', { nod: -0.4, tuck: 0.3 })],
]);
const CHICK_GAZE = gaze([
  [82.6, 86, at('mother', { nod: 0.3 })], [86, 87.75, at('mother')], [87.75, 90.5, at('father', { nod: 0.5 })], [90.5, 105.4, at('mother')],
  [106.3, 107.3, look(NEST_AT.add(new Vector3(0, -1, 0)), { nod: -0.6 })], [107.3, 109, at('mother', { nod: 0.2 })], [114, 118.5, look(STAR)], [121, 123, look(ABOVE)],
  [128, 134, (t, b) => ({ look: b.fireball })], [134, 140, at('mother', { nod: 0.3 })], [143, 154.8, (t, b) => ({ look: t % 2.6 < 1.3 ? fireAt(t) : head(b.mother) })],
  [154.8, 155.6, at('mother')], [155.6, 157, (t) => ({ look: onTree(SEAT, t) })], [157.6, 166, (t) => ({ look: onTree(SEAT, t) })],
  [166, 167.6, at('father')], [167.6, 170.6, (t) => ({ look: onTree(SEAT, t), nod: -0.5 })], [170.6, 173.8, (t) => ({ look: onTree(SEAT, t) })],
  [173.8, 174.3, at('father')], [174.3, 175.8, look(MOUTH)], [175.8, 178.6, at('mother', { nod: 0.2 })],
  [178.6, 186, at('mother', (t) => ({ nod: 0.25 + 0.1 * Math.sin(t * 3), tuck: 0.25 }))], [186, LENGTH + 1, at('mother', { nod: 0.2, tuck: 0.3 })],
]);

export function createFamily(scene, toon) {
  // The nest tree: a big blossom tree, with the nest on its crown.
  const tree = KINDS.blossom.map(([name, data, color]) => {
    const mesh = createMesh(`Nest ${name}`, data, scene);
    mesh.material = toon.plain(`Nest ${name}`, color);
    return { mesh, buffer: setMatrices(mesh, 1) };
  });
  const nest = createMesh('Nest', cone(8, 0.17, 0, 0.25, 0.11), scene);
  nest.material = toon.plain('Nest', '#7a5235');
  const nestBuffer = setMatrices(nest, 1);
  // The old lava tube: a hump of dark rock on the slope, its mouth facing down toward the beach.
  const tube = [['Lava Tube', blob(0.42, [0, 0, 0]), '#4f4659', 1, 0], ['Lava Tube Mouth', blob(0.2, [0, 0, 0]), '#120d18', 1, 0.36]].map(([name, data, color, , out]) => {
    const mesh = createMesh(name, data, scene);
    mesh.material = toon.plain(name, color);
    return { mesh, buffer: setMatrices(mesh, 1), out };
  });
  const egg = createMesh('Egg', blob(0.055, [0, 0, 0.055]), scene);
  egg.material = toon.plain('Egg', '#f7f0e3');
  const eggBuffer = setMatrices(egg, 1);
  const white = Color3.FromHexString('#fdf9f2'), grey = Color3.FromHexString('#b9b3c6'), DINGY = Color3.FromHexString('#8a8178');
  const parents = createBirdKit(scene, toon, 'Parent', '#fdf9f2', 2), chick = createBirdKit(scene, toon, 'Chick', '#b9b3c6', 1);

  // A bird's pose: along its flight when flying, its wings as the pose says, its head as it looks; breathing when still.
  const pose = (kit, i, { point, pose: p, velocity, heading, wings = 1, tumble = 0 }, size, time, phase, eyes) => {
    const along = velocity && velocity.length() > 0.05 ? velocity : null;
    const facing = heading ?? (along ? headingOf(along) : headingOf(new Vector3(Math.cos(OUT), 0, Math.sin(OUT))));
    const climb = along ? along.y / Math.max(0.2, along.length()) : 0;
    const beat = p === 'sit' ? null : p === 'spread' ? 0.85 + 0.1 * Math.sin(time * 9) : p === 'shelter' ? 0.3 + 0.03 * Math.sin(time * 2)
      : p === 'flutter' ? wings * (0.5 + 0.5 * Math.sin(time * 30)) * 0.9 : (climb > -0.25 ? 0.75 : 0.18) * Math.sin(time * 15 + phase) + 0.1;
    const breath = along ? Vector3.Zero() : new Vector3(0, 0.004 * Math.sin(time * 3 + phase), 0);
    kit.pose(i, point.add(breath), size, facing, { bank: along ? 0.25 * Math.sin(time * 0.7 + phase) : 0, pitch: tumble || (along ? -climb * 0.5 : -0.3 * gust(time)), wings: beat, ...eyes });
  };
  const sparks = createParticles(scene, toon, { name: 'Last Sparks', color: '#000000', glow: glowOf(2.8, 1.6, 0.4), seed: 61, start: BEAT.gone, end: BEAT.gone + 0.12, rate: 500, life: [0.8, 2],
    origin: () => onTree(SEAT, BEAT.gone), velocity: (r) => direction(r, 0.3).scale(1.5 + 2.5 * r(3)), gravity: 0.6, drag: 1.2, turbulence: 0.3, size: pop(0.06) });
  const fire = createTreeFire(scene, toon, [{ at: BASE, size: NEST.size }], { height: 0.4, from: () => BEAT.climax - 0.6, length: 4.2, size: 0.75 });
  const shells = createPuffs(scene, toon, 'Egg Shell', '#f7f0e3', 6, (day, time) => Array.from({ length: 6 }, (_, k) => {
    const u = time - BEAT.hatch, a = k * 1.05;
    return [SEAT.add(new Vector3(Math.cos(a) * 0.25 * u, 0.25 * u - 1.2 * u * u, Math.sin(a) * 0.25 * u)), u > 0 && u < 0.45 ? 0.025 : 0];
  }));

  return together(fire, sparks, shells, (day, time) => {
    // The tree, swaying and shaking, falling and burning away.
    const shaking = tremor(time), lean = 0.025 * Math.sin(time * 2) + 0.1 * shaking * Math.sin(time * 29);
    const fallen = treeFall(time), ash = 1 - smoothstep(BEAT.fall + 1.6, BEAT.dawn, time);
    const turn = Quaternion.RotationAxis(FALL_AXIS, -fallen).multiply(Quaternion.RotationAxis(new Vector3(0.6, 0, 0.8), lean));
    for (const { buffer } of tree) {
      place(buffer, 0, BASE, new Vector3(1, 1, 1).scale(Math.max(1e-4, NEST.size * grow((day - 6.4) / 1.4) * ash)), turn);
    }
    for (const { mesh } of tree) mesh.thinInstanceBufferUpdated('matrix');
    const cooled = smoothstep(2.6, 3.2, day), along = Quaternion.RotationAxis(Vector3.Up(), headingOf(DOWN));
    for (const { mesh, buffer, out } of tube) {
      const at = CAVE_AT.add(DOWN.scale(out)).add(new Vector3(0, out ? 0.1 : -0.12, 0));
      place(buffer, 0, at, (out ? new Vector3(0.45, 0.9, 1.2) : new Vector3(1.1, 0.75, 1.1)).scale(Math.max(1e-4, cooled)), along);
      mesh.thinInstanceBufferUpdated('matrix');
    }
    // The nest and the egg, carried down with the tree.
    const built = smoothstep(BEAT.nest, BEAT.nest + 6, time) * ash, nestAt = onTree(NEST_AT, time);
    place(nestBuffer, 0, nestAt, new Vector3(1, 1, 1).scale(Math.max(1e-4, built)), Quaternion.RotationAxis(FALL_AXIS, -fallen));
    nest.thinInstanceBufferUpdated('matrix');
    const laid = smoothstep(BEAT.egg, BEAT.egg + 0.3, time) * (time < BEAT.hatch ? 1 : 0), wobble = time > BEAT.hatch - 2 ? 0.25 * Math.sin(time * 25) : 0;
    place(eggBuffer, 0, NESTLING.add(new Vector3(0, -0.06, 0)), new Vector3(1, 1, 1).scale(Math.max(1e-4, laid)), Quaternion.RotationAxis(Vector3.Right(), wobble));
    egg.thinInstanceBufferUpdated('matrix');

    // The family: where each is, then how each holds itself and looks. The mother rides the falling tree on her nest
    // until it is gone, and is not seen again until she comes out of the cave.
    const mother = motherAt(time), father = fatherAt(time), young = chickAt(time), birds = { mother, father, chick: young, fireball: fireballAt(time) };
    const shown = smoothstep(35.5, 36.5, time) * (time < BEAT.gone || time > BEAT.found ? 1 : 0);
    // Sooty from the fire's night: smudged and a little dingy all over.
    const dirty = time > BEAT.dawn;
    for (const [kit, color] of [[parents, white], [chick, grey]]) for (const material of kit.materials) material.setColor3('color', dirty ? Color3.Lerp(color, DINGY, 0.35) : color);
    pose(parents, 0, mother, 1.6 * shown, time, 0, { ...MOTHER_GAZE(time, birds), bent: mother.bent, scarred: mother.scarred, dirty });
    pose(parents, 1, father, 1.6 * smoothstep(43.5, 44.5, time), time, 1.7, { ...FATHER_GAZE(time, birds), dirty });
    parents.update();
    // The chick: grey and small.
    const hatched = smoothstep(BEAT.hatch, BEAT.hatch + 0.4, time);
    pose(chick, 0, young, hatched * (0.65 + 0.4 * smoothstep(BEAT.hatch, BEAT.lesson, time)), time, 3.1, { ...CHICK_GAZE(time, birds), dirty });
    chick.update();
  });
}
