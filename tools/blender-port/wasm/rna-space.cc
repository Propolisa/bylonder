/* rna_space.cc's runtime part (RNA_RUNTIME), which makesrna's generated code calls: the animation editors' space
 * functions (the Dope Sheet's mode update, the Graph Editor's), listed for the module's properties of the same name
 * (rna_space_funcs.inc, generated from dna-anim.json). Its enum tables are the definition part's, compiled from the
 * same file. */
#include "RNA_prototypes.hh"

#define RNA_RUNTIME
#define rna_enum_geometry_component_type_items rna_enum_geometry_component_type_items_runtime
#define rna_enum_geometry_item_type_items rna_enum_geometry_item_type_items_runtime
#define rna_enum_space_type_items rna_enum_space_type_items_runtime
#define rna_enum_space_graph_mode_items rna_enum_space_graph_mode_items_runtime
#define rna_enum_space_sequencer_view_type_items rna_enum_space_sequencer_view_type_items_runtime
#define rna_enum_space_file_browse_mode_items rna_enum_space_file_browse_mode_items_runtime
#define rna_enum_space_action_mode_items rna_enum_space_action_mode_items_runtime
#define rna_enum_space_image_mode_all_items rna_enum_space_image_mode_all_items_runtime
#define rna_enum_space_image_mode_items rna_enum_space_image_mode_items_runtime
#define rna_enum_fileselect_params_sort_items rna_enum_fileselect_params_sort_items_runtime
#define rna_enum_asset_access_items rna_enum_asset_access_items_runtime
#define rna_enum_shading_type_items rna_enum_shading_type_items_runtime
#define rna_enum_clip_editor_mode_items rna_enum_clip_editor_mode_items_runtime
#define buttons_context_items buttons_context_items_runtime
#include "rna_space.cc"

#define RNA_FUNCS_FILE "rna_space_funcs.inc"
#define RNA_TABLES rna_space_tables
#include "rna-tables.hh"
