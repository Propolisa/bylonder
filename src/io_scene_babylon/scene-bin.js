// A package's scene.bin: typed arrays one after another at 4-byte offsets, with the views the runtime reads them by
// (runtime/buffers.js), gzipped unless the host compresses it (with Brotli, about half gzip's size). Measured on the
// examples, gzip of the raw arrays is as small as meshopt's lossless codecs or smaller, and keeps every value bit for bit.
import { gzipSync } from 'fflate';

const TYPES = new Map([[Float32Array, 'f32'], [Uint16Array, 'u16'], [Uint32Array, 'u32'], [Int32Array, 'i32']]);

export function createSceneBin({ gzip = true } = {}) {
  const arrays = [], views = [];
  let length = 0;
  return {
    views,
    // Adds a typed array, and gives its index in `views`.
    add(array) {
      views.push([length, array.length, TYPES.get(array.constructor)]);
      arrays.push(array);
      length += Math.ceil(array.byteLength / 4) * 4;
      return views.length - 1;
    },
    bytes() {
      const out = new Uint8Array(length);
      arrays.forEach((array, i) => out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), views[i][0]));
      return gzip ? gzipSync(out, { level: 9 }) : out;
    },
  };
}
