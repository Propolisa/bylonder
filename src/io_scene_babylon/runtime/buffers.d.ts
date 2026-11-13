/**
 * A file of the package, whole.
 * @param {URL} url
 */
export function readBytes(url: URL): Promise<Uint8Array<ArrayBuffer>>;
/**
 * Every view of the binary file at `url`, gzipped or not, by its key (its content's name).
 * @param {URL} url
 * @param {Record<string, BufferView>} views
 * @param {boolean} [gzip]
 * @returns {Promise<Buffers>}
 */
export function readBuffers(url: URL, views: Record<string, BufferView>, gzip?: boolean): Promise<Buffers>;
/**
 * scene.bin's buffers by key.
 */
export type Buffers = Record<string, ArrayBufferView>;
/**
 * One buffer of scene.bin: where its bytes start once inflated, how many values it has, and their type.
 */
export type BufferView = [byteOffset: number, length: number, type: keyof typeof TYPES];
declare namespace TYPES {
    let f32: Float32ArrayConstructor;
    let u16: Uint16ArrayConstructor;
    let u32: Uint32ArrayConstructor;
    let i32: Int32ArrayConstructor;
    let u8: Uint8ArrayConstructor;
    let i8: Int8ArrayConstructor;
    let i16: Int16ArrayConstructor;
}
export {};
