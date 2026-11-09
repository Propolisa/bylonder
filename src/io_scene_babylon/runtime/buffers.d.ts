/**
 * A file of the package, whole.
 * @param {URL} url
 */
export function readBytes(url: URL): Promise<Uint8Array<ArrayBuffer>>;
/**
 * Every view of the binary file at `url`, gzipped or not.
 * @param {URL} url
 * @param {BufferView[]} views
 * @param {boolean} [gzip]
 * @returns {Promise<(Float32Array | Uint16Array | Uint32Array)[]>}
 */
export function readBuffers(url: URL, views: BufferView[], gzip?: boolean): Promise<(Float32Array | Uint16Array | Uint32Array)[]>;
/**
 * One buffer of scene.bin: where its bytes start once inflated, how many values it has, and their type.
 */
export type BufferView = [byteOffset: number, length: number, type: "f32" | "u16" | "u32"];
