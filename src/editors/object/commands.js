import { Mesh, TransformNode, VertexData } from "@babylonjs/core";
import { nodeId, deleted, identify } from "./identity.js";
import { rebuildMesh } from "./mesh-catalog.js";
export function createObjectCommands(world, editor, history, refresh) {
  const { scene, objects } = world;
  const roots = () => editor.selection.roots;
  const live = () => objects.filter((n) => !deleted(n));
  const unique = (base) => {
    let name = base,
      i = 1;
    while (objects.some((n) => n.name === name))
      name = base + "." + String(i++).padStart(3, "0");
    return name;
  };
  let before = () => {};
  const transaction = (fn) => {
    before();
    editor.finish(false);
    fn();
    history.commit();
    editor.reconcile();
    refresh();
  };
  const family = (node) =>
    objects.filter((n) => n === node || n.isDescendantOf(node));
  let isolated = null;
  return {
    unique,
    transaction,
    setBefore(fn) {
      before = fn;
    },
    selectAll() {
      editor.selection.replace(
        live().filter((n) => n.isEnabled() && !n.metadata?.wbLocked),
      );
      editor.reconcile();
    },
    deselect() {
      editor.selection.replace([]);
      editor.reconcile();
    },
    invert() {
      editor.selection.replace(
        live().filter(
          (n) =>
            n.isEnabled() && !n.metadata?.wbLocked && !editor.selection.has(n),
        ),
      );
      editor.reconcile();
    },
    rename(node, name) {
      if (!name?.trim()) return;
      transaction(() => {
        identify(node);
        node.name = name.trim();
      });
    },
    hide(others = false) {
      transaction(() => {
        const chosen = new Set(roots().flatMap(family));
        for (const node of live())
          if (
            others
              ? !chosen.has(node) &&
                !roots().some((n) => n.isDescendantOf(node))
              : chosen.has(node)
          )
            node.setEnabled(false);
        if (!others) editor.selection.replace([]);
      });
    },
    showAll() {
      transaction(() => live().forEach((n) => n.setEnabled(true)));
    },
    visibility(node) {
      transaction(() => node.setEnabled(!node.isEnabled(false)));
    },
    hideRender(node) {
      transaction(() => { node.metadata = { ...node.metadata, wbHideRender: !node.metadata?.wbHideRender }; });
    },
    lock(node) {
      transaction(() => {
        node.metadata = {
          ...node.metadata,
          wbLocked: !node.metadata?.wbLocked,
        };
        if ("isPickable" in node) node.isPickable = !node.metadata.wbLocked;
      });
    },
    parent(parent) {
      transaction(() => {
        for (const node of roots())
          if (node !== parent && !parent?.isDescendantOf(node))
            node.setParent(parent || null);
      });
    },
    isolate() {
      transaction(() => {
        if (isolated) {
          for (const [id, enabled] of isolated) {
            const node = objects.find((n) => nodeId(n) === id);
            if (node && !deleted(node)) node.setEnabled(enabled);
          }
          isolated = null;
        } else {
          isolated = new Map(
            live().map((n) => [nodeId(n), n.isEnabled(false)]),
          );
          const chosen = new Set(roots().flatMap(family));
          for (const n of live())
            n.setEnabled(
              chosen.has(n) || roots().some((r) => r.isDescendantOf(n)),
            );
        }
      });
    },
  };
}
