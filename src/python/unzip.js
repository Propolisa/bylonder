// A zip archive's files ([name, bytes]), stored or deflated, read from its central directory.
const inflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

export async function unzip(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  const files = [];
  for (let at = view.getUint32(end + 16, true), count = view.getUint16(end + 10, true); count--;) {
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true), nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true), name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), data = bytes.subarray(start, start + size);
    if (!name.endsWith('/')) files.push([name, method === 8 ? inflate(data) : data]);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return Promise.all(files.map(async ([name, data]) => [name, await data]));
}
