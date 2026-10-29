/* The page's reports as Blender's window manager's (BKE_report into wm->reports), which the Info editor lists and Blender's
 * own operators report into (windowmanager/wm-reports.js). */

#include "BKE_context.hh"
#include "BKE_report.hh"

#include "RNA_access.hh"
#include "RNA_enum_types.hh"

#include "WM_api.hh"
#include "WM_types.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* A report of a type by its identifier (rna_enum_wm_report_items: INFO, OPERATOR, WARNING, ERROR, ...). */
EXPORT(wm_report) void wm_report(bContext *C, const char *type, const char *message)
{
  int value = RPT_INFO;
  RNA_enum_value_from_id(rna_enum_wm_report_items, type, &value);
  BKE_report(CTX_wm_reports(C), eReportType(value), message);
  WM_main_add_notifier(NC_SPACE | ND_SPACE_INFO_REPORT, nullptr);
}
