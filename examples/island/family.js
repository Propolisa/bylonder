// The family: a seabird finds the young island and settles on a big blossom tree, her mate follows, they build a nest,
// an egg is laid and hatches, and the parents fish for their chick. When the meteor's fire reaches the tree, the
// mother pushes the chick, who has not yet flown, off the branch; it falls, then flies. She is still on the nest when
// the tree falls. The father and the chick come home when the island has healed, to the sapling growing where the
// tree stood.
import { createMesh } from '@workbench/sdk';
import { KINDS, cone, blob, grow, createTreeFire } from './forest.js';
import { createBirdKit, headingOf } from './life.js';
import { createParticles, together, pop, glowOf, direction } from './particles.js';
import { setMatrices, place, createPuffs } from './sky.js';
import { heightAt } from './island.js';
import { BEAT, NEST, OMEN, smoothstep, lerp, tremor } from './story.js';

const { Vector3, Quaternion, Color3 } = BABYLON;

// Places: the tree's foot, the nest on its crown, the seat on the nest and perches either side; out to sea.
const BASE = new Vector3(NEST.x, NEST.ground, NEST.z), NEST_AT = BASE.add(new Vector3(0, 0.99 * NEST.size - 0.02, 0)), SEAT = NEST_AT.add(new Vector3(0, 0.14, 0));
const OUT = NEST.angle, around = (a, d, dy = 0) => NEST_AT.add(new Vector3(Math.cos(a) * d, dy, Math.sin(a) * d));
// Perches on the nest's rim.
const PERCH_A = around(OUT + 2.2, 0.22, 0.14), PERCH_B = around(OUT - 1.1, 0.22, 0.14);
const sea = (a, d, y) => new Vector3(Math.cos(a) * d, y, Math.sin(a) * d);
const SAPLING = 0.85, SAPLING_TOP = BASE.add(new Vector3(0, 0.95 * SAPLING, 0));
const HOME_B = SAPLING_TOP.add(new Vector3(Math.cos(OUT + 1.6) * 0.13, 0.08, Math.sin(OUT + 1.6) * 0.13));
const HOME_C = SAPLING_TOP.add(new Vector3(Math.cos(OUT - 1.6) * 0.13, 0.08, Math.sin(OUT - 1.6) * 0.13));
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

// Fishing: off the perch, out over the sea, a touch at the water, and back.
const fishing = (start, a, back) => [[start, back, 'sit'], [start + 0.6, back.add(new Vector3(0.4, 0.6, 0.3))], [start + 2.4, sea(a, 9, 1.3)],
  [start + 3.3, sea(a + 0.05, 10.5, 0.12)], [start + 4.8, sea(a - 0.2, 7.5, 2.6)], [start + 6.3, back.add(new Vector3(-0.5, 0.7, 0.4))], [start + 7, back, 'sit']];

const MOTHER = flight([
  [0, sea(OUT + 0.4, 70, 9)], [33, sea(OUT + 0.38, 30, 8)], [36, sea(OUT + 0.1, 15, 6)], [38.5, sea(OUT - 0.5, 7, 4.8)],
  [40.4, PERCH_A.add(new Vector3(0.9, 0.7, -0.6))], [41.5, PERCH_A, 'sit'], [45, PERCH_A, 'spread'], [46.5, PERCH_A, 'sit'], [50.2, PERCH_A, 'sit'],
  [50.9, SEAT, 'sit'], [64, SEAT, 'sit'], ...fishing(64, OUT + 0.6, PERCH_A).slice(1), [72.4, PERCH_A, 'sit'], [73.1, SEAT, 'sit'],
  // A flying lesson: a loop round the tree, then a branch to watch the chick try from.
  [75.6, SEAT, 'sit'], [76.2, around(OUT + 1.2, 1.2, 0.6)], [76.9, around(OUT - 0.2, 1.1, 0.85)], [77.6, around(OUT - 1.4, 0.9, 0.5)],
  [78.2, PERCH_A, 'sit'], [79.6, PERCH_A, 'sit'], [80.3, SEAT, 'sit'],
  // The push: she rises over the chick, watches it fall and catch the air, and only then opens her wings.
  [104.8, SEAT, 'sit'], [104.95, SEAT.add(new Vector3(0, 0.06, 0)), 'sit'], [105.62, SEAT.add(new Vector3(0, 0.08, 0)), 'sit'],
  [105.7, SEAT.add(new Vector3(0, 0.1, 0)), 'spread'], [107, SEAT.add(new Vector3(0, 0.1, 0)), 'spread'],
]);
// The father circles the tree, ever wider and faster, from the night the star grew bright until the fire comes.
const circling = (time) => {
  const t = time - BEAT.leave, wild = smoothstep(BEAT.impact - 0.5, BEAT.impact + 1, time), r = 1.4 + 0.5 * wild, a = t * (1.6 + 1.6 * wild);
  return NEST_AT.add(new Vector3(Math.cos(a) * r, 1.1 + 0.35 * Math.sin(t * 2.3) - 0.4 * wild * Math.abs(Math.sin(t * 1.7)), Math.sin(a) * r));
};
const FATHER = flight([
  [0, sea(OUT - 0.8, 70, 9)], [38, sea(OUT - 0.8, 40, 9)], [41, sea(OUT - 0.9, 14, 6)], [42.6, sea(OUT - 0.3, 6, 4.4)], [43.6, PERCH_B.add(new Vector3(-0.8, 0.8, 0.5))],
  [44.2, PERCH_B, 'sit'], [45, PERCH_B, 'spread'], [46.5, PERCH_B, 'sit'], [47, PERCH_B, 'sit'],
  // Twigs for the nest from under the trees.
  [47.5, PERCH_B.add(new Vector3(0.3, 0.5, 0.2))], [48.5, around(OUT + 0.4, 1.6, -1.5)], [49.5, PERCH_B.add(new Vector3(-0.3, 0.5, 0.3))], [50.2, PERCH_B, 'sit'],
  ...fishing(54, OUT - 0.5, PERCH_B), [BEAT.leave, PERCH_B, 'sit'],
  [BEAT.leave + 0.6, circling(BEAT.leave + 0.6)],
]);
// After the fall: the father and the chick out over the sea in the dark, then home.
const ESCAPE = flight([
  [105.4, circling(105.4)], [106.2, NEST_AT.add(new Vector3(Math.cos(OUT) * 1.4, -0.9, Math.sin(OUT) * 1.4))], [107.2, sea(OUT + 0.05, 6.5, 2.2)],
  [109, sea(OUT + 0.2, 11, 3)], [111, sea(OUT + 0.5, 15, 3.6)], [113, sea(OUT + 0.85, 16, 4)], [115, sea(OUT + 0.6, 11, 3.6)],
  [116.6, SAPLING_TOP.add(new Vector3(1.6, 1.0, -0.8))], [117.6, HOME_B, 'sit'], [121, HOME_B, 'sit'],
]);
const fatherAt = (time) => {
  // The night before the flock leaves, he turns on his branch to face the star.
  if (time > BEAT.omen + 3 && time < BEAT.leave) return { point: PERCH_B, pose: 'sit', heading: headingOf(new Vector3(OMEN.x, 0, OMEN.z)) };
  if (time < BEAT.leave + 0.6) return { point: FATHER.pointAt(time), pose: FATHER.poseAt(time), velocity: FATHER.velocityAt(time) };
  if (time < 105.4) return { point: circling(time), pose: 'fly', velocity: circling(time + 0.05).subtract(circling(time - 0.05)).scale(10) };
  return { point: ESCAPE.pointAt(time), pose: ESCAPE.poseAt(time), velocity: ESCAPE.velocityAt(time) };
};
// The chick: in the nest beside its mother, peeping when food comes, flapping to practise; two failed tries as the
// fire comes; pushed, it falls, then flies at the father's side. It is grown by the time they come home.
const NESTLING = SEAT.add(new Vector3(Math.cos(OUT) * 0.11, -0.02, Math.sin(OUT) * 0.11));
const chickAt = (time) => {
  const hop = (t0, h, drift = 0) => { const u = (time - t0) / 0.8; return u > 0 && u < 1 ? new Vector3(Math.cos(OUT) * drift * u, h * Math.sin(Math.PI * u), Math.sin(OUT) * drift * u) : null; };
  if (time < BEAT.climax) {
    // It tries after the lesson and fails; tries again as the fire comes, and fails.
    const tries = hop(78.4, 0.16, 0.06) ?? hop(101, 0.32, 0.12), peep = hop(71, 0.04);
    const flutter = (a, b) => smoothstep(a, a + 0.2, time) * (1 - smoothstep(b - 0.2, b, time));
    const wings = tries ? 1 : Math.max(flutter(74, 75.2), peep ? 0.5 : 0);
    return { point: NESTLING.add(tries ?? peep ?? Vector3.Zero()), pose: wings ? 'flutter' : 'sit', wings, heading: headingOf(new Vector3(Math.cos(OUT + 0.8), 0, Math.sin(OUT + 0.8))) };
  }
  // Pushed off the nest's edge: it tumbles and falls, then its wings catch and it rises to the father.
  const u = time - BEAT.climax, edge = NESTLING.add(new Vector3(Math.cos(OUT) * 0.35, 0.05, Math.sin(OUT) * 0.35));
  const fall = edge.add(new Vector3(Math.cos(OUT) * 0.5 * u, -4.2 * u * u, Math.sin(OUT) * 0.5 * u));
  const caught = smoothstep(0.55, 1.3, u), father = fatherAt(time);
  const beside = father.point.add(new Vector3(-Math.sin(OUT) * 0.45, -0.12, Math.cos(OUT) * 0.45));
  const flying = u < 0.55 ? fall : Vector3.Lerp(edge.add(new Vector3(Math.cos(OUT) * 0.27, -1.27, Math.sin(OUT) * 0.27)), beside, caught);
  const point = Vector3.Lerp(flying, HOME_C, smoothstep(BEAT.home - 1, BEAT.home + 0.3, time));
  return { point, pose: ESCAPE.poseAt(time) === 'sit' && time > 117 ? 'sit' : 'fly', tumble: u < 0.6 ? u * 9 : 0, wings: 1, velocity: father.velocity };
};

export function createFamily(scene, toon) {
  // The nest tree: a big blossom tree, with the nest on its crown.
  const tree = KINDS.blossom.map(([name, data, color]) => {
    const mesh = createMesh(`Nest ${name}`, data, scene);
    mesh.material = toon.plain(`Nest ${name}`, color);
    return { mesh, buffer: setMatrices(mesh, 2) };
  });
  const nest = createMesh('Nest', cone(8, 0.17, 0, 0.25, 0.11), scene);
  nest.material = toon.plain('Nest', '#7a5235');
  const nestBuffer = setMatrices(nest, 1);
  const egg = createMesh('Egg', blob(0.055, [0, 0, 0.055]), scene);
  egg.material = toon.plain('Egg', '#f7f0e3');
  const eggBuffer = setMatrices(egg, 1);
  const parents = createBirdKit(scene, toon, 'Parent', '#fdf9f2', 2), chick = createBirdKit(scene, toon, 'Chick', '#b9b3c6', 1);
  const grey = Color3.FromHexString('#b9b3c6'), white = Color3.FromHexString('#fdf9f2');

  const pose = (kit, i, { point, pose: p, velocity, heading, wings = 1, tumble = 0 }, size, time, phase = 0) => {
    const along = velocity && velocity.length() > 0.05 ? velocity : null;
    const facing = heading ?? (along ? headingOf(along) : headingOf(new Vector3(Math.cos(OUT), 0, Math.sin(OUT))));
    const climb = along ? along.y / Math.max(0.2, along.length()) : 0;
    const beat = p === 'sit' ? null : p === 'spread' ? 0.85 + 0.1 * Math.sin(time * 9) : p === 'flutter' ? wings * (0.5 + 0.5 * Math.sin(time * 30)) * 0.9
      : (climb > -0.25 ? 0.75 : 0.18) * Math.sin(time * 15 + phase) + 0.1;
    kit.pose(i, point, size, facing, { bank: along ? 0.25 * Math.sin(time * 0.7 + phase) : 0, pitch: tumble || (along ? -climb * 0.5 : 0), wings: beat });
  };
  const sparks = createParticles(scene, toon, { name: 'Last Sparks', color: '#000000', glow: glowOf(2.8, 1.6, 0.4), seed: 61, start: BEAT.gone, end: BEAT.gone + 0.12, rate: 500, life: [0.8, 2],
    origin: () => onTree(SEAT, BEAT.gone), velocity: (r) => direction(r, 0.3).scale(1.5 + 2.5 * r(3)), gravity: 0.6, drag: 1.2, turbulence: 0.3, size: pop(0.06) });
  const fire = createTreeFire(scene, toon, [{ at: BASE, size: NEST.size }], { height: 0.4, from: () => BEAT.climax - 0.6, length: 4.2, size: 0.75 });
  const shells = createPuffs(scene, toon, 'Egg Shell', '#f7f0e3', 6, (day, time) => Array.from({ length: 6 }, (_, k) => {
    const u = time - BEAT.hatch, a = k * 1.05;
    return [SEAT.add(new Vector3(Math.cos(a) * 0.25 * u, 0.25 * u - 1.2 * u * u, Math.sin(a) * 0.25 * u)), u > 0 && u < 0.45 ? 0.025 : 0];
  }));

  // When they come home, petals drift from the sapling's first blossom.
  const petals = createParticles(scene, toon, { name: 'Petals', color: '#ffb6d3', seed: 62, start: BEAT.home - 0.4, end: 121, rate: 10, life: [2.5, 4],
    origin: (r) => SAPLING_TOP.add(new Vector3((2 * r(30) - 1) * 0.3, -0.1, (2 * r(31) - 1) * 0.3)), velocity: (r) => direction(r, 0.2).scale(0.3),
    gravity: -0.22, drag: 1.2, wind: new Vector3(0.25, 0, 0.1), turbulence: 0.3, size: pop(0.035, 0.1) });
  return together(fire, sparks, shells, petals, (day, time) => {
    // The tree, swaying and shaking, falling and burning away; the sapling.
    const shaking = tremor(time), lean = 0.025 * Math.sin(time * 2) + 0.1 * shaking * Math.sin(time * 29);
    const fallen = treeFall(time), ash = 1 - smoothstep(BEAT.fall + 1.6, BEAT.sea, time);
    const turn = Quaternion.RotationAxis(FALL_AXIS, -fallen).multiply(Quaternion.RotationAxis(new Vector3(0.6, 0, 0.8), lean));
    const sapling = SAPLING * grow((time - BEAT.sapling) / 2.6);
    for (const { buffer } of tree) {
      place(buffer, 0, BASE, new Vector3(1, 1, 1).scale(Math.max(1e-4, NEST.size * grow((day - 6.4) / 1.4) * ash)), turn);
      place(buffer, 1, BASE, new Vector3(1, 1, 1).scale(Math.max(1e-4, sapling)), 0.6 + 0.03 * Math.sin(time * 2.4));
    }
    for (const { mesh } of tree) mesh.thinInstanceBufferUpdated('matrix');
    // The nest and the egg, carried down with the tree.
    const built = smoothstep(BEAT.nest, BEAT.nest + 3, time) * ash, nestAt = onTree(NEST_AT, time);
    place(nestBuffer, 0, nestAt, new Vector3(1, 1, 1).scale(Math.max(1e-4, built)), Quaternion.RotationAxis(FALL_AXIS, -fallen));
    nest.thinInstanceBufferUpdated('matrix');
    const laid = smoothstep(BEAT.egg, BEAT.egg + 0.3, time) * (time < BEAT.hatch ? 1 : 0), wobble = time > BEAT.hatch - 2 ? 0.25 * Math.sin(time * 25) : 0;
    place(eggBuffer, 0, NESTLING.add(new Vector3(0, -0.06, 0)), new Vector3(1, 1, 1).scale(Math.max(1e-4, laid)), Quaternion.RotationAxis(Vector3.Right(), wobble));
    egg.thinInstanceBufferUpdated('matrix');

    // The parents. The mother rides the falling tree on her nest until it is gone.
    const mother = { point: MOTHER.pointAt(time), pose: MOTHER.poseAt(time), velocity: MOTHER.velocityAt(time) };
    if (time > BEAT.fall) mother.point = onTree(mother.point, time);
    const shown = smoothstep(32.5, 33.5, time) * (time < BEAT.gone ? 1 : 0);
    pose(parents, 0, mother, 1.6 * shown, time, 0);
    pose(parents, 1, fatherAt(time), 1.6 * smoothstep(37.5, 38.5, time), time, 1.7);
    parents.update();
    // The chick: grey and small, white and grown when they come home.
    const hatched = smoothstep(BEAT.hatch, BEAT.hatch + 0.4, time), grown = smoothstep(BEAT.heal, BEAT.home - 0.6, time);
    pose(chick, 0, chickAt(time), hatched * lerp(0.65 + 0.4 * smoothstep(BEAT.hatch, 80, time), 1.55, grown), time, 3.1);
    chick.update();
    for (const material of chick.materials) material.setColor3('color', Color3.Lerp(grey, white, grown));
  });
}
