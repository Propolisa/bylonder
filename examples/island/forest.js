import { createMesh } from '@workbench/sdk';
import { random } from './random.js';
import { shore, heightAt } from './island.js';
import { grassDay, NEST, IMPACT, STRIKE, BEAT, fromFire, fireReaches, fromStrike, tremor, gust, smoothstep } from './story.js';
import { setMatrices, place, createPuffs } from './sky.js';
import { together, glowOf } from './particles.js';

const { Vector3, Quaternion } = BABYLON;

// Low-poly parts in Blender's axes (Z up), each standing on the origin: a tapering trunk, a canopy of stacked blobs, a
// cone and a palm's star of fronds.
export function cone(n, r0, z0, r1, z1, mesh = { vertices: [], faces: [] }) {
  const base = mesh.vertices.length, ring = (r, z) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI), z]);
  mesh.vertices.push(...ring(r0, z0), ...(r1 > 0 ? ring(r1, z1) : [[0, 0, z1]]));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mesh.faces.push(r1 > 0 ? [base + i, base + j, base + n + j, base + n + i] : [base + i, base + j, base + n]);
  }
  mesh.faces.push(Array.from({ length: n }, (_, i) => base + n - 1 - i));
  if (r1 > 0) mesh.faces.push(Array.from({ length: n }, (_, i) => base + n + i));
  return mesh;
}
export function blob(r, [cx, cy, cz], mesh = { vertices: [], faces: [] }) {
  const base = mesh.vertices.length, n = 6, rings = [-0.5, 0.25];
  mesh.vertices.push([cx, cy, cz - r * 0.85]);
  for (const [k, h] of rings.entries()) for (let i = 0; i < n; i++) {
    const a = ((i + k * 0.5) / n) * 2 * Math.PI, w = r * Math.sqrt(1 - h * h);
    mesh.vertices.push([cx + w * Math.cos(a), cy + w * Math.sin(a), cz + h * r]);
  }
  mesh.vertices.push([cx, cy, cz + r * 0.9]);
  const top = base + 1 + 2 * n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = base + 1 + i, b = base + 1 + j, c = base + 1 + n + i, d = base + 1 + n + j;
    mesh.faces.push([base, b, a], [a, b, c], [b, d, c], [c, d, top]);
  }
  return mesh;
}
function fronds() {
  const vertices = [[0, 0, 1.05]], faces = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * 2 * Math.PI, at = (angle, r, z) => [r * Math.cos(angle), r * Math.sin(angle), z];
    const i = vertices.push(at(a - 0.28, 0.3, 1.02), at(a, 0.65, 0.72), at(a + 0.28, 0.3, 1.02)) - 3;
    faces.push([0, i, i + 1], [0, i + 1, i + 2]);
  }
  return { vertices, faces };
}

export // Low plants: a bush of three blobs, a fern's star of fronds, a creeping vine mat with flowers on it.
function fern(n = 7, r = 0.32, h = 0.2) {
  const vertices = [[0, 0, 0.04]], faces = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI, at = (angle, d, z) => [d * Math.cos(angle), d * Math.sin(angle), z];
    const i = vertices.push(at(a - 0.22, r * 0.45, h * 0.8), at(a, r, h * 0.45), at(a + 0.22, r * 0.45, h * 0.8)) - 3;
    faces.push([0, i, i + 1], [0, i + 1, i + 2]);
  }
  return { vertices, faces };
}
const flat = (mesh, k) => ({ ...mesh, vertices: mesh.vertices.map(([x, y, z]) => [x, y, z * k]) });
const flowers = () => [[0.12, 0.05], [-0.1, 0.12], [0.02, -0.15], [-0.16, -0.06], [0.18, -0.1]].reduce((mesh, [x, y]) => blob(0.035, [x, y, 0.07], mesh), { vertices: [], faces: [] });

export const KINDS = {
  palm: [['Palm Trunk', cone(5, 0.07, 0, 0.045, 1.02), '#9a6a43'], ['Palm Fronds', fronds(), '#2ec45a']],
  broadleaf: [['Tree Trunk', cone(5, 0.06, 0, 0.04, 0.5), '#8a5a3b'], ['Tree Canopy', blob(0.2, [0.12, 0.05, 0.9], blob(0.34, [0, 0, 0.7])), '#5fd35f']],
  blossom: [['Blossom Trunk', cone(5, 0.06, 0, 0.04, 0.5), '#8a5a3b'], ['Blossom Canopy', blob(0.15, [0.17, 0.05, 0.76], blob(0.16, [-0.15, -0.09, 0.73], blob(0.14, [-0.03, 0.17, 0.79], blob(0.24, [0, 0, 0.66])))), '#ff8fc2']],
  conifer: [['Pine Trunk', cone(5, 0.05, 0, 0.035, 0.3), '#7a4e33'], ['Pine Needles', cone(6, 0.25, 0.55, 0, 1.15, cone(6, 0.36, 0.2, 0, 0.8)), '#1fa36b']],
  bush: [['Bush', blob(0.13, [-0.13, 0.1, 0.09], blob(0.15, [0.16, 0.05, 0.11], blob(0.19, [0, 0, 0.14]))), '#4cc463']],
  fern: [['Fern', fern(), '#2f9e57']],
  vine: [['Vine Mat', flat(blob(0.3, [0, 0, 0.05]), 0.35), '#45a556'], ['Vine Flowers', flowers(), '#ffd166']],
};
// How wide each kind spreads, for spacing (at size 1), and how much it sways in the wind.
const SPREAD = { palm: 0.45, broadleaf: 0.4, blossom: 0.33, conifer: 0.36, bush: 0.24, fern: 0.26, vine: 0.3 };
const SWAY = { palm: 0.07, broadleaf: 0.03, blossom: 0.03, conifer: 0.02, bush: 0.015, fern: 0.05, vine: 0.005 };

// The forest: trees in clumps over the island's slopes, palms by the shore, pines highest up, broadleaves and blossoms
// between, spaced so their crowns do not run into each other; bushes, ferns and flowering vines fill the ground between.
// Each springs up from nothing once the grass has reached it, sways in the wind and shakes when the ground does. Those
// in the fire's path catch as it reaches them, burn and fall; the asteroid's blast throws everything on the far side
// flat and burns it away. The nest tree stands alone (family.js).
export function createForest(scene, toon) {
  const rand = random(7), plants = [];
  const land = (x, z) => {
    const h = heightAt(x, z), s = Math.hypot(x, z) / shore(Math.atan2(z, x));
    return s <= 0.78 && h >= 0.3 && h <= 2.7 && Math.hypot(x, z) >= 1.8 && Math.hypot(x - NEST.x, z - NEST.z) >= 0.85 ? { h, s } : null;
  };
  const room = (x, z, spread) => plants.every((p) => Math.hypot(p.at.x - x, p.at.z - z) > (p.spread + spread) * 0.8);
  const plant = (kind, x, z, size) => {
    const { h, s } = land(x, z);
    plants.push({ kind, at: new Vector3(x, h - 0.03, z), turn: rand() * Math.PI * 2, size, spread: SPREAD[kind] * size, born: grassDay(s) + 0.3 + rand() * 1.1 });
  };
  // Clumps of trees, each of the kind its place suits, around a centre.
  for (let tries = 0, clumps = 0; clumps < 34 && tries < 3000; tries++) {
    const cx = (rand() * 2 - 1) * 6.5, cz = (rand() * 2 - 1) * 6.5, at = land(cx, cz);
    if (!at) continue;
    clumps++;
    const kind = at.s > 0.6 ? 'palm' : at.h > 1.8 ? 'conifer' : rand() < 0.25 ? 'blossom' : 'broadleaf', count = 3 + Math.floor(rand() * 6);
    for (let k = 0; k < count * 4 && k < 40; k++) {
      const a = rand() * Math.PI * 2, d = rand() * 1.1, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const size = rand() < 0.08 ? 1.45 + rand() * 0.25 : 0.6 + rand() * 0.6;
      if (land(x, z) && room(x, z, SPREAD[kind] * size)) plant(kind, x, z, size);
    }
  }
  // Undergrowth everywhere else there is room.
  for (let tries = 0; tries < 6000; tries++) {
    const x = (rand() * 2 - 1) * 7, z = (rand() * 2 - 1) * 7, at = land(x, z), kind = ['bush', 'bush', 'fern', 'vine'][Math.floor(rand() * 4)], size = 0.7 + rand() * 0.7;
    if (at && room(x, z, SPREAD[kind] * size)) plant(kind, x, z, size);
  }
  // What happens to each: the fire's line, or the strike's blast.
  for (const p of plants) {
    const { x, z } = p.at, r = Math.hypot(x, z), d = fromStrike(x, z);
    if (d < 6.1) {
      const away = new Vector3(x - STRIKE.x, 0, z - STRIKE.z).normalize();
      Object.assign(p, { burns: BEAT.impact - Math.log(1 - d / 6.2) / 2.2, thrown: true, fallAxis: Vector3.Cross(Vector3.Up(), away) });
    } else if (fromFire(x, z) < 0.75 && r > IMPACT.r - 0.3) {
      Object.assign(p, { burns: fireReaches(r) - 0.2, thrown: false, fallAxis: new Vector3(rand() - 0.5, 0, rand() - 0.5).normalize() });
    }
  }
  const parts = Object.entries(KINDS).map(([kind, meshes]) => {
    const planted = plants.filter((p) => p.kind === kind);
    return { planted, meshes: meshes.map(([name, data, color]) => {
      const mesh = createMesh(name, data, scene);
      mesh.material = toon.plain(name, color);
      return { mesh, buffer: setMatrices(mesh, Math.max(1, planted.length)) };
    }) };
  });
  // A burning plant's size and lean: thrown flat at once by the blast or toppling as it burns, then gone.
  const burnt = (p, time) => {
    const age = time - p.burns;
    if (p.burns === undefined || age < 0) return null;
    const fall = p.thrown ? 1.45 * smoothstep(0, 0.12, age) : 1.45 * smoothstep(1.2, 1.7, age) ** 2;
    return { scale: 1 - smoothstep(p.thrown ? 0.6 : 2.2, p.thrown ? 1.8 : 3.4, age), fall };
  };
  const forest = (day, time) => {
    const shaking = tremor(time), blown = gust(time);
    for (const { planted, meshes } of parts) {
      planted.forEach((p, i) => {
        const burn = burnt(p, time), wind = 0.6 + 0.4 * Math.sin(time * 0.5 + p.at.x * 0.3);
        const lean = SWAY[p.kind] * wind * Math.sin(time * 2.2 + p.at.x + p.at.z * 0.7) + 0.12 * shaking * Math.sin(time * 31 + p.at.x * 3 + p.at.z) + 0.35 * blown * SWAY[p.kind] * 10;
        const scale = Math.max(1e-4, p.size * (burn ? burn.scale : grow((day - p.born) / 1.1)));
        let turn = Quaternion.RotationAxis(LEE, lean).multiply(Quaternion.RotationAxis(Vector3.Up(), p.turn));
        if (burn?.fall) turn = Quaternion.RotationAxis(p.fallAxis, burn.fall).multiply(turn);
        for (const { buffer } of meshes) place(buffer, i, p.at, new Vector3(scale, scale, scale), turn);
      });
      for (const { mesh } of meshes) mesh.thinInstanceBufferUpdated('matrix');
    }
  };
  const trees = plants.filter((p) => !['bush', 'fern', 'vine'].includes(p.kind));
  const flames = createTreeFire(scene, toon, plants.filter((p) => p.burns !== undefined && trees.includes(p)));
  return Object.assign((day, time) => { forest(day, time); flames(day, time); }, { spots: trees.filter((p) => p.kind !== 'conifer').map((p) => p.at) });
}
// The axis plants lean about in the wind and the strike's gust: across the line from the strike to the nest.
const LEE = Vector3.Cross(Vector3.Up(), new Vector3(Math.cos(NEST.angle), 0, Math.sin(NEST.angle))).normalize();

// easeOutBack: a tree overshoots a little as it springs up.
export const grow = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2);

// Fire in the burning trees: tongues of flame in three colors licking up from each canopy and dark smoke above them,
// each rising and renewing in a cycle, as long as the tree burns.
export function createTreeFire(scene, toon, burning, { height = 0.8, from = (tree) => tree.burns, length = 2.2, size = 1 } = {}) {
  const PER = 4, layers = [['Tree Fire Hot', '#000000', [2.6, 2.0, 0.7], 0.16, 1.8], ['Tree Fire', '#000000', [2.3, 0.75, 0.1], 0.22, 1.4], ['Tree Fire Red', '#000000', [1.3, 0.2, 0.04], 0.27, 1.1], ['Tree Smoke', '#3f3a46', null, 0.12, 0.45]];
  return together(...layers.map(([name, color, glow, peak, rate], layer) => {
    const puffs = createPuffs(scene, toon, name, color, burning.length * PER, (day, time) => burning.flatMap((tree, j) => Array.from({ length: PER }, (_, k) => {
      const age = time - from(tree), on = smoothstep(0, 0.3, age) * (1 - smoothstep(length - 0.6, length, age));
      if (on <= 0) return [Vector3.Zero(), 0];
      const p = (time * rate + k / PER + j * 0.37) % 1, rise = layer === 3 ? 1.6 : 0.7;
      const drift = layer === 3 ? p * 1.2 : 0;
      const at = tree.at.add(new Vector3(0.18 * Math.sin(k * 2.3 + j) - 0.5 * drift, height * (tree.size ?? 1) + rise * p, 0.18 * Math.cos(k * 1.7 + j) - 0.3 * drift));
      return [at, size * peak * on * (layer === 3 ? 0.4 + p : Math.sin(Math.PI * p))];
    })));
    if (glow) puffs.material.setColor3('glow', glowOf(...glow));
    else puffs.material.setColor3('underglow', glowOf(1, 0.32, 0.06));
    return puffs;
  }));
}
