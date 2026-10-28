/* The depsgraph the modules do without (editor-context.cc, modifier-api.cc), shared by the scene module and the
 * modifier kernels module. */
#include "BKE_scene.hh"
#include "DEG_depsgraph.hh"
#include "DEG_depsgraph_build.hh"
#include "DEG_depsgraph_query.hh"
#include "DNA_ID.h"
#include "DNA_customdata_types.h"

namespace blender {

/* port-override: the module has no depsgraph. Each ID is its own evaluated copy, and the editor evaluates modifiers
 * itself when they change (edit_mesh_eval, modifier_object_eval): the depsgraph is a token holding the scene it was
 * asked for, and the queries depsgraph_query.cc would answer from a graph answer from it. */
struct NoDepsgraph {
  Main *bmain;
  Scene *scene;
  ViewLayer *view_layer;
};
static const NoDepsgraph &no_depsgraph(const Depsgraph *depsgraph) { return *reinterpret_cast<const NoDepsgraph *>(depsgraph); }
Depsgraph *BKE_scene_ensure_depsgraph(Main *bmain, Scene *scene, ViewLayer *view_layer)
{
  static NoDepsgraph token;
  token = {bmain, scene, view_layer};
  return reinterpret_cast<Depsgraph *>(&token);
}
void DEG_make_active(Depsgraph * /*depsgraph*/) {}
bool DEG_is_active(const Depsgraph * /*depsgraph*/) { return true; }
void BKE_scene_graph_evaluated_ensure(Depsgraph * /*depsgraph*/, Main * /*bmain*/) {}
void DEG_id_type_tag(Main * /*bmain*/, short /*id_type*/) {}
void DEG_relations_tag_update(Main * /*bmain*/) {}
Main *DEG_get_bmain(const Depsgraph *graph) { return no_depsgraph(graph).bmain; }
Scene *DEG_get_input_scene(const Depsgraph *graph) { return no_depsgraph(graph).scene; }
ViewLayer *DEG_get_input_view_layer(const Depsgraph *graph) { return no_depsgraph(graph).view_layer; }
Scene *DEG_get_evaluated_scene(const Depsgraph *graph) { return no_depsgraph(graph).scene; }
ViewLayer *DEG_get_evaluated_view_layer(const Depsgraph *graph) { return no_depsgraph(graph).view_layer; }
eEvaluationMode DEG_get_mode(const Depsgraph * /*graph*/) { return DAG_EVAL_VIEWPORT; }
float DEG_get_ctime(const Depsgraph *graph) { return BKE_scene_ctime_get(no_depsgraph(graph).scene); }
ID *DEG_get_evaluated_id(const Depsgraph * /*depsgraph*/, ID *id) { return id; }
const ID *DEG_get_evaluated_id(const Depsgraph * /*depsgraph*/, const ID *id) { return id; }
/* No graph, so none of its evaluation to trace or count. */
uint64_t DEG_get_update_count(const Depsgraph * /*depsgraph*/) { return 0; }
void DEG_debug_print_eval(Depsgraph * /*depsgraph*/, const char * /*function_name*/, const char * /*object_name*/, const void * /*object_address*/) {}
/* No graph, so no custom data any of its evaluations asked for. */
void DEG_get_customdata_mask_for_object(const Depsgraph * /*graph*/, Object * /*object*/, CustomData_MeshMasks * /*r_mask*/) {}

/* As depsgraph_query.cc defines them. */
ID *DEG_get_original_id(ID *id) { return id && id->orig_id ? id->orig_id : id; }
const ID *DEG_get_original_id(const ID *id) { return id && id->orig_id ? id->orig_id : id; }
bool DEG_is_original_id(const ID *id)
{
  return !(id->tag & (ID_TAG_COPIED_ON_EVAL | ID_TAG_COPIED_ON_EVAL_FINAL_RESULT | ID_TAG_LOCALIZED));
}

}  // namespace blender
