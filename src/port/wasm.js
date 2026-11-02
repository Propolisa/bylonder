// Runtime of WebAssembly units and modules (tools/blender-port/wasm.py, wasm_module.py): Blender's own code, called
// with C-layout typed arrays. Each unit call copies its arguments into one grow-only scratch block of the module's
// memory and its outputs back out.

// Files Blender's code writes and reads (a .blend Blender's writer saves), by absolute path: the module's file system,
// in memory. JS puts files in and takes them out.
export const files = new Map();
// Directories made (path_create_directory) that may hold no file yet; any other directory is one that holds files.
const directories = new Set();

// WASI errno values and file types (wasi_snapshot_preview1).
const ESUCCESS = 0, EBADF = 8, EEXIST = 20, EINVAL = 28, ENOENT = 44, ENOSYS = 52, ENOTDIR = 54, ENOTEMPTY = 55;
const FILETYPE_DIRECTORY = 3, FILETYPE_REGULAR = 4;
const O_CREAT = 1, O_DIRECTORY = 2, O_EXCL = 4, O_TRUNC = 8;
// The one preopened directory, the root, as fd 3 (after stdin, stdout and stderr).
const ROOT = 3;

// WASI calls the module may import. Output on stdout and stderr (Blender's messages and logs) goes to stderr or the
// console; paths are files in `files` under the root directory, and a directory is one that holds files or was made.
function wasiFor(memory) {
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  const write = (text) => (globalThis.process?.stderr ? process.stderr.write(text) : console.warn(text));
  const view = () => new DataView(memory().buffer);
  const string = (pointer, length) => decoder.decode(new Uint8Array(memory().buffer, pointer, length));
  // A path as WASI gives one, relative to a directory fd (the root's, or one opened), as the file system's absolute path.
  const path = (pointer, length, dir = ROOT) => {
    const name = string(pointer, length);
    const base = dir === ROOT || name.startsWith('/') ? '/' : open.get(dir)?.directory?.replace(/\/?$/, '/') ?? '/';
    return base + name.replace(/^\/+/, '');
  };
  const paths = function* () { yield* files.keys(); yield* directories; };
  const holds = (name) => paths().some((file) => file.startsWith(name.replace(/\/?$/, '/')));
  const isDirectory = (name) => name === '/' || directories.has(name.replace(/\/$/, '')) || holds(name);
  // Open files and directories by fd: { path, position } or { directory }.
  const open = new Map([[ROOT, { directory: '/' }]]);
  let next = ROOT + 1;
  const iovecs = (iovs, count) => Array.from({ length: count }, (_, i) => [view().getUint32(iovs + i * 8, true), view().getUint32(iovs + i * 8 + 4, true)]);
  // A file's bytes from a position into the iovecs, or from them into the file (which grows), as fd_read and fd_write
  // do at the file's position and fd_pread and fd_pwrite at an offset; writes the count and returns it.
  function readAt(file, iovs, count, position, out) {
    const data = files.get(file.path);
    let total = 0;
    for (const [pointer, length] of iovecs(iovs, count)) {
      const part = data.subarray(position + total, position + total + length);
      new Uint8Array(memory().buffer, pointer, part.length).set(part);
      total += part.length;
    }
    view().setUint32(out, total, true);
    return total;
  }
  function writeAt(file, iovs, count, position, out) {
    const chunks = iovecs(iovs, count).map(([pointer, length]) => new Uint8Array(memory().buffer, pointer, length).slice());
    const total = chunks.reduce((n, c) => n + c.length, 0), data = files.get(file.path), end = position + total;
    const grown = end > data.length ? new Uint8Array(Math.max(end, data.length * 2)) : data;
    if (grown !== data) grown.set(data);
    let at = position;
    for (const c of chunks) { grown.set(c, at); at += c.length; }
    files.set(file.path, end > data.length ? grown.subarray(0, end) : grown);
    view().setUint32(out, total, true);
    return total;
  }
  // A file's or directory's inode, distinct per path, so a path compares with another as the same file only when it is
  // (os.path.samefile).
  const inodes = new Map();
  const inode = (name) => inodes.get(name) ?? inodes.set(name, BigInt(inodes.size + 1)).get(name);
  function filestat(at, name) {
    const v = view(), file = files.get(name);
    for (let i = 0; i < 64; i += 8) v.setBigUint64(at + i, 0n, true);
    v.setBigUint64(at + 8, inode(name.replace(/\/$/, '') || '/'), true);
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
    path_open(dir, _lookup, at, length, oflags, _rights, _inheriting, _fdflags, fdOut) {
      const name = path(at, length, dir);
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
    // A directory's entries from the cookie on, as dirents (next cookie, inode, name length, type, then the name), the
    // last one cut off where the buffer ends, as WASI's readdir fills it.
    fd_readdir(fd, buf, length, cookie, bufused) {
      const directory = open.get(fd)?.directory;
      if (directory === undefined) return EBADF;
      const prefix = directory.replace(/\/?$/, '/');
      const entries = [...new Map(paths().filter((file) => file.startsWith(prefix)).map((file) => {
        const [name, ...rest] = file.slice(prefix.length).split('/');
        return [name, rest.length || directories.has(file) ? FILETYPE_DIRECTORY : FILETYPE_REGULAR];
      }))];
      let used = 0;
      for (let i = Number(cookie); i < entries.length && used < length; i++) {
        const [name, type] = entries[i], encoded = encoder.encode(name), record = new Uint8Array(24 + encoded.length), v = new DataView(record.buffer);
        v.setBigUint64(0, BigInt(i + 1), true);
        v.setBigUint64(8, BigInt(i + 1), true);
        v.setUint32(16, encoded.length, true);
        v.setUint8(20, type);
        record.set(encoded, 24);
        const part = record.subarray(0, Math.min(record.length, length - used));
        new Uint8Array(memory().buffer, buf + used, part.length).set(part);
        used += part.length;
      }
      view().setUint32(bufused, used, true);
      return ESUCCESS;
    },
    // Nanoseconds: the realtime clock (0) from the epoch, the others from the page's start (BLI_time_now_seconds).
    clock_time_get(id, _precision, out) {
      const ms = id === 0 ? Date.now() : performance.timeOrigin + performance.now();
      view().setBigUint64(out, BigInt(Math.round(ms * 1e6)), true);
      return ESUCCESS;
    },
    fd_write(fd, iovs, count, nwritten) {
      if (fd === 1 || fd === 2) {
        const chunks = iovecs(iovs, count).map(([pointer, length]) => new Uint8Array(memory().buffer, pointer, length));
        chunks.forEach((c) => write(decoder.decode(c)));
        view().setUint32(nwritten, chunks.reduce((n, c) => n + c.length, 0), true);
        return ESUCCESS;
      }
      const file = open.get(fd);
      if (!file?.path) return EBADF;
      file.position += writeAt(file, iovs, count, file.position, nwritten);
      return ESUCCESS;
    },
    fd_pwrite(fd, iovs, count, offset, nwritten) {
      const file = open.get(fd);
      if (!file?.path) return EBADF;
      writeAt(file, iovs, count, Number(offset), nwritten);
      return ESUCCESS;
    },
    fd_read(fd, iovs, count, nread) {
      const file = open.get(fd);
      if (!file?.path) return fd === 0 ? (view().setUint32(nread, 0, true), ESUCCESS) : EBADF;
      file.position += readAt(file, iovs, count, file.position, nread);
      return ESUCCESS;
    },
    fd_pread(fd, iovs, count, offset, nread) {
      const file = open.get(fd);
      if (!file?.path) return EBADF;
      readAt(file, iovs, count, Number(offset), nread);
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
    path_filestat_get(dir, _flags, at, length, out) {
      const name = path(at, length, dir);
      if (!files.has(name) && !isDirectory(name)) return ENOENT;
      filestat(out, name);
      return ESUCCESS;
    },
    path_rename(dir, from, fromLength, toDir, to, toLength) {
      const source = path(from, fromLength, dir).replace(/\/$/, ''), target = path(to, toLength, toDir).replace(/\/$/, '');
      if (files.has(source)) return files.set(target, files.get(source)), files.delete(source), ESUCCESS;
      if (!isDirectory(source)) return ENOENT;
      // A directory: everything under it moves.
      const moved = (name) => target + name.slice(source.length);
      for (const name of [...files.keys()].filter((name) => name.startsWith(source + '/'))) files.set(moved(name), files.get(name)), files.delete(name);
      for (const name of [...directories].filter((name) => name === source || name.startsWith(source + '/'))) directories.add(moved(name)), directories.delete(name);
      return ESUCCESS;
    },
    path_unlink_file: (dir, at, length) => (files.delete(path(at, length, dir)) ? ESUCCESS : ENOENT),
    path_create_directory(dir, at, length) {
      const name = path(at, length, dir).replace(/\/$/, '');
      if (files.has(name) || isDirectory(name)) return EEXIST;
      directories.add(name);
      return ESUCCESS;
    },
    path_remove_directory(dir, at, length) {
      const name = path(at, length, dir).replace(/\/$/, '');
      if (!isDirectory(name)) return files.has(name) ? ENOTDIR : ENOENT;
      if (holds(name)) return ENOTEMPTY;
      directories.delete(name);
      return ESUCCESS;
    },
    // No file is a link.
    path_readlink: () => EINVAL,
    fd_filestat_set_size(fd, size) {
      const file = open.get(fd);
      if (!file?.path) return EBADF;
      const sized = new Uint8Array(Number(size));
      sized.set(files.get(file.path).subarray(0, sized.length));
      files.set(file.path, sized);
      return ESUCCESS;
    },
    clock_res_get: (_id, out) => { view().setBigUint64(out, 1000n, true); return ESUCCESS; },
    // No arguments and no environment variables.
    args_sizes_get(count, size) { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return ESUCCESS; },
    args_get: () => ESUCCESS,
    environ_sizes_get(count, size) { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return ESUCCESS; },
    environ_get: () => ESUCCESS,
    fd_fdstat_set_flags: (fd) => (open.has(fd) || fd < ROOT ? ESUCCESS : EBADF),
    random_get(at, length) {
      for (let i = 0; i < length; i += 65536) crypto.getRandomValues(new Uint8Array(memory().buffer, at + i, Math.min(65536, length - i)));
      return ESUCCESS;
    },
    // One thread cannot wait for another: each subscription (a sleep's clock) is answered at once, as elapsed.
    poll_oneoff(subscriptions, events, count, nevents) {
      const v = view();
      for (let i = 0; i < count; i++) {
        const event = events + i * 32;
        for (let b = 0; b < 32; b += 8) v.setBigUint64(event + b, 0n, true);
        v.setBigUint64(event, v.getBigUint64(subscriptions + i * 48, true), true);
        v.setUint8(event + 10, v.getUint8(subscriptions + i * 48 + 8));
      }
      v.setUint32(nevents, count, true);
      return ESUCCESS;
    },
  }, { get: (calls, name) => calls[name] ?? ((...args) => { console.error(`WASI ${name} is not implemented`, args); return ENOSYS; }) });
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
export async function read(url) {
  if (url.protocol === 'file:') return process.getBuiltinModule('fs/promises').readFile(url);
  const response = await fetch(url);
  if (!response.ok) throw Error(`${url}: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}
export const compile = (url) => compiled.get(url.href) ?? compiled.set(url.href, read(url).then((bytes) => WebAssembly.compile(bytes))).get(url.href);
export const provideModule = (url, module) => compiled.set(url.href, Promise.resolve(module));

export async function instantiate(url) {
  let memory;
  const instance = await WebAssembly.instantiate(await compile(url), { wasi_snapshot_preview1: wasiFor(() => memory), env: missing });
  memory = instance.exports.memory;
  instance.exports._initialize?.();
  instance.exports.blender_init?.();
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
