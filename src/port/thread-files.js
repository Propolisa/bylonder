// The module's threads use the page's file system, as a process's threads share its files: a thread's WASI calls on
// files are made by the page's thread (serveFiles), on the same shared memory, where the call's pointers mean the same.
// Each thread has a slot in a SharedArrayBuffer (its state, the call, its result, how many arguments and which are
// 64-bit, then the arguments); the buffer's first Int32 counts the calls waiting. The page answers when a thread's
// message reaches it, while it waits for another thread (wasm/threads.cc) and each time it handles its window
// (wasm/wm-api.cc), so a window-manager job that reads files on a thread goes on while the page is busy.
const FILE_CALLS = ['path_open', 'fd_close', 'fd_readdir', 'fd_write', 'fd_pwrite', 'fd_read', 'fd_pread', 'fd_seek', 'fd_tell',
  'fd_fdstat_get', 'fd_fdstat_set_flags', 'fd_filestat_get', 'fd_filestat_set_size', 'fd_prestat_get', 'fd_prestat_dir_name',
  'path_filestat_get', 'path_rename', 'path_unlink_file', 'path_create_directory', 'path_remove_directory', 'path_readlink'];
const IDLE = 0, CALLED = 1, ANSWERED = 2;
// Five Int32s of header, the arguments as BigInt64s 8-aligned after them, and one Int32 to keep the next slot aligned.
const HEADER = 5, ARGS = 10, SLOT = HEADER + 2 * ARGS + 1;
const STDOUT = 1, STDERR = 2;

export const filesBuffer = (threads) => new SharedArrayBuffer(4 * (1 + SLOT * threads));

// A thread's WASI in slot `slot`: `own`'s calls, but those on files wait for the page's answer; `notify` tells the page
// that a call waits.
export function threadFiles(buffer, slot, own, notify) {
  const state = new Int32Array(buffer), base = 1 + slot * SLOT;
  const args = new BigInt64Array(buffer, 4 * (base + HEADER), ARGS);
  const forwarded = (call) => (...values) => {
    if (call === FILE_CALLS.indexOf('fd_write') && (values[0] === STDOUT || values[0] === STDERR)) return own.fd_write(...values);
    state[base + 1] = call;
    state[base + 3] = values.length;
    state[base + 4] = values.reduce((mask, value, i) => (typeof value === 'bigint' ? mask | (1 << i) : mask), 0);
    values.forEach((value, i) => { args[i] = BigInt(value); });
    Atomics.add(state, 0, 1);
    Atomics.store(state, base, CALLED);
    notify();
    while (Atomics.load(state, base) !== ANSWERED) Atomics.wait(state, base, CALLED);
    Atomics.store(state, base, IDLE);
    return state[base + 2];
  };
  const calls = Object.fromEntries(FILE_CALLS.map((name, i) => [name, forwarded(i)]));
  return new Proxy({}, { get: (_, name) => calls[name] ?? own[name] });
}

// Makes the file calls threads wait on, with the page's WASI.
export function serveFiles(buffer, wasi) {
  const state = new Int32Array(buffer);
  if (!Atomics.load(state, 0)) return;
  for (let base = 1; base < state.length; base += SLOT) {
    if (Atomics.load(state, base) !== CALLED) continue;
    const args = new BigInt64Array(buffer, 4 * (base + HEADER), ARGS), mask = state[base + 4];
    const values = Array.from({ length: state[base + 3] }, (_, i) => (mask & (1 << i) ? args[i] : Number(args[i])));
    state[base + 2] = wasi[FILE_CALLS[state[base + 1]]](...values);
    Atomics.sub(state, 0, 1);
    Atomics.store(state, base, ANSWERED);
    Atomics.notify(state, base);
  }
}
