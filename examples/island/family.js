// The family: a seabird finds the young island and settles on a big blossom tree; her mate follows; they court, build
// a nest and keep a night's vigil over the egg; it hatches at dawn and they feed the chick; it fails its first try at
// flying. The asteroid's blast is broken by the volcano, but its burning debris lights the forest above them. When the
// fire reaches the tree, the mother pushes the chick, who has not yet flown, off the branch; she watches it fall and
// catch the air. The mountain cracks beneath them: she sees the fissure racing down at the tree and shoves the chick
// off the branch, and the blast hurls the tree out over the sea with her on it. The father and the chick wait on the
// beach, calling into the smoke, and sleep pressed together. In the morning a faint call carries round the shore: the
// wreck drifted into a sea cave in the night, and she is on it, a wing bent and her face scarred. The father hauls it
// in, she climbs out to them, and the three, sooty from the fire, huddle together. Their heads say what they feel: where they look,
// how they bow, sleep, nuzzle and look back.
import { createMesh } from '@workbench/sdk';
import { KINDS, cone, blob, grow, createTreeFire } from './forest.js';
import { createBirdKit, headingOf, wingBeat } from './life.js';
import { createParticles, together, pop, glowOf, direction } from './particles.js';
import { setMatrices, place, createPuffs } from './sky.js';
import { heightAt, shore } from './island.js';
import { BEAT, NEST, OMEN, IMPACT, MOURN, SEA_CAVE, SHELF, LENGTH, crackAt, fireballAt, smoothstep, lerp, tremor, gust, fireFront, fireAngle } from './story.js';

const { Vector3, Quaternion, Color3 } = BABYLON;

// Places: the tree's foot, the nest on its crown, the seat on the nest and perches either side; out to sea.
const BASE = new Vector3(NEST.x, NEST.ground, NEST.z), NEST_AT = BASE.add(new Vector3(0, 0.99 * NEST.size - 0.02, 0)), SEAT = NEST_AT.add(new Vector3(0, 0.14, 0));
const OUT = NEST.angle, around = (a, d, dy = 0) => NEST_AT.add(new Vector3(Math.cos(a) * d, dy, Math.sin(a) * d));
// Perches on the nest's rim.
const PERCH_A = around(OUT + 2.2, 0.22, 0.14), PERCH_B = around(OUT - 1.1, 0.22, 0.14);
const sea = (a, d, y) => new Vector3(Math.cos(a) * d, y, Math.sin(a) * d);
// The blast throws the tree out over the sea, tumbling onto its side; it lands with a splash and drifts round the shore
// through the night into the sea cave, its crown (and the nest) in the cave's mouth. In the morning the father hauls it
// in to the ledge. The wreck's place: where its base is and how it is turned.
const SEAWARD = new Vector3(Math.cos(OUT), 0, Math.sin(OUT)), FALL_AXIS = Vector3.Cross(Vector3.Up(), SEAWARD).normalize();
const FLIGHT = 1.5, LANDS = BEAT.blast + FLIGHT, LYING = Quaternion.RotationAxis(FALL_AXIS, -1.45);
const CROWN = NEST_AT.subtract(BASE), TO_SEA_CAVE = new Vector3(Math.cos(SEA_CAVE.angle), 0, Math.sin(SEA_CAVE.angle));
const crownOf = (base, turn) => base.add(CROWN.applyRotationQuaternion(turn));
const LAND_BASE = sea(OUT, shore(OUT) * 1.08, -0.05), LAND_CROWN = crownOf(LAND_BASE, LYING);
// The cave: its mouth at the waterline, the ledge of rock beside it where they come together.
const MOUTH = sea(SEA_CAVE.angle, SEA_CAVE.r + 0.3, 0.1), ALONG = new Vector3(-TO_SEA_CAVE.z, 0, TO_SEA_CAVE.x);
const LEDGE = new Vector3(SHELF.x, SHELF.ground + 0.08, SHELF.z);
const HAULED = MOUTH.add(ALONG.scale(0.45)).add(TO_SEA_CAVE.scale(0.25));
// The crown's place on the water: from where it landed, round the shore past the beach, into the cave's mouth, and in
// to the ledge as the father hauls it.
const drifted = (time) => {
  const u = smoothstep(LANDS, BEAT.cave - 1.5, time), a = lerp(OUT, SEA_CAVE.angle, u), r = lerp(shore(OUT) * 1.08 + 1.6, SEA_CAVE.r * 0.99, u);
  const out = new Vector3(Math.cos(a) * r, 0.06 + 0.025 * Math.sin(time * 1.7), Math.sin(a) * r);
  return Vector3.Lerp(Vector3.Lerp(LAND_CROWN.multiplyByFloats(1, 0, 1).add(new Vector3(0, 0.06, 0)), out, smoothstep(0, 0.08, u)), MOUTH, smoothstep(0.92, 1, u));
};
export function wreckAt(time) {
  if (time < BEAT.blast) return { base: BASE, turn: Quaternion.Identity() };
  if (time < LANDS) {
    const u = (time - BEAT.blast) / FLIGHT, base = Vector3.Lerp(BASE, LAND_BASE, u).add(new Vector3(0, 2.4 * Math.sin(Math.PI * u), 0));
    return { base, turn: Quaternion.RotationAxis(FALL_AXIS, -1.45 * smoothstep(0, 1, u) - 0.5 * Math.sin(Math.PI * u)) };
  }
  const haul = smoothstep(BEAT.rescue + 0.3, BEAT.rescue + 2.3, time), crown = Vector3.Lerp(drifted(time), HAULED, haul);
  const turn = Quaternion.RotationAxis(Vector3.Up(), 0.04 * Math.sin(time * 0.9)).multiply(LYING);
  return { base: crown.subtract(CROWN.applyRotationQuaternion(turn)), turn };
}
// A point on the tree, wherever the wreck is.
const onTree = (point, time) => { const { base, turn } = wreckAt(time); return base.add(point.subtract(BASE).applyRotationQuaternion(turn)); };

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
  // The push: she rises over the chick and shoves it off; she opens her wings to follow, and the blast takes her.
  [154.8, SEAT, 'sit'], [154.95, raised(0.06), 'sit'], [155.3, raised(0.08), 'sit'], [155.4, raised(0.1), 'spread'], [157, raised(0.1), 'spread'],
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
// The beach below where they wait, the father at the chick's side; in the night he draws close and they sleep.
const ROCK_C = onGround(new Vector3(MOURN.x, 0, MOURN.z)), SIDEWAYS = new Vector3(-Math.sin(MOURN.angle), 0, Math.cos(MOURN.angle));
const ROCK_F = onGround(ROCK_C.add(SIDEWAYS.scale(0.32))), CLOSE_F = onGround(ROCK_C.add(SIDEWAYS.scale(0.17)));
const TO_TREE = headingOf(BASE.subtract(ROCK_C));
// Along the shore from the beach to the cave: a point `u` of the way, `up` above the beach.
const SHORE_PATH = (u, up = 0) => { const a = lerp(MOURN.angle, SEA_CAVE.angle + 0.25, u), r = shore(a) * 0.84, x = Math.cos(a) * r, z = Math.sin(a) * r; return new Vector3(x, Math.max(0.05, heightAt(x, z)) + 0.08 + up, z); };
// On the ledge: the chick in the middle, the mother toward the mouth, the father behind.
const HC = LEDGE, HM = LEDGE.add(ALONG.scale(-0.3)), HF = LEDGE.add(ALONG.scale(0.18)).add(TO_SEA_CAVE.scale(-0.22));
const GRIP = HAULED.add(ALONG.scale(0.28)).add(new Vector3(0, 0.12, 0));
// After the blast: the father catches up with the chick and brings it down to the beach. In the morning he flies round
// the shore to the call, waits on the ledge, then hauls the wreck in by a branch, and goes to them.
const ESCAPE = flight([
  [155.4, circling(155.4)], [156.2, NEST_AT.add(new Vector3(Math.cos(OUT) * 1.4, -0.9, Math.sin(OUT) * 1.4))], [157.2, sea(OUT + 0.05, 6.5, 2.2)],
  [159.2, sea(MOURN.angle + 0.1, 9.5, 2.8)], [160.8, ROCK_F.add(new Vector3(0.4, 0.6, 0.2))], [161.6, ROCK_F, 'sit'], [165.6, ROCK_F, 'sit'],
  [166.4, CLOSE_F, 'sit'], [176.9, CLOSE_F, 'sit'], [177.4, SHORE_PATH(0.05, 0.9)], [179, SHORE_PATH(0.45, 1.3)], [180.6, SHORE_PATH(0.85, 1.1)],
  [181.4, HF.add(new Vector3(0, 0.4, 0))], [181.8, HF, 'sit'], [184, HF, 'sit'], [184.4, GRIP, 'spread'], [186.3, GRIP.add(HAULED.subtract(MOUTH)), 'spread'],
  [186.8, HF, 'sit'], [LENGTH + 1, HF, 'sit'],
]);
// The chick wheels back toward the tree and comes down on the beach. In the morning it goes after the father round the
// shore in short hops, wings flailing, and up onto the ledge.
const BESIDE = new Vector3(-Math.sin(OUT) * 0.45, -0.12, Math.cos(OUT) * 0.45);
const HOPS = [0, 0.2, 0.38, 0.55, 0.72, 0.88].map((u, k) => [177.1 + k * 0.85, SHORE_PATH(u)]);
const MOURNING = flight([
  [157.2, sea(OUT + 0.05, 6.5, 2.2).add(BESIDE)], [158.6, sea(OUT - 0.25, 7.5, 2.7)], [159.8, sea(MOURN.angle - 0.1, 7.2, 1.4)], [160.6, ROCK_C, 'sit'],
  [177.1, ROCK_C, 'sit'],
  ...HOPS.slice(1).flatMap(([t, p], k) => [[t - 0.6, Vector3.Lerp(HOPS[k][1], p, 0.5).add(new Vector3(0, 0.45, 0)), 'flutter'], [t - 0.2, p, 'sit']]),
  [182.1, HC.add(new Vector3(0, 0.35, 0)), 'flutter'], [182.5, HC, 'sit'], [LENGTH + 1, HC, 'sit'],
]);
// Walking: a hop at each step.
const walking = (path, time, rate = 14) => {
  const point = path.pointAt(time), velocity = path.velocityAt(time), pose = path.poseAt(time);
  const walks = pose === 'sit' && velocity.length() > 0.05;
  return { point: walks ? point.add(new Vector3(0, 0.025 * Math.abs(Math.sin(time * rate)), 0)) : point, pose, velocity: walks || pose !== 'sit' ? velocity : null };
};
const facing = (from, to) => headingOf(to.subtract(from));
// The mother: on the nest until the blast takes the tree; then on the wreck, unseen until they find her in the cave,
// limp and slow; once it is hauled in she scrambles across to the ledge.
const CLIMBS = BEAT.rescue + 2.6;
const motherAt = (time) => {
  if (time < BEAT.cave) {
    const point = MOTHER.pointAt(time);
    return { point: time > BEAT.blast ? onTree(point, time) : point, pose: MOTHER.poseAt(time), velocity: MOTHER.velocityAt(time) };
  }
  const injured = { bent: 0.3, scarred: true };
  if (time < CLIMBS) return { point: onTree(SEAT, time), pose: 'sit', heading: facing(MOUTH, HC), ...injured };
  const u = smoothstep(CLIMBS, CLIMBS + 1.1, time), from = onTree(SEAT, CLIMBS), point = Vector3.Lerp(from, HM, u).add(new Vector3(0, 0.3 * Math.sin(Math.PI * u), 0));
  return { point, pose: u > 0 && u < 1 ? 'flutter' : 'sit', wings: 0.6, heading: facing(from, HM), ...injured };
};
const fatherAt = (time) => {
  // In the star's last nights he turns on his branch to face it.
  if (time > 112.5 && time < BEAT.leave) return { point: PERCH_B, pose: 'sit', heading: headingOf(new Vector3(OMEN.x, 0, OMEN.z)) };
  if (time < BEAT.embers + 0.6) return { point: FATHER.pointAt(time), pose: FATHER.poseAt(time), velocity: FATHER.velocityAt(time), tumble: time > 134.6 && time < 135.4 ? (time - 134.6) * 6 : 0 };
  if (time < 155.4) return { point: circling(time), pose: 'fly', velocity: circling(time + 0.05).subtract(circling(time - 0.05)).scale(10) };
  const step = walking(ESCAPE, time);
  const toward = time < BEAT.wake ? TO_TREE : time < 177.4 ? facing(ROCK_C, SHORE_PATH(1)) : time < 184.3 ? facing(HF, MOUTH) : facing(HF, HC);
  return { ...step, heading: step.velocity && step.pose !== 'spread' ? undefined : toward };
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
    return { ...step, wings: 1, heading: step.velocity ? undefined : time < BEAT.wake ? TO_TREE : time < 177 ? facing(ROCK_C, SHORE_PATH(1)) : facing(HC, HM) };
  }
  const caught = smoothstep(0.55, 1.3, u), father = fatherAt(time);
  const flying = u < 0.55 ? fall : Vector3.Lerp(edge.add(new Vector3(Math.cos(OUT) * 0.27, -1.27, Math.sin(OUT) * 0.27)), father.point.add(BESIDE), caught);
  return { point: flying, pose: 'fly', tumble: u < 0.6 ? u * 9 : 0, wings: 1, velocity: father.velocity };
};

// Where each of the family is at a second: the mother on the tree, then on the wreck; the father; the chick.
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
// Looking out to sea from the beach, slowly from side to side.
const sweeping = (phase) => (t) => ({ look: sea(MOURN.angle + 0.8 * Math.sin(t * 0.6 + phase), 12, 1), nod: -0.2 });

const MOTHER_GAZE = gaze([
  [44.2, 47.5, (t) => ({ look: sea(OUT + Math.sin(t * 0.7), 20, 2) })], [47.5, 51, at('father')], [51, 55.4, at('father', (t) => ({ nod: 0.25 * Math.sin(t * 3) }))],
  [55.4, 56.6, at('father', { nod: -0.2 })], [58.3, 64, look(NEST_AT, { nod: -0.3 })], [64, 66, look(NESTLING, { nod: -0.2 })], [66, 71.6, asleep],
  [71.6, 73.3, look(NESTLING, { nod: -0.4 })], [73.3, 78, asleep], [80.5, 82.5, look(NESTLING, { nod: -0.3 })], [82.5, 86, at('chick', { nod: -0.2 })],
  [86, 90, at('father')], [90, 93.6, at('chick')], [99, 106.8, at('chick')], [107.3, 109, at('chick', (t) => ({ nod: -0.35 + 0.1 * Math.sin(t * 4) }))],
  [114, 118.5, at('chick', { nod: -0.2 })], [121, 123, look(ABOVE)], [128, 134, (t, b) => ({ look: b.fireball })], [134, 136, look(BEYOND)],
  [136, 143, at('chick', { nod: -0.3 })], [143, 152.6, (t, b) => ({ look: t % 3 < 1.6 ? fireAt(t) : head(b.chick) })],
  [152.6, 154.3, (t) => ({ look: crackAt(t), nod: -0.1 })], [154.3, 154.8, at('chick')], [154.8, 155.05, at('chick', { nod: -0.5 })], [155.05, 156.4, at('chick')],
  [BEAT.cave, BEAT.rescue + 0.2, look(HC, { nod: -0.5, tuck: 0.5 })], [BEAT.rescue + 0.2, BEAT.reunion, at('chick')],
  [BEAT.reunion, LENGTH + 1, at('chick', (t) => ({ nod: -0.35 + 0.12 * Math.sin(t * 2.2), tuck: 0.2 }))],
]);
const FATHER_GAZE = gaze([
  [47.6, 49.6, at('mother')], [49.6, 55.4, at('mother', (t) => ({ nod: 0.25 * Math.sin(t * 3 + 1) }))], [55.4, 56.6, at('mother', { nod: -0.2 })],
  [64, 66, look(NESTLING, { nod: -0.3 })], [66, 78, asleep], [82.5, 84.6, at('chick', { nod: -0.3 })], [87.75, 90.5, at('chick', (t) => ({ nod: -0.45 + 0.15 * Math.sin(t * 8) }))],
  [99, 108.5, (t, b) => ({ look: head(t < 102.6 ? b.mother : b.chick) })], [112.5, 121, look(STAR)], [121, 123, look(ABOVE)], [128, 134, (t, b) => ({ look: b.fireball })],
  [137.6, 143, look(BEYOND)], [143, 155.4, (t) => ({ look: fireAt(t) })], [155.4, 157, (t) => ({ look: onTree(SEAT, t) })], [157, 162, at('chick')],
  [162, 165, look(NEST_AT.add(new Vector3(0, 1, 0)))], [165, 166.5, at('chick', { nod: -0.3 })], [166.5, 172.8, asleep], [172.8, 174.5, sweeping(1)],
  [174.5, BEAT.call, at('chick', { nod: -0.4 })], [BEAT.call, 181.8, look(MOUTH)], [181.8, 184.3, look(MOUTH, { nod: -0.3 })], [184.3, 186.8, look(GRIP)],
  [186.8, LENGTH + 1, at('mother', { nod: -0.3, tuck: 0.3 })],
]);
const CHICK_GAZE = gaze([
  [82.6, 86, at('mother', { nod: 0.3 })], [86, 87.75, at('mother')], [87.75, 90.5, at('father', { nod: 0.5 })], [90.5, 105.4, at('mother')],
  [106.3, 107.3, look(NEST_AT.add(new Vector3(0, -1, 0)), { nod: -0.6 })], [107.3, 109, at('mother', { nod: 0.2 })], [114, 118.5, look(STAR)], [121, 123, look(ABOVE)],
  [128, 134, (t, b) => ({ look: b.fireball })], [134, 140, at('mother', { nod: 0.3 })], [143, 154.8, (t, b) => ({ look: t % 2.6 < 1.3 ? fireAt(t) : head(b.mother) })],
  [154.8, 155.6, at('mother')], [155.6, 157, (t) => ({ look: onTree(SEAT, t) })], [157.6, 163.5, look(NEST_AT.add(new Vector3(0, 1, 0)))], [163.5, 165, at('father')],
  [165, 166.5, look(NEST_AT, { nod: -0.5 })], [166.5, 172.8, asleep], [172.8, 174, at('father', { nod: -0.3 })], [174, BEAT.call, sweeping(0)],
  [BEAT.call, 182.5, look(MOUTH)], [182.5, CLIMBS, at('mother', { nod: 0.2 })],
  [CLIMBS, LENGTH + 1, at('mother', (t) => ({ nod: 0.25 + 0.1 * Math.sin(t * 3), tuck: 0.25 }))],
]);

export function createFamily(scene, toon) {
  // The nest tree: a big blossom tree, with the nest on its crown.
  const tree = KINDS.blossom.map(([name, data, color]) => {
    const mesh = createMesh(`Nest ${name}`, data, scene);
    mesh.material = toon.plain(`Nest ${name}`, color);
    return { mesh, buffer: setMatrices(mesh, 1), color: Color3.FromHexString(color) };
  });
  const CHARRED = Color3.FromHexString('#3a2e2c');
  const nest = createMesh('Nest', cone(8, 0.17, 0, 0.25, 0.11), scene);
  nest.material = toon.plain('Nest', '#7a5235');
  const nestBuffer = setMatrices(nest, 1);
  // What the blast leaves of the tree: a charred stump.
  const stump = createMesh('Nest Stump', cone(5, 0.075, 0, 0.05, 0.16), scene);
  stump.material = toon.plain('Nest Stump', '#3a2e2c');
  place(setMatrices(stump, 1), 0, BASE, new Vector3(1, 1, 1).scale(NEST.size), 0);
  stump.isVisible = false;
  // The sea cave: a hump of dark rock on the shore, its mouth dark at the waterline, open to the sea; it is there from
  // when the lava cools.
  const cave = [['Sea Cave', blob(0.5, [0, 0, 0]), '#4f4659', new Vector3(2.2, 1.8, 3.6), -0.75, -0.1, 0], ['Sea Cave Mouth', blob(0.3, [0, 0, 0]), '#100c16', new Vector3(0.9, 2.0, 3.2), 0.05, 0.1, 0],
    ['Sea Cave Shelf', blob(0.5, [0, 0, 0]), '#5d5566', new Vector3(1.5, 0.36, 1.7), 0.35, 0.0, 1.25]]
    .map(([name, data, color, size, out, y, along]) => {
      const mesh = createMesh(name, data, scene);
      mesh.material = toon.plain(name, color);
      return { mesh, buffer: setMatrices(mesh, 1), size, at: sea(SEA_CAVE.angle, SEA_CAVE.r + out, y).add(ALONG.scale(along)) };
    });
  const caveTurn = Quaternion.RotationAxis(Vector3.Up(), headingOf(TO_SEA_CAVE));
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
      : p === 'flutter' ? wings * (0.45 + 0.5 * wingBeat(time * 30)) : climb > -0.25 ? 0.75 * wingBeat(time * 15 + phase) + 0.12 : 0.2 + 0.03 * Math.sin(time * 3);
    // Still, a bird breathes and its head never quite settles.
    const breath = along ? Vector3.Zero() : new Vector3(0, 0.004 * Math.sin(time * 3 + phase), 0), idle = p === 'sit' ? 0.06 * Math.sin(time * 0.8 + phase) * Math.sin(time * 1.9 + 2 * phase) : 0;
    kit.pose(i, point.add(breath), size, facing, { bank: along ? 0.25 * Math.sin(time * 0.7 + phase) : 0, pitch: tumble || (along ? -climb * 0.5 : -0.3 * gust(time)), wings: beat, ...eyes, nod: (eyes.nod ?? 0) + idle });
  };
  const sparks = createParticles(scene, toon, { name: 'Last Sparks', color: '#000000', glow: glowOf(2.8, 1.6, 0.4), seed: 61, start: BEAT.gone, end: BEAT.gone + 0.12, rate: 500, life: [0.8, 2],
    origin: () => onTree(SEAT, BEAT.gone), velocity: (r) => direction(r, 0.3).scale(1.5 + 2.5 * r(3)), gravity: 0.6, drag: 1.2, turbulence: 0.3, size: pop(0.06) });
  const fire = createTreeFire(scene, toon, [{ at: BASE, size: NEST.size }], { height: 0.4, from: () => BEAT.climax - 0.6, length: 4.2, size: 0.75 });
  const shells = createPuffs(scene, toon, 'Egg Shell', '#f7f0e3', 6, (day, time) => Array.from({ length: 6 }, (_, k) => {
    const u = time - BEAT.hatch, a = k * 1.05;
    return [SEAT.add(new Vector3(Math.cos(a) * 0.25 * u, 0.25 * u - 1.2 * u * u, Math.sin(a) * 0.25 * u)), u > 0 && u < 0.45 ? 0.025 : 0];
  }));

  return together(fire, sparks, shells, (day, time) => {
    // The tree, swaying and shaking; after the blast the charred wreck, its crown burnt back, and the stump.
    const shaking = tremor(time), lean = 0.025 * Math.sin(time * 2) + 0.1 * shaking * Math.sin(time * 29), blasted = time > BEAT.blast;
    const wreck = wreckAt(time), turn = blasted ? wreck.turn : Quaternion.RotationAxis(new Vector3(0.6, 0, 0.8), lean);
    tree.forEach(({ buffer, mesh, color }, k) => {
      const burnt = k === 1 && blasted ? 0.75 : 1;
      place(buffer, 0, wreck.base, new Vector3(1, 1, 1).scale(Math.max(1e-4, NEST.size * grow((day - 6.4) / 1.4) * burnt)), turn);
      mesh.material.setColor3('color', blasted ? Color3.Lerp(color, CHARRED, 0.7) : color);
      mesh.thinInstanceBufferUpdated('matrix');
    });
    stump.isVisible = blasted;
    const cooled = Math.max(1e-4, smoothstep(2.6, 3.2, day));
    for (const { mesh, buffer, size, at } of cave) {
      place(buffer, 0, at, size.scale(cooled), caveTurn);
      mesh.thinInstanceBufferUpdated('matrix');
    }
    // The nest and the egg, carried off with the tree.
    const built = smoothstep(BEAT.nest, BEAT.nest + 6, time), nestAt = onTree(NEST_AT, time);
    place(nestBuffer, 0, nestAt, new Vector3(1, 1, 1).scale(Math.max(1e-4, built)), turn);
    nest.thinInstanceBufferUpdated('matrix');
    const laid = smoothstep(BEAT.egg, BEAT.egg + 0.3, time) * (time < BEAT.hatch ? 1 : 0), wobble = time > BEAT.hatch - 2 ? 0.25 * Math.sin(time * 25) : 0;
    place(eggBuffer, 0, NESTLING.add(new Vector3(0, -0.06, 0)), new Vector3(1, 1, 1).scale(Math.max(1e-4, laid)), Quaternion.RotationAxis(Vector3.Right(), wobble));
    egg.thinInstanceBufferUpdated('matrix');

    // The family: where each is, then how each holds itself and looks. The mother rides the blasted tree into its smoke
    // and is not seen again until they find her in the cave.
    const mother = motherAt(time), father = fatherAt(time), young = chickAt(time), birds = { mother, father, chick: young, fireball: fireballAt(time) };
    const shown = smoothstep(35.5, 36.5, time) * (time < BEAT.gone || time > BEAT.cave ? 1 : 0);
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
