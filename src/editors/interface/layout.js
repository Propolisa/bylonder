// Blender's UILayout (UI_interface_layout.hh, as bpy exposes it) for Blender's scripts compiled by Transcrypt
// (src/bl_ui): a draw records what it lays out as a tree, which menus (ui-layout.js) and panels (layout-view.js) draw.
// The modifier panels drawn by Blender's C++ in the module record the same tree (tools/blender-port/wasm/panel-layout.cc,
// read by modifier-panel.js).
//
// A layout node is { kind, children, ...its settings }: kind is column, row, split, box, grid_flow, column_flow,
// panel (a layout panel: header and body) or root. An item node is { kind, ... }: prop, prop_enum, prop_search,
// prop_tabs_enum, operator, operator_enum, operator_menu_enum, menu, menu_contents, popover, label, separator,
// separator_spacer, or template (name and args, for Blender's templates). An item keeps the layout settings it was made
// under (use_property_split, use_property_decorate, emboss), as Blender reads them when the item is added; a layout's
// active, enabled and alert apply to all it holds, as Blender applies them when the layout ends.

import { context as bpyContext, data as bpyData } from '../../bl_ui/bpy._app.js';
import { pyArgs as args } from '../../makesrna/rna.js';

// OperatorProperties: what a script sets on an operator button; a macro's operators (props.MESH_OT_rip) have their own.
const MACRO_PART = /_OT_/;
// A collection property the scripts add items to (node.add_node's settings: props.settings.add()).
const COLLECTIONS = new Set(['settings']);
const itemCollection = () => Object.assign([], { add() { const item = {}; this.push(item); return item; } });
// A property read before it is set is an array the script sets elements of (props.constraint_axis[0] = True).
export const operatorProperties = () => new Proxy({}, {
  get: (target, key) => (MACRO_PART.test(key) ? (target[key] ??= operatorProperties())
    : COLLECTIONS.has(key) ? (target[key] ??= itemCollection()) : typeof key === 'string' ? (target[key] ??= []) : target[key]),
});
// The values a script set, without a macro's parts. Transcrypt renames Python names its runtime uses (type becomes
// py_metatype, clear py_clear); no operator property starts with py_.
const pythonName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));
export const operatorValues = (props) => Object.fromEntries(Object.entries(props)
  .filter(([key, value]) => !MACRO_PART.test(key) && !(Array.isArray(value) && !value.length))
  .map(([key, value]) => [pythonName(key), value]));

const ITEM_ARGS = {
  prop: ['data', 'property', 'text', 'text_ctxt', 'translate', 'icon', 'placeholder', 'expand', 'slider', 'toggle', 'icon_only', 'event',
    'full_event', 'emboss', 'index', 'icon_value', 'invert_checkbox'],
  prop_enum: ['data', 'property', 'value', 'text', 'text_ctxt', 'translate', 'icon'],
  prop_menu_enum: ['data', 'property', 'text', 'text_ctxt', 'translate', 'icon'],
  prop_with_popover: ['data', 'property', 'text', 'text_ctxt', 'translate', 'icon', 'icon_only', 'panel'],
  prop_with_menu: ['data', 'property', 'text', 'text_ctxt', 'translate', 'icon', 'icon_only', 'menu'],
  prop_tabs_enum: ['data', 'property', 'data_highlight', 'property_highlight', 'icon_only'],
  prop_search: ['data', 'property', 'search_data', 'search_property', 'text', 'text_ctxt', 'translate', 'icon', 'results_are_suggestions', 'item_search_property'],
  prop_decorator: ['data', 'property', 'index'],
  operator: ['operator', 'text', 'text_ctxt', 'translate', 'icon', 'emboss', 'depress', 'icon_value', 'search_weight'],
  operator_enum: ['operator', 'property', 'icon_only'],
  operator_menu_enum: ['operator', 'property', 'text', 'text_ctxt', 'translate', 'icon'],
  menu: ['menu', 'text', 'text_ctxt', 'translate', 'icon', 'icon_value'],
  menu_contents: ['menu'],
  popover: ['panel', 'text', 'text_ctxt', 'translate', 'icon', 'icon_value'],
  popover_group: ['space_type', 'region_type', 'context', 'category'],
  label: ['text', 'text_ctxt', 'translate', 'icon', 'icon_value'],
  separator: ['factor', 'type'],
  separator_spacer: [],
};
// Blender's templates by their arguments; others record their positional and keyword arguments as given.
const TEMPLATE_ARGS = {
  template_ID: ['data', 'property', 'new', 'open', 'unlink', 'filter', 'live_icon', 'text', 'text_ctxt', 'translate'],
  template_ID_preview: ['data', 'property', 'new', 'open', 'unlink', 'rows', 'cols', 'filter', 'hide_buttons'],
  template_search: ['data', 'property', 'search_data', 'search_property', 'new', 'unlink', 'text'],
  template_list: ['listtype_name', 'list_id', 'dataptr', 'propname', 'active_dataptr', 'active_propname', 'item_dyntip_propname', 'rows',
    'maxrows', 'type', 'columns', 'sort_reverse', 'sort_lock', 'filter_name'],
  template_preview: ['id', 'show_buttons', 'parent', 'slot', 'preview_id'],
  template_node_view: ['ntree', 'node', 'socket'],
  template_curve_mapping: ['data', 'property', 'type', 'levels', 'brush', 'use_negative_slope', 'show_tone'],
  template_color_ramp: ['data', 'property', 'expand'],
  template_light_linking_collection: ['context_layout', 'data', 'property'],
  template_constraints: ['use_bone_constraints'],
  template_icon: ['icon_value', 'scale'],
};

let nextId = 0;
export class UILayout {
  // Blender's layout settings, which a sub-layout starts from (its parent's) when made.
  constructor(kind = 'root', parent = null, settings = {}) {
    Object.assign(this, {
      kind, id: ++nextId, children: [], align: false,
      active: true, enabled: true, alert: false, active_default: false, activate_init: false,
      use_property_split: parent?.use_property_split ?? false, use_property_decorate: parent?.use_property_decorate ?? true,
      emboss: parent?.emboss ?? 'NORMAL', operator_context: parent?.operator_context ?? 'INVOKE_REGION_WIN',
      alignment: 'EXPAND', scale_x: 1, scale_y: 1, ui_units_x: 0, ui_units_y: 0, context: parent?.context ?? {},
      ...settings,
    });
    // Template methods Bylonder has no layout call for record their name and arguments.
    return new Proxy(this, {
      get: (target, key) => {
        if (typeof key === 'string' && key.startsWith('template_') && !(key in target)) return (...list) => target.template(key, list);
        return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      },
    });
  }

  #layout(kind, list, names) {
    const settings = args(list, names);
    const layout = new UILayout(kind, this, Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)));
    this.children.push(layout);
    return layout;
  }

  #item(kind, list, names = ITEM_ARGS[kind]) {
    // The call's arguments last: popover_group's context is the panels' context string, not the layout's.
    const item = { kind, split: this.use_property_split, decorate: this.use_property_decorate,
      emboss_layout: this.emboss, context: this.context, operator_context: this.operator_context, ...args(list, names) };
    this.children.push(item);
    return item;
  }

  row(...list) { return this.#layout('row', list, ['align', 'heading', 'heading_ctxt', 'translate']); }
  column(...list) { return this.#layout('column', list, ['align', 'heading', 'heading_ctxt', 'translate']); }
  split(...list) { return this.#layout('split', list, ['factor', 'align']); }
  // Transcrypt's name for split, which its runtime uses.
  py_split(...list) { return this.split(...list); }
  box() { return this.#layout('box', [], []); }
  column_flow(...list) { return this.#layout('column_flow', list, ['columns', 'align']); }
  grid_flow(...list) { return this.#layout('grid_flow', list, ['row_major', 'columns', 'even_columns', 'even_rows', 'align']); }
  menu_pie() { return this.#layout('column', [], []); }

  // A layout panel (UILayout.panel): its header and body, the body None while closed; `open` is the panel's state,
  // which the drawing editor keeps by idname, or a property of data (panel_prop).
  panel(...list) {
    const { idname, default_closed } = args(list, ['idname', 'default_closed']);
    return this.#panel({ idname, default_closed: !!default_closed });
  }
  panel_prop(...list) {
    const { data, property } = args(list, ['data', 'property']);
    return this.#panel({ idname: property, data, property });
  }
  #panel(settings) {
    const panel = new UILayout('panel', this, settings);
    this.children.push(panel);
    const header = new UILayout('header', panel), body = new UILayout('body', panel);
    panel.children.push(header, body);
    const open = this.context.panelOpen?.(panel) ?? !settings.default_closed;
    return [header, open ? body : null];
  }

  prop(...list) { this.#item('prop', list); }
  prop_enum(...list) { this.#item('prop_enum', list); }
  prop_menu_enum(...list) { this.#item('prop_menu_enum', list); }
  prop_with_popover(...list) { this.#item('prop_with_popover', list); }
  prop_with_menu(...list) { this.#item('prop_with_menu', list); }
  prop_tabs_enum(...list) { this.#item('prop_tabs_enum', list); }
  prop_search(...list) { this.#item('prop_search', list); }
  prop_decorator(...list) { this.#item('prop_decorator', list); }
  operator(...list) {
    const item = this.#item('operator', list);
    item.props = operatorProperties();
    return item.props;
  }
  operator_enum(...list) { this.#item('operator_enum', list); }
  operator_menu_enum(...list) { this.#item('operator_menu_enum', list); }
  menu(...list) { this.#item('menu', list); }
  menu_contents(...list) { this.#item('menu_contents', list); }
  popover(...list) { this.#item('popover', list); }
  popover_group(...list) { this.#item('popover_group', list); }
  label(...list) { this.#item('label', list); }
  separator(...list) { this.#item('separator', list); }
  separator_spacer() { this.#item('separator_spacer', []); }
  template(name, list) { this.children.push({ kind: 'template', name, ...(TEMPLATE_ARGS[name] ? args(list, TEMPLATE_ARGS[name]) : { args: list }), context: this.context, split: this.use_property_split }); }

  // Pointers for the items added after, as context members (context.modifier in a modifier's panel).
  context_pointer_set(...list) {
    const { name, data } = args(list, ['name', 'data']);
    this.context = { ...this.context, pointers: { ...this.context.pointers, [name]: data } };
  }
  context_string_set(...list) {
    const { name, value } = args(list, ['name', 'value']);
    this.context = { ...this.context, pointers: { ...this.context.pointers, [name]: value } };
  }

  // Blender's helpers on UILayout (_bpy_types.py).
  operator_menu_hold(...list) { return this.operator(...list); }
  introspect() { return []; }
  icon(data) { return data?.bl_rna?.icon ?? 'NONE'; }
  enum_item_name(data, property, identifier) { return this.context.enumItem?.(data, property, identifier)?.[1] ?? identifier; }
  enum_item_description(data, property, identifier) { return this.context.enumItem?.(data, property, identifier)?.[2] ?? ''; }
  enum_item_icon(data, property, identifier) { return this.context.enumItem?.(data, property, identifier)?.[3] ?? 'NONE'; }
}

// Whether a layout node is a layout (holds others) rather than an item.
export const isLayout = (node) => node instanceof UILayout || Array.isArray(node.children);

// bpy.context, which some scripts read in place of the context they are given, is the one being drawn with, and
// bpy.data has what its blend_data binds.
const contextKeys = new Set();
export function useContext(context) {
  contextKeys.forEach((key) => delete bpyContext[key]);
  contextKeys.clear();
  for (const key of Object.keys(context)) contextKeys.add(key);
  Object.assign(bpyContext, context);
  if (context.blend_data) Object.assign(bpyData, context.blend_data);
}
