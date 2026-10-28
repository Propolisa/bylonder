/* rna_fcurve.cc's runtime part (RNA_RUNTIME), which makesrna's generated code calls: the F-Curve structs' RNA
 * functions (an F-Modifier's set functions and updates), listed for the module's properties of the same name
 * (rna_fcurve_funcs.inc, generated from dna-fcurve.json) so that setting one from JS or a button runs Blender's. Its
 * enum tables are the definition part's, compiled from the same file. */
#include "RNA_prototypes.hh"

#define RNA_RUNTIME
#define rna_enum_fmodifier_type_items rna_enum_fmodifier_type_items_runtime
#define rna_enum_fcurve_auto_smoothing_items rna_enum_fcurve_auto_smoothing_items_runtime
#define rna_enum_beztriple_keyframe_type_items rna_enum_beztriple_keyframe_type_items_runtime
#define rna_enum_beztriple_interpolation_easing_items rna_enum_beztriple_interpolation_easing_items_runtime
#define rna_enum_driver_target_rotation_mode_items rna_enum_driver_target_rotation_mode_items_runtime
#include "rna_fcurve.cc"

#include "rna-funcs.hh"

namespace blender {

const RnaFunc rna_fcurve_funcs[] = {
#define RNA_BASE(srna, base)
#define RNA_FUNC(srna, identifier, type, member, func) \
  {&srna, identifier, type, RNA_FUNC_##member, reinterpret_cast<void (*)()>(func)},
#include "rna_fcurve_funcs.inc"
#undef RNA_BASE
#undef RNA_FUNC
    {nullptr, nullptr, 0, RNA_FUNC_update, nullptr},
};

const RnaBase rna_fcurve_bases[] = {
#define RNA_BASE(srna, base) {&srna, &base},
#define RNA_FUNC(srna, identifier, type, member, func)
#include "rna_fcurve_funcs.inc"
#undef RNA_BASE
#undef RNA_FUNC
    {nullptr, nullptr},
};

}  // namespace blender
