import { createMesh } from '@workbench/sdk';
import { random } from './random.js';
import { shore, heightAt } from './island.js';
import { grassDay } from './story.js';
import { setMatrices, place } from './sky.js';

const { Vector3, Quaternion } = BABYLON;

// Low-poly parts in Blender's axes (Z up), each standing on the origin: a tapering trunk, a canopy of stacked blobs, a
// cone and a palm's star of fronds.
function cone(n, r0, z0, r1, z1, mesh = { vertices: [], faces: [] }) {
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
function blob(r, [cx, cy, cz], mesh = { vertices: [], faces: [] }) {
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

const KINDS = {
  palm: [['Palm Trunk', cone(5, 0.07, 0, 0.045, 1.02), '#9a6a43'], ['Palm Fronds', fronds(), '#2ec45a']],
  broadleaf: [['Tree Trunk', cone(5, 0.06, 0, 0.04, 0.5), '#8a5a3b'], ['Tree Canopy', blob(0.2, [0.12, 0.05, 0.9], blob(0.34, [0, 0, 0.7])), '#5fd35f']],
  blossom: [['Blossom Trunk', cone(5, 0.06, 0, 0.04, 0.5), '#8a5a3b'], ['Blossom Canopy', blob(0.3, [0, 0, 0.72]), '#ff8fc2']],
  conifer: [['Pine Trunk', cone(5, 0.05, 0, 0.035, 0.3), '#7a4e33'], ['Pine Needles', cone(6, 0.25, 0.55, 0, 1.15, cone(6, 0.36, 0.2, 0, 0.8)), '#1fa36b']],
};

// The forest: trees placed over the island's slopes, each springing up from nothing once the grass has reached it, palms
// by the shore first, pines highest up, then swaying in the wind (palms the most).
export function createForest(scene, toon) {
  const rand = random(7), trees = [];
  while (trees.length < 260) {
    const x = (rand() * 2 - 1) * 7, z = (rand() * 2 - 1) * 7, h = heightAt(x, z), s = Math.hypot(x, z) / shore(Math.atan2(z, x));
    if (s > 0.78 || h < 0.3 || h > 2.6 || Math.hypot(x, z) < 1.8) continue;
    const kind = s > 0.6 ? 'palm' : h > 1.7 ? 'conifer' : rand() < 0.2 ? 'blossom' : 'broadleaf';
    trees.push({ kind, at: new Vector3(x, h - 0.03, z), turn: rand() * Math.PI * 2, size: 0.7 + rand() * 0.6, born: grassDay(s) + 0.3 + rand() * 1.1 });
  }
  const parts = Object.entries(KINDS).map(([kind, meshes]) => {
    const planted = trees.filter((tree) => tree.kind === kind);
    return { planted, meshes: meshes.map(([name, data, color]) => {
      const mesh = createMesh(name, data, scene);
      mesh.material = toon.plain(name, color);
      return { mesh, buffer: setMatrices(mesh, planted.length) };
    }) };
  });
  // easeOutBack: a tree overshoots a little as it springs up.
  const grow = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2);
  const sway = { palm: 0.07, broadleaf: 0.03, blossom: 0.03, conifer: 0.02 };
  return Object.assign((day, time) => {
    for (const { planted, meshes } of parts) {
      planted.forEach((tree, i) => {
        const scale = Math.max(1e-4, tree.size * grow((day - tree.born) / 1.1)), gust = 0.6 + 0.4 * Math.sin(time * 0.5 + tree.at.x * 0.3);
        const lean = sway[tree.kind] * gust * Math.sin(time * 2.2 + tree.at.x + tree.at.z * 0.7);
        const turn = Quaternion.RotationAxis(new Vector3(0.6, 0, 0.8), lean).multiply(Quaternion.RotationAxis(Vector3.Up(), tree.turn));
        for (const { buffer } of meshes) place(buffer, i, tree.at, new Vector3(scale, scale, scale), turn);
      });
      for (const { mesh } of meshes) mesh.thinInstanceBufferUpdated('matrix');
    }
  }, { spots: trees.filter((tree) => tree.kind !== 'conifer').map((tree) => tree.at) });
}
