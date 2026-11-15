/* What Blender's threads (TBB's workers, on wasi-threads) need from the page: the number of processors it gives them,
 * and waits the page's thread can make. Linked with --wrap (blender_build.py wrapped). */
#include <atomic>
#include <cerrno>
#include <cstdint>
#include <ctime>
#include <unistd.h>

#include "BLI_task.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* The threads the page runs the module on (src/port/wasm-threads.js): one where it is not cross-origin isolated. */
extern "C" __attribute__((import_module("env"), import_name("hardware_threads"))) int hardware_threads();

extern "C" long __real_sysconf(int name);
/* port-override: WASI has no processor count; the page's is what TBB and BLI_system_thread_count size their pools by. */
extern "C" long __wrap_sysconf(int name)
{
  return name == _SC_NPROCESSORS_ONLN || name == _SC_NPROCESSORS_CONF ? hardware_threads() : __real_sysconf(name);
}

static thread_local bool spawned;
extern "C" void __real___wasi_thread_start_C(int tid, void *arg);
extern "C" void __wrap___wasi_thread_start_C(int tid, void *arg)
{
  spawned = true;
  __real___wasi_thread_start_C(tid, arg);
}

/* The longest wait of the page's thread, in nanoseconds: how long the page stalled on other threads. */
static int64_t longest_wait;
EXPORT(threads_longest_wait) double threads_longest_wait()
{
  return double(longest_wait);
}

/* How many threads Blender's threading::parallel_for runs `size` items of work on (tests/threads-wasm.test.js). */
EXPORT(threads_parallel_for) int threads_parallel_for(int size)
{
  static std::atomic<int> generation;
  static thread_local int seen;
  const int now = ++generation;
  std::atomic<int> threads = 0;
  blender::threading::parallel_for(blender::IndexRange(size), 1, [&](const blender::IndexRange range) {
    if (seen != now) {
      seen = now;
      threads++;
    }
    volatile double sum = 0;
    for (const int64_t i : range) {
      for (int j = 0; j < 100000; j++) {
        sum = sum + double(i ^ j);
      }
    }
  });
  return threads;
}

static int64_t now()
{
  timespec time;
  clock_gettime(CLOCK_MONOTONIC, &time);
  return time.tv_sec * 1000000000ll + time.tv_nsec;
}

/* Side modules (src/port/side-modules.js) the page loaded: each thread's instance loads them too before it next waits
 * or starts, as a thread that sleeps inside the module receives no messages. */
static std::atomic<int> side_generation;
/* The loaded side modules for the threads (side-modules.js writes them): how many instances loaded one, then per
 * module its bytes, their size, and its memory and table bases. */
static int side_modules[1 + 4 * 16];
EXPORT(side_modules_generation) int *side_modules_generation()
{
  return reinterpret_cast<int *>(&side_generation);
}
EXPORT(side_modules_list) int *side_modules_list()
{
  return side_modules;
}
static thread_local int side_seen;
extern "C" __attribute__((import_module("env"), import_name("side_modules_sync"))) void side_modules_sync(int generation);
static void side_modules_check()
{
  const int generation = side_generation.load();
  if (generation != side_seen) {
    side_seen = generation;
    side_modules_sync(generation);
  }
}

/* The longest a spawned thread sleeps before it looks for side modules. */
constexpr int64_t SIDE_MODULES_SLICE_NS = 200000000;

extern "C" int __real___wasilibc_futex_wait(volatile void *addr, int op, int val, int64_t max_wait_ns);
/* port-override: a browser's page thread cannot block (memory.atomic.wait traps there), so it spins until the futex
 * word changes or the wait times out; threads the module spawned wait as wasi-libc does, in slices between which they
 * load the side modules the page loaded (a futex wait may return early: its callers check their condition again). */
extern "C" int __wrap___wasilibc_futex_wait(volatile void *addr, int op, int val, int64_t max_wait_ns)
{
  if (spawned) {
    side_modules_check();
    const bool sliced = max_wait_ns < 0 || max_wait_ns > SIDE_MODULES_SLICE_NS;
    const int result = __real___wasilibc_futex_wait(addr, op, val, sliced ? SIDE_MODULES_SLICE_NS : max_wait_ns);
    side_modules_check();
    return sliced && result == -ETIMEDOUT ? 0 : result;
  }
  const int64_t start = now();
  int result = 0;
  for (unsigned i = 1; __atomic_load_n(static_cast<volatile int *>(addr), __ATOMIC_SEQ_CST) == val; i++) {
    if (max_wait_ns >= 0 && !(i & 1023) && now() - start >= max_wait_ns) {
      result = -ETIMEDOUT;
      break;
    }
  }
  const int64_t waited = now() - start;
  longest_wait = waited > longest_wait ? waited : longest_wait;
  return result;
}
