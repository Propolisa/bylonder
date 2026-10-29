// The popups an operator's invoke opens in the module (operator_popup: wm_operators.cc's confirmations, enum menus and
// properties dialogs, and the menus Blender's code builds with popup_menu_begin to popup_menu_end), drawn by Bylonder's
// window manager.
import { createApp, h, reactive, markRaw } from 'vue';
import { openMenu } from '../editors/interface/menu.js';
import { UILayout } from '../editors/interface/layout.js';
import { LayoutView } from '../editors/interface/layout-view.js';
import '../editors/interface/layout-view.css';
import { operatorProperties } from '../makesrna/rna-bylonder.js';
import { operatorIdname } from '../makesrna/rna.js';
import { kw } from './wm-operators.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import rnaOperators from '../makesrna/rna-operators.json' with { type: 'json' };

const { exports: x, cString } = blenderModule;
// operator_popup's values, by number.
const POPUPS = [null, 'CONFIRM', 'ENUM_MENU', 'PROPS', 'LAYOUT'];
const iconName = (icon) => cString(x.ui_icon_name(icon));

// The popup the last invoke opened, cleared by asking: { type, title, text } or null.
export function takePopup() {
  const type = POPUPS[x.operator_popup()];
  return type ? { type, title: cString(x.operator_popup_title()), text: cString(x.operator_popup_text()) } : null;
}

// A popup menu's items from its recorded layout (panel-layout.cc): its operators, run with the properties Blender's
// code set on them, its labels as headings and its separators.
function layoutItems(node, run, items = []) {
  for (const child of node.children ?? []) {
    if (child.kind === 'operator') {
      const idname = operatorIdname(child.prop);
      items.push({ label: child.text ?? rnaOperators[idname]?.name ?? idname, icon: child.icon ? iconName(child.icon) : undefined, run: () => run(idname, child.properties ?? {}) });
    } else if (child.kind === 'separator') items.push('-');
    else if (child.kind === 'label') items.push({ heading: child.text });
    else layoutItems(child, run, items);
  }
  return items;
}

// Opens a popup at a client point `at`. finish(props) ends the operator waiting on it: its exec with the properties
// chosen, or cancelled with null. A popup menu's items run as run(idname, props); `enumItems(prop)` lists an enum's
// items as [identifier, name, description, icon].
export function openPopup({ type, title, text }, { idname, at, finish, run, enumItems }) {
  if (type === 'PROPS') return openPropsPopup(idname, title, at, finish);
  if (type === 'LAYOUT') {
    finish(null);
    return openMenu(layoutItems(JSON.parse(text), run), at, title);
  }
  const items = type === 'CONFIRM' ? [{ label: text, run: () => finish({}) }]
    : enumItems(text).map(([value, label, , icon]) => ({ label, icon: icon && icon !== 'NONE' ? icon : undefined, run: () => finish({ [text]: value }) }));
  let done = false;
  const menu = openMenu(items.map((item) => ({ ...item, run: () => { done = true; item.run(); } })), at, title);
  new MutationObserver((_, observer) => { if (!menu.isConnected) { observer.disconnect(); if (!done) finish(null); } }).observe(menu.parentNode ?? document.body, { childList: true });
  return menu;
}

// WM_operator_props_popup and the properties dialogs: the operator's properties, drawn by the shared layout renderer,
// with OK to run it.
function openPropsPopup(idname, title, at, finish) {
  const values = {}, state = reactive({ revision: 0 });
  const props = operatorProperties(idname, values, { update: () => { state.revision++; } });
  const popup = Object.assign(document.createElement('div'), { className: 'bl-ui wm-popup' });
  Object.assign(popup.style, { left: at.x + 'px', top: at.y + 'px' });
  const close = (run) => {
    app.unmount();
    popup.remove();
    removeEventListener('pointerdown', outside, true);
    finish(run ? { ...values } : null);
  };
  const outside = (e) => { if (!popup.contains(e.target)) close(false); };
  const ui = markRaw({ get revision() { return state.revision; }, undoPush: () => { state.revision++; }, report: () => {}, run: () => {}, supported: () => false, poll: () => false });
  const app = createApp({ render: () => {
    void state.revision;
    const layout = new UILayout('root');
    layout.label(kw({ text: title }));
    for (const name of Object.keys(rnaOperators[idname]?.properties ?? {})) layout.prop(props, name);
    return [h(LayoutView, { layout, ui }),
      h('button', { type: 'button', class: 'bl-tool flex h-unit w-full items-center justify-center rounded-md px-1.5 text-xs', onClick: () => close(true) }, 'OK')];
  } });
  app.mount(popup);
  popup.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close(false);
    if (e.key === 'Enter' && !e.target.closest('input')) close(true);
  });
  document.body.append(popup);
  addEventListener('pointerdown', outside, true);
  popup.tabIndex = -1;
  popup.focus();
}
