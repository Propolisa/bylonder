/* CPython in the module (the manifest's cpython and numpy, deps/): Blender's own bpy, started by the page on first use
 * (src/python/python.js) once Python's files are in the module's file system. Until then Blender's calls into Python
 * act as Blender without Python does (the __wrap_ definitions, linked with --wrap). Both Pythons register into the same
 * RNA: an operator class's properties are defined by the Python that registered it. */
#include <Python.h>

#include "BKE_context.hh"
#include "BKE_global.hh"
#include "BKE_main.hh"
#include "BKE_report.hh"
#include "BLI_string_utf8.h"
#include "BLI_expr_pylike_eval.h"
#include "BPY_extern.hh"
#include "BPY_extern_python.hh"
#include "BPY_extern_run.hh"
#include "DNA_anim_types.h"
#include "DNA_text_types.h"
#include "RNA_access.hh"
#include "RNA_define.hh"
#include "WM_types.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))
#define WRAP_(prefix, name) prefix##name
#define WRAP(prefix, name) WRAP_(prefix, name)

using namespace blender;

/* numpy's extension modules (deps/numpy.sh), built in. */
extern "C" struct _inittab numpy_inittab[];

/* Asks the page to start Python: a Python driver needs it. */
IMPORT(python_requested) void python_requested();

namespace blender {
bool js_extension(const ExtensionRNA &ext);
void js_operator_properties_init(wmOperatorType *ot);
/* bpy_rna.hh, bpy_capi_utils.hh */
PyObject *pyrna_struct_CreatePyObject(PointerRNA *ptr);
bool bpy_context_set(bContext *C, PyGILState_STATE *gilstate);
void bpy_context_clear(bContext *C, const PyGILState_STATE *gilstate);
}  // namespace blender

static bool started() { return Py_IsInitialized(); }
EXPORT(python_running) bool python_running() { return started(); }

/* Python started as Blender's WM_init starts it: BPY_python_start, BPY_python_reset, then its scripts (importing bpy
 * registers the startup scripts, bylonder_cpython.py) and the add-ons and extensions the Preferences enable. */
EXPORT(python_start) bool python_start(bContext *C)
{
  PyImport_ExtendInittab(numpy_inittab);
  BPY_python_start(C, 0, nullptr);
  BPY_python_reset(C);
  const char *startup[] = {"bpy", "bylonder_cpython", nullptr};
  return BPY_run_string_exec(
      C, startup, "bpy.utils.load_scripts_extensions()\nbylonder_cpython.extensions_loaded()");
}

/* The draw functions CPython added (prepended, `before`, or appended) to a UI type the transpiled tree registered
 * (VIEW3D_MT_add.append(fn) in an add-on), drawn into the same layout (a Menu, Panel or Header struct of that type). */
EXPORT(python_draw_added) void python_draw_added(bContext *C, StructRNA *type, ID *id, void *data, bool before)
{
  if (!started() || !RNA_struct_py_type_get(type)) {
    return;
  }
  PyGILState_STATE gilstate;
  bpy_context_set(C, &gilstate);
  PointerRNA ptr = RNA_pointer_create_discrete(id, type, data);
  PyObject *self = pyrna_struct_CreatePyObject(&ptr);
  PyObject *module = PyImport_ImportModule("bylonder_cpython");
  PyObject *result = module && self ? PyObject_CallMethod(module, "draw_added", "OO", self, before ? Py_True : Py_False) : nullptr;
  if (!result) {
    PyErr_Print();
  }
  Py_XDECREF(result);
  Py_XDECREF(module);
  Py_XDECREF(self);
  bpy_context_clear(C, &gilstate);
}

#define BPY_CONTEXT_SET _ZN7blender15BPY_context_setEPNS_8bContextE
#define BPY_CONTEXT_UPDATE _ZN7blender18BPY_context_updateEPNS_8bContextE
#define BPY_CALLBACK_SCREEN_FREE _ZN7blender24BPY_callback_screen_freeEPNS_11ARegionTypeE
#define BPY_CALLBACK_WM_FREE _ZN7blender20BPY_callback_wm_freeEPNS_15wmWindowManagerE
#define BPY_MODULES_UPDATE _ZN7blender18BPY_modules_updateEv
#define BPY_MODULES_LOAD_USER _ZN7blender21BPY_modules_load_userEPNS_8bContextE
#define BPY_DRIVER_RESET _ZN7blender16BPY_driver_resetEv
#define BPY_PYTHON_RESET _ZN7blender16BPY_python_resetEPNS_8bContextE
#define BPY_APP_HANDLERS_RESET _ZN7blender22BPY_app_handlers_resetEb
#define BPY_THREAD_SAVE _ZN7blender15BPY_thread_saveEv
#define BPY_THREAD_RESTORE _ZN7blender18BPY_thread_restoreEPv
#define BPY_RUN_STRING_EXEC _ZN7blender19BPY_run_string_execEPNS_8bContextEPPKcS3_
#define BPY_RUN_STRING_EVAL _ZN7blender19BPY_run_string_evalEPNS_8bContextEPPKcS3_
#define BPY_RUN_STRING_AS_NUMBER _ZN7blender24BPY_run_string_as_numberEPNS_8bContextEPPKcS3_PNS_14BPy_RunErrInfoEPd
#define BPY_DRIVER_EXEC _ZN7blender15BPY_driver_execEPNS_15PathResolvedRNAEPNS_13ChannelDriverES3_PKNS_20AnimationEvalContextE
#define BPY_RNA_OPERATOR_WRAPPER _ZN7blender24BPY_RNA_operator_wrapperEPNS_14wmOperatorTypeEPv
#define BPY_RNA_OPERATOR_MACRO_WRAPPER _ZN7blender30BPY_RNA_operator_macro_wrapperEPNS_14wmOperatorTypeEPv

/* port-override: Python starts on first use; before, Blender's calls into it do nothing, as without Python. */
#define BEFORE_START(name, params, args) \
  extern "C" void WRAP(__real_, name) params; \
  extern "C" void WRAP(__wrap_, name) params \
  { \
    if (started()) { \
      WRAP(__real_, name) args; \
    } \
  }
BEFORE_START(BPY_CONTEXT_SET, (bContext * C), (C))
BEFORE_START(BPY_CONTEXT_UPDATE, (bContext * C), (C))
BEFORE_START(BPY_CALLBACK_SCREEN_FREE, (ARegionType * art), (art))
BEFORE_START(BPY_CALLBACK_WM_FREE, (wmWindowManager * wm), (wm))
BEFORE_START(BPY_MODULES_UPDATE, (), ())
BEFORE_START(BPY_MODULES_LOAD_USER, (bContext * C), (C))
BEFORE_START(BPY_DRIVER_RESET, (), ())
BEFORE_START(BPY_APP_HANDLERS_RESET, (bool do_all), (do_all))
BEFORE_START(BPY_THREAD_RESTORE, (void *state), (state))

extern "C" void *WRAP(__real_, BPY_THREAD_SAVE)();
extern "C" void *WRAP(__wrap_, BPY_THREAD_SAVE)() { return started() ? WRAP(__real_, BPY_THREAD_SAVE)() : nullptr; }

extern "C" bool WRAP(__real_, BPY_RUN_STRING_EXEC)(bContext *C, const char *imports[], const char *expr);
extern "C" bool WRAP(__wrap_, BPY_RUN_STRING_EXEC)(bContext *C, const char *imports[], const char *expr)
{
  return started() && WRAP(__real_, BPY_RUN_STRING_EXEC)(C, imports, expr);
}
extern "C" bool WRAP(__real_, BPY_RUN_STRING_EVAL)(bContext *C, const char *imports[], const char *expr);
extern "C" bool WRAP(__wrap_, BPY_RUN_STRING_EVAL)(bContext *C, const char *imports[], const char *expr)
{
  return started() && WRAP(__real_, BPY_RUN_STRING_EVAL)(C, imports, expr);
}

#define BPY_RUN_TEXT _ZN7blender12BPY_run_textEPNS_8bContextEPNS_4TextEPNS_10ReportListEb
/* port-override: a script run before Python starts asks for it and reports that it is starting. */
extern "C" bool WRAP(__real_, BPY_RUN_TEXT)(bContext *C, Text *text, ReportList *reports, bool do_jump);
extern "C" bool WRAP(__wrap_, BPY_RUN_TEXT)(bContext *C, Text *text, ReportList *reports, bool do_jump)
{
  if (started()) {
    return WRAP(__real_, BPY_RUN_TEXT)(C, text, reports, do_jump);
  }
  python_requested();
  BKE_report(reports, RPT_ERROR, "Python is starting, run the script again once it has");
  return false;
}

/* port-override: a file read before Python starts whose texts register as modules (Text.use_module) starts it where
 * scripts may run automatically, else they are blocked, as BPY_modules_load_user blocks them. */
extern "C" void WRAP(__real_, BPY_PYTHON_RESET)(bContext *C);
extern "C" void WRAP(__wrap_, BPY_PYTHON_RESET)(bContext *C)
{
  if (started()) {
    WRAP(__real_, BPY_PYTHON_RESET)(C);
    return;
  }
  for (const Text *text = static_cast<Text *>(CTX_data_main(C)->texts.first); text; text = static_cast<Text *>(text->id.next)) {
    if (!(text->flags & TXT_ISSCRIPT)) {
      continue;
    }
    if (G.f & G_FLAG_SCRIPT_AUTOEXEC) {
      python_requested();
      return;
    }
    G.f |= G_FLAG_SCRIPT_AUTOEXEC_FAIL;
    SNPRINTF_UTF8(G.autoexec_fail, "Text '%s'", text->id.name + 2);
  }
}

/* port-override: before Python starts, a typed value's expression (numinput.cc, ui_number_from_string) is evaluated by
 * Blender's Python-like expression evaluator (expr_pylike_eval.cc, which simple driver expressions use). */
extern "C" bool WRAP(__real_, BPY_RUN_STRING_AS_NUMBER)(bContext *C, const char *imports[], const char *expr, BPy_RunErrInfo *err_info,
                                                       double *r_value);
extern "C" bool WRAP(__wrap_, BPY_RUN_STRING_AS_NUMBER)(bContext *C, const char *imports[], const char *expr, BPy_RunErrInfo *err_info,
                                                       double *r_value)
{
  if (started()) {
    return WRAP(__real_, BPY_RUN_STRING_AS_NUMBER)(C, imports, expr, err_info, r_value);
  }
  ExprPyLike_Parsed *parsed = BLI_expr_pylike_parse(expr, nullptr, 0);
  const bool success = BLI_expr_pylike_is_valid(parsed) && BLI_expr_pylike_eval(parsed, nullptr, 0, r_value) == EXPR_PYLIKE_SUCCESS;
  BLI_expr_pylike_free(parsed);
  return success;
}

/* port-override: a driver Python must evaluate before it starts keeps its value and starts it where scripts may run
 * automatically; where they may not, it is blocked, as BPY_driver_exec blocks it. */
extern "C" float WRAP(__real_, BPY_DRIVER_EXEC)(PathResolvedRNA *anim_rna, ChannelDriver *driver, ChannelDriver *driver_orig,
                                               const AnimationEvalContext *anim_eval_context);
extern "C" float WRAP(__wrap_, BPY_DRIVER_EXEC)(PathResolvedRNA *anim_rna, ChannelDriver *driver, ChannelDriver *driver_orig,
                                               const AnimationEvalContext *anim_eval_context)
{
  if (started()) {
    return WRAP(__real_, BPY_DRIVER_EXEC)(anim_rna, driver, driver_orig, anim_eval_context);
  }
  if (!(G.f & G_FLAG_SCRIPT_AUTOEXEC)) {
    G.f |= G_FLAG_SCRIPT_AUTOEXEC_FAIL;
    SNPRINTF_UTF8(G.autoexec_fail, "Driver '%s'", driver_orig->expression);
    driver_orig->flag |= DRIVER_FLAG_PYTHON_BLOCKED;
    return 0.0f;
  }
  python_requested();
  return driver->curval;
}

/* port-override: an operator class's properties are defined by the Python that registered it (bpy_operator_wrap.cc's
 * operator_properties_init for CPython's, js_operator_properties_init for the transpiled tree's). */
extern "C" void WRAP(__real_, BPY_RNA_OPERATOR_WRAPPER)(wmOperatorType *ot, void *userdata);
extern "C" void WRAP(__wrap_, BPY_RNA_OPERATOR_WRAPPER)(wmOperatorType *ot, void *userdata)
{
  if (!js_extension(static_cast<wmOperatorType *>(userdata)->rna_ext)) {
    WRAP(__real_, BPY_RNA_OPERATOR_WRAPPER)(ot, userdata);
    return;
  }
  StructRNA *srna = ot->srna;
  *ot = std::move(*(static_cast<wmOperatorType *>(userdata)));
  ot->srna = srna;
  if (ot->rna_ext.srna) {
    RNA_def_struct_translation_context(ot->srna, RNA_struct_translation_context(ot->rna_ext.srna));
  }
  js_operator_properties_init(ot);
}
extern "C" void WRAP(__real_, BPY_RNA_OPERATOR_MACRO_WRAPPER)(wmOperatorType *ot, void *userdata);
extern "C" void WRAP(__wrap_, BPY_RNA_OPERATOR_MACRO_WRAPPER)(wmOperatorType *ot, void *userdata)
{
  const wmOperatorType *data = static_cast<wmOperatorType *>(userdata);
  if (!js_extension(data->rna_ext)) {
    WRAP(__real_, BPY_RNA_OPERATOR_MACRO_WRAPPER)(ot, userdata);
    return;
  }
  ot->name = data->name;
  ot->idname = data->idname;
  ot->description = data->description;
  ot->flag |= data->flag;
  ot->pyop_poll = data->pyop_poll;
  ot->ui = data->ui;
  ot->rna_ext = data->rna_ext;
  if (ot->rna_ext.srna) {
    RNA_def_struct_translation_context(ot->srna, RNA_struct_translation_context(ot->rna_ext.srna));
  }
  js_operator_properties_init(ot);
}
