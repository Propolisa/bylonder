import { nodeId, deleted } from "./identity.js";
import { Quaternion, TransformNode } from "@babylonjs/core";
export function createSelection(scene, objects) {
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
        return { node: n, world: n.getWorldMatrix().clone(),position:n.position.clone(),rotation:(n.rotationQuaternion?n.rotationQuaternion.toEulerAngles():n.rotation).clone(),scaling:n.scaling.clone() };
      }),
    };
  }
  function update() {
    if (!baseline) return;
    const delta = baseline.inverse.multiply(pivot.computeWorldMatrix(true));
    for (const { node, world,position,rotation,scaling } of baseline.nodes) {
      let local = world.multiply(delta);
      if (node.parent)
        local = local.multiply(
          node.parent.computeWorldMatrix(true).clone().invert(),
        );
      const q = new Quaternion();
      local.decompose(node.scaling, q, node.position);
      node.rotationQuaternion = null;
      node.rotation.copyFrom(q.toEulerAngles());
      for(const [property,original] of Object.entries({position,rotation,scaling}))for(const axis of ["x","y","z"])if(node.metadata?.wbTransformLocks?.[property+"."+axis])node[property][axis]=original[axis];
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
