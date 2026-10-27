/* What Blender's code needs from the platform in a WebAssembly build: allocation without the exception runtime. */
#include <cstddef>
#include <cstdlib>
#include <new>

#include "BLI_task.hh"

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

/* port-override: WASI has no threads, so parallel_for runs its range in one call, as Blender does without TBB. */
namespace blender::threading::detail {
void parallel_for_impl(const IndexRange range,
                       const int64_t /*grain_size*/,
                       const FunctionRef<void(IndexRange)> function,
                       const TaskSizeHints & /*size_hints*/)
{
  function(range);
}
}  // namespace blender::threading::detail
