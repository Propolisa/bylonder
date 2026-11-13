// A package's scene.bin: typed arrays one after another at 4-byte offsets, each named by its content (contentKey), with
// the views the runtime reads them by (runtime/buffers.js), gzipped unless the host compresses it (with Brotli, about
// half gzip's size). Measured on the examples, gzip of the raw arrays is as small as meshopt's lossless codecs or smaller,
// and keeps every value bit for bit.
import { gzipSync } from 'fflate';

const TYPES = new Map([[Float32Array, 'f32'], [Uint16Array, 'u16'], [Uint32Array, 'u32'], [Int32Array, 'i32'], [Uint8Array, 'u8'], [Int8Array, 'i8'], [Int16Array, 'i16']]);

// A typed array's name by its content: its type and two 32-bit hashes of its bytes (FNV-1a and a multiply-xorshift),
// so an entry that names it is the same text whenever its arrays are the same.
export function contentKey(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193);
    b = Math.imul(b ^ bytes[i], 0x5bd1e995);
    b ^= b >>> 15;
  }
  return `${TYPES.get(array.constructor)}.${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

export function createSceneBin({ gzip = true } = {}) {
  const arrays = [], views = {};
  let length = 0;
  return {
    views,
    // Adds a typed array, once for the same content, and gives its key in `views`.
    add(array) {
      const key = contentKey(array);
      if (views[key]) return key;
      views[key] = [length, array.length, TYPES.get(array.constructor)];
      arrays.push(array);
      length += Math.ceil(array.byteLength / 4) * 4;
      return key;
    },
    // The arrays by key.
    arrays: () => Object.fromEntries(Object.keys(views).map((key, i) => [key, arrays[i]])),
    bytes() {
      const out = new Uint8Array(length);
      Object.values(views).forEach(([offset], i) => out.set(new Uint8Array(arrays[i].buffer, arrays[i].byteOffset, arrays[i].byteLength), offset));
      return gzip ? gzipSync(out, { level: 9, mtime: 0 }) : out;
    },
  };
}
