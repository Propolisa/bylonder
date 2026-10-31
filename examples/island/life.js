import { createMesh } from '@workbench/sdk';
import { blob } from './forest.js';
import { random } from './random.js';
import { shore, heightAt } from './island.js';
import { smoothstep, lerp, eruption, BEAT, OMEN, SEA_CAVE, TURTLE, LENGTH as FILM, shotAngle, frameAt, days, dayAt } from './story.js';
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

// The whales' swims: a whale early on, surfacing along the shore in the shot it is seen in; at the end a whale and her
// calf beyond the island from the last shot, rising twice, slow and long. `length` is a swim's seconds.
const BEYOND = SEA_CAVE.angle + 0.1 + Math.PI;
export const WHALES = [
  { start: 7.5, angle: 0.35, distance: 10, size: 0.85 },
  ...[FILM - 12, FILM - 6.5].flatMap((start, k) => [{ start, at: BEYOND + 0.35 - 0.1 * k, distance: 17, size: 1.0, length: 5.5 },
    { start: start + 0.5, at: BEYOND + 0.4 - 0.1 * k, distance: 18, size: 0.42, length: 5.5 }]),
].map((swim) => {
  const angle = swim.at ?? shotAngle(frameAt(Math.min(FILM - 0.5, swim.start + 1.3))) + swim.angle;
  return { length: 3.2, ...swim, angle, at: new Vector3(Math.cos(angle) * swim.distance, 0, Math.sin(angle) * swim.distance) };
});

// Whales surfacing: each rises on an arc, its back breaking the water, blows a spout, and dives, the flukes lifting
// last. One early, while the island is young; at the end a mother with her calf beside her.
export function createWhales(scene, toon) {
  const mesh = createMesh('Whale', whaleMesh(), scene);
  mesh.material = toon.plain('Whale', '#34507e');
  const buffer = setMatrices(mesh, WHALES.length), R = 3.2;
  // Where a swim is at time t: on a circle of radius R below the sea, travelling along the shore.
  const pose = ({ start, angle, distance, size, length }, time) => {
    const p = (time - start) / length;
    if (p <= 0 || p >= 1) return null;
    const phi = -0.75 + 1.5 * p, along = new Vector3(-Math.sin(angle), 0, Math.cos(angle)), center = new Vector3(Math.cos(angle) * distance, -R * size + 0.28 * size, Math.sin(angle) * distance);
    const position = center.add(along.scale(Math.sin(phi) * R * size)).add(new Vector3(0, Math.cos(phi) * R * size, 0));
    const heading = Math.atan2(-along.z, along.x), pitch = -phi;
    return { position, size, rotation: Quaternion.RotationAxis(Vector3.Up(), heading).multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), pitch)), p, along };
  };
  const spouts = createPuffs(scene, toon, 'Spout', '#f2f8ff', WHALES.length * 6, (day, time) => WHALES.flatMap((swim) => {
    const at = pose(swim, time);
    return Array.from({ length: 6 }, (_, k) => {
      if (!at) return hidden;
      const blow = smoothstep(0.25, 0.32, at.p) * (1 - smoothstep(0.4, 0.55, at.p)), rise = (at.p - 0.25) * 6 + k * 0.12;
      return [at.position.add(at.along.scale(0.6 * at.size)).add(new Vector3(0.1 * Math.sin(k * 2.1), 0.2 + rise * 0.9 * at.size, 0.1 * Math.cos(k * 1.3))), 0.13 * blow * at.size * (1 + k * 0.25)];
    });
  }));
  return (day, time) => {
    WHALES.forEach((swim, i) => {
      const at = pose(swim, time);
      place(buffer, i, at ? at.position : new Vector3(0, -50, 0), new Vector3(1, 1, 1).scale(at ? at.size : 1e-4), at ? at.rotation : 0);
    });
    mesh.thinInstanceBufferUpdated('matrix');
    spouts(day, time);
  };
}

// Birds of one color, any number: a body, two wings and a head with a beak and eyes, posed each frame as flying
// (flapping or gliding) or perched with their wings folded. The head turns to look at a point, within what a neck
// allows, or tucks back under a wing to sleep.
const NECK = new Vector3(0.13, 0.05, 0), TUCKED = new Vector3(0.05, 0.055, 0);
export function createBirdKit(scene, toon, name, color, count) {
  const part = (suffix, vertices, faces, tint = color) => {
    const mesh = createMesh(`${name} ${suffix}`, { vertices, faces }, scene);
    mesh.material = toon.plain(`${name} ${suffix}`, tint);
    return { mesh, buffer: setMatrices(mesh, count) };
  };
  const body = part('Body', [[0.14, 0, 0], [-0.12, 0, 0.02], [0, 0.03, 0.03], [0, -0.03, 0.03], [0, 0, -0.03], [0.17, 0, 0.012]], [[0, 2, 1], [0, 1, 3], [0, 3, 4], [0, 4, 2], [1, 2, 4], [1, 4, 3], [0, 5, 2], [0, 3, 5]]);
  const left = part('Wing L', [[0.05, 0, 0], [-0.05, 0, 0], [-0.02, 0.28, 0.02]], [[0, 1, 2], [0, 2, 1]]);
  const right = part('Wing R', [[0.05, 0, 0], [-0.05, 0, 0], [-0.02, -0.28, 0.02]], [[0, 2, 1], [0, 1, 2]]);
  const head = part('Head', blob(0.042, [0, 0, 0]).vertices, blob(0.042, [0, 0, 0]).faces);
  const beak = part('Beak', [[0.03, 0.013, 0.004], [0.03, -0.013, 0.004], [0.03, 0, 0.016], [0.03, 0, -0.01], [0.088, 0, 0]],
    [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [0, 1, 2], [0, 3, 1]], '#f2a54a');
  // Marks painted on a part's faces: soot smudged on the body and head, and a scar across the left side of the face.
  const HEAD = blob(0.042, [0, 0, 0]), BODY = [[0.14, 0, 0], [-0.12, 0, 0.02], [0, 0.03, 0.03], [0, -0.03, 0.03], [0, 0, -0.03], [0.17, 0, 0.012]];
  const soot = part('Soot', ...decals(BODY, [[0, 2, 1, 0.65, 0.2], [0, 1, 3, 0.55, -0.3], [1, 4, 3, 0.55, 0.4], [0, 3, 4, 0.5, 0.5]]), '#6e6670');
  const headSoot = part('Head Soot', ...decals(HEAD.vertices, [[...faceToward(HEAD, [-0.3, -0.7, 0.6]), 0.6, 0.4], [...faceToward(HEAD, [0.2, 0.3, 0.9]), 0.45, -0.5]]), '#6e6670');
  const scar = part('Scar', ...stripe(HEAD, [0.45, 0.85, 0.3]), '#9a4256');
  const eyes = part('Eyes', [...blob(0.011, [0.022, 0.031, 0.014]).vertices, ...blob(0.011, [0.022, -0.031, 0.014]).vertices],
    [...blob(0.011, [0, 0, 0]).faces, ...blob(0.011, [0, 0, 0]).faces.map((f) => f.map((v) => v + 14))], '#1d1a2b');
  const materials = [body, left, right, head].map(({ mesh }) => mesh.material);
  const turned = (q, v) => v.rotateByQuaternionToRef(q, new Vector3());
  return {
    materials,
    // wings: an angle up from level (each beat), or `null` for folded. look: a point to look at; tuck: 0 to 1 asleep.
    // bent: how far the right wing hangs from a break; scarred: the scar shows; dirty: the soot shows.
    pose(i, position, size, heading, { bank = 0, pitch = 0, wings = 0, look = null, tuck = 0, nod = 0, bent = 0, scarred = false, dirty = false } = {}) {
      const turn = Quaternion.RotationAxis(Vector3.Up(), heading).multiply(Quaternion.RotationAxis(Vector3.Right(), bank)).multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), pitch));
      const s = Math.max(1e-4, size), scale = new Vector3(s, s, s), folded = wings === null;
      place(body.buffer, i, position, scale, turn);
      place(soot.buffer, i, position, dirty ? scale : HIDDEN, turn);
      const wing = (side) => turn.multiply(Quaternion.RotationAxis(Vector3.Right(), folded ? side * 1.35 : -side * wings)).multiply(Quaternion.RotationAxis(Vector3.Up(), folded ? 0.5 : 0));
      place(left.buffer, i, position, folded ? scale.scale(0.7) : scale, wing(1));
      place(right.buffer, i, position, folded ? scale.scale(0.7) : scale, wing(-1).multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0.4).normalize(), bent)));
      // The head: its yaw and pitch toward what it looks at, in the body's frame, within the neck's reach.
      const neck = position.add(turned(turn, Vector3.Lerp(NECK, TUCKED, tuck).scale(s)));
      let yaw = 0, rise = 0;
      if (look) {
        const local = turned(Quaternion.Inverse(turn), look.subtract(neck));
        yaw = Math.max(-2.3, Math.min(2.3, Math.atan2(-local.z, local.x)));
        rise = Math.max(-1.2, Math.min(1.1, Math.atan2(local.y, Math.hypot(local.x, local.z))));
      }
      yaw += (2.7 * Math.sign(yaw || 1) - yaw) * tuck;
      rise += (-0.5 - rise) * tuck + nod;
      const gaze = turn.multiply(Quaternion.RotationAxis(Vector3.Up(), yaw)).multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), rise));
      for (const p of [head, beak, eyes]) place(p.buffer, i, neck, scale, gaze);
      place(scar.buffer, i, neck, scarred ? scale : HIDDEN, gaze);
      place(headSoot.buffer, i, neck, dirty ? scale : HIDDEN, gaze);
    },
    update() { for (const { mesh } of [body, left, right, head, beak, eyes, scar, soot, headSoot]) mesh.thinInstanceBufferUpdated('matrix'); },
  };
}
const HIDDEN = new Vector3(1e-4, 1e-4, 1e-4);
const sub = (a, b) => a.map((v, k) => v - b[k]), dot = (a, b) => a.reduce((sum, v, k) => sum + v * b[k], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((v) => v / Math.hypot(...a));
// A face's centre and outward normal (the mesh's centre is near its origin).
const faceFrame = (vertices, [a, b, c]) => {
  const centre = [0, 1, 2].map((k) => (vertices[a][k] + vertices[b][k] + vertices[c][k]) / 3);
  const normal = unit(cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a])));
  return { centre, normal: dot(normal, centre) < 0 ? normal.map((v) => -v) : normal };
};
// The face of a mesh that most faces a direction.
const faceToward = ({ vertices, faces }, direction) => faces.reduce((best, f) => (dot(faceFrame(vertices, f).normal, direction) > dot(faceFrame(vertices, best).normal, direction) ? f : best));
// Marks painted on faces: each [a, b, c, size, twist] a smaller copy of the face, turned in its plane, lying just on it.
function decals(vertices, marks) {
  const out = [], faces = [];
  for (const [a, b, c, size, twist] of marks) {
    const { centre, normal } = faceFrame(vertices, [a, b, c]), turn = (v) => {
      const d = sub(v, centre).map((x) => x * size), t = cross(normal, d);
      return d.map((x, k) => centre[k] + x * Math.cos(twist) + t[k] * Math.sin(twist) + normal[k] * 0.0008);
    };
    const base = out.length;
    out.push(turn(vertices[a]), turn(vertices[b]), turn(vertices[c]));
    faces.push(dot(cross(sub(out[base + 1], out[base]), sub(out[base + 2], out[base])), normal) > 0 ? [base, base + 1, base + 2] : [base, base + 2, base + 1]);
  }
  return [out, faces];
}
// A thin mark across the face of a mesh that most faces a direction, painted on it.
function stripe(mesh, direction) {
  const f = faceToward(mesh, direction), { centre, normal } = faceFrame(mesh.vertices, f);
  const lift = (v) => v.map((x, k) => x + normal[k] * 0.0008);
  const [p, q] = [mesh.vertices[f[0]], mesh.vertices[f[1]]].map((v) => centre.map((x, k) => x + (v[k] - x) * 0.75));
  const across = unit(cross(normal, sub(q, p))).map((x) => x * 0.0022);
  const out = [p.map((x, k) => x + across[k]), p.map((x, k) => x - across[k]), q.map((x, k) => x - across[k] * 0.4), q.map((x, k) => x + across[k] * 0.4)].map(lift);
  const facing = dot(cross(sub(out[1], out[0]), sub(out[2], out[0])), normal) > 0;
  return [out, facing ? [[0, 1, 2], [0, 2, 3]] : [[0, 2, 1], [0, 3, 2]]];
}
// A sea turtle hauling itself out of the sea up the beach below the family: a stroke of both front flippers, a heave
// forward, a rest; its shell rides up out of the water as the beach rises under it.
export function createTurtle(scene, toon) {
  // Its parts in its own frame (Blender's axes, facing +X, Z up), sized to stand out among the birds.
  const SIZE = 1.3, scaled = ({ vertices, faces }, [sx, sy, sz], [dx, dy, dz] = [0, 0, 0]) => ({ vertices: vertices.map(([x, y, z]) => [(x * sx + dx) * SIZE, (y * sy + dy) * SIZE, (z * sz + dz) * SIZE]), faces });
  const flipper = (side, along, length) => ({ vertices: [[along + 0.05, side * 0.1, 0.08], [along - 0.05, side * 0.1, 0.08], [along - 0.08, side * (0.1 + length), 0.04], [along + 0.02, side * (0.1 + length * 0.9), 0.05]],
    faces: [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]] });
  const part = (name, data, color) => {
    const mesh = createMesh(name, data, scene);
    mesh.material = toon.plain(name, color);
    return { mesh, buffer: setMatrices(mesh, 1) };
  };
  const shell = part('Turtle Shell', scaled(blob(0.2, [0, 0, 0]), [1.15, 0.95, 0.55], [0, 0, 0.1]), '#4a5730');
  const head = part('Turtle Head', scaled(blob(0.065, [0, 0, 0]), [1.3, 1, 0.9], [0.27, 0, 0.1]), '#a3ad74');
  const fins = [[1, 0.08, 0.26], [-1, 0.08, 0.26], [1, -0.15, 0.13], [-1, -0.15, 0.13]].map(([side, along, length], k) => ({ side, front: along > 0, ...part(`Turtle Flipper ${k + 1}`, scaled(flipper(side, along, length), [1, 1, 1]), '#8a955e') }));
  const inward = new Vector3(-Math.cos(TURTLE.angle), 0, -Math.sin(TURTLE.angle)), heading = headingOf(inward);
  // A stroke of the front flippers every 1.6 s heaves it forward; the back ones push.
  const crawl = (time) => {
    const strokes = (time - TURTLE.start) / 1.6, done = Math.floor(strokes);
    return Math.max(0, done + smoothstep(0.15, 0.6, strokes - done)) / ((TURTLE.end - TURTLE.start) / 1.6);
  };
  return (day, time) => {
    const shown = time > TURTLE.start ? 1 : 1e-4, r = shore(TURTLE.angle) * lerp(TURTLE.from, TURTLE.to, Math.min(1, crawl(time)));
    // Each stroke heaves the shell up and forward a little, then it settles while the flippers reach again.
    const phase = ((time - TURTLE.start) / 1.6) * 2 * Math.PI, stroke = Math.sin(phase), heave = 0.035 * SIZE * Math.max(0, Math.sin(phase - 0.6));
    const x = Math.cos(TURTLE.angle) * r, z = Math.sin(TURTLE.angle) * r, at = new Vector3(x, Math.max(-0.1, heightAt(x, z)) + heave, z);
    const turn = Quaternion.RotationAxis(Vector3.Up(), heading).multiply(Quaternion.RotationAxis(new Vector3(0, 0, 1), -2 * heave)), scale = new Vector3(1, 1, 1).scale(shown);
    place(shell.buffer, 0, at, scale, turn);
    place(head.buffer, 0, at.add(new Vector3(0, 0.012 * SIZE * stroke, 0)), scale, turn);
    for (const { side, front, buffer } of fins) place(buffer, 0, at, scale, turn.multiply(Quaternion.RotationAxis(Vector3.Up(), (front ? 0.35 : 0.2) * side * stroke)));
    for (const { mesh } of [shell, head, ...fins]) mesh.thinInstanceBufferUpdated('matrix');
  };
}
// The heading that points a bird along a direction.
export const headingOf = (along) => Math.atan2(-along.z, along.x);

// The flock: nine birds, each living its own days. Each flies in from the sea once the forest has grown; from then on
// it spends each third of a day at one thing (keeping watch high over the volcano, sitting in a tree, fishing out at
// sea), flying from one to the next, and roosts at night. As the star grows they grow restless: more keep watch,
// higher and faster, and they leave out to sea in three waves over its last days, away from it.
const BIRDS = 9;
export const WAVES = [111.5, 116.2, BEAT.leave];
const AWAY = new Vector3(-OMEN.x, 0, -OMEN.z).normalize();
export const FLOCK = Array.from({ length: BIRDS }, (_, i) => {
  const r = random(300 + i);
  return { arrives: 4.85 + 0.09 * i + 0.1 * r(), seed: r(), from: r() * 2 * Math.PI, radius: 3.6 + 2 * r(), height: 4.6 + 1.2 * r(), lap: 0.45 + 0.2 * r(),
    leaves: WAVES[i % 3] + 0.5 * Math.floor(i / 3) + 0.3 * r(), perch: Math.floor(r() * 1e6), sea: r() * 2 * Math.PI };
});
const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
// What a bird does in a third of a day `slot`: roosts at night, else watches, sits or fishes; restless birds watch.
const doing = (bird, slot, restless) => {
  const fraction = ((slot / 3) % 1 + 1) % 1, h = hash(bird.seed * 100, slot);
  if (fraction > 0.55 && fraction < 0.95) return 'roost';
  return h < 0.35 + 0.5 * restless ? 'watch' : h < 0.7 + 0.15 * restless ? 'sit' : 'fish';
};
// Where a bird is at a thing, at a moment: circling, on its tree, or wheeling low over the sea.
function placeOf(bird, kind, slot, time, spots, restless) {
  if (kind === 'roost' || kind === 'sit') {
    const at = spots[(bird.perch + slot * 7) % spots.length];
    return { point: new Vector3(at.x, heightAt(at.x, at.z) + 1.05, at.z), sitting: true };
  }
  const fast = 1 + 0.8 * restless, a = bird.from + time * bird.lap * fast * (kind === 'fish' ? -0.7 : 1);
  if (kind === 'watch') return { point: new Vector3(Math.cos(a) * bird.radius, bird.height + 1.5 * restless + 0.3 * Math.sin(time * 1.3 + bird.seed * 9), Math.sin(a) * bird.radius) };
  const out = 9 + 3 * bird.seed, dip = Math.max(0, Math.sin(time * 0.8 + bird.seed * 20)) ** 6;
  return { point: new Vector3(Math.cos(a + bird.sea) * out, 1.4 - 1.2 * dip, Math.sin(a + bird.sea) * out) };
}
// A bird's place at a day and second: arriving, at its thing or flying between, or leaving.
function birdAt(bird, day, time, spots) {
  const restless = smoothstep(BEAT.omen - 4, BEAT.leave, time);
  if (day < bird.arrives - 0.25) return null;
  const slotOf = (d) => Math.floor(d * 3 + bird.seed * 3), slot = slotOf(day), into = day * 3 + bird.seed * 3 - slot;
  const here = placeOf(bird, doing(bird, slot, restless), slot, time, spots, restless);
  let { point } = here, sitting = here.sitting && into > 0.12;
  if (into < 0.12) {
    const was = placeOf(bird, doing(bird, slot - 1, restless), slot - 1, time, spots, restless).point, u = smoothstep(0, 0.12, into);
    point = Vector3.Lerp(was, point, u).add(new Vector3(0, 1.5 * Math.sin(Math.PI * u), 0));
  }
  if (day < bird.arrives) {
    const u = smoothstep(bird.arrives - 0.25, bird.arrives, day), far = new Vector3(Math.cos(bird.from) * 45, 9, Math.sin(bird.from) * 45);
    point = Vector3.Lerp(far, point, u); sitting = false;
  }
  if (time > bird.leaves) {
    const u = (time - bird.leaves) / 7;
    if (u >= 1) return null;
    point = Vector3.Lerp(point, AWAY.scale(55).add(new Vector3(0, 12, 0)), smoothstep(0, 1, u) ** 1.4); sitting = false;
  }
  return { point, sitting, restless };
}
// Where the flock is, roughly, for its calls: over the island, or with the wave leaving.
export const flockAt = (time) => {
  const wave = WAVES.find((w) => time > w - 1 && time < w + 6);
  return wave ? AWAY.scale(4 + 6 * Math.max(0, time - wave)).add(new Vector3(0, 5 + time - wave, 0)) : new Vector3(Math.cos(time * 0.5) * 4.5, 5, Math.sin(time * 0.5) * 4.5);
};
export function createBirds(scene, toon, spots) {
  const kit = createBirdKit(scene, toon, 'Bird', '#fdf8f0', BIRDS);
  return (day, time) => {
    const later = dayAt(time + 0.05);
    FLOCK.forEach((bird, i) => {
      const now = birdAt(bird, day, time, spots), next = birdAt(bird, later, time + 0.05, spots);
      if (!now) { kit.pose(i, new Vector3(0, -50, 0), 1e-4, 0); return; }
      const velocity = next ? next.point.subtract(now.point).scale(20) : Vector3.Zero(), moving = velocity.length() > 0.3;
      const climb = moving ? velocity.y / velocity.length() : 0, beat = 14 * (1 + 0.6 * now.restless);
      // Flapping in bursts and gliding between, more flapping when climbing or uneasy; wings down when sitting.
      const flapping = Math.max(now.restless * 0.8, climb > 0.15 ? 1 : smoothstep(0.1, 0.5, Math.sin(time * 0.9 + bird.seed * 20)));
      const wings = now.sitting ? null : flapping * wingBeat(time * beat + bird.seed * 9) * 0.75 + 0.12;
      kit.pose(i, now.point, 2.4, headingOf(moving ? velocity : new Vector3(Math.cos(bird.from), 0, Math.sin(bird.from))),
        { bank: moving ? 0.3 : 0, pitch: -climb * 0.4, wings });
    });
    kit.update();
  };
}
// A wing's beat: a quick, strong downstroke and a slower recovery, from its phase.
export const wingBeat = (phase) => { const s = Math.sin(phase); return s > 0 ? s ** 0.6 : -((-s) ** 1.5); };

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
