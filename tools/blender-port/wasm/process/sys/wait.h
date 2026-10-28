/* <sys/wait.h> and the process and ownership calls next to it, for sources that run other programs or copy a file's
 * owner and mode (fileops_c.cc's external file operations and file copies): WASI has neither, so these are only
 * declared. A call of one throws (the module imports it), which no path of the module reaches. Seen only by the
 * libraries that list wasm/process as an include. */
#pragma once

#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

pid_t fork(void);
int execvp(const char *file, char *const argv[]);
pid_t waitpid(pid_t pid, int *status, int options);
int chown(const char *path, uid_t owner, gid_t group);
int chmod(const char *path, mode_t mode);
int mknod(const char *path, mode_t mode, dev_t dev);

#define WIFEXITED(status) (((status) & 0x7f) == 0)
#define WEXITSTATUS(status) (((status) >> 8) & 0xff)

#ifdef __cplusplus
}
#endif
