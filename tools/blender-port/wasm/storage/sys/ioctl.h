/* See pwd.h in wasm/storage. WASI's own, with what a terminal's size query names (Cycles' system_console_width): WASI
 * has no terminal, so the query fails and the caller keeps its default width. */
#pragma once
#include_next <sys/ioctl.h>

#ifndef TIOCGWINSZ
#  define TIOCGWINSZ 0x5413
struct winsize {
  unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel;
};
#endif
