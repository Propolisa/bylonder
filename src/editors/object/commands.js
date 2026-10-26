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
    remove() {
      transaction(() => {
        for (const node of roots().flatMap(family)) {
          node.metadata = { ...node.metadata, wbDeleted: true };
          node.setEnabled(false);
        }
        editor.selection.replace([]);
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
    lock(node) {
      transaction(() => {
        node.metadata = {
          ...node.metadata,
          wbLocked: !node.metadata?.wbLocked,
        };
        if ("isPickable" in node) node.isPickable = !node.metadata.wbLocked;
      });
    },
    reset(property) {
      transaction(() => {
        for (const node of roots()) {
          if (property === "rotation") {
            node.rotationQuaternion = null;
            node.rotation.setAll(0);
          } else node[property].setAll(property === "scaling" ? 1 : 0);
        }
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
    duplicate() {
      const result = [];
      transaction(() => {
        const originals = [...objects];
        const copy = (source, parent) => {
          const name = unique(source.name);
          let clone;
          if (source instanceof Mesh) {
            clone = source.clone(name, parent, true);
            clone.makeGeometryUnique();
          } else {
            clone = new TransformNode(name, scene);
            clone.parent = parent;
            clone.position.copyFrom(source.position);
            clone.rotation.copyFrom(source.rotation);
            clone.rotationQuaternion =
              source.rotationQuaternion?.clone() || null;
            clone.scaling.copyFrom(source.scaling);
          }
          clone.metadata = {
            editable: true,
            wbId: crypto.randomUUID(),
            group: !!source.metadata?.group,
            ...(source.metadata?.wbModifiers?{wbModifiers:structuredClone(source.metadata.wbModifiers).map(m=>({...m,id:crypto.randomUUID()})),wbModifierBase:world.modifiers.source(source)}:{}),
            ...(source.metadata?.wbCurve?{wbCurve:structuredClone(source.metadata.wbCurve)}:{}),
          };
          // Mesh data and Blender primitives keep their recipe, which also redraws their loose edges.
          if (clone instanceof Mesh && (source.metadata?.wbCreation?.operator || source.metadata?.wbCreation?.mesh) && !source.metadata.wbModifiers)
            rebuildMesh(clone, structuredClone(source.metadata.wbCreation));
          else if (clone instanceof Mesh)
            clone.metadata.wbCreation = {
              ...(source.metadata?.wbCreation?.text ? {text:structuredClone(source.metadata.wbCreation.text)} : {}),
              vertices: world.modifiers?.source(source) || VertexData.ExtractFromMesh(clone).serialize(),
              material: clone.material?.name || null,
            };
          clone.setEnabled(true);
          clone.isPickable = true;
          objects.push(clone);
          originals
            .filter((n) => n.parent === source && !deleted(n))
            .forEach((n) => copy(n, clone));
          return clone;
        };
        for (const node of roots()) result.push(copy(node, node.parent));
        editor.selection.replace(result);
      });
      if (result.length) editor.start("move");
    },
  };
}
