/* The constraint kernels module (constraints.wasm): Blender's object and bone constraints on objects outside any Main.
 * A rig is an armature object whose bones and pose JS writes at the DNA offsets of their RNA properties (Bone,
 * PoseBone), as it writes each constraint's settings (Constraint and its type's struct); its pose is evaluated by
 * BKE_pose_where_is, as the scene module evaluates Main's (main_evaluate), IK solvers included. A target is a rig or an
 * object whose world matrix JS sets. Each constraint type's evaluation can be handed to JS (constraint_unit_use), so a
 * type's kernel is a unit the page can replace with its own. */
#include "BKE_action.hh"
#include "BKE_armature.hh"
#include "BKE_constraint.h"
#include "BKE_object_types.hh"
#include "BKE_scene.hh"
#include "BLI_listbase.h"
#include "BLI_map.hh"
#include "BLI_math_matrix.h"
#include "BLI_math_matrix.hh"
#include "BLI_string.h"
#include "BLI_vector.hh"
#include "DNA_action_types.h"
#include "DNA_armature_types.h"
#include "DNA_constraint_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DEG_depsgraph.hh"
#include "MEM_guardedalloc.h"

#include "pose-depsgraph.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

void types_ensure();

/* An object outside Main: an empty target, or a rig's armature object. Its world matrix is what JS last set, or for a
 * rig, its own after the pose is evaluated. */
static Object *object_new(ObjectType type, const char *name)
{
  Object *ob = MEM_new<Object>(__func__);
  STRNCPY(ob->id.name, name);
  ob->type = type;
  ob->runtime = MEM_new<bke::ObjectRuntime>(__func__);
  ob->runtime->object_to_world = float4x4::identity();
  ob->runtime->world_to_object = float4x4::identity();
  unit_m4(ob->parentinv);
  return ob;
}

static void object_free(Object *ob)
{
  BKE_constraints_free(&ob->constraints);
  if (ob->pose) {
    BKE_pose_free(ob->pose);
  }
  MEM_delete(ob->runtime);
  MEM_delete(ob);
}

struct Rig {
  Scene scene = {};
  Object *object = nullptr;
  bArmature *armature = nullptr;
  /* The bones and pose channels in the order JS gave the bones. */
  Vector<Bone *> bones;
  Vector<bPoseChannel *> channels;
  /* Each pose channel's pose matrix after an evaluation, in the bones' order. */
  Vector<float4x4> pose;
  /* The pose's evaluation as the depsgraph orders it (pose-depsgraph.cc), made by rig_update. */
  Vector<PoseOperation> operations;
};

static Depsgraph *depsgraph_of(Rig &rig) { return BKE_scene_ensure_depsgraph(nullptr, &rig.scene, nullptr); }

/* A rig of bones, each a name and its parent's index (before it, or -1), at rest until JS writes them; its pose
 * channels come with them. */
EXPORT(rig_new) Rig *rig_new(int bones_num, const int *parents, const char *names)
{
  types_ensure();
  Rig *rig = MEM_new<Rig>(__func__);
  rig->scene.r.framelen = 1.0f;
  bArmature *arm = MEM_new<bArmature>(__func__);
  STRNCPY(arm->id.name, "ARRig");
  arm->runtime = MEM_new<bke::bArmature_Runtime>(__func__);
  rig->armature = arm;
  rig->object = object_new(OB_ARMATURE, "OBRig");
  rig->object->data = &arm->id;
  const char *name = names;
  for (const int i : IndexRange(bones_num)) {
    Bone *bone = MEM_new<Bone>(__func__);
    const char *end = strchr(name, '\n');
    BLI_strncpy(bone->name, name, std::min<size_t>(end - name + 1, sizeof(bone->name)));
    name = end + 1;
    Bone *parent = parents[i] >= 0 && parents[i] < i ? rig->bones[parents[i]] : nullptr;
    bone->parent = parent;
    BLI_addtail(parent ? &parent->childbase : &arm->bonebase, bone);
    rig->bones.append(bone);
  }
  BKE_pose_ensure(nullptr, rig->object, arm, false);
  for (Bone *bone : rig->bones) {
    rig->channels.append(BKE_pose_channel_find_name(rig->object->pose, bone->name));
  }
  rig->pose.resize(bones_num, float4x4::identity());
  return rig;
}

static void bones_free(ListBaseT<Bone> &bones)
{
  while (Bone *bone = static_cast<Bone *>(BLI_pophead(&bones))) {
    bones_free(bone->childbase);
    MEM_delete(bone);
  }
}

EXPORT(rig_free) void rig_free(Rig *rig)
{
  object_free(rig->object);
  bones_free(rig->armature->bonebase);
  MEM_delete(rig->armature->runtime);
  MEM_delete(rig->armature);
  MEM_delete(rig);
}

EXPORT(rig_object) Object *rig_object(Rig *rig) { return rig->object; }
EXPORT(rig_armature) bArmature *rig_armature(Rig *rig) { return rig->armature; }
EXPORT(rig_bone) Bone *rig_bone(Rig *rig, int index) { return rig->bones[index]; }
EXPORT(rig_pose_bone) bPoseChannel *rig_pose_bone(Rig *rig, int index) { return rig->channels[index]; }
EXPORT(rig_pose) bPose *rig_pose(Rig *rig) { return rig->object->pose; }

/* A bone's custom B-Bone handles, by the bones' indices (-1 for none). */
EXPORT(rig_bone_handles) void rig_bone_handles(Rig *rig, int index, int start, int end)
{
  rig->bones[index]->bbone_prev = start >= 0 ? rig->bones[start] : nullptr;
  rig->bones[index]->bbone_next = end >= 0 ? rig->bones[end] : nullptr;
}

/* An empty object for a constraint to target or to be owned by, at the world matrix JS sets. */
EXPORT(object_new) Object *object_new_export() { types_ensure(); return object_new(OB_EMPTY, "OBTarget"); }
EXPORT(object_free) void object_free_export(Object *ob) { object_free(ob); }

/* An object's world matrix (column-major, Blender's axes), as Blender places it before its constraints. */
EXPORT(object_matrix_set) void object_matrix_set(Object *ob, const float *matrix)
{
  ob->runtime->object_to_world = float4x4(matrix);
  ob->runtime->world_to_object = math::invert(ob->object_to_world());
}
EXPORT(object_matrix) const float *object_matrix(Object *ob) { return ob->object_to_world().base_ptr(); }

/* An object's parent and parent inverse, which constraints in local space convert by. */
EXPORT(object_parent_set) void object_parent_set(Object *ob, Object *parent, const float *parentinv)
{
  ob->parent = parent;
  copy_m4_m4(ob->parentinv, reinterpret_cast<const float(*)[4]>(parentinv));
}

/* A constraint of a type (eBConstraint_Types) with Blender's defaults, last on a pose bone's stack or else an
 * object's; JS writes its settings at the Constraint's offsets and its type's at constraint_data's. */
EXPORT(constraint_add) bConstraint *constraint_add(Object *ob, bPoseChannel *pchan, int type)
{
  types_ensure();
  return pchan ? BKE_constraint_add_for_pose(ob, pchan, nullptr, eBConstraint_Types(type)) :
                 BKE_constraint_add_for_object(ob, nullptr, eBConstraint_Types(type));
}
EXPORT(constraint_data) void *constraint_data(bConstraint *con) { return con->data; }

/* A constraint's target at an index (Blender's order: IK's target then its pole), an object, or a bone of a rig's
 * object by name; null clears it. */
EXPORT(constraint_target_set) bool constraint_target_set(bConstraint *con, int index, Object *target, const char *subtarget)
{
  ListBaseT<bConstraintTarget> targets = {};
  if (!BKE_constraint_targets_get(con, &targets)) {
    return false;
  }
  bConstraintTarget *ct = static_cast<bConstraintTarget *>(BLI_findlink(&targets, index));
  if (ct) {
    ct->tar = target;
    STRNCPY(ct->subtarget, subtarget ? subtarget : "");
  }
  BKE_constraint_targets_flush(con, &targets, false);
  return ct != nullptr;
}

/* A target more on an Armature constraint, an object or a bone of a rig's object by name, whose ConstraintTargetBone
 * settings (its weight) JS writes. */
EXPORT(constraint_target_add) bConstraintTarget *constraint_target_add(bConstraint *con, Object *target, const char *subtarget)
{
  if (con->type != CONSTRAINT_TYPE_ARMATURE) {
    return nullptr;
  }
  bArmatureConstraint *acon = static_cast<bArmatureConstraint *>(con->data);
  bConstraintTarget *ct = MEM_new<bConstraintTarget>(__func__);
  ct->tar = target;
  STRNCPY(ct->subtarget, subtarget ? subtarget : "");
  ct->weight = 1.0f;
  BLI_addtail(&acon->targets, ct);
  return ct;
}

/* After JS has written bones, pose bones and constraints: the pose rebuilt as BKE_pose_rebuild makes it from them
 * (connected children, custom B-Bone handles, the flags of IK chains), the IK solver's parameters for the pose's solver,
 * as setting it does (rna_Pose_ik_solver_update), and the order its evaluation runs in. */
EXPORT(rig_update) void rig_update(Rig *rig)
{
  BKE_pose_rebuild(nullptr, rig->object, rig->armature, false);
  bPose *pose = rig->object->pose;
  BKE_pose_ikparam_init(pose);
  BKE_pose_pchan_index_rebuild(pose);
  /* Each channel is its own original: the module evaluates its data in place, without evaluated copies. */
  for (bPoseChannel &pchan : pose->chanbase) {
    pchan.orig_pchan = &pchan;
  }
  rig->operations = pose_operations(*rig->object);
}

/* Each pose bone's channel matrix (its location, rotation and scale; column-major, 16 floats per bone in the bones'
 * order), applied as Blender applies a matrix to a pose bone, keeping its rotation mode. */
EXPORT(rig_channels_set) void rig_channels_set(Rig *rig, const float *matrices)
{
  for (const int i : rig->channels.index_range()) {
    BKE_pchan_apply_mat4(rig->channels[i], reinterpret_cast<const float(*)[4]>(matrices + i * 16), true);
  }
}

/* Evaluates the pose at a frame as Main's depsgraph evaluates it: each bone's pose matrix (armature space,
 * column-major), in the bones' order, until the next evaluation. */
EXPORT(rig_evaluate) const float *rig_evaluate(Rig *rig, float frame)
{
  rig->scene.r.cfra = int(frame);
  rig->scene.r.subframe = frame - int(frame);
  pose_operations_run(rig->operations, depsgraph_of(*rig), &rig->scene, rig->object);
  for (const int i : rig->channels.index_range()) {
    rig->pose[i] = float4x4(rig->channels[i]->pose_mat);
  }
  return rig->pose.first().base_ptr();
}

/* An object's world matrix after its constraints, from the one JS set, as BKE_object_where_is_calc solves them. */
EXPORT(object_constraints_evaluate) const float *object_constraints_evaluate(Object *ob, float frame)
{
  static Scene scene = {};
  scene.r.framelen = 1.0f;
  scene.r.cfra = int(frame);
  scene.r.subframe = frame - int(frame);
  Depsgraph *depsgraph = BKE_scene_ensure_depsgraph(nullptr, &scene, nullptr);
  if (ob->constraints.first) {
    bConstraintOb *cob = BKE_constraints_make_evalob(depsgraph, &scene, ob, nullptr, CONSTRAINT_OBTYPE_OBJECT);
    BKE_constraints_solve(depsgraph, &ob->constraints, cob, frame);
    BKE_constraints_clear_evalob(cob);
  }
  return ob->object_to_world().base_ptr();
}

/* A constraint type's kernel handed to JS: given the owner's matrix and its targets' in the constraint's spaces (as
 * Blender converts them), JS writes the owner's matrix in place. */
IMPORT(constraint_unit) void constraint_unit(int type, bConstraint *con, float *owner, int targets_num, const float *targets);

static void unit_evaluate(bConstraint *con, bConstraintOb *cob, ListBaseT<bConstraintTarget> *targets)
{
  Vector<float4x4> matrices;
  for (bConstraintTarget &ct : *targets) {
    matrices.append(float4x4(ct.matrix));
  }
  constraint_unit(con->type, con, &cob->matrix[0][0], int(matrices.size()), matrices.is_empty() ? nullptr : matrices.first().base_ptr());
}

/* Whether a constraint type evaluates with JS's unit (constraint_unit) or Blender's kernel. */
EXPORT(constraint_unit_use) bool constraint_unit_use(int type, bool use)
{
  types_ensure();
  static Map<int, decltype(bConstraintTypeInfo::evaluate_constraint)> kernels;
  bConstraintTypeInfo *info = const_cast<bConstraintTypeInfo *>(BKE_constraint_typeinfo_from_type(type));
  if (!info || !info->evaluate_constraint) {
    return false;
  }
  const auto kernel = kernels.lookup_or_add(type, info->evaluate_constraint);
  info->evaluate_constraint = use ? unit_evaluate : kernel;
  return true;
}

/* A B-Bone's segments after an evaluation, as Blender's bone segment step computes them: its segments' matrices in the
 * bone's rest space, posed and at rest (bbone_segments + 1 each, column-major). */
struct BBoneSegments {
  int count;
  const float *pose;
  const float *rest;
};
EXPORT(rig_bbone_segments) const BBoneSegments *rig_bbone_segments(Rig *rig, int index)
{
  static BBoneSegments segments;
  bPoseChannel *pchan = rig->channels[index];
  if (!pchan->runtime.bbone_pose_mats) {
    BKE_pchan_bbone_segments_cache_compute({pchan, rig->bones[index]}, *rig->armature);
  }
  const bPoseChannel_Runtime &runtime = pchan->runtime;
  segments = {runtime.bbone_segments + 1, &runtime.bbone_pose_mats[0].mat[0][0], &runtime.bbone_rest_mats[0].mat[0][0]};
  return &segments;
}

