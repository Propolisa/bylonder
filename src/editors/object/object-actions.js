import { askText } from "../interface/props-dialog.js";
import { nodeId } from "./identity.js";
import { openMenu } from "../interface/menu.js";
import { runOperator } from "../../windowmanager/wm-operators.js";
// Object Mode's actions, by the Blender operators they run (object-operators.js registers them), and Bylonder's own
// (rename, group, ungroup) for its Object menu entries.
export function createObjectActions({ world, editor, commands, creator }) {
  let pointer = { x: innerWidth / 2, y: innerHeight / 2 };
  addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }));
  const ids = () => editor.selection.nodes.filter((n) => world.objects.includes(n)).map(nodeId);
  const cols = world.collections;
  // collection.objects_remove's enum: the collections the selected objects are in.
  const memberships = () => [...new Set(ids().flatMap((id) => cols.memberships(id)))]
    .map((id) => [id, id === cols.MASTER ? "Scene Collection" : cols.byId(id).name, "", "OUTLINER_COLLECTION"]);
  const active = () => editor.selection.nodes.at(-1),
    has = () => editor.selection.size > 0,
    several = () => editor.selection.size > 1;
  const rename = async () => {
    const node = active();
    const name = node && await askText("Rename Active Item", "Name", node.name, pointer);
    if (name) commands.rename(node, name);
  };
  const finished = (run) => () => { creator.finish(); run(); };
  const actions = [
    { id: "duplicate", blender: "object.duplicate_move", enabled: has, run: () => commands.duplicate() },
    { id: "rename", blender: "TOPBAR_PT_name", label: "Rename…", enabled: has, run: rename },
    { id: "hide", blender: "object.hide_view_set", enabled: has, run: () => commands.hide() },
    { id: "hide-others", blender: "object.hide_view_set", enabled: has, run: () => commands.hide(true) },
    { id: "show-all", blender: "object.hide_view_clear", run: () => commands.showAll() },
    { id: "isolate", blender: "view3d.localview", enabled: has, run: () => commands.isolate() },
    // Ctrl G creates the collection inside the active collection (Blender leaves it unlinked from the scene) and moves the selection into it.
    { id: "new-collection", blender: "collection.create", enabled: has, run: finished(() => cols.create({ objects: ids(), move: true })) },
    // Its invoke is an enum menu (WM_menu_invoke).
    { id: "remove-from-collection", blender: "collection.objects_remove", enabled: has, enumItems: memberships,
      run: ({ collection } = {}) => (collection ? cols.unlink(ids(), collection) : openMenu([{ heading: "Remove from Collection" },
        ...memberships().map(([id, label, , icon]) => ({ label, icon, blender: "collection.objects_remove", run: () => runOperator("collection.objects_remove", { collection: id }) }))], pointer)) },
    { id: "group", label: "Parent to New Empty", enabled: several, run: finished(() => editor.group()) },
    { id: "ungroup", label: "Clear Empty Parent", enabled: () => editor.selection.roots.some((n) => n.metadata?.group), run: finished(() => editor.ungroup()) },
    { id: "unparent", blender: ["object.parent_clear", "object.parent_clear:CLEAR"], enabled: has, run: () => commands.parent(null) },
    { id: "select-all", blender: ["object.select_all", "object.select_all:SELECT"], run: () => commands.selectAll() },
    { id: "deselect", blender: ["object.select_all", "object.select_all:DESELECT"], run: () => commands.deselect() },
    { id: "invert", blender: ["object.select_all", "object.select_all:INVERT"], run: () => commands.invert() },
  ];
  const invoke = (id, props) => {
    const action = actions.find((a) => a.id === id);
    if (action && (!action.enabled || action.enabled())) return action.run(props);
  };
  return { actions, invoke };
}
