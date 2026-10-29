/* The browser's clipboard as Blender's (WM_clipboard_text_get and _set, wm_window.cc): the page keeps the text it last
 * knew the clipboard to hold, since the browser reads it only asynchronously (windowmanager/wm-clipboard.js). */

#include <cstring>

#include "BLI_utildefines.h"
#include "MEM_guardedalloc.h"

#include "WM_api.hh"

#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

IMPORT(clipboard_text_length) int clipboard_text_length();
IMPORT(clipboard_text_read) void clipboard_text_read(char *buf);
IMPORT(clipboard_text_write) void clipboard_text_write(const char *buf, int len);

namespace blender {

/* port-override: GHOST's headless system has no clipboard. Blender's own reads strip `\r` and can stop at the first
 * line; selection (X11's primary) is the same clipboard. */
static char *clipboard_get(bool firstline, int *r_len)
{
  const int length = clipboard_text_length();
  char *buf = MEM_new_array_uninitialized<char>(size_t(length + 1), __func__);
  clipboard_text_read(buf);
  buf[length] = '\0';
  int len = 0;
  for (const char *p = buf; *p && !(firstline && ELEM(*p, '\n', '\r')); p++) {
    if (*p != '\r') {
      buf[len++] = *p;
    }
  }
  buf[len] = '\0';
  *r_len = len;
  return buf;
}
char *WM_clipboard_text_get(bool /*selection*/, bool /*ensure_utf8*/, int *r_len) { return clipboard_get(false, r_len); }
char *WM_clipboard_text_get_firstline(bool /*selection*/, bool /*ensure_utf8*/, int *r_len) { return clipboard_get(true, r_len); }
void WM_clipboard_text_set(const char *buf, bool /*selection*/) { clipboard_text_write(buf, int(strlen(buf))); }

}  // namespace blender
