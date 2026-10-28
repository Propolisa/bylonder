// Blender's Add menu (NODE_MT_add and the node_add_menu_*.py menus, compiled into src/bl_ui), its entries adding
// the nodes Bylonder runs: Blender's own (src/nodes/blender) and, appended to Blender's categories as an add-on
// extends them, Babylon's blocks from its editors' catalogs (babylon/*-blocks.js).
import * as space from '../../bl_ui/space_node.js';
import * as base from '../../bl_ui/node_add_menu.js';
import * as shaderMenus from '../../bl_ui/node_add_menu_shader.js';
import * as compositorMenus from '../../bl_ui/node_add_menu_compositor.js';
import { drawMenu, subitems } from '../interface/ui-layout.js';
import { menuClasses, kw } from '../../windowmanager/wm-operators.js';

const classes = (list) => Object.fromEntries([...list].map((cls) => [cls.bl_idname, cls]));
const menus = { ...menuClasses(space), ...classes(base.classes), ...classes(shaderMenus.add_menus), ...classes(compositorMenus.add_menus) };

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

// A Python literal as node.add_node's settings hold them ('RGBA', 0.5, (1.0, 1.0, 1.0)).
const literal = (text) => {
  const value = String(text).trim();
  if (/^'.*'$|^".*"$/.test(value)) return value.slice(1, -1);
  if (value.startsWith('(')) return value.slice(1, -1).split(',').filter((v) => v.trim()).map(Number);
  return value === 'True' ? true : value === 'False' ? false : Number(value);
};
const settings = (list = []) => Object.fromEntries([...list].map((s) => [s.py_name ?? s.name, literal(s.value)]));

export function addMenuUI(editor, { search = false } = {}) {
  const { tree } = editor, blender = new Set([...Object.keys(tree.blenderClasses), 'NodeReroute', 'NodeFrame']);
  const babylon = new Set(Object.values(tree.catalog.categories).flat());
  // A Babylon sub-menu at the end of each Blender category Babylon has blocks for, as an add-on adds its own.
  const babylonMenus = {};
  const extension = (idname) => {
    const names = (BABYLON_CATEGORIES[tree.kind][idname] ?? []).flatMap((c) => tree.catalog.categories[c] ?? []);
    if (!names.length) return undefined;
    const menu = `${idname}_babylon`;
    babylonMenus[menu] ??= Object.assign(() => ({
      draw() { for (const name of names) this.layout.operator('node.add_node', kw({ text: label(name) })).type = name; },
    }), { bl_label: 'Babylon' });
    return { prepend: [], append: [({ layout }) => { layout.separator(); layout.menu(menu); }] };
  };
  return {
    menus: new Proxy(menus, { get: (target, idname) => target[idname] ?? babylonMenus[idname] }),
    // NODE_MT_add draws its Search entry when opened as a popup, whose operator context is EXEC_REGION_WIN.
    operatorContext: 'EXEC_REGION_WIN',
    context: () => ({
      space_data: { type: 'NODE_EDITOR', tree_type: tree.kind === 'shader' ? 'ShaderNodeTree' : 'CompositorNodeTree', shader_type: 'OBJECT', id_from: null, edit_tree: null },
      engine: 'BLENDER_EEVEE', is_menu_search: search, preferences: { show_hidden_ids: false },
      blend_data: { node_groups: Object.assign([], { py_values: () => [] }) },
    }),
    extensions: extension,
    supported: (idname, props) => (idname === 'node.add_node' && (blender.has(props.type) || babylon.has(props.type))) || idname === 'WM_OT_search_single_menu',
    poll: () => true,
    keys: () => undefined,
    enumItems: () => [],
    run: (idname, props) => (idname === 'node.add_node' ? editor.add(props.type, settings(props.settings)) : editor.openAddSearch()),
  };
}

// Every entry of the menu and its sub-menus, drawn as for a search (is_menu_search), with their sub-menu path.
export function addMenuEntries(editor) {
  const entries = [];
  const visit = (items, path) => {
    for (const item of items) {
      if (item === '-' || item.heading) continue;
      if (item.items) visit(subitems(item), [...path, item.label]);
      else if (item.blender !== 'WM_OT_search_single_menu') entries.push({ path, item: path.includes('Babylon') ? { ...item, weight: 2 } : item });
    }
  };
  visit(drawMenu('NODE_MT_add', addMenuUI(editor, { search: true })), []);
  return entries;
}

export const addMenuItems = (editor) => drawMenu('NODE_MT_add', addMenuUI(editor));
