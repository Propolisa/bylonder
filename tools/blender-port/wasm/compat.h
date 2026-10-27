/* wasi-libc has aligned_alloc, not memalign. */
#include <stdlib.h>
static inline void *memalign(size_t align, size_t size) { return aligned_alloc(align, (size + align - 1) / align * align); }
