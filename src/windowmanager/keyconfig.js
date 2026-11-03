// Blender's key configuration in the module: the keymaps events run through and the shortcuts Blender's menus show
// (WM_key_event_operator_string), read from the user key configuration Blender makes of the active preset's keymaps
// and the Preferences' edits (WM_keyconfig_update), so Keymap preferences and edits apply to the page's keymaps too.
import { keysLabel, setProperties } from './input/keymap.js';
import { invokeOperator } from './wm-operators.js';


// Each keymap's items by its name, as [idname (or a modal item), event, { properties }], as Blender's keyconfig data
// lists them (bl_keymap_utils.io), read from `source()` (the user KeyConfig, set by loadKeyconfig in wm-window.js) when
// first needed after a change.
let source = null, keymaps;
export function setKeyconfigSource(fn) {
  source = fn;
  keymaps = undefined;
}
export const keymapsChanged = () => { keymaps = undefined; };

const EVENT = ['type', 'value', 'any', 'shift', 'ctrl', 'alt', 'oskey', 'key_modifier', 'direction', 'repeat'];
// An item's operator properties set away from their defaults, a nested pointer's as a list of its own
// (_kmi_properties_to_lines_recursive).
function itemProperties(props) {
  if (!props) return null;
  const set = [];
  for (const prop of props.bl_rna.properties) {
    const name = prop.identifier;
    if (name === 'rna_type' || !props.is_property_set(name)) continue;
    const value = prop.type === 'POINTER' ? itemProperties(props[name]) : props[name];
    if (prop.type === 'POINTER' && !value?.length) continue;
    set.push([name, value?.[Symbol.iterator] && typeof value !== 'string' && !(value instanceof Set) ? Array.from(value) : value]);
  }
  return set;
}
function keymapItems(km) {
  const items = [];
  for (const kmi of km.keymap_items) {
    if (!kmi.active) continue;
    const event = Object.fromEntries(EVENT.map((key) => [key, kmi[key]]));
    items.push(km.is_modal ? [kmi.propvalue, event, null] : [kmi.idname, event, { properties: itemProperties(kmi.properties) }]);
  }
  return items;
}
const readKeymaps = (kc) => new Map([...kc.keymaps].map((km) => [km.name, keymapItems(km)]));
export const keyconfig = () => (keymaps ??= source ? readKeymaps(source()) : new Map());
// The modal keymaps' items, as the active preset's keymap data gives them (setModalKeymaps): the window manager keeps
// modal keymaps apart from the configuration's list (editor-context.cc), where RNA does not reach their items' values.
let modalKeymaps = new Map();
export function setModalKeymaps(keyconfigData) {
  modalKeymaps = new Map(keyconfigData.filter(([, args]) => args.modal).map(([name, , { items }]) => [name, items]));
}

const MODIFIERS = [['shift', 'Shift'], ['ctrl', 'Ctrl'], ['alt', 'Alt'], ['oskey', 'Cmd']];
const eventText = (event) => [...MODIFIERS.filter(([key]) => event[key] === true || event[key] === 1).map(([, text]) => text), keysLabel(event.type)].join(' ');

// A menu is opened by wm.call_menu (or its pie and panel kin) with its name.
const callers = (idname) => (/_(MT|PT)_/.test(idname)
  ? [['wm.call_menu', { name: idname }], ['wm.call_menu_pie', { name: idname }], ['wm.call_panel', { name: idname }]]
  : null);

// The binding's properties agree with the ones the menu sets (IDP_EqualsProperties_ex, not strict).
const agrees = (bound, props) => (bound ?? []).every(([key, value]) => !(key in props) || props[key] === value);

// The binding's properties are the ones given, no more and no fewer (is_strict).
const equals = (bound, props) => (bound ?? []).length === Object.keys(props).length && agrees(bound, props) &&
  (bound ?? []).every(([key]) => key in props);

// The key text of the first binding of the operator, with the menu's properties (exactly them when strict, then
// exactly those set away from their defaults, as wm_keymap_item_find tries), in the named keymaps in order.
export function blenderKeys(names, idname, props = {}, strict = false) {
  const tries = strict ? [[idname, props], [idname, setProperties(idname, props)]] : [[idname, props]];
  for (const [id, set] of callers(idname) ?? tries) {
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

// wm_eventmatch for what Bylonder's events carry: no key modifiers yet, and Cmd counted as Ctrl.
// A repeated key matches only items that take repeats; text input is any key press that types a character (`text`).
function matches(kmi, event) {
  if ((kmi.key_modifier && kmi.key_modifier !== 'NONE') || (kmi.direction && kmi.direction !== 'ANY' && kmi.direction !== event.direction)) return false;
  if (event.repeat && !kmi.repeat) return false;
  if (kmi.type === 'TEXTINPUT') return event.value === 'PRESS' && !!event.text;
  const type = event.type.toUpperCase();
  if ((KEYMAP_TYPES[kmi.type] ?? kmi.type) !== (EVENT_TYPES[type] ?? type)) return false;
  if (kmi.value !== 'ANY' && kmi.value !== event.value) return false;
  return kmi.any === true || ['shift', 'ctrl', 'alt'].every((key) => kmi[key] === KM_ANY || !!kmi[key] === !!event[key]);
}

// The item of a modal keymap ("Transform Modal Map") an event maps to, as wm_event_modalkeymap maps it: the first whose
// event matches and that `allowed(item)` lets through now (the operator's poll_modal_item), or null.
export function modalItem(name, event, allowed = () => true) {
  for (const [item, kmi] of modalKeymaps.get(name) ?? []) if (matches(kmi, event) && allowed(item)) return item;
  return null;
}

// A modal keymap's items, [identifier, event], in its order.
export const modalKeymapItems = (name) => modalKeymaps.get(name) ?? [];

// The first binding of an event in the named keymaps, in order: [idname, { properties }], or null.
export function binding(names, event) {
  for (const name of names) for (const [idname, kmi, data] of keyconfig().get(name) ?? []) if (matches(kmi, event)) return [idname, Object.fromEntries(data?.properties ?? [])];
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
        if (result === 'FINISHED|PASS_THROUGH') event.handled = true;
        if (!result || result === 'CANCELLED' || result === 'PASS_THROUGH' || result === 'FINISHED|PASS_THROUGH') continue;
        event.native?.preventDefault();
        return true;
      }
    }
    return false;
  };
}
