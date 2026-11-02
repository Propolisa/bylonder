/* Operators of the transpiled tree's Python (src/python/bpy_rna.js) as Blender's operator types: rna_wm.cc registers
 * them as it registers CPython's (python.cc gives each Python its own operator_properties_init). Here are what bpy.ops
 * calls (bpy_operator.cc's poll and call) and the class's declared properties, which JS defines as bpy_props.cc does. */
#include <string>

#include "BKE_report.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "RNA_define.hh"
#include "WM_api.hh"
#include "WM_types.hh"

#include "rna-runtime.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

using namespace blender;

/* The class's declared properties on the operator's properties (pyrna_deferred_register_class), its bl_property
 * as the operator's main property (bpy_operator_property_set). */
IMPORT(bpy_class_define) void js_class_define(int cls, StructRNA *srna, wmOperatorType *ot);

/* An operator of a type registered after the module's own (a Python class's), by its Python idname, or null. */
EXPORT(operator_new_named) wmOperator *operator_new_named(const char *idname)
{
  wmOperatorType *ot = WM_operatortype_find(idname, true);
  return ot ? operator_create(ot) : nullptr;
}

/* bpy.ops's poll (pyop_poll): whether an operator by its Python idname polls in the call context (wm::OpCallContext). */
EXPORT(bpy_operator_poll) bool bpy_operator_poll(bContext *C, const char *idname, int context)
{
  wmOperatorType *ot = WM_operatortype_find(idname, true);
  return ot && WM_operator_poll_context(C, ot, wm::OpCallContext(context));
}

/* bpy.ops's call (pyop_call): the operator `op` holds the properties of (operator_new_named's, as Python's keywords set
 * them), run through WM_operator_call_py in the call context, so an invoke gets the window's current event and a modal
 * operator its handler in the window. Returns its wmOperatorStatus, or -1 when it does not poll; an error it reported
 * is bpy_operator_call_error's. */
static std::string call_error;
EXPORT(bpy_operator_call) int bpy_operator_call(bContext *C, wmOperator *op, int context)
{
  call_error.clear();
  if (!WM_operator_poll_context(C, op->type, wm::OpCallContext(context))) {
    return -1;
  }
  ReportList *reports = MEM_new<ReportList>(__func__);
  BKE_reports_init(reports, RPT_STORE | RPT_OP_HOLD | RPT_PRINT_HANDLED_BY_OWNER);
  const wmOperatorStatus status = WM_operator_call_py(C, op->type, wm::OpCallContext(context), op->ptr, reports, true);
  if (const Report *report = BKE_reports_last_displayable(reports); report && report->type >= RPT_ERROR) {
    call_error = report->message;
  }
  BKE_reports_clear(reports);
  if ((reports->flag & RPT_FREE) == 0) {
    BKE_reports_free(reports);
    MEM_delete(reports);
  }
  else {
    /* The window manager runs the modal operator now, and shows its reports. */
    reports->flag &= ~RPT_OP_HOLD;
  }
  return int(status);
}
EXPORT(bpy_operator_call_error) const char *bpy_operator_call_error() { return call_error.c_str(); }

EXPORT(bpy_operator_property_set) void bpy_operator_property_set(wmOperatorType *ot, const char *name)
{
  PointerRNA ptr = RNA_pointer_create_discrete(nullptr, ot->srna, nullptr);
  ot->prop = RNA_struct_find_property(&ptr, name);
}

namespace blender {

/* bpy_operator_wrap.cc's operator_properties_init, for a class of the transpiled tree. */
void js_operator_properties_init(wmOperatorType *ot)
{
  RNA_struct_blender_type_set(ot->rna_ext.srna, ot);
  RNA_def_struct_identifier_no_struct_map(ot->srna, ot->idname);
  js_class_define(int(intptr_t(ot->rna_ext.data)), ot->srna, ot);
}

}  // namespace blender
