// Corner triangles of a 100k-face mesh: Blender's corner_tris_calc in WebAssembly, with the copy in and out timed apart
// from the call. usage: node bench/tessellate.bench.js [js-module-to-compare]
import { corner_tris_calc } from '../src/blenkernel/mesh/mesh-tessellate.js';
import { instantiate, size } from '../src/port/wasm.js';

// A grid of n x n quads, lifted so quads are not planar; ngon = every face joins two quads (hexagons).
function grid(n, ngon) {
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  for (let y = 0, i = 0; y <= n; y++) for (let x = 0; x <= n; x++, i += 3) positions.set([x, y, Math.sin(x * 0.7) * Math.cos(y * 1.3) * 0.3], i);
  const offsets = [0], corners = [];
  const v = (x, y) => y * (n + 1) + x;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x += ngon ? 2 : 1) {
    corners.push(...(ngon ? [v(x, y), v(x + 1, y), v(x + 2, y), v(x + 2, y + 1), v(x + 1, y + 1), v(x, y + 1)] : [v(x, y), v(x + 1, y), v(x + 1, y + 1), v(x, y + 1)]));
    offsets.push(corners.length);
  }
  return { vert_positions: positions, face_offsets: Int32Array.from(offsets), corner_verts: Int32Array.from(corners), faces_num: offsets.length - 1, corners_num: corners.length };
}

const time = (fn, runs = 20) => {
  fn();
  const t = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - t) / runs;
};

const heap = await instantiate(new URL('../src/blenkernel/mesh/mesh-tessellate.wasm', import.meta.url));
const other = process.argv[2] && (await import(process.argv[2]));
for (const [name, mesh] of [['quads', grid(316, false)], ['hexagons', grid(632, true)]]) {
  const tris = new Int32Array((mesh.corners_num - 2 * mesh.faces_num) * 3);
  const { vert_positions: p, face_offsets: f, corner_verts: c } = mesh;
  const total = time(() => corner_tris_calc(p, f, c, tris));
  heap.reserve(size(p) + size(f) + size(c) + size(tris));
  const pointers = [heap.in(p), heap.in(f), heap.in(c), heap.out(tris)];
  const compute = time(() => heap.exports.corner_tris_calc(pointers[0], p.length, pointers[1], f.length, pointers[2], c.length, pointers[3], tris.length));
  const copy = time(() => { heap.reserve(size(p) + size(f) + size(c) + size(tris)); heap.in(p); heap.in(f); heap.in(c); heap.copyOut(tris, heap.out(tris)); });
  const js = other ? `, JS ${time(() => other.mesh_corner_tris_calc(mesh)).toFixed(2)} ms` : '';
  console.log(`${name}: ${mesh.faces_num} faces, WASM ${total.toFixed(2)} ms (compute ${compute.toFixed(2)}, copy ${copy.toFixed(2)})${js}`);
}
