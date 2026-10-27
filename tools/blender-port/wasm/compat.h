/* Force-included in WebAssembly builds of Blender's sources: what wasi-libc and its libc++ leave out. */
#include <stdlib.h>
/* WASI is not __unix__, so sources that guard these POSIX headers on it skip them; wasi-libc has them. */
#include <sys/time.h>
#include <unistd.h>

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
template<class M> struct unique_lock {
  unique_lock() = default;
  explicit unique_lock(M &) {}
  void lock() {}
  void unlock() {}
  bool owns_lock() const { return true; }
};
template<class... M> struct scoped_lock {
  explicit scoped_lock(M &...) {}
};
}  // namespace std
#  endif
#endif
