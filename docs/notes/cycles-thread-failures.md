# Cycles thread failures

Long Cycles bakes in the module fail now and then: a thread of Blender's traps with `RuntimeError: memory access out of
bounds` (once `table index is out of bounds`) inside the allocator, and the page then either reports it ("A thread of
Blender's stopped") or spins forever behind a lock the dead thread held. Found while building Bake Lightmaps (branch
`bake-lightmaps`, `src/render/bake-lightmaps.js`), which was parked until this was fixed. It was not specific to
bakes: long F12 renders run the same threaded Cycles code.

## Cause (fixed)

The module's `__cxa_thread_atexit` was a no-op (`tools/blender-port/wasm/platform.cc`), so a thread's `thread_local`
destructors never ran when it ended. Blender's allocator counts memory per thread (`intern/guardedalloc/intern/
memory_usage.cc`): each thread's `thread_local Local` registers itself in a global list and its destructor removes it.
Threads that end (window-manager jobs such as the bake, Cycles' session thread) left their `Local` in the list after
their block (stack and thread-locals, one malloc block) was freed, and `update_global_peak`, run whenever a thread has
allocated 1 MiB more since the last update, writes `mem_in_use_during_peak_update` into every listed `Local`: 8 bytes
into freed memory, which lands on dlmalloc's free-list links and traps at the next malloc or free near them. This
explains every row below: a write after free, more threads more failures, failures after big images (large
allocations update the peak), and none with the guarded allocator (it does not use these counters).

The fix gives `__cxa_thread_atexit` its real behaviour (a per-thread list run by a pthread key's destructor at thread
exit, as libc++abi's fallback does); `tests/threads-wasm.test.js` checks that a thread's `thread_local` destructor
runs when it ends. With it, the six objects as jobs at 8 threads baked through 6 of 6 runs (about 4 minutes each),
where the same module without it trapped (at the figure) the same day.

The page spinning forever is a consequence: dlmalloc's lock is a spin lock (`sched_yield`), not a futex wait, so a
page waiting on it never reads the threads-died word when a worker trapped holding it. The file calls served by the
page (`src/port/thread-files.js`) were ruled out: the page's WASI never allocates in the module, and dlmalloc's spin
never serves them.

## Symptom

Every trap stack seen ends in the main module's allocator, called from Cycles (`cycles.wasm`, which has no name
section), symbolized with the CI module's `bmesh-names.wasm` (module-66b107b8...):

```
dlmalloc < internal_memalign < aligned_alloc < aligned_malloc < MEM_lockfree_mallocN_aligned < MEM_new_uninitialized_aligned < cycles.wasm
dlfree < free < MEM_lockfree_freeN < MEM_delete_void < cycles.wasm
```

So the allocator's own state was overwritten earlier by someone; the trap only shows where it is next touched. A trap
on a worker can also leave the page spinning (one core busy, the workers idle, no report) when the page waits on a lock
or a spin loop rather than a futex wait: the threads-died word is only read by the futex waits (`wasm/threads.cc`) and,
since this work, by the polling loops (`checkThreads` in `src/port/wasm.js`).

## Results

All in Node on the CI module (main `dfd2d4f6`, then `839a09a2`), baking Meditation (`examples/meditation`) through
Bake Lightmaps' code, 64 samples unless noted. Six objects: Room 2048 px, Turtle 1024, Cushion 256, Bench 256, Bowl 128,
Mannequin 512 (4 bake steps, the others 2).

| What | Threads | Path | Runs | Failed |
|---|---|---|---|---|
| Room only | 8 | job | 3 | 2 traps |
| Room only, interface locked during the job | 8 | job | 4 | 0 |
| Room only, no window tick during the job | 8 | job | 2 | 0 (a third inconclusive) |
| Room only, Blender's guarded allocator (snapshot taken with it) | 8 | job | 3 | 0, no overrun reported |
| Room only | 8 | exec | 3 | 0 |
| Room at 512 and at 1024 px | 8 | job | 2 + 2 | 0 |
| Figure x30, 16 samples | 8 | job | 1 | 0 (120 job threads) |
| Figure x12 | 8 | job | 1 | 0 |
| Turtle, Cushion, Bench, Bowl, Figure, interface locked | 8 | job | 1 | 1 trap (figure's albedo step) |
| Six objects, window ticks every 50 ms | 8 | job | 3 | 2 traps (figure, after the room and turtle) |
| Six objects, window ticks every 5 s | 8 | job | 1 | 1 trap |
| Six objects | 8 | exec | 3 | 1 (spun forever, likely a trap) |
| Six objects | 4 | job | 3 | 1 trap (turtle) |
| Six objects | 2 | job | 2 | 0 (a third run invalid: the module was rebuilt under it) |
| Six objects, oneTBB workers given 8 MiB stacks | 8 | job | 1 | 1 trap (room) |
| Cycles F12 at 1280 x 720, 32 samples, as its job, ticking | 8 | job | 6 | 0 |

In the browser (Chromium, 23 threads), the six objects baked through once in four tries; the others stopped at the
turtle or the figure.

## Ruled out

- **Side modules' bytes or thread-locals.** Fixed earlier (`11f8a70e`: every worker loads `cycles.wasm`, its bytes freed
  only after). `cycles.wasm` has no thread-locals at all (`__tls_size` 0; Cycles has none outside OSL).
- **A second allocator.** `cycles.wasm` links with `-nostdlib` and imports `malloc`, `free`, `operator new`/`delete` and
  `MEM_*` from the module.
- **An unlocked malloc.** The module's malloc takes wasi-libc's lock (its futex wait is in malloc's call graph).
- **Thread creation's memory.** `threads.cc`'s `__copy_tls` clear ends exactly at the end of pthread_create's block
  (wasi-libc 22 sizes it as `tls_size + tls_align + tsd_size`). `pthread_join` waits for `wasi_thread_start`'s final
  thread-list unlock before freeing a thread's block; a detached thread's block is freed later, under the same lock.
- **Memory past 2 GiB.** A 2048 px bake peaks at 1.15 GB of module memory.
- **The page's window tick.** The trap rate does not follow the tick rate (50 ms or 5 s), and a depsgraph update logger
  saw no updates during a bake; locking the interface did not stop it either.
- **Number of threads started and finished.** 120 short job threads in a row were fine.
- **Worker stack overflow.** oneTBB gives workers 2 MiB on 32-bit (`src/tbb/misc.h`); with 8 MiB
  (`tbb::global_control::thread_stack_size`, set at the first `main_new`; a static one breaks the snapshot) the room
  still trapped. A canary at each spawned thread's stack bottom never fired (but a thread that traps never reaches the
  check).

## Leads followed before the cause was found

- **File calls served by the page.** Since today a thread's WASI file calls are served by the page's thread while it
  spins (`src/port/thread-files.js`). If the page serves one while it is inside malloc or holds a lock, or a worker makes
  a file call holding the malloc lock and the page needs malloc to answer, that is a re-entrancy deadlock (the spinning
  page) or heap corruption (the traps). Check whether Cycles' bake does file I/O on worker threads (OIIO image or
  texture reads, caches) and what the page does meanwhile.
- **A write after free on the job's threads.** The guarded allocator's layout hid it without reporting an overrun, which
  fits a write into a freed block (landing on dlmalloc's free-list links) more than a write past an end.
- **More threads, more failures** (six objects as jobs: 8 threads 3 of 4 runs, 4 threads 1 of 3, 2 threads 0 of 2): a race.
- **After big images.** Failures came after a 1024 or 2048 px bake in the same session, never in sessions of small
  bakes only.

## Repro (on branch `bake-lightmaps`)

```
node tools/docs/bake-repro.mjs                      # six objects by exec, 8 threads
node tools/docs/bake-repro.mjs --job                # as Blender's jobs
BYLONDER_THREADS=4 node tools/docs/bake-repro.mjs Room,Turtle --job --samples 64 --repeat 2
```

It prints each bake step's start, the module's memory growth and a summary; a trap prints `thread N: RuntimeError: ...`
and, from the polling loop, `A thread of Blender's stopped: ...`. A run of the six objects takes about 5 minutes with 8
threads.
