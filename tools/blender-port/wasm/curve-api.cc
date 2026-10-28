/* Blender's Curve and Text objects: a Curve ID (OB_CURVES_LEGACY or OB_FONT) and its Object, evaluated as the
 * depsgraph evaluates them (BKE_displist_make_curveTypes, BKE_vfont_to_curve for text) to the mesh Blender draws,
 * and edited by Blender's own curve and font editors (editcurve.cc, editfont.cc) with their operators and Blender's
 * transform.
 *
 * The object owns its ID for now; what it needs of a Scene (tool settings, a view layer whose active base is the
 * object, for the editors' context) is its own, until the module's Main holds them. JS writes the Curve's settings at
 * their DNA offsets (dna-curves.json), its splines and text through the functions below, and reads the evaluated mesh
 * through an ExtractionHeader. */
#include "BKE_context.hh"
#include "BKE_curve.hh"
#include "BKE_curve_to_mesh.hh"
#include "BKE_curves.hh"
#include "BKE_displist.h"
#include "BKE_geometry_set.hh"
#include "BKE_global.hh"
#include "BKE_idtype.hh"
#include "BKE_lib_id.hh"
#include "BKE_main.hh"
#include "BKE_mesh.hh"
#include "BKE_modifier.hh"
#include "BKE_object.hh"
#include "BKE_object_types.hh"
#include "BKE_packedFile.hh"
#include "BKE_report.hh"
#include "BKE_scene.hh"
#include "BKE_screen.hh"
#include "BKE_vfont.hh"
#include "BKE_vfontdata.hh"
#include "BKE_cpp_types.hh"
#include "BLF_api.hh"
#include "BLI_listbase.h"
#include "BLI_math_matrix.h"
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
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "RNA_prototypes.hh"
#include "WM_types.hh"

#include "extraction.hh"
#include "operator-properties.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

extern const char datatoc_bfont_pfb[];
extern const int datatoc_bfont_pfb_size;

/* As Blender's main sets them up before data is made: ID and modifier types, fonts (BLF and the built-in font), and
 * the Main that holds fonts (BKE_vfont_builtin_ensure looks in G_MAIN). */
static void curve_types_ensure()
{
  static const bool types = [] {
    BKE_cpp_types_init();
    BKE_idtype_init();
    BKE_modifier_init();
    BLF_init();
    BKE_vfont_builtin_register(datatoc_bfont_pfb, datatoc_bfont_pfb_size);
    if (!G_MAIN) {
      G_MAIN = BKE_main_new();
    }
    return true;
  }();
  (void)types;
}

struct CurveObject {
  bContext *C = nullptr;
  Vector<std::unique_ptr<bContextStore>> stores;
  Scene scene = {};
  ToolSettings tool_settings = {};
  ViewLayer view_layer = {};
  Base base = {};
  Object object = {};
  /* The 3D View an operator picks in: its region, view and overlay (handle display). */
  ScrArea area = {};
  ARegion region = {};
  RegionView3D rv3d = {};
  View3D v3d = {};
  /* The edit data as it was when a transform began, which each step starts from. */
  ListBaseT<Nurb> snapshot = {nullptr, nullptr};
  ExtractionHeader header = {};
  /* Splines and text as curve_nurbs_get and curve_text_get give them. */
  Vector<int> ints;
  Vector<float> floats;
  std::string text;
};

static Curve &curve_of(CurveObject *co) { return *id_cast<Curve *>(co->object.data); }

/* A Curve as BKE_curve_add makes one (OB_CURVES_LEGACY or OB_FONT), and an object of it, as add_type makes one. */
EXPORT(curve_object_new) CurveObject *curve_object_new(int ob_type, const char *name)
{
  curve_types_ensure();
  CurveObject *co = MEM_new<CurveObject>(__func__);
  Curve *cu = static_cast<Curve *>(BKE_libblock_alloc(nullptr, ID_CU_LEGACY, name, LIB_ID_CREATE_NO_MAIN));
  BKE_curve_init(cu, ObjectType(ob_type));
  Object &ob = co->object;
  ob.type = ob_type;
  ob.data = &cu->id;
  STRNCPY(ob.id.name, "OBCurve");
  ob.runtime = MEM_new<bke::ObjectRuntime>(__func__);
  ob.runtime->object_to_world = float4x4::identity();
  ob.runtime->world_to_object = float4x4::identity();

  co->base.object = &ob;
  co->base.flag = BASE_SELECTED | BASE_ENABLED_AND_VISIBLE_IN_DEFAULT_VIEWPORT;
  BLI_addtail(&co->view_layer.object_bases, &co->base);
  co->view_layer.basact = &co->base;
  BLI_addtail(&co->scene.view_layers, &co->view_layer);
  co->scene.toolsettings = &co->tool_settings;

  co->region.runtime = MEM_new<bke::ARegionRuntime>(__func__);
  co->region.regiontype = RGN_TYPE_WINDOW;
  co->region.regiondata = &co->rv3d;
  co->v3d.spacetype = SPACE_VIEW3D;
  co->v3d.overlay.handle_display = CURVE_HANDLE_SELECTED;
  co->area.spacetype = SPACE_VIEW3D;
  BLI_addtail(&co->area.spacedata, &co->v3d);
  BLI_addtail(&co->area.regionbase, &co->region);

  co->C = CTX_create();
  CTX_data_scene_set(co->C, &co->scene);
  CTX_wm_area_set(co->C, &co->area);
  CTX_wm_region_set(co->C, &co->region);
  PointerRNA object_ptr = {&ob.id, RNA_Object, &ob};
  CTX_store_add(co->stores, "active_object", &object_ptr);
  CTX_store_set(co->C, CTX_store_add(co->stores, "object", &object_ptr));
  return co;
}

static void edit_free(CurveObject *co)
{
  ED_curve_editnurb_free(&co->object);
  ED_curve_editfont_free(&co->object);
  BKE_nurbList_free(&co->snapshot);
}

EXPORT(curve_object_free) void curve_object_free(CurveObject *co)
{
  CTX_free(co->C);
  edit_free(co);
  BKE_object_free_derived_caches(&co->object);
  while (ModifierData *md = static_cast<ModifierData *>(BLI_pophead(&co->object.modifiers))) {
    BKE_modifier_free(md);
  }
  BKE_id_free(nullptr, co->object.data);
  MEM_delete(co->region.runtime);
  MEM_delete(co->object.runtime);
  MEM_delete(co);
}

EXPORT(curve_object_curve) Curve *curve_object_curve(CurveObject *co) { return &curve_of(co); }
/* The object, whose modifier stack modifier_add and modifier_clear (modifier-api.cc) change. */
EXPORT(curve_object_object) Object *curve_object_object(CurveObject *co) { return &co->object; }

/* The object's matrix (column-major, Blender's axes), which the Curve modifier and Follow Path read. */
EXPORT(curve_object_matrix_set) void curve_object_matrix_set(CurveObject *co, const float *object_to_world)
{
  bke::ObjectRuntime &runtime = *co->object.runtime;
  std::copy_n(object_to_world, 16, runtime.object_to_world.base_ptr());
  runtime.world_to_object = math::invert(runtime.object_to_world);
}

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
static ListBaseT<Nurb> &nurbs_of(CurveObject *co) { return *BKE_curve_nurbs_get(&curve_of(co)); }

EXPORT(curve_nurbs_get) const NurbsHeader *curve_nurbs_get(CurveObject *co)
{
  static NurbsHeader header;
  co->ints.clear();
  co->floats.clear();
  int nurbs_num = 0;
  for (const Nurb &nu : nurbs_of(co)) {
    co->ints.extend({nu.type, nu.flag, nu.pntsu, nu.pntsv, nu.orderu, nu.orderv, nu.resolu, nu.resolv, nu.flagu, nu.flagv, nu.mat_nr,
                     nu.hide, nu.charidx, nu.tilt_interp, nu.radius_interp});
    if (nu.bezt) {
      for (const BezTriple &bezt : Span(nu.bezt, nu.pntsu)) {
        co->ints.extend({bezt.h1, bezt.h2, bezt.f1, bezt.f2, bezt.f3, bezt.hide});
        co->floats.extend(Span(&bezt.vec[0][0], 9));
        co->floats.extend({bezt.tilt, bezt.weight, bezt.radius});
      }
    }
    else {
      for (const BPoint &bp : Span(nu.bp, nu.pntsu * nu.pntsv)) {
        co->ints.extend({bp.f1, bp.hide});
        co->floats.extend(Span(bp.vec, 4));
        co->floats.extend({bp.tilt, bp.weight, bp.radius});
      }
    }
    nurbs_num++;
  }
  const Curve &cu = curve_of(co);
  header = {nurbs_num, int(co->ints.size()), int(co->floats.size()), co->ints.data(), co->floats.data(), cu.actnu, cu.actvert};
  return &header;
}

/* Replaces the splines (the edit splines in Edit Mode) with those of curve_nurbs_get's layout, their knots
 * calculated as reading a file does. */
EXPORT(curve_nurbs_set) void curve_nurbs_set(CurveObject *co, int nurbs_num, const int *ints, const float *floats, int actnu, int actvert)
{
  ListBaseT<Nurb> &nurbs = nurbs_of(co);
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
  Curve &cu = curve_of(co);
  cu.actnu = actnu;
  cu.actvert = actvert;
}

/* Text: its body (UTF-8, the edit text in Edit Mode), each character's format, the cursor and selection, and in Edit
 * Mode where the evaluated layout puts the cursor and the selection. */
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

EXPORT(curve_text_get) const TextHeader *curve_text_get(CurveObject *co)
{
  static TextHeader header;
  Curve &cu = curve_of(co);
  if (EditFont *ef = cu.editfont) {
    ED_curve_editfont_load(&co->object);
    header = {cu.str, cu.len_char32, ef->textbufinfo, ef->pos, ef->selstart, ef->selend, &ef->textcurs[0][0], ef->selboxes,
              ef->selboxes_len, cu.tb, cu.totbox, cu.actbox};
  }
  else {
    header = {cu.str, cu.len_char32, cu.strinfo, cu.pos, cu.selstart, cu.selend, nullptr, nullptr, 0, cu.tb, cu.totbox, cu.actbox};
  }
  return &header;
}

/* Sets the text (UTF-8) and its characters' formats (one per character, or null for the default), as reading a
 * file sets them; in Edit Mode the edit text is made from them again. */
EXPORT(curve_text_set) void curve_text_set(CurveObject *co, const char *body, const CharInfo *info, int pos, int selstart, int selend)
{
  Curve &cu = curve_of(co);
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
    ED_curve_editfont_make(&co->object);
    cu.editfont->selstart = selstart;
    cu.editfont->selend = selend;
  }
}

/* Sets the text boxes (x, y, width, height each) and the active one. */
EXPORT(curve_text_boxes_set) void curve_text_boxes_set(CurveObject *co, const float *boxes, int totbox, int actbox)
{
  Curve &cu = curve_of(co);
  cu.totbox = std::clamp(totbox, 1, MAXTEXTBOX);
  cu.actbox = actbox;
  std::copy_n(boxes, 4 * cu.totbox, &cu.tb[0].x);
}

/* A font of a TrueType, OpenType or Type 1 file's bytes, packed as a font added to a file is when packed. */
EXPORT(curve_vfont_new) VFont *curve_vfont_new(const void *data, int size, const char *filepath)
{
  curve_types_ensure();
  VFont *vfont = static_cast<VFont *>(BKE_id_new_nomain(ID_VF, filepath));
  BKE_vfont_data_free(vfont);
  void *copy = MEM_new_uninitialized(size, __func__);
  memcpy(copy, data, size);
  vfont->packedfile = BKE_packedfile_new_from_memory(copy, size);
  STRNCPY(vfont->filepath, filepath);
  BKE_vfont_data_ensure(vfont);
  if (!vfont->data) {
    BKE_id_free(nullptr, vfont);
    return nullptr;
  }
  return vfont;
}

EXPORT(curve_vfont_builtin) VFont *curve_vfont_builtin()
{
  curve_types_ensure();
  return BKE_vfont_builtin_ensure();
}

EXPORT(curve_vfont_name) const char *curve_vfont_name(const VFont *vfont) { return vfont->data ? vfont->data->name : vfont->id.name + 2; }

/* Sets the regular, bold, italic or bold italic font (0 to 3). */
EXPORT(curve_text_font_set) void curve_text_font_set(CurveObject *co, int slot, VFont *vfont)
{
  Curve &cu = curve_of(co);
  VFont **fonts[] = {&cu.vfont, &cu.vfontb, &cu.vfonti, &cu.vfontbi};
  *fonts[slot] = vfont;
}

/* Evaluates the object as the depsgraph does in the viewport (its modifiers included) and extracts the mesh Blender
 * draws, which stays until the next evaluation: the mesh of a filled, extruded or beveled curve, or the wire of its
 * evaluated curves (curve_to_wire_mesh, as Object > Convert makes one); null when it has neither. */
EXPORT(curve_object_eval) const ExtractionHeader *curve_object_eval(CurveObject *co)
{
  Object &ob = co->object;
  Depsgraph *depsgraph = BKE_scene_ensure_depsgraph(nullptr, &co->scene, &co->view_layer);
  BKE_displist_make_curveTypes(depsgraph, &co->scene, &ob, false);
  bke::GeometrySet &geometry = *ob.runtime->geometry_set_eval;
  if (!geometry.has_mesh() && geometry.has_curves()) {
    geometry.replace_mesh(bke::curve_to_wire_mesh(geometry.get_curves()->geometry.wrap()));
  }
  const Mesh *mesh = geometry.get_mesh();
  if (!mesh) {
    return nullptr;
  }
  mesh_extraction(*mesh, co->header);
  return &co->header;
}

/* Edit Mode: the edit splines or edit text (ED_curve_editnurb_make, ED_curve_editfont_make), as object.editmode_toggle
 * makes them, and back. */
EXPORT(curve_object_edit_enter) void curve_object_edit_enter(CurveObject *co)
{
  Object &ob = co->object;
  if (ob.type == OB_FONT) {
    ED_curve_editfont_make(&ob);
  }
  else {
    ED_curve_editnurb_make(&ob);
  }
  ob.mode = OB_MODE_EDIT;
  PointerRNA object_ptr = {&ob.id, RNA_Object, &ob};
  CTX_store_set(co->C, CTX_store_add(co->stores, "edit_object", &object_ptr));
}

EXPORT(curve_object_edit_exit) void curve_object_edit_exit(CurveObject *co)
{
  Object &ob = co->object;
  if (ob.type == OB_FONT) {
    ED_curve_editfont_load(&ob);
  }
  else {
    ED_curve_editnurb_load(G_MAIN, &ob);
  }
  edit_free(co);
  ob.mode = OB_MODE_OBJECT;
  PointerRNA none = {};
  CTX_store_set(co->C, CTX_store_add(co->stores, "edit_object", &none));
}

/* Operators (made by operator_new) in the object's context. */
EXPORT(curve_operator_poll) bool curve_operator_poll(CurveObject *co, wmOperator *op) { return !op->type->poll || op->type->poll(co->C); }

/* Polls and runs an operator's exec: its wmOperatorStatus flags, or 0 when it does not poll or has no exec. */
EXPORT(curve_operator_exec) int curve_operator_exec(CurveObject *co, wmOperator *op)
{
  if (!op->type->exec || !curve_operator_poll(co, op)) {
    return 0;
  }
  return int(op->type->exec(co->C, op));
}

/* Sets a string property (font.text_insert's text). */
EXPORT(operator_string_set) void operator_string_set(wmOperator *op, const char *name, const char *value) { RNA_string_set(op->ptr, name, value); }

/* The 3D View the object's operators pick in: the region's size and the view's matrices (column-major, Blender's
 * axes), as Blender's view sets them before drawing (ED_view3d_update_viewmat). */
EXPORT(curve_view_set) void curve_view_set(CurveObject *co, int winx, int winy, const float *viewmat, const float *winmat)
{
  RegionView3D &rv3d = co->rv3d;
  co->region.winx = short(winx);
  co->region.winy = short(winy);
  co->region.winrct = {0, winx - 1, 0, winy - 1};
  std::copy_n(viewmat, 16, &rv3d.viewmat[0][0]);
  std::copy_n(winmat, 16, &rv3d.winmat[0][0]);
  invert_m4_m4(rv3d.viewinv, rv3d.viewmat);
  mul_m4_m4m4(rv3d.persmat, rv3d.winmat, rv3d.viewmat);
  invert_m4_m4(rv3d.persinv, rv3d.persmat);
  rv3d.is_persp = winmat[11] != 0.0f;
}

/* view3d.select in Edit Mode: Blender's pick at a region pixel within dist_px (ED_view3d_select_dist_px, which reads
 * the UI scale), as ED_curve_editnurb_select_pick picks. */
EXPORT(curve_select_pick)
bool curve_select_pick(CurveObject *co, int x, int y, int dist_px, int sel_op, bool deselect_all, bool select_passthrough)
{
  const int mval[2] = {x, y};
  SelectPick_Params params{};
  params.sel_op = eSelectOp(sel_op);
  params.deselect_all = deselect_all;
  params.select_passthrough = select_passthrough;
  return ED_curve_editnurb_select_pick(co->C, mval, dist_px, params);
}

/* A transform's steps each start from the edit splines as they were when it began (Blender's transform restores its
 * TransData; here Blender's transform operator runs again from them with the step's values). */
EXPORT(curve_edit_snapshot) void curve_edit_snapshot(CurveObject *co)
{
  BKE_nurbList_free(&co->snapshot);
  BKE_nurbList_duplicate(&co->snapshot, &nurbs_of(co));
}
EXPORT(curve_edit_restore) void curve_edit_restore(CurveObject *co)
{
  ListBaseT<Nurb> &nurbs = nurbs_of(co);
  BKE_nurbList_free(&nurbs);
  BKE_nurbList_duplicate(&nurbs, &co->snapshot);
}

/* What curve evaluation reaches of Blender beyond the module. */

namespace blender {

/* port-override: the module has no depsgraph to say which curves something follows (the Curve modifier, Follow
 * Path), so every curve has its path evaluated, as Blender does for a curve something follows. */
int DEG_get_eval_flags_for_id(const Depsgraph * /*graph*/, const ID * /*id*/) { return DAG_EVAL_NEED_CURVE_PATH; }

}  // namespace blender
