// A mesh's shape keys' coordinates as the module holds them, for the runtimes that read them (shape keys, armatures).
import { pointerOf } from '../python/bpy_rna.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';

// A key block's coordinates in the module's memory (KeyBlock.data, contiguous float[3] per vertex).
export const blockData = (kb, count) => (count ? new Float32Array(blenderModule.exports.memory.buffer, pointerOf(kb.data[0])[2], count * 3) : new Float32Array(0));
// A Mesh's vertex positions in the module's memory (Mesh.vertices, contiguous float[3] per vertex).
export const positions = (mesh) => blockData({ data: mesh.vertices }, mesh.vertices.length);
// The vertices a mesh's shape keys move from its reference key, by index.
export function keyedVertices(mesh) {
  const key = mesh.shape_keys, count = mesh.vertices.length, moved = new Set();
  if (!key) return moved;
  const reference = blockData(key.reference_key, count);
  for (const kb of key.key_blocks) {
    if (kb.data.length !== count) continue;
    const data = blockData(kb, count);
    for (let i = 0; i < data.length; i++) if (data[i] !== reference[i]) moved.add((i / 3) | 0);
  }
  return moved;
}
