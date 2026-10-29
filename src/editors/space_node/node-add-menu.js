// Blender's Add menu (NODE_MT_add and the node_add_menu_*.py menus), laid out by Blender in a Node Editor area of the
// module for the editor's tree type, its entries adding the nodes Bylonder runs: Blender's own (src/nodes/blender) and,
// appended to Blender's categories as an add-on extends them, Babylon's blocks from its editors' catalogs
// (babylon/*-blocks.js).
import { blenderMain, blenderModule } from '../../bmesh/bmesh-wasm.js';
import { registerMenu } from '../../python/bpy_interface.js';
import { pointerStruct, structFind } from '../../python/bpy_rna.js';
import { AnimArea, RGN_TYPE_WINDOW } from '../animation/anim-area.js';
import { menuTree, inMenuMode, MENU_SEARCH, MENU_POPUP } from '../interface/ui-tree.js';
import { treeMenu } from '../interface/tree-menu.js';
import { appendMenu, kw } from '../../windowmanager/wm-operators.js';

const SPACE_NODE = 16;
const TREE_TYPES = { shader: 'ShaderNodeTree', compositor: 'CompositorNodeTree' };
// Babylon's editor categories in Blender's Add menu categories.
const BABYLON_CATEGORIES = {
  shader: {
    NODE_MT_category_shader_input: ['Inputs', 'Scene', 'Mesh', 'Animation'],
    NODE_MT_category_shader_output: ['Output_Nodes'],
    NODE_MT_category_shader_shader: ['PBR'],
    NODE_MT_category_shader_texture: ['Procedural__Texture', 'Noises'],
    NODE_MT_category_shader_color: ['Color_Management'],
    NODE_MT_category_shader_math: ['Math__Standard', 'Math__Scientific', 'Round', 'Range', 'Interpolation', 'Logical', 'Conversion_Blocks'],
    NODE_MT_category_shader_vector: ['Math__Vector', 'Matrices'],
    NODE_MT_category_shader_utilities: ['Misc', 'Loop'],
  },
  compositor: {
    NODE_MT_category_compositor_input: ['Inputs', 'Rendering'],
    NODE_MT_category_compositor_output: ['Output_Nodes'],
    NODE_MT_category_compositor_filter: ['Post_Processes', 'Layers'],
    NODE_MT_category_compositor_texture: ['Textures'],
    NODE_MT_category_compositor_utilities: ['Misc'],
  },
};
const label = (name) => name.replace(/Block$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');

// A Babylon sub-menu at the end of each Blender category Babylon has blocks for, as an add-on adds its own menus.
const babylonMenus = new Set();
function addBabylonMenus(tree) {
  for (const [category, catalogs] of Object.entries(BABYLON_CATEGORIES[tree.kind])) {
    const menu = `${category}_babylon`;
    const names = catalogs.flatMap((c) => tree.catalog.categories[c] ?? []);
    if (babylonMenus.has(menu) || !names.length) continue;
    babylonMenus.add(menu);
    registerMenu(menu, 'Babylon', (layout) => { for (const name of names) layout.operator('node.add_node', kw({ text: label(name) })).type = name; });
    appendMenu(category, ({ layout }) => { layout.separator(); layout.menu(menu); });
  }
}

// A Python literal as node.add_node's settings hold them ('RGBA', 0.5, (1.0, 1.0, 1.0)).
const literal = (text) => {
  const value = String(text).trim();
  if (/^'.*'$|^".*"$/.test(value)) return value.slice(1, -1);
  if (value.startsWith('(')) return value.slice(1, -1).split(',').filter((v) => v.trim()).map(Number);
  return value === 'True' ? true : value === 'False' ? false : Number(value);
};
const settings = (list = []) => Object.fromEntries(list.map((s) => [s.name, literal(s.value)]));
const SEARCH = new Set(['WM_OT_search_single_menu', 'wm.search_single_menu']);
const buttons = (node) => (node.kind === 'button' ? [node] : (node.children ?? []).flatMap(buttons));

// The editor's Node Editor area in the module, showing its tree type, and the region contract its menus run through.
const areas = new WeakMap();
function addMenuUI(editor) {
  if (areas.has(editor)) return areas.get(editor);
  const { tree } = editor, area = new AnimArea(blenderMain(), SPACE_NODE);
  area.layout(RGN_TYPE_WINDOW, 0, 0, 800, 600);
  pointerStruct(structFind('SpaceNodeEditor'), 0, blenderModule.exports.anim_area_space(area.pointer) >>> 0).tree_type = TREE_TYPES[tree.kind];
  addBabylonMenus(tree);
  const runs = new Set([...Object.keys(tree.blenderClasses), 'NodeReroute', 'NodeFrame', ...Object.values(tree.catalog.categories).flat()]);
  const ui = {
    inContext: (fn) => area.inContext(RGN_TYPE_WINDOW, fn),
    runs: (idname) => idname === 'node.add_node' || SEARCH.has(idname),
    run: (idname, props) => (idname === 'node.add_node' ? editor.add(props.type, settings(props.settings)) : editor.openAddSearch()),
    // A node Bylonder does not run is shown greyed out.
    adjust: (menu) => buttons(menu).forEach((b) => { if (b.operator === 'node.add_node' && !runs.has(b.properties?.type)) b.disabled = true; }),
    undoPush() {},
    refresh() {},
  };
  areas.set(editor, ui);
  return ui;
}

// NODE_MT_add as Shift A opens it (wm.call_menu: a popup, which draws the Search entry).
const addMenu = (ui, mode) => inMenuMode(mode, () => ui.inContext((C) => menuTree(C, 'NODE_MT_add')) ?? { children: [] });
export function addMenuItems(editor) {
  const ui = addMenuUI(editor);
  return treeMenu(addMenu(ui, MENU_POPUP), ui);
}

// Every entry of the menu and its sub-menus, drawn as for a search (is_menu_search), with their sub-menu path.
export function addMenuEntries(editor) {
  const ui = addMenuUI(editor), entries = [];
  const visit = (items, path) => {
    for (const item of items) {
      if (item === '-' || item.heading || SEARCH.has(item.blender)) continue;
      if (item.items) visit(item.items(), [...path, item.label]);
      else entries.push({ path, item: path.includes('Babylon') ? { ...item, weight: 2 } : item });
    }
  };
  inMenuMode(MENU_SEARCH, () => visit(treeMenu(addMenu(ui, MENU_SEARCH), ui), []));
  return entries;
}
