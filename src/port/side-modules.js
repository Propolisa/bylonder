// Side modules: WebAssembly dynamic linking (dylink.0), as Cycles is built (tools/blender-port/blender_build.py
// link_cycles): a position-independent module loaded into the Blender module's memory and function table, importing
// what it does not define from the module's exports. The page loads one (loadSideModule) and every thread's instance
// loads it too (syncSideModules), at the same memory and table places, as a pointer means the same in all of them.
// wasm/threads.cc keeps the list in the module's memory, where the threads read it: [instances that loaded one, then per
// module its bytes, their size, memory base, table base, thread-local blocks, one block's size, blocks taken].
const FIELDS = 7;

function memoryInfo(module) {
  const [section] = WebAssembly.Module.customSections(module, 'dylink.0');
  if (!section) throw Error('not a side module: no dylink.0 section');
  const bytes = new Uint8Array(section);
  let at = 0;
  const uleb = () => { let value = 0, shift = 0, byte; do { byte = bytes[at++]; value += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80); return value; };
  while (at < bytes.length) {
    const type = bytes[at++], end = uleb() + at;
    if (type === 1) return { memorySize: uleb(), memoryAlign: 2 ** uleb(), tableSize: uleb() };
    at = end;
  }
  throw Error('side module without its memory info');
}

const aligned = (pointer, alignment) => (pointer + alignment - 1) & -alignment;

// Instantiates a side module in one instance of the Blender module (`main`, its exports), with `missing` for the
// functions nothing defines (they throw when called). The first instance (the page's) applies its data relocations and
// runs its constructors; each other one gives it thread-locals of its own (`tls`, from the page: a thread may look for
// side modules while it waits for the allocator's lock).
function link(module, main, { memoryBase, tableBase }, first, missing, tls) {
  const info = memoryInfo(module), table = main.__indirect_function_table;
  const imports = WebAssembly.Module.imports(module);
  const gotFunctions = imports.filter((i) => i.module === 'GOT.func').map((i) => i.name);
  const end = tableBase + info.tableSize + gotFunctions.length;
  if (table.length < end) table.grow(end - table.length);
  // Each address and function index it asks for (its GOT), from the module's exports, else from its own once instantiated.
  const got = { mem: {}, func: {} };
  const entry = (kind, name) => (got[kind][name] ??= new WebAssembly.Global({ value: 'i32', mutable: true }, 0));
  const slot = (name) => tableBase + info.tableSize + gotFunctions.indexOf(name);
  const resolve = (exports, base) => {
    for (const [name, global] of Object.entries(got.mem)) if (!global.value && exports[name] instanceof WebAssembly.Global) global.value = exports[name].value + base;
    for (const [name, global] of Object.entries(got.func)) {
      if (global.value || typeof exports[name] !== 'function') continue;
      table.set(slot(name), exports[name]);
      global.value = slot(name);
    }
  };
  const fixed = {
    memory: main.memory, __indirect_function_table: table, __stack_pointer: main.__stack_pointer,
    __memory_base: new WebAssembly.Global({ value: 'i32' }, memoryBase), __table_base: new WebAssembly.Global({ value: 'i32' }, tableBase),
  };
  const instance = new WebAssembly.Instance(module, {
    env: new Proxy({}, { get: (_, name) => fixed[name] ?? (typeof main[name] === 'function' ? main[name] : missing[name]) }),
    'GOT.mem': new Proxy({}, { get: (_, name) => entry('mem', name) }),
    'GOT.func': new Proxy({}, { get: (_, name) => entry('func', name) }),
  });
  resolve(main, 0);
  resolve(instance.exports, memoryBase);
  const unresolved = Object.keys(got.mem).filter((name) => !got.mem[name].value);
  if (unresolved.length) throw Error(`side module: no address for ${unresolved.slice(0, 5).join(', ')}`);
  if (first) {
    instance.exports.__wasm_apply_data_relocs?.();
    instance.exports.__wasm_call_ctors?.();
  } else if (instance.exports.__tls_size?.value) {
    instance.exports.__wasm_init_tls(tls);
  }
  return instance;
}

const list = (main) => new Int32Array(main.memory.buffer, main.side_modules_list() >>> 0, 1 + FIELDS * 8);

// The side module at `bytes` loaded into the page's instance (main: its exports) and, through the module's memory, into
// every thread's (`threads` instances besides the page's), resolved once they all have it. Its instance's exports.
export async function loadSideModule(main, bytes, missing, threads = 1) {
  const module = await WebAssembly.compile(bytes);
  const info = memoryInfo(module);
  const memoryBase = aligned(main.malloc(info.memorySize + info.memoryAlign) >>> 0, info.memoryAlign);
  const place = { memoryBase, tableBase: main.__indirect_function_table.length };
  const instance = link(module, main, place, true, missing);
  if (threads > 1) {
    const copy = main.malloc(bytes.byteLength) >>> 0;
    new Uint8Array(main.memory.buffer, copy >>> 0, bytes.byteLength).set(new Uint8Array(bytes));
    const generation = new Int32Array(main.memory.buffer, main.side_modules_generation() >>> 0, 1);
    const at = 1 + FIELDS * Atomics.load(generation, 0);
    const { __tls_size: size, __tls_align: align } = instance.exports, stride = aligned(size?.value ?? 0, align?.value ?? 1);
    const blocks = stride ? aligned(main.malloc(stride * (threads - 1) + align.value) >>> 0, align.value) : 0;
    list(main).set([copy, bytes.byteLength, place.memoryBase, place.tableBase, blocks, stride, 0], at);
    const loaded = Atomics.add(generation, 0, 1) + 1;
    // Each thread loads it at its next wait or start (at most wasm/threads.cc's slice later).
    while (Atomics.load(list(main), 0) < (threads - 1) * loaded) await new Promise((done) => setTimeout(done, 20));
    main.free(copy);
  }
  return instance.exports;
}

// A thread's instance (main: its exports) loads the side modules the page loaded since it last looked; `loaded` counts
// what it has, per instance.
const loadedBy = new WeakMap();
export function syncSideModules(main, missing) {
  if (!main.side_modules_generation) return;
  const generation = Atomics.load(new Int32Array(main.memory.buffer, main.side_modules_generation() >>> 0, 1), 0);
  for (let index = loadedBy.get(main) ?? 0; index < generation; index++) {
    const at = 1 + FIELDS * index;
    const [bytes, size, memoryBase, tableBase, blocks, stride] = list(main).slice(at, at + FIELDS);
    const tls = (blocks >>> 0) + stride * Atomics.add(list(main), at + 6, 1);
    const module = new WebAssembly.Module(new Uint8Array(main.memory.buffer, bytes >>> 0, size).slice());
    link(module, main, { memoryBase: memoryBase >>> 0, tableBase }, false, missing, tls);
    loadedBy.set(main, index + 1);
    Atomics.add(list(main), 0, 1);
  }
}
