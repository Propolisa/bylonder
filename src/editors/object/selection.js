import { nodeId, deleted } from "./identity.js";
import { Matrix, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
export function createSelection(scene, objects, world) {
  const ids = new Set();
  const pivot = new TransformNode("__selectionPivot", scene);
  let baseline = null;
  // In selection order: the last is the active object.
  const nodes = () => {
    const order = new Map([...ids].map((id, i) => [id, i]));
    return objects
      .filter((n) => order.has(nodeId(n)) && !n.isDisposed() && !deleted(n) && !n.metadata?.wbLocked)
      .sort((a, b) => order.get(nodeId(a)) - order.get(nodeId(b)));
  };
  const roots = () =>
    nodes().filter(
      (n) => !nodes().some((other) => other !== n && n.isDescendantOf(other)),
    );
  // The meshes the selection outline draws (Instance::object_sync): selected objects with geometry, outside Edit Mode.
  // A selected parent (an empty or a group) outlines nothing of its children, as in Blender.
  const outlined = () => nodes().filter((n) => n.getTotalVertices?.() > 0 && !n.metadata?.editing);
  function sync() {
    for (const id of ids)
      if (!objects.some((n) => nodeId(n) === id)) ids.delete(id);
    const selected = roots();
    pivot.rotationQuaternion = null;
    pivot.rotation.setAll(0);
    pivot.scaling.setAll(1);
    pivot.position.setAll(0);
    if (selected.length === 1) {
      selected[0]
        .computeWorldMatrix(true)
        .decompose(pivot.scaling, undefined, pivot.position);
      const q = new Quaternion();
      selected[0].getWorldMatrix().decompose(undefined, q);
      pivot.rotation.copyFrom(q.toEulerAngles());
    } else if (selected.length) {
      for (const n of selected) {
        n.computeWorldMatrix(true);
        pivot.position.addInPlace(n.getAbsolutePosition());
      }
      pivot.position.scaleInPlace(1 / selected.length);
    }
    baseline = null;
  }
  function begin() {
    pivot.computeWorldMatrix(true);
    baseline = {
      inverse: pivot.getWorldMatrix().clone().invert(),
      nodes: roots().map((n) => {
        n.computeWorldMatrix(true);
        // Main's world matrix, which may differ from Babylon's by the object's kind (a camera looks along Blender's -Z).
        const main = world?.mainSync?.worldMatrix(n);
        return { node: n, world: n.getWorldMatrix().clone(), main: main && main.multiply(n.getWorldMatrix().clone().invert()), position: n.position.clone(), rotation: (n.rotationQuaternion ? n.rotationQuaternion.toEulerAngles() : n.rotation).clone(), scaling: n.scaling.clone() };
      }),
    };
  }
  // The selected objects moved by the pivot's change since begin, their locked axes kept; Main places one it holds.
  function update() {
    if (!baseline) return;
    const delta = baseline.inverse.multiply(pivot.computeWorldMatrix(true));
    for (const { node, world: start, main, ...original } of baseline.nodes) {
      const parent = node.parent?.computeWorldMatrix(true);
      let local = start.multiply(delta);
      if (parent) local = local.multiply(parent.clone().invert());
      const values = { position: new Vector3(), rotation: new Vector3(), scaling: new Vector3() }, q = new Quaternion();
      local.decompose(values.scaling, q, values.position);
      values.rotation = q.toEulerAngles();
      for (const property of Object.keys(values)) for (const axis of ["x", "y", "z"])
        if (node.metadata?.wbTransformLocks?.[property + "." + axis]) values[property][axis] = original[property][axis];
      if (main) {
        const placed = Matrix.Compose(values.scaling, Quaternion.FromEulerVector(values.rotation), values.position);
        world.mainSync.place(node, main.multiply(parent ? placed.multiply(parent) : placed));
        continue;
      }
      node.position.copyFrom(values.position);
      node.rotationQuaternion = null;
      node.rotation.copyFrom(values.rotation);
      node.scaling.copyFrom(values.scaling);
      node.computeWorldMatrix(true);
    }
  }
  return {
    pivot,
    get nodes() {
      return nodes();
    },
    get roots() {
      return roots();
    },
    get size() {
      return roots().length;
    },
    has: (n) => ids.has(nodeId(n)),
    toggle(n, add = false) {
      if (!n) {
        if (!add) ids.clear();
      } else if (add) {
        ids.has(nodeId(n)) ? ids.delete(nodeId(n)) : ids.add(nodeId(n));
      } else if (ids.has(nodeId(n))) ids.delete(nodeId(n));
      else {
        ids.clear();
        ids.add(nodeId(n));
      }
      sync();
    },
    replace(list) {
      ids.clear();
      list.forEach((n) => ids.add(nodeId(n)));
      sync();
    },
    outlined,
    sync,
    begin,
    update,
    group() {
      const list = roots();
      if (list.length < 2) return null;
      const group = new TransformNode(
        "Group." + crypto.randomUUID().slice(0, 8),
        scene,
      );
      group.metadata = { editable: true, group: true };
      group.position.copyFrom(pivot.position);
      group.computeWorldMatrix(true);
      for (const n of list) n.setParent(group);
      objects.push(group);
      this.replace([group]);
      return group;
    },
    ungroup() {
      const list = roots().filter((n) => n.metadata?.group),
        children = [];
      for (const group of list) {
        for (const child of group.getChildren(undefined, true)) {
          child.setParent(group.parent);
          children.push(child);
        }
        group.metadata.wbDeleted = true;
        group.setEnabled(false);
      }
      if (list.length) this.replace(children);
      return list.length;
    },
    dispose() {
      pivot.dispose();
    },
  };
}
