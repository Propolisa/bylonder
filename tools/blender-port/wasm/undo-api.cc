/* Blender's undo on Main's context (ed_undo.cc, undo_system.cc, memfile_undo.cc, editmesh_undo.cc): the window
 * manager's undo stack, whose steps Blender's undo types write and load. Bylonder's editor keeps one history; each of
 * its steps holds the Blender step pushed with it, which loading makes Main's state again. */
#include "BKE_context.hh"
#include "BKE_lib_id.hh"
#include "BKE_main.hh"
#include "BKE_undo_system.hh"
#include "BKE_wm_runtime.hh"
#include "BLI_listbase.h"
#include "BLI_string.h"
#include "DNA_windowmanager_types.h"
#include "ED_undo.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

static UndoStack *stack_of(bContext *C) { return CTX_wm_manager(C)->runtime->undo_stack; }

/* The window manager as Blender keeps it, an ID in Main, where undo finds it (ED_undo_stack_get,
 * ED_editors_init_for_undo) and memfile undo carries it from one Main to the next (IDTYPE_FLAGS_NO_MEMFILE_UNDO). */
EXPORT(wm_main_link) void wm_main_link(bContext *C, bool linked)
{
  Main *bmain = CTX_data_main(C);
  wmWindowManager *wm = CTX_wm_manager(C);
  if (!wm->id.name[0]) {
    STRNCPY(wm->id.name, "WMWinMan");
    wm->id.tag |= ID_TAG_NO_MAIN;
    BKE_lib_libblock_session_uid_ensure(&wm->id);
  }
  if (linked) {
    BKE_libblock_management_main_add(bmain, wm);
  }
  else {
    BKE_libblock_management_main_remove(bmain, wm);
  }
}

/* A new undo stack from Main as it is, as reading a file starts one (wm_file_read_post). */
EXPORT(undo_stack_init) void undo_stack_init(bContext *C)
{
  static const bool types = (ED_undosys_type_init(), true);
  (void)types;
  wm_main_link(C, true);
  wmWindowManager *wm = CTX_wm_manager(C);
  if (wm->runtime->undo_stack == nullptr) {
    wm->runtime->undo_stack = BKE_undosys_stack_create();
  }
  else {
    BKE_undosys_stack_clear(wm->runtime->undo_stack);
  }
  BKE_undosys_stack_init_from_main(wm->runtime->undo_stack, CTX_data_main(C));
  BKE_undosys_stack_init_from_context(wm->runtime->undo_stack, C);
}

/* Pushes a step of Main's state (a memfile step, or an edit-mode step while an object is edited) and returns it. */
EXPORT(undo_push) UndoStep *undo_push(bContext *C, const char *name)
{
  ED_undo_push(C, name);
  return stack_of(C)->step_active;
}

/* Makes Main's state a step's, undoing or redoing to it; false when the stack no longer holds it. */
EXPORT(undo_load) bool undo_load(bContext *C, UndoStep *step)
{
  UndoStack *ustack = stack_of(C);
  if (BLI_findindex(&ustack->steps, step) == -1) {
    return false;
  }
  if (step != ustack->step_active) {
    BKE_undosys_step_load_data(ustack, C, step);
  }
  return true;
}

/* The active step, which the last push or load made. */
EXPORT(undo_active) UndoStep *undo_active(bContext *C) { return stack_of(C)->step_active; }
