/* Operators and properties over Blender's own RNA and window manager (rna-runtime.cc), as JS drives them. */
#pragma once

#include <string>

#include "RNA_types.hh"

namespace blender {

struct wmOperator;
struct wmOperatorType;

/* An operator of a type with its own copy of the property values given (an IDProperty group), or the defaults. */
wmOperator *operator_create(wmOperatorType *ot, const IDProperty *values = nullptr);
void operator_destroy(wmOperator *op);
/* Sets a property: numbers (len of them), or a string or comma separated enum identifiers. */
bool operator_property_set(PointerRNA *ptr, const char *name, const double *numbers, int len, const char *text);
/* The values one call of an operator has set, as JSON: numbers (arrays for array properties), enum identifiers,
 * strings; what the redo panel shows and a redo runs again. */
std::string operator_values_json(PointerRNA *ptr);

}  // namespace blender
