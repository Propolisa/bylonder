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
#include "BLF_api.hh"
#include "BKE_context.hh"
#include "BKE_fcurve.hh"
#include "BKE_idtype.hh"
#include "BLT_translation.hh"
#include "BKE_lib_id.hh"
#include "BKE_main.hh"
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
#include "ED_markers.hh"
#include "ED_screen.hh"
#include "ED_space_api.hh"
#include "ED_view3d.hh"
#include "WM_message.hh"
#include "MEM_guardedalloc.h"
#include "RNA_enum_types.hh"
#include "UI_interface_icons.hh"
#include "UI_interface_c.hh"
#include "UI_resources.hh"
#include "UI_view2d.hh"
#include "operator-properties.hh"
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

/* The interface's resolution as WM_window_dpi_set_userdef sets it at Blender's default 1.0 scale, and the default
 * theme (userdef_default_theme.c), which the editors read curve and channel colors from. */
static void ui_ensure()
{
  U.dpi = 72;
  U.scale_factor = 1.0f;
  U.inv_scale_factor = 1.0f;
  U.pixelsize = 1.0f;
  U.widget_unit = 20;
  /* port-override: views change at once; Bylonder's window manager has no timers to animate them. */
  U.smooth_viewtx = 0;
  ui::theme::init_default();
  ui::style_init_default();
}

/* The animation editors' operators, registered by their own registration functions (called by editor-context's
 * operator table), and the transform operators' modal keymap. */
void anim_operatortypes()
{
  ui_ensure();
  graphedit_operatortypes();
  action_operatortypes();
  ED_operatortypes_animchannels();
  ED_operatortypes_anim();
  ED_operatortypes_marker();
  ui::ED_operatortypes_view2d();
}

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
struct AnimArea {
  ScrArea area = {};
  std::string status;
};

static ARegion *area_region(AnimArea *a, int regiontype) { return BKE_area_find_region_type(&a->area, regiontype); }

static void space_types_ensure()
{
  static const bool types = (ED_spacetype_ipo(), ED_spacetype_action(), true);
  (void)types;
}

/* An area of a space type (SPACE_GRAPH, SPACE_ACTION), as ED_area_newspace makes one. */
EXPORT(anim_area_new) AnimArea *anim_area_new(bContext *C, int spacetype)
{
  space_types_ensure();
  AnimArea *a = MEM_new<AnimArea>(__func__);
  SpaceType *st = BKE_spacetype_from_id(spacetype);
  SpaceLink *sl = st->create(&a->area, CTX_data_scene(C));
  BLI_addtail(&a->area.spacedata, sl);
  a->area.spacetype = char(spacetype);
  a->area.type = st;
  a->area.regionbase = sl->regionbase;
  BLI_listbase_clear(&sl->regionbase);
  for (ARegion &region : a->area.regionbase) {
    region.runtime->type = BKE_regiontype_from_id(st, region.regiontype);
  }
  return a;
}

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

/* A region's size and place in the area (bottom-left origin, Blender's y up), as the screen lays it out; its view keeps
 * its zoom as view2d_region_reinit keeps it for the region's view type. */
EXPORT(anim_region_layout) void anim_region_layout(ARegion *region, int x, int y, int width, int height, int view_type)
{
  region->winrct = {x, x + width - 1, y, y + height - 1};
  region->winx = short(width);
  region->winy = short(height);
  ui::view2d_region_reinit(&region->v2d, short(view_type), width, height);
}

EXPORT(anim_region_v2d) View2D *anim_region_v2d(ARegion *region) { return &region->v2d; }

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
  return int(list.infos.size());
}

EXPORT(anim_channel_info) const ChannelInfo *anim_channel_info(int index) { return &channel_list().infos[index]; }

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
    out[7] = ak.totblock;
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

/* The gesture the last invoke started (Gesture), cleared by asking. */
EXPORT(operator_gesture) int operator_gesture() { return std::exchange(gesture_started, GESTURE_NONE); }
/* A lasso's path in region pixels (count points of x, y), for its exec. */
EXPORT(gesture_lasso_path_set) void gesture_lasso_path_set(const int2 *xy, int count) { lasso_path = Span<int2>(xy, count); }

/* What the editors reach of Blender's window manager and screen, which are Bylonder's (JS). */

namespace blender {

/* port-override: the header region shows this text (JS reads it with anim_area_status). */
void ED_area_status_text(ScrArea *area, const char *str)
{
  if (area) {
    reinterpret_cast<AnimArea *>(area)->status = str ? str : "";
  }
}

/* port-override: Bylonder redraws its editors after each operator and each event an operator handles. */
void ED_area_tag_redraw(ScrArea * /*area*/) {}
void ED_area_tag_redraw_no_rebuild(ScrArea * /*area*/) {}
void ED_area_tag_refresh(ScrArea * /*area*/) {}
void ED_region_tag_redraw_no_rebuild(ARegion * /*region*/) {}

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
/* A circle gesture runs its exec once, when it ends. */
bool WM_gesture_is_modal_first(const wmGesture * /*gesture*/) { return true; }
Array<int2> WM_gesture_lasso_path_to_array(bContext * /*C*/, wmOperator * /*op*/) { return Array<int2>(lasso_path.as_span()); }

/* port-override: the pointer's shape and timers are Bylonder's window manager's. */
bool WM_cursor_modal_is_set_ok(const wmWindow * /*win*/) { return true; }
void WM_cursor_modal_set(wmWindow * /*win*/, int /*val*/) {}
void WM_cursor_modal_restore(wmWindow * /*win*/) {}
void WM_cursor_wait(bool /*val*/) {}
void WM_event_add_mousemove(wmWindow * /*win*/) {}
wmTimer *WM_event_timer_add(wmWindowManager * /*wm*/, wmWindow * /*win*/, wmEventType /*event_type*/, double /*time_step*/)
{
  return nullptr;
}
void WM_event_timer_remove(wmWindowManager * /*wm*/, wmWindow * /*win*/, wmTimer * /*timer*/) {}

/* port-override: Bylonder draws the editors (JS), so regions keep no draw callbacks. */
void *ED_region_draw_cb_activate(ARegionType * /*art*/, void (* /*draw*/)(const bContext *, ARegion *, void *), void * /*customdata*/,
                                 int /*type*/)
{
  static int handle;
  return &handle;
}
bool ED_region_draw_cb_exit(ARegionType * /*art*/, void * /*handle*/) { return true; }

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

/* As wm_operators.cc defines them. */
PointerRNA WM_operator_properties_create_ptr(wmOperatorType *ot) { return {nullptr, ot->srna, operator_values_new()}; }
void WM_operator_properties_free(PointerRNA *ptr)
{
  operator_values_free(ptr->data);
  ptr->data = nullptr;
}
std::string WM_operatortype_name(wmOperatorType *ot, PointerRNA * /*properties*/) { return ot->name ? ot->name : ""; }

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

/* port-override: Bylonder draws text with the browser's fonts (JS), so the interface style's fonts are not loaded. */
void BLF_unload_all() {}
void BLF_cache_flush_set_fn(void (* /*cache_flush_fn*/)()) {}
void BLF_enable(int /*fontid*/, FontFlags /*flag*/) {}
void BLF_disable(int /*fontid*/, FontFlags /*flag*/) {}
void BLF_default_size(float /*size*/) {}
void BLF_default_set(int /*fontid*/) {}
int BLF_load_default(bool /*unique*/) { return 0; }
int BLF_load_mono_default(bool /*unique*/) { return 1; }
void BLF_load_font_stack() {}
int BLF_set_default() { return 0; }
float BLF_width(int /*fontid*/, const char * /*str*/, size_t /*str_len*/, ResultBLF * /*r_info*/) { return 0.0f; }

/* As scene.cc defines it. */
double Scene::frames_per_second() const { return double(this->r.frs_sec) / double(this->r.frs_sec_base); }

/* port-override: scene.cc's Scene type without its data callbacks (the module world's Scene is main-api.cc's), so the
 * Scene is an ID that has animation data, as in Blender. */
IDTypeInfo IDType_ID_SCE = {
    .id_code = Scene::id_type,
    .id_filter = FILTER_ID_SCE,
    .dependencies_id_types = 0,
    .main_listbase_index = INDEX_ID_SCE,
    .struct_size = sizeof(Scene),
    .name = "Scene",
    .name_plural = N_("scenes"),
    .translation_context = BLT_I18NCONTEXT_ID_SCENE,
    .flags = IDTYPE_FLAGS_NEVER_UNUSED,
    .asset_type_info = nullptr,
};

/* As wm_operators.cc defines it. */
int WM_operator_smooth_viewtx_get(const wmOperator *op)
{
  return (op->flag & OP_IS_INVOKE && !(U.uiflag & USER_REDUCE_MOTION)) ? U.smooth_viewtx : 0;
}

/* port-override: Bylonder redraws its status bar and editors itself; its 3D View navigates in JS, so transform has no
 * 3D View navigation to pass events to. */
void WM_window_status_area_tag_redraw(wmWindow * /*win*/) {}
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

/* port-override: the module's IDs have no node trees to list in the animation editors. */
bNodeTree *bke::node_tree_from_id(ID * /*id*/) { return nullptr; }

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
