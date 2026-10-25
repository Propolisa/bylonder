import { nodeId } from "./identity.js";
import { openMenu } from "../ui/menu.js";
export function createObjectActions({
  world,
  editor,
  commands,
  creator,
  inspect,
  history,
  nav,
}) {
  let target = null,
    pointer = { x: innerWidth / 2, y: innerHeight / 2 };
  addEventListener("pointermove", (e) => (pointer = { x: e.clientX, y: e.clientY }));
  const ids = () => editor.selection.nodes.filter((n) => world.objects.includes(n)).map(nodeId);
  // Popup listing the Scene Collection and its collections as an indented tree, plus New Collection.
  const collectionMenu = (title, run) => {
    const cols = world.collections, items = [{ heading: title }, { label: "Scene Collection", icon: "outliner_collection", run: () => run(ids(), cols.MASTER) }];
    const walk = (id, depth, seen) => { for (const child of cols.byId(id).children) if (cols.byId(child) && !seen.has(child)) { items.push({ label: "\u2003".repeat(depth) + cols.byId(child).name, icon: "outliner_collection", run: () => run(ids(), child) }); walk(child, depth + 1, new Set([...seen, child])); } };
    walk(cols.MASTER, 1, new Set());
    items.push("-", { label: "New Collection", icon: "collection_new", run: () => { const name = prompt("Name", "Collection"); if (name !== null) run(ids(), cols.create({ name: name || "Collection" }).id); } });
    openMenu(items, pointer);
  };
  const active = () => editor.selection.nodes.at(-1),
    has = () => editor.selection.size > 0;
  const rename = () => {
    const node = active();
    if (node) {
      const name = prompt("Object name", node.name);
      if (name) commands.rename(node, name);
    }
  };
  const actions = [
    {id:"add-array",label:"Add Array Modifier",keys:[],section:"Modifiers",enabled:()=>!!active()?.getTotalVertices?.(),run:()=>world.modifiers.add(active(),"ARRAY")},
    {id:"undo",label:"Undo",keys:[],section:"History",run:()=>{creator.finish();editor.finish(false);history.undo();editor.reconcile();}},
    {id:"redo",label:"Redo",keys:[],section:"History",run:()=>{creator.finish();editor.finish(false);history.redo();editor.reconcile();}},
    {id:"creation",label:"Last Creation Settings",keys:[],section:"Create",run:()=>creator.reopen()},
    {id:"frame",label:"Frame Selected",keys:[],section:"View",enabled:has,run:()=>nav.frame(editor.selected)},

    {id:"edit-text",label:"Edit Text…",keys:["Tab"],section:"Text",enabled:()=>!!active()?.metadata?.wbCreation?.text,run:()=>creator.editText(active())},
    {
      id: "add",
      label: "Add Object…",
      keys: ["Shift+A"],
      section: "Create",
      run: () => creator.show(),
    },
    {
      id: "duplicate",
      label: "Duplicate",
      keys: ["Shift+D"],
      section: "Object",
      enabled: has,
      run: () => commands.duplicate(),
    },
    {
      id: "rename",
      label: "Rename…",
      keys: ["F2"],
      section: "Object",
      enabled: has,
      run: rename,
    },
    {
      id: "delete",
      label: "Delete",
      keys: ["Delete", "X"],
      section: "Object",
      enabled: has,
      run: () => commands.remove(),
    },
    {
      id: "move",
      label: "Move",
      keys: [],
      section: "Transform",
      enabled: has,
      run: () => {
        creator.finish();
        editor.start("move");
      },
    },
    {
      id: "rotate",
      label: "Rotate",
      keys: [],
      section: "Transform",
      enabled: has,
      run: () => {
        creator.finish();
        editor.start("rotate");
      },
    },
    {
      id: "scale",
      label: "Scale",
      keys: [],
      section: "Transform",
      enabled: has,
      run: () => {
        creator.finish();
        editor.start("scale");
      },
    },
    {
      id: "clear-location",
      label: "Clear Location",
      keys: ["Alt+G"],
      section: "Transform",
      enabled: has,
      run: () => commands.reset("position"),
    },
    {
      id: "clear-rotation",
      label: "Clear Rotation",
      keys: ["Alt+R"],
      section: "Transform",
      enabled: has,
      run: () => commands.reset("rotation"),
    },
    {
      id: "clear-scale",
      label: "Clear Scale",
      keys: ["Alt+S"],
      section: "Transform",
      enabled: has,
      run: () => commands.reset("scaling"),
    },
    {
      id: "visibility",
      label: "Toggle Visibility",
      keys: [],
      section: "Visibility",
      enabled: () => !!target,
      run: () => {
        if (world.objects.includes(target)) commands.visibility(target);
        else {
          target.setEnabled(!target.isEnabled(false));
          world.outliner.refresh(true);
        }
      },
    },
    {
      id: "hide",
      label: "Hide Selected",
      keys: ["H"],
      section: "Visibility",
      enabled: has,
      run: () => commands.hide(),
    },
    {
      id: "hide-others",
      label: "Hide Unselected",
      keys: ["Shift+H"],
      section: "Visibility",
      enabled: has,
      run: () => commands.hide(true),
    },
    {
      id: "show-all",
      label: "Show All",
      keys: ["Alt+H"],
      section: "Visibility",
      run: () => commands.showAll(),
    },
    {
      id: "isolate",
      label: "Toggle Local View",
      keys: ["/"],
      section: "Visibility",
      enabled: has,
      run: () => commands.isolate(),
    },
    // Blender's collection operators. Ctrl+G creates the collection inside the active collection (Blender leaves
    // it unlinked from the scene) and moves the selection into it.
    {id:"move-to-collection",label:"Move to Collection",keys:["M"],section:"Collection",enabled:has,run:()=>collectionMenu("Move to Collection",(ids,id)=>world.collections.move(ids,id))},
    {id:"link-to-collection",label:"Link to Collection",keys:["Shift+M"],section:"Collection",enabled:has,run:()=>collectionMenu("Link to Collection",(ids,id)=>world.collections.link(ids,id))},
    {id:"new-collection",label:"Create New Collection",keys:["Ctrl+G"],section:"Collection",enabled:has,run:()=>{creator.finish();world.collections.create({objects:ids(),move:true});}},
    {id:"remove-from-collection",label:"Remove from Collection",keys:["Ctrl+Alt+G"],section:"Collection",enabled:has,run:()=>openMenu([{heading:"Remove from Collection"},...[...new Set(ids().flatMap(id=>world.collections.memberships(id)))].map(id=>({label:id===world.collections.MASTER?"Scene Collection":world.collections.byId(id).name,icon:"outliner_collection",run:()=>world.collections.unlink(ids(),id)}))],pointer)},
    {
      id: "group",
      label: "Parent to New Empty",
      keys: [],
      section: "Hierarchy",
      enabled: () => editor.selection.size > 1,
      run: () => {
        creator.finish();
        editor.group();
      },
    },
    {
      id: "ungroup",
      label: "Clear Empty Parent",
      keys: [],
      section: "Hierarchy",
      enabled: () => editor.selection.roots.some((n) => n.metadata?.group),
      run: () => {
        creator.finish();
        editor.ungroup();
      },
    },
    {
      id: "parent",
      label: "Parent to Active",
      keys: ["Ctrl+P"],
      section: "Hierarchy",
      enabled: () => editor.selection.size > 1,
      run: () => commands.parent(active()),
    },
    {
      id: "unparent",
      label: "Clear Parent",
      keys: ["Alt+P"],
      section: "Hierarchy",
      enabled: has,
      run: () => commands.parent(null),
    },
    {
      id: "select-all",
      label: "Select All",
      keys: ["A"],
      section: "Selection",
      run: () => commands.selectAll(),
    },
    {
      id: "deselect",
      label: "Deselect All",
      keys: ["Alt+A"],
      section: "Selection",
      run: () => commands.deselect(),
    },
    {
      id: "invert",
      label: "Invert Selection",
      keys: ["Ctrl+I"],
      section: "Selection",
      run: () => commands.invert(),
    },
    {
      id: "inspect",
      label: "Babylon Inspector",
      keys: [],
      section: "Inspect",
      run: inspect,
    },
  ];
  const invoke = (id) => {
    const action = actions.find((a) => a.id === id);
    if (action && (!action.enabled || action.enabled())) action.run();
  };
  const key = (e) => {
    const token = [
      e.ctrlKey || e.metaKey ? "Ctrl" : null,
      e.altKey ? "Alt" : null,
      e.shiftKey ? "Shift" : null,
      e.key.length === 1 ? e.key.toUpperCase() : e.key,
    ]
      .filter(Boolean)
      .join("+");
    const action = actions.find((a) => a.keys.includes(token));
    if (!action) return false;
    e.preventDefault();
    invoke(action.id);
    return true;
  };
  return {
    actions,
    invoke,
    key,
    setTarget(node) {
      target = node;
    },
  };
}
export function createObjectContextMenu(world, editor, registry) {
  const menu = document.querySelector("#object-context");
  const close = () => {
    menu.hidden = true;
  };
  const open = (event, node) => {
    event.preventDefault();
    if (editor.modal) return;
    world.beforeSelection?.();
    if (node && world.objects.includes(node) && !editor.selection.has(node)) {
      editor.selection.replace([node]);
      editor.reconcile();
    } else if (!node || !world.objects.includes(node)) {
      editor.selection.replace([]);
      editor.reconcile();
    }
    registry.setTarget(node);
    menu.replaceChildren();
    const title = document.createElement("div");
    title.className = "context-title";
    title.textContent = node?.name || "Scene";
    menu.append(title);
    let section;
    for (const action of registry.actions) {
      if (section !== action.section) {
        section = action.section;
        const heading = document.createElement("div");
        heading.className = "context-section";
        heading.textContent = section;
        menu.append(heading);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      const label = document.createElement("span"),
        key = document.createElement("kbd");
      label.textContent = action.label;
      key.textContent = action.keys[0] || "";
      button.append(label, key);
      button.disabled = action.enabled ? !action.enabled() : false;
      button.onclick = () => {
        close();
        registry.invoke(action.id);
      };
      menu.append(button);
    }
    menu.hidden = false;
    const height = Math.min(menu.scrollHeight, innerHeight - 16);
    menu.style.left =
      Math.max(8, Math.min(event.clientX, innerWidth - 240)) + "px";
    menu.style.top =
      Math.max(8, Math.min(event.clientY, innerHeight - height - 8)) + "px";
    menu.querySelector("button:not(:disabled)")?.focus();
  };
  const dismiss = (e) => {
    if (!menu.contains(e.target)) close();
  };
  const key = (e) => {
    if (menu.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement);
      buttons[
        (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length
      ]?.focus();
    }
  };
  window.addEventListener("pointerdown", dismiss);
  menu.addEventListener("keydown", key);
  return {
    open,
    close,
    get isOpen() {
      return !menu.hidden;
    },
    dispose() {
      window.removeEventListener("pointerdown", dismiss);
      menu.removeEventListener("keydown", key);
    },
  };
}
