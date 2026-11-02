// Blender's menu trees (ui-tree.js) as menu.js entries, and the presses their buttons make, for the editors that open
// Blender's menus; without components, so that scripts and tests can lay menus out too.
//   ui: block-view.js's region contract; `runs(idname)` may say which operators ui.run runs itself (else Bylonder's
//   registry's do), `adjust(tree)` may change a tree before its entries are made.
import { buttonMenu, buttonPress, buttonOperator, buttonSearch, buttonSearchApply, inButtonContext } from './ui-tree.js';
import { takeOperatorPopup, newOperator, blenderModule } from '../../bmesh/bmesh-wasm.js';
import { runsOperator, unavailableReason } from '../../windowmanager/wm-operators.js';

export const press = (b, ui, value = -1) => {
  ui.inContext((C) => buttonPress(C, b, value));
  ui.undoPush(b.text || b.tip || b.type);
  ui.refresh();
};

// An operator button: run by Bylonder's registry where it has the operator (with the context its layout gave the
// button), else by Blender's handlers in the module, the button active (template_ID's New assigns what it makes); a
// menu entry's (`invoke`) is called in its call context as Blender's menus call it, so its invoke runs (the File Browser,
// a confirmation) and a modal one runs in Blender's window.
const OPERATOR_FINISHED = 4;
// A button's operator properties, but rna_type, which is no value to set.
const buttonProperties = (b) => Object.fromEntries(Object.entries(b.properties ?? {}).filter(([, value]) => value !== null));
// wm::OpCallContext: the contexts before ExecDefault invoke.
const EXEC_DEFAULT = 6;
export function runOperator(b, ui, event, { invoke: inMenu = false } = {}) {
  if (ui.runs?.(b.operator) ?? runsOperator(b.operator)) {
    const invoke = (b.context ?? EXEC_DEFAULT) < EXEC_DEFAULT;
    const at = { type: 'NONE', value: 'NOTHING', clientX: event?.clientX ?? event?.x, clientY: event?.clientY ?? event?.y, shiftKey: event?.shiftKey,
      ctrlKey: event?.ctrlKey, altKey: event?.altKey, metaKey: event?.metaKey, invoke };
    return ui.inContext((C) => inButtonContext(C, b, () => ui.run(b.operator, buttonProperties(b), at)));
  }
  const status = ui.inContext((C) => (inMenu ? callOperator(C, b) : buttonOperator(C, b)));
  // The popup its invoke opened (a properties dialog, a confirmation): the page's (wm-popups.js).
  const popup = takeOperatorPopup();
  if (popup) import('../../windowmanager/wm-popups.js').then(({ openOperatorPopup }) => openOperatorPopup({ ...popup, idname: b.operator, values: buttonProperties(b) }, event));
  return status & OPERATOR_FINISHED ? ui.undoPush(b.tip || b.operator) : ui.refresh();
}

// A menu entry's module operator run as bpy.ops runs one (WM_operator_call_py) in the entry's call context, its button's
// context store the context's; one that does not poll does nothing.
function callOperator(C, b) {
  const op = newOperator(b.operator, buttonProperties(b));
  try {
    return Math.max(0, inButtonContext(C, b, () => blenderModule.exports.bpy_operator_call(C, op, b.context ?? 0)));
  } finally {
    blenderModule.exports.operator_free(op);
  }
}

// The editor type menu's items (Area.ui_type's) choose the area's editor, which the page's screen lays out
// (screen/dock.js): an `editor-type` event from the menu's button asks it whether it has the editor (`available`) or to
// show it (`choose`).
function editorType(owner, label, choose) {
  const detail = { label, choose, available: false };
  owner.dispatchEvent(new CustomEvent('editor-type', { bubbles: true, detail }));
  return detail.available;
}

// A menu tree's items as menu.js entries: operators, toggles and enum items, labels as headings, separators and
// sub-menus, opened when shown. `editorTypeOwner`: the editor type button that opened it.
export function treeMenu(tree, ui, editorTypeOwner) {
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
        if (editorTypeOwner) {
          items.push({ label: text, icon: iconName, title: node.tip, keys: shortcut, enabled: () => editorType(editorTypeOwner, text, false), run: () => editorType(editorTypeOwner, text, true) });
          break;
        }
        const unavailable = node.operator && unavailableReason(node.operator);
        items.push({
          label: text, icon: iconName, title: unavailable || node.tip, blender: node.operator,
          enabled: () => !node.disabled && !unavailable,
          ...(['TOGGLE', 'TOGGLE_N', 'ICON_TOGGLE', 'ICON_TOGGLE_N', 'CHECKBOX', 'CHECKBOX_N', 'ROW'].includes(node.type) && { checked: () => !!node.selected }),
          ...(node.operator && { keys: shortcut ?? ui.keys?.(node.operator, node.properties ?? {}) }),
          run: (event) => (node.operator ? runOperator(node, ui, event, { invoke: true }) : press(node, ui)),
        });
    }
  };
  visit(tree);
  return items.filter((item, i, all) => item !== '-' || (i > 0 && all[i - 1] !== '-' && i < all.length - 1));
}

// A search popup's tree (an ID selector's, template_common_search_menu: its search button over the space for its items)
// as menu.js's `find`: the items Blender's search gives for what is typed, the one chosen applied; else null.
export function treeSearch(tree, ui) {
  const buttons = (node) => (node.kind === 'button' ? [node] : (node.children ?? []).flatMap(buttons));
  const search = buttons(tree).find((b) => b.type === 'SEARCH_MENU' && !b.search);
  if (!search) return null;
  return (query) => ui.inContext((C) => buttonSearch(C, search, query)).map((item, index) => ({
    label: item.name.split('|')[0], icon: item.icon && item.icon !== 'NONE' ? item.icon : undefined, active: item.active,
    enabled: () => !item.disabled,
    run: () => {
      ui.inContext((C) => buttonSearchApply(C, search, query, index));
      ui.undoPush(search.tip || item.name);
      ui.refresh();
    },
  }));
}
