/* <pwd.h> and <sys/ioctl.h> for storage.cc, whose non-Windows branch includes them to find the user's home directory
 * and reads a disk's free space with statfs: WASI has no users or disks, so these are only declared (a call throws, as
 * the module imports it, and no path of the module reaches one). Seen only by the sources that list wasm/storage as an
 * include. */
#pragma once

#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

struct passwd {
  char *pw_name;
  char *pw_dir;
};
struct passwd *getpwuid(uid_t uid);
uid_t getuid(void);

struct statfs {
  long f_bsize;
  unsigned long f_bfree;
};
int statfs(const char *path, struct statfs *buf);

#ifdef __cplusplus
}
#endif
