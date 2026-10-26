import { nodeId, deleted } from "./identity.js";
import {
  Color3,
  Matrix,
  Quaternion,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
export function createSelection(scene, objects) {
  const ids = new Set();
  const pivot = new TransformNode("__selectionPivot", scene);
  let baseline = null;
  const nodes = () =>
    objects.filter(
      (n) =>
        ids.has(nodeId(n)) &&
        !n.isDisposed() &&
        !deleted(n) &&
        !n.metadata?.wbLocked,
    );
  const roots = () =>
    nodes().filter(
      (n) => !nodes().some((other) => other !== n && n.isDescendantOf(other)),
    );
  const meshes = () => objects.filter((n) => n.getTotalVertices?.() > 0);
  function highlight() {
    for (const mesh of meshes()) {
      // Edit Mode draws its own overlay instead of the object outline, as Blender does.
      mesh.renderOutline = !mesh.metadata?.editing && nodes().some(
        (n) => mesh === n || mesh.isDescendantOf(n),
      );
      mesh.outlineColor = new Color3(1, 0.58, 0.17);
      mesh.outlineWidth = 0.035;
    }
  }
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
    highlight();
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
    highlight();
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
      for (const mesh of meshes()) mesh.renderOutline = false;
      pivot.dispose();
    },
  };
}
