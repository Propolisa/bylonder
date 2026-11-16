/* What Blender's threads (TBB's workers, on wasi-threads) need from the page: the number of processors it gives them,
 * and waits the page's thread can make. Linked with --wrap (blender_build.py wrapped). */
#include <atomic>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <pthread.h>
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

/* port-override: wasi-libc's pthread_create takes a thread's stack, thread-locals and thread-specific values in one
 * block from malloc where musl maps fresh zeroed pages, so a thread started where freed memory lies (Cycles' session
 * thread of a second render) finds another's values for its keys (oneTBB's thread data) instead of none. Its
 * thread-locals (with its pthread) and thread-specific values, which follow them, are cleared where __copy_tls is given
 * them, before it fills the thread-locals in. */
extern "C" const size_t __pthread_tsd_size;
extern "C" void *__real___copy_tls(unsigned char *mem);
extern "C" void *__wrap___copy_tls(unsigned char *mem)
{
  memset(mem, 0, __builtin_wasm_tls_size() + __builtin_wasm_tls_align() + __pthread_tsd_size);
  return __real___copy_tls(mem);
}

/* Set by a thread's worker when the thread stopped on a trap, with what stopped it (src/port/wasm-thread.js): the page's
 * thread, which may wait for it, stops waiting and reports it (threads_died, which throws) instead of spinning forever. */
static struct {
  std::atomic<int> word;
  char message[1020];
} thread_died;
EXPORT(threads_died_word) void *threads_died_word()
{
  return &thread_died;
}
extern "C" __attribute__((import_module("env"), import_name("threads_died"))) void threads_died(const char *message);

/* A thread that traps, for tests (tests/threads-wasm.test.js): the page waits for it and reports its stop. */
EXPORT(threads_trap) void threads_trap()
{
  pthread_t thread;
  if (pthread_create(&thread, nullptr, [](void *) -> void * { __builtin_trap(); }, nullptr) == 0) {
    pthread_join(thread, nullptr);
  }
}

/* Whether a thread's thread_local destructors ran when it ended (tests/threads-wasm.test.js). */
EXPORT(threads_local_destructed) bool threads_local_destructed()
{
  static std::atomic<bool> destructed;
  struct Local {
    ~Local() { destructed = true; }
  };
  destructed = false;
  pthread_t thread;
  const auto start = [](void *) -> void * {
    static thread_local Local local;
    return &local;
  };
  if (pthread_create(&thread, nullptr, start, nullptr) != 0) {
    return false;
  }
  pthread_join(thread, nullptr);
  return destructed;
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

/* port-override: WASI has no shared libraries to load. oneTBB looks for its scalable allocator with dlopen (a weak
 * reference it expects null where dlopen is missing, which the module's link makes a throwing import instead) and
 * allocates with malloc when it is not found. */
extern "C" void *dlopen(const char * /*filename*/, int /*flags*/)
{
  return nullptr;
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
 * module its bytes, their size, its memory and table bases, and the threads' thread-local blocks. */
static int side_modules[1 + 7 * 8];
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

/* The file calls the module's threads wait on, made by the page's thread (src/port/thread-files.js). */
extern "C" __attribute__((import_module("env"), import_name("serve_files"))) void serve_files();

/* The longest a spawned thread sleeps before it looks for side modules. */
constexpr int64_t SIDE_MODULES_SLICE_NS = 200000000;

extern "C" int __real___wasilibc_futex_wait(volatile void *addr, int op, int val, int64_t max_wait_ns);
/* port-override: a browser's page thread cannot block (memory.atomic.wait traps there), so it spins until the futex
 * word changes or the wait times out, making meanwhile the file calls of the threads it may wait for; threads the
 * module spawned wait as wasi-libc does, in slices between which they load the side modules the page loaded (a futex
 * wait may return early: its callers check their condition again). */
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
    if (i & 1023) {
      continue;
    }
    serve_files();
    if (thread_died.word.load(std::memory_order_acquire)) {
      threads_died(thread_died.message);
    }
    if (max_wait_ns >= 0 && now() - start >= max_wait_ns) {
      result = -ETIMEDOUT;
      break;
    }
  }
  const int64_t waited = now() - start;
  longest_wait = waited > longest_wait ? waited : longest_wait;
  return result;
}
