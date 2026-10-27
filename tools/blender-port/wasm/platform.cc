/* What Blender's code needs from the platform in a single-threaded WebAssembly build: allocation without the
 * exception runtime, and guardedalloc's thread-based bookkeeping as no-ops. */
#include <cstddef>
#include <cstdlib>
#include <new>

#include "MEM_guardedalloc.h"
#include "mallocn_intern.hh"

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

/* port-override: guardedalloc's leak detector and memory statistics use std::mutex, which WASI lacks. */
bool leak_detector_has_run = false;
char free_after_leak_detection_message[] = "";
void memory_usage_block_alloc(size_t) {}
void memory_usage_block_free(size_t) {}
size_t memory_usage_current() { return 0; }
