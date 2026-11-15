/* numpy's sources, force-included (numpy.sh): wasm-ld 18 cannot partially link (-r) a reference to a thread-local it
 * does not define, as wasi-libc's errno is with threads, so errno is read through libc's __errno_location. */
#include <errno.h>
#undef errno
#ifdef __cplusplus
extern "C"
#endif
int *__errno_location(void);
#define errno (*__errno_location())
