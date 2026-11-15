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

/* WASI has no temporary directories, resource limits or floating-point exception flags. */
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
