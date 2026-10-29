/* Blender's bpy (python/intern/bpy_rna.cc, bpy_props.cc) over the module, for JS (src/python/bpy_rna.js): any RNA
 * property read and written, any RNA function called with a ParameterList, context members, and JS classes registered
 * as RNA extension types (Panel, Menu, Header, UIList, ...) whose functions Blender's code calls back into JS, as
 * bpy_class_call calls Python. A struct crosses as its PointerRNA's three words (type, owner ID, data); results that
 * are structs are written to `bpy_out`. */
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "BKE_context.hh"
#include "BKE_global.hh"
#include "BKE_report.hh"
#include "BLI_array.hh"
#include "BLI_listbase_iterator.hh"
#include "BLI_string.h"
#include "MEM_guardedalloc.h"
#include "DNA_ID.h"
#include "RNA_access.hh"
#include "RNA_path.hh"
#include "RNA_define.hh"
#include "RNA_enum_types.hh"
#include "RNA_prototypes.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

using namespace blender;

extern "C" const char *ui_icon_name(int icon);

/* Calls into JS, as bpy_rna.cc's bpy_class_validate, bpy_class_call and bpy_class_free call Python. */
IMPORT(bpy_class_validate) int js_class_validate(int cls, StructRNA *type, ID *id, void *data, bool *have_function);
IMPORT(bpy_class_call) int js_class_call(bContext *C, StructRNA *type, ID *id, void *data, FunctionRNA *func, ParameterList *parms);
IMPORT(bpy_class_free) void js_class_free(int cls);

/* Struct results: type, owner ID, data, then a property and an index for a context member that is one. */
static uintptr_t out[5];
EXPORT(bpy_out) uintptr_t *bpy_out() { return out; }

static void put(const PointerRNA &ptr)
{
  out[0] = uintptr_t(ptr.type);
  out[1] = uintptr_t(ptr.owner_id);
  out[2] = uintptr_t(ptr.data);
}

static PointerRNA pointer(StructRNA *type, ID *id, void *data) { return RNA_pointer_create_discrete(id, type, data); }

static std::string text_result;
static const char *text(std::string value)
{
  text_result = std::move(value);
  return text_result.c_str();
}

static std::string json_string(const char *value)
{
  std::string s = "\"";
  for (const char *c = value ? value : ""; *c; c++) {
    if (*c == '"' || *c == '\\') {
      s += '\\';
      s += *c;
    }
    else if (uchar(*c) < 0x20) {
      char buf[8];
      SNPRINTF(buf, "\\u%04x", *c);
      s += buf;
    }
    else {
      s += *c;
    }
  }
  return s + '"';
}

/* Structs. */

EXPORT(bpy_struct_identifier) const char *bpy_struct_identifier(StructRNA *type) { return RNA_struct_identifier(type); }
EXPORT(bpy_struct_base) StructRNA *bpy_struct_base(StructRNA *type) { return RNA_struct_base(type); }
EXPORT(bpy_struct_is_a) bool bpy_struct_is_a(StructRNA *type, StructRNA *base) { return RNA_struct_is_a(type, base); }
/* The JS class registered for a type (RNA_struct_py_type_get), or 0. */
EXPORT(bpy_struct_class) int bpy_struct_class(StructRNA *type) { return int(intptr_t(RNA_struct_py_type_get(type))); }
EXPORT(bpy_struct_name) const char *bpy_struct_name(StructRNA *type, ID *id, void *data)
{
  PointerRNA ptr = pointer(type, id, data);
  char *name = RNA_struct_name_get_alloc(&ptr, nullptr, 0, nullptr);
  text(name ? name : "");
  MEM_SAFE_DELETE(name);
  return text_result.c_str();
}
/* A struct's properties and functions, its bases' first: [identifier, ...] each. */
EXPORT(bpy_struct_members) const char *bpy_struct_members(StructRNA *type)
{
  std::string props, funcs;
  PointerRNA ptr = pointer(type, nullptr, nullptr);
  RNA_STRUCT_BEGIN (&ptr, prop) {
    props += (props.empty() ? "" : ",") + json_string(RNA_property_identifier(prop));
  }
  RNA_STRUCT_END;
  for (StructRNA *s = type; s; s = RNA_struct_base(s)) {
    for (const std::unique_ptr<FunctionRNA> &func : RNA_struct_type_functions(s)) {
      funcs += (funcs.empty() ? "" : ",") + json_string(RNA_function_identifier(func.get()));
    }
  }
  return text("{\"properties\":[" + props + "],\"functions\":[" + funcs + "]}");
}
/* Main as bpy.data (BlendData), and a context as bpy.context (Context). */
EXPORT(bpy_main) void bpy_main(bContext *C) { put(RNA_main_pointer_create(CTX_data_main(C))); }
EXPORT(bpy_context) void bpy_context(bContext *C) { put(RNA_pointer_create_discrete(nullptr, RNA_Context, C)); }
EXPORT(bpy_id_pointer) void bpy_id_pointer(ID *id) { put(RNA_id_pointer_create(id)); }
/* The struct `type`'s pointer to data (refined, as RNA refines a pointer to a base type). */
EXPORT(bpy_pointer) void bpy_pointer(StructRNA *type, ID *id, void *data) { put(pointer(type, id, data)); }

/* A JS instance kept with the data (an operator's, RNA_struct_instance), or 0. */
EXPORT(bpy_instance) int bpy_instance(StructRNA *type, ID *id, void *data)
{
  PointerRNA ptr = pointer(type, id, data);
  void **instance = RNA_struct_instance(&ptr);
  return instance ? int(intptr_t(*instance)) : 0;
}
EXPORT(bpy_instance_set) void bpy_instance_set(StructRNA *type, ID *id, void *data, int value)
{
  PointerRNA ptr = pointer(type, id, data);
  if (void **instance = RNA_struct_instance(&ptr)) {
    *instance = reinterpret_cast<void *>(intptr_t(value));
  }
}

/* Context members (bpy_rna's pyrna_struct_getattro for a Context): a pointer (1), a collection (2, its items by
 * bpy_context_item), a property (3: pointer, property, index), a string (4) or an int (5); 0 when not a member, -1 for
 * a member without data now (None). */
static Vector<PointerRNA> context_items;
static std::string context_string;
static int64_t context_int = 0;
EXPORT(bpy_context_member) int bpy_context_member(bContext *C, const char *name)
{
  PointerRNA ptr = {};
  PropertyRNA *prop = nullptr;
  int index = -1;
  StringRef str;
  std::optional<int64_t> int_value;
  ContextDataType type;
  context_items.clear();
  const int result = CTX_data_get(C, name, &ptr, &context_items, &prop, &index, &str, &int_value, &type);
  if (result != CTX_RESULT_OK) {
    return result == CTX_RESULT_NO_DATA ? -1 : 0;
  }
  switch (type) {
    case ContextDataType::Pointer:
      put(ptr);
      return 1;
    case ContextDataType::Collection:
      return 2;
    case ContextDataType::Property:
      put(ptr);
      out[3] = uintptr_t(prop);
      out[4] = uintptr_t(index);
      return 3;
    case ContextDataType::String:
      context_string = str;
      return 4;
    case ContextDataType::Int64:
      context_int = int_value.value_or(0);
      return 5;
  }
  return 0;
}
EXPORT(bpy_context_length) int bpy_context_length() { return int(context_items.size()); }
EXPORT(bpy_context_item) void bpy_context_item(int index) { put(context_items[index]); }
EXPORT(bpy_context_string) const char *bpy_context_string() { return context_string.c_str(); }
EXPORT(bpy_context_int) double bpy_context_int() { return double(context_int); }

/* Properties. */

EXPORT(bpy_property) PropertyRNA *bpy_property(StructRNA *type, ID *id, void *data, const char *name)
{
  PointerRNA ptr = pointer(type, id, data);
  return RNA_struct_find_property(&ptr, name);
}

enum { INFO_ENUM_FLAG = 1, INFO_EDITABLE = 2, INFO_IDPROP = 4, INFO_DYNAMIC = 8, INFO_NEVER_NULL = 16 };
/* A property's type (PropertyType), returning its subtype with its unit, array length, flags (INFO_*) and the struct
 * a pointer or collection holds in `out`. */
EXPORT(bpy_property_info) int bpy_property_info(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  const PropertyType kind = RNA_property_type(prop);
  const int flag = RNA_property_flag(prop);
  out[0] = uintptr_t(RNA_property_subtype(prop) | RNA_property_unit(prop));
  out[1] = uintptr_t(RNA_property_array_check(prop) ? RNA_property_array_length(&ptr, prop) : 0);
  out[2] = uintptr_t((kind == PROP_ENUM && (flag & PROP_ENUM_FLAG) ? INFO_ENUM_FLAG : 0) |
                     (data && RNA_property_editable(&ptr, prop) ? INFO_EDITABLE : 0) |
                     (RNA_property_is_idprop(prop) ? INFO_IDPROP : 0) | (flag & PROP_DYNAMIC ? INFO_DYNAMIC : 0) |
                     (flag & PROP_NEVER_NULL ? INFO_NEVER_NULL : 0));
  out[3] = uintptr_t(ELEM(kind, PROP_POINTER, PROP_COLLECTION) ? RNA_property_pointer_type(&ptr, prop) : nullptr);
  return kind;
}
EXPORT(bpy_property_identifier) const char *bpy_property_identifier(PropertyRNA *prop) { return RNA_property_identifier(prop); }

/* A boolean, int or float property's value, or its array's, into `values` (at most `capacity`); returns how many. */
EXPORT(bpy_numbers_get) int bpy_numbers_get(StructRNA *type, ID *id, void *data, PropertyRNA *prop, double *values, int capacity)
{
  PointerRNA ptr = pointer(type, id, data);
  const int len = RNA_property_array_check(prop) ? RNA_property_array_length(&ptr, prop) : 0;
  const PropertyType kind = RNA_property_type(prop);
  if (len == 0) {
    values[0] = kind == PROP_BOOLEAN ? RNA_property_boolean_get(&ptr, prop) :
                kind == PROP_INT     ? RNA_property_int_get(&ptr, prop) :
                                       RNA_property_float_get(&ptr, prop);
    return 1;
  }
  if (len > capacity) {
    return len;
  }
  if (kind == PROP_BOOLEAN) {
    Array<bool> array(len);
    RNA_property_boolean_get_array(&ptr, prop, array.data());
    std::copy_n(array.data(), len, values);
  }
  else if (kind == PROP_INT) {
    Array<int> array(len);
    RNA_property_int_get_array(&ptr, prop, array.data());
    std::copy_n(array.data(), len, values);
  }
  else {
    Array<float> array(len);
    RNA_property_float_get_array(&ptr, prop, array.data());
    std::copy_n(array.data(), len, values);
  }
  return len;
}

static void updated(bContext *C, PointerRNA *ptr, PropertyRNA *prop)
{
  if (C) {
    RNA_property_update(C, ptr, prop);
  }
}

/* Sets an element (`index`), or the whole value or array (index -1), as bpy sets one: then the property's update (with a
 * context; a class's registration sets its type's values without). JS checks that the property is editable first. */
EXPORT(bpy_numbers_set)
void bpy_numbers_set(bContext *C, StructRNA *type, ID *id, void *data, PropertyRNA *prop, int index, const double *values, int len)
{
  PointerRNA ptr = pointer(type, id, data);
  const PropertyType kind = RNA_property_type(prop);
  if (!RNA_property_array_check(prop)) {
    kind == PROP_BOOLEAN ? RNA_property_boolean_set(&ptr, prop, values[0] != 0.0) :
    kind == PROP_INT     ? RNA_property_int_set(&ptr, prop, int(values[0])) :
                           RNA_property_float_set(&ptr, prop, float(values[0]));
  }
  else if (index >= 0) {
    kind == PROP_BOOLEAN ? RNA_property_boolean_set_index(&ptr, prop, index, values[0] != 0.0) :
    kind == PROP_INT     ? RNA_property_int_set_index(&ptr, prop, index, int(values[0])) :
                           RNA_property_float_set_index(&ptr, prop, index, float(values[0]));
  }
  else {
    const int n = std::min(len, RNA_property_array_length(&ptr, prop));
    if (kind == PROP_BOOLEAN) {
      Array<bool> array(RNA_property_array_length(&ptr, prop));
      RNA_property_boolean_get_array(&ptr, prop, array.data());
      std::transform(values, values + n, array.data(), [](double v) { return v != 0.0; });
      RNA_property_boolean_set_array(&ptr, prop, array.data());
    }
    else if (kind == PROP_INT) {
      Array<int> array(RNA_property_array_length(&ptr, prop));
      RNA_property_int_get_array(&ptr, prop, array.data());
      std::transform(values, values + n, array.data(), [](double v) { return int(v); });
      RNA_property_int_set_array(&ptr, prop, array.data());
    }
    else {
      Array<float> array(RNA_property_array_length(&ptr, prop));
      RNA_property_float_get_array(&ptr, prop, array.data());
      std::transform(values, values + n, array.data(), [](double v) { return float(v); });
      RNA_property_float_set_array(&ptr, prop, array.data());
    }
  }
  updated(C, &ptr, prop);
}

/* Enum identifiers for a value: one, or a flag enum's comma separated. */
static std::string enum_identifiers(bContext *C, PointerRNA *ptr, PropertyRNA *prop, int value)
{
  if (!(RNA_property_flag(prop) & PROP_ENUM_FLAG)) {
    const char *identifier = nullptr;
    return RNA_property_enum_identifier(C, ptr, prop, value, &identifier) ? identifier : "";
  }
  const char *identifiers[RNA_ENUM_BITFLAG_SIZE + 1] = {};
  RNA_property_enum_bitflag_identifiers(C, ptr, prop, value, identifiers);
  std::string list;
  for (const char **id = identifiers; *id; id++) {
    list += (list.empty() ? "" : ",") + std::string(*id);
  }
  return list;
}
/* An enum value from identifiers (comma separated for a flag enum); false for an identifier it lacks. */
static bool enum_value(bContext *C, PointerRNA *ptr, PropertyRNA *prop, const char *identifiers, int *r_value)
{
  *r_value = 0;
  const std::string list = identifiers;
  for (size_t start = 0, end; start <= list.size(); start = end + 1) {
    end = std::min(list.find(',', start), list.size());
    const std::string identifier = list.substr(start, end - start);
    int item;
    if (identifier.empty()) {
      continue;
    }
    if (!RNA_property_enum_value(C, ptr, prop, identifier.c_str(), &item)) {
      return false;
    }
    *r_value |= item;
  }
  return true;
}

EXPORT(bpy_enum_get) const char *bpy_enum_get(bContext *C, StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  return text(enum_identifiers(C, &ptr, prop, RNA_property_enum_get(&ptr, prop)));
}
/* False for an identifier the property lacks. */
EXPORT(bpy_enum_set) bool bpy_enum_set(bContext *C, StructRNA *type, ID *id, void *data, PropertyRNA *prop, const char *identifiers)
{
  PointerRNA ptr = pointer(type, id, data);
  int value;
  if (!enum_value(C, &ptr, prop, identifiers, &value)) {
    return false;
  }
  RNA_property_enum_set(&ptr, prop, value);
  updated(C, &ptr, prop);
  return true;
}
/* An enum's items as JSON: [identifier, name, description, icon, value] each, null for a separator. */
EXPORT(bpy_enum_items) const char *bpy_enum_items(bContext *C, StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  const EnumPropertyItem *items;
  int count;
  bool free;
  RNA_property_enum_items(C, &ptr, prop, &items, &count, &free);
  std::string json = "[";
  for (int i = 0; i < count; i++) {
    const EnumPropertyItem &item = items[i];
    json += i ? "," : "";
    if (!item.identifier[0]) {
      json += item.name ? "[\"\"," + json_string(item.name) + "]" : "null";
      continue;
    }
    json += "[" + json_string(item.identifier) + "," + json_string(item.name) + "," + json_string(item.description) + "," +
            json_string(ui_icon_name(item.icon)) + "," + std::to_string(item.value) + "]";
  }
  if (free) {
    MEM_delete(const_cast<EnumPropertyItem *>(items));
  }
  return text(json + "]");
}

EXPORT(bpy_string_get) const char *bpy_string_get(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  return text(RNA_property_string_get(&ptr, prop));
}
EXPORT(bpy_string_set) void bpy_string_set(bContext *C, StructRNA *type, ID *id, void *data, PropertyRNA *prop, const char *value)
{
  PointerRNA ptr = pointer(type, id, data);
  RNA_property_string_set(&ptr, prop, value);
  updated(C, &ptr, prop);
}

/* A pointer property's struct into `out`; false when it points to nothing. */
EXPORT(bpy_pointer_get) bool bpy_pointer_get(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  const PointerRNA value = RNA_property_pointer_get(&ptr, prop);
  put(value);
  return value.data != nullptr;
}
EXPORT(bpy_pointer_set)
bool bpy_pointer_set(bContext *C, StructRNA *type, ID *id, void *data, PropertyRNA *prop, StructRNA *vtype, ID *vid, void *vdata)
{
  PointerRNA ptr = pointer(type, id, data);
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  RNA_property_pointer_set(&ptr, prop, vdata ? pointer(vtype, vid, vdata) : PointerRNA_NULL, &reports);
  const bool ok = !BKE_reports_contain(&reports, RPT_ERROR);
  BKE_reports_free(&reports);
  updated(C, &ptr, prop);
  return ok;
}

/* bpy_struct's own methods (pyrna_struct_path_resolve, is_property_set, path_from_id, keys). */

/* A path from a struct: 0 when it does not resolve, 1 for a struct (into `out`), 2 for a property (its struct, then the
 * property and index, into `out`). */
EXPORT(bpy_path_resolve) int bpy_path_resolve(StructRNA *type, ID *id, void *data, const char *path)
{
  PointerRNA ptr = pointer(type, id, data), r_ptr;
  PropertyRNA *prop;
  int index = -1;
  if (!RNA_path_resolve_full_maybe_null(&ptr, path, &r_ptr, &prop, &index)) {
    return 0;
  }
  put(r_ptr);
  out[3] = uintptr_t(prop);
  out[4] = uintptr_t(index);
  return prop ? 2 : 1;
}
EXPORT(bpy_property_is_set) bool bpy_property_is_set(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  return RNA_property_is_set(&ptr, prop);
}
EXPORT(bpy_property_unset) void bpy_property_unset(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  RNA_property_unset(&ptr, prop);
}
/* The path from the struct's ID to it, or to its property `prop` when given; null when there is none. */
EXPORT(bpy_path_from_id) const char *bpy_path_from_id(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  const std::optional<std::string> path = prop ? RNA_path_from_ID_to_property(&ptr, prop) : RNA_path_from_ID_to_struct(&ptr);
  return path ? text(*path) : nullptr;
}
/* The names of a struct's custom properties (its ID properties), as a JSON array. */
EXPORT(bpy_idprop_keys) const char *bpy_idprop_keys(StructRNA *type, ID *id, void *data)
{
  PointerRNA ptr = pointer(type, id, data);
  std::string json = "[";
  if (IDProperty *group = RNA_struct_idprops(&ptr, false)) {
    for (IDProperty *prop = static_cast<IDProperty *>(group->data.group.first); prop; prop = prop->next) {
      json += (json.size() > 1 ? "," : "") + json_string(prop->name);
    }
  }
  return text(json + "]");
}

/* Collections. */

EXPORT(bpy_collection_length) int bpy_collection_length(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  return RNA_property_collection_length(&ptr, prop);
}
EXPORT(bpy_collection_index) bool bpy_collection_index(StructRNA *type, ID *id, void *data, PropertyRNA *prop, int index)
{
  PointerRNA ptr = pointer(type, id, data), item;
  const bool found = RNA_property_collection_lookup_int(&ptr, prop, index, &item);
  put(found ? item : PointerRNA_NULL);
  return found;
}
EXPORT(bpy_collection_key) bool bpy_collection_key(StructRNA *type, ID *id, void *data, PropertyRNA *prop, const char *key)
{
  PointerRNA ptr = pointer(type, id, data), item;
  const bool found = RNA_property_collection_lookup_string(&ptr, prop, key, &item);
  put(found ? item : PointerRNA_NULL);
  return found;
}
/* The struct holding a collection's functions (BlendDataObjects for bpy.data.objects), over its owner, or false. */
EXPORT(bpy_collection_functions) bool bpy_collection_functions(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data), functions;
  const bool found = RNA_property_collection_type_get(&ptr, prop, &functions);
  put(functions);
  return found;
}
/* An ID property collection's (CollectionProperty's) new item, into `out`. */
EXPORT(bpy_collection_add) void bpy_collection_add(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data), item;
  RNA_property_collection_add(&ptr, prop, &item);
  put(item);
}
EXPORT(bpy_collection_remove) bool bpy_collection_remove(StructRNA *type, ID *id, void *data, PropertyRNA *prop, int index)
{
  PointerRNA ptr = pointer(type, id, data);
  return RNA_property_collection_remove(&ptr, prop, index);
}
EXPORT(bpy_collection_clear) void bpy_collection_clear(StructRNA *type, ID *id, void *data, PropertyRNA *prop)
{
  PointerRNA ptr = pointer(type, id, data);
  RNA_property_collection_clear(&ptr, prop);
}

/* Functions. */

EXPORT(bpy_function) FunctionRNA *bpy_function(StructRNA *type, const char *name) { return RNA_struct_find_function(type, name); }

/* A function as JSON: its flags (FUNC_*), whether it has a C implementation (a registrable type's callbacks have none)
 * and its parameters, [identifier, type, flags (INFO_*), parameter flags (PARM_*), array length, struct] each. */
EXPORT(bpy_function_info) const char *bpy_function_info(FunctionRNA *func)
{
  PointerRNA funcptr = RNA_pointer_create_discrete(nullptr, RNA_Function, func);
  std::string json = "{\"flag\":" + std::to_string(RNA_function_flag(func)) +
                     ",\"defined\":" + (RNA_function_defined(func) ? "true" : "false") + ",\"parameters\":[";
  bool first = true;
  for (PropertyRNA &parm : *RNA_function_defined_parameters(func)) {
    const PropertyType kind = RNA_property_type(&parm);
    const int flag = RNA_property_flag(&parm);
    StructRNA *ptype = ELEM(kind, PROP_POINTER, PROP_COLLECTION) ? RNA_property_pointer_type(&funcptr, &parm) : nullptr;
    json += (first ? "[" : ",[") + json_string(RNA_property_identifier(&parm)) + "," + std::to_string(kind) + "," +
            std::to_string((kind == PROP_ENUM && (flag & PROP_ENUM_FLAG) ? INFO_ENUM_FLAG : 0) |
                           (flag & PROP_DYNAMIC ? INFO_DYNAMIC : 0) | (flag & PROP_NEVER_NULL ? INFO_NEVER_NULL : 0)) +
            "," + std::to_string(RNA_parameter_flag(&parm)) + "," +
            std::to_string(RNA_property_array_check(&parm) ? RNA_property_array_length(&funcptr, &parm) : 0) + "," +
            json_string(ptype ? RNA_struct_identifier(ptype) : "") + "]";
    first = false;
  }
  return text(json + "]}");
}

/* Strings and pointers a call's parameters point to, kept until the call ends. */
struct CallData {
  std::vector<std::unique_ptr<std::string>> strings;
  std::vector<std::unique_ptr<PointerRNA>> pointers;
};
static std::map<ParameterList *, CallData> call_data;

EXPORT(bpy_call_begin) ParameterList *bpy_call_begin(StructRNA *type, ID *id, void *data, FunctionRNA *func)
{
  PointerRNA ptr = pointer(type, id, data);
  ParameterList *parms = MEM_new<ParameterList>(__func__);
  RNA_parameter_list_create(parms, &ptr, func);
  return parms;
}
/* Runs the function; returns its error reports as text, or null. */
EXPORT(bpy_call) const char *bpy_call(bContext *C, StructRNA *type, ID *id, void *data, FunctionRNA *func, ParameterList *parms)
{
  PointerRNA ptr = pointer(type, id, data);
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  RNA_function_call(C, &reports, &ptr, func, parms);
  const bool failed = BKE_reports_contain(&reports, RPT_ERROR);
  if (failed) {
    char *message = BKE_reports_string(&reports, RPT_ERROR);
    text(message);
    MEM_delete(message);
  }
  BKE_reports_free(&reports);
  return failed ? text_result.c_str() : nullptr;
}
EXPORT(bpy_call_end) void bpy_call_end(ParameterList *parms)
{
  RNA_parameter_list_free(parms);
  call_data.erase(parms);
  MEM_delete(parms);
}

/* The `index`th parameter and where its value is. */
static PropertyRNA *parameter(ParameterList *parms, int index, void **r_data)
{
  ParameterIterator iter;
  RNA_parameter_list_begin(parms, &iter);
  for (int i = 0; iter.valid && i < index; i++) {
    RNA_parameter_list_next(&iter);
  }
  PropertyRNA *parm = iter.valid ? iter.parm : nullptr;
  *r_data = iter.data;
  RNA_parameter_list_end(&iter);
  return parm;
}
static PointerRNA function_pointer(ParameterList *parms) { return RNA_pointer_create_discrete(nullptr, RNA_Function, parms->func); }

/* A number or array parameter (a dynamic array's own allocation, which RNA_parameter_list_free frees). */
EXPORT(bpy_param_numbers_set) void bpy_param_numbers_set(ParameterList *parms, int index, const double *values, int len)
{
  void *data;
  PropertyRNA *parm = parameter(parms, index, &data);
  const PropertyType kind = RNA_property_type(parm);
  const size_t size = kind == PROP_BOOLEAN ? sizeof(bool) : kind == PROP_INT ? sizeof(int) : sizeof(float);
  if (RNA_property_array_check(parm) && (RNA_property_flag(parm) & PROP_DYNAMIC)) {
    ParameterDynAlloc *alloc = static_cast<ParameterDynAlloc *>(data);
    alloc->array_tot = len;
    alloc->array = MEM_new_array_zeroed(size_t(std::max(len, 1)), size, __func__);
    data = alloc->array;
  }
  for (int i = 0; i < len; i++) {
    if (kind == PROP_BOOLEAN) {
      static_cast<bool *>(data)[i] = values[i] != 0.0;
    }
    else if (kind == PROP_INT || kind == PROP_ENUM) {
      static_cast<int *>(data)[i] = int(values[i]);
    }
    else {
      static_cast<float *>(data)[i] = float(values[i]);
    }
  }
}
EXPORT(bpy_param_numbers_get) int bpy_param_numbers_get(ParameterList *parms, int index, double *values, int capacity)
{
  void *data;
  PropertyRNA *parm = parameter(parms, index, &data);
  PointerRNA funcptr = function_pointer(parms);
  const PropertyType kind = RNA_property_type(parm);
  int len = 1;
  if (RNA_property_array_check(parm)) {
    if (RNA_property_flag(parm) & PROP_DYNAMIC) {
      ParameterDynAlloc *alloc = static_cast<ParameterDynAlloc *>(data);
      len = int(alloc->array_tot);
      data = alloc->array;
    }
    else {
      len = RNA_property_array_length(&funcptr, parm);
    }
  }
  for (int i = 0; i < std::min(len, capacity); i++) {
    values[i] = kind == PROP_BOOLEAN ? static_cast<bool *>(data)[i] :
                kind == PROP_INT     ? static_cast<int *>(data)[i] :
                                       static_cast<float *>(data)[i];
  }
  return len;
}
EXPORT(bpy_param_enum_set) bool bpy_param_enum_set(bContext *C, ParameterList *parms, int index, const char *identifiers)
{
  void *data;
  PropertyRNA *parm = parameter(parms, index, &data);
  PointerRNA funcptr = function_pointer(parms);
  return enum_value(C, &funcptr, parm, identifiers, static_cast<int *>(data));
}
EXPORT(bpy_param_enum_get) const char *bpy_param_enum_get(bContext *C, ParameterList *parms, int index)
{
  void *data;
  PropertyRNA *parm = parameter(parms, index, &data);
  PointerRNA funcptr = function_pointer(parms);
  return text(enum_identifiers(C, &funcptr, parm, *static_cast<int *>(data)));
}
EXPORT(bpy_param_string_set) void bpy_param_string_set(ParameterList *parms, int index, const char *value)
{
  void *data;
  PropertyRNA *parm = parameter(parms, index, &data);
  const int flag = RNA_property_flag(parm);
  if (flag & PROP_THICK_WRAP) {
    BLI_strncpy(static_cast<char *>(data), value, size_t(RNA_property_string_maxlength(parm)));
  }
  else if (flag & PROP_DYNAMIC) {
    ParameterDynAlloc *alloc = static_cast<ParameterDynAlloc *>(data);
    alloc->array_tot = intptr_t(strlen(value));
    alloc->array = BLI_strdup(value);
  }
  else {
    std::string &kept = *call_data[parms].strings.emplace_back(std::make_unique<std::string>(value));
    *static_cast<const char **>(data) = kept.c_str();
  }
}
EXPORT(bpy_param_string_get) const char *bpy_param_string_get(ParameterList *parms, int index)
{
  void *data;
  PropertyRNA *parm = parameter(parms, index, &data);
  const int flag = RNA_property_flag(parm);
  const char *value = flag & PROP_DYNAMIC   ? static_cast<const char *>(static_cast<ParameterDynAlloc *>(data)->array) :
                      flag & PROP_THICK_WRAP ? static_cast<const char *>(data) :
                                               *static_cast<const char **>(data);
  return value;
}
EXPORT(bpy_param_pointer_set) void bpy_param_pointer_set(ParameterList *parms, int index, StructRNA *type, ID *id, void *vdata)
{
  void *data;
  PropertyRNA *parm = parameter(parms, index, &data);
  const PointerRNA value = vdata ? pointer(type, id, vdata) : PointerRNA_NULL;
  if (!(RNA_parameter_flag(parm) & PARM_RNAPTR)) {
    *static_cast<void **>(data) = value.data;
  }
  else if (RNA_property_flag(parm) & PROP_THICK_WRAP) {
    *static_cast<PointerRNA *>(data) = value;
  }
  else {
    *static_cast<PointerRNA **>(data) = call_data[parms].pointers.emplace_back(std::make_unique<PointerRNA>(value)).get();
  }
}
/* A pointer parameter's struct into `out`; false for none. */
EXPORT(bpy_param_pointer_get) bool bpy_param_pointer_get(ParameterList *parms, int index)
{
  void *data;
  PropertyRNA *parm = parameter(parms, index, &data);
  PointerRNA funcptr = function_pointer(parms);
  PointerRNA value;
  if (RNA_parameter_flag(parm) & PARM_RNAPTR) {
    value = RNA_property_flag(parm) & PROP_THICK_WRAP ? *static_cast<PointerRNA *>(data) : **static_cast<PointerRNA **>(data);
  }
  else {
    StructRNA *ptype = RNA_property_pointer_type(&funcptr, parm);
    void *target = *static_cast<void **>(data);
    value = RNA_struct_is_ID(ptype) ? RNA_id_pointer_create(static_cast<ID *>(target)) : pointer(ptype, nullptr, target);
  }
  put(value);
  return value.data != nullptr;
}
EXPORT(bpy_param_collection_length) int bpy_param_collection_length(ParameterList *parms, int index)
{
  void *data;
  parameter(parms, index, &data);
  return int(static_cast<CollectionVector *>(data)->items.size());
}
EXPORT(bpy_param_collection_item) void bpy_param_collection_item(ParameterList *parms, int index, int item)
{
  void *data;
  parameter(parms, index, &data);
  put(static_cast<CollectionVector *>(data)->items[item]);
}
EXPORT(bpy_param_collection_append) void bpy_param_collection_append(ParameterList *parms, int index, StructRNA *type, ID *id, void *vdata)
{
  void *data;
  parameter(parms, index, &data);
  static_cast<CollectionVector *>(data)->items.append(pointer(type, id, vdata));
}

/* Registration (bpy_rna.cc's pyrna_register_class): a JS class `cls` as a new type of the registrable `base`. */

/* What a registrable type lets a class define, its bases' first: functions with FUNC_REGISTER, in the order of the
 * validate's have_function, as [identifier, flag] (FUNC_*), and properties with PROP_REGISTER as [identifier, flag]. */
EXPORT(bpy_struct_registrable) const char *bpy_struct_registrable(StructRNA *type)
{
  std::vector<StructRNA *> chain;
  for (StructRNA *s = type; s; s = RNA_struct_base(s)) {
    chain.insert(chain.begin(), s);
  }
  std::string funcs, props;
  for (StructRNA *s : chain) {
    for (const std::unique_ptr<FunctionRNA> &func : RNA_struct_type_functions(s)) {
      const int flag = RNA_function_flag(func.get());
      if (flag & FUNC_REGISTER) {
        funcs += (funcs.empty() ? "[" : ",[") + json_string(RNA_function_identifier(func.get())) + "," + std::to_string(flag) + "]";
      }
    }
    for (PropertyRNA &prop : *RNA_struct_type_properties(s)) {
      const int flag = RNA_property_flag(&prop);
      if (flag & PROP_REGISTER) {
        props += (props.empty() ? "[" : ",[") + json_string(RNA_property_identifier(&prop)) + "," + std::to_string(flag) + "]";
      }
    }
  }
  return text("{\"functions\":[" + funcs + "],\"properties\":[" + props + "]}");
}

static int class_validate(PointerRNA *dummy_ptr, void *data, bool *have_function)
{
  return js_class_validate(int(intptr_t(data)), dummy_ptr->type, dummy_ptr->owner_id, dummy_ptr->data, have_function);
}
static int class_call(bContext *C, PointerRNA *ptr, FunctionRNA *func, ParameterList *parms)
{
  return js_class_call(C, ptr->type, ptr->owner_id, ptr->data, func, parms);
}
static void class_free(void *data) { js_class_free(int(intptr_t(data))); }

static std::string register_error;
EXPORT(bpy_register_error) const char *bpy_register_error() { return register_error.c_str(); }

/* The new type, or null (the reason in bpy_register_error). */
EXPORT(bpy_register) StructRNA *bpy_register(bContext *C, StructRNA *base, int cls, const char *identifier)
{
  StructRegisterFunc reg = RNA_struct_register(base);
  if (!reg) {
    register_error = std::string(RNA_struct_identifier(base)) + " does not support registration";
    return nullptr;
  }
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  StructRNA *srna = reg(C ? CTX_data_main(C) : G_MAIN, &reports, reinterpret_cast<void *>(intptr_t(cls)), identifier, class_validate, class_call, class_free);
  char *message = BKE_reports_string(&reports, RPT_ERROR);
  register_error = message ? message : "";
  MEM_SAFE_DELETE(message);
  BKE_reports_free(&reports);
  if (srna) {
    RNA_struct_py_type_set(srna, reinterpret_cast<void *>(intptr_t(cls)));
  }
  return srna;
}
EXPORT(bpy_unregister) void bpy_unregister(bContext *C, StructRNA *srna)
{
  if (StructUnregisterFunc unreg = RNA_struct_unregister(srna)) {
    unreg(C ? CTX_data_main(C) : G_MAIN, srna);
  }
}

/* Properties a class defines (bpy_props.cc), on its registered type: one call per property, then its settings. */
EXPORT(bpy_def_property)
PropertyRNA *bpy_def_property(StructRNA *srna, const char *identifier, int type, int subtype, int array_length, const char *name,
                              const char *description)
{
  PropertyRNA *prop = RNA_def_property(srna, identifier, PropertyType(type), PropertySubType(subtype));
  if (array_length > 0) {
    RNA_def_property_array(prop, array_length);
  }
  RNA_def_property_ui_text(prop, name, description);
  return prop;
}
/* A pointer or collection property holding `type` structs. */
EXPORT(bpy_def_pointer)
PropertyRNA *bpy_def_pointer(StructRNA *srna, const char *identifier, bool collection, StructRNA *type, const char *name,
                             const char *description)
{
  return collection ? RNA_def_collection_runtime(srna, identifier, type, name, description) :
                      RNA_def_pointer_runtime(srna, identifier, type, name, description);
}
/* An enum's items, from lines of identifier, name, description, icon name and value, tab separated; then its default. */
EXPORT(bpy_def_enum_items) void bpy_def_enum_items(PropertyRNA *prop, const char *lines, bool flag, int default_value)
{
  /* Kept until bpy_def_property_done copies them (RNA_def_property_duplicate_pointers). */
  static Vector<EnumPropertyItem> items;
  static std::vector<std::string> fields;
  items.clear();
  fields.clear();
  const std::string all = lines;
  for (size_t start = 0, end; start < all.size(); start = end + 1) {
    end = std::min(all.find('\n', start), all.size());
    const std::string line = all.substr(start, end - start);
    for (size_t s = 0, e; s <= line.size(); s = e + 1) {
      e = std::min(line.find('\t', s), line.size());
      fields.push_back(line.substr(s, e - s));
    }
  }
  for (size_t i = 0; i + 5 <= fields.size(); i += 5) {
    int icon = 0;
    RNA_enum_value_from_id(rna_enum_icon_items, fields[i + 3].c_str(), &icon);
    items.append({std::atoi(fields[i + 4].c_str()), fields[i].c_str(), icon, fields[i + 1].c_str(), fields[i + 2].c_str()});
  }
  items.append({0, nullptr, 0, nullptr, nullptr});
  if (flag) {
    RNA_def_property_flag(prop, PROP_ENUM_FLAG);
  }
  RNA_def_property_enum_items(prop, items.data());
  RNA_def_property_enum_default(prop, default_value);
}
EXPORT(bpy_def_defaults) void bpy_def_defaults(PropertyRNA *prop, const double *values, int len)
{
  const PropertyType kind = RNA_property_type(prop);
  if (len > 1 || RNA_property_array_check(prop)) {
    if (kind == PROP_BOOLEAN) {
      Array<bool> array(len);
      std::transform(values, values + len, array.data(), [](double v) { return v != 0.0; });
      RNA_def_property_boolean_array_default(prop, array.data());
    }
    else if (kind == PROP_INT) {
      Array<int> array(len);
      std::transform(values, values + len, array.data(), [](double v) { return int(v); });
      RNA_def_property_int_array_default(prop, array.data());
    }
    else {
      Array<float> array(len);
      std::transform(values, values + len, array.data(), [](double v) { return float(v); });
      RNA_def_property_float_array_default(prop, array.data());
    }
    return;
  }
  kind == PROP_BOOLEAN ? RNA_def_property_boolean_default(prop, values[0] != 0.0) :
  kind == PROP_INT     ? RNA_def_property_int_default(prop, int(values[0])) :
                         RNA_def_property_float_default(prop, float(values[0]));
}
EXPORT(bpy_def_string_default) void bpy_def_string_default(PropertyRNA *prop, const char *value, int maxlen)
{
  if (maxlen > 0) {
    RNA_def_property_string_maxlength(prop, maxlen + 1);
  }
  RNA_def_property_string_default(prop, value);
}
EXPORT(bpy_def_range)
void bpy_def_range(PropertyRNA *prop, double min, double max, double soft_min, double soft_max, double step, int precision)
{
  RNA_def_property_range(prop, min, max);
  RNA_def_property_ui_range(prop, std::max(soft_min, min), std::min(soft_max, max), step, precision);
}
/* Sets and clears PropertyFlag bits (bpy_prop_assign_flag), then makes the property own its strings. */
EXPORT(bpy_def_property_done) void bpy_def_property_done(StructRNA *srna, PropertyRNA *prop, int set, int clear)
{
  RNA_def_property_flag(prop, PropertyFlag(set));
  RNA_def_property_clear_flag(prop, PropertyFlag(clear));
  RNA_def_property_duplicate_pointers(srna, prop);
}
