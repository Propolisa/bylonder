/* Operator properties without Blender's RNA runtime (operator-properties.cc). */
#pragma once

#include <cfloat>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "RNA_types.hh"

namespace blender {

struct bContext;

/* Where a property of a DNA struct (a modifier's) is stored, as rna_modifier.cc defines it (tools/blender-port/modifier_dna.py):
 * kind f (float), i (integer), p (pointer) or s (string); a boolean is a bit of an integer field (`bit`, shifted by the
 * element's index for a bitset array), or the whole field without one. */
struct DnaField {
  int offset, size;
  char kind;
  bool is_signed;
  long long bit;
  bool bitset, negative;
};

struct PropertyRNA {
  std::string identifier;
  /* Its name in Blender's UI (RNA_def_property_ui_text). */
  std::string name;
  PropertyType type;
  int length = 0;
  /* Set for a DNA struct's property, whose values are read from and written to PointerRNA.data. */
  std::optional<DnaField> dna;
  std::vector<double> defaults;
  const EnumPropertyItem *items = nullptr;
  /* The items for a context (RNA_def_enum_funcs), when they depend on it. */
  EnumPropertyItemFunc itemf = nullptr;
  PropertySubType subtype = PROP_NONE;
  int flag = 0;
  int icon = 0;
  /* What RNA_property_update runs: the struct's update function, ported where the module needs one. */
  void (*update)(bContext *C, PointerRNA *ptr) = nullptr;
  /* A float's ranges, as RNA_def_property gives them until the definition sets its own. */
  float hardmin = -FLT_MAX, hardmax = FLT_MAX, softmin = -10000.0f, softmax = 10000.0f, step = 10.0f;
  int precision = 3;
};

/* An operator's properties, or (for the RNA_* type pointers code compares and stores) just a named type. */
struct StructRNA {
  std::string identifier;
  std::vector<std::unique_ptr<PropertyRNA>> properties;
};

/* The property definitions of one operator type, for its registration to define into (wmOperatorType.srna). */
StructRNA *operator_properties_new(const char *identifier);
/* The values one call of an operator sets (PointerRNA.data). */
void *operator_values_new();
void *operator_values_copy(const void *values);
void operator_values_free(void *values);
bool operator_property_set(PointerRNA *ptr, const char *name, const double *numbers, int len, const char *enum_identifier);
/* Gives a DNA struct's property the update function RNA_property_update runs after a button sets it. */
/* An operator of a type, with its own copy of the values given (or the defaults). */
struct wmOperator *operator_create(struct wmOperatorType *ot, const void *values = nullptr);
void rna_property_update_set(StructRNA *srna, const char *identifier, void (*update)(bContext *C, PointerRNA *ptr));

}  // namespace blender
