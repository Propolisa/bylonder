/* Operator properties without Blender's RNA runtime, which makesrna generates: the RNA_def_* calls of an operator's
 * registration record each property with its default, and the RNA_* getters and setters read the values set on one
 * call of it, or the defaults. Enums keep Blender's own item tables, so a value can be set by its identifier. */
#include <cstdio>
#include <cstring>
#include <map>

#include "MEM_guardedalloc.h"

#include "BLI_utildefines.h"

#include "RNA_access.hh"
#include "RNA_define.hh"
#include "RNA_types.hh"

#include "operator-properties.hh"

namespace blender {

/* What one call of an operator has set. */
struct OperatorValues {
  std::map<const PropertyRNA *, std::vector<double>> numbers;
  std::map<const PropertyRNA *, std::string> strings;
};

StructRNA *operator_properties_new(const char *identifier)
{
  StructRNA *srna = new StructRNA();
  srna->identifier = identifier;
  return srna;
}

void *operator_values_new() { return new OperatorValues(); }
void operator_values_free(void *values) { delete static_cast<OperatorValues *>(values); }

static PropertyRNA *define(StructOrFunctionRNA *cont, const char *identifier, PropertyType type, std::vector<double> defaults)
{
  StructRNA *srna = static_cast<StructRNA *>(cont);
  srna->properties.push_back(std::make_unique<PropertyRNA>());
  PropertyRNA *prop = srna->properties.back().get();
  prop->identifier = identifier;
  prop->type = type;
  prop->length = defaults.size() > 1 ? int(defaults.size()) : 0;
  prop->defaults = defaults.empty() ? std::vector<double>{0.0} : std::move(defaults);
  return prop;
}

template<typename T> static std::vector<double> array(const T *values, int len)
{
  std::vector<double> out(len, 0.0);
  for (int i = 0; values && i < len; i++) {
    out[i] = double(values[i]);
  }
  return out;
}

PropertyRNA *RNA_struct_type_find_property(StructRNA *srna, const char *identifier)
{
  for (const std::unique_ptr<PropertyRNA> &prop : srna->properties) {
    if (prop->identifier == identifier) {
      return prop.get();
    }
  }
  return nullptr;
}

PropertyRNA *RNA_struct_find_property(PointerRNA *ptr, const char *identifier)
{
  return RNA_struct_type_find_property(ptr->type, identifier);
}

/* The property of a name, reported as Blender's RNA reports a lookup of one the operator does not have. */
static PropertyRNA *find(PointerRNA *ptr, const char *name)
{
  PropertyRNA *prop = RNA_struct_find_property(ptr, name);
  if (!prop) {
    printf("%s: %s.%s not found.\n", __func__, ptr->type->identifier.c_str(), name);
  }
  return prop;
}

static const std::vector<double> &values(PointerRNA *ptr, const PropertyRNA *prop)
{
  const OperatorValues &set = *static_cast<OperatorValues *>(ptr->data);
  const auto it = set.numbers.find(prop);
  return it != set.numbers.end() ? it->second : prop->defaults;
}

static void set_values(PointerRNA *ptr, const PropertyRNA *prop, std::vector<double> numbers)
{
  static_cast<OperatorValues *>(ptr->data)->numbers[prop] = std::move(numbers);
}

/* Definitions. */

PropertyRNA *RNA_def_property(StructOrFunctionRNA *cont, const char *identifier, int type, int /*subtype*/)
{
  return define(cont, identifier, PropertyType(type), {});
}
PropertyRNA *RNA_def_boolean(StructOrFunctionRNA *cont, const char *identifier, bool default_value, const char *, const char *)
{
  return define(cont, identifier, PROP_BOOLEAN, {double(default_value)});
}
PropertyRNA *RNA_def_boolean_array(StructOrFunctionRNA *cont, const char *identifier, int len, const bool *default_value, const char *,
                                   const char *)
{
  return define(cont, identifier, PROP_BOOLEAN, array(default_value, len));
}
PropertyRNA *RNA_def_int(StructOrFunctionRNA *cont, const char *identifier, int default_value, int, int, const char *, const char *, int, int)
{
  return define(cont, identifier, PROP_INT, {double(default_value)});
}
PropertyRNA *RNA_def_float(StructOrFunctionRNA *cont, const char *identifier, float default_value, float, float, const char *,
                           const char *, float, float)
{
  return define(cont, identifier, PROP_FLOAT, {double(default_value)});
}
PropertyRNA *RNA_def_float_distance(StructOrFunctionRNA *cont, const char *identifier, float default_value, float hardmin,
                                    float hardmax, const char *ui_name, const char *ui_description, float softmin, float softmax)
{
  return RNA_def_float(cont, identifier, default_value, hardmin, hardmax, ui_name, ui_description, softmin, softmax);
}
PropertyRNA *RNA_def_float_factor(StructOrFunctionRNA *cont, const char *identifier, float default_value, float hardmin,
                                  float hardmax, const char *ui_name, const char *ui_description, float softmin, float softmax)
{
  return RNA_def_float(cont, identifier, default_value, hardmin, hardmax, ui_name, ui_description, softmin, softmax);
}
PropertyRNA *RNA_def_float_vector(StructOrFunctionRNA *cont, const char *identifier, int len, const float *default_value, float, float,
                                  const char *, const char *, float, float)
{
  return define(cont, identifier, PROP_FLOAT, array(default_value, len));
}
PropertyRNA *RNA_def_float_vector_xyz(StructOrFunctionRNA *cont, const char *identifier, int len, const float *default_value,
                                      float hardmin, float hardmax, const char *ui_name, const char *ui_description, float softmin,
                                      float softmax)
{
  return RNA_def_float_vector(cont, identifier, len, default_value, hardmin, hardmax, ui_name, ui_description, softmin, softmax);
}
PropertyRNA *RNA_def_float_rotation(StructOrFunctionRNA *cont, const char *identifier, int len, const float *default_value,
                                    float hardmin, float hardmax, const char *ui_name, const char *ui_description, float softmin,
                                    float softmax)
{
  return len ? RNA_def_float_vector(cont, identifier, len, default_value, hardmin, hardmax, ui_name, ui_description, softmin, softmax) :
               RNA_def_float(cont, identifier, default_value ? *default_value : 0.0f, hardmin, hardmax, ui_name, ui_description, softmin,
                             softmax);
}
PropertyRNA *RNA_def_float_matrix(StructOrFunctionRNA *cont, const char *identifier, int rows, int columns, const float *default_value,
                                  float, float, const char *, const char *, float, float)
{
  return define(cont, identifier, PROP_FLOAT, array(default_value, rows * columns));
}
PropertyRNA *RNA_def_enum(StructOrFunctionRNA *cont, const char *identifier, const EnumPropertyItem *items, int default_value,
                          const char *, const char *)
{
  PropertyRNA *prop = define(cont, identifier, PROP_ENUM, {double(default_value)});
  prop->items = items;
  return prop;
}
PropertyRNA *RNA_def_enum_flag(StructOrFunctionRNA *cont, const char *identifier, const EnumPropertyItem *items, int default_value,
                               const char *ui_name, const char *ui_description)
{
  return RNA_def_enum(cont, identifier, items, default_value, ui_name, ui_description);
}
void RNA_def_property_enum_items(PropertyRNA *prop, const EnumPropertyItem *item) { prop->items = item; }
void RNA_def_property_enum_default(PropertyRNA *prop, int value) { prop->defaults = {double(value)}; }
void RNA_def_property_float_default(PropertyRNA *prop, float value) { prop->defaults = {double(value)}; }

/* What only Blender's UI and file storage use of a property. */
void RNA_def_enum_funcs(PropertyRNA *, EnumPropertyItemFunc) {}
void RNA_def_property_flag(PropertyRNA *, PropertyFlag) {}
void RNA_def_property_range(PropertyRNA *, double, double) {}
void RNA_def_property_subtype(PropertyRNA *, PropertySubType) {}
void RNA_def_property_translation_context(PropertyRNA *, const char *) {}
void RNA_def_property_ui_range(PropertyRNA *, double, double, double, int) {}
void RNA_def_property_ui_text(PropertyRNA *, const char *, const char *) {}

/* Dynamic enum item lists, grown as rna_define.cc grows them: callers free them with MEM_freeN. */
void RNA_enum_item_add(EnumPropertyItem **items, int *totitem, const EnumPropertyItem *item)
{
  const int tot = *totitem;
  if (tot == 0) {
    *items = MEM_new_array_zeroed<EnumPropertyItem>(8, __func__);
  }
  else if (tot >= 8 && (tot & (tot - 1)) == 0) {
    *items = static_cast<EnumPropertyItem *>(MEM_realloc_zeroed_id(*items, sizeof(EnumPropertyItem) * tot * 2, __func__));
  }
  (*items)[tot] = *item;
  *totitem = tot + 1;
}
void RNA_enum_item_end(EnumPropertyItem **items, int *totitem)
{
  static const EnumPropertyItem empty = {0, nullptr, 0, nullptr, nullptr};
  RNA_enum_item_add(items, totitem, &empty);
}
void RNA_enum_items_add_value(EnumPropertyItem **items, int *totitem, const EnumPropertyItem *item, int value)
{
  for (; item->identifier; item++) {
    if (item->value == value) {
      RNA_enum_item_add(items, totitem, item);
      break;
    }
  }
}

/* Access by property. */

bool RNA_property_is_set(PointerRNA *ptr, PropertyRNA *prop)
{
  const OperatorValues &set = *static_cast<OperatorValues *>(ptr->data);
  return set.numbers.count(prop) || set.strings.count(prop);
}
void RNA_property_unset(PointerRNA *ptr, PropertyRNA *prop)
{
  OperatorValues &set = *static_cast<OperatorValues *>(ptr->data);
  set.numbers.erase(prop);
  set.strings.erase(prop);
}
const char *RNA_property_identifier(const PropertyRNA *prop) { return prop->identifier.c_str(); }
bool RNA_property_boolean_get(PointerRNA *ptr, PropertyRNA *prop) { return values(ptr, prop)[0] != 0.0; }
void RNA_property_boolean_set(PointerRNA *ptr, PropertyRNA *prop, bool value) { set_values(ptr, prop, {double(value)}); }
int RNA_property_int_get(PointerRNA *ptr, PropertyRNA *prop) { return int(values(ptr, prop)[0]); }
void RNA_property_int_set(PointerRNA *ptr, PropertyRNA *prop, int value) { set_values(ptr, prop, {double(value)}); }
float RNA_property_float_get(PointerRNA *ptr, PropertyRNA *prop) { return float(values(ptr, prop)[0]); }
void RNA_property_float_set(PointerRNA *ptr, PropertyRNA *prop, float value) { set_values(ptr, prop, {double(value)}); }
int RNA_property_enum_get(PointerRNA *ptr, PropertyRNA *prop) { return int(values(ptr, prop)[0]); }
void RNA_property_enum_set(PointerRNA *ptr, PropertyRNA *prop, int value) { set_values(ptr, prop, {double(value)}); }
void RNA_property_float_get_array(PointerRNA *ptr, PropertyRNA *prop, float *out)
{
  const std::vector<double> &v = values(ptr, prop);
  for (size_t i = 0; i < v.size(); i++) {
    out[i] = float(v[i]);
  }
}
void RNA_property_float_set_array(PointerRNA *ptr, PropertyRNA *prop, const float *in)
{
  set_values(ptr, prop, array(in, std::max(prop->length, 1)));
}
char *RNA_property_string_get_alloc(PointerRNA *ptr, PropertyRNA *prop, char *fixedbuf, int fixedlen, int *r_len)
{
  const OperatorValues &set = *static_cast<OperatorValues *>(ptr->data);
  const auto it = set.strings.find(prop);
  const std::string value = it != set.strings.end() ? it->second : std::string();
  char *out = int(value.size()) < fixedlen ? fixedbuf : MEM_new_array_uninitialized<char>(value.size() + 1, __func__);
  memcpy(out, value.c_str(), value.size() + 1);
  if (r_len) {
    *r_len = int(value.size());
  }
  return out;
}
void RNA_property_string_set_bytes(PointerRNA *ptr, PropertyRNA *prop, const char *value, int len)
{
  static_cast<OperatorValues *>(ptr->data)->strings[prop] = std::string(value, len);
}

/* Access by name. */

bool RNA_struct_property_is_set(PointerRNA *ptr, const char *identifier)
{
  PropertyRNA *prop = find(ptr, identifier);
  return prop && RNA_property_is_set(ptr, prop);
}
bool RNA_boolean_get(PointerRNA *ptr, const char *name) { return RNA_property_boolean_get(ptr, find(ptr, name)); }
void RNA_boolean_set(PointerRNA *ptr, const char *name, bool value) { RNA_property_boolean_set(ptr, find(ptr, name), value); }
void RNA_boolean_get_array(PointerRNA *ptr, const char *name, bool *out)
{
  const std::vector<double> &v = values(ptr, find(ptr, name));
  for (size_t i = 0; i < v.size(); i++) {
    out[i] = v[i] != 0.0;
  }
}
void RNA_boolean_set_array(PointerRNA *ptr, const char *name, const bool *in)
{
  PropertyRNA *prop = find(ptr, name);
  set_values(ptr, prop, array(in, std::max(prop->length, 1)));
}
int RNA_int_get(PointerRNA *ptr, const char *name) { return RNA_property_int_get(ptr, find(ptr, name)); }
void RNA_int_set(PointerRNA *ptr, const char *name, int value) { RNA_property_int_set(ptr, find(ptr, name), value); }
float RNA_float_get(PointerRNA *ptr, const char *name) { return RNA_property_float_get(ptr, find(ptr, name)); }
void RNA_float_set(PointerRNA *ptr, const char *name, float value) { RNA_property_float_set(ptr, find(ptr, name), value); }
void RNA_float_get_array(PointerRNA *ptr, const char *name, float *values) { RNA_property_float_get_array(ptr, find(ptr, name), values); }
void RNA_float_set_array(PointerRNA *ptr, const char *name, const float *values)
{
  RNA_property_float_set_array(ptr, find(ptr, name), values);
}
int RNA_enum_get(PointerRNA *ptr, const char *name) { return RNA_property_enum_get(ptr, find(ptr, name)); }
void RNA_enum_set(PointerRNA *ptr, const char *name, int value) { RNA_property_enum_set(ptr, find(ptr, name), value); }

/* Structs. */

const char *RNA_struct_identifier(const StructRNA *type) { return type->identifier.c_str(); }
bool RNA_struct_is_a(const StructRNA *type, const StructRNA *srna) { return type == srna; }
PropertyRNA *RNA_struct_name_property(const StructRNA *) { return nullptr; }
PointerRNA RNA_pointer_create_discrete(ID *id, StructRNA *type, void *data) { return PointerRNA{id, type, data}; }

/* Sets a property from JS by identifier: numbers for booleans, ints, floats and their arrays; an enum by the identifier
 * of its item in Blender's table, and an enum flag by its items' identifiers joined with commas. False when the operator
 * has no such property or item. */
bool operator_property_set(PointerRNA *ptr, const char *name, const double *numbers, int len, const char *enum_identifiers)
{
  PropertyRNA *prop = RNA_struct_find_property(ptr, name);
  if (!prop) {
    return false;
  }
  if (!enum_identifiers) {
    set_values(ptr, prop, std::vector<double>(numbers, numbers + len));
    return true;
  }
  int value = 0;
  const std::string identifiers = enum_identifiers;
  for (size_t start = 0, end; start <= identifiers.size(); start = end + 1) {
    end = std::min(identifiers.find(',', start), identifiers.size());
    const std::string identifier = identifiers.substr(start, end - start);
    if (identifier.empty()) {
      continue;
    }
    const EnumPropertyItem *item = prop->items;
    while (item && item->identifier && identifier != item->identifier) {
      item++;
    }
    if (!item || !item->identifier) {
      return false;
    }
    value |= item->value;
  }
  set_values(ptr, prop, {double(value)});
  return true;
}

}  // namespace blender
