import { createMesh } from '@workbench/sdk';
import { random } from './random.js';
import { shore } from './island.js';
import { smoothstep, eruption, BEAT, shotAngle, frameAt, days } from './story.js';
import { createParticles, together, pop, swell, glowOf, direction } from './particles.js';
import { setMatrices, place, createPuffs } from './sky.js';

const { Vector3, Quaternion, Color3 } = BABYLON;
const hidden = [Vector3.Zero(), 0];

// Lava bombs: glowing rocks thrown from the crater in arcs while it erupts.
export function createBombs(scene, toon) {
  const COUNT = 10, rand = random(5), throws = Array.from({ length: COUNT }, () => ({ angle: rand() * Math.PI * 2, reach: 1.2 + rand(), rate: 0.4 + rand() * 0.3, phase: rand() }));
  const bombs = createPuffs(scene, toon, 'Lava Bomb', '#000000', COUNT, (day, time) => throws.map(({ angle, reach, rate, phase }) => {
    const p = (time * rate + phase) % 1, strength = eruption(day) * smoothstep(0.15, 0.4, day);
    if (strength <= 0) return hidden;
    return [new Vector3(Math.cos(angle) * reach * p, 3.3 + 3.6 * p - 3.4 * p * p, Math.sin(angle) * reach * p), 0.16 * strength * Math.sin(Math.PI * p) ** 0.3];
  }));
  bombs.material.setColor3('glow', new Color3(2.6, 0.9, 0.15));
  return bombs;
}

// Steam where the lava meets the sea, while it is hot there: billows rolling up and leaning in the wind, a wider mist
// above them, spray thrown from the hiss, and the glow of the lava under it all.
export function createSteam(scene, toon) {
  const mouths = Array.from({ length: 5 }, (_, i) => {
    let angle = i * 1.2566 + 0.3, r = 6;
    for (let k = 0; k < 3; k++) { r = 0.93 * shore(angle); angle = i * 1.2566 + 0.3 + 0.25 * Math.sin(r * 1.7 + i); }
    return new Vector3(Math.cos(angle) * r, 0.1, Math.sin(angle) * r);
  });
  const hot = (birth) => { const day = days(frameAt(birth)); return smoothstep(1.45, 1.65, day) * (1 - smoothstep(2.4, 2.9, day)); };
  const mouth = (r) => mouths[Math.floor(r(40) * mouths.length)].add(new Vector3((2 * r(41) - 1) * 0.3, 0, (2 * r(42) - 1) * 0.3));
  const END = 45, wind = new Vector3(0.35, 0, 0.12);
  return together(
    createParticles(scene, toon, { name: 'Steam Billow', color: '#f4f7ff', seed: 51, start: 0, end: END, rate: 34, life: [1.8, 3], origin: mouth,
      velocity: (r) => new Vector3(0, 0.8 + 0.6 * r(3), 0), drag: 0.6, gravity: 0.5, wind, turbulence: 0.2, size: swell(0.06, 0.35), strength: hot }),
    createParticles(scene, toon, { name: 'Steam Mist', color: '#dde5f1', seed: 52, start: 0, end: END, rate: 16, life: [3, 5], origin: (r) => mouth(r).add(new Vector3(0, 0.6, 0)),
      velocity: (r) => new Vector3(0, 1 + 0.5 * r(3), 0), drag: 0.4, gravity: 0.4, wind: wind.scale(1.6), turbulence: 0.3, size: swell(0.2, 0.7), strength: hot }),
    createParticles(scene, toon, { name: 'Steam Spray', color: '#ffffff', seed: 53, start: 0, end: END, rate: 40, life: [0.4, 0.9], origin: mouth,
      velocity: (r) => direction(r, 0.5).scale(1.5 + 1.5 * r(3)), gravity: -6, size: pop(0.05), strength: hot }),
    createParticles(scene, toon, { name: 'Steam Glow', color: '#000000', glow: glowOf(2.2, 0.6, 0.06), seed: 54, start: 0, end: END, rate: 24, life: [0.3, 0.6], origin: mouth,
      velocity: () => new Vector3(0, 0.3, 0), size: pop(0.11), strength: hot }));
}

// A whale, low poly in Blender's axes (X forward, Z up): a body lathed from rings, flippers, a dorsal fin and flukes.
function whaleMesh() {
  const RINGS = [[-1.75, 0.07], [-1.3, 0.16], [-0.7, 0.32], [-0.1, 0.42], [0.55, 0.42], [1.05, 0.33], [1.4, 0.18], [1.55, 0]], SIDES = 8;
  const vertices = [], faces = [];
  RINGS.forEach(([x, r]) => {
    if (r === 0) vertices.push([x, 0, -0.02]);
    else for (let i = 0; i < SIDES; i++) { const a = (i / SIDES) * 2 * Math.PI; vertices.push([x, r * Math.cos(a), r * Math.sin(a) * 0.82]); }
  });
  for (let k = 0; k < RINGS.length - 2; k++) for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES, a = k * SIDES;
    faces.push([a + i, a + j, a + SIDES + j, a + SIDES + i]);
  }
  const tip = vertices.length - 1, last = (RINGS.length - 2) * SIDES;
  for (let i = 0; i < SIDES; i++) faces.push([last + i, last + ((i + 1) % SIDES), tip]);
  faces.push(Array.from({ length: SIDES }, (_, i) => SIDES - 1 - i));
  const add = (points, ...polygons) => { const base = vertices.push(...points) - points.length; faces.push(...polygons.map((f) => f.map((i) => base + i))); };
  // Flukes, spread flat behind the tail stock; a small dorsal fin; long flippers.
  add([[-1.7, 0, 0], [-2.25, 0.62, 0.06], [-2.05, 0.08, 0], [-2.05, -0.08, 0], [-2.25, -0.62, 0.06]], [0, 1, 2], [0, 2, 1], [0, 3, 4], [0, 4, 3]);
  add([[-0.55, 0, 0.26], [-0.95, 0, 0.42], [-1.05, 0, 0.18]], [0, 1, 2], [0, 2, 1]);
  add([[0.6, 0.36, -0.12], [0.1, 1.0, -0.38], [0.3, 0.38, -0.2], [0.6, -0.36, -0.12], [0.1, -1.0, -0.38], [0.3, -0.38, -0.2]], [0, 1, 2], [0, 2, 1], [3, 4, 5], [3, 5, 4]);
  return { vertices, faces };
}

// Whales surfacing: each rises on an arc, its back breaking the water, blows a spout, and dives, the flukes lifting
// last. One early, while the island is young; at the end a mother with her calf beside her.
export function createWhales(scene, toon) {
  const mesh = createMesh('Whale', whaleMesh(), scene);
  mesh.material = toon.plain('Whale', '#34507e');
  const SWIMS = [
    { start: 7.5, angle: 0.35, distance: 10, size: 0.85 },
    { start: 117.4, angle: 0.45, distance: 11, size: 1.0 }, { start: 117.7, angle: 0.49, distance: 12, size: 0.45 },
  ].map((swim) => ({ ...swim, angle: shotAngle(frameAt(Math.min(119.5, swim.start + 1.3))) + swim.angle }));
  const buffer = setMatrices(mesh, SWIMS.length), LENGTH = 3.2, R = 3.2;
  // Where a swim is at time t: on a circle of radius R below the sea, travelling along the shore.
  const pose = ({ start, angle, distance, size }, time) => {
    const p = (time - start) / LENGTH;
    if (p <= 0 || p >= 1) return null;
    const phi = -0.75 + 1.5 * p, along = new Vector3(-Math.sin(angle), 0, Math.cos(angle)), center = new Vector3(Math.cos(angle) * distance, -R * size + 0.28 * size, Math.sin(angle) * distance);
    const position = center.add(along.scale(Math.sin(phi) * R * size)).add(new Vector3(0, Math.cos(phi) * R * size, 0));
    const heading = Math.atan2(-along.z, along.x), pitch = -phi;
    return { position, size, rotation: Quaternion.RotationAxis(Vector3.Up(), heading).multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), pitch)), p, along };
  };
  const spouts = createPuffs(scene, toon, 'Spout', '#f2f8ff', SWIMS.length * 6, (day, time) => SWIMS.flatMap((swim) => {
    const at = pose(swim, time);
    return Array.from({ length: 6 }, (_, k) => {
      if (!at) return hidden;
      const blow = smoothstep(0.25, 0.32, at.p) * (1 - smoothstep(0.4, 0.55, at.p)), rise = (at.p - 0.25) * 6 + k * 0.12;
      return [at.position.add(at.along.scale(0.6 * at.size)).add(new Vector3(0.1 * Math.sin(k * 2.1), 0.2 + rise * 0.9 * at.size, 0.1 * Math.cos(k * 1.3))), 0.13 * blow * at.size * (1 + k * 0.25)];
    });
  }));
  return (day, time) => {
    SWIMS.forEach((swim, i) => {
      const at = pose(swim, time);
      place(buffer, i, at ? at.position : new Vector3(0, -50, 0), new Vector3(1, 1, 1).scale(at ? at.size : 1e-4), at ? at.rotation : 0);
    });
    mesh.thinInstanceBufferUpdated('matrix');
    spouts(day, time);
  };
}

// Birds of one color, any number: a body and two wings, posed each frame as flying (flapping or gliding) or perched
// with their wings folded.
export function createBirdKit(scene, toon, name, color, count) {
  const part = (suffix, vertices, faces) => {
    const mesh = createMesh(`${name} ${suffix}`, { vertices, faces }, scene);
    mesh.material = toon.plain(`${name} ${suffix}`, color);
    return { mesh, buffer: setMatrices(mesh, count) };
  };
  const body = part('Body', [[0.14, 0, 0], [-0.12, 0, 0.02], [0, 0.03, 0.03], [0, -0.03, 0.03], [0, 0, -0.03], [0.17, 0, 0.012]], [[0, 2, 1], [0, 1, 3], [0, 3, 4], [0, 4, 2], [1, 2, 4], [1, 4, 3], [0, 5, 2], [0, 3, 5]]);
  const left = part('Wing L', [[0.05, 0, 0], [-0.05, 0, 0], [-0.02, 0.28, 0.02]], [[0, 1, 2], [0, 2, 1]]);
  const right = part('Wing R', [[0.05, 0, 0], [-0.05, 0, 0], [-0.02, -0.28, 0.02]], [[0, 2, 1], [0, 1, 2]]);
  const materials = [body, left, right].map(({ mesh }) => mesh.material);
  return {
    materials,
    // wings: an angle up from level (each beat), or `null` for folded.
    pose(i, position, size, heading, { bank = 0, pitch = 0, wings = 0 } = {}) {
      const turn = Quaternion.RotationAxis(Vector3.Up(), heading).multiply(Quaternion.RotationAxis(Vector3.Right(), bank)).multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), pitch));
      const scale = new Vector3(1, 1, 1).scale(Math.max(1e-4, size)), folded = wings === null;
      place(body.buffer, i, position, scale, turn);
      const wing = (side) => turn.multiply(Quaternion.RotationAxis(Vector3.Right(), folded ? side * 1.35 : -side * wings)).multiply(Quaternion.RotationAxis(Vector3.Up(), folded ? 0.5 : 0));
      place(left.buffer, i, position, folded ? scale.scale(0.7) : scale, wing(1));
      place(right.buffer, i, position, folded ? scale.scale(0.7) : scale, wing(-1));
    },
    update() { for (const { mesh } of [body, left, right]) mesh.thinInstanceBufferUpdated('matrix'); },
  };
}
// The heading that points a bird along a direction.
export const headingOf = (along) => Math.atan2(-along.z, along.x);

// The flock: arrives once the forest has grown and circles the volcano, gliding and flapping in bursts. It leaves out
// to sea as the new star grows, and comes home at the end.
export function createBirds(scene, toon) {
  const COUNT = 7, rand = random(21), flock = Array.from({ length: COUNT }, () => ({ radius: 3.5 + rand() * 2.5, height: 4.3 + rand() * 1.2, speed: 0.45 + rand() * 0.2, phase: rand() * Math.PI * 2 }));
  const kit = createBirdKit(scene, toon, 'Bird', '#fdf8f0', COUNT);
  return (day, time) => {
    const here = smoothstep(4.6, 5.3, day), away = smoothstep(BEAT.leave - 1, BEAT.leave + 4, time) * (1 - smoothstep(BEAT.home - 3, BEAT.home + 1, time));
    flock.forEach(({ radius, height, speed, phase }, i) => {
      const a = phase + time * speed, out = radius + 40 * away ** 1.5;
      const position = new Vector3(Math.cos(a) * out, height + 0.3 * Math.sin(time * 1.3 + phase) + 3 * away, Math.sin(a) * out);
      const flapping = Math.max(away, smoothstep(0.2, 0.5, Math.sin(time * 0.9 + phase * 3)));
      kit.pose(i, position, here * 2.4 * (1 - smoothstep(0.85, 1, away)), headingOf(new Vector3(-Math.sin(a), 0, Math.cos(a))), { bank: 0.35, wings: flapping * 0.7 * Math.sin(time * 14 + phase) });
    });
    kit.update();
  };
}

// Fireflies blinking over the forest at night, once it has grown.
export function createFireflies(scene, toon, spots) {
  const rand = random(31), flies = spots.slice(0, 70).map((at) => ({ at: at.add(new Vector3(rand() - 0.5, 0.6 + rand() * 0.9, rand() - 0.5)), phase: rand() * 20, rate: 2 + rand() * 2 }));
  const fireflies = createPuffs(scene, toon, 'Firefly', '#000000', flies.length, (day, time) => {
    const night = 1 - smoothstep(-0.25, 0.0, Math.sin(2 * Math.PI * (day + 0.05))), grown = smoothstep(5.6, 6.2, day);
    return flies.map(({ at, phase, rate }) => [at.add(new Vector3(0.15 * Math.sin(time * 0.7 + phase), 0.1 * Math.sin(time * 1.1 + phase), 0.15 * Math.cos(time * 0.6 + phase))),
      0.035 * night * grown * Math.max(0, Math.sin(time * rate + phase)) ** 3]);
  });
  fireflies.material.setColor3('glow', new Color3(1.6, 2.2, 0.6));
  return fireflies;
}
