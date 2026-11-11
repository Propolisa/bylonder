/* An armature object's pose evaluated as Blender's depsgraph evaluates it (pose-depsgraph.cc). */
#pragma once

#include "BLI_span.hh"
#include "BLI_vector.hh"

namespace blender {

struct Depsgraph;
struct Object;
struct Scene;

/* One of the depsgraph's operations of a pose, and its pose channel's index (or its IK chain root's). */
struct PoseOperation {
  int op;
  int index;
};

/* The pose's operations in an order the depsgraph's relations allow; made again when the rig changes. */
Vector<PoseOperation> pose_operations(Object &ob);
void pose_operations_run(Span<PoseOperation> operations, Depsgraph *depsgraph, Scene *scene, Object *ob);

}  // namespace blender
