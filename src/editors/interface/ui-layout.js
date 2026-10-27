// Blender's UILayout (UI_interface_layout.hh, as bpy exposes it) for Blender's menus compiled by Transcrypt (src/bl_ui):
// drawing a menu records its entries as items for Bylonder's menus (menu.js). Arguments come as Python passes them,
// positional and then keywords. `ui` is what Bylonder supplies:
//   menus: menu classes by idname, context: () => bpy.context as the menus read it,
//   run(idname, props): runs an operator, supported(idname): whether Bylonder runs it, poll(idname): whether it can now,
//   keys(idname, props): its shortcut, if bound, enumItems(idname, prop): an enum's [identifier, name] pairs.
import rna from '../../makesrna/rna-operators.json' with { type: 'json' };

// Python's keyword arguments: Transcrypt passes them as a last object marked __kwargtrans__.
function args(list, names) {
  const last = list.at(-1), keywords = last && Object.hasOwn(last, '__kwargtrans__') ? last : {};
  const positional = keywords === last ? list.slice(0, -1) : list;
  return Object.fromEntries(names.map((name, i) => [name, keywords[name] ?? positional[i]]));
}

// OperatorProperties: what a menu sets on an entry; a macro's operators (props.MESH_OT_rip) have their own.
const MACRO_PART = /_OT_/;
const properties = () => new Proxy({}, { get: (target, key) => (MACRO_PART.test(key) ? (target[key] ??= properties()) : target[key]) });
// The values a menu set, without a macro's parts. Transcrypt renames Python names its runtime uses (type becomes
// py_metatype, clear py_clear: the aliases in Transcrypt's compiler.py); no operator property starts with py_.
const pythonName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));
const values = (props) => Object.fromEntries(Object.entries(props)
  .filter(([key]) => !MACRO_PART.test(key))
  .map(([key, value]) => [pythonName(key), value]));

const operatorName = (idname) => rna[idname]?.name ?? idname;

export class UILayout {
  constructor(ui) {
    this.ui = ui;
    this.items = [];
    this.operator_context = 'INVOKE_REGION_WIN';
  }

  // The entry reads its properties when shown and run, since the menu sets them after the operator call.
  #entry(idname, props, label, enumValue) {
    const ui = this.ui;
    return {
      label,
      blender: enumValue === undefined ? idname : `${idname}:${enumValue}`,
      get keys() { return ui.keys(idname, values(props)); },
      enabled: () => ui.poll(idname),
      run: () => ui.run(idname, values(props)),
    };
  }

  operator(...list) {
    const { operator: idname, text } = args(list, ['operator', 'text']), props = properties();
    if (this.ui.supported(idname)) this.items.push(this.#entry(idname, props, text ?? operatorName(idname)));
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
    const { menu: idname, text } = args(list, ['menu', 'text']), menu = this.ui.menus[idname];
    if (!menu) return;
    const items = () => drawMenu(idname, this.ui);
    if (items().length) this.items.push({ label: text ?? menu.bl_label, blender: idname, keys: this.ui.keys(idname), items });
  }

  separator() { this.items.push('-'); }
  label() {}
  template_node_operator_asset_menu_items() {}
  row() { return this; }
  column() { return this; }
}

// A menu's entries, separators tidied where entries Bylonder lacks left them doubled or at an end.
export function drawMenu(idname, ui) {
  const menu = ui.menus[idname](), layout = new UILayout(ui);
  menu.layout = layout;
  menu.draw(ui.context());
  return layout.items.filter((item, i, all) => item !== '-' || (i > 0 && all[i - 1] !== '-' && all.slice(i + 1).some((next) => next !== '-')));
}
