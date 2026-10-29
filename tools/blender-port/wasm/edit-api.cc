/* An object in Edit Mode on Main, for code that selects in its edit mesh directly, as Blender's fixture scripts do
 * with bmesh (BMesh calls from bmesh-api.cc on it, then the flush). */
#include "BKE_editmesh.hh"
#include "DNA_object_types.h"
#include "ED_mesh.hh"
#include "bmesh.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* Its edit mesh's BMesh; null when it is not in Edit Mode. */
EXPORT(object_edit_bmesh) BMesh *object_edit_bmesh(Object *ob)
{
  BMEditMesh *em = BKE_editmesh_from_object(ob);
  return em ? em->bm : nullptr;
}
/* EDBM_selectmode_flush, after its elements were selected. */
EXPORT(object_edit_select_flush) void object_edit_select_flush(Object *ob) { EDBM_selectmode_flush(BKE_editmesh_from_object(ob)); }
