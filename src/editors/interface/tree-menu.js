// Blender's menu trees (ui-tree.js) as menu.js entries, and the presses their buttons make, for the editors that open
// Blender's menus; without components, so that scripts and tests can lay menus out too.
//   ui: block-view.js's region contract; `runs(idname)` may say which operators ui.run runs itself (else Bylonder's
//   registry's do), `adjust(tree)` may change a tree before its entries are made.
import { buttonMenu, buttonPress, buttonOperator } from './ui-tree.js';
import { runsOperator } from '../../windowmanager/wm-operators.js';

export const press = (b, ui, value = -1) => {
  ui.inContext((C) => buttonPress(C, b, value));
  ui.undoPush(b.text || b.tip || b.type);
  ui.refresh();
};

// An operator button: run by Bylonder's registry where it has the operator, else by Blender's handlers in the module,
// the button active (template_ID's New assigns what it makes).
const OPERATOR_FINISHED = 4;
export function runOperator(b, ui, event) {
  if (ui.runs?.(b.operator) ?? runsOperator(b.operator)) return ui.run(b.operator, b.properties ?? {}, event);
  const status = ui.inContext((C) => buttonOperator(C, b));
  return status & OPERATOR_FINISHED ? ui.undoPush(b.tip || b.operator) : ui.refresh();
}

// A menu tree's items as menu.js entries: operators, toggles and enum items, labels as headings, separators and
// sub-menus, opened when shown.
export function treeMenu(tree, ui) {
  ui.adjust?.(tree);
  const items = [];
  const visit = (node) => {
    if (node.kind !== 'button') return node.children?.forEach(visit);
    // A menu's entry shows its shortcut after UI_SEP_CHAR (ui_menu_block_set_keymaps).
    const [text, shortcut] = (node.text || node.display || '').split('|');
    const iconName = node.icon && node.icon !== 'NONE' ? node.icon : undefined;
    switch (node.type) {
      case 'SEPR': case 'SEPR_LINE': items.push('-'); break;
      case 'SEPR_SPACER': break;
      case 'LABEL': if (text) items.push({ heading: text }); break;
      case 'PULLDOWN': case 'MENU': case 'POPOVER': case 'BLOCK':
        items.push({ label: text, icon: iconName, blender: node.menu, items: () => treeMenu(ui.inContext((C) => buttonMenu(C, node)) ?? { children: [] }, ui) });
        break;
      default:
        items.push({
          label: text, icon: iconName, title: node.tip, blender: node.operator,
          enabled: () => !node.disabled,
          ...(['TOGGLE', 'TOGGLE_N', 'ICON_TOGGLE', 'ICON_TOGGLE_N', 'CHECKBOX', 'CHECKBOX_N', 'ROW'].includes(node.type) && { checked: () => !!node.selected }),
          ...(node.operator && { keys: shortcut ?? ui.keys?.(node.operator, node.properties ?? {}) }),
          run: (event) => (node.operator ? runOperator(node, ui, event) : press(node, ui)),
        });
    }
  };
  visit(tree);
  return items.filter((item, i, all) => item !== '-' || (i > 0 && all[i - 1] !== '-' && i < all.length - 1));
}
