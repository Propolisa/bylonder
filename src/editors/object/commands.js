import { nodeId, deleted, identify } from "./identity.js";
export function createObjectCommands(world, editor, history, refresh) {
  const { objects } = world;
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
    rename(node, name) {
      if (!name?.trim()) return;
      transaction(() => {
        identify(node);
        if (!world.mainSync?.rename(node, name.trim())) node.name = name.trim();
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
