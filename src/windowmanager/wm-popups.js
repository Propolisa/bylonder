// The popups an operator's invoke opens in the module (operator_popup: wm_operators.cc's confirmations, enum menus and
// properties dialogs, and the menus Blender's code builds with popup_menu_begin to popup_menu_end or calls by name),
// drawn by Bylonder's window manager from the layout trees Blender's uiLayout made (ui-tree.cc).
import { createApp, h, reactive, markRaw } from 'vue';
import { openMenu } from '../editors/interface/menu.js';
import { BlockView, treeMenu } from '../editors/interface/block-view.js';
import { blenderMain } from '../bmesh/bmesh-wasm.js';
import { invokeOperator, runOperator } from './wm-operators.js';
import '../editors/interface/layout-view.css';

// The popup an operator a button or menu entry called opened (takeOperatorPopup: { type, title, text }), with the
// operator's idname and the button's values, at the event's pointer: a properties dialog is the operator invoked
// again by Bylonder's registry, which keeps it for the dialog; the others run it with the values chosen.
export function openOperatorPopup({ type, title, text, idname, values = {} }, event) {
  const at = { x: event?.clientX ?? event?.x ?? innerWidth / 2, y: event?.clientY ?? event?.y ?? innerHeight / 2 };
  const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
  if (type === 'PROPS') return invokeOperator(idname, set, { type: 'NONE', value: 'NOTHING', clientX: at.x, clientY: at.y });
  return openPopup({ type, title, text }, {
    idname, at, C: blenderMain().C,
    finish: (chosen) => chosen && runOperator(idname, { ...set, ...chosen }),
    run: (id, props) => invokeOperator(id, props, { type: 'NONE', value: 'NOTHING', clientX: at.x, clientY: at.y }),
    enumItems: (prop) => blenderMain().enumItems(idname, prop),
  });
}

// Opens a popup at a client point `at`. finish(props) ends the operator waiting on it: its exec with the properties
// chosen ({} for a properties dialog, which edits them in place), or cancelled with null. A popup menu's operators run
// as run(idname, props); `enumItems(prop)` lists an enum's items as [identifier, name, description, icon]; `C` is the
// context its buttons apply in.
export function openPopup({ type, title, text }, { idname, at, finish, run, enumItems, C }) {
  const ui = popupUI(C, run);
  if (type === 'PROPS') return openPropsPopup(title, text, at, finish, ui);
  if (type === 'LAYOUT') {
    finish(null);
    return openMenu(treeMenu(JSON.parse(text), ui), at, title);
  }
  const items = type === 'CONFIRM' ? [{ label: text, run: () => finish({}) }]
    : enumItems(text).map(([value, label, , icon]) => ({ label, icon: icon && icon !== 'NONE' ? icon : undefined, run: () => finish({ [text]: value }) }));
  let done = false;
  const menu = openMenu(items.map((item) => ({ ...item, run: () => { done = true; item.run(); } })), at, title);
  new MutationObserver((_, observer) => { if (!menu.isConnected) { observer.disconnect(); if (!done) finish(null); } }).observe(menu.parentNode ?? document.body, { childList: true });
  return menu;
}

const popupUI = (C, run, refresh = () => {}) => markRaw({ inContext: (fn) => fn(C), refresh, undoPush: refresh, report: () => {}, run });

// WM_operator_props_popup and the properties dialogs: the operator's properties as its dialog lays them out (`text`:
// { confirm, layout }), its buttons on the running operator's properties, with its confirm button, which runs it.
function openPropsPopup(title, text, at, finish, base) {
  const { confirm, layout } = JSON.parse(text), state = reactive({ revision: 0 });
  const ui = popupUI(null, base.run, () => { state.revision++; });
  ui.inContext = base.inContext;
  const popup = Object.assign(document.createElement('div'), { className: 'bl-ui wm-popup', role: 'dialog' });
  popup.setAttribute('aria-label', title);
  Object.assign(popup.style, { left: at.x + 'px', top: at.y + 'px' });
  const close = (confirmed) => {
    app.unmount();
    popup.remove();
    removeEventListener('pointerdown', outside, true);
    finish(confirmed ? {} : null);
  };
  const outside = (e) => { if (!popup.contains(e.target) && !e.target.closest?.('.bl-menu')) close(false); };
  const app = createApp({ render: () => {
    void state.revision;
    return [h('div', { class: 'wm-popup-title' }, title), h(BlockView, { tree: layout, ui }),
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
