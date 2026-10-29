/* Blender's animation data and editors in the module's Blender world (main-api.cc): each animated ID has AnimData
 * with a layered Action of Blender's FCurves, which are the truth for Bylonder's animation; Babylon reads the values
 * they evaluate to. The Timeline, Dope Sheet and Graph Editor are areas whose SpaceAction or SpaceGraph and regions
 * are Blender's (made by the space types' own create), and their operators, selection, transform and drawing data
 * are Blender's own code run in that area's context. JS draws what the exports here give. */
#include "ANIM_action.hh"
#include "ANIM_animdata.hh"
#include "ANIM_fcurve.hh"
#include "ANIM_keyframing.hh"
#include "BKE_animsys.h"
#include "BKE_node.hh"
#include "BKE_pointcache.h"
#include "BLF_api.hh"
#include "BKE_context.hh"
#include "BKE_curve.hh"
#include "BKE_fcurve.hh"
#include "BKE_idtype.hh"
#include "BLT_translation.hh"
#include "BKE_lib_id.hh"
#include "BKE_main.hh"
#include "BKE_scene.hh"
#include "BKE_screen.hh"
#include "BLI_listbase.h"
#include "BLI_math_vector.h"
#include "BLI_string.h"
#include "DNA_anim_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_screen_types.h"
#include "DNA_space_types.h"
#include "DNA_userdef_types.h"
#include "ED_anim_api.hh"
#include "ED_keyframes_keylist.hh"
#include "ED_keyframing.hh"
#include "ED_markers.hh"
#include "ED_screen.hh"
#include "ED_util.hh"
#include "ED_space_api.hh"
#include "ED_view3d.hh"
#include "WM_message.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "RNA_enum_types.hh"
#include "UI_interface_icons.hh"
#include "UI_interface_c.hh"
#include "UI_resources.hh"
#include "UI_view2d.hh"
#include "rna-runtime.hh"
#include "area.hh"
#include "WM_api.hh"
#include "WM_types.hh"

#include <string>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace blender {
void graphedit_operatortypes();
void action_operatortypes();
namespace ed::transform {
void keymap_transform(wmKeyConfig *keyconf);
}
}  // namespace blender



/* Animation data. */

/* The ID's Action, made and assigned with a slot for it as keying does (id_action_ensure). */
static animrig::Channelbag &channelbag_ensure(Main *bmain, ID *id)
{
  bAction *dna_action = animrig::id_action_ensure(bmain, id);
  animrig::Action &action = dna_action->wrap();
  animrig::Slot *slot = animrig::assign_action_ensure_slot_for_keying(action, *id);
  action.layer_keystrip_ensure();
  return action.layer(0)->strip(0)->data<animrig::StripKeyframeData>(action).channelbag_for_slot_ensure(*slot);
}

static animrig::Channelbag *channelbag(ID *id)
{
  AnimData *adt = BKE_animdata_from_id(id);
  if (!adt || !adt->action) {
    return nullptr;
  }
  return animrig::channelbag_for_action_slot(adt->action->wrap(), adt->slot_handle);
}

/* The FCurve of an ID's property (RNA path and array index), made as keying makes it when missing: in a channel group
 * (or none for an empty name), discrete or integer by its PropertyType, colored by its PropertySubType. */
EXPORT(anim_fcurve_ensure)
FCurve *anim_fcurve_ensure(Main *bmain, ID *id, const char *rna_path, int index, const char *group, int prop_type, int subtype)
{
  animrig::FCurveDescriptor descriptor = {rna_path, index, PropertyType(prop_type), PropertySubType(subtype)};
  if (group[0]) {
    descriptor.channel_group = group;
  }
  return &channelbag_ensure(bmain, id).fcurve_ensure(bmain, descriptor);
}

/* Moves an ID's AnimData to another ID of the same type that has none (the object standing for the same Bylonder
 * object, made again with another type). */
EXPORT(anim_animdata_move) void anim_animdata_move(Main *bmain, ID *from, ID *to)
{
  std::swap(reinterpret_cast<IdAdtTemplate *>(from)->adt, reinterpret_cast<IdAdtTemplate *>(to)->adt);
  animrig::Slot::users_invalidate(*bmain);
}

/* The FCurves of an ID's Action slot: their count, and their addresses written to r_fcurves when given. */
EXPORT(anim_fcurves) int anim_fcurves(ID *id, FCurve **r_fcurves)
{
  animrig::Channelbag *bag = channelbag(id);
  if (!bag) {
    return 0;
  }
  if (r_fcurves) {
    std::copy(bag->fcurves().begin(), bag->fcurves().end(), r_fcurves);
  }
  return int(bag->fcurves().size());
}

/* An FCurve's channel group name, or an empty string. */
EXPORT(anim_fcurve_group) const char *anim_fcurve_group(FCurve *fcu) { return fcu->grp ? fcu->grp->name : ""; }

EXPORT(anim_fcurve_remove) void anim_fcurve_remove(ID *id, FCurve *fcu)
{
  animrig::Channelbag *bag = channelbag(id);
  if (bag) {
    bag->fcurve_remove(*fcu);
  }
}

/* Inserts a key as Blender's keying does, with the scene's keyframe type and the Preferences' interpolation and
 * handles; flag is eInsertKeyFlags. Returns whether it was inserted. */
EXPORT(anim_keyframe_insert) bool anim_keyframe_insert(Scene *scene, FCurve *fcu, float frame, float value, int flag)
{
  animrig::KeyframeSettings settings = animrig::get_keyframe_settings(true);
  settings.keyframe_type = eBezTriple_KeyframeType(scene->toolsettings->keyframe_type);
  return animrig::insert_vert_fcurve(fcu, {frame, value}, settings, eInsertKeyFlags(flag)) ==
         animrig::SingleKeyingResult::SUCCESS;
}

/* Replaces an FCurve's keys with count BezTriples copied from bezts, then sorts and recalculates handles as the editors
 * do after an edit (BKE_fcurve_handles_recalc). */
EXPORT(anim_fcurve_keys_set) void anim_fcurve_keys_set(FCurve *fcu, const BezTriple *bezts, int count)
{
  MEM_SAFE_DELETE(fcu->bezt);
  fcu->totvert = count;
  if (count) {
    fcu->bezt = MEM_new_array<BezTriple>(count, __func__);
    std::copy(bezts, bezts + count, fcu->bezt);
  }
  sort_time_fcurve(*fcu);
  BKE_fcurve_handles_recalc(*fcu);
}

EXPORT(anim_fcurve_evaluate) float anim_fcurve_evaluate(FCurve *fcu, float frame) { return evaluate_fcurve(fcu, frame); }

/* Where an FCurve's and a BezTriple's fields are, for JS to read and write them in place (offsets in bytes). */
EXPORT(anim_layout) const int *anim_layout()
{
  static const int layout[] = {
      int(sizeof(FCurve)), int(offsetof(FCurve, bezt)), int(offsetof(FCurve, totvert)), int(offsetof(FCurve, flag)),
      int(offsetof(FCurve, rna_path)), int(offsetof(FCurve, array_index)), int(offsetof(FCurve, color)),
      int(offsetof(FCurve, extend)), int(offsetof(FCurve, color_mode)), int(offsetof(FCurve, auto_smoothing)),
      int(sizeof(BezTriple)), int(offsetof(BezTriple, vec)), int(offsetof(BezTriple, ipo)), int(offsetof(BezTriple, h1)),
      int(offsetof(BezTriple, h2)), int(offsetof(BezTriple, f1)), int(offsetof(BezTriple, f2)), int(offsetof(BezTriple, f3)),
      int(offsetof(BezTriple, easing)), int(offsetof(BezTriple, back)), int(offsetof(BezTriple, amplitude)),
      int(offsetof(BezTriple, period)), int(offsetof(BezTriple, auto_handle_type)), int(offsetof(BezTriple, hide)),
  };
  return layout;
}

/* The scene's time and keying settings the editors read: current frame, range, preview range and its flag, frame
 * rate, keyframe type and auto keying (ToolSettings.autokey_mode). */
EXPORT(anim_scene_time_set)
void anim_scene_time_set(Scene *scene, int cfra, float subframe, int sfra, int efra, int psfra, int pefra, bool preview, int fps,
                         int keyframe_type, bool autokey)
{
  scene->r.cfra = cfra;
  scene->r.subframe = subframe;
  scene->r.sfra = sfra;
  scene->r.efra = efra;
  scene->r.psfra = psfra;
  scene->r.pefra = pefra;
  SET_FLAG_FROM_TEST(scene->r.flag, preview, SCER_PRV_RANGE);
  scene->r.frs_sec = short(fps);
  scene->r.frs_sec_base = 1.0f;
  scene->toolsettings->keyframe_type = char(keyframe_type);
  SET_FLAG_FROM_TEST(scene->toolsettings->autokey_mode, autokey, AUTOKEY_ON);
}
EXPORT(anim_scene_frame) float anim_scene_frame(Scene *scene) { return float(scene->r.cfra) + scene->r.subframe; }
EXPORT(anim_scene_range) const int *anim_scene_range(Scene *scene)
{
  static int range[5];
  range[0] = scene->r.sfra;
  range[1] = scene->r.efra;
  range[2] = scene->r.psfra;
  range[3] = scene->r.pefra;
  range[4] = (scene->r.flag & SCER_PRV_RANGE) != 0;
  return range;
}

/* Editors. */

/* An editor area: Blender's ScrArea with the space its type creates, holding that space's regions. */
struct AnimArea : BylonderArea {};

static ARegion *area_region(AnimArea *a, int regiontype) { return BKE_area_find_region_type(&a->area, regiontype); }


/* An area of a space type (SPACE_GRAPH, SPACE_ACTION), as ED_area_newspace makes one. */
EXPORT(anim_area_new) AnimArea *anim_area_new(bContext *C, int spacetype, int subtype)
{
  AnimArea *a = MEM_new<AnimArea>(__func__);
  SpaceType *st = BKE_spacetype_from_id(spacetype);
  /* As ED_area_newspace: the space is made for the sub-type the area asks for, then set to it. */
  a->area.butspacetype_subtype = short(subtype);
  SpaceLink *sl = st->create(&a->area, CTX_data_scene(C));
  BLI_addtail(&a->area.spacedata, sl);
  a->area.spacetype = char(spacetype);
  a->area.type = st;
  a->area.regionbase = sl->regionbase;
  BLI_listbase_clear(&sl->regionbase);
  for (ARegion &region : a->area.regionbase) {
    region.runtime->type = BKE_regiontype_from_id(st, region.regiontype);
  }
  if (st->space_subtype_set && subtype >= 0) {
    st->space_subtype_set(&a->area, subtype);
  }
  return a;
}

/* A region drawn by its own draw callback (the region type's draw: action_channel_region_draw,
 * graph_channel_region_draw, ...), or its overlay's (graph_main_region_draw_overlay: the current frame, scrollers and
 * value scale), as wm_region_draw records it. */
extern "C" const char *wm_region_draw(bContext *C, ScrArea *area, int regiontype, bool overlay);
EXPORT(anim_region_draw) const char *anim_region_draw(bContext *C, AnimArea *a, int regiontype, bool overlay)
{
  return wm_region_draw(C, &a->area, regiontype, overlay);
}

/* The space's dope sheet filter text (bDopeSheet.searchstr, DopeSheet.filter_text) and flag (ADS_FLAG_*). */
static bDopeSheet *space_dopesheet(SpaceLink *sl);
extern "C" SpaceLink *anim_area_space(AnimArea *a);
EXPORT(anim_dopesheet_search) char *anim_dopesheet_search(AnimArea *a) { return space_dopesheet(anim_area_space(a))->searchstr; }
EXPORT(anim_dopesheet_flag) int anim_dopesheet_flag(AnimArea *a) { return space_dopesheet(anim_area_space(a))->flag; }
EXPORT(anim_dopesheet_flag_set) void anim_dopesheet_flag_set(AnimArea *a, int flag)
{
  space_dopesheet(anim_area_space(a))->flag = eDopeSheet_Flag(flag);
}

/* A region's flags (RGN_FLAG_HIDDEN: shown or not), as the screen reads and sets them. */
EXPORT(anim_region_flag) int anim_region_flag(ARegion *region) { return region ? region->flag : 0; }
EXPORT(anim_region_flag_set) void anim_region_flag_set(ARegion *region, int flag) { region->flag = eRegion_Flag(flag); }

/* The Graph Editor's 2D cursor value (SpaceGraph.cursorVal), the View panel's Cursor Y. */
EXPORT(anim_graph_cursor) float anim_graph_cursor(AnimArea *a) { return static_cast<SpaceGraph *>(a->area.spacedata.first)->cursorVal; }
EXPORT(anim_graph_cursor_set) void anim_graph_cursor_set(AnimArea *a, float value) { static_cast<SpaceGraph *>(a->area.spacedata.first)->cursorVal = value; }

EXPORT(anim_area_free) void anim_area_free(AnimArea *a)
{
  while (ARegion *region = static_cast<ARegion *>(BLI_pophead(&a->area.regionbase))) {
    BKE_area_region_free(a->area.type, region);
    MEM_delete(region);
  }
  SpaceLink *sl = static_cast<SpaceLink *>(a->area.spacedata.first);
  if (a->area.type->free) {
    a->area.type->free(sl);
  }
  BLI_freelistN(&a->area.spacedata);
  MEM_delete(a);
}

EXPORT(anim_area_space) SpaceLink *anim_area_space(AnimArea *a) { return static_cast<SpaceLink *>(a->area.spacedata.first); }

/* The space's sub-type (Area.ui_type within the space: a SpaceAction's mode, Timeline or Dope Sheet's), as the
 * editor type menu sets it. */
EXPORT(anim_area_subtype_set) void anim_area_subtype_set(AnimArea *a, int value)
{
  if (a->area.type->space_subtype_set) {
    a->area.type->space_subtype_set(&a->area, value);
  }
}
EXPORT(anim_area_subtype) int anim_area_subtype(AnimArea *a)
{
  return a->area.type->space_subtype_get ? a->area.type->space_subtype_get(&a->area) : -1;
}
EXPORT(anim_area_region) ARegion *anim_area_region(AnimArea *a, int regiontype) { return area_region(a, regiontype); }

/* A region's size and place in the area (bottom-left origin, Blender's y up), then the region type's init as ED_area_init
 * runs it on each layout (its view keeps its zoom, its scrollers as the type sets them). */
EXPORT(anim_region_layout) void anim_region_layout(bContext *C, ARegion *region, int x, int y, int width, int height)
{
  region->winrct = {x, x + width - 1, y, y + height - 1};
  region->winx = short(width);
  region->winy = short(height);
  /* port-override: the sidebar's panels are Bylonder's (anim-buttons.js), so its region skips ED_region_panels_init. */
  if (region->runtime->type->init && region->regiontype != RGN_TYPE_UI) {
    region->runtime->type->init(CTX_wm_manager(C), region);
  }
  /* As region_azones_scrollbars_init: scrollers are hidden until the mouse comes near (which Bylonder leaves out). */
  if (region->v2d.scroll & V2D_SCROLL_VERTICAL) {
    region->v2d.alpha_vert = 0;
  }
  if (region->v2d.scroll & V2D_SCROLL_HORIZONTAL) {
    region->v2d.alpha_hor = 0;
  }
}

EXPORT(anim_region_v2d) View2D *anim_region_v2d(ARegion *region) { return &region->v2d; }

/* After sizing an area's regions: the channels follow the main region vertically (V2D_VIEWSYNC_AREA_VERTICAL), as
 * after Blender's region resize. */
EXPORT(anim_area_sync) void anim_area_sync(AnimArea *a)
{
  ARegion *region = BKE_area_find_region_type(&a->area, RGN_TYPE_WINDOW);
  ui::view2d_sync(nullptr, &a->area, &region->v2d, V2D_LOCK_COPY);
}

/* Puts the context in an area's region, as the window manager does before running a region's handlers. */
EXPORT(anim_context_set) void anim_context_set(bContext *C, AnimArea *a, ARegion *region)
{
  CTX_wm_area_set(C, a ? &a->area : nullptr);
  CTX_wm_region_set(C, region);
}

/* What the space's refresh does before drawing (the Graph Editor's curve colors). */
EXPORT(anim_area_refresh) void anim_area_refresh(bContext *C, AnimArea *a)
{
  if (a->area.type->refresh) {
    a->area.type->refresh(C, &a->area);
  }
}

/* The space's settings the editors draw and their headers show: its flag (eGraphEdit_Flag or eSAction_Flag), mode, the
 * dope sheet's filter flags and the pivot point (SpaceGraph.around). */
static bDopeSheet *space_dopesheet(SpaceLink *sl)
{
  return sl->spacetype == SPACE_GRAPH ? reinterpret_cast<SpaceGraph *>(sl)->ads : &reinterpret_cast<SpaceAction *>(sl)->ads;
}
EXPORT(anim_area_settings) const int *anim_area_settings(AnimArea *a)
{
  static int settings[4];
  SpaceLink *sl = anim_area_space(a);
  if (sl->spacetype == SPACE_GRAPH) {
    SpaceGraph *sipo = reinterpret_cast<SpaceGraph *>(sl);
    settings[0] = sipo->flag;
    settings[1] = sipo->mode;
    settings[3] = sipo->around;
  }
  else {
    SpaceAction *saction = reinterpret_cast<SpaceAction *>(sl);
    settings[0] = saction->flag;
    settings[1] = saction->mode;
    settings[3] = 0;
  }
  settings[2] = space_dopesheet(sl)->filterflag;
  return settings;
}
EXPORT(anim_area_settings_set) void anim_area_settings_set(AnimArea *a, int flag, int filterflag, int around)
{
  SpaceLink *sl = anim_area_space(a);
  if (sl->spacetype == SPACE_GRAPH) {
    reinterpret_cast<SpaceGraph *>(sl)->flag = eGraphEdit_Flag(flag);
    reinterpret_cast<SpaceGraph *>(sl)->around = char(around);
  }
  else {
    reinterpret_cast<SpaceAction *>(sl)->flag = eSAction_Flag(flag);
  }
  space_dopesheet(sl)->filterflag = eDopeSheet_FilterFlag(filterflag);
}

/* An FCurve's active keyframe (BKE_fcurve_active_keyframe_index), or -1. */
EXPORT(anim_fcurve_active_key) int anim_fcurve_active_key(FCurve *fcu) { return BKE_fcurve_active_keyframe_index(fcu); }

/* A driver on an ID's property (ANIM_add_driver), as Python's driver_add (flag 0) or the Add Driver button
 * (CREATEDRIVER_WITH_DEFAULT_DVAR) makes it: its F-Curve, or null where the path does not resolve. */
EXPORT(anim_driver_add) FCurve *anim_driver_add(ID *id, const char *rna_path, int index, int flag)
{
  ReportList reports;
  BKE_reports_init(&reports, RPT_STORE);
  const bool added = ANIM_add_driver(&reports, id, rna_path, index, short(flag), DRIVER_TYPE_PYTHON);
  BKE_reports_free(&reports);
  return added ? verify_driver_fcurve(id, rna_path, index, DRIVER_FCURVE_LOOKUP_ONLY) : nullptr;
}
/* An ID's drivers (AnimData.drivers): their count, written to r_fcurves when given. */
EXPORT(anim_drivers) int anim_drivers(ID *id, FCurve **r_fcurves)
{
  AnimData *adt = BKE_animdata_from_id(id);
  int count = 0;
  for (FCurve &fcu : adt ? adt->drivers : ListBaseT<FCurve>{}) {
    if (r_fcurves) {
      r_fcurves[count] = &fcu;
    }
    count++;
  }
  return count;
}
EXPORT(anim_fcurve_active_key_set) void anim_fcurve_active_key_set(FCurve *fcu, int index)
{
  BKE_fcurve_active_keyframe_set(fcu, index < 0 ? nullptr : &fcu->bezt[index]);
}

/* The scene's markers (Scene.timeline_markers), in list order: their count, then one by one its frame and flag
 * (SELECT) and its name. */
EXPORT(anim_markers) int anim_markers(Scene *scene) { return BLI_listbase_count(&scene->markers); }
EXPORT(anim_marker) const char *anim_marker(Scene *scene, int index, int *r_frame_flag)
{
  const TimeMarker *marker = static_cast<const TimeMarker *>(BLI_findlink(&scene->markers, index));
  r_frame_flag[0] = marker->frame;
  r_frame_flag[1] = int(marker->flag);
  return marker->name;
}
/* Replaces the scene's markers, as loading a file does: none, then each added. */
EXPORT(anim_markers_clear) void anim_markers_clear(Scene *scene)
{
  while (TimeMarker *marker = static_cast<TimeMarker *>(BLI_pophead(&scene->markers))) {
    MEM_delete(marker);
  }
}
EXPORT(anim_marker_add) void anim_marker_add(Scene *scene, int frame, int flag, const char *name)
{
  TimeMarker *marker = MEM_new<TimeMarker>(__func__);
  marker->frame = frame;
  marker->flag = uint(flag);
  STRNCPY(marker->name, name);
  BLI_addtail(&scene->markers, marker);
}

/* The context's active Action (screen_context.cc's active_action), or null. */
EXPORT(anim_active_action) bAction *anim_active_action(bContext *C)
{
  return static_cast<bAction *>(CTX_data_pointer_get(C, "active_action").data);
}

/* bAction's fields the Dope Sheet's Action panel shows: flag, frame_start, frame_end, and the ID name. */
EXPORT(anim_action_layout) const int *anim_action_layout()
{
  static const int layout[] = {int(offsetof(bAction, flag)), int(offsetof(bAction, frame_start)), int(offsetof(bAction, frame_end)),
                               int(offsetof(bAction, id.name))};
  return layout;
}

/* As rna_action.cc's use_frame_range setter: turning it on starts a blank range at the keys' range. */
EXPORT(anim_action_use_frame_range_set) void anim_action_use_frame_range_set(bAction *dna_action, bool value)
{
  animrig::Action &action = dna_action->wrap();
  if (value) {
    if (action.frame_start == action.frame_end && action.frame_start == 0) {
      const float2 frame_range = action.get_frame_range_of_keys(false);
      action.frame_start = frame_range[0];
      action.frame_end = frame_range[1];
    }
    action.flag |= ACT_FRAME_RANGE;
  }
  else {
    action.flag &= ~ACT_FRAME_RANGE;
  }
}

/* The Action's active slot (ActionSlot): its display name (the identifier without its ID type prefix), or null, and
 * its target ID type's icon. */
EXPORT(anim_action_slot) const char *anim_action_slot(bAction *dna_action, int *r_icon)
{
  static std::string name;
  animrig::Slot *slot = dna_action->wrap().slot_active_get();
  if (!slot) {
    return nullptr;
  }
  *r_icon = ui::icon_from_idcode(slot->idtype);
  name = slot->identifier_without_prefix();
  return name.c_str();
}

namespace blender {
/* graph_utils.cc (graph_intern.hh, internal to space_graph). */
bAnimListElem *get_active_fcurve_channel(bAnimContext *ac);
}  // namespace blender

/* The context's active F-Curve, as the Graph Editor's sidebar panels find it (graph_panel_context), or null; its name
 * and icon as their Active F-Curve panel shows them (getname_anim_fcurve, else the owner ID type's icon). */
EXPORT(anim_active_fcurve) FCurve *anim_active_fcurve(bContext *C, char *r_name, int *r_icon)
{
  bAnimContext ac;
  if (!ANIM_animdata_get_context(C, &ac)) {
    return nullptr;
  }
  bAnimListElem *ale = get_active_fcurve_channel(&ac);
  if (!ale) {
    return nullptr;
  }
  FCurve *fcu = static_cast<FCurve *>(ale->data);
  const std::optional<int> icon = getname_anim_fcurve(r_name, ale->id, fcu);
  *r_icon = icon ? *icon : (ale->id ? RNA_struct_ui_icon(ID_code_to_RNA_type(GS(ale->id->name))) : ICON_NONE);
  MEM_delete(ale);
  return fcu;
}

namespace blender::ui {
std::string panel_record(const bContext *C, PanelType *type, const PointerRNA &ptr, Block *block);
Block *panel_block_new();
}  // namespace blender::ui

/* The struct type of an F-Modifier, as rna_FModifierType_refine gives it. */
static StructRNA *fmodifier_srna(const FModifier &fcm)
{
  switch (fcm.type) {
    case FMODIFIER_TYPE_GENERATOR: return RNA_FModifierGenerator;
    case FMODIFIER_TYPE_FN_GENERATOR: return RNA_FModifierFunctionGenerator;
    case FMODIFIER_TYPE_ENVELOPE: return RNA_FModifierEnvelope;
    case FMODIFIER_TYPE_CYCLES: return RNA_FModifierCycles;
    case FMODIFIER_TYPE_NOISE: return RNA_FModifierNoise;
    case FMODIFIER_TYPE_LIMITS: return RNA_FModifierLimits;
    case FMODIFIER_TYPE_STEPPED: return RNA_FModifierStepped;
    case FMODIFIER_TYPE_SMOOTH: return RNA_FModifierSmooth;
    default: return RNA_FModifier;
  }
}

/* A recorded panel as an element of a JSON array: its type's idname, label, category and flag, its F-Modifier's address
 * for an instanced one, and what it draws. */
static void panel_json(std::string &json, const bContext *C, PanelType *type, const PointerRNA &ptr, ui::Block *block)
{
  json += json.size() > 1 ? "," : "";
  json += "{\"idname\":\"" + std::string(type->idname) + "\",\"label\":\"" + type->label + "\",\"category\":\"" +
          type->category + "\",\"flag\":" + std::to_string(type->flag) + ",\"data\":" + std::to_string(uintptr_t(ptr.data)) +
          ",\"panel\":" + ui::panel_record(C, type, ptr, block) + '}';
}

/* The context's active F-Curve's F-Modifier panels, as graph_panel_modifiers adds them (ANIM_fmodifier_panels, with
 * graph_fmodifier_panel_id's names). */
static void fmodifier_panels_json(std::string &json, const bContext *C, ARegionType *art, ui::Block *block)
{
  bAnimContext ac;
  bAnimListElem *ale = ANIM_animdata_get_context(C, &ac) ? get_active_fcurve_channel(&ac) : nullptr;
  if (!ale) {
    return;
  }
  for (FModifier &fcm : static_cast<FCurve *>(ale->data)->modifiers) {
    const FModifierTypeInfo *fmi = get_fmodifier_typeinfo(fcm.type);
    char idname[BKE_ST_MAXNAME];
    SNPRINTF(idname, "GRAPH_PT_%s", fmi ? fmi->name : "");
    if (PanelType *type = static_cast<PanelType *>(BLI_findstring(&art->paneltypes, idname, offsetof(PanelType, idname)))) {
      panel_json(json, C, type, RNA_pointer_create_discrete(ale->fcurve_owner_id, fmodifier_srna(fcm), &fcm), block);
    }
  }
  MEM_delete(ale);
}

/* The context region's panels (the sidebar's: graph_buttons.cc's), each registered type whose poll passes in
 * registration order with its sub-panels, the instanced F-Modifier panels after the Modifiers panel, as recorded by
 * panel-layout.cc: a JSON array (panel_json). Their buttons stay pressable (panel_button_press) until the next call. */
EXPORT(anim_sidebar_panels) const char *anim_sidebar_panels(bContext *C)
{
  static std::string json;
  json = "[";
  ARegionType *art = CTX_wm_region(C)->runtime->type;
  ui::Block *block = ui::panel_block_new();
  for (PanelType &type : art->paneltypes) {
    if (type.parent || (type.flag & PANEL_TYPE_INSTANCED) || (type.poll && !type.poll(C, &type))) {
      continue;
    }
    panel_json(json, C, &type, PointerRNA_NULL, block);
    if (STREQ(type.idname, "GRAPH_PT_modifiers")) {
      fmodifier_panels_json(json, C, art, block);
    }
  }
  json += ']';
  return json.c_str();
}

/* The header text an operator shows while it runs (ED_area_status_text), or null. */
EXPORT(anim_area_status) const char *anim_area_status(AnimArea *a) { return a->status.empty() ? nullptr : a->status.c_str(); }

/* Drawing data. */

/* One channel of the list, as the channel region draws it (ANIM_channel_draw). */
struct ChannelInfo {
  int type;
  void *data;
  ID *id;
  int offset; /* acf->get_offset */
  int icon;
  int settings; /* bit (1 << setting) when the channel has it */
  int values;   /* bit (1 << setting) when it is on */
  float color[3]; /* an FCurve's color */
  int datatype;
  char name[128];
};

struct ChannelList {
  bAnimContext ac;
  ListBaseT<bAnimListElem> elems;
  Vector<ChannelInfo> infos;
};

static ChannelList &channel_list()
{
  static ChannelList list;
  return list;
}

/* What the regions' draw callbacks do first (set_v2d_height in space_action.cc and space_graph.cc): the view's tot
 * holds the channels, and the view stays in it. The Dope Sheet pads for its markers and the collapsed redo panel. */
static void channel_regions_tot_set(bAnimContext &ac, ScrArea *area, size_t item_count)
{
  for (ARegion &region : area->regionbase) {
    const bool action = area->spacetype == SPACE_ACTION;
    if (!(region.regiontype == RGN_TYPE_CHANNELS || (action && region.regiontype == RGN_TYPE_WINDOW))) {
      continue;
    }
    const int height = ANIM_UI_get_channels_total_height(&region.v2d, item_count);
    const float pad_bottom = action ? (ac.markers->is_empty() ? 0.0f : UI_MARKER_MARGIN_Y) + HEADERY : 0.0f;
    region.v2d.tot.ymin = -(height + pad_bottom);
    ui::view2d_curRect_clamp_y(&region.v2d);
  }
}

/* The channels the context's area lists (its channel region's filter), refreshed: their count. Read with
 * anim_channel_info until the next call. */
EXPORT(anim_channels) int anim_channels(bContext *C)
{
  ChannelList &list = channel_list();
  ANIM_animdata_freelist(&list.elems);
  list.infos.clear();
  if (!ANIM_animdata_get_context(C, &list.ac)) {
    return 0;
  }
  bAnimContext &ac = list.ac;
  int filter = ANIMFILTER_DATA_VISIBLE | ANIMFILTER_LIST_VISIBLE | ANIMFILTER_LIST_CHANNELS;
  if (ac.spacetype == SPACE_GRAPH) {
    filter |= ANIMFILTER_FCURVESONLY;
  }
  ANIM_animdata_filter(&ac, &list.elems, eAnimFilter_Flags(filter), ac.data, eAnimCont_Types(ac.datatype));
  for (bAnimListElem &ale : list.elems) {
    ChannelInfo info = {};
    info.type = ale.type;
    info.data = ale.data;
    info.id = ale.id;
    info.datatype = ale.datatype;
    if (const bAnimChannelType *acf = ANIM_channel_get_typeinfo(&ale)) {
      info.offset = acf->get_offset ? acf->get_offset(&ac, &ale) : 0;
      info.icon = acf->icon ? acf->icon(&ale) : 0;
      if (acf->name) {
        acf->name(&ale, info.name);
      }
      for (int setting = 0; setting <= ACHANNEL_SETTING_ALWAYS_VISIBLE; setting++) {
        if (acf->has_setting(&ac, &ale, eAnimChannel_Settings(setting))) {
          info.settings |= 1 << setting;
          if (ANIM_channel_setting_get(&ac, &ale, eAnimChannel_Settings(setting)) > 0) {
            info.values |= 1 << setting;
          }
        }
      }
    }
    if (ELEM(ale.type, ANIMTYPE_FCURVE, ANIMTYPE_NLACURVE)) {
      copy_v3_v3(info.color, static_cast<FCurve *>(ale.data)->color);
    }
    list.infos.append(info);
  }
  channel_regions_tot_set(ac, CTX_wm_area(C), list.infos.size());
  return int(list.infos.size());
}

EXPORT(anim_channel_info) const ChannelInfo *anim_channel_info(int index) { return &channel_list().infos[index]; }

/* Sets a listed channel's setting (eAnimChannel_Settings) as its toggle button does (eAnimChannels_SetFlag: 0 off, 1 on,
 * 2 invert), flushing it to the channels it holds and their parents (ANIM_flush_setting_anim_channels). */
EXPORT(anim_channel_setting_set) void anim_channel_setting_set(int index, int setting, int mode)
{
  ChannelList &list = channel_list();
  bAnimListElem *ale = static_cast<bAnimListElem *>(BLI_findlink(&list.elems, index));
  if (!ale) {
    return;
  }
  const eAnimChannel_Settings s = eAnimChannel_Settings(setting);
  eAnimChannels_SetFlag flag = eAnimChannels_SetFlag(mode);
  if (flag == ACHANNEL_SETFLAG_INVERT) {
    flag = ANIM_channel_setting_get(&list.ac, ale, s) > 0 ? ACHANNEL_SETFLAG_CLEAR : ACHANNEL_SETFLAG_ADD;
  }
  ANIM_channel_setting_set(&list.ac, ale, s, flag);
  ANIM_flush_setting_anim_channels(&list.ac, &list.elems, ale, s, flag);
}

/* The keys of a listed channel in a frame range, as the Dope Sheet draws them (draw_channel_strips): written as
 * ActKeyColumn's frame, key type, handle type, extreme type, selection, and hold block flags and selection. */
EXPORT(anim_channel_keys) int anim_channel_keys(int index, float xmin, float xmax, float *r_columns, int max)
{
  ChannelList &list = channel_list();
  bAnimContext *ac = &list.ac;
  bAnimListElem *ale = static_cast<bAnimListElem *>(BLI_findlink(&list.elems, index));
  if (!ale || ale->datatype == ALE_NONE) {
    return 0;
  }
  int saction_flag = 0;
  if (ac->spacetype == SPACE_ACTION) {
    SpaceAction *saction = reinterpret_cast<SpaceAction *>(ac->sl);
    saction_flag = saction->flag;
    if (saction->mode == SACTCONT_TIMELINE) {
      saction_flag &= ~SACTION_SHOW_INTERPOLATION;
    }
  }
  if (!ELEM(ale->datatype, ALE_FCURVE, ALE_GROUP)) {
    saction_flag &= ~SACTION_SHOW_EXTREMES;
  }
  bDopeSheet *ads = ac->ads;
  const float2 range = {xmin, xmax};
  AnimKeylist *keylist = ED_keylist_create();
  switch (ale->datatype) {
    case ALE_ALL:
      summary_to_keylist(static_cast<bAnimContext *>(ale->data), keylist, saction_flag, range);
      break;
    case ALE_SCE:
      scene_to_keylist(ads, static_cast<Scene *>(ale->key_data), keylist, saction_flag, range);
      break;
    case ALE_OB:
      ob_to_keylist(ads, static_cast<Object *>(ale->key_data), keylist, saction_flag, range);
      break;
    case ALE_ACTION_LAYERED:
      action_slot_summary_to_keylist(ac, ale->id, static_cast<bAction *>(ale->key_data)->wrap(), ale->adt->slot_handle, keylist,
                                     saction_flag, range);
      break;
    case ALE_ACTION_SLOT:
      action_slot_summary_to_keylist(ac, ale->id, static_cast<bAction *>(ale->key_data)->wrap(),
                                     static_cast<animrig::Slot *>(ale->data)->handle, keylist, saction_flag, range);
      break;
    case ALE_GROUP:
      action_group_to_keylist(ale->adt, static_cast<bActionGroup *>(ale->data), keylist, saction_flag, range);
      break;
    case ALE_FCURVE:
      fcurve_to_keylist(ale->adt, static_cast<FCurve *>(ale->key_data), keylist, saction_flag, range, ANIM_nla_mapping_allowed(ale));
      break;
    default:
      break;
  }
  ED_keylist_prepare_for_direct_access(keylist);
  const int count = std::min(int(ED_keylist_array_len(keylist)), max);
  const ActKeyColumn *columns = ED_keylist_array(keylist);
  for (int i = 0; i < count; i++) {
    const ActKeyColumn &ak = columns[i];
    float *out = r_columns + i * 8;
    out[0] = ak.cfra;
    out[1] = ak.key_type;
    out[2] = ak.handle_type;
    out[3] = ak.extreme_type;
    out[4] = ak.sel;
    out[5] = ak.block.flag;
    out[6] = ak.block.sel;
    out[7] = actkeyblock_get_valid_hold(&ak);
  }
  ED_keylist_free(keylist);
  return count;
}

/* The F-Curves the Graph Editor draws (graph_draw_curves' filter), refreshed: written as the FCurve's address and the
 * unit mapping its keys are drawn with (ANIM_unit_mapping_get_factor: scale and offset of values). Returns the count. */
EXPORT(anim_graph_curves) int anim_graph_curves(bContext *C, float *r_curves, int max)
{
  bAnimContext ac;
  if (!ANIM_animdata_get_context(C, &ac)) {
    return 0;
  }
  ListBaseT<bAnimListElem> elems = {nullptr, nullptr};
  const int filter = ANIMFILTER_DATA_VISIBLE | ANIMFILTER_CURVE_VISIBLE | ANIMFILTER_FCURVESONLY | ANIMFILTER_NODUPLIS;
  ANIM_animdata_filter(&ac, &elems, eAnimFilter_Flags(filter), ac.data, eAnimCont_Types(ac.datatype));
  const short mapping_flag = ANIM_get_normalization_flags(ac.sl);
  int count = 0;
  for (bAnimListElem &ale : elems) {
    if (count == max) {
      break;
    }
    FCurve *fcu = static_cast<FCurve *>(ale.key_data);
    float offset;
    const float factor = ANIM_unit_mapping_get_factor(ac.scene, ale.id, fcu, mapping_flag, &offset);
    float *out = r_curves + count * 3;
    reinterpret_cast<uint32_t *>(out)[0] = uint32_t(uintptr_t(fcu));
    out[1] = factor;
    out[2] = offset;
    count++;
  }
  ANIM_animdata_freelist(&elems);
  return count;
}

/* The sizes the editors lay out and draw with, in pixels or view units of a region's view: channel height, skip and
 * step, the first channel's top, the time scrubbing area's and the markers' heights, the scroll bar's width and the
 * keyframe scale. */
EXPORT(anim_ui_metrics) const float *anim_ui_metrics(View2D *v2d)
{
  static float metrics[8];
  metrics[0] = ANIM_UI_get_channel_height();
  metrics[1] = ANIM_UI_get_channel_skip();
  metrics[2] = ANIM_UI_get_channel_step();
  metrics[3] = v2d ? ANIM_UI_get_first_channel_top(v2d) : 0.0f;
  metrics[4] = UI_TIME_SCRUB_MARGIN_Y;
  metrics[5] = UI_MARKER_MARGIN_Y;
  metrics[6] = V2D_SCROLL_WIDTH;
  metrics[7] = ANIM_UI_get_keyframe_scale_factor();
  return metrics;
}

/* An FCurve's values at count frames from start, step apart, as the Graph Editor draws it (evaluate_fcurve). */
EXPORT(anim_fcurve_sample) void anim_fcurve_sample(FCurve *fcu, float start, float step, int count, float *r_values)
{
  for (int i = 0; i < count; i++) {
    r_values[i] = evaluate_fcurve(fcu, start + step * i);
  }
}

/* An icon's name (ICON_*). */
EXPORT(anim_icon_name) const char *anim_icon_name(int icon)
{
  static const char *names[] = {
#define DEF_ICON(name) #name,
#define DEF_ICON_DUMMY(name) #name,
#define DEF_ICON_SCENE(name) #name,
#define DEF_ICON_COLLECTION(name) #name,
#define DEF_ICON_OBJECT(name) #name,
#define DEF_ICON_OBJECT_DATA(name) #name,
#define DEF_ICON_MODIFIER(name) #name,
#define DEF_ICON_SHADING(name) #name,
#define DEF_ICON_FOLDER(name) #name,
#define DEF_ICON_FUND(name) #name,
#define DEF_ICON_VECTOR(name) #name,
#define DEF_ICON_COLOR(name) #name,
#define DEF_ICON_BLANK(name) #name,
#include "UI_icons.hh"
  };
  return icon >= 0 && icon < int(ARRAY_SIZE(names)) ? names[icon] : "NONE";
}

/* Blender's enums JS names values by, as "identifier\tvalue" lines: event types, event values, property subtypes. */
EXPORT(rna_enum_text) const char *rna_enum_text(int which)
{
  static const EnumPropertyItem *tables[] = {rna_enum_event_type_items, rna_enum_event_value_items, rna_enum_property_subtype_items};
  static std::string text;
  text.clear();
  for (const EnumPropertyItem *item = tables[which]; item->identifier; item++) {
    if (item->identifier[0]) {
      text += std::string(item->identifier) + '\t' + std::to_string(item->value) + '\n';
    }
  }
  return text.c_str();
}

/* Gestures (wm_gesture_ops.cc): an operator's invoke starts one, and Bylonder's window manager draws and runs it,
 * then sets the operator's properties and runs its exec, as the gesture's modal does when it ends. */
enum Gesture { GESTURE_NONE, GESTURE_BOX, GESTURE_CIRCLE, GESTURE_LASSO };
static Gesture gesture_started = GESTURE_NONE;
static Vector<int2> lasso_path;

/* The point (region pixels, y up) a running operator draws a dashed line from to the mouse, or null. */
static const float *mouse_line_from = nullptr;
EXPORT(region_mouse_line) const float *region_mouse_line() { return mouse_line_from; }

/* The gesture the last invoke started (Gesture), cleared by asking. */
EXPORT(operator_gesture) int operator_gesture() { return std::exchange(gesture_started, GESTURE_NONE); }
/* A lasso's path in region pixels (count points of x, y), for its exec. */
EXPORT(gesture_lasso_path_set) void gesture_lasso_path_set(const int2 *xy, int count) { lasso_path = Span<int2>(xy, count); }

/* Popups an invoke opens (wm_operators.cc): Bylonder's window manager shows them, then runs the operator's exec when
 * the user confirms, or sets the enum property and runs it when the user picks an item. */
enum Popup { POPUP_NONE, POPUP_CONFIRM, POPUP_ENUM_MENU, POPUP_PROPS, POPUP_LAYOUT };
static Popup popup_opened = POPUP_NONE;
static std::string popup_title, popup_text;
/* The operator that opened it, by idname, and the values it was invoked with, for running it from the popup. */
static std::string popup_idname, popup_values;

/* The popup the last invoke opened (Popup), cleared by asking: its title, and its confirm button's text, the enum
 * property's identifier or the recorded layout of a popup menu (panel-layout.cc). */
EXPORT(operator_popup) int operator_popup() { return std::exchange(popup_opened, POPUP_NONE); }
EXPORT(operator_popup_title) const char *operator_popup_title() { return popup_title.c_str(); }
EXPORT(operator_popup_text) const char *operator_popup_text() { return popup_text.c_str(); }

static std::string json_string(const std::string &text)
{
  std::string out = "\"";
  for (const char c : text) {
    out += c == '"' ? "\\\"" : c == '\\' ? "\\\\" : c == '\n' ? "\\n" : std::string(1, c);
  }
  return out + "\"";
}
extern "C" const char *operator_menu_called();
namespace blender {
/* The popup the last operator opened or the menu it called, as JSON for an event's result (wm-api.cc), cleared:
 * { type, title, text, idname, values } (type as operator_popup's numbers), { menu }, or null. */
std::string operator_popup_json()
{
  const std::string menu = operator_menu_called();
  if (!menu.empty()) {
    return "{\"menu\":" + json_string(menu) + "}";
  }
  const Popup popup = std::exchange(popup_opened, POPUP_NONE);
  if (popup == POPUP_NONE) {
    return "null";
  }
  return "{\"type\":" + std::to_string(popup) + ",\"title\":" + json_string(popup_title) + ",\"text\":" +
         json_string(popup_text) + ",\"idname\":" + json_string(popup_idname) + ",\"values\":" + popup_values + "}";
}
}  // namespace blender

/* What the editors reach of Blender's window manager and screen, which are Bylonder's (JS). */

namespace blender {

/* port-override: the header region shows this text (JS reads it with anim_area_status). */
void ED_area_status_text(ScrArea *area, const char *str)
{
  if (area) {
    reinterpret_cast<BylonderArea *>(area)->status = str ? str : "";
  }
}


static wmOperatorStatus gesture_start(bContext *C, wmOperator *op, Gesture gesture)
{
  gesture_started = gesture;
  WM_event_add_modal_handler(C, op);
  return OPERATOR_RUNNING_MODAL;
}
wmOperatorStatus WM_gesture_box_invoke(bContext *C, wmOperator *op, const wmEvent * /*event*/) { return gesture_start(C, op, GESTURE_BOX); }
wmOperatorStatus WM_gesture_circle_invoke(bContext *C, wmOperator *op, const wmEvent * /*event*/) { return gesture_start(C, op, GESTURE_CIRCLE); }
wmOperatorStatus WM_gesture_lasso_invoke(bContext *C, wmOperator *op, const wmEvent * /*event*/) { return gesture_start(C, op, GESTURE_LASSO); }
wmOperatorStatus WM_gesture_box_modal(bContext * /*C*/, wmOperator * /*op*/, const wmEvent * /*event*/) { return OPERATOR_PASS_THROUGH; }
wmOperatorStatus WM_gesture_circle_modal(bContext * /*C*/, wmOperator * /*op*/, const wmEvent * /*event*/) { return OPERATOR_PASS_THROUGH; }
wmOperatorStatus WM_gesture_lasso_modal(bContext * /*C*/, wmOperator * /*op*/, const wmEvent * /*event*/) { return OPERATOR_PASS_THROUGH; }
void WM_gesture_box_cancel(bContext * /*C*/, wmOperator * /*op*/) {}
void WM_gesture_circle_cancel(bContext * /*C*/, wmOperator * /*op*/) {}
void WM_gesture_lasso_cancel(bContext * /*C*/, wmOperator * /*op*/) {}
namespace ui {
std::string operator_props_layout(bContext *C, wmOperator *op);
}
static wmOperatorStatus popup_open(Popup popup, const char *title, const char *text, wmOperator *op = nullptr)
{
  popup_opened = popup;
  popup_title = title;
  popup_text = text;
  popup_idname = op ? op->idname : "";
  popup_values = op ? operator_values_json(op->ptr) : "{}";
  return OPERATOR_INTERFACE;
}
wmOperatorStatus WM_operator_confirm_ex(bContext * /*C*/, wmOperator *op, const char *title, const char * /*message*/,
                                        const char *confirm_text, ui::AlertIcon /*icon*/, bool /*cancel_default*/)
{
  return popup_open(POPUP_CONFIRM, title ? title : op->type->name, confirm_text ? confirm_text : IFACE_("OK"), op);
}
/* As wm_operators.cc defines it, the menu being Bylonder's. */
wmOperatorStatus WM_menu_invoke(bContext *C, wmOperator *op, const wmEvent * /*event*/)
{
  PropertyRNA *prop = op->type->prop;
  if (prop == nullptr || RNA_property_type(prop) != PROP_ENUM) {
    return OPERATOR_CANCELLED;
  }
  if (RNA_property_is_set(op->ptr, prop)) {
    return op->type->exec(C, op);
  }
  return popup_open(POPUP_ENUM_MENU, op->type->name, RNA_property_identifier(prop), op);
}

/* The properties popups and dialogs (wm_operators.cc): Bylonder's window manager shows the operator's properties as
 * the module records them (operator_props_layout, JSON with the confirm button's text), the operator kept until the
 * user confirms, which runs its exec, or cancels. */
wmOperatorStatus WM_operator_props_dialog_popup(bContext *C, wmOperator *op, int /*width*/, std::optional<std::string> title,
                                                std::optional<std::string> confirm_text, bool /*cancel_default*/,
                                                std::optional<std::string> /*message*/, bool /*show_icon*/)
{
  const std::string confirm = confirm_text.value_or(IFACE_("OK"));
  const std::string text = "{\"confirm\":\"" + confirm + "\",\"layout\":" + ui::operator_props_layout(C, op) + "}";
  return popup_open(POPUP_PROPS, title ? title->c_str() : op->type->name, text.c_str(), op);
}
wmOperatorStatus WM_operator_props_popup(bContext *C, wmOperator *op, const wmEvent * /*event*/)
{
  return WM_operator_props_dialog_popup(C, op, 300);
}
wmOperatorStatus WM_operator_props_popup_confirm_ex(bContext *C, wmOperator *op, const wmEvent * /*event*/, std::optional<std::string> title,
                                                    std::optional<std::string> confirm_text, bool cancel_default,
                                                    std::optional<std::string> message)
{
  return WM_operator_props_dialog_popup(C, op, 300, title, confirm_text, cancel_default, message);
}
wmOperatorStatus WM_operator_props_popup_confirm(bContext *C, wmOperator *op, const wmEvent *event)
{
  return WM_operator_props_popup_confirm_ex(C, op, event);
}

/* As wm_operators.cc defines them. */
wmOperatorStatus WM_generic_select_modal(bContext *C, wmOperator *op, const wmEvent *event)
{
  PropertyRNA *wait_to_deselect_prop = RNA_struct_find_property(op->ptr, "wait_to_deselect_others");
  const bool use_select_on_click = RNA_struct_property_is_set(op->ptr, "use_select_on_click");
  const short init_event_type = short(POINTER_AS_INT(op->customdata));
  const int mval[2] = {RNA_int_get(op->ptr, "mouse_x"), RNA_int_get(op->ptr, "mouse_y")};

  if (init_event_type == 0) {
    op->customdata = POINTER_FROM_INT(int(event->type));
    if (use_select_on_click) {
      WM_event_add_modal_handler(C, op);
      return OPERATOR_RUNNING_MODAL | OPERATOR_PASS_THROUGH;
    }
    if (event->val == KM_PRESS) {
      RNA_property_boolean_set(op->ptr, wait_to_deselect_prop, true);
      const wmOperatorStatus retval = op->type->exec(C, op);
      if (retval & OPERATOR_RUNNING_MODAL) {
        WM_event_add_modal_handler(C, op);
      }
      return retval | OPERATOR_PASS_THROUGH;
    }
    RNA_property_boolean_set(op->ptr, wait_to_deselect_prop, false);
    return op->type->exec(C, op) | OPERATOR_PASS_THROUGH;
  }
  if (event->type == init_event_type && event->val == KM_RELEASE) {
    RNA_property_boolean_set(op->ptr, wait_to_deselect_prop, false);
    return op->type->exec(C, op) | OPERATOR_PASS_THROUGH;
  }
  if (ISMOUSE_MOTION(event->type)) {
    const int drag_delta[2] = {mval[0] - event->mval[0], mval[1] - event->mval[1]};
    if (WM_event_drag_test_with_delta(event, drag_delta)) {
      return OPERATOR_FINISHED | OPERATOR_PASS_THROUGH;
    }
    return OPERATOR_PASS_THROUGH;
  }
  return OPERATOR_RUNNING_MODAL | OPERATOR_PASS_THROUGH;
}
wmOperatorStatus WM_generic_select_invoke(bContext *C, wmOperator *op, const wmEvent *event)
{
  int mval[2];
  WM_event_drag_start_mval(event, CTX_wm_region(C), mval);
  RNA_int_set(op->ptr, "mouse_x", mval[0]);
  RNA_int_set(op->ptr, "mouse_y", mval[1]);
  op->customdata = POINTER_FROM_INT(0);
  return op->type->modal(C, op, event);
}

/* A circle gesture runs its exec once, when it ends: it has no wmGesture, so wm_gesture.cc's
 * WM_gesture_is_modal_first answers that it is the first call. */
Array<int2> WM_gesture_lasso_path_to_array(bContext * /*C*/, wmOperator * /*op*/) { return Array<int2>(lasso_path.as_span()); }

/* port-override: the pointer's shape and timers are Bylonder's window manager's. */
bool WM_cursor_modal_is_set_ok(const wmWindow * /*win*/) { return true; }
void WM_cursor_modal_set(wmWindow * /*win*/, int /*val*/) {}
void WM_cursor_modal_restore(wmWindow * /*win*/) {}
void WM_cursor_wait(bool /*val*/) {}
wmTimer *WM_event_timer_add(wmWindowManager * /*wm*/, wmWindow * /*win*/, wmEventType /*event_type*/, double /*time_step*/)
{
  return nullptr;
}
void WM_event_timer_remove(wmWindowManager * /*wm*/, wmWindow * /*win*/, wmTimer * /*timer*/) {}

/* port-override: Bylonder draws the editors (JS), so regions keep no draw callbacks; of them it draws the dashed line
 * from a point to the mouse (ED_region_draw_mouse_line_cb, Inset's and Bevel's), whose point it reads with
 * region_mouse_line. */
void *ED_region_draw_cb_activate(ARegionType * /*art*/, void (*draw)(const bContext *, ARegion *, void *), void *customdata,
                                 int /*type*/)
{
  static int handle;
  if (draw == ED_region_draw_mouse_line_cb) {
    mouse_line_from = static_cast<const float *>(customdata);
    return &mouse_line_from;
  }
  return &handle;
}
bool ED_region_draw_cb_exit(ARegionType * /*art*/, void *handle)
{
  if (handle == &mouse_line_from) {
    mouse_line_from = nullptr;
  }
  return true;
}

/* port-override: Bylonder's objects have no point caches, so the Timeline draws no cache ranges (timeline_draw_cache). */
void BKE_ptcache_ids_from_object(ListBaseT<PTCacheID> *lb, Object * /*ob*/, Scene * /*scene*/, int /*duplis*/)
{
  BLI_listbase_clear(lb);
}

/* port-override: Bylonder lays an area's regions out on its next draw, from their flags. */
void ED_region_visibility_change_update(bContext * /*C*/, ScrArea * /*area*/, ARegion * /*region*/) {}

/* As area.cc gives it for a region no other region overlaps. */
const rcti *ED_region_visible_rect(ARegion *region)
{
  static rcti rect;
  rect = {0, region->winx - 1, 0, region->winy - 1};
  return &rect;
}

/* The modal keymaps' key items are Blender's keymap data in JS, so they have none here to show or find. */
const wmKeyMapItem *WM_modalkeymap_find_propvalue(const wmKeyMap * /*km*/, int /*propvalue*/) { return nullptr; }
std::optional<std::string> WM_modalkeymap_operator_items_to_string(wmOperatorType * /*ot*/, int /*propvalue*/, bool /*compact*/)
{
  return std::nullopt;
}

std::string WM_operatortype_name(wmOperatorType *ot, PointerRNA *properties)
{
  return ot->get_name && properties ? ot->get_name(ot, properties) : std::string(ot->name ? ot->name : "");
}

/* As screen_ops.cc defines the animation editors' polls. */
static bool space_test(bContext *C, int spacetype)
{
  const SpaceLink *sl = CTX_wm_space_data(C);
  return sl && sl->spacetype == spacetype;
}
static bool region_test(bContext *C, int spacetype, const char *space_message, const char *region_message)
{
  if (!space_test(C, spacetype)) {
    CTX_wm_operator_poll_msg_set(C, space_message);
    return false;
  }
  const ARegion *region = CTX_wm_region(C);
  if (!(region && region->regiontype == RGN_TYPE_WINDOW)) {
    CTX_wm_operator_poll_msg_set(C, region_message);
    return false;
  }
  return true;
}
bool ED_operator_action_active(bContext *C) { return space_test(C, SPACE_ACTION); }
bool ED_operator_graphedit_active(bContext *C) { return space_test(C, SPACE_GRAPH); }
bool ED_operator_region_action_active(bContext *C)
{
  return region_test(C, SPACE_ACTION, "Expected an active Dope Sheet", "Expected a Dope Sheet region");
}
bool ED_operator_region_graphedit_active(bContext *C)
{
  return region_test(C, SPACE_GRAPH, "Expected an active Graph Editor", "Expected a Graph Editor region");
}
bool ED_operator_animview_active(bContext *C)
{
  const SpaceLink *sl = CTX_wm_area(C) ? CTX_wm_space_data(C) : nullptr;
  if (sl && ELEM(sl->spacetype, SPACE_SEQ, SPACE_ACTION, SPACE_NLA, SPACE_GRAPH)) {
    return true;
  }
  CTX_wm_operator_poll_msg_set(C, "Expected a timeline/animation area to be active");
  return false;
}
bool ED_operator_region_animview_active(bContext *C)
{
  if (!ED_operator_animview_active(C)) {
    return false;
  }
  const ARegion *region = CTX_wm_region(C);
  if (!(region && region->regiontype == RGN_TYPE_WINDOW)) {
    CTX_wm_operator_poll_msg_set(C, "Expected a timeline/animation region");
    return false;
  }
  return true;
}

/* port-override: the module's markers have no cameras bound (Bylonder's scene camera is its own), so moving markers
 * switches no camera. */
bool BKE_scene_camera_switch_update(Scene * /*scene*/) { return false; }

/* As wm_operators.cc defines it. */
int WM_operator_smooth_viewtx_get(const wmOperator *op)
{
  return (op->flag & OP_IS_INVOKE && !(U.uiflag & USER_REDUCE_MOTION)) ? U.smooth_viewtx : 0;
}

/* port-override: no message bus (its subscribers are the UI's); the 3D View navigates in JS, so transform has no
 * 3D View navigation to pass events to. */
void WM_msg_publish_rna_params(wmMsgBus * /*mbus*/, const wmMsgParams_RNA * /*msg_key_params*/) {}
ViewOpsData *ED_view3d_navigation_init(bContext * /*C*/, const wmKeyMapItem * /*kmi_merge*/) { return nullptr; }

/* port-override: Bylonder's RNA updates follow an operator's run (JS), and it draws the transform's cursor. */
void RNA_property_update_main(Main * /*bmain*/, Scene * /*scene*/, PointerRNA * /*ptr*/, PropertyRNA * /*prop*/) {}
wmPaintCursor *WM_paint_cursor_activate(short /*space_type*/, short /*region_type*/, bool (* /*poll*/)(bContext *),
                                        wmPaintCursorDraw /*draw*/, void * /*customdata*/)
{
  static int cursor;
  return reinterpret_cast<wmPaintCursor *>(&cursor);
}
bool WM_paint_cursor_end(wmPaintCursor * /*handle*/) { return true; }

/* port-override: Bylonder lays out the editors' panels (JS), so panel types are not kept. */
bool WM_paneltype_add(PanelType * /*pt*/) { return true; }

/* port-override: the editors' redo panel (the HUD region) is Bylonder's. */
ARegionType *ui::ED_area_type_hud(int /*space_type*/)
{
  ARegionType *art = MEM_new_zeroed<ARegionType>(__func__);
  art->regionid = RGN_TYPE_HUD;
  return art;
}

}  // namespace blender

/* A popup menu's recorded layout (panel-layout.cc's popup_menu_end) as the running invoke's popup. */
void popup_layout_open(const std::string &title, const std::string &layout)
{
  blender::popup_open(POPUP_LAYOUT, title.c_str(), layout.c_str());
}
