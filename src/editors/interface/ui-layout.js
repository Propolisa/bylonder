// Blender's UILayout (UI_interface_layout.hh, as bpy exposes it) for Blender's menus compiled by Transcrypt (src/bl_ui):
// drawing a menu records its entries as items for Bylonder's menus (menu.js). Arguments come as Python passes them,
// positional and then keywords. `ui` is what Bylonder supplies:
//   menus: menu classes by idname, context: () => bpy.context as the menus read it,
//   run(idname, props): runs an operator, supported(idname, props): whether Bylonder runs it with those properties,
//   poll(idname): whether it can now,
//   keys(idname, props): its shortcut, if bound, enumItems(idname, prop): an enum's [identifier, name] pairs.
import names from '../../makesrna/operator-names.json' with { type: 'json' };
import { context as bpyContext, data as bpyData } from '../../bl_ui/bpy._app.js';

// Python's keyword arguments: Transcrypt passes them as a last object marked __kwargtrans__.
function args(list, names) {
  const last = list.at(-1), keywords = last && Object.hasOwn(last, '__kwargtrans__') ? last : {};
  const positional = keywords === last ? list.slice(0, -1) : list;
  return Object.fromEntries(names.map((name, i) => [name, keywords[name] ?? positional[i]]));
}

// OperatorProperties: what a menu sets on an entry; a macro's operators (props.MESH_OT_rip) have their own.
const MACRO_PART = /_OT_/;
// A property read before it is set is an array the script sets elements of (props.constraint_axis[0] = True).
const properties = () => new Proxy({}, {
  get: (target, key) => (MACRO_PART.test(key) ? (target[key] ??= properties()) : typeof key === 'string' ? (target[key] ??= []) : target[key]),
});
// The values a menu set, without a macro's parts. Transcrypt renames Python names its runtime uses (type becomes
// py_metatype, clear py_clear: the aliases in Transcrypt's compiler.py); no operator property starts with py_.
const pythonName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));
const values = (props) => Object.fromEntries(Object.entries(props)
  .filter(([key, value]) => !MACRO_PART.test(key) && !(Array.isArray(value) && !value.length))
  .map(([key, value]) => [pythonName(key), value]));

const operatorName = (idname) => names[idname] ?? idname;
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
    this.operator_context = 'INVOKE_REGION_WIN';
  }

  #enabled() { return this.enabled !== false && (this.parent?.#enabled() ?? true); }

  // The entry reads its properties when shown and run, since the menu sets them after the operator call.
  #entry(idname, props, label, enumValue, icon) {
    const ui = this.ui;
    return {
      label,
      icon: icon && icon !== 'NONE' ? icon : undefined,
      get blender() { return enumValue === undefined ? keyedId(idname, values(props)) : `${idname}:${enumValue}`; },
      available: () => ui.supported(idname, values(props)),
      get keys() { return ui.keys(idname, values(props)); },
      enabled: () => this.#enabled() && ui.poll(idname, values(props)),
      run: () => ui.run(idname, values(props)),
    };
  }

  operator(...list) {
    const { operator: idname, text, icon } = args(list, ['operator', 'text', 'text_ctxt', 'translate', 'icon']), props = properties();
    this.items.push(this.#entry(idname, props, text ?? operatorName(idname), undefined, icon));
    return props;
  }

  operator_enum(...list) {
    const { operator: idname, property } = args(list, ['operator', 'property']);
    if (!this.ui.supported(idname)) return;
    for (const [value, label] of this.ui.enumItems(idname, property)) this.items.push(this.#entry(idname, { [property]: value }, label, value));
  }

  operator_menu_enum(...list) {
    const { operator: idname, property, text } = args(list, ['operator', 'property', 'text']);
    if (!this.ui.supported(idname)) return;
    const items = this.ui.enumItems(idname, property).map(([value, label]) => this.#entry(idname, { [property]: value }, label, value));
    this.items.push({ label: text ?? operatorName(idname), blender: idname, items });
  }

  menu(...list) {
    const { menu: idname, text, icon } = args(list, ['menu', 'text', 'text_ctxt', 'translate', 'icon']), menu = this.ui.menus[idname];
    if (!menu) return;
    const items = () => drawMenu(idname, this.ui);
    if (items().length) {
      this.items.push({ label: text ?? menu.bl_label, icon: icon && icon !== 'NONE' ? icon : undefined, blender: idname, keys: this.ui.keys(idname), items });
    }
  }

  // A menu's entries in place, without a submenu.
  menu_contents(...list) {
    const { menu: idname } = args(list, ['menu']);
    if (this.ui.menus[idname]) this.items.push(...drawMenu(idname, this.ui));
  }

  // A property of data the context gives, shown as a check item when Bylonder binds it (ui.prop).
  prop(...list) {
    const { data, property, text } = args(list, ['data', 'property', 'text']), binding = this.ui.prop?.(data, property);
    if (!binding) return;
    this.items.push({ label: text ?? binding.label, blender: property, checked: () => !!binding.get(), enabled: () => this.#enabled(), run: () => binding.set(!binding.get()) });
  }

  separator() { this.items.push('-'); }
  label() {}
  // Asset menus list node group assets, which Bylonder does not have.
  template_node_operator_asset_menu_items() {}
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
function useContext(context) {
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
  const items = layout.items.filter((item) => item.available?.() !== false);
  return items.filter((item, i, all) => item !== '-' || (i > 0 && all[i - 1] !== '-' && all.slice(i + 1).some((next) => next !== '-')));
}

// The Blender ids a menu shows, its own and its entries' and submenus', for the Blender coverage view.
export function menuCoverage(idname, ui) {
  const ids = new Set([idname]);
  const visit = (items) => items.forEach((item) => {
    if (item === '-') return;
    ids.add(item.blender);
    if (item.items) visit(typeof item.items === 'function' ? item.items() : item.items);
  });
  visit(drawMenu(idname, ui));
  return [...ids];
}
