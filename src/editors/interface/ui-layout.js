// Blender's menus compiled by Transcrypt (src/bl_ui), drawn into Blender's UILayout (layout.js, the layout panels draw
// into too) and read as entries for Bylonder's menus (menu.js). `ui` is what Bylonder supplies:
//   menus: menu classes by idname, context: () => bpy.context as the menus read it,
//   run(idname, props): runs an operator, supported(idname, props): whether Bylonder runs it with those properties,
//   poll(idname): whether it can now, operatorContext: the layout's starting operator context (EXEC_REGION_WIN in a
//   popup), keys(idname, props): its shortcut, if bound, enumItems(idname, prop): an enum's items as
//   [identifier, name, description, icon], prop(data, name): a bound property as { label, get, set }.
import operators from '../../makesrna/rna-operators.json' with { type: 'json' };
import { UILayout, isLayout, operatorValues, useContext } from './layout.js';

const operatorName = (idname) => operators[idname]?.name ?? idname;
// The properties whose value names an entry in Blender's coverage ids (KEYED_PROPS in tools/blender-reference/surface.py).
const KEYED_PROPS = ['type', 'name', 'mode', 'action', 'direction', 'axis'];
const keyedId = (idname, props) => {
  const key = KEYED_PROPS.find((name) => typeof props[name] === 'string');
  return key ? `${idname}:${props[key]}` : idname;
};
const iconOf = (icon) => (icon && icon !== 'NONE' ? icon : undefined);

// An operator's entry; it reads its properties when shown and run, since the menu sets them after the operator call.
function entry(ui, enabled, idname, props, label, icon, enumValue) {
  return {
    label,
    icon: iconOf(icon),
    get blender() { return enumValue === undefined ? keyedId(idname, operatorValues(props)) : `${idname}:${enumValue}`; },
    supported: () => ui.supported(idname, operatorValues(props)),
    get keys() { return ui.keys(idname, operatorValues(props)); },
    enabled: () => enabled && ui.supported(idname, operatorValues(props)) && ui.poll(idname, operatorValues(props)),
    run: () => ui.run(idname, operatorValues(props)),
  };
}

// A layout's items as menu entries, in order, through its rows and columns; a layout's `enabled` applies to all it holds.
function entries(node, ui, enabled = true) {
  if (isLayout(node)) return node.children.flatMap((child) => entries(child, ui, enabled && node.enabled !== false));
  const enumEntries = () => ui.enumItems(node.operator, node.property).map(([value, label, , icon]) => entry(ui, enabled, node.operator, { [node.property]: value }, label, icon, value));
  switch (node.kind) {
    case 'operator': return [entry(ui, enabled, node.operator, node.props, node.text ?? operatorName(node.operator), node.icon)];
    case 'operator_enum': return enumEntries();
    case 'operator_menu_enum': return [{ label: node.text ?? operatorName(node.operator), blender: node.operator, items: enumEntries() }];
    case 'menu': {
      const menu = ui.menus[node.menu];
      return menu ? [{ label: node.text ?? menu.bl_label, icon: iconOf(node.icon), blender: node.menu, keys: ui.keys(node.menu), items: () => drawMenu(node.menu, ui) }] : [];
    }
    case 'menu_contents': return ui.menus[node.menu] ? drawMenu(node.menu, ui) : [];
    // A property of data the context gives, shown as a check item when Bylonder binds it (ui.prop).
    case 'prop': {
      const binding = ui.prop?.(node.data, node.property);
      return binding ? [{ label: node.text ?? binding.label, blender: node.property, checked: () => !!binding.get(), enabled: () => enabled, run: () => binding.set(!binding.get()) }] : [];
    }
    case 'separator': return ['-'];
    // Labels, and the asset menus' node group assets, which Bylonder does not have.
    default: return [];
  }
}

// A menu's entries, separators tidied where entries Bylonder lacks left them doubled or at an end.
// Draw functions added to a menu (`Menu.prepend` and `Menu.append`, as add-ons extend Blender's menus) run around its
// own, with the menu as `self`.
export function drawMenu(idname, ui) {
  const menu = ui.menus[idname](), context = ui.context(), extend = ui.extensions?.(idname);
  const layout = new UILayout('root', null, { operator_context: ui.operatorContext ?? 'INVOKE_REGION_WIN' });
  useContext(context);
  menu.layout = layout;
  extend?.prepend.forEach((draw) => draw(menu, context));
  menu.draw(context);
  extend?.append.forEach((draw) => draw(menu, context));
  return entries(layout, ui).filter((item, i, all) => item !== '-' || (i > 0 && all[i - 1] !== '-' && all.slice(i + 1).some((next) => next !== '-')));
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
