/* Force-included in WebAssembly builds of Blender's sources: what wasi-libc and its libc++ leave out. */
/* wasi-libc's mmap emulation (linked as -lwasi-emulated-mman): anonymous and file-backed by copying. */
#define _WASI_EMULATED_MMAN
#include <stdlib.h>
/* WASI is not __unix__, so sources that guard these POSIX headers on it skip them; wasi-libc has them. */
#include <sys/time.h>
#include <unistd.h>

#include <fenv.h>
#include <sys/resource.h>
#include <sys/stat.h>

/* WASI has no permissions, temporary directories, resource limits or floating-point exception flags. */
static inline int chmod(const char *path, mode_t mode)
{
  (void)path;
  (void)mode;
  return 0;
}
#ifdef __cplusplus
extern "C" char *mkdtemp(char *path_template);
#else
char *mkdtemp(char *path_template);
#endif
#ifndef RLIMIT_NOFILE
typedef unsigned long long rlim_t;
struct rlimit {
  rlim_t rlim_cur;
  rlim_t rlim_max;
};
#  define RLIMIT_NOFILE 7
static inline int getrlimit(int resource, struct rlimit *limit)
{
  (void)resource;
  limit->rlim_cur = limit->rlim_max = ~0ull;
  return 0;
}
static inline int setrlimit(int resource, const struct rlimit *limit)
{
  (void)resource;
  (void)limit;
  return 0;
}
#endif
#ifndef FE_DIVBYZERO
#  define FE_DIVBYZERO 0
#  define FE_INEXACT 0
#  define FE_INVALID 0
#  define FE_OVERFLOW 0
#  define FE_UNDERFLOW 0
#endif

/* wasi-libc has aligned_alloc, not memalign. */
static inline void *memalign(size_t align, size_t size)
{
  return aligned_alloc(align, (size + align - 1) / align * align);
}

#if defined(__cplusplus)
#  include <__config>
#  if defined(_LIBCPP_HAS_NO_THREADS)
/* libc++ without threads has no mutexes. A module is single-threaded, so a lock that does nothing is exact. */
namespace std {
struct mutex {
  void lock() {}
  bool try_lock() { return true; }
  void unlock() {}
};
struct recursive_mutex : mutex {};
template<class M> struct lock_guard {
  explicit lock_guard(M &) {}
};
struct defer_lock_t {};
struct try_to_lock_t {};
struct adopt_lock_t {};
inline constexpr defer_lock_t defer_lock{};
inline constexpr try_to_lock_t try_to_lock{};
inline constexpr adopt_lock_t adopt_lock{};
template<class M> struct unique_lock {
  unique_lock() = default;
  explicit unique_lock(M &) {}
  unique_lock(M &, defer_lock_t) {}
  unique_lock(M &, try_to_lock_t) {}
  unique_lock(M &, adopt_lock_t) {}
  void lock() {}
  void unlock() {}
  bool owns_lock() const { return true; }
};
template<class... M> struct scoped_lock {
  explicit scoped_lock(M &...) {}
};
}  // namespace std
/* libc++ without threads leaves out the atomic shared_ptr functions; on one thread they are a plain load and store. */
#    include <memory>
namespace std {
template<class T> shared_ptr<T> atomic_load(const shared_ptr<T> *p) { return *p; }
template<class T> void atomic_store(shared_ptr<T> *p, shared_ptr<T> r) { *p = std::move(r); }
}  // namespace std
#  endif
#endif
