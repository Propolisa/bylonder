/* The constraint kernels module (constraints.wasm): constraint-api.cc without the rest of Blender. What the
 * constraints and the pose evaluation reach beyond their own files is defined here as Blender defines it, or left
 * out: a function nothing defines is an import that throws when reached (src/port/wasm.js). */
#include "BKE_global.hh"
#include "DEG_depsgraph.hh"
#include "BKE_object_types.hh"
#include "BKE_scene.hh"
#include "DNA_scene_types.h"
#include "DNA_userdef_types.h"
#include "RNA_types.hh"

#include <ctime>

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace blender {

/* As blender.cc defines them: Blender's globals start zeroed. */
Global G;
UserDef U;
extern const PointerRNA PointerRNA_NULL = {};

/* As scene.cc defines it; scene.cc comes with Blender's scenes, which the module's own scenes do without. */
float BKE_scene_ctime_get(const Scene *scene) { return (scene->r.cfra + scene->r.subframe) * scene->r.framelen; }

/* No depsgraph, so none of its evaluation to trace (no-depsgraph.cc). */
void DEG_debug_print_eval_subdata(Depsgraph * /*depsgraph*/, const char * /*function_name*/, const char * /*object_name*/,
                                  const void * /*object_address*/, const char * /*subdata_comment*/, const char * /*subdata_name*/,
                                  const void * /*subdata_address*/)
{
}

/* As object.cc defines them; object.cc comes with all of Blender's object types, which the module's objects do without. */
const float4x4 &Object::object_to_world() const { return this->runtime->object_to_world; }
const float4x4 &Object::world_to_object() const { return this->runtime->world_to_object; }

}  // namespace blender

/* port-override: Blender's main initializes the window manager, the interface and Python; the constraints need none,
 * and their types initialize on first use (BKE_constraint_typeinfo_from_type). */
void types_ensure() {}

/* Blender's initialization, which the host runs once after the module's own (_initialize). */
EXPORT(blender_init) void blender_init_export() { types_ensure(); }
