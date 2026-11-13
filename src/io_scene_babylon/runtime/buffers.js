// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The package's binary buffers: scene.bin is every vertex, index and key buffer as little-endian typed arrays, one after
// another at 4-byte offsets, gzipped unless the host compresses it; the platform's DecompressionStream inflates it in the
// browser and in Node alike.

/** scene.bin's array types, by the name its views give. */
const TYPES = { f32: Float32Array, u16: Uint16Array, u32: Uint32Array, i32: Int32Array, u8: Uint8Array, i8: Int8Array, i16: Int16Array };

/**
 * scene.bin's buffers by key.
 * @typedef {Record<string, ArrayBufferView>} Buffers
 */

/**
 * One buffer of scene.bin: where its bytes start once inflated, how many values it has, and their type.
 * @typedef {[byteOffset: number, length: number, type: keyof typeof TYPES]} BufferView
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
 * A file of the package, whole.
 * @param {URL} url
 */
export async function readBytes(url) {
  return new Uint8Array(await new Response(await bodyOf(url)).arrayBuffer());
}

/**
 * Every view of the binary file at `url`, gzipped or not, by its key (its content's name).
 * @param {URL} url
 * @param {Record<string, BufferView>} views
 * @param {boolean} [gzip]
 * @returns {Promise<Buffers>}
 */
export async function readBuffers(url, views, gzip = true) {
  const body = await bodyOf(url);
  const inflated = await new Response(gzip ? body.pipeThrough(new DecompressionStream('gzip')) : body).arrayBuffer();
  return Object.fromEntries(Object.entries(views).map(([key, [offset, length, type]]) => [key, new (/** @type {Float32ArrayConstructor} */ (TYPES[type]))(inflated, offset, length)]));
}
