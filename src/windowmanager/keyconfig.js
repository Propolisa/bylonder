// Blender's default key configuration (keymap_data/blender_default.py, transpiled into src/bl_ui), for the shortcuts
// Blender's menus show (WM_key_event_operator_string).
import { generate_keymaps } from '../bl_ui/blender_default.js';
import { keysLabel } from './input/keymap.js';

let keymaps;
const keyconfig = () => (keymaps ??= new Map(generate_keymaps().map(([name, , { items }]) => [name, items])));

const MODIFIERS = [['shift', 'Shift'], ['ctrl', 'Ctrl'], ['alt', 'Alt'], ['oskey', 'Cmd']];
const eventText = (event) => [...MODIFIERS.filter(([key]) => event[key] === true).map(([, text]) => text), keysLabel(event.type)].join(' ');

// A menu is opened by wm.call_menu (or its pie and panel kin) with its name.
const callers = (idname) => (/_(MT|PT)_/.test(idname)
  ? [['wm.call_menu', { name: idname }], ['wm.call_menu_pie', { name: idname }], ['wm.call_panel', { name: idname }]]
  : null);

// The binding's properties agree with the ones the menu sets (IDP_EqualsProperties_ex, not strict).
const agrees = (bound, props) => (bound ?? []).every(([key, value]) => !(key in props) || props[key] === value);

// The key text of the first binding of the operator, with the menu's properties, in the named keymaps in order.
export function blenderKeys(names, idname, props = {}) {
  for (const [id, set] of callers(idname) ?? [[idname, props]]) {
    for (const name of names) {
      const item = keyconfig().get(name)?.find(([op, , data]) => op === id && agrees(data?.properties, set) &&
        (!callers(idname) || data?.properties?.some(([key, value]) => key === 'name' && value === idname)));
      if (item) return eventText(item[1]);
    }
  }
}
