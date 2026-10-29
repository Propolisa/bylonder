/* Operators of Blender's Python as Blender's operator types: rna_wm.cc's registration of Operator and Macro subclasses
 * and their callbacks, and bpy_operator_wrap.cc's wrapper, which Blender builds only with Python (WITH_PYTHON); the
 * module is built without it (its Python is transpiled), so they are here, as Blender has them, with the class's
 * declared properties defined by JS (bpy_rna.js) as bpy_props.cc defines them. */
#include "BKE_main.hh"
#include "BKE_report.hh"
#include "BKE_screen.hh"
#include "BLI_string.h"
#include "BLI_string_utils.hh"
#include "BLT_translation.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "RNA_define.hh"
#include "RNA_enum_types.hh"
#include "RNA_prototypes.hh"
#include "UI_interface.hh"
#include "WM_api.hh"
#include "WM_types.hh"

#include "rna-runtime.hh"
#include "rna_internal_types.hh"

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

EXPORT(bpy_operator_property_set) void bpy_operator_property_set(wmOperatorType *ot, const char *name)
{
  PointerRNA ptr = RNA_pointer_create_discrete(nullptr, ot->srna, nullptr);
  ot->prop = RNA_struct_find_property(&ptr, name);
}

namespace blender {

/* A callback of the class: its function by name, called with the context (and the event), its result read. */
static FunctionRNA *function(const char *name) { return RNA_struct_find_function(RNA_Operator, name); }
static PointerRNA operator_pointer(wmOperator *op)
{
  return RNA_pointer_create_discrete(op->ptr ? op->ptr->owner_id : nullptr, op->type->rna_ext.srna, op);
}
template<typename T>
static T call(bContext *C, PointerRNA &ptr, const ExtensionRNA &ext, const char *name, const wmEvent *event, bool *r_error = nullptr)
{
  ParameterList list;
  FunctionRNA *func = function(name);
  RNA_parameter_list_create(&list, &ptr, func);
  RNA_parameter_set_lookup(&list, "context", &C);
  if (event) {
    RNA_parameter_set_lookup(&list, "event", &event);
  }
  const bool error = ext.call(C, &ptr, func, &list) == -1;
  if (r_error) {
    *r_error = error;
  }
  if constexpr (std::is_void_v<T>) {
    RNA_parameter_list_free(&list);
  }
  else {
    void *ret;
    RNA_parameter_get_lookup(&list, STREQ(name, "poll") ? "visible" : "result", &ret);
    const T result = *static_cast<T *>(ret);
    RNA_parameter_list_free(&list);
    return result;
  }
}

static bool rna_operator_poll_cb(bContext *C, wmOperatorType *ot)
{
  PointerRNA ptr = RNA_pointer_create_discrete(nullptr, ot->rna_ext.srna, nullptr);
  return call<bool>(C, ptr, ot->rna_ext, "poll", nullptr);
}
static wmOperatorStatus status_after(wmOperator *op, int result, bool error)
{
  if (UNLIKELY(error)) {
    /* A modal handler may have been added, ensure this is removed, see: #113479. */
    WM_event_remove_modal_handler_all(op, false);
  }
  return wmOperatorStatus(result);
}
static wmOperatorStatus rna_operator_exec_cb(bContext *C, wmOperator *op)
{
  PointerRNA ptr = operator_pointer(op);
  bool error;
  const int result = call<int>(C, ptr, op->type->rna_ext, "execute", nullptr, &error);
  return status_after(op, result, error);
}
static bool rna_operator_check_cb(bContext *C, wmOperator *op)
{
  PointerRNA ptr = operator_pointer(op);
  return call<bool>(C, ptr, op->type->rna_ext, "check", nullptr);
}
static wmOperatorStatus rna_operator_invoke_cb(bContext *C, wmOperator *op, const wmEvent *event)
{
  PointerRNA ptr = operator_pointer(op);
  bool error;
  const int result = call<int>(C, ptr, op->type->rna_ext, "invoke", event, &error);
  return status_after(op, result, error);
}
static wmOperatorStatus rna_operator_modal_cb(bContext *C, wmOperator *op, const wmEvent *event)
{
  PointerRNA ptr = operator_pointer(op);
  return wmOperatorStatus(call<int>(C, ptr, op->type->rna_ext, "modal", event));
}
static void rna_operator_draw_cb(bContext *C, wmOperator *op)
{
  PointerRNA ptr = operator_pointer(op);
  call<void>(C, ptr, op->type->rna_ext, "draw", nullptr);
}
static void rna_operator_cancel_cb(bContext *C, wmOperator *op)
{
  PointerRNA ptr = operator_pointer(op);
  call<void>(C, ptr, op->type->rna_ext, "cancel", nullptr);
}
static std::string rna_operator_description_cb(bContext *C, wmOperatorType *ot, PointerRNA *prop_ptr)
{
  ParameterList list;
  FunctionRNA *func = function("description");
  PointerRNA ptr = RNA_pointer_create_discrete(nullptr, ot->rna_ext.srna, nullptr);
  RNA_parameter_list_create(&list, &ptr, func);
  RNA_parameter_set_lookup(&list, "context", &C);
  RNA_parameter_set_lookup(&list, "properties", prop_ptr);
  ot->rna_ext.call(C, &ptr, func, &list);
  void *ret;
  RNA_parameter_get_lookup(&list, "result", &ret);
  std::string result = ret ? std::string(static_cast<const char *>(ret)) : "";
  RNA_parameter_list_free(&list);
  return result;
}

/* bpy_operator_wrap.cc's operator_properties_init. */
static void operator_properties_init(wmOperatorType *ot)
{
  RNA_struct_blender_type_set(ot->rna_ext.srna, ot);
  RNA_def_struct_identifier_no_struct_map(ot->srna, ot->idname);
  js_class_define(int(intptr_t(ot->rna_ext.data)), ot->srna, ot);
}
static void operator_wrapper(wmOperatorType *ot, void *userdata)
{
  StructRNA *srna = ot->srna;
  *ot = std::move(*(static_cast<wmOperatorType *>(userdata)));
  ot->srna = srna;
  if (ot->rna_ext.srna) {
    RNA_def_struct_translation_context(ot->srna, RNA_struct_translation_context(ot->rna_ext.srna));
  }
  operator_properties_init(ot);
}
static void operator_macro_wrapper(wmOperatorType *ot, void *userdata)
{
  wmOperatorType *data = static_cast<wmOperatorType *>(userdata);
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
  operator_properties_init(ot);
}

static bool rna_Operator_unregister(Main *bmain, StructRNA *type)
{
  wmOperatorType *ot = static_cast<wmOperatorType *>(RNA_struct_blender_type_get(type));
  if (!ot) {
    return false;
  }
  ui::refresh_for_srna_unregister(bmain, ot->srna);
  ui::refresh_for_srna_unregister(bmain, type);
  if (wmWindowManager *wm = static_cast<wmWindowManager *>(bmain->wm.first)) {
    WM_operator_stack_clear(wm);
    WM_operator_handlers_clear(wm, ot);
  }
  WM_main_add_notifier(NC_SCREEN | NA_EDITED, nullptr);
  RNA_struct_free_extension(type, &ot->rna_ext);
  const char *idname = ot->idname;
  WM_operatortype_remove_ptr(ot);
  RNA_struct_free(&RNA_blender_rna_get(), type);
  MEM_delete(idname);
  return true;
}

static void **rna_Operator_instance(PointerRNA *ptr) { return &static_cast<wmOperator *>(ptr->data)->py_instance; }

/* The settings an operator class gives (bl_idname, bl_label, ...), validated into a dummy type, then a new type of the
 * class's, its callbacks the class's functions it has (rna_Operator_register and rna_MacroOperator_register). */
static StructRNA *operator_register(Main *bmain, ReportList *reports, void *data, const char *identifier, StructValidateFunc validate,
                                    StructCallbackFunc call, StructFreeFunc free, bool macro)
{
  const char *error_prefix = macro ? "Registering operator macro class:" : "Registering operator class:";
  wmOperatorType dummy_ot = {nullptr};
  wmOperator dummy_operator = {nullptr};
  bool have_function[8] = {};
  struct {
    char idname[OP_MAX_TYPENAME];
    char name[OP_MAX_TYPENAME];
    char description[RNA_DYN_DESCR_MAX];
    char translation_context[BKE_ST_MAXNAME];
    char undo_group[OP_MAX_TYPENAME];
  } temp_buffers;
  dummy_operator.type = &dummy_ot;
  dummy_ot.idname = temp_buffers.idname;
  dummy_ot.name = temp_buffers.name;
  dummy_ot.description = temp_buffers.description;
  dummy_ot.translation_context = temp_buffers.translation_context;
  dummy_ot.undo_group = temp_buffers.undo_group;
  PointerRNA dummy_operator_ptr = RNA_pointer_create_discrete(nullptr, macro ? RNA_Macro : RNA_Operator, &dummy_operator);
  temp_buffers.idname[0] = temp_buffers.name[0] = temp_buffers.description[0] = temp_buffers.undo_group[0] =
      temp_buffers.translation_context[0] = '\0';
  if (validate(&dummy_operator_ptr, data, have_function) != 0) {
    return nullptr;
  }
  if (wmOperatorType *ot = WM_operatortype_find(dummy_ot.idname, true)) {
    BKE_reportf(reports, RPT_INFO, "%s '%s', bl_idname '%s' has been registered before, unregistering previous", error_prefix, identifier,
                dummy_ot.idname);
    StructRNA *srna = ot->rna_ext.srna;
    if (!(srna && rna_Operator_unregister(bmain, srna))) {
      BKE_reportf(reports, RPT_ERROR, "%s '%s', bl_idname '%s' %s", error_prefix, identifier, dummy_ot.idname,
                  srna ? "is built-in" : "could not be unregistered");
      return nullptr;
    }
  }
  if (!WM_operator_py_idname_ok_or_report(reports, identifier, dummy_ot.idname)) {
    return nullptr;
  }
  char idname_conv[sizeof(dummy_operator.idname)];
  WM_operator_bl_idname(idname_conv, dummy_ot.idname);
  if (!RNA_struct_available_or_report(reports, idname_conv)) {
    return nullptr;
  }
  if (temp_buffers.translation_context[0] == '\0') {
    STRNCPY(temp_buffers.translation_context, BLT_I18NCONTEXT_OPERATOR_DEFAULT);
  }
  {
    const char *strings[] = {idname_conv, temp_buffers.name, temp_buffers.description, temp_buffers.translation_context,
                             temp_buffers.undo_group};
    char *strings_table[ARRAY_SIZE(strings)];
    BLI_string_join_array_by_sep_char_with_tableN('\0', strings_table, strings, ARRAY_SIZE(strings));
    dummy_ot.idname = strings_table[0];
    dummy_ot.name = strings_table[1];
    dummy_ot.description = *strings_table[2] ? strings_table[2] : nullptr;
    dummy_ot.translation_context = strings_table[3];
    dummy_ot.undo_group = strings_table[4];
  }
  dummy_ot.rna_ext.srna = RNA_def_struct_ptr(&RNA_blender_rna_get(), dummy_ot.idname, RNA_Operator);
  if (!macro) {
    RNA_def_struct_flag(dummy_ot.rna_ext.srna, STRUCT_NO_IDPROPERTIES);
    RNA_def_struct_property_tags(dummy_ot.rna_ext.srna, rna_enum_operator_property_tag_items);
  }
  RNA_def_struct_translation_context(dummy_ot.rna_ext.srna, dummy_ot.translation_context);
  dummy_ot.rna_ext.data = data;
  dummy_ot.rna_ext.call = call;
  dummy_ot.rna_ext.free = free;
  dummy_ot.pyop_poll = have_function[0] ? rna_operator_poll_cb : nullptr;
  if (macro) {
    dummy_ot.ui = have_function[1] ? rna_operator_draw_cb : nullptr;
    WM_operatortype_append_macro_ptr(operator_macro_wrapper, static_cast<void *>(&dummy_ot));
  }
  else {
    dummy_ot.exec = have_function[1] ? rna_operator_exec_cb : nullptr;
    dummy_ot.check = have_function[2] ? rna_operator_check_cb : nullptr;
    dummy_ot.invoke = have_function[3] ? rna_operator_invoke_cb : nullptr;
    dummy_ot.modal = have_function[4] ? rna_operator_modal_cb : nullptr;
    dummy_ot.ui = have_function[5] ? rna_operator_draw_cb : nullptr;
    dummy_ot.cancel = have_function[6] ? rna_operator_cancel_cb : nullptr;
    dummy_ot.get_description = have_function[7] ? rna_operator_description_cb : nullptr;
    WM_operatortype_append_ptr(operator_wrapper, static_cast<void *>(&dummy_ot));
  }
  WM_main_add_notifier(NC_SCREEN | NA_EDITED, nullptr);
  return dummy_ot.rna_ext.srna;
}
static StructRNA *rna_Operator_register(Main *bmain, ReportList *reports, void *data, const char *identifier,
                                        StructValidateFunc validate, StructCallbackFunc call, StructFreeFunc free)
{
  return operator_register(bmain, reports, data, identifier, validate, call, free, false);
}
static StructRNA *rna_MacroOperator_register(Main *bmain, ReportList *reports, void *data, const char *identifier,
                                             StructValidateFunc validate, StructCallbackFunc call, StructFreeFunc free)
{
  return operator_register(bmain, reports, data, identifier, validate, call, free, true);
}

/* Operator and Macro become registrable, as rna_wm.cc's definitions make them with Python
 * (RNA_def_struct_register_funcs). */
void operator_registration_ensure()
{
  for (StructRNA *srna : {RNA_Operator, RNA_Macro}) {
    srna->reg = srna == RNA_Operator ? rna_Operator_register : rna_MacroOperator_register;
    srna->unreg = rna_Operator_unregister;
    srna->instance = rna_Operator_instance;
  }
}

}  // namespace blender
