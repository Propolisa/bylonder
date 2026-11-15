/* What Blender's code needs from the platform in a WebAssembly build: allocation without the exception runtime, memory
 * that grows in large steps, and memory-mapped files. */
#include "BLI_mmap.h"
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>
#include <new>


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

/* thread_local destructors: the module's threads live as long as the page. */
extern "C" int __cxa_thread_atexit(void (*)(void *), void *, void *) { return 0; }
/* port-override: WASI has no users: one user, without a passwd entry (Blender then uses $HOME or its defaults). */
extern "C" __attribute__((weak)) unsigned getuid() { return 0; }
extern "C" __attribute__((weak)) struct passwd *getpwuid(unsigned) { return nullptr; }
/* port-override: WASI cannot create a unique directory; Blender then keeps its temporary files in its temp directory. */
extern "C" __attribute__((weak)) char *mkdtemp(char *) { return nullptr; }
/* port-override: wasi-libc's sbrk grows the memory by the pages malloc asks for, and V8 answers every growth with a
 * full garbage collection of the page's heap (its new buffer counts as that much external memory): the memory grows
 * by at least 16 MiB at a time, which malloc's later requests take from. */
extern "C" void *sbrk(intptr_t increment)
{
  constexpr uintptr_t page = 65536, step = 256;
  static uintptr_t brk = 0;
  const uintptr_t size = __builtin_wasm_memory_size(0) * page;
  if (!brk) {
    brk = size;
  }
  const uintptr_t end = brk + uintptr_t(increment);
  if (end > size) {
    const uintptr_t pages = (end - size + page - 1) / page;
    if (__builtin_wasm_memory_grow(0, pages < step ? step : pages) == SIZE_MAX &&
        __builtin_wasm_memory_grow(0, pages) == SIZE_MAX)
    {
      errno = ENOMEM;
      return reinterpret_cast<void *>(-1);
    }
  }
  void *old = reinterpret_cast<void *>(brk);
  brk = end;
  return old;
}

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

