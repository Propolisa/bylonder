/* rna_fcurve.cc's runtime part (RNA_RUNTIME), which makesrna's generated code calls: the F-Curve structs' RNA
 * functions (set functions and updates of F-Curves, keys, F-Modifiers and drivers), listed for the module's properties
 * of the same name (rna_fcurve_funcs.inc, generated from dna-fcurve.json) so that setting one from JS or a button runs
 * Blender's. Its enum tables are the definition part's, compiled from the same file. */
#include "RNA_prototypes.hh"

#define RNA_RUNTIME
#define rna_enum_fmodifier_type_items rna_enum_fmodifier_type_items_runtime
#define rna_enum_fcurve_auto_smoothing_items rna_enum_fcurve_auto_smoothing_items_runtime
#define rna_enum_beztriple_keyframe_type_items rna_enum_beztriple_keyframe_type_items_runtime
#define rna_enum_beztriple_interpolation_easing_items rna_enum_beztriple_interpolation_easing_items_runtime
#define rna_enum_driver_target_rotation_mode_items rna_enum_driver_target_rotation_mode_items_runtime
#include "rna_fcurve.cc"

#include "BKE_context.hh"

#define RNA_FUNCS_FILE "rna_fcurve_funcs.inc"
#define RNA_TABLES rna_fcurve_tables
#include "rna-tables.hh"

namespace blender {

/* FCurve.update(): the keys sorted, duplicates removed and handles recalculated (rna_FCurve_update_data_ex). */
extern "C" __attribute__((export_name("rna_fcurve_update"))) void rna_fcurve_update(bContext *C, ID *id, FCurve *fcu)
{
  rna_FCurve_update_data_ex(id, fcu, CTX_data_main(C));
}

}  // namespace blender
