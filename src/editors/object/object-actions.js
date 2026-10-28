import { nodeId } from "./identity.js";
import { openMenu } from "../interface/menu.js";
// Object Mode's actions, by the Blender operators they run (object-operators.js registers them), and Bylonder's own
// (rename, group, ungroup) for its Object menu entries.
export function createObjectActions({ world, editor, commands, creator }) {
  let pointer = { x: innerWidth / 2, y: innerHeight / 2 };
  addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }));
  const ids = () => editor.selection.nodes.filter((n) => world.objects.includes(n)).map(nodeId);
  // Popup listing the Scene Collection and its collections as an indented tree, plus New Collection.
  const collectionMenu = (title, run) => {
    const cols = world.collections, items = [{ heading: title }, { label: "Scene Collection", icon: "outliner_collection", run: () => run(ids(), cols.MASTER) }];
    const walk = (id, depth, seen) => { for (const child of cols.byId(id).children) if (cols.byId(child) && !seen.has(child)) { items.push({ label: " ".repeat(depth) + cols.byId(child).name, icon: "outliner_collection", run: () => run(ids(), child) }); walk(child, depth + 1, new Set([...seen, child])); } };
    walk(cols.MASTER, 1, new Set());
    items.push("-", { label: "New Collection", icon: "collection_new", run: () => { const name = prompt("Name", "Collection"); if (name !== null) run(ids(), cols.create({ name: name || "Collection" }).id); } });
    openMenu(items, pointer);
  };
  const active = () => editor.selection.nodes.at(-1),
    has = () => editor.selection.size > 0,
    several = () => editor.selection.size > 1;
  const rename = () => {
    const node = active();
    const name = node && prompt("Object name", node.name);
    if (name) commands.rename(node, name);
  };
  const finished = (run) => () => { creator.finish(); run(); };
  const actions = [
    { id: "duplicate", blender: "object.duplicate_move", enabled: has, run: () => commands.duplicate() },
    { id: "rename", blender: "TOPBAR_PT_name", label: "Rename…", enabled: has, run: rename },
    { id: "delete", blender: "object.delete", enabled: has, run: () => commands.remove() },
    { id: "hide", blender: "object.hide_view_set", enabled: has, run: () => commands.hide() },
    { id: "hide-others", blender: "object.hide_view_set", enabled: has, run: () => commands.hide(true) },
    { id: "show-all", blender: "object.hide_view_clear", run: () => commands.showAll() },
    { id: "isolate", blender: "view3d.localview", enabled: has, run: () => commands.isolate() },
    { id: "move-to-collection", blender: ["OBJECT_MT_move_to_collection", "object.move_to_collection"], enabled: has, run: () => collectionMenu("Move to Collection", (ids, id) => world.collections.move(ids, id)) },
    { id: "link-to-collection", blender: ["OBJECT_MT_link_to_collection", "object.link_to_collection"], enabled: has, run: () => collectionMenu("Link to Collection", (ids, id) => world.collections.link(ids, id)) },
    // Ctrl G creates the collection inside the active collection (Blender leaves it unlinked from the scene) and moves the selection into it.
    { id: "new-collection", blender: "collection.create", enabled: has, run: finished(() => world.collections.create({ objects: ids(), move: true })) },
    { id: "remove-from-collection", blender: "collection.objects_remove", enabled: has, run: () => openMenu([{ heading: "Remove from Collection" }, ...[...new Set(ids().flatMap((id) => world.collections.memberships(id)))].map((id) => ({ label: id === world.collections.MASTER ? "Scene Collection" : world.collections.byId(id).name, icon: "outliner_collection", run: () => world.collections.unlink(ids(), id) }))], pointer) },
    { id: "group", label: "Parent to New Empty", enabled: several, run: finished(() => editor.group()) },
    { id: "ungroup", label: "Clear Empty Parent", enabled: () => editor.selection.roots.some((n) => n.metadata?.group), run: finished(() => editor.ungroup()) },
    { id: "parent", blender: ["object.parent_set", "object.parent_set:OBJECT"], enabled: several, run: () => commands.parent(active()) },
    { id: "unparent", blender: ["object.parent_clear", "object.parent_clear:CLEAR"], enabled: has, run: () => commands.parent(null) },
    { id: "select-all", blender: ["object.select_all", "object.select_all:SELECT"], run: () => commands.selectAll() },
    { id: "deselect", blender: ["object.select_all", "object.select_all:DESELECT"], run: () => commands.deselect() },
    { id: "invert", blender: ["object.select_all", "object.select_all:INVERT"], run: () => commands.invert() },
  ];
  const invoke = (id) => {
    const action = actions.find((a) => a.id === id);
    if (action && (!action.enabled || action.enabled())) action.run();
  };
  return { actions, invoke };
}
