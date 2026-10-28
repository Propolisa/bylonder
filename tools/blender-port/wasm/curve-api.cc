/* Blender's Curve and Text objects in the module's Main (main-api.cc makes them with main_object_add, OB_CURVES_LEGACY
 * or OB_FONT): their splines and text in and out, evaluation as the depsgraph evaluates them (BKE_displist_make_curveTypes,
 * BKE_vfont_to_curve for text) to the mesh Blender draws, and Edit Mode with Blender's own curve and font editors
 * (editcurve.cc, editfont.cc), whose operators run on the Main's context. Settings are written by JS at their DNA
 * offsets (dna-curves.json). Fonts are VFont IDs in the Main, Blender's built-in font (bfont.pfb, embedded as
 * Blender's datatoc embeds it) or a font file's bytes packed into one. */
#include "BKE_context.hh"
#include "ED_screen.hh"
#include "BKE_curve.hh"
#include "BKE_curve_to_mesh.hh"
#include "BKE_curveprofile.h"
#include "DNA_curveprofile_types.h"
#include "BKE_curves.hh"
#include "BKE_displist.h"
#include "BKE_geometry_set.hh"
#include "BKE_global.hh"
#include "BKE_lib_id.hh"
#include "BKE_main.hh"
#include "BKE_mesh.hh"
#include "BKE_object.hh"
#include "BKE_object_types.hh"
#include "BKE_packedFile.hh"
#include "BLI_implicit_sharing.hh"
#include "DNA_packedFile_types.h"
#include "BKE_screen.hh"
#include "BKE_vfont.hh"
#include "BKE_vfontdata.hh"
#include "BLI_listbase.h"
#include "BLI_math_matrix.h"
#include "BLI_path_utils.hh"
#include "BLI_string.h"
#include "BLI_string_utf8.h"
#include "DEG_depsgraph.hh"
#include "DEG_depsgraph_query.hh"
#include "DNA_curve_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_screen_types.h"
#include "DNA_space_types.h"
#include "DNA_vfont_types.h"
#include "DNA_view3d_types.h"
#include "ED_curve.hh"
#include "ED_select_utils.hh"
#include "ED_view3d.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "WM_api.hh"
#include "WM_types.hh"

#include "extraction.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

extern const char datatoc_bfont_pfb[];
extern const int datatoc_bfont_pfb_size;

/* Blender's blenfont, built for text objects with its BLF_ functions renamed vfont_BLF_ (manifest.json), as the
 * interface's BLF_ functions are region-draw.cc's. */
namespace blender {
int vfont_BLF_init();
}

/* As Blender's main sets fonts up before any data is made (BLF_init, BKE_vfont_builtin_register); types_ensure
 * (modifier-api.cc) calls it. */
void fonts_init()
{
  vfont_BLF_init();
  BKE_vfont_builtin_register(datatoc_bfont_pfb, datatoc_bfont_pfb_size);
}

static Curve &curve_of(Object *ob) { return *id_cast<Curve *>(ob->data); }

/* Splines as ints and floats: per spline NURB_INTS ints, then per point BEZT_INTS ints and BEZT_FLOATS floats for a
 * Bezier spline, else BP_INTS and BP_FLOATS. */
enum { NURB_INTS = 15, BEZT_INTS = 6, BEZT_FLOATS = 12, BP_INTS = 2, BP_FLOATS = 7 };

struct NurbsHeader {
  int nurbs_num, ints_num, floats_num;
  const int *ints;
  const float *floats;
  /* The active spline and point (Curve.actnu, Curve.actvert). */
  int actnu, actvert;
};

/* The edit splines in Edit Mode, else the curve's. */
static ListBaseT<Nurb> &nurbs_of(Object *ob) { return *BKE_curve_nurbs_get(&curve_of(ob)); }

/* The splines in curve_nurbs_set's layout, valid until the next call. */
EXPORT(curve_nurbs_get) const NurbsHeader *curve_nurbs_get(Object *ob)
{
  static NurbsHeader header;
  static Vector<int> ints;
  static Vector<float> floats;
  ints.clear();
  floats.clear();
  int nurbs_num = 0;
  for (const Nurb &nu : nurbs_of(ob)) {
    ints.extend({nu.type, nu.flag, nu.pntsu, nu.pntsv, nu.orderu, nu.orderv, nu.resolu, nu.resolv, nu.flagu, nu.flagv, nu.mat_nr, nu.hide,
                 nu.charidx, nu.tilt_interp, nu.radius_interp});
    if (nu.bezt) {
      for (const BezTriple &bezt : Span(nu.bezt, nu.pntsu)) {
        ints.extend({bezt.h1, bezt.h2, bezt.f1, bezt.f2, bezt.f3, bezt.hide});
        floats.extend(Span(&bezt.vec[0][0], 9));
        floats.extend({bezt.tilt, bezt.weight, bezt.radius});
      }
    }
    else {
      for (const BPoint &bp : Span(nu.bp, nu.pntsu * nu.pntsv)) {
        ints.extend({bp.f1, bp.hide});
        floats.extend(Span(bp.vec, 4));
        floats.extend({bp.tilt, bp.weight, bp.radius});
      }
    }
    nurbs_num++;
  }
  const Curve &cu = curve_of(ob);
  header = {nurbs_num, int(ints.size()), int(floats.size()), ints.data(), floats.data(), cu.actnu, cu.actvert};
  return &header;
}

/* Replaces the splines (the edit splines in Edit Mode), their knots calculated as reading a file does. */
EXPORT(curve_nurbs_set) void curve_nurbs_set(Object *ob, int nurbs_num, const int *ints, const float *floats, int actnu, int actvert)
{
  ListBaseT<Nurb> &nurbs = nurbs_of(ob);
  BKE_nurbList_free(&nurbs);
  for (int n = 0; n < nurbs_num; n++) {
    Nurb *nu = MEM_new<Nurb>(__func__);
    nu->type = eNurbType(ints[0]);
    nu->flag = eNurbFlag(ints[1]);
    nu->pntsu = ints[2];
    nu->pntsv = ints[3];
    nu->orderu = short(ints[4]);
    nu->orderv = short(ints[5]);
    nu->resolu = short(ints[6]);
    nu->resolv = short(ints[7]);
    nu->flagu = eNurbKnotFlag(ints[8]);
    nu->flagv = eNurbKnotFlag(ints[9]);
    nu->mat_nr = short(ints[10]);
    nu->hide = short(ints[11]);
    nu->charidx = ints[12];
    nu->tilt_interp = short(ints[13]);
    nu->radius_interp = short(ints[14]);
    ints += NURB_INTS;
    if (nu->type == CU_BEZIER) {
      nu->bezt = MEM_new_array_zeroed<BezTriple>(nu->pntsu, __func__);
      for (BezTriple &bezt : MutableSpan(nu->bezt, nu->pntsu)) {
        bezt.h1 = eBezTriple_Handle(ints[0]);
        bezt.h2 = eBezTriple_Handle(ints[1]);
        bezt.f1 = eBezTriple_Flag(ints[2]);
        bezt.f2 = eBezTriple_Flag(ints[3]);
        bezt.f3 = eBezTriple_Flag(ints[4]);
        bezt.hide = char(ints[5]);
        std::copy_n(floats, 9, &bezt.vec[0][0]);
        bezt.tilt = floats[9];
        bezt.weight = floats[10];
        bezt.radius = floats[11];
        ints += BEZT_INTS;
        floats += BEZT_FLOATS;
      }
    }
    else {
      nu->bp = MEM_new_array_zeroed<BPoint>(nu->pntsu * nu->pntsv, __func__);
      for (BPoint &bp : MutableSpan(nu->bp, nu->pntsu * nu->pntsv)) {
        bp.f1 = uint8_t(ints[0]);
        bp.hide = short(ints[1]);
        std::copy_n(floats, 4, bp.vec);
        bp.tilt = floats[4];
        bp.weight = floats[5];
        bp.radius = floats[6];
        ints += BP_INTS;
        floats += BP_FLOATS;
      }
      if (nu->type == CU_NURBS) {
        BKE_nurb_knot_calc_u(nu);
        BKE_nurb_knot_calc_v(nu);
      }
    }
    BLI_addtail(&nurbs, nu);
  }
  Curve &cu = curve_of(ob);
  cu.actnu = actnu;
  cu.actvert = actvert;
}

/* What RNA's update does after a point of a spline changes (rna_Curve_update_points): its handles calculated again. */
EXPORT(curve_nurb_handles_calc) void curve_nurb_handles_calc(Object *ob, int index)
{
  if (Nurb *nu = static_cast<Nurb *>(BLI_findlink(&nurbs_of(ob), index))) {
    BKE_nurb_handles_calc(nu);
  }
}

/* Text: its body (UTF-8; the edit text in Edit Mode), each character's format, the cursor and selection, the text
 * boxes, and in Edit Mode where the evaluated layout put the cursor and the selection boxes. */
struct TextHeader {
  const char *body;
  int len_char32;
  const CharInfo *info;
  int pos, selstart, selend;
  const float *textcurs;
  const EditFontSelBox *selboxes;
  int selboxes_len;
  const TextBox *tb;
  int totbox, actbox;
};

EXPORT(curve_text_get) const TextHeader *curve_text_get(Object *ob)
{
  static TextHeader header;
  Curve &cu = curve_of(ob);
  if (EditFont *ef = cu.editfont) {
    ED_curve_editfont_load(ob);
    header = {cu.str, cu.len_char32, ef->textbufinfo, ef->pos, ef->selstart, ef->selend, &ef->textcurs[0][0], ef->selboxes,
              ef->selboxes_len, cu.tb, cu.totbox, cu.actbox};
  }
  else {
    header = {cu.str, cu.len_char32, cu.strinfo, cu.pos, cu.selstart, cu.selend, nullptr, nullptr, 0, cu.tb, cu.totbox, cu.actbox};
  }
  return &header;
}

/* Sets the text (UTF-8) and its characters' formats (one per character, or null for none), as reading a file sets
 * them; in Edit Mode the edit text is made from them again. */
EXPORT(curve_text_set) void curve_text_set(Object *ob, const char *body, const CharInfo *info, int pos, int selstart, int selend)
{
  Curve &cu = curve_of(ob);
  MEM_SAFE_DELETE(cu.str);
  MEM_SAFE_DELETE(cu.strinfo);
  size_t len_bytes;
  cu.len_char32 = int(BLI_strlen_utf8_ex(body, &len_bytes));
  cu.len = int(len_bytes);
  cu.str = MEM_new_array_uninitialized<char>(len_bytes + sizeof(char32_t), "str");
  memcpy(cu.str, body, len_bytes + 1);
  cu.strinfo = MEM_new_array<CharInfo>(cu.len_char32 + 4, "strinfo");
  if (info) {
    std::copy_n(info, cu.len_char32, cu.strinfo);
  }
  cu.pos = pos;
  cu.selstart = selstart;
  cu.selend = selend;
  if (cu.editfont) {
    ED_curve_editfont_make(ob);
    cu.editfont->selstart = selstart;
    cu.editfont->selend = selend;
  }
}

/* Sets the text boxes (x, y, width and height each) and the active one. */
/* What RNA's bevel_mode setter and update do (rna_Curve_bevel_mode_set, rna_Curve_bevel_resolution_update): the
 * Profile mode's profile made when there is none, and fitted to the bevel resolution. */
EXPORT(curve_bevel_profile_update) void curve_bevel_profile_update(Object *ob)
{
  Curve &cu = curve_of(ob);
  if (cu.bevel_mode != CU_BEV_MODE_CURVE_PROFILE) {
    return;
  }
  if (cu.bevel_profile == nullptr) {
    cu.bevel_profile = BKE_curveprofile_add(PROF_PRESET_LINE);
  }
  BKE_curveprofile_init(cu.bevel_profile, cu.bevresol + 1);
}

EXPORT(curve_text_boxes_set) void curve_text_boxes_set(Object *ob, const float *boxes, int totbox, int actbox)
{
  Curve &cu = curve_of(ob);
  cu.totbox = std::clamp(totbox, 1, MAXTEXTBOX);
  cu.actbox = actbox;
  std::copy_n(boxes, 4 * cu.totbox, &cu.tb[0].x);
}

/* A font in the Main from a TrueType, OpenType or Type 1 file's bytes, packed as Blender packs a font file; null when
 * FreeType cannot read it. */
EXPORT(curve_vfont_new) VFont *curve_vfont_new(Main *bmain, const void *data, int size, const char *filepath)
{
  VFont *vfont = static_cast<VFont *>(BKE_id_new(bmain, ID_VF, BLI_path_basename(filepath)));
  BKE_vfont_data_free(vfont);
  void *copy = MEM_new_uninitialized(size, __func__);
  memcpy(copy, data, size);
  vfont->packedfile = BKE_packedfile_new_from_memory(copy, size);
  STRNCPY(vfont->filepath, filepath);
  BKE_vfont_data_ensure(vfont);
  if (!vfont->data) {
    BKE_id_free(bmain, vfont);
    return nullptr;
  }
  id_us_min(&vfont->id);
  return vfont;
}

/* Blender's built-in font, in G_MAIN as BKE_vfont_builtin_ensure keeps it. */
EXPORT(curve_vfont_builtin) VFont *curve_vfont_builtin() { return BKE_vfont_builtin_ensure(); }

/* The font's name as its file names it. */
EXPORT(curve_vfont_name) const char *curve_vfont_name(const VFont *vfont) { return vfont->data ? vfont->data->name : vfont->id.name + 2; }

/* Sets the regular, bold, italic or bold italic font (0 to 3), as RNA's font setters do. */
EXPORT(curve_text_font_set) void curve_text_font_set(Object *ob, int slot, VFont *vfont)
{
  Curve &cu = curve_of(ob);
  VFont **fonts[] = {&cu.vfont, &cu.vfontb, &cu.vfonti, &cu.vfontbi};
  if (*fonts[slot]) {
    id_us_min(&(*fonts[slot])->id);
  }
  *fonts[slot] = vfont;
  id_us_plus(&vfont->id);
}

/* The object a Curve's pointer (bevel_object, taper_object, follow_curve) names, at its DNA offset. */
EXPORT(curve_object_pointer_set) void curve_object_pointer_set(Object *ob, int offset, Object *target)
{
  *reinterpret_cast<Object **>(reinterpret_cast<char *>(ob->data) + offset) = target;
}

/* Evaluates a curve or text object as the depsgraph does in the viewport (its modifiers included; objects it follows
 * are evaluated first, by the caller) and extracts the mesh Blender draws, valid until the next evaluation: the mesh
 * of a filled, extruded or beveled curve, or the wire of its evaluated curves (curve_to_wire_mesh, as Object > Convert
 * makes it); null when it has neither. */
EXPORT(curve_object_eval) const ExtractionHeader *curve_object_eval(bContext *C, Object *ob)
{
  static ExtractionHeader header;
  BKE_displist_make_curveTypes(CTX_data_depsgraph_pointer(C), CTX_data_scene(C), ob, false);
  bke::GeometrySet &geometry = *ob->runtime->geometry_set_eval;
  if (!geometry.has_mesh() && geometry.has_curves()) {
    geometry.replace_mesh(bke::curve_to_wire_mesh(geometry.get_curves()->geometry.wrap()));
  }
  const Mesh *mesh = geometry.get_mesh();
  if (!mesh) {
    return nullptr;
  }
  mesh_extraction(*mesh, header);
  return &header;
}

/* Edit Mode data, as object.editmode_toggle makes it (ED_curve_editnurb_make, ED_curve_editfont_make) and loads it
 * back; the object's mode and base are the caller's (object_mode_set, main_base_set). */
EXPORT(curve_edit_make) void curve_edit_make(Object *ob)
{
  if (ob->type == OB_FONT) {
    ED_curve_editfont_make(ob);
  }
  else {
    ED_curve_editnurb_make(ob);
  }
}

static ListBaseT<Nurb> snapshot = {nullptr, nullptr};

EXPORT(curve_edit_load_free) void curve_edit_load_free(Main *bmain, Object *ob)
{
  if (ob->type == OB_FONT) {
    ED_curve_editfont_load(ob);
    ED_curve_editfont_free(ob);
  }
  else {
    ED_curve_editnurb_load(bmain, ob);
    ED_curve_editnurb_free(ob);
  }
  BKE_nurbList_free(&snapshot);
}

/* A transform's steps each start from the edit splines as they were when it began, as Blender's transform restores
 * its TransData; each step then runs Blender's transform operator with the step's values. */
EXPORT(curve_edit_snapshot) void curve_edit_snapshot(Object *ob)
{
  BKE_nurbList_free(&snapshot);
  BKE_nurbList_duplicate(&snapshot, &nurbs_of(ob));
}
EXPORT(curve_edit_restore) void curve_edit_restore(Object *ob)
{
  ListBaseT<Nurb> &nurbs = nurbs_of(ob);
  BKE_nurbList_free(&nurbs);
  BKE_nurbList_duplicate(&nurbs, &snapshot);
}

/* view3d.select in Edit Mode: Blender's pick at a region pixel within dist_px (ED_view3d_select_dist_px, which reads
 * the UI scale), as ED_curve_editnurb_select_pick picks, in a context with a 3D View (view3d_region_attach). */
EXPORT(curve_select_pick)
bool curve_select_pick(bContext *C, int x, int y, int dist_px, int sel_op, bool deselect_all, bool select_passthrough)
{
  const int mval[2] = {x, y};
  SelectPick_Params params{};
  params.sel_op = eSelectOp(sel_op);
  params.deselect_all = deselect_all;
  params.select_passthrough = select_passthrough;
  return ED_curve_editnurb_select_pick(C, mval, dist_px, params);
}

/* Box, lasso and circle select in Edit Mode (do_nurbs_box_select, do_lasso_select_curve, nurbscurve_circle_select in
 * view3d_select.cc), in two steps: curve_screen_verts gives the points nurbs_foreachScreenVert visits (region pixels,
 * x then y), JS tests them against its gesture's shape, and curve_select_region selects by those results in the same
 * order. */
static void curve_foreach_screen_vert(bContext *C,
                                      void (*fn)(void *, Nurb *, BPoint *, BezTriple *, int, bool, const float[2]),
                                      void *user_data)
{
  ViewContext vc = ED_view3d_viewcontext_init(C, CTX_data_depsgraph_pointer(C));
  ED_view3d_init_mats_rv3d(vc.obedit, vc.rv3d);
  nurbs_foreachScreenVert(&vc, fn, user_data, V3D_PROJ_TEST_CLIP_DEFAULT);
}

struct ScreenVerts {
  float *co;
  int len, max;
};
EXPORT(curve_screen_verts) int curve_screen_verts(bContext *C, float *r_co, int max)
{
  ScreenVerts verts{r_co, 0, max};
  curve_foreach_screen_vert(
      C,
      [](void *user_data, Nurb *, BPoint *, BezTriple *, int, bool, const float screen_co[2]) {
        ScreenVerts &v = *static_cast<ScreenVerts *>(user_data);
        if (v.len < v.max) {
          copy_v2_v2(v.co + 2 * v.len, screen_co);
        }
        v.len++;
      },
      &verts);
  return verts.len;
}

struct RegionSelect {
  const uint8_t *inside;
  int index;
  eSelectOp sel_op;
  bool circle;
  short select_flag;
  bool is_changed;
};
/* port-override: do_nurbs_box_select__doSelect and nurbscurve_circle_doSelect with the inside test made in JS. */
static void region_select_vert(
    void *user_data, Nurb *, BPoint *bp, BezTriple *bezt, int beztindex, bool handles_visible, const float[2])
{
  RegionSelect &data = *static_cast<RegionSelect *>(user_data);
  const bool is_inside = data.inside[data.index++];
  uint8_t *flag_p = bp ? &bp->f1 : reinterpret_cast<uint8_t *>(&bezt->f1) + (data.circle || handles_visible ? beztindex : 1);
  if (data.circle) {
    if (is_inside) {
      SET_FLAG_FROM_TEST(*flag_p, data.sel_op != SEL_OP_SUB, data.select_flag);
      data.is_changed = true;
    }
    return;
  }
  const int sel_op_result = ED_select_op_action_deselected(data.sel_op, *flag_p & SELECT, is_inside);
  if (sel_op_result != -1) {
    SET_FLAG_FROM_TEST(*flag_p, sel_op_result, data.select_flag);
    data.is_changed = true;
  }
  if (bezt && !handles_visible) {
    bezt->f1 = bezt->f3 = bezt->f2;
  }
}
EXPORT(curve_select_region) bool curve_select_region(bContext *C, int sel_op, bool circle, const uint8_t *inside)
{
  Curve *curve = id_cast<Curve *>(CTX_data_edit_object(C)->data);
  ListBaseT<Nurb> *nurbs = BKE_curve_editNurbs_get(curve);
  RegionSelect data{inside, 0, eSelectOp(sel_op), circle, SELECT, false};
  const bool deselect_all = data.sel_op == SEL_OP_SET;
  if (deselect_all) {
    BKE_nurbList_flag_set(nurbs, BEZT_FLAG_TEMP_TAG, false);
    data.select_flag = BEZT_FLAG_TEMP_TAG;
  }
  curve_foreach_screen_vert(C, region_select_vert, &data);
  if (deselect_all) {
    data.is_changed |= BKE_nurbList_flag_set_from_flag(nurbs, BEZT_FLAG_TEMP_TAG, BEZT_FLAG_SELECT);
  }
  BKE_curve_nurb_vert_active_validate(curve);
  return data.is_changed;
}

/* The enum property an operator's invoke offers as a menu (WM_menu_invoke on ot->prop: curve.handle_type_set's
 * type), or null when its invoke is not a menu. */
EXPORT(operator_menu_property) const char *operator_menu_property(wmOperator *op)
{
  return op->type->invoke == WM_menu_invoke && op->type->prop ? RNA_property_identifier(op->type->prop) : nullptr;
}

/* Sets a string property (font.text_insert's text). */
EXPORT(operator_string_set) void operator_string_set(wmOperator *op, const char *name, const char *value) { RNA_string_set(op->ptr, name, value); }

/* A 3D View's area and window region, for operators that pick or project (curve picking, transform): the region's size
 * and the view's matrices (column-major, Blender's axes) as ED_view3d_update_viewmat sets them, and the overlay's
 * handle display. */
struct View3DRegion {
  ScrArea area = {};
  ARegion region = {};
  RegionView3D rv3d = {};
  View3D v3d = {};
};

EXPORT(view3d_region_new) View3DRegion *view3d_region_new()
{
  View3DRegion *r = MEM_new<View3DRegion>(__func__);
  r->region.runtime = MEM_new<bke::ARegionRuntime>(__func__);
  r->region.regiontype = RGN_TYPE_WINDOW;
  r->region.regiondata = &r->rv3d;
  r->v3d.spacetype = SPACE_VIEW3D;
  r->v3d.overlay.handle_display = CURVE_HANDLE_SELECTED;
  r->area.spacetype = SPACE_VIEW3D;
  BLI_addtail(&r->area.spacedata, &r->v3d);
  BLI_addtail(&r->area.regionbase, &r->region);
  return r;
}

EXPORT(view3d_region_set) void view3d_region_set(View3DRegion *r, int winx, int winy, const float *viewmat, const float *winmat, int handle_display)
{
  RegionView3D &rv3d = r->rv3d;
  r->region.winx = short(winx);
  r->region.winy = short(winy);
  r->region.winrct = {0, winx - 1, 0, winy - 1};
  std::copy_n(viewmat, 16, &rv3d.viewmat[0][0]);
  std::copy_n(winmat, 16, &rv3d.winmat[0][0]);
  invert_m4_m4(rv3d.viewinv, rv3d.viewmat);
  mul_m4_m4m4(rv3d.persmat, rv3d.winmat, rv3d.viewmat);
  invert_m4_m4(rv3d.persinv, rv3d.persmat);
  rv3d.is_persp = winmat[11] != 0.0f;
  r->v3d.overlay.handle_display = eHandleDisplay(handle_display);
}

/* Makes the region the context's area and region (or none), as Blender's handlers set them around an operator. */
EXPORT(view3d_region_attach) void view3d_region_attach(bContext *C, View3DRegion *r)
{
  CTX_wm_area_set(C, r ? &r->area : nullptr);
  CTX_wm_region_set(C, r ? &r->region : nullptr);
}

/* What curve evaluation reaches of Blender beyond the module. */

namespace blender {

/* The window has no capabilities (no primary clipboard): Bylonder's text clipboard is the browser's. */
eWM_CapabilitiesFlag WM_capabilities_flag() { return eWM_CapabilitiesFlag(0); }

/* As space_view3d.cc defines it; space_view3d.cc is the 3D View editor, whose drawing stays Bylonder's. */
void ED_view3d_init_mats_rv3d(const Object *ob, RegionView3D *rv3d)
{
  mul_m4_m4m4(rv3d->viewmatob, rv3d->viewmat, ob->object_to_world().ptr());
  mul_m4_m4m4(rv3d->persmatob, rv3d->persmat, ob->object_to_world().ptr());
  ED_view3d_clipping_local(rv3d, ob->object_to_world().ptr());
}

/* port-override: the region the module picks in has no clipping region (RV3D_CLIPPING, Alt B), so there is no local
 * clipping to compute (view3d_edit.cc). */
void ED_view3d_clipping_local(RegionView3D *rv3d, const float /*mat*/[4][4]) { BLI_assert(!(rv3d->rflag & RV3D_CLIPPING)); }

/* As screen_ops.cc answers it with no screen playing: the module's window plays no animation (Bylonder's timeline
 * does, outside it). */
bScreen *ED_screen_animation_playing(const wmWindowManager * /*wm*/) { return nullptr; }

/* port-override: picking projects on the CPU (view3d_project.cc), so it needs no GPU context. */
void view3d_operator_needs_gpu(const bContext * /*C*/) {}

/* As screen_ops.cc defines them; screen_ops.cc comes with Blender's screens. */
bool ED_operator_editsurfcurve(bContext *C)
{
  Object *obedit = CTX_data_edit_object(C);
  if (obedit && ELEM(obedit->type, OB_CURVES_LEGACY, OB_SURF)) {
    return nullptr != (id_cast<Curve *>(obedit->data))->editnurb;
  }
  return false;
}
bool ED_operator_editsurfcurve_region_view3d(bContext *C)
{
  if (ED_operator_editsurfcurve(C) && CTX_wm_region_view3d(C)) {
    return true;
  }
  CTX_wm_operator_poll_msg_set(C, "Expected a view3d region & editcurve");
  return false;
}
bool ED_operator_editcurve(bContext *C)
{
  Object *obedit = CTX_data_edit_object(C);
  if (obedit && obedit->type == OB_CURVES_LEGACY) {
    return nullptr != (id_cast<Curve *>(obedit->data))->editnurb;
  }
  return false;
}
bool ED_operator_editcurve_3d(bContext *C)
{
  Object *obedit = CTX_data_edit_object(C);
  if (obedit && obedit->type == OB_CURVES_LEGACY) {
    Curve *cu = id_cast<Curve *>(obedit->data);
    return (cu->flag & CU_3D) && (nullptr != cu->editnurb);
  }
  return false;
}
bool ED_operator_editsurf(bContext *C)
{
  Object *obedit = CTX_data_edit_object(C);
  if (obedit && obedit->type == OB_SURF) {
    return nullptr != (id_cast<Curve *>(obedit->data))->editnurb;
  }
  return false;
}
bool ED_operator_editfont(bContext *C)
{
  Object *obedit = CTX_data_edit_object(C);
  if (obedit && obedit->type == OB_FONT && id_cast<Curve *>(obedit->data)->editfont) {
    return true;
  }
  CTX_wm_operator_poll_msg_set(C, "Expected an active edit-font object");
  return false;
}

/* port-override: the module has no depsgraph to say which curves something follows (the Curve modifier, Follow
 * Path, text on a curve), so every curve has its path evaluated, as Blender does for a curve something follows. */
uint32_t DEG_get_eval_flags_for_id(const Depsgraph * /*graph*/, const ID * /*id*/) { return DAG_EVAL_NEED_CURVE_PATH; }

}  // namespace blender
