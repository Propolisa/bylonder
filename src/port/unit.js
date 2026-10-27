// Units: self-contained parts of Blender with interchangeable backends, the generated JS port or Blender's own C++
// built to WebAssembly (tools/blender-port). A unit module exports its API as live bindings; `use` rebinds them,
// so importers switch backends without reloading.
const units = new Map();

export function defineUnit(name, { js, url, wasm, bind }) {
  let loaded = null;
  const unit = {
    name,
    backend: 'js',
    async use(backend) {
      if (backend === 'wasm') {
        loaded ??= instantiate(url).then(wasm);
        bind(await loaded);
      } else if (backend === 'js') {
        bind(js);
      } else {
        throw new Error(`${name}: unknown backend ${backend}`);
      }
      unit.backend = backend;
      return unit;
    },
  };
  units.set(name, unit);
  return unit;
}

// Chooses backends by unit name, with '*' for the rest: useBackends({ '*': 'wasm' }).
export async function useBackends(choice) {
  await Promise.all([...units.values()].map((unit) => unit.use(choice[unit.name] ?? choice['*'] ?? unit.backend)));
}

export const listUnits = () => [...units.values()].map(({ name, backend }) => ({ name, backend }));

// WASI calls a reactor module may import; the ported code does no I/O, so none of them has an effect.
const wasi = new Proxy({}, { get: (_, name) => (name === 'proc_exit' ? (code) => { throw new Error(`WebAssembly exit ${code}`); } : () => 0) });

async function instantiate(url) {
  const bytes = url.protocol === 'file:' ? await readFile(url) : await (await fetch(url)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi });
  instance.exports._initialize?.();
  return new Heap(instance.exports);
}

async function readFile(url) {
  const fs = 'node:fs/promises';
  return (await import(/* @vite-ignore */ fs)).readFile(url);
}

// The module's memory, with frames of arguments copied in for one call and freed after it.
class Heap {
  constructor(exports) {
    this.exports = exports;
  }

  frame() {
    return new Frame(this);
  }

  view(Type, ptr, length) {
    return new Type(this.exports.memory.buffer, ptr, length);
  }
}

class Frame {
  constructor(heap) {
    this.heap = heap;
    this.pointers = [];
  }

  alloc(Type, length) {
    const ptr = this.heap.exports.malloc(Math.max(1, length) * Type.BYTES_PER_ELEMENT);
    this.pointers.push(ptr);
    return ptr;
  }

  // count rows of size numbers each, from JS arrays, as one C array T[count][size].
  rows(Type, size, rows, count) {
    const ptr = this.alloc(Type, count * size);
    const view = this.heap.view(Type, ptr, count * size);
    for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) view[i * size + k] = rows[i][k];
    return ptr;
  }

  rowsOut(Type, size, rows, count, ptr) {
    const view = this.heap.view(Type, ptr, count * size);
    for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) rows[i][k] = view[i * size + k];
  }

  end() {
    for (const ptr of this.pointers) this.heap.exports.free(ptr);
  }
}
