import { nodeId, deleted } from "../object/identity.js";
import { iconEl } from "../interface/icon.js";
import { menuButton, openMenu } from "../interface/menu.js";
const kindIcons = { Mesh: ["outliner_ob_mesh", "obj", "mesh_data"], Empty: ["outliner_ob_empty", "obj"], Camera: ["outliner_ob_camera", "obj", "camera_data"], Light: ["outliner_ob_light", "obj", "light_data"] };
// Outliner in View Layer display mode: Scene Collection > collections > objects, objects nested under
// their parents within the same collection. An object linked to several collections appears in each.
export function createOutliner(world, editor, commands) {
  const root = document.querySelector("#objects"),
    search = document.querySelector("#tree-search"),
    filter = document.querySelector("#tree-filter"),
    info = document.querySelector("#tree-info");
  const cols = world.collections;
  const collapsed = new Set();
  let signature = "",
    anchor = null,
    rowKeys = [];
  const editable = (node) => world.objects.includes(node);
  const kind = (node) =>
    node.getClassName?.().includes("Camera") ? "Camera"
      : node.getClassName?.().includes("Light") ? "Light"
        : node.getTotalVertices ? "Mesh" : "Empty";
  const nodes = () =>
    [...new Set([...world.objects, ...world.scene.cameras, ...world.scene.lights])]
      .filter((n) => !deleted(n) && !n.isDisposed() && !n.name.startsWith("__"));
  const rename = (node) => {
    const value = prompt("Object name", node.name);
    if (value) commands.rename(node, value);
  };
  const button = (text, title, fn, className = "") => {
    const b = document.createElement("button");
    b.append(...[text].flat());
    b.title = title;
    if (className) b.className = className;
    b.onclick = (e) => {
      e.stopPropagation();
      fn(e);
    };
    return b;
  };
  const dragIds = () => editor.selection.nodes.filter(editable).map(nodeId);
  const collectionMenu = (e, id) => {
    e.preventDefault();
    const master = id === cols.MASTER;
    openMenu([
      { label: "New Collection", icon: "collection_new", run: () => cols.create({ parent: id }) },
      ...(master ? [] : [
        { label: "Delete", blender: "outliner.delete", icon: "x", run: () => cols.remove(id) },
        "-",
        { label: "Rename", blender: "outliner.item_rename", keys: "F2", run: () => { const c = cols.byId(id), name = prompt("Collection name", c.name); if (name) cols.rename(id, name); } },
      ]),
      "-",
      { label: "Select Objects", run: () => { editor.selection.replace(cols.objects(id).map((o) => world.objects.find((n) => nodeId(n) === o)).filter((n) => n && !deleted(n) && cols.selectable(n))); editor.reconcile(); } },
      { label: "Deselect Objects", run: () => { const set = new Set(cols.objects(id)); editor.selection.replace(editor.selection.nodes.filter((n) => !set.has(nodeId(n)))); editor.reconcile(); } },
      ...(master ? [] : ["-",
        { label: "Exclude from View Layer", checked: () => cols.layerFlags(id).exclude, run: () => cols.setLayer(id, { exclude: !cols.layerFlags(id).exclude }) },
        { label: "Disable Selection", checked: () => !!cols.byId(id).hideSelect, run: () => cols.set(id, { hideSelect: !cols.byId(id).hideSelect }) },
        { label: "Disable in Viewports", checked: () => !!cols.byId(id).hideViewport, run: () => cols.set(id, { hideViewport: !cols.byId(id).hideViewport }) },
      ]),
    ], { x: e.clientX, y: e.clientY });
  };
  // Drop on a collection: move objects (Ctrl: link), or move a dragged collection into it.
  const dropOnCollection = (row, id) => {
    row.ondragover = (e) => e.preventDefault();
    row.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const collection = e.dataTransfer.getData("text/x-workbench-collection");
      if (collection) return cols.moveCollection(collection, id);
      if (e.dataTransfer.types.includes("text/x-workbench-node")) (e.ctrlKey ? cols.link : cols.move)(dragIds(), id);
    };
  };
  function refresh(force = false) {
    const all = nodes(),
      query = search.value.toLowerCase(),
      type = filter.value;
    const next =
      JSON.stringify(all.map((n) => [nodeId(n), n.name, n.parent?.uniqueId, n.isEnabled(false), n.metadata?.wbLocked, editor.selection.has(n)])) +
      JSON.stringify(cols.state) + query + type + [...collapsed].join();
    if (!force && next === signature) return;
    signature = next;
    root.replaceChildren();
    rowKeys = [];
    const matching = (n) => (!query || n.name.toLowerCase().includes(query)) && (!type || kind(n) === type);
    const rows = [];
    const byId = new Map(all.map((n) => [nodeId(n), n]));
    const objectRow = (node, depth, members, key, dim) => {
      const id = nodeId(node),
        children = all.filter((n) => n.parent === node && members.has(n)),
        included = (n) => matching(n) || all.some((c) => c.isDescendantOf(n) && members.has(c) && matching(c));
      if (!included(node)) return;
      const rowKey = key + "/" + id,
        row = document.createElement("div");
      if (children.length) rowKeys.push(rowKey);
      row.className = "object-row" + (editor.selection.has(node) ? " active" : "") + (!node.isEnabled() || dim ? " dim" : "");
      row.dataset.id = id;
      row.style.paddingLeft = depth * 12 + "px";
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-selected", String(editor.selection.has(node)));
      row.tabIndex = 0;
      const toggle = button(children.length ? iconEl(collapsed.has(rowKey) ? "disclosure_tri_right" : "disclosure_tri_down") : "", "Expand/collapse", () => {
        collapsed.has(rowKey) ? collapsed.delete(rowKey) : collapsed.add(rowKey);
        refresh();
      }, "tree-toggle");
      const [typeIcon, tint, dataIcon] = kindIcons[kind(node)];
      const name = button(
        [iconEl(typeIcon, tint), Object.assign(document.createElement("span"), { className: "tree-label", textContent: node.name }), dataIcon ? iconEl(dataIcon, "data tree-data") : ""],
        kind(node),
        (e) => {
          if (!editable(node)) {
            info.textContent = kind(node) + " · " + node.name + (node.intensity !== undefined ? " · intensity " + node.intensity : "");
            return;
          }
          if (e.shiftKey && anchor) {
            const a = rows.indexOf(anchor), b = rows.indexOf(node);
            if (a >= 0) {
              editor.selection.replace(rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter(editable));
              editor.reconcile();
              return;
            }
          }
          editor.select(node, e.ctrlKey || e.metaKey || e.shiftKey || world.multiSelect?.());
          anchor = node;
          info.textContent = kind(node) + " · " + node.name + (node.getTotalVertices ? " · " + node.getTotalVertices() + " vertices" : "");
        },
        "tree-name",
      );
      name.ondblclick = () => { if (editable(node)) rename(node); };
      row.append(toggle, name,
        button(iconEl(node.isEnabled(false) ? "hide_off" : "hide_on"), "Hide in Viewport", () => {
          if (editable(node)) commands.visibility(node);
          else { node.setEnabled(!node.isEnabled(false)); refresh(true); }
        }));
      if (editable(node))
        row.append(button(iconEl(node.metadata?.wbLocked ? "restrict_select_on" : "restrict_select_off"), "Disable Selection", () => commands.lock(node)));
      row.draggable = editable(node);
      row.ondragstart = (e) => {
        e.dataTransfer.setData("text/x-workbench-node", id);
        if (!editor.selection.has(node)) { editor.selection.replace([node]); editor.reconcile(); }
      };
      row.ondragover = (e) => { if (editable(node)) e.preventDefault(); };
      row.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (editable(node) && e.dataTransfer.types.includes("text/x-workbench-node")) commands.parent(node);
      };
      row.oncontextmenu = (e) => world.contextMenu.open(e, node);
      row.onkeydown = (e) => {
        if (e.key === "F2" && editable(node)) { e.preventDefault(); e.stopPropagation(); rename(node); }
      };
      root.append(row);
      rows.push(node);
      if (!collapsed.has(rowKey) || query) children.forEach((n) => objectRow(n, depth + 1, members, rowKey, dim));
    };
    const objectsOf = (id) => {
      const list = cols.objects(id).map((o) => byId.get(o)).filter(Boolean);
      if (id === cols.MASTER) for (const n of all) if (!editable(n)) list.push(n);
      return new Set(list);
    };
    const collectionRow = (id, depth, key, parentHidden) => {
      const c = cols.byId(id), flags = cols.layerFlags(id), rowKey = key + "/" + id,
        hidden = parentHidden || flags.hideViewport || c.hideViewport,
        row = document.createElement("div");
      rowKeys.push(rowKey);
      row.className = "object-row collection-row" + (cols.active === id ? " active-collection" : "") + (flags.exclude || hidden ? " dim" : "");
      row.style.paddingLeft = depth * 12 + "px";
      row.setAttribute("role", "treeitem");
      row.tabIndex = 0;
      const open = !collapsed.has(rowKey) && !flags.exclude;
      row.append(
        button(iconEl(open ? "disclosure_tri_down" : "disclosure_tri_right"), "Expand/collapse", () => { collapsed.has(rowKey) ? collapsed.delete(rowKey) : collapsed.add(rowKey); refresh(); }, "tree-toggle"),
        Object.assign(button(iconEl(flags.exclude ? "checkbox_dehlt" : "checkbox_hlt"), "Exclude from View Layer", () => cols.setLayer(id, { exclude: !flags.exclude })), { className: "tree-exclude" }),
      );
      const name = button([iconEl("outliner_collection"), Object.assign(document.createElement("span"), { className: "tree-label", textContent: c.name })], "Collection · click to make active", () => cols.setActive(id), "tree-name");
      name.ondblclick = () => { const value = prompt("Collection name", c.name); if (value) cols.rename(id, value); };
      row.append(name,
        button(iconEl(flags.hideViewport ? "hide_on" : "hide_off"), "Hide in Viewport (this view layer)", () => cols.setLayer(id, { hideViewport: !flags.hideViewport })),
        button(iconEl(c.hideSelect ? "restrict_select_on" : "restrict_select_off"), "Disable Selection", () => cols.set(id, { hideSelect: !c.hideSelect })));
      row.draggable = true;
      row.ondragstart = (e) => e.dataTransfer.setData("text/x-workbench-collection", id);
      dropOnCollection(row, id);
      row.oncontextmenu = (e) => collectionMenu(e, id);
      root.append(row);
      if (open || query) contents(id, depth + 1, rowKey, hidden);
    };
    const contents = (id, depth, key, hidden) => {
      for (const child of cols.byId(id).children) if (cols.byId(child)) collectionRow(child, depth, key, hidden);
      const members = objectsOf(id);
      for (const n of members) if (!members.has(n.parent)) objectRow(n, depth, members, key, hidden);
    };
    contents(cols.MASTER, 0, "", false);
    document.querySelector("#tree-count").textContent = all.length + " objects";
    document.querySelector("#tree-root")?.classList.toggle("active-collection", cols.active === cols.MASTER);
  }
  const header = world.dock?.header("objects");
  if (header) {
    const field = Object.assign(document.createElement("label"), { className: "bl-search", title: "Filter by name" });
    search.placeholder = "";
    field.append(iconEl("viewzoom"), search);
    const types = () => [["", "All"], ...[...filter.options].slice(1).map((o) => [o.value, o.textContent])].map(([value, label]) => ({ label, checked: () => filter.value === value, run: () => { filter.value = value; refresh(); } }));
    header.append(
      menuButton("", [{ label: "View Layer", icon: "outliner", checked: () => true }], { icon: "outliner", className: "bl-dropdown", title: "Display Mode" }),
      field,
      menuButton("", types, { icon: "filter", className: "bl-dropdown", title: "Filter" }),
      Object.assign(document.createElement("button"), { className: "bl-icon-button", title: "New Collection", onclick: () => cols.create() }),
    );
    header.lastChild.append(iconEl("collection_new"));
    const rootRow = document.querySelector("#tree-root");
    rootRow.replaceChildren(iconEl("outliner_collection"), Object.assign(document.createElement("span"), { textContent: "Scene Collection" }));
    rootRow.onclick = () => cols.setActive(cols.MASTER);
    rootRow.oncontextmenu = (e) => collectionMenu(e, cols.MASTER);
  }
  search.oninput = () => refresh();
  filter.onchange = () => refresh();
  // Dropping on the Scene Collection row moves objects there; dropping on empty space clears the parent.
  dropOnCollection(document.querySelector("#tree-root"), cols.MASTER);
  root.ondragover = (e) => e.preventDefault();
  root.ondrop = (e) => { if (e.target === root && e.dataTransfer.types.includes("text/x-workbench-node")) commands.parent(null); };
  document.querySelector("#tree-expand").onclick = () => { collapsed.clear(); refresh(true); };
  document.querySelector("#tree-collapse").onclick = () => { rowKeys.forEach((k) => collapsed.add(k)); refresh(true); };
  const unsubscribe = cols.subscribe(() => refresh());
  refresh();
  return { refresh, dispose() { unsubscribe(); } };
}
