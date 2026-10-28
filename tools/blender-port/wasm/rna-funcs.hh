/* RNA functions an RNA file's runtime part gives the module's properties by name (rna-fcurve.cc), as a table that
 * needs neither Blender's RNA types nor the module's (operator-properties.hh), which are different structs. */
#pragma once

namespace blender {

struct StructRNA;

/* Which of PropertyRNA::funcs a function is. */
enum RnaFuncMember {
  RNA_FUNC_boolean_set,
  RNA_FUNC_int_set,
  RNA_FUNC_float_set,
  RNA_FUNC_enum_set,
  RNA_FUNC_string_set,
  RNA_FUNC_float_get_array,
  RNA_FUNC_float_set_array,
  RNA_FUNC_float_range,
  RNA_FUNC_int_range,
  RNA_FUNC_length,
  RNA_FUNC_update,
};

struct RnaFunc {
  StructRNA **srna;
  const char *identifier;
  int type;
  RnaFuncMember member;
  void (*func)();
};

/* A struct type and the base whose properties it inherits. */
struct RnaBase {
  StructRNA **srna, **base;
};

/* rna_fcurve.cc's, each ending with a null struct type. */
extern const RnaFunc rna_fcurve_funcs[];
extern const RnaBase rna_fcurve_bases[];

}  // namespace blender
