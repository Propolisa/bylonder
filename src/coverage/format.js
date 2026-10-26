export const percent = (node) => (node.total ? Math.round((node.score / node.total) * 100) + "%" : "n/a");

// Editor icons as Blender shows them in the editor type menu.
export const AREA_ICONS = {
  TOPBAR: "topbar", VIEW_3D: "view3d", OUTLINER: "outliner", PROPERTIES: "properties", TIMELINE: "time", DOPESHEET: "action",
  FCURVES: "graph", DRIVERS: "driver", NLA_EDITOR: "nla", ShaderNodeTree: "node_material", CompositorNodeTree: "node_compositing",
  GeometryNodeTree: "geometry_nodes", SEQUENCE_EDITOR: "sequence", IMAGE_EDITOR: "image", UV: "uv", TEXT_EDITOR: "text",
  CONSOLE: "console", INFO: "info", SPREADSHEET: "spreadsheet", ASSETS: "asset_manager", FILES: "filebrowser", CLIP_EDITOR: "tracker",
  PREFERENCES: "preferences",
};
export const KIND_ICONS = { mode: "object_datamode", menu: "collapsemenu", panel: "menu_panel", keymap: "keyingset", group: "file_folder" };
export const KIND_LABELS = { menu: "Menu", panel: "Panel", op: "Operator", key: "Key binding", keymap: "Keymap", group: "Group", mode: "Mode", area: "Editor" };
