/* What Blender's code needs from the platform in a WebAssembly build: allocation without the exception runtime, and
 * the thread count of one thread. */
#include <cstddef>
#include <cstdlib>
#include <new>

#include "BLI_threads.h"

void *operator new(std::size_t n)
{
  void *p = std::malloc(n ? n : 1);
  if (!p) {
    std::abort();
  }
  return p;
}
void *operator new[](std::size_t n) { return operator new(n); }
void *operator new(std::size_t n, std::align_val_t a)
{
  const std::size_t align = std::size_t(a);
  void *p = std::aligned_alloc(align, (n + align - 1) / align * align);
  if (!p) {
    std::abort();
  }
  return p;
}
void *operator new[](std::size_t n, std::align_val_t a) { return operator new(n, a); }
void operator delete(void *p) noexcept { std::free(p); }
void operator delete[](void *p) noexcept { std::free(p); }
void operator delete(void *p, std::size_t) noexcept { std::free(p); }
void operator delete[](void *p, std::size_t) noexcept { std::free(p); }
void operator delete(void *p, std::align_val_t) noexcept { std::free(p); }
void operator delete[](void *p, std::align_val_t) noexcept { std::free(p); }
void operator delete(void *p, std::size_t, std::align_val_t) noexcept { std::free(p); }
void operator delete[](void *p, std::size_t, std::align_val_t) noexcept { std::free(p); }

/* Exceptions are compiled with -fignore-exceptions: a throw ends the program. */
extern "C" void *__cxa_allocate_exception(std::size_t) { std::abort(); }
extern "C" void __cxa_throw(void *, void *, void (*)(void *)) { std::abort(); }

/* thread_local destructors: a reactor module never exits its one thread. */
extern "C" int __cxa_thread_atexit(void (*)(void *), void *, void *) { return 0; }
/* port-override: WASI has no users: one user, without a passwd entry (Blender then uses $HOME or its defaults). */
extern "C" __attribute__((weak)) unsigned getuid() { return 0; }
extern "C" __attribute__((weak)) struct passwd *getpwuid(unsigned) { return nullptr; }

/* Weak: where Blender's own threads.cc builds (over wasm/include/pthread.h) it gives the same one-thread answers. */
#define WEAK __attribute__((weak))
namespace blender {
/* port-override: WASI has no threads; Blender's own task_range.cc runs ranges serially without TBB. */
WEAK int BLI_system_thread_count() { return 1; }
WEAK int BLI_thread_is_main() { return 1; }
/* port-override: one thread holds every lock. */
WEAK void BLI_spin_init(SpinLock * /*spin*/) {}
WEAK void BLI_spin_lock(SpinLock * /*spin*/) {}
WEAK void BLI_spin_unlock(SpinLock * /*spin*/) {}
WEAK void BLI_spin_end(SpinLock * /*spin*/) {}
WEAK void BLI_rw_mutex_init(ThreadRWMutex * /*mutex*/) {}
WEAK void BLI_rw_mutex_end(ThreadRWMutex * /*mutex*/) {}
WEAK void BLI_rw_mutex_lock(ThreadRWMutex * /*mutex*/, int /*mode*/) {}
WEAK void BLI_rw_mutex_unlock(ThreadRWMutex * /*mutex*/) {}
/* port-override: image files are the browser's to decode; OpenImageIO and OpenEXR are past the seam. */
WEAK void OIIO_init() {}
WEAK void imb_initopenexr() {}
WEAK void imb_exitopenexr() {}
WEAK void imb_init_dds() {}
}  // namespace blender
#undef WEAK
