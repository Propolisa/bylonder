// Runtime of WebAssembly units and modules (tools/blender-port/wasm.py, wasm_module.py): Blender's own code, called
// with C-layout typed arrays. Each unit call copies its arguments into one grow-only scratch block of the module's
// memory and its outputs back out.

// Files Blender's code writes and reads (a .blend Blender's writer saves), by absolute path: the module's file system,
// in memory. JS puts files in and takes them out.
export const files = new Map();

// WASI errno values and file types (wasi_snapshot_preview1).
const ESUCCESS = 0, EBADF = 8, EEXIST = 20, EINVAL = 28, ENOENT = 44, ENOTDIR = 54;
const FILETYPE_DIRECTORY = 3, FILETYPE_REGULAR = 4;
const O_CREAT = 1, O_DIRECTORY = 2, O_EXCL = 4, O_TRUNC = 8;
// The one preopened directory, the root, as fd 3 (after stdin, stdout and stderr).
const ROOT = 3;

// WASI calls the module may import. Output on stdout and stderr (Blender's messages and logs) goes to stderr or the
// console; paths are files in `files` under the root directory, and every directory exists.
function wasiFor(memory) {
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  const write = (text) => (globalThis.process?.stderr ? process.stderr.write(text) : console.warn(text));
  const view = () => new DataView(memory().buffer);
  const string = (pointer, length) => decoder.decode(new Uint8Array(memory().buffer, pointer, length));
  const path = (pointer, length) => '/' + string(pointer, length).replace(/^\/+/, '');
  const isDirectory = (name) => name === '/' || [...files.keys()].some((file) => file.startsWith(name.replace(/\/?$/, '/')));
  // Open files and directories by fd: { path, position } or { directory }.
  const open = new Map([[ROOT, { directory: '/' }]]);
  let next = ROOT + 1;
  const iovecs = (iovs, count) => Array.from({ length: count }, (_, i) => [view().getUint32(iovs + i * 8, true), view().getUint32(iovs + i * 8 + 4, true)]);
  function filestat(at, name) {
    const v = view(), file = files.get(name);
    for (let i = 0; i < 64; i += 8) v.setBigUint64(at + i, 0n, true);
    v.setUint8(at + 16, file ? FILETYPE_REGULAR : FILETYPE_DIRECTORY);
    v.setBigUint64(at + 24, 1n, true);
    v.setBigUint64(at + 32, BigInt(file?.length ?? 0), true);
  }
  return new Proxy({
    proc_exit: (code) => { throw new Error(`WebAssembly exit ${code}`); },
    fd_prestat_get(fd, at) {
      if (fd !== ROOT) return EBADF;
      view().setUint32(at, 0, true);
      view().setUint32(at + 4, 1, true);
      return ESUCCESS;
    },
    fd_prestat_dir_name(fd, at, length) {
      new Uint8Array(memory().buffer, at, length).set(encoder.encode('/').subarray(0, length));
      return fd === ROOT ? ESUCCESS : EBADF;
    },
    path_open(_dir, _lookup, at, length, oflags, _rights, _inheriting, _fdflags, fdOut) {
      const name = path(at, length);
      if (oflags & O_DIRECTORY || (!files.has(name) && !(oflags & O_CREAT) && isDirectory(name))) {
        if (!isDirectory(name) && !(oflags & O_CREAT)) return ENOENT;
        open.set(next, { directory: name });
      } else {
        if (files.has(name) && oflags & O_EXCL) return EEXIST;
        if (!files.has(name) && !(oflags & O_CREAT)) return ENOENT;
        if (!files.has(name) || oflags & O_TRUNC) files.set(name, new Uint8Array(0));
        open.set(next, { path: name, position: 0 });
      }
      view().setUint32(fdOut, next++, true);
      return ESUCCESS;
    },
    fd_close: (fd) => (open.delete(fd) ? ESUCCESS : EBADF),
    fd_write(fd, iovs, count, nwritten) {
      const chunks = iovecs(iovs, count).map(([pointer, length]) => new Uint8Array(memory().buffer, pointer, length).slice());
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (fd === 1 || fd === 2) chunks.forEach((c) => write(decoder.decode(c)));
      else {
        const file = open.get(fd);
        if (!file?.path) return EBADF;
        const data = files.get(file.path), end = file.position + total;
        const grown = end > data.length ? new Uint8Array(Math.max(end, data.length * 2)) : data;
        if (grown !== data) grown.set(data);
        for (const c of chunks) { grown.set(c, file.position); file.position += c.length; }
        files.set(file.path, end > data.length ? grown.subarray(0, end) : grown);
      }
      view().setUint32(nwritten, total, true);
      return ESUCCESS;
    },
    fd_read(fd, iovs, count, nread) {
      const file = open.get(fd);
      if (!file?.path) return fd === 0 ? (view().setUint32(nread, 0, true), ESUCCESS) : EBADF;
      const data = files.get(file.path);
      let total = 0;
      for (const [pointer, length] of iovecs(iovs, count)) {
        const part = data.subarray(file.position, file.position + length);
        new Uint8Array(memory().buffer, pointer, part.length).set(part);
        file.position += part.length;
        total += part.length;
      }
      view().setUint32(nread, total, true);
      return ESUCCESS;
    },
    fd_seek(fd, offset, whence, at) {
      const file = open.get(fd);
      if (!file?.path) return fd < ROOT ? ESUCCESS : EBADF;
      const base = [0, file.position, files.get(file.path).length][whence];
      if (base === undefined) return EINVAL;
      file.position = Number(BigInt(base) + BigInt(offset));
      view().setBigUint64(at, BigInt(file.position), true);
      return ESUCCESS;
    },
    fd_tell(fd, at) { view().setBigUint64(at, BigInt(open.get(fd)?.position ?? 0), true); return ESUCCESS; },
    fd_fdstat_get(fd, at) {
      const v = view(), file = open.get(fd);
      for (let i = 0; i < 24; i += 8) v.setBigUint64(at + i, 0n, true);
      v.setUint8(at, file?.path ? FILETYPE_REGULAR : file ? FILETYPE_DIRECTORY : 2);
      v.setBigUint64(at + 8, ~0n & 0xffffffffffffffffn, true);
      v.setBigUint64(at + 16, ~0n & 0xffffffffffffffffn, true);
      return ESUCCESS;
    },
    fd_filestat_get(fd, at) {
      const file = open.get(fd);
      if (!file) return EBADF;
      filestat(at, file.path ?? file.directory);
      return ESUCCESS;
    },
    path_filestat_get(_dir, _flags, at, length, out) {
      const name = path(at, length);
      if (!files.has(name) && !isDirectory(name)) return ENOENT;
      filestat(out, name);
      return ESUCCESS;
    },
    path_rename(_dir, from, fromLength, _toDir, to, toLength) {
      const source = path(from, fromLength), target = path(to, toLength);
      if (!files.has(source)) return ENOENT;
      files.set(target, files.get(source));
      files.delete(source);
      return ESUCCESS;
    },
    path_unlink_file: (_dir, at, length) => (files.delete(path(at, length)) ? ESUCCESS : ENOENT),
    path_remove_directory: (_dir, at, length) => (isDirectory(path(at, length)) ? ENOTDIR : ESUCCESS),
  }, { get: (calls, name) => calls[name] ?? (() => 0) });
}

// What a module's own API files import from JS (IMPORT in region-draw.cc), by name. Any other import is a Blender
// symbol the module still lacks (tools/blender-port/wasm_module.py lists them): reaching one is a gap to port. With
// BLENDER_WASM_MISSING=log (Node), each gap is logged once and returns 0 instead, to list a path's gaps in one run.
export const provided = {};
const logMissing = globalThis.process?.env?.BLENDER_WASM_MISSING === 'log', logged = new Set();
const gap = (name) => {
  if (!logMissing) throw new Error(`Blender's ${name} is not in this WebAssembly module`);
  if (!logged.has(name)) process.stderr.write(`missing: ${name}\n`);
  logged.add(name);
  return 0;
};
const missing = new Proxy({}, { get: (_, name) => (...args) => (provided[name] ? provided[name](...args) : gap(name)) });

// Compiled modules by URL, compiled once per realm; a worker is given its creator's (provideModule) instead of
// compiling the bytes again.
const compiled = new Map();
const read = async (url) => (url.protocol === 'file:' ? process.getBuiltinModule('fs/promises').readFile(url) : (await fetch(url)).arrayBuffer());
export const compile = (url) => compiled.get(url.href) ?? compiled.set(url.href, read(url).then((bytes) => WebAssembly.compile(bytes))).get(url.href);
export const provideModule = (url, module) => compiled.set(url.href, Promise.resolve(module));

export async function instantiate(url) {
  let memory;
  const instance = await WebAssembly.instantiate(await compile(url), { wasi_snapshot_preview1: wasiFor(() => memory), env: missing });
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
