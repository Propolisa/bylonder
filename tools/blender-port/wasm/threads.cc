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

extern "C" int __real___wasilibc_futex_wait(volatile void *addr, int op, int val, int64_t max_wait_ns);
/* port-override: a browser's page thread cannot block (memory.atomic.wait traps there), so it spins until the futex
 * word changes or the wait times out; threads the module spawned wait as wasi-libc does. */
extern "C" int __wrap___wasilibc_futex_wait(volatile void *addr, int op, int val, int64_t max_wait_ns)
{
  if (spawned) {
    return __real___wasilibc_futex_wait(addr, op, val, max_wait_ns);
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
