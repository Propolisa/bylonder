/* Cycles' start in the side module cycles.wasm (blender_build.py link_cycles), which the page loads when Cycles first
 * renders: what Blender's main() does for Cycles (creator.cc, WITH_CYCLES), and its Python module _cycles, which the
 * module's Python, started without Cycles, gets in sys.modules (bpy_interface.cc lists it in its inittab). */
#include <Python.h>

#include "BLI_listbase.h"
#include "BLI_string.h"
#include "RE_engine.h"

#include "blender/CCL_api.h"
#include "blender/session.h"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

EXPORT(cycles_start) void cycles_start()
{
  blender::CCL_log_init();
  blender::CCL_implicit_sharing_init();
  /* The engine draw-seam.cc held Cycles' place with makes way for the add-on's. */
  for (blender::RenderEngineType &type : blender::R_engines) {
    if (STREQ(type.idname, "CYCLES") && !type.rna_ext.srna) {
      BLI_remlink(&blender::R_engines, &type);
      break;
    }
  }
  const PyGILState_STATE gil = PyGILState_Ensure();
  PyObject *module = static_cast<PyObject *>(blender::CCL_python_module_init());
  PyDict_SetItemString(PyImport_GetModuleDict(), "_cycles", module);
  Py_DECREF(module);
  /* Its add-on, from cycles.zip, enabled as Blender enables it by default; Python's importers list the add-ons folder
   * again, as cycles.zip arrived after they first did. */
  PyRun_SimpleString(
      "import addon_utils, importlib\nimportlib.invalidate_caches()\naddon_utils.enable('cycles', default_set=True)\n");
  PyGILState_Release(gil);
  /* No GPU display to draw into (F12 reads the render result), so Cycles renders as Blender's does headless; set after
   * the add-on's init, which sets it from bpy.app.background. */
  ccl::BlenderSession::headless = true;
}
