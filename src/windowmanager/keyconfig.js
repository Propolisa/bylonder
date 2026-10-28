// Blender's default key configuration (presets/keyconfig/keymap_data/blender_default.py, in Blender's Python tree): the
// keymaps events run through and the shortcuts Blender's menus show (WM_key_event_operator_string).
import { keysLabel } from './input/keymap.js';
import { invokeOperator, kw } from './wm-operators.js';

// The key configuration Blender loads (presets/keyconfig/Blender.py's load) with its preferences' defaults: left click
// select, Space plays, fallback tools.
const PREFERENCES = {
  select_mouse: 'LEFT', use_mouse_emulate_3_button: false, spacebar_action: 'PLAY', use_key_activate_tools: false,
  use_region_toggle_pie: false, v3d_tilde_action: 'VIEW', use_v3d_mmb_pan: false, v3d_alt_mmb_drag_action: 'RELATIVE',
  use_select_all_toggle: false, use_v3d_tab_menu: false, use_v3d_shade_ex_pie: false, use_gizmo_drag: true, use_fallback_tool: true,
  use_fallback_tool_select_handled: false, use_alt_tool_or_cursor: false, use_alt_click_leader: false, use_pie_click_drag: false,
  use_file_single_click: false, use_alt_navigation: true,
};
// From the tree's module registry when first needed (python/bpy_interface.js loads the tree; it imports the operator
// registry, which imports this module).
export const defaultKeymaps = () => {
  const { generate_keymaps, Params } = globalThis.__py_modules['keyconfig.keymap_data.blender_default'];
  return generate_keymaps(Params(kw(PREFERENCES)));
};
let keymaps;
const keyconfig = () => (keymaps ??= new Map(defaultKeymaps().map(([name, , { items }]) => [name, items])));

const MODIFIERS = [['shift', 'Shift'], ['ctrl', 'Ctrl'], ['alt', 'Alt'], ['oskey', 'Cmd']];
const eventText = (event) => [...MODIFIERS.filter(([key]) => event[key] === true).map(([, text]) => text), keysLabel(event.type)].join(' ');

// A menu is opened by wm.call_menu (or its pie and panel kin) with its name.
const callers = (idname) => (/_(MT|PT)_/.test(idname)
  ? [['wm.call_menu', { name: idname }], ['wm.call_menu_pie', { name: idname }], ['wm.call_panel', { name: idname }]]
  : null);

// The binding's properties agree with the ones the menu sets (IDP_EqualsProperties_ex, not strict).
const agrees = (bound, props) => (bound ?? []).every(([key, value]) => !(key in props) || props[key] === value);

// The binding's properties are the ones given, no more and no fewer (is_strict).
const equals = (bound, props) => (bound ?? []).length === Object.keys(props).length && agrees(bound, props) &&
  (bound ?? []).every(([key]) => key in props);

// The key text of the first binding of the operator, with the menu's properties (exactly them when strict), in the
// named keymaps in order.
export function blenderKeys(names, idname, props = {}, strict = false) {
  for (const [id, set] of callers(idname) ?? [[idname, props]]) {
    for (const name of names) {
      const item = keyconfig().get(name)?.find(([op, , data]) => op === id && (strict ? equals : agrees)(data?.properties, set) &&
        (!callers(idname) || data?.properties?.some(([key, value]) => key === 'name' && value === idname)));
      if (item) return eventText(item[1]);
    }
  }
}

// Blender's event types for the window manager's (wm-event-system.js, lower case), where they differ.
const EVENT_TYPES = { SPACEBAR: 'SPACE' };
// Blender's wheel in and out are wheel up and down with the default zoom direction (wm_eventmatch).
const KEYMAP_TYPES = { WHEELINMOUSE: 'WHEELUPMOUSE', WHEELOUTMOUSE: 'WHEELDOWNMOUSE' };
const KM_ANY = -1;

// wm_eventmatch for what Bylonder's events carry: no key modifiers or drag directions yet, and Cmd counted as Ctrl.
function matches(kmi, event) {
  if (kmi.key_modifier || (kmi.direction && kmi.direction !== 'ANY')) return false;
  const type = event.type.toUpperCase();
  if ((KEYMAP_TYPES[kmi.type] ?? kmi.type) !== (EVENT_TYPES[type] ?? type)) return false;
  if (kmi.value !== 'ANY' && kmi.value !== event.value) return false;
  return kmi.any === true || ['shift', 'ctrl', 'alt'].every((key) => kmi[key] === KM_ANY || !!kmi[key] === !!event[key]);
}

// The item of a modal keymap ("Transform Modal Map") an event maps to, as wm_event_modalkeymap maps it: the first whose
// event matches and that `allowed(item)` lets through now (the operator's poll_modal_item), or null.
export function modalItem(name, event, allowed = () => true) {
  for (const [item, kmi] of keyconfig().get(name) ?? []) if (matches(kmi, event) && allowed(item)) return item;
  return null;
}

// A handler running the named keymaps in order (or those `names(event)` gives), as the editor's handlers run
// them, those `active(name)` allows: the first item whose event matches and whose operator Bylonder runs with its
// properties, and polls, is invoked; one that cancels or passes through lets the event go on. `defaults(name, idname)`
// gives properties an item's own override (a tool's settings for its keymap).
export function keymapHandler(names, active = () => true, defaults = () => ({})) {
  return (event) => {
    for (const name of (typeof names === 'function' ? names(event) : names).filter(active)) {
      for (const [idname, kmi, data] of keyconfig().get(name) ?? []) {
        if (!matches(kmi, event)) continue;
        const result = invokeOperator(idname, { ...defaults(name, idname), ...Object.fromEntries(data?.properties ?? []) }, event);
        if (!result || result === 'CANCELLED' || result === 'PASS_THROUGH') continue;
        event.native?.preventDefault();
        return true;
      }
    }
    return false;
  };
}
