/* Blender's Python calls (BPY_extern.hh, BPY_extern_run.hh) from the code that runs Python, answered by the page's
 * CPython (python/pyodide.js through editors/space_text/text-editor.js): Run Script runs a Text there. */

#include "BPY_extern.hh"
#include "BPY_extern_run.hh"

#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

namespace blender {
struct Text;
}

IMPORT(bpy_run_text) void bpy_run_text(blender::bContext *C, blender::Text *text, bool do_jump);

namespace blender {

/* port-override: CPython runs in the browser and loads on first use, so the script runs after this returns; its
 * errors are reported and its cursor jump made when it ends (do_jump), as BPY_run_text does. */
bool BPY_run_text(bContext *C, Text *text, ReportList * /*reports*/, const bool do_jump)
{
  bpy_run_text(C, text, do_jump);
  return true;
}

/* Texts are never compiled here: CPython compiles them in the browser. */
void BPY_text_free_code(Text * /*text*/) {}

/* port-override: Jump to File at Point evaluates Python to open an external editor, which the browser has none of. */
bool BPY_run_string_as_string(bContext * /*C*/, const char * /*imports*/[], const char * /*expr*/,
                              BPy_RunErrInfo * /*err_info*/, char ** /*r_value*/)
{
  return false;
}

}  // namespace blender
