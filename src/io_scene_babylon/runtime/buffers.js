// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The package's binary buffers: scene.bin is every vertex, index and key buffer as little-endian typed arrays, one after
// another at 4-byte offsets, gzipped unless the host compresses it; the platform's DecompressionStream inflates it in the
// browser and in Node alike.

/**
 * One buffer of scene.bin: where its bytes start once inflated, how many values it has, and their type.
 * @typedef {[byteOffset: number, length: number, type: 'f32' | 'u16' | 'u32']} BufferView
 */

/**
 * A URL's body, through fetch, or the file system for a file: URL in Node, whose fetch does not read files.
 * @param {URL} url
 * @returns {Promise<ReadableStream<Uint8Array>>}
 */
async function bodyOf(url) {
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    return new Blob([await readFile(url)]).stream();
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url.href}: ${response.status} ${response.statusText}`);
  return response.body;
}

/**
 * Every view of the binary file at `url`, gzipped or not.
 * @param {URL} url
 * @param {BufferView[]} views
 * @param {boolean} [gzip]
 * @returns {Promise<(Float32Array | Uint16Array | Uint32Array)[]>}
 */
export async function readBuffers(url, views, gzip = true) {
  const body = await bodyOf(url);
  const inflated = await new Response(gzip ? body.pipeThrough(new DecompressionStream('gzip')) : body).arrayBuffer();
  return views.map(([offset, length, type]) => (type === 'f32' ? new Float32Array(inflated, offset, length)
    : type === 'u16' ? new Uint16Array(inflated, offset, length) : new Uint32Array(inflated, offset, length)));
}
