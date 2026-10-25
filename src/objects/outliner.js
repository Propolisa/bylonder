import { nodeId, deleted } from "./identity.js";
import { iconEl } from "../ui/icon.js";
import { menuButton } from "../ui/menu.js";
const kindIcons = { Collection: ["outliner_collection", ""], Mesh: ["outliner_ob_mesh", "obj", "mesh_data"], Transform: ["outliner_ob_empty", "obj"], Camera: ["outliner_ob_camera", "obj", "camera_data"], Light: ["outliner_ob_light", "obj", "light_data"] };
export function createOutliner(world, editor, commands) {
  const root = document.querySelector("#objects"),
    search = document.querySelector("#tree-search"),
    filter = document.querySelector("#tree-filter"),
    info = document.querySelector("#tree-info");
  const collapsed = new Set();
  let signature = "",
    anchor = null;
  const editable = (node) => world.objects.includes(node);
  const kind = (node) =>
    node.metadata?.group
      ? "Collection"
      : node.getClassName?.().includes("Camera")
        ? "Camera"
        : node.getClassName?.().includes("Light")
          ? "Light"
          : node.getTotalVertices
            ? "Mesh"
            : "Transform";
  const nodes = () =>
    [
      ...new Set([
        ...world.objects,
        ...world.scene.cameras,
        ...world.scene.lights,
      ]),
    ].filter((n) => !deleted(n) && !n.isDisposed() && !n.name.startsWith("__"));
  const rename = (node) => {
    const value = prompt("Object name", node.name);
    if (value) commands.rename(node, value);
  };
  const button = (text, title, fn) => {
    const b = document.createElement("button");
    b.append(...[text].flat());
    b.title = title;
    b.onclick = (e) => {
      e.stopPropagation();
      fn(e);
    };
    return b;
  };
  function refresh(force = false) {
    const all = nodes(),
      query = search.value.toLowerCase(),
      type = filter.value;
    const next =
      JSON.stringify(
        all.map((n) => [
          nodeId(n),
          n.name,
          n.parent?.uniqueId,
          n.isEnabled(false),
          n.metadata?.wbLocked,
          editor.selection.has(n),
        ]),
      ) +
      query +
      type +
      [...collapsed].join();
    if (!force && next === signature) return;
    signature = next;
    root.replaceChildren();
    const matching = (n) =>
      (!query || n.name.toLowerCase().includes(query)) &&
      (!type || kind(n) === type);
    const included = (n) =>
      matching(n) ||
      all.some((child) => child.isDescendantOf(n) && matching(child));
    const rows = [];
    const render = (node, depth) => {
      if (!included(node)) return;
      const id = nodeId(node),
        children = all.filter((n) => n.parent === node),
        row = document.createElement("div");
      row.className =
        "object-row" +
        (editor.selection.has(node) ? " active" : "") +
        (!node.isEnabled() ? " dim" : "");
      row.dataset.id = id;
      row.style.paddingLeft = depth * 12 + "px";
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-selected", String(editor.selection.has(node)));
      row.tabIndex = 0;
      const toggle = button(
        children.length ? iconEl(collapsed.has(id) ? "disclosure_tri_right" : "disclosure_tri_down") : "",
        "Expand/collapse",
        () => {
          collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
          refresh();
        },
      );
      toggle.className = "tree-toggle";
      row.append(toggle);
      const [typeIcon, tint, dataIcon] = kindIcons[kind(node)];
      const name = button(
        [iconEl(typeIcon, tint), Object.assign(document.createElement("span"), { className: "tree-label", textContent: node.name }), dataIcon ? iconEl(dataIcon, "data tree-data") : ""],
        kind(node),
        (e) => {
          if (!editable(node)) {
            info.textContent =
              kind(node) +
              " · " +
              node.name +
              (node.intensity !== undefined
                ? " · intensity " + node.intensity
                : "");
            return;
          }
          if (e.shiftKey && anchor) {
            const a = rows.indexOf(anchor),
              b = rows.indexOf(node);
            if (a >= 0) {
              editor.selection.replace(
                rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter(editable),
              );
              editor.reconcile();
              return;
            }
          }
          editor.select(node, e.ctrlKey || e.metaKey || e.shiftKey || world.multiSelect?.());
          anchor = node;
          info.textContent =
            kind(node) +
            " · " +
            node.name +
            (node.getTotalVertices
              ? " · " + node.getTotalVertices() + " vertices"
              : "");
        },
      );
      name.className = "tree-name";
      name.ondblclick = () => {
        if (editable(node)) rename(node);
      };
      row.append(name);
      row.append(
        button(iconEl(node.isEnabled(false) ? "hide_off" : "hide_on"), "Hide in Viewport", () => {
          if (editable(node)) commands.visibility(node);
          else {
            node.setEnabled(!node.isEnabled(false));
            refresh(true);
          }
        }),
      );
      if (editable(node))
        row.append(
          button(
            iconEl(node.metadata?.wbLocked ? "restrict_select_on" : "restrict_select_off"),
            "Disable Selection",
            () => commands.lock(node),
          ),
        );
      row.draggable = editable(node);
      row.ondragstart = (e) => {
        e.dataTransfer.setData("text/x-workbench-node", id);
        if (!editor.selection.has(node)) {
          editor.selection.replace([node]);
          editor.reconcile();
        }
      };
      row.ondragover = (e) => {
        if (editable(node)) e.preventDefault();
      };
      row.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          editable(node) &&
          e.dataTransfer.types.includes("text/x-workbench-node")
        )
          commands.parent(node);
      };
      row.oncontextmenu = (e) => world.contextMenu.open(e, node);
      row.onkeydown = (e) => {
        if (e.key === "F2" && editable(node)) {
          e.preventDefault();
          e.stopPropagation();
          rename(node);
        }
      };
      root.append(row);
      rows.push(node);
      if (!collapsed.has(id) || query)
        children.forEach((n) => render(n, depth + 1));
    };
    all.filter((n) => !all.includes(n.parent)).forEach((n) => render(n, 0));
    document.querySelector("#tree-count").textContent = all.length + " objects";
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
      Object.assign(document.createElement("button"), { className: "bl-icon-button", title: "New Collection from selection (Ctrl G)", onclick: () => world.objectActions?.invoke("group") }),
    );
    header.lastChild.append(iconEl("collection_new"));
    const rootRow = document.querySelector("#tree-root");
    rootRow.replaceChildren(iconEl("outliner_collection"), Object.assign(document.createElement("span"), { textContent: "Scene Collection" }));
  }
  search.oninput = () => refresh();
  filter.onchange = () => refresh();
  const unparent = document.querySelector("#tree-root");
  unparent.ondragover = (e) => e.preventDefault();
  unparent.ondrop = (e) => {
    if (e.dataTransfer.types.includes("text/x-workbench-node"))
      commands.parent(null);
  };
  document.querySelector("#tree-expand").onclick = () => {
    collapsed.clear();
    refresh(true);
  };
  document.querySelector("#tree-collapse").onclick = () => {
    nodes().forEach((n) => collapsed.add(nodeId(n)));
    refresh(true);
  };
  refresh();
  return { refresh, dispose() {} };
}
