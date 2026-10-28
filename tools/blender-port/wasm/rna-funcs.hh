/* RNA functions an RNA file's runtime part gives the module's properties by name (rna-fcurve.cc, rna-space.cc), as
 * tables that need neither Blender's RNA types nor the module's (operator-properties.hh), which are different structs. */
#pragma once

namespace blender {

struct StructRNA;

/* Which of PropertyRNA::funcs a function is. */
enum RnaFuncMember {
  RNA_FUNC_boolean_get,
  RNA_FUNC_int_get,
  RNA_FUNC_float_get,
  RNA_FUNC_enum_get,
  RNA_FUNC_string_get,
  RNA_FUNC_string_length,
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
  RNA_FUNC_update_context,
};

struct RnaFunc {
  StructRNA **srna;
  const char *identifier;
  int type;
  RnaFuncMember member;
  void (*func)();
};

/* An array property without a DNA field of its own, and its length. */
struct RnaArray {
  StructRNA **srna;
  const char *identifier;
  int type, length;
};

/* A struct type and the base whose properties it inherits. */
struct RnaBase {
  StructRNA **srna, **base;
};

/* One RNA file's tables (rna-tables.hh), each ending with a null struct type. */
struct RnaTables {
  const RnaFunc *funcs;
  const RnaBase *bases;
  const RnaArray *arrays;
};
extern const RnaTables rna_fcurve_tables, rna_space_tables;

}  // namespace blender
