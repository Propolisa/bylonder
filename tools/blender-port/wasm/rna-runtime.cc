/* Operators and properties as JS drives them, over Blender's own RNA (its generated definitions and rna_access) and
 * window manager: operator instances with IDProperty values, property access by identifier, and the custom properties
 * Bylonder animates. */
#include <algorithm>
#include <cstring>
#include <map>
#include <string>

#include "BKE_idprop.hh"
#include "BKE_report.hh"
#include "BLI_listbase.h"
#include "BLI_string.h"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "RNA_path.hh"
#include "WM_api.hh"
#include "WM_types.hh"

#include "rna-runtime.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace blender {

wmOperator *operator_create(wmOperatorType *ot, const IDProperty *values)
{
  wmOperator *op = MEM_new<wmOperator>(__func__);
  op->type = ot;
  STRNCPY(op->idname, ot->idname);
  op->properties = values ? IDP_CopyProperty(values) : nullptr;
  WM_operator_properties_alloc(&op->ptr, &op->properties, ot->idname);
  op->reports = MEM_new<ReportList>(__func__);
  BKE_reports_init(op->reports, RPT_STORE);
  operator_macro_fill(op);
  return op;
}

/* A macro's operators, in order, each with its properties from the macro's and the macro type's fixed values (as
 * wm_operator_create fills op->macro); made again after the macro's properties change. */
void operator_macro_fill(wmOperator *op)
{
  while (wmOperator *opm = static_cast<wmOperator *>(BLI_pophead(&op->macro))) {
    operator_destroy(opm);
  }
  wmOperatorTypeMacro *otmacro = static_cast<wmOperatorTypeMacro *>(op->type->macro.first);
  RNA_STRUCT_BEGIN (op->ptr, prop) {
    if (otmacro == nullptr) {
      break;
    }
    if (STREQ(RNA_property_identifier(prop), otmacro->idname)) {
      PointerRNA values_ptr = RNA_property_pointer_get(op->ptr, prop);
      wmOperator *opm = operator_create(WM_operatortype_find(otmacro->idname, false), static_cast<IDProperty *>(values_ptr.data));
      IDP_ReplaceGroupInGroup(opm->properties, otmacro->properties);
      BLI_addtail(&op->macro, opm);
      opm->opm = op;
      otmacro = otmacro->next;
    }
  }
  RNA_STRUCT_END;
}

void operator_destroy(wmOperator *op)
{
  while (wmOperator *opm = static_cast<wmOperator *>(BLI_pophead(&op->macro))) {
    operator_destroy(opm);
  }
  WM_operator_properties_free(op->ptr);
  MEM_delete(op->ptr);
  BKE_reports_free(op->reports);
  MEM_delete(op->reports);
  MEM_delete(op);
}

/* One element of a number, boolean or enum property as a number. */
static double element(PointerRNA *ptr, PropertyRNA *prop, int index)
{
  const bool array = RNA_property_array_check(prop);
  switch (RNA_property_type(prop)) {
    case PROP_BOOLEAN:
      return array ? RNA_property_boolean_get_index(ptr, prop, index) : RNA_property_boolean_get(ptr, prop);
    case PROP_INT:
      return array ? RNA_property_int_get_index(ptr, prop, index) : RNA_property_int_get(ptr, prop);
    case PROP_FLOAT:
      return array ? RNA_property_float_get_index(ptr, prop, index) : RNA_property_float_get(ptr, prop);
    case PROP_ENUM:
      return RNA_property_enum_get(ptr, prop);
    default:
      return 0.0;
  }
}

/* As a button sets a number (ui_but_value_set): clamped to the property's range. */
/* Set as bpy sets it: RNA clamps to the property's range (also where a range function gives min > max). */
static void set_element(PointerRNA *ptr, PropertyRNA *prop, int index, double value)
{
  const bool array = RNA_property_array_check(prop);
  switch (RNA_property_type(prop)) {
    case PROP_BOOLEAN:
      array ? RNA_property_boolean_set_index(ptr, prop, index, value != 0.0) : RNA_property_boolean_set(ptr, prop, value != 0.0);
      break;
    case PROP_INT:
      array ? RNA_property_int_set_index(ptr, prop, index, int(value)) : RNA_property_int_set(ptr, prop, int(value));
      break;
    case PROP_FLOAT:
      array ? RNA_property_float_set_index(ptr, prop, index, float(value)) : RNA_property_float_set(ptr, prop, float(value));
      break;
    case PROP_ENUM:
      RNA_property_enum_set(ptr, prop, int(value));
      break;
    default:
      break;
  }
}

/* The context properties are set in, for enums whose items depend on it, as bpy's BPY_context_get. */
static bContext *property_context = nullptr;
EXPORT(rna_context_set) void rna_context_set(bContext *C) { property_context = C; }

bool operator_property_set(PointerRNA *ptr, const char *name, const double *numbers, int len, const char *text)
{
  /* A macro's operator's property, as "TRANSFORM_OT_translate.value". */
  if (const char *dot = strchr(name, '.')) {
    PointerRNA sub = RNA_pointer_get(ptr, std::string(name, dot).c_str());
    return sub.data && operator_property_set(&sub, dot + 1, numbers, len, text);
  }
  PropertyRNA *prop = RNA_struct_find_property(ptr, name);
  if (!prop) {
    return false;
  }
  if (!text) {
    for (int i = 0; i < len; i++) {
      set_element(ptr, prop, i, numbers[i]);
    }
    return true;
  }
  if (RNA_property_type(prop) == PROP_STRING) {
    RNA_property_string_set(ptr, prop, text);
    return true;
  }
  /* Enum identifiers, comma separated for a flag enum. */
  int value = 0;
  const std::string identifiers = text;
  for (size_t start = 0, end; start <= identifiers.size(); start = end + 1) {
    end = std::min(identifiers.find(',', start), identifiers.size());
    const std::string identifier = identifiers.substr(start, end - start);
    int item;
    if (identifier.empty()) {
      continue;
    }
    if (!RNA_property_enum_value(property_context, ptr, prop, identifier.c_str(), &item)) {
      return false;
    }
    value |= item;
  }
  RNA_property_enum_set(ptr, prop, value);
  return true;
}

std::string operator_values_json(PointerRNA *ptr)
{
  std::string json = "{";
  const auto number = [](PropertyType type, double x) {
    char text[32];
    snprintf(text, sizeof(text), type == PROP_BOOLEAN ? (x != 0.0 ? "true" : "false") : "%.9g", x);
    return std::string(text);
  };
  RNA_STRUCT_BEGIN (ptr, prop) {
    if (!RNA_property_is_set(ptr, prop)) {
      continue;
    }
    const PropertyType type = RNA_property_type(prop);
    json += (json.size() > 1 ? ",\"" : "\"") + std::string(RNA_property_identifier(prop)) + "\":";
    if (type == PROP_STRING) {
      json += "\"" + std::string(RNA_property_string_get(ptr, prop)) + "\"";
    }
    else if (type == PROP_POINTER) {
      if (STREQ(RNA_property_identifier(prop), "rna_type")) {
        json += "null";
        continue;
      }
      /* A macro's operator's properties. */
      PointerRNA values = RNA_property_pointer_get(ptr, prop);
      json += values.data ? operator_values_json(&values) : "null";
    }
    else if (type == PROP_ENUM) {
      const char *identifier = nullptr;
      RNA_property_enum_identifier(property_context, ptr, prop, RNA_property_enum_get(ptr, prop), &identifier);
      json += identifier ? "\"" + std::string(identifier) + "\"" : number(type, RNA_property_enum_get(ptr, prop));
    }
    else if (RNA_property_array_check(prop)) {
      json += "[";
      for (int i = 0, n = RNA_property_array_length(ptr, prop); i < n; i++) {
        json += (i ? "," : "") + number(type, element(ptr, prop, i));
      }
      json += "]";
    }
    else {
      json += number(type, element(ptr, prop, 0));
    }
  }
  RNA_STRUCT_END;
  return json + "}";
}

/* Custom properties (`["name"]` paths) Bylonder animates, by path: an ID property named as the editors show the channel.
 * port-override: Blender stores them on the ID, by a name of at most 63 characters; Bylonder's paths are longer, so they
 * resolve here (the wrapped RNA_path_resolve_property below), to a property the animation editors name and type. */
static std::map<std::string, IDProperty *> &custom_properties()
{
  static std::map<std::string, IDProperty *> properties;
  return properties;
}

EXPORT(rna_custom_property_define) void rna_custom_property_define(const char *path, int type, const char *name)
{
  IDProperty *&prop = custom_properties()[path];
  if (prop) {
    IDP_FreeProperty(prop);
  }
  prop = type == PROP_BOOLEAN ? bke::idprop::create_bool(name, false).release()
         : type == PROP_INT   ? bke::idprop::create(name, 0).release()
                              : bke::idprop::create(name, 0.0).release();
}

/* Blender's RNA defines every ID type's properties itself. */
EXPORT(rna_id_property_define) void rna_id_property_define(short, const char *, int, int, int, const char *) {}

EXPORT(rna_struct_find) StructRNA *rna_struct_find(const char *identifier) { return RNA_struct_find(identifier); }

static PointerRNA js_pointer(StructRNA *type, ID *id, void *data) { return RNA_pointer_create_discrete(id, type, data); }

EXPORT(rna_length) int rna_length(StructRNA *type, ID *id, void *data, const char *name)
{
  PointerRNA ptr = js_pointer(type, id, data);
  PropertyRNA *prop = RNA_struct_find_property(&ptr, name);
  return !prop ? -1 : RNA_property_type(prop) == PROP_STRING ? RNA_property_string_length(&ptr, prop) : RNA_property_array_length(&ptr, prop);
}

EXPORT(rna_get) double rna_get(StructRNA *type, ID *id, void *data, const char *name, int index)
{
  PointerRNA ptr = js_pointer(type, id, data);
  PropertyRNA *prop = RNA_struct_find_property(&ptr, name);
  return prop ? element(&ptr, prop, std::max(index, 0)) : 0.0;
}

EXPORT(rna_set) void rna_set(bContext *C, StructRNA *type, ID *id, void *data, const char *name, int index, double value)
{
  PointerRNA ptr = js_pointer(type, id, data);
  if (PropertyRNA *prop = RNA_struct_find_property(&ptr, name)) {
    set_element(&ptr, prop, std::max(index, 0), value);
    RNA_property_update(C, &ptr, prop);
  }
}

/* FCurve.update(), as Python calls it: the keys sorted, duplicates removed and handles recalculated. */
EXPORT(rna_fcurve_update) void rna_fcurve_update(bContext *C, ID *id, FCurve *fcu)
{
  PointerRNA ptr = RNA_pointer_create_discrete(id, RNA_struct_find("FCurve"), fcu);
  FunctionRNA *func = RNA_struct_find_function(ptr.type, "update");
  ParameterList parameters;
  RNA_parameter_list_create(&parameters, &ptr, func);
  RNA_function_call(C, nullptr, &ptr, func, &parameters);
  RNA_parameter_list_free(&parameters);
}

EXPORT(rna_string_get) const char *rna_string_get(StructRNA *type, ID *id, void *data, const char *name)
{
  static std::string value;
  PointerRNA ptr = js_pointer(type, id, data);
  PropertyRNA *prop = RNA_struct_find_property(&ptr, name);
  const char *identifier = nullptr;
  if (prop && RNA_property_type(prop) == PROP_ENUM) {
    /* An enum by its item's identifier. */
    RNA_property_enum_identifier(nullptr, &ptr, prop, RNA_property_enum_get(&ptr, prop), &identifier);
    value = identifier ? identifier : "";
  }
  else {
    value = prop ? RNA_property_string_get(&ptr, prop) : "";
  }
  return value.c_str();
}

EXPORT(rna_string_set) void rna_string_set(bContext *C, StructRNA *type, ID *id, void *data, const char *name, const char *value)
{
  PointerRNA ptr = js_pointer(type, id, data);
  if (PropertyRNA *prop = RNA_struct_find_property(&ptr, name)) {
    int item;
    if (RNA_property_type(prop) != PROP_ENUM) {
      RNA_property_string_set(&ptr, prop, value);
    }
    else if (RNA_property_enum_value(C, &ptr, prop, value, &item)) {
      RNA_property_enum_set(&ptr, prop, item);
    }
    RNA_property_update(C, &ptr, prop);
  }
}

}  // namespace blender

/* port-override (above): a custom property's path resolves to its property, other paths as Blender resolves them.
 * Linked with --wrap of the mangled name. */
using namespace blender;
#define RESOLVE _ZN7blender25RNA_path_resolve_propertyEPKNS_10PointerRNAEPKcPS0_PPNS_11PropertyRNAE
#define WRAP_(prefix, name) prefix##name
#define WRAP(prefix, name) WRAP_(prefix, name)
extern "C" bool WRAP(__real_, RESOLVE)(const PointerRNA *ptr, const char *path, PointerRNA *r_ptr, PropertyRNA **r_prop);
extern "C" bool WRAP(__wrap_, RESOLVE)(const PointerRNA *ptr, const char *path, PointerRNA *r_ptr, PropertyRNA **r_prop)
{
  auto custom = custom_properties().find(path);
  if (custom == custom_properties().end()) {
    return WRAP(__real_, RESOLVE)(ptr, path, r_ptr, r_prop);
  }
  *r_ptr = *ptr;
  *r_prop = reinterpret_cast<PropertyRNA *>(custom->second);
  return true;
}
