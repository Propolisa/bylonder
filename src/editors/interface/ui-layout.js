// Blender's UILayout (UI_interface_layout.hh, as bpy exposes it) for Blender's menus compiled by Transcrypt (src/bl_ui):
// drawing a menu records its entries as items for Bylonder's menus (menu.js). Arguments come as Python passes them,
// positional and then keywords. `ui` is what Bylonder supplies:
//   menus: menu classes by idname, context: () => bpy.context as the menus read it,
//   run(idname, props): runs an operator, supported(idname, props): whether Bylonder runs it with those properties,
//   poll(idname): whether it can now,
//   keys(idname, props): its shortcut, if bound, enumItems(idname, prop): an enum's items as [identifier, name, description, icon].
import operators from '../../makesrna/rna-operators.json' with { type: 'json' };
import { context as bpyContext, data as bpyData } from '../../bl_ui/bpy._app.js';
import { pyArgs as args } from '../../makesrna/rna.js';
import { toolIconUrl } from './icon.js';

// OperatorProperties: what a menu sets on an entry; a macro's operators (props.MESH_OT_rip) have their own.
const MACRO_PART = /_OT_/;
// A collection property the scripts add items to (node.add_node's settings: props.settings.add()).
const COLLECTIONS = new Set(['settings']);
const collection = () => Object.assign([], { add() { const item = {}; this.push(item); return item; } });
// A property read before it is set is an array the script sets elements of (props.constraint_axis[0] = True).
const properties = () => new Proxy({}, {
  get: (target, key) => (MACRO_PART.test(key) ? (target[key] ??= properties())
    : COLLECTIONS.has(key) ? (target[key] ??= collection()) : typeof key === 'string' ? (target[key] ??= []) : target[key]),
});
// The values a menu set, without a macro's parts. Transcrypt renames Python names its runtime uses (type becomes
// py_metatype, clear py_clear: the aliases in Transcrypt's compiler.py); no operator property starts with py_.
const pythonName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));
const values = (props) => Object.fromEntries(Object.entries(props)
  .filter(([key, value]) => !MACRO_PART.test(key) && !(Array.isArray(value) && !value.length))
  .map(([key, value]) => [pythonName(key), value]));

const operatorName = (idname) => operators[idname]?.name ?? idname;
// The properties whose value names an entry in Blender's coverage ids (KEYED_PROPS in tools/blender-reference/surface.py).
const KEYED_PROPS = ['type', 'name', 'mode', 'action', 'direction', 'axis'];
const keyedId = (idname, props) => {
  const key = KEYED_PROPS.find((name) => typeof props[name] === 'string');
  return key ? `${idname}:${props[key]}` : idname;
};

export class UILayout {
  // A sub-layout (row, column, ...) adds to its parent's items; its `enabled` (which scripts set after making it)
  // applies to what it holds.
  constructor(ui, items = [], parent = null) {
    this.ui = ui;
    this.items = items;
    this.parent = parent;
    this.enabled = true;
    this.active = true;
    // A popup's layout runs operators with EXEC_REGION_WIN (ui.operatorContext), a header's with INVOKE_REGION_WIN.
    this.operator_context = parent?.operator_context ?? ui.operatorContext ?? 'INVOKE_REGION_WIN';
  }

  #enabled() { return this.enabled !== false && (this.parent?.#enabled() ?? true); }

  // The entry reads its properties when shown and run, since the menu sets them after the operator call.
  #entry(idname, props, label, enumValue, icon) {
    const ui = this.ui;
    return {
      label,
      icon: icon && icon !== 'NONE' ? icon : undefined,
      get blender() { return enumValue === undefined ? keyedId(idname, values(props)) : `${idname}:${enumValue}`; },
      supported: () => ui.supported(idname, values(props)),
      get keys() { return ui.keys(idname, values(props)); },
      enabled: () => this.#enabled() && ui.supported(idname, values(props)) && ui.poll(idname, values(props)),
      run: () => ui.run(idname, values(props)),
    };
  }

  operator(...list) {
    const { operator: idname, text, icon, icon_value } = args(list, ['operator', 'text', 'text_ctxt', 'translate', 'icon', 'emboss', 'depress', 'icon_value']);
    const props = properties(), entry = this.#entry(idname, props, text ?? operatorName(idname), undefined, icon);
    // A tool's icon, which bpy.app.icons names.
    if (typeof icon_value === 'string') entry.image = toolIconUrl(icon_value);
    this.items.push(entry);
    return props;
  }

  operator_enum(...list) {
    const { operator: idname, property } = args(list, ['operator', 'property']);
    for (const [value, label, , icon] of this.ui.enumItems(idname, property)) this.items.push(this.#entry(idname, { [property]: value }, label, value, icon));
  }

  operator_menu_enum(...list) {
    const { operator: idname, property, text } = args(list, ['operator', 'property', 'text']);
    const items = this.ui.enumItems(idname, property).map(([value, label, , icon]) => this.#entry(idname, { [property]: value }, label, value, icon));
    this.items.push({ label: text ?? operatorName(idname), blender: idname, items });
  }

  menu(...list) {
    const { menu: idname, text, icon } = args(list, ['menu', 'text', 'text_ctxt', 'translate', 'icon']), menu = this.ui.menus[idname];
    if (!menu) return;
    const items = () => drawMenu(idname, this.ui);
    this.items.push({ label: text ?? menu.bl_label, icon: icon && icon !== 'NONE' ? icon : undefined, blender: idname, keys: this.ui.keys(idname), items });
  }

  // A menu's entries in place, without a submenu.
  menu_contents(...list) {
    const { menu: idname } = args(list, ['menu']);
    if (this.ui.menus[idname]) this.items.push(...drawMenu(idname, this.ui));
  }

  // A property of data the context gives, shown as a check item when Bylonder binds it (ui.prop). A header shows the
  // property itself (`property` items: its data, name, icon and text).
  prop(...list) {
    const { data, property, text, icon, icon_only, toggle } = args(list, ['data', 'property', 'text', 'text_ctxt', 'translate', 'icon', 'placeholder', 'expand', 'slider', 'toggle', 'icon_only']);
    const binding = this.ui.prop?.(data, property);
    if (!binding) {
      if (this.ui.header && data) this.items.push({ property: { data, name: property, text, icon, iconOnly: !!icon_only, toggle: !!toggle }, active: () => this.#active(), enabled: () => this.#enabled() });
      return;
    }
    this.items.push({ label: text ?? binding.label, blender: property, keys: binding.keys, icon: icon && icon !== 'NONE' ? icon : undefined, iconOnly: !!icon_only || text === '',
      checked: () => !!binding.get(), enabled: () => this.#enabled(), run: () => binding.set(!binding.get()) });
  }
  prop_with_popover(...list) { this.prop(...list); }
  // A panel shown from a button (a header's Playback, Snapping): its label and icon, for the panel renderer to open.
  popover(...list) {
    const { panel, text, icon } = args(list, ['panel', 'text', 'text_ctxt', 'translate', 'icon']);
    if (this.ui.header) this.items.push({ popover: panel, label: text ?? '', icon: icon && icon !== 'NONE' ? icon : undefined, enabled: () => this.#enabled() });
  }
  // The header's editor type button is the area's own (the dock's).
  template_header() {}
  template_running_jobs() {}
  separator_spacer() { if (this.ui.header) this.items.push({ spacer: true }); }

  #active() { return this.active !== false && (this.parent?.#active() ?? true); }

  separator() { this.items.push('-'); }
  label() {}
  // Asset menus list node group assets, which Bylonder does not have.
  template_node_operator_asset_menu_items() {}
  template_node_asset_menu_items() {}
  template_node_operator_asset_root_items() {}
  template_modifier_asset_menu_items() {}
  row() { return new UILayout(this.ui, this.items, this); }
  column() { return new UILayout(this.ui, this.items, this); }
  split() { return new UILayout(this.ui, this.items, this); }
  // A pie menu's items, as a list.
  menu_pie() { return new UILayout(this.ui, this.items, this); }
}

// A menu's entries, separators tidied where entries Bylonder lacks left them doubled or at an end.
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

// Draw functions added to a menu (`Menu.prepend` and `Menu.append`, as add-ons extend Blender's menus) run around its
// own, with the menu as `self`.
export function drawMenu(idname, ui) {
  const menu = ui.menus[idname](), layout = new UILayout(ui), context = ui.context(), extend = ui.extensions?.(idname);
  useContext(context);
  menu.layout = layout;
  extend?.prepend.forEach((draw) => draw(menu, context));
  menu.draw(context);
  extend?.append.forEach((draw) => draw(menu, context));
  return layout.items.filter((item, i, all) => item !== '-' || (i > 0 && all[i - 1] !== '-' && all.slice(i + 1).some((next) => next !== '-')));
}

// Whether Bylonder runs an entry, or something in a submenu.
export const runs = (item) => item !== '-' && (item.items ? subitems(item).some(runs) : item.supported?.() ?? true);
export const subitems = (item) => (typeof item.items === 'function' ? item.items() : item.items);

// The Blender ids of what a menu shows that Bylonder runs, its own and its entries' and submenus', for the Blender
// coverage view.
export function menuCoverage(idname, ui) {
  const ids = new Set([idname]);
  const visit = (items) => items.filter(runs).forEach((item) => {
    ids.add(item.blender);
    if (item.items) visit(subitems(item));
  });
  visit(drawMenu(idname, ui));
  return [...ids];
}
