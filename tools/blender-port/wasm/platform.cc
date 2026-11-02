/* What Blender's code needs from the platform in a WebAssembly build: allocation without the exception runtime, and
 * the thread count of one thread. */
#include "BLI_mmap.h"
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>
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
/* port-override: WASI cannot create a unique directory; Blender then keeps its temporary files in its temp directory. */
extern "C" __attribute__((weak)) char *mkdtemp(char *) { return nullptr; }

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
/* port-override: WASI has no threads: a thread pool's work (a window manager job's: a point cache bake, a background
 * task pool's queue) runs where it is inserted, to its end, which frees its slot for the next; the window then ends a
 * job (wm_jobs_handle_finished, wm-api.cc wm_window_handle). Linked with --wrap (wasm_module.PLATFORM_WRAPPED). */
struct ThreadSlot {
  ThreadSlot *next, *prev;
  void *(*do_thread)(void *);
  void *callerdata;
  pthread_t pthread;
  int avail;
};
}  // namespace blender
#undef WEAK

namespace blender {
/* port-override: WASI has no memory mapping, nor the signals BLI_mmap.cc handles a mapped file's read errors with: a
 * file's mapping is its bytes read into memory, which the module's file system holds in memory already. */
struct BLI_mmap_file {
  char *memory;
  size_t length;
};
BLI_mmap_file *BLI_mmap_open(int fd)
{
  struct stat st;
  char *memory = fstat(fd, &st) == 0 && st.st_size > 0 ? static_cast<char *>(malloc(size_t(st.st_size))) : nullptr;
  const size_t length = memory ? size_t(st.st_size) : 0;
  for (size_t done = 0; memory && done < length;) {
    const ssize_t got = pread(fd, memory + done, length - done, off_t(done));
    if (got <= 0) {
      free(memory);
      memory = nullptr;
    }
    done += size_t(got);
  }
  return memory ? new BLI_mmap_file{memory, length} : nullptr;
}
bool BLI_mmap_read(BLI_mmap_file *file, void *dest, size_t offset, size_t length)
{
  if (offset > file->length || length > file->length - offset) {
    return false;
  }
  memcpy(dest, file->memory + offset, length);
  return true;
}
void *BLI_mmap_get_pointer(BLI_mmap_file *file) { return file->memory; }
size_t BLI_mmap_get_length(const BLI_mmap_file *file) { return file->length; }
bool BLI_mmap_any_io_error(const BLI_mmap_file * /*file*/) { return false; }
void BLI_mmap_free(BLI_mmap_file *file)
{
  free(file->memory);
  delete file;
}
}  // namespace blender

#define QUEUE_POP _ZN7blender20BLI_thread_queue_popEPNS_11ThreadQueueE
#define THREADPOOL_INSERT _ZN7blender21BLI_threadpool_insertEPNS_9ListBaseTINS_10ThreadSlotEEEPv
#define WRAP_(prefix, name) prefix##name
#define WRAP(prefix, name) WRAP_(prefix, name)
extern "C" void WRAP(__wrap_, THREADPOOL_INSERT)(blender::ListBaseT<blender::ThreadSlot> *threadbase, void *callerdata)
{
  for (blender::ThreadSlot &slot : *threadbase) {
    if (slot.avail) {
      slot.avail = 0;
      slot.callerdata = callerdata;
      slot.do_thread(callerdata);
      slot.avail = 1;
      return;
    }
  }
}
extern "C" void *WRAP(__real_, QUEUE_POP)(blender::ThreadQueue *queue);
/* port-override: with one thread nothing else can add work to a queue being waited on, so an empty queue gives no work
 * (a background task pool's worker then ends) instead of waiting forever. */
extern "C" void *WRAP(__wrap_, QUEUE_POP)(blender::ThreadQueue *queue)
{
  return blender::BLI_thread_queue_is_empty(queue) ? nullptr : WRAP(__real_, QUEUE_POP)(queue);
}
