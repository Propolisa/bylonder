/* An armature object's pose evaluated as Blender's depsgraph evaluates it, for modules without the depsgraph
 * (constraint-api.cc): Blender's own per-bone operations (armature_update.cc, BKE_pose_eval_*), run in an order the
 * depsgraph's relations between them allow, so a constraint or an IK solver reads its target bones once they are posed.
 * BKE_pose_where_is instead poses bones in the pose's channel order, where a target later in it is read unposed. */
#include "pose-depsgraph.hh"

#include <string>

#include "BKE_action.hh"
#include "BKE_armature.hh"
#include "BKE_constraint.h"
#include "BLI_listbase.h"
#include "BLI_map.hh"
#include "BLI_set.hh"
#include "DNA_action_types.h"
#include "DNA_armature_types.h"
#include "DNA_constraint_types.h"
#include "DNA_object_types.h"

namespace blender {

namespace {

/* The depsgraph's operations of a pose (deg_builder_nodes_rig.cc DepsgraphNodeBuilder::build_rig). */
enum class Op { Init, InitIK, Local, Pose, Constraints, Ready, Done, Segments, IKSolver, PoseDone, Cleanup };

struct Graph {
  Map<std::pair<int, int>, int> nodes;
  Vector<PoseOperation> operations;
  Vector<Vector<int>> edges;

  void add(Op op, int index = -1)
  {
    nodes.add_new({int(op), index}, int(operations.size()));
    operations.append({int(op), index});
    edges.append({});
  }
  bool has(Op op, int index = -1) const { return nodes.contains({int(op), index}); }
  void relate(Op from, int from_index, Op to, int to_index)
  {
    const int *a = nodes.lookup_ptr({int(from), from_index}), *b = nodes.lookup_ptr({int(to), to_index});
    if (a && b) {
      edges[*a].append(*b);
    }
  }
};

/* The IK chains' roots each bone belongs to (deg_builder_pchanmap.cc RootPChanMap). */
struct RootMap {
  Map<std::string, Set<std::string>> roots;
  void add(const char *bone, const char *root) { roots.lookup_or_add_default(bone).add(root); }
  bool common(const char *a, const char *b) const
  {
    const Set<std::string> *ra = roots.lookup_ptr(a), *rb = roots.lookup_ptr(b);
    return ra && rb && Set<std::string>::Intersects(*ra, *rb);
  }
};

bool has_segments(const Object &ob, const bPoseChannel *pchan)
{
  const Bone *bone = pchan ? pchan->bone_get(*id_cast<const bArmature *>(ob.data)) : nullptr;
  return bone && bone->segments > 1;
}

}  // namespace

/* blender-port: deg_builder_nodes_rig.cc build_rig, build_ik_pose; deg_builder_relations_rig.cc build_rig,
 * build_ik_pose, build_inter_ik_chains; deg_builder_relations.cc build_constraints and bone_target_opcode, for a
 * pose's own bones (targets outside the armature are placed before it is evaluated). Spline IK is left out. */
Vector<PoseOperation> pose_operations(Object &ob)
{
  bPose &pose = *ob.pose;
  Map<std::string, int> index_of;
  Graph g;
  g.add(Op::Init);
  g.add(Op::InitIK);
  g.add(Op::PoseDone);
  g.add(Op::Cleanup);
  int i = 0;
  for (bPoseChannel &pchan : pose.chanbase) {
    index_of.add(pchan.name, i);
    g.add(Op::Local, i);
    g.add(Op::Pose, i);
    g.add(Op::Ready, i);
    g.add(Op::Done, i);
    if (has_segments(ob, &pchan)) {
      g.add(Op::Segments, i);
    }
    if (pchan.constraints.first) {
      g.add(Op::Constraints, i);
    }
    for (bConstraint &con : pchan.constraints) {
      if (con.type == CONSTRAINT_TYPE_KINEMATIC) {
        bPoseChannel *root = BKE_armature_ik_solver_find_root(&pchan, static_cast<bKinematicConstraint *>(con.data));
        if (root) {
          const int root_index = BLI_findindex(&pose.chanbase, root);
          if (!g.has(Op::IKSolver, root_index)) {
            g.add(Op::IKSolver, root_index);
          }
        }
      }
    }
    i++;
  }
  const auto index = [&](const char *name) { return index_of.lookup_default(name, -1); };

  g.relate(Op::Init, -1, Op::InitIK, -1);
  g.relate(Op::InitIK, -1, Op::PoseDone, -1);
  g.relate(Op::InitIK, -1, Op::Cleanup, -1);
  const bool itasc = pose.iksolver == IKSOLVER_ITASC;
  RootMap root_map;
  for (bPoseChannel &pchan : pose.chanbase) {
    for (bConstraint &con : pchan.constraints) {
      if (con.type != CONSTRAINT_TYPE_KINEMATIC || (con.flag & CONSTRAINT_DISABLE)) {
        continue;
      }
      bKinematicConstraint *data = static_cast<bKinematicConstraint *>(con.data);
      bPoseChannel *rootchan = BKE_armature_ik_solver_find_root(&pchan, data);
      if (!rootchan) {
        continue;
      }
      const int root = index(rootchan->name);
      const Op dependent = itasc ? Op::InitIK : Op::IKSolver;
      const int dependent_index = itasc ? -1 : root;
      g.relate(Op::InitIK, -1, Op::IKSolver, root);
      g.relate(Op::IKSolver, root, Op::Cleanup, -1);
      if (data->tar == &ob && data->subtarget[0]) {
        g.relate(Op::Done, index(data->subtarget), dependent, dependent_index);
        root_map.add(data->subtarget, rootchan->name);
      }
      if (data->poletar == &ob && data->polesubtarget[0]) {
        g.relate(Op::Done, index(data->polesubtarget), dependent, dependent_index);
      }
      bPoseChannel *parchan = (data->flag & CONSTRAINT_IK_TIP) ? &pchan : pchan.parent;
      root_map.add(parchan->name, rootchan->name);
      g.relate(Op::Ready, index(parchan->name), Op::IKSolver, root);
      for (int segcount = 0; parchan;) {
        if (parchan != &pchan) {
          g.relate(Op::Ready, index(parchan->name), Op::IKSolver, root);
        }
        g.relate(Op::IKSolver, root, Op::Done, index(parchan->name));
        root_map.add(parchan->name, rootchan->name);
        segcount++;
        if (segcount == data->rootbone || segcount > 255) {
          break;
        }
        parchan = parchan->parent;
      }
      g.relate(Op::IKSolver, root, Op::PoseDone, -1);
      bPoseChannel *deepest_root = nullptr;
      for (bPoseChannel *p = rootchan->parent; p && root_map.common(rootchan->name, p->name); p = p->parent) {
        deepest_root = p;
      }
      if (deepest_root) {
        g.relate(Op::Done, index(deepest_root->name), Op::IKSolver, root);
      }
    }
  }
  for (bPoseChannel &pchan : pose.chanbase) {
    const int b = index(pchan.name);
    g.relate(Op::Init, -1, Op::Local, b);
    g.relate(Op::Local, b, Op::Pose, b);
    if (pchan.parent) {
      g.relate(root_map.common(pchan.name, pchan.parent->name) ? Op::Ready : Op::Done, index(pchan.parent->name), Op::Pose, b);
    }
    if (pchan.constraints.first) {
      for (bConstraint &con : pchan.constraints) {
        ListBaseT<bConstraintTarget> targets = {};
        if (con.type == CONSTRAINT_TYPE_KINEMATIC || !BKE_constraint_targets_get(&con, &targets)) {
          continue;
        }
        for (bConstraintTarget &ct : targets) {
          if (ct.tar != &ob || !ct.subtarget[0]) {
            continue;
          }
          Op op = root_map.common(pchan.name, ct.subtarget) ? Op::Ready : Op::Done;
          if (con.type == CONSTRAINT_TYPE_ARMATURE) {
            op = Op::Done;
          }
          if (BKE_constraint_target_uses_bbone(&con, &ct) && has_segments(ob, BKE_pose_channel_find_name(&pose, ct.subtarget))) {
            op = Op::Segments;
          }
          g.relate(op, index(ct.subtarget), Op::Constraints, b);
        }
        BKE_constraint_targets_flush(&con, &targets, true);
      }
      g.relate(Op::Pose, b, Op::Constraints, b);
      g.relate(Op::Local, b, Op::Constraints, b);
      g.relate(Op::Constraints, b, Op::Ready, b);
    }
    else {
      g.relate(Op::Pose, b, Op::Ready, b);
    }
    g.relate(Op::Ready, b, Op::Done, b);
    if (g.has(Op::Segments, b)) {
      g.relate(Op::Done, b, Op::Segments, b);
      Bone *bone = pchan.bone_get(*id_cast<bArmature *>(ob.data));
      bPoseChannel *prev, *next;
      BKE_pchan_bbone_handles_get({&pchan, bone}, &prev, &next);
      if (prev) {
        const bool roll = (bone->bbone_flag & BBONE_ADD_PARENT_END_ROLL) && has_segments(ob, prev);
        g.relate(roll ? Op::Segments : Op::Done, index(prev->name), Op::Segments, b);
      }
      if (next) {
        g.relate(Op::Done, index(next->name), Op::Segments, b);
      }
      g.relate(Op::Segments, b, Op::PoseDone, -1);
      g.relate(Op::Segments, b, Op::Cleanup, -1);
    }
    else {
      g.relate(Op::Done, b, Op::PoseDone, -1);
      g.relate(Op::Done, b, Op::Cleanup, -1);
      g.relate(Op::Ready, b, Op::Cleanup, -1);
    }
  }

  /* An order the relations allow; operations in a cycle, which the depsgraph breaks somewhere, run in the order they
   * were added. */
  Vector<int> incoming(g.operations.size(), 0);
  for (const Vector<int> &to : g.edges) {
    for (const int n : to) {
      incoming[n]++;
    }
  }
  Vector<int> ready, order;
  Vector<bool> done(g.operations.size(), false);
  for (const int n : g.operations.index_range()) {
    if (!incoming[n]) {
      ready.append(n);
    }
  }
  while (order.size() < g.operations.size()) {
    if (ready.is_empty()) {
      for (const int n : g.operations.index_range()) {
        if (!done[n]) {
          ready.append(n);
          incoming[n] = 0;
          break;
        }
      }
    }
    const int n = ready.first();
    ready.remove(0);
    if (done[n]) {
      continue;
    }
    done[n] = true;
    order.append(n);
    for (const int to : g.edges[n]) {
      if (!done[to] && --incoming[to] == 0) {
        ready.append(to);
      }
    }
  }
  Vector<PoseOperation> operations;
  for (const int n : order) {
    operations.append(g.operations[n]);
  }
  return operations;
}

void pose_operations_run(Span<PoseOperation> operations, Depsgraph *depsgraph, Scene *scene, Object *ob)
{
  for (const PoseOperation &operation : operations) {
    const int i = operation.index;
    switch (Op(operation.op)) {
      case Op::Init:
        BKE_pose_eval_init(depsgraph, scene, ob);
        break;
      case Op::InitIK:
        BKE_pose_eval_init_ik(depsgraph, scene, ob);
        break;
      case Op::Pose:
        BKE_pose_eval_bone(depsgraph, scene, ob, i);
        break;
      case Op::Constraints:
        BKE_pose_constraints_evaluate(depsgraph, scene, ob, i);
        break;
      case Op::Done:
        BKE_pose_bone_done(depsgraph, ob, i);
        break;
      case Op::Segments:
        BKE_pose_eval_bbone_segments(depsgraph, ob, i);
        break;
      case Op::IKSolver:
        BKE_pose_iktree_evaluate(depsgraph, scene, ob, i);
        break;
      case Op::PoseDone:
        BKE_pose_eval_done(depsgraph, ob);
        break;
      case Op::Cleanup:
        BKE_pose_eval_cleanup(depsgraph, scene, ob);
        break;
      case Op::Local:
      case Op::Ready:
        break;
    }
  }
}

}  // namespace blender
