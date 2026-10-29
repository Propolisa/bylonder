// The popups an operator's invoke opens in the module (operator_popup: wm_operators.cc's confirmations, enum menus and
// properties dialogs, and the menus Blender's code builds with popup_menu_begin to popup_menu_end), drawn by Bylonder's
// window manager.
import { createApp, h, reactive, markRaw } from 'vue';
import { openMenu } from '../editors/interface/menu.js';
import { LayoutView } from '../editors/interface/layout-view.js';
import '../editors/interface/layout-view.css';
import { layoutTree } from '../editors/space_buttons/modifier-panel.js';
import { moduleOperatorProperties } from '../makesrna/rna-module.js';
import { operatorIdname } from '../makesrna/rna.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import rnaOperators from '../makesrna/rna-operators.json' with { type: 'json' };

const { exports: x, cString } = blenderModule;
const iconName = (icon) => cString(x.ui_icon_name(icon));
const withIconNames = (node) => ({ ...node, ...(node.icon ? { icon: iconName(node.icon) } : {}), children: (node.children ?? []).map(withIconNames) });

// A popup menu's items from its recorded layout (panel-layout.cc): its operators, run with the properties Blender's
// code set on them, its labels as headings, its separators, and the sub-menus its code makes when opened, drawn by
// submenu(index) as their layouts.
function layoutItems(node, run, submenu, items = []) {
  for (const child of node.children ?? []) {
    if (child.kind === 'operator') {
      const idname = operatorIdname(child.prop);
      items.push({ label: child.text ?? rnaOperators[idname]?.name ?? idname, icon: child.icon ? iconName(child.icon) : undefined, run: () => run(idname, child.properties ?? {}) });
    } else if (child.kind === 'separator') items.push('-');
    else if (child.kind === 'label') items.push({ heading: child.text });
    else if (child.kind === 'menu' && child.index >= 0) {
      items.push({ label: child.text, icon: child.icon ? iconName(child.icon) : undefined, items: () => layoutItems(JSON.parse(submenu(child.index)), run, submenu) });
    } else layoutItems(child, run, submenu, items);
  }
  return items;
}

// Opens a popup at a client point `at`. finish(props) ends the operator waiting on it: its exec with the properties
// chosen ({} for a properties dialog, which edits them in place), or cancelled with null. A popup menu's items run as
// run(idname, props), its sub-menus draw as submenu(index); `enumItems(prop)` lists an enum's items as [identifier,
// name, description, icon]; `C` is the context property edits run in.
export function openPopup({ type, title, text }, { idname, at, finish, run, submenu, enumItems, C }) {
  if (type === 'PROPS') return openPropsPopup(idname, title, text, at, finish, C);
  if (type === 'LAYOUT') {
    finish(null);
    return openMenu(layoutItems(JSON.parse(text), run, submenu), at, title);
  }
  const items = type === 'CONFIRM' ? [{ label: text, run: () => finish({}) }]
    : enumItems(text).map(([value, label, , icon]) => ({ label, icon: icon && icon !== 'NONE' ? icon : undefined, run: () => finish({ [text]: value }) }));
  let done = false;
  const menu = openMenu(items.map((item) => ({ ...item, run: () => { done = true; item.run(); } })), at, title);
  new MutationObserver((_, observer) => { if (!menu.isConnected) { observer.disconnect(); if (!done) finish(null); } }).observe(menu.parentNode ?? document.body, { childList: true });
  return menu;
}

// WM_operator_props_popup and the properties dialogs: the operator's properties as the module records them (`text`:
// { confirm, layout }), bound to the running operator in the module, drawn by the shared layout renderer with its
// confirm button, which runs it.
function openPropsPopup(idname, title, text, at, finish, C) {
  const { confirm, layout } = JSON.parse(text), state = reactive({ revision: 0 });
  const changed = () => { state.revision++; };
  const data = (owner, pointer) => (pointer ? moduleOperatorProperties(idname, pointer, { C, changed }) : null);
  const popup = Object.assign(document.createElement('div'), { className: 'bl-ui wm-popup', role: 'dialog' });
  popup.setAttribute('aria-label', title);
  Object.assign(popup.style, { left: at.x + 'px', top: at.y + 'px' });
  const close = (run) => {
    app.unmount();
    popup.remove();
    removeEventListener('pointerdown', outside, true);
    finish(run ? {} : null);
  };
  const outside = (e) => { if (!popup.contains(e.target)) close(false); };
  const ui = markRaw({ get revision() { return state.revision; }, undoPush: changed, report: () => {}, run: () => {}, supported: () => false, poll: () => false });
  const tree = layoutTree(withIconNames(layout), data, idname);
  const app = createApp({ render: () => {
    void state.revision;
    return [h('div', { class: 'wm-popup-title' }, title), h(LayoutView, { layout: tree, ui }),
      h('button', { type: 'button', class: 'bl-tool flex h-unit w-full items-center justify-center rounded-md px-1.5 text-xs', onClick: () => close(true) }, confirm)];
  } });
  app.mount(popup);
  popup.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close(false);
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur?.(); setTimeout(() => close(true)); }
  });
  document.body.append(popup);
  addEventListener('pointerdown', outside, true);
  popup.tabIndex = -1;
  popup.focus();
}
