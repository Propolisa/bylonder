import { createMesh, createPrimitive } from '@workbench/sdk';
import { random } from './random.js';

// The island's shore, its distance from the centre by direction.
export const shore = (angle) => 6.2 + 0.7 * Math.sin(3 * angle + 1) + 0.4 * Math.sin(5 * angle + 2.3) + 0.25 * Math.sin(8 * angle + 0.5);

// Height above the sea: a low island rising to a volcano with a crater, sinking below the sea past its beaches.
export function heightAt(x, z) {
  const r = Math.hypot(x, z), s = r / shore(Math.atan2(z, x));
  const land = 1 - Math.min(1, Math.max(0, (s - 0.8) / 0.25));
  const base = -1.5 + 1.75 * land + 1.4 * Math.max(0, 1 - s) ** 2;
  const volcano = 5.2 * Math.max(0, 1 - r / 3.6) ** 1.1;
  const t = Math.min(1, Math.max(0, (r - 0.3) / 0.7)), crater = 2.2 * (1 - t * t * (3 - 2 * t));
  return base + volcano - crater + 0.25 * land * Math.sin(x * 1.3 + 1) * Math.cos(z * 1.1);
}

// The island as one low-poly mesh: a grid jittered so its faces are irregular, in Blender's axes (Z up).
export function createIsland(scene) {
  const N = 56, SIZE = 17, rand = random(3), vertices = [], faces = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const edge = i === 0 || j === 0 || i === N || j === N, jitter = edge ? 0 : 0.35 * (SIZE / N);
    const x = -SIZE / 2 + (i * SIZE) / N + (rand() - 0.5) * jitter, z = -SIZE / 2 + (j * SIZE) / N + (rand() - 0.5) * jitter;
    vertices.push([x, z, heightAt(x, z)]);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    faces.push(...((i + j) % 2 ? [[a, b, d], [a, d, c]] : [[a, b, c], [b, d, c]]));
  }
  return createMesh('Island', { vertices, faces }, scene);
}

// The sea: Blender's Circle primitive, filled.
export const createSea = (scene) => createPrimitive('Sea', 'mesh.primitive_circle_add', { vertices: 64, radius: 80, fill_type: 'NGON' }, scene);
