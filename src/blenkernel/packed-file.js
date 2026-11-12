// An ID's file as Blender holds it (an Image's, a Sound's): its packed file's bytes (DNA PackedFile: int size, int seek,
// void *data, the size checked against RNA's), else the file at its path in the module's file system (`//` the
// project's folder).
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { pointerOf } from '../python/bpy_rna.js';
import { files } from '../port/wasm.js';

export function fileBytes(id) {
  const packed = id.packed_file, x = blenderModule.exports;
  if (packed) {
    const [size, , data] = new Int32Array(x.memory.buffer, pointerOf(packed)[2] >>> 0, 3);
    return size === packed.size ? new Uint8Array(x.memory.buffer, data >>> 0, size).slice() : null;
  }
  return files.get(id.filepath_from_user?.() ?? id.filepath.replace(/^\/\//, '/')) ?? null;
}
