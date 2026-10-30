import { createMesh } from '@workbench/sdk';
import { random } from './random.js';
import { shore, heightAt } from './island.js';
import { grassDay, NEST, IMPACT, BEAT, fromFire, fireReaches, tremor, smoothstep } from './story.js';
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

export const KINDS = {
  palm: [['Palm Trunk', cone(5, 0.07, 0, 0.045, 1.02), '#9a6a43'], ['Palm Fronds', fronds(), '#2ec45a']],
  broadleaf: [['Tree Trunk', cone(5, 0.06, 0, 0.04, 0.5), '#8a5a3b'], ['Tree Canopy', blob(0.2, [0.12, 0.05, 0.9], blob(0.34, [0, 0, 0.7])), '#5fd35f']],
  blossom: [['Blossom Trunk', cone(5, 0.06, 0, 0.04, 0.5), '#8a5a3b'], ['Blossom Canopy', blob(0.3, [0, 0, 0.72]), '#ff8fc2']],
  conifer: [['Pine Trunk', cone(5, 0.05, 0, 0.035, 0.3), '#7a4e33'], ['Pine Needles', cone(6, 0.25, 0.55, 0, 1.15, cone(6, 0.36, 0.2, 0, 0.8)), '#1fa36b']],
};

// The forest: trees placed over the island's slopes, each springing up from nothing once the grass has reached it, palms
// by the shore first, pines highest up, then swaying in the wind (palms the most) and shaking when the ground does.
// Those in the fire's path catch as it reaches them, burn and fall; those by the strike are thrown flat. New ones
// grow there as the ground heals. The nest tree stands alone (family.js).
export function createForest(scene, toon) {
  const rand = random(7), trees = [];
  while (trees.length < 260) {
    const x = (rand() * 2 - 1) * 7, z = (rand() * 2 - 1) * 7, h = heightAt(x, z), s = Math.hypot(x, z) / shore(Math.atan2(z, x));
    if (s > 0.78 || h < 0.3 || h > 2.6 || Math.hypot(x, z) < 1.8 || Math.hypot(x - NEST.x, z - NEST.z) < 0.8) continue;
    const kind = s > 0.6 ? 'palm' : h > 1.7 ? 'conifer' : rand() < 0.2 ? 'blossom' : 'broadleaf';
    const tree = { kind, at: new Vector3(x, h - 0.03, z), turn: rand() * Math.PI * 2, size: 0.7 + rand() * 0.6, born: grassDay(s) + 0.3 + rand() * 1.1 };
    const struck = Math.hypot(x - IMPACT.x, z - IMPACT.z) < 1.5, r = Math.hypot(x, z);
    if (struck || (fromFire(x, z) < 0.75 && r > IMPACT.r - 0.3)) {
      const away = new Vector3(x - IMPACT.x, 0, z - IMPACT.z).normalize();
      Object.assign(tree, { burns: struck ? BEAT.impact : fireReaches(r) - 0.2, thrown: struck, fallAxis: struck ? Vector3.Cross(Vector3.Up(), away) : new Vector3(rand() - 0.5, 0, rand() - 0.5).normalize(),
        reborn: BEAT.heal + 0.8 + rand() * 3 });
    }
    trees.push(tree);
  }
  const parts = Object.entries(KINDS).map(([kind, meshes]) => {
    const planted = trees.filter((tree) => tree.kind === kind);
    return { planted, meshes: meshes.map(([name, data, color]) => {
      const mesh = createMesh(name, data, scene);
      mesh.material = toon.plain(name, color);
      return { mesh, buffer: setMatrices(mesh, planted.length) };
    }) };
  });
  const sway = { palm: 0.07, broadleaf: 0.03, blossom: 0.03, conifer: 0.02 };
  // A burning tree's size and lean: thrown flat at once by the strike or toppling as it burns, gone, then grown anew.
  const burnt = (tree, time) => {
    const age = time - tree.burns;
    if (tree.burns === undefined || age < 0) return null;
    const fall = tree.thrown ? 1.45 * smoothstep(0, 0.12, age) : 1.45 * smoothstep(1.2, 1.7, age) ** 2;
    const gone = 1 - smoothstep(tree.thrown ? 2.5 : 2.2, tree.thrown ? 4 : 3.4, age), again = grow((time - tree.reborn) / 1.4);
    return again > 0 ? { scale: again * 0.8, fall: 0 } : { scale: gone, fall };
  };
  const forest = (day, time) => {
    const shaking = tremor(time);
    for (const { planted, meshes } of parts) {
      planted.forEach((tree, i) => {
        const burn = burnt(tree, time), gust = 0.6 + 0.4 * Math.sin(time * 0.5 + tree.at.x * 0.3);
        const lean = sway[tree.kind] * gust * Math.sin(time * 2.2 + tree.at.x + tree.at.z * 0.7) + 0.12 * shaking * Math.sin(time * 31 + tree.at.x * 3 + tree.at.z);
        const scale = Math.max(1e-4, tree.size * (burn ? burn.scale : grow((day - tree.born) / 1.1)));
        let turn = Quaternion.RotationAxis(new Vector3(0.6, 0, 0.8), lean).multiply(Quaternion.RotationAxis(Vector3.Up(), tree.turn));
        if (burn?.fall) turn = Quaternion.RotationAxis(tree.fallAxis, burn.fall).multiply(turn);
        for (const { buffer } of meshes) place(buffer, i, tree.at, new Vector3(scale, scale, scale), turn);
      });
      for (const { mesh } of meshes) mesh.thinInstanceBufferUpdated('matrix');
    }
  };
  const flames = createTreeFire(scene, toon, trees.filter((tree) => tree.burns !== undefined));
  return Object.assign((day, time) => { forest(day, time); flames(day, time); }, { spots: trees.filter((tree) => tree.kind !== 'conifer').map((tree) => tree.at) });
}

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
