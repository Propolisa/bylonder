/* wasi-libc without exception handling has no setjmp.h. FreeType jumps back only when a font's tables fail validation
 * (ft_validator_error): setjmp returns 0 and a jump ends the program, as a throw does in the module. */
#pragma once

#include <stdlib.h>

typedef int jmp_buf[1];
#define setjmp(env) 0
static inline void longjmp(jmp_buf env, int value) { (void)env; (void)value; abort(); }
