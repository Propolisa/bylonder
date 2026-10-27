/* wasi-libc without threads has pthread types but no pthread.h. A module runs on one thread, so the calls Blender's
 * headers make do nothing, as on one thread they would. The types are libc's own, requested as musl's pthread.h does. */
#pragma once

#define __NEED_pthread_t
#define __NEED_pthread_key_t
#define __NEED_pthread_mutex_t
#define __NEED_pthread_mutexattr_t
#define __NEED_pthread_spinlock_t
#define __NEED_pthread_rwlock_t
#define __NEED_pthread_cond_t
#define __NEED_pthread_attr_t
#include <bits/alltypes.h>

#define PTHREAD_MUTEX_INITIALIZER {{{0}}}
#define PTHREAD_RWLOCK_INITIALIZER {{{0}}}
#define PTHREAD_COND_INITIALIZER {{{0}}}

static inline pthread_t pthread_self(void) { return 0; }
static inline int pthread_equal(pthread_t a, pthread_t b) { return a == b; }
