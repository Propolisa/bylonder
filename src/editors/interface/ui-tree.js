// Layout trees from Blender's uiLayout in the module (tools/blender-port/wasm/ui-tree.cc): a region's panels or header,
// a menu, what a button opens; and pressing their buttons, by address, as Blender applies them. A tree's layouts are
// { kind, align, active, enabled, alert, alignment, emboss, scale_x, scale_y, w, h, children } and its buttons
// { kind: 'button', type (BUT, NUM, TOGGLE, ROW, MENU, PULLDOWN, ...), id, text, display, icon, tip, w, h, flags,
//   rna: { pointer, owner, prop, index }, value, operator, properties, menu, popover, opens }, sizes in UI units.
// A region's panels are { category, categories, panels: [{ kind: 'panel', id, text, closed, hide_header, category,
// parts: [{ part, layout }], layout_panels, children }] }. Trees stay valid until the next draw of what holds them.
import { blenderModule } from '../../bmesh/bmesh-wasm.js';
import './region-draw.js';

const { exports: x, withString, cString } = blenderModule;
const json = (pointer) => { const text = cString(pointer); return text ? JSON.parse(text) : null; };

export const regionPanels = (C) => json(x.ui_region_panels(C));
export const regionHeader = (C) => json(x.ui_region_header(C));
export const menuTree = (C, name) => withString(name, (p) => json(x.ui_menu(C, p)));
export const menuLabel = (name) => withString(name, (p) => cString(x.menu_type_label(p)));
// `fn` with the menus it lays out drawn for a menu search (the context's is_menu_search) or as a popup (wm.call_menu).
export const MENU_SEARCH = 1, MENU_POPUP = 2;
let menuMode = 0;
export function inMenuMode(mode, fn) {
  const previous = menuMode;
  x.ui_menu_mode_set(menuMode = mode);
  try {
    return fn();
  } finally {
    x.ui_menu_mode_set(menuMode = previous);
  }
}
export const buttonMenu = (C, button) => json(x.ui_button_menu(C, button.id));
export const categorySet = (C, name) => withString(name, (p) => x.ui_category_set(C, p));
export const panelClosedSet = (C, idname, closed) => withString(idname, (p) => x.ui_panel_closed_set(C, p, closed));

// A toggle flipped (or set to `value`, 0 or 1), a row button's value set, any other button's functions run.
export const buttonPress = (C, button, value = -1) => x.ui_button_press(C, button.id, value);
// What runs after a property button's value changed through RNA (its functions, its property's update).
export const buttonApplied = (C, button) => x.ui_button_applied(C, button.id);
// An operator button pressed as Blender's handlers run it: its operator with the button active; its wmOperatorStatus.
export const buttonOperator = (C, button) => x.ui_button_operator(C, button.id);
// Runs fn with the context store a button's layout gave it (its panel's point cache, its modifier) as the context's.
export function inButtonContext(C, button, fn) {
  const previous = x.ui_button_context_push(C, button.id);
  try {
    return fn();
  } finally {
    x.ui_context_store_restore(C, previous);
  }
}
export const buttonValueSet = (C, button, value) => x.ui_button_value_set(C, button.id, value);
export const buttonTextSet = (C, button, text) => withString(text, (p) => x.ui_button_text_set(C, button.id, p));
