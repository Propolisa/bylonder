/* Blender's Armature objects in the module's Main (main-api.cc makes them with main_object_add, OB_ARMATURE): their bones
 * and pose in and out, Edit Mode's edit bones (armature_utils.cc's ED_armature_to_edit and ED_armature_from_edit, which
 * object.mode_set runs), the pose Blender evaluates (BKE_pose_where_is, in main_evaluate), which Bylonder draws, and
 * picking a bone in Edit and Pose Mode. */
#include "DEG_depsgraph.hh"
#include "DEG_depsgraph_build.hh"
#include "BKE_action.hh"
#include "BKE_armature.hh"
#include "BKE_context.hh"
#include "BKE_layer.hh"
#include "BLI_listbase.h"
#include "BLI_math_matrix.h"
#include "BLI_math_rotation.h"
#include "BLI_math_vector.h"
#include "BLI_string.h"
#include "BLI_vector.hh"
#include "DNA_action_types.h"
#include "DNA_armature_types.h"
#include "DNA_object_types.h"
#include "ED_armature.hh"
#include "ED_select_utils.hh"
#include "MEM_guardedalloc.h"

#include <string>

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

/* Per bone BONE_INTS ints: its parent's index (-1 for none), its flag (eBone_Flag), its pose channel's flag
 * (ePchan_Flag, of which armature_bones_set sets POSE_SELECTED) and rotation mode; then 40 floats: head, tail and roll in
 * armature space, envelope distance, head and tail radius, the pose channel's location, rotation quaternion, Euler
 * rotation and scale (SET_FLOATS so far), then what Blender draws (read only): the bone's matrix in armature space (the
 * edit bone's in Edit Mode, else the evaluated pose) and its length. */
enum { BONE_INTS = 4, SET_FLOATS = 23 };

struct BonesHeader {
  int bones_num;
  const int *ints;
  const float *floats;
  /* The bones' names, each ended by a newline. */
  const char *names;
  /* The active bone's index, or -1. */
  int active;
};

static bArmature &armature_of(Object *ob) { return *id_cast<bArmature *>(ob->data); }

/* A pose channel's location, rotation quaternion, Euler rotation and scale; a bone without one is at rest. */
static void pose_values(const bPoseChannel *pchan, Vector<float> &floats)
{
  if (!pchan) {
    floats.extend({0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1});
    return;
  }
  floats.extend(Span(pchan->loc, 3));
  floats.extend(Span(pchan->quat, 4));
  floats.extend(Span(pchan->eul, 3));
  floats.extend(Span(pchan->scale, 3));
}

/* The bones in armature_bones_set's layout, valid until the next call: the edit bones in Edit Mode, else the bones in
 * Blender's depth-first order. */
EXPORT(armature_bones_get) const BonesHeader *armature_bones_get(Object *ob)
{
  static BonesHeader header;
  static Vector<int> ints;
  static Vector<float> floats;
  static std::string names;
  ints.clear();
  floats.clear();
  names.clear();
  bArmature &arm = armature_of(ob);
  const bPose *pose = ob->pose;
  const auto channel = [&](const char *name) { return pose ? BKE_pose_channel_find_name(pose, name) : nullptr; };
  int count = 0, active = -1;
  if (arm.edbo) {
    for (EditBone &ebone : *arm.edbo) {
      const bPoseChannel *pchan = channel(ebone.name);
      ints.extend({BLI_findindex(arm.edbo, ebone.parent), ebone.flag, pchan ? pchan->flag : 0, pchan ? pchan->rotmode : ROT_MODE_QUAT});
      floats.extend(Span(ebone.head, 3));
      floats.extend(Span(ebone.tail, 3));
      floats.extend({ebone.roll, ebone.dist, ebone.rad_head, ebone.rad_tail});
      pose_values(pchan, floats);
      float mat[4][4];
      ED_armature_ebone_to_mat4(&ebone, mat);
      floats.extend(Span(&mat[0][0], 16));
      floats.append(len_v3v3(ebone.head, ebone.tail));
      names += std::string(ebone.name) + "\n";
      active = &ebone == arm.act_edbone ? count : active;
      count++;
    }
  }
  else {
    Vector<const Bone *> order;
    BKE_armature_foreach_bone(arm, [&](const int /*index*/, const Bone &bone) { order.append(&bone); });
    for (const Bone *bone : order) {
      const bPoseChannel *pchan = channel(bone->name);
      ints.extend({int(order.first_index_of_try(bone->parent)), bone->flag, pchan ? pchan->flag : 0, pchan ? pchan->rotmode : ROT_MODE_QUAT});
      floats.extend(Span(bone->arm_head, 3));
      floats.extend(Span(bone->arm_tail, 3));
      floats.extend({bone->arm_roll, bone->dist, bone->rad_head, bone->rad_tail});
      pose_values(pchan, floats);
      floats.extend(Span(&(pchan ? pchan->pose_mat : bone->arm_mat)[0][0], 16));
      floats.append(bone->length);
      names += std::string(bone->name) + "\n";
      active = bone == arm.act_bone ? count : active;
      count++;
    }
  }
  header = {count, ints.data(), floats.data(), names.c_str(), active};
  return &header;
}

/* Replaces the bones (the edit bones in Edit Mode) with those given in armature_bones_get's layout, SET_FLOATS floats each
 * (what it gives before the drawn matrix), and sets their pose channels' values. Outside Edit Mode the bones are made as
 * leaving Edit Mode makes them (ED_armature_from_edit) and the pose is rebuilt. */
EXPORT(armature_bones_set)
void armature_bones_set(Main *bmain, Object *ob, int bones_num, const int *ints, const float *floats, const char *names, int active)
{
  bArmature &arm = armature_of(ob);
  const bool editing = arm.edbo != nullptr;
  if (editing) {
    ED_armature_ebone_listbase_free(arm.edbo, true);
  }
  else {
    arm.edbo = MEM_new<ListBaseT<EditBone>>(__func__);
  }
  arm.act_edbone = nullptr;
  Vector<EditBone *> made;
  const char *name = names;
  for (const int i : IndexRange(bones_num)) {
    const int *n = ints + i * BONE_INTS;
    const float *f = floats + i * SET_FLOATS;
    const char *end = strchr(name, '\n');
    const std::string bone_name(name, end - name);
    name = end + 1;
    EditBone *ebone = ED_armature_ebone_add(&arm, bone_name.c_str());
    ebone->parent = n[0] >= 0 && n[0] < i ? made[n[0]] : nullptr;
    ebone->flag = eBone_Flag(n[1]);
    copy_v3_v3(ebone->head, f);
    copy_v3_v3(ebone->tail, f + 3);
    ebone->roll = f[6];
    ebone->dist = f[7];
    ebone->rad_head = f[8];
    ebone->rad_tail = f[9];
    if (i == active) {
      arm.act_edbone = ebone;
    }
    made.append(ebone);
  }
  if (!editing) {
    ED_armature_from_edit(bmain, &arm);
    ED_armature_edit_free(&arm);
  }
  BKE_pose_ensure(bmain, ob, &arm, true);
  name = names;
  for (const int i : IndexRange(bones_num)) {
    const char *end = strchr(name, '\n');
    const std::string bone_name(name, end - name);
    name = end + 1;
    bPoseChannel *pchan = BKE_pose_channel_find_name(ob->pose, bone_name.c_str());
    if (!pchan) {
      continue;
    }
    const int *n = ints + i * BONE_INTS;
    const float *f = floats + i * SET_FLOATS + 10;
    pchan->flag = ePchan_Flag((pchan->flag & ~POSE_SELECTED) | (n[2] & POSE_SELECTED));
    pchan->rotmode = eRotationModes(n[3]);
    copy_v3_v3(pchan->loc, f);
    copy_qt_qt(pchan->quat, f + 3);
    copy_v3_v3(pchan->eul, f + 7);
    copy_v3_v3(pchan->scale, f + 10);
  }
  DEG_id_tag_update(&arm.id, ID_RECALC_GEOMETRY);
  DEG_id_tag_update(&ob->id, ID_RECALC_GEOMETRY);
  DEG_relations_tag_update(bmain);
}

/* A click on a bone (its index in armature_bones_get's order, -1 for none; `part` 0 for its body, 1 its head, 2 its
 * tail) in Edit or Pose Mode, with a select operation (eSelectOp), as view3d.select applies it to the bone the GPU's
 * selection buffer found (port-override: the module has no GPU selection, Bylonder's picking finds the bone). */
EXPORT(armature_select_pick)
bool armature_select_pick(bContext *C, Object *ob, int index, int part, int sel_op, bool deselect_all, bool select_passthrough)
{
  const SelectPick_Params params = {eSelectOp(sel_op), deselect_all, select_passthrough};
  Scene *scene = CTX_data_scene(C);
  ViewLayer *view_layer = CTX_data_view_layer(C);
  BKE_view_layer_synced_ensure(*CTX_data_main(C), scene, view_layer);
  bArmature &arm = armature_of(ob);
  if (arm.edbo) {
    EditBone *ebone = index >= 0 ? static_cast<EditBone *>(BLI_findlink(arm.edbo, index)) : nullptr;
    const eBone_Flag selmask = part == 1 ? BONE_ROOTSEL : part == 2 ? BONE_TIPSEL : BONE_SELECTED;
    return ED_armature_edit_select_pick_bone(C, BKE_view_layer_base_find(view_layer, ob), ebone, selmask, params);
  }
  const Bone *picked = nullptr;
  BKE_armature_foreach_bone(arm, [&](const int i, const Bone &bone) { picked = i == index ? &bone : picked; });
  bPoseChannel *pchan = picked && ob->pose ? BKE_pose_channel_find_name(ob->pose, picked->name) : nullptr;
  return ED_armature_pose_select_pick_bone(*CTX_data_main(C), scene, view_layer, CTX_wm_view3d(C), ob, pchan, params);
}
