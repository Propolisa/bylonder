import assert from 'node:assert/strict';
import { BLI_polyfill_calc, unit } from '../src/blenlib/polyfill-2d.js';

// The generated JS port against Blender's own code built to WebAssembly: the same triangles for every polygon.
let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const star = (n) => Array.from({ length: n }, (_, i) => {
  const angle = (2 * Math.PI * i) / n, radius = 0.2 + random();
  return [Math.fround(radius * Math.cos(angle)), Math.fround(radius * Math.sin(angle))];
});
const polygons = [
  [[0, 0], [2, 0], [2, 2], [1, 1], [0, 2]],
  Array.from({ length: 12 }, (_, i) => [Math.fround(Math.cos(i / 2)), Math.fround(Math.sin(i / 2))]),
  [[0, 0], [1, 0], [2, 0], [2, 1], [0, 1]],
  ...Array.from({ length: 200 }, (_, i) => star(3 + (i % 60))),
  star(2000),
];
const triangulate = (coords) => {
  const tris = Array.from({ length: coords.length - 2 }, () => [0, 0, 0]);
  BLI_polyfill_calc(coords, coords.length, 0, tris);
  return tris;
};

assert.equal(unit.backend, 'js');
const js = polygons.map(triangulate);
await unit.use('wasm');
assert.equal(unit.backend, 'wasm');
const wasm = polygons.map(triangulate);
await unit.use('js');
polygons.forEach((coords, i) => assert.deepEqual(js[i], wasm[i], `polygon ${i} (${coords.length} corners)`));
assert.deepEqual(js[0], [[0, 4, 3], [3, 2, 1], [3, 1, 0]]);
console.log(`Polyfill units: JS port and Blender's WebAssembly build agree on ${polygons.length} polygons`);
