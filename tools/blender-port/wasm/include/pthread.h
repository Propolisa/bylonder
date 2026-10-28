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

/* On one thread a lock is always free, a condition never waited on and a thread never started. */
#define PTHREAD_ONCE_INIT 0
#define PTHREAD_MUTEX_RECURSIVE 1
typedef int pthread_once_t;
#define BL_PTHREAD_NOP(name, ...) static inline int name(__VA_ARGS__) { return 0; }
BL_PTHREAD_NOP(pthread_mutex_init, pthread_mutex_t *m, const pthread_mutexattr_t *a)
BL_PTHREAD_NOP(pthread_mutex_destroy, pthread_mutex_t *m)
BL_PTHREAD_NOP(pthread_mutex_lock, pthread_mutex_t *m)
BL_PTHREAD_NOP(pthread_mutex_trylock, pthread_mutex_t *m)
BL_PTHREAD_NOP(pthread_mutex_unlock, pthread_mutex_t *m)
BL_PTHREAD_NOP(pthread_mutexattr_init, pthread_mutexattr_t *a)
BL_PTHREAD_NOP(pthread_mutexattr_destroy, pthread_mutexattr_t *a)
BL_PTHREAD_NOP(pthread_mutexattr_settype, pthread_mutexattr_t *a, int type)
BL_PTHREAD_NOP(pthread_spin_init, pthread_spinlock_t *s, int shared)
BL_PTHREAD_NOP(pthread_spin_destroy, pthread_spinlock_t *s)
BL_PTHREAD_NOP(pthread_spin_lock, pthread_spinlock_t *s)
BL_PTHREAD_NOP(pthread_spin_unlock, pthread_spinlock_t *s)
BL_PTHREAD_NOP(pthread_rwlock_init, pthread_rwlock_t *l, const void *a)
BL_PTHREAD_NOP(pthread_rwlock_destroy, pthread_rwlock_t *l)
BL_PTHREAD_NOP(pthread_rwlock_rdlock, pthread_rwlock_t *l)
BL_PTHREAD_NOP(pthread_rwlock_wrlock, pthread_rwlock_t *l)
BL_PTHREAD_NOP(pthread_rwlock_unlock, pthread_rwlock_t *l)
BL_PTHREAD_NOP(pthread_cond_init, pthread_cond_t *c, const void *a)
BL_PTHREAD_NOP(pthread_cond_destroy, pthread_cond_t *c)
BL_PTHREAD_NOP(pthread_cond_signal, pthread_cond_t *c)
BL_PTHREAD_NOP(pthread_cond_broadcast, pthread_cond_t *c)
BL_PTHREAD_NOP(pthread_cond_wait, pthread_cond_t *c, pthread_mutex_t *m)
BL_PTHREAD_NOP(pthread_cond_timedwait, pthread_cond_t *c, pthread_mutex_t *m, const struct timespec *t)
BL_PTHREAD_NOP(pthread_attr_init, pthread_attr_t *a)
BL_PTHREAD_NOP(pthread_attr_destroy, pthread_attr_t *a)
BL_PTHREAD_NOP(pthread_join, pthread_t t, void **result)
BL_PTHREAD_NOP(pthread_detach, pthread_t t)
#undef BL_PTHREAD_NOP
static inline int pthread_create(pthread_t *t, const pthread_attr_t *a, void *(*f)(void *), void *arg) { return 11; /* EAGAIN */ }
static inline int pthread_once(pthread_once_t *once, void (*f)(void)) { if (!*once) { *once = 1; f(); } return 0; }
/* Thread-local keys: one thread, so a key holds one value. */
#define BL_PTHREAD_KEYS 64
/* Weak, so every source shares one table. */
__attribute__((weak)) void *bl_pthread_keys[BL_PTHREAD_KEYS];
__attribute__((weak)) unsigned bl_pthread_next_key;
static inline int pthread_key_create(pthread_key_t *key, void (*destructor)(void *)) { *key = bl_pthread_next_key++ % BL_PTHREAD_KEYS; return 0; }
static inline int pthread_key_delete(pthread_key_t key) { return 0; }
static inline void *pthread_getspecific(pthread_key_t key) { return bl_pthread_keys[key]; }
static inline int pthread_setspecific(pthread_key_t key, const void *value) { bl_pthread_keys[key] = (void *)value; return 0; }
