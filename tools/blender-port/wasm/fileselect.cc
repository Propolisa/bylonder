/* Blender's file browser for an operator (WM_event_add_fileselect: Install from Disk, an ImportHelper or ExportHelper,
 * Open Image, the importers and exporters) as the browser's own file dialogs (src/windowmanager/wm-fileselect.js).
 * Blender's fileselect handler keeps the operator; the page chooses files where the File Browser area would open, puts
 * them in the module's file system and sends what the File Browser sends when it executes or cancels. An operator that
 * browses inside a .blend (Link and Append) gets Blender's File Browser over the chosen file: an area of the page
 * (src/editors/space_file/file-browser.js) that fileselect_area_set gives the operator. */
#include <string>

#include "BKE_context.hh"
#include "BKE_wm_runtime.hh"
#include "BLI_listbase.h"
#include "BLI_path_utils.hh"
#include "BLI_rect.h"
#include "DNA_space_types.h"
#include "ED_fileselect.hh"
#include "RNA_access.hh"
#include "WM_api.hh"
#include "WM_types.hh"
#include "wm_event_system.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))
#define WRAP_(prefix, name) prefix##name
#define WRAP(prefix, name) WRAP_(prefix, name)

using namespace blender;

/* The page's dialog for `op`: its settings as JSON (title, filter_glob, filepath, whether it saves, whether it takes
 * several files or a directory, whether it browses inside a .blend). */
IMPORT(fileselect_open) void js_fileselect_open(wmOperator *op, const char *settings);

static std::string string_property(PointerRNA *ptr, const char *name)
{
  PropertyRNA *prop = RNA_struct_find_property(ptr, name);
  return prop && RNA_property_type(prop) == PROP_STRING ? RNA_property_string_get(ptr, prop) : std::string();
}
/* A saving operator checks for an existing file, as Blender's exporters and ExportHelper's do (FILE_SAVE). */
static bool saves(PointerRNA *ptr)
{
  PropertyRNA *prop = RNA_struct_find_property(ptr, "check_existing");
  return prop && RNA_property_boolean_get(ptr, prop);
}
static bool browses_library(PointerRNA *ptr)
{
  PropertyRNA *prop = RNA_struct_find_property(ptr, "filemode");
  return prop && RNA_property_int_get(ptr, prop) == FILE_LOADLIB;
}
static std::string json_string(const std::string &text)
{
  std::string out = "\"";
  for (const char c : text) {
    out += c == '"' || c == '\\' ? std::string("\\") + c : std::string(1, c);
  }
  return out + "\"";
}

#define WM_EVENT_ADD_FILESELECT _ZN7blender23WM_event_add_fileselectEPNS_8bContextEPNS_10wmOperatorE
extern "C" void WRAP(__real_, WM_EVENT_ADD_FILESELECT)(bContext *C, wmOperator *op);
/* port-override: the File Browser opens as the browser's dialog: Blender's handler is added, its event to open the File
 * Browser taken back, and the page asked instead. */
extern "C" void WRAP(__wrap_, WM_EVENT_ADD_FILESELECT)(bContext *C, wmOperator *op)
{
  WRAP(__real_, WM_EVENT_ADD_FILESELECT)(C, op);
  for (wmWindow &win : CTX_wm_manager(C)->windows) {
    for (wmEvent *event = static_cast<wmEvent *>(win.runtime->event_queue.first), *next; event; event = next) {
      next = event->next;
      if (event->type == EVT_FILESELECT && event->val == EVT_FILESELECT_FULL_OPEN && event->customdata == op) {
        BLI_remlink(&win.runtime->event_queue, event);
        wm_event_free(event);
      }
    }
  }
  const std::string settings = "{\"title\":" + json_string(WM_operatortype_name(op->type, op->ptr)) +
                               ",\"filter_glob\":" + json_string(string_property(op->ptr, "filter_glob")) +
                               ",\"filepath\":" + json_string(string_property(op->ptr, "filepath")) +
                               ",\"save\":" + (saves(op->ptr) ? "true" : "false") +
                               ",\"files\":" + (RNA_struct_find_property(op->ptr, "files") ? "true" : "false") +
                               ",\"directory\":" + (RNA_struct_find_property(op->ptr, "filepath") ? "false" : "true") +
                               ",\"library\":" + (browses_library(op->ptr) ? "true" : "false") + "}";
  js_fileselect_open(op, settings.c_str());
}

/* A File Browser area of the page browsing for `op`, set up as the one EVT_FILESELECT_FULL_OPEN opens
 * (wm_handler_fileselect_do): it sends the operator's execute or cancel event, and freeing the area cancels it. */
EXPORT(fileselect_area_set) void fileselect_area_set(ScrArea *area, wmOperator *op)
{
  SpaceFile *sfile = static_cast<SpaceFile *>(area->spacedata.first);
  sfile->op = op;
  ED_fileselect_set_params_from_userdef(sfile);
}

/* The file browser's handler that holds the operator, or null. */
static wmEventHandler_Op *fileselect_handler(bContext *C, const wmOperator *op)
{
  for (wmWindow &win : CTX_wm_manager(C)->windows) {
    for (wmEventHandler &handler : win.runtime->modalhandlers) {
      auto &op_handler = reinterpret_cast<wmEventHandler_Op &>(handler);
      if (handler.type == WM_HANDLER_TYPE_OP && op_handler.is_fileselect && op_handler.op == op) {
        return &op_handler;
      }
    }
  }
  return nullptr;
}

/* What the File Browser sends when it executes or cancels, from the operator's area, as from the File Browser's own,
 * where the pointer then is: the window handles an event in the area under it, which the handling reads. */
static void fileselect_event(bContext *C, wmOperator *op, int value)
{
  const wmEventHandler_Op *handler = fileselect_handler(C, op);
  if (handler && handler->context.area) {
    const rcti &rect = handler->context.area->totrct;
    for (wmWindow &win : CTX_wm_manager(C)->windows) {
      win.runtime->eventstate->xy[0] = BLI_rcti_cent_x(&rect);
      win.runtime->eventstate->xy[1] = BLI_rcti_cent_y(&rect);
    }
  }
  WM_event_fileselect_event(CTX_wm_manager(C), op, value);
}

/* The files chosen, in `directory` (names newline separated), as the File Browser sets them on the operator
 * (filepath, directory, filename and files), then its execute event. */
EXPORT(fileselect_exec) void fileselect_exec(bContext *C, wmOperator *op, const char *directory, const char *names)
{
  const std::string all = names, first = all.substr(0, all.find('\n'));
  char filepath[FILE_MAX];
  BLI_path_join(filepath, sizeof(filepath), directory, first.c_str());
  if (RNA_struct_find_property(op->ptr, "filepath")) {
    RNA_string_set(op->ptr, "filepath", filepath);
  }
  if (RNA_struct_find_property(op->ptr, "directory")) {
    RNA_string_set(op->ptr, "directory", directory);
  }
  if (RNA_struct_find_property(op->ptr, "filename")) {
    RNA_string_set(op->ptr, "filename", first.c_str());
  }
  if (RNA_struct_find_property(op->ptr, "files")) {
    RNA_collection_clear(op->ptr, "files");
    for (size_t start = 0, end; start < all.size(); start = end + 1) {
      end = std::min(all.find('\n', start), all.size());
      PointerRNA item;
      RNA_collection_add(op->ptr, "files", &item);
      RNA_string_set(&item, "name", all.substr(start, end - start).c_str());
    }
  }
  fileselect_event(C, op, EVT_FILESELECT_EXEC);
}

EXPORT(fileselect_cancel) void fileselect_cancel(bContext *C, wmOperator *op)
{
  fileselect_event(C, op, EVT_FILESELECT_CANCEL);
}

namespace blender::ui {
std::string operator_props_layout(bContext *C, wmOperator *op);
}
/* The operator's options as the File Browser's sidebar shows them (its ui, else its properties), as a layout tree for
 * the page's dialog. */
EXPORT(fileselect_options) const char *fileselect_options(bContext *C, wmOperator *op)
{
  static std::string layout;
  layout = ui::operator_props_layout(C, op);
  return layout.c_str();
}

/* Whether Blender's fileselect handler holds `op`, which then outlives the invoke that added the handler. */
EXPORT(fileselect_held) bool fileselect_held(bContext *C, wmOperator *op) { return fileselect_handler(C, op); }
