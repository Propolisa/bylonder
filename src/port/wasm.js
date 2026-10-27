// Runtime of WebAssembly units and modules (tools/blender-port/wasm.py, wasm_module.py): Blender's own code, called
// with C-layout typed arrays. Each unit call copies its arguments into one grow-only scratch block of the module's
// memory and its outputs back out.

// WASI calls the module may import. Output (Blender's messages and logs) goes to stderr or the console; the rest of I/O
// does not happen, so those calls have no effect.
function wasiFor(memory) {
  const decoder = new TextDecoder();
  const write = (text) => (globalThis.process?.stderr ? process.stderr.write(text) : console.warn(text));
  return new Proxy({
    proc_exit: (code) => { throw new Error(`WebAssembly exit ${code}`); },
    fd_write(_fd, iovs, iovsLength, nwritten) {
      const view = new DataView(memory().buffer);
      let total = 0;
      for (let i = 0; i < iovsLength; i++) {
        const pointer = view.getUint32(iovs + i * 8, true), length = view.getUint32(iovs + i * 8 + 4, true);
        write(decoder.decode(new Uint8Array(memory().buffer, pointer, length)));
        total += length;
      }
      view.setUint32(nwritten, total, true);
      return 0;
    },
  }, { get: (calls, name) => calls[name] ?? (() => 0) });
}

// Blender symbols a module still lacks (tools/blender-port/wasm_module.py lists them): reaching one is a gap to port.
const missing = new Proxy({}, { get: (_, name) => () => { throw new Error(`Blender's ${name} is not in this WebAssembly module`); } });

export async function instantiate(url) {
  const bytes = url.protocol === 'file:' ? await process.getBuiltinModule('fs/promises').readFile(url) : await (await fetch(url)).arrayBuffer();
  let memory;
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasiFor(() => memory), env: missing });
  memory = instance.exports.memory;
  instance.exports._initialize?.();
  return new Heap(instance.exports);
}

// Bytes an argument takes in scratch, 8-aligned so every typed array view lines up.
export const size = (array) => (array.byteLength + 7) & ~7;

class Heap {
  constructor(exports) {
    this.exports = exports;
    this.scratch = 0;
    this.capacity = 0;
    this.top = 0;
    this.buffer = null;
    this.views = new Map();
  }

  // Starts a call needing `bytes` of scratch.
  reserve(bytes) {
    if (bytes > this.capacity) {
      if (this.scratch) this.exports.free(this.scratch);
      this.capacity = Math.max(bytes, this.capacity * 2);
      this.scratch = this.exports.malloc(this.capacity) >>> 0;
    }
    this.top = this.scratch;
  }

  // An input argument: copied in, its pointer returned.
  in(array) {
    const ptr = this.top;
    this.view(array.constructor).set(array, ptr / array.BYTES_PER_ELEMENT);
    this.top += size(array);
    return ptr;
  }

  // An output argument: space only.
  out(array) {
    const ptr = this.top;
    this.top += size(array);
    return ptr;
  }

  copyOut(array, ptr) {
    const start = ptr / array.BYTES_PER_ELEMENT;
    array.set(this.view(array.constructor).subarray(start, start + array.length));
  }

  // Views over the module's memory, made again only when the memory grew (its buffer is then a new one).
  view(Type) {
    const buffer = this.exports.memory.buffer;
    if (buffer !== this.buffer) {
      this.buffer = buffer;
      this.views.clear();
    }
    let view = this.views.get(Type);
    if (!view) this.views.set(Type, (view = new Type(buffer)));
    return view;
  }
}
