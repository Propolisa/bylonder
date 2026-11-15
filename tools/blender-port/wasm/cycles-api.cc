/* Cycles' start in the side module cycles.wasm (blender_build.py link_cycles), which the page loads when Cycles first
 * renders: what Blender's main() does for Cycles (creator.cc, WITH_CYCLES), and its Python module _cycles, which the
 * module's Python, started without Cycles, gets in sys.modules (bpy_interface.cc lists it in its inittab). */
#include <Python.h>

#include "blender/CCL_api.h"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

EXPORT(cycles_start) void cycles_start()
{
  blender::CCL_log_init();
  blender::CCL_implicit_sharing_init();
  const PyGILState_STATE gil = PyGILState_Ensure();
  PyObject *module = static_cast<PyObject *>(blender::CCL_python_module_init());
  PyDict_SetItemString(PyImport_GetModuleDict(), "_cycles", module);
  Py_DECREF(module);
  /* Its add-on, from cycles.zip, enabled as Blender enables it by default. */
  PyRun_SimpleString("import addon_utils\naddon_utils.enable('cycles', default_set=True)\n");
  PyGILState_Release(gil);
}
