// Key bindings in Blender's terms: `keys` as Blender shows them ("Shift D", "Ctrl Numpad 1", "LEFTMOUSE CLICK_DRAG",
// "Any LEFT_CTRL RELEASE"), `blender` the operator, menu or modal item they run, so scripts/blender-coverage.mjs
// can count them. Events are window manager events (wm-event-system.js): { type, value, shift, ctrl, alt, oskey }.
import { runOperator } from '../wm-operators.js';

const MODIFIERS = ['shift', 'ctrl', 'alt', 'oskey'];
const VALUES = { press: 'PRESS', release: 'RELEASE', click: 'CLICK', click_drag: 'CLICK_DRAG', drag: 'CLICK_DRAG', double_click: 'DOUBLE_CLICK', double: 'DOUBLE_CLICK', any_value: 'ANY' };
const ALIASES = {
  enter: 'ret', return: 'ret', delete: 'del', escape: 'esc', backspace: 'back_space', space: 'spacebar', cmd: 'oskey', meta: 'oskey', control: 'ctrl', option: 'alt',
  '.': 'period', '/': 'slash', ',': 'comma', '-': 'minus', '=': 'equal', wheelinmouse: 'wheelupmouse', wheeloutmouse: 'wheeldownmouse',
};
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const NUMPAD = { '.': 'period', '+': 'plus', '-': 'minus', '/': 'slash', '*': 'asterix' };

// Splits keys into { combo, value, any }. The combo keeps a drag or double click (Blender shows them in key text);
// the value tells press, release and click apart for dispatch.
export function parseKeys(keys) {
  const text = keys.toLowerCase().replace(/\b(left|right)[ _](ctrl|shift|alt|oskey)\b/g, '$1_$2');
  let tokens = text.split(/\s+|(?<=\S)\+(?=\S)/).filter(Boolean).map((t) => (MODIFIERS.includes(ALIASES[t]) ? ALIASES[t] : t));
  // "Any" first means any modifiers; last, any value ("Any LEFT_SHIFT ANY").
  const any = tokens[0] === 'any';
  if (any) tokens.shift();
  let value = 'PRESS';
  if (tokens.length > 1 && tokens.at(-1) === 'any') { value = 'ANY'; tokens.pop(); }
  tokens = tokens.filter((t) => {
    if (VALUES[t]) { value = VALUES[t]; return false; }
    return true;
  });
  const rest = tokens.filter((t) => !MODIFIERS.includes(t));
  const key = rest[0] === 'numpad' ? 'numpad_' + (NUMPAD[rest[1]] ?? rest[1])
    : rest.length === 1 ? ALIASES[rest[0]] ?? (/^\d$/.test(rest[0]) ? DIGITS[rest[0]] : rest[0])
    : rest.join('_');
  const shown = value === 'CLICK_DRAG' ? ['drag'] : value === 'DOUBLE_CLICK' ? ['double'] : [];
  return { combo: [...(any ? ['any'] : []), ...MODIFIERS.filter((m) => tokens.includes(m)), ...shown, key].join(' '), value, any, key };
}

// The combo as the Coverage view compares it with Blender's key text.
export const normalizeKeys = (keys) => parseKeys(keys).combo;

// A binding as Blender's menus show it: "Ctrl Numpad +" for "Ctrl NUMPAD_PLUS", the first of several.
const KEY_LABELS = { NUMPAD_PLUS: 'Numpad +', NUMPAD_MINUS: 'Numpad -', NUMPAD_PERIOD: 'Numpad .', RET: 'Return', ESC: 'Esc', DEL: 'Delete' };
export const keysLabel = (keys) => [keys].flat()[0]?.split(' ')
  .map((token) => KEY_LABELS[token] ?? (/^[A-Z][A-Z0-9_]+$/.test(token) ? token.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') : token))
  .join(' ') ?? '';

const CODES = {
  NumpadDecimal: 'numpad_period', NumpadAdd: 'numpad_plus', NumpadSubtract: 'numpad_minus', NumpadDivide: 'numpad_slash', NumpadMultiply: 'numpad_asterix',
  NumpadEnter: 'numpad_enter', Space: 'spacebar', Enter: 'ret', Escape: 'esc', Delete: 'del', Backspace: 'back_space', PageUp: 'page_up', PageDown: 'page_down',
  ArrowLeft: 'left_arrow', ArrowRight: 'right_arrow', ArrowUp: 'up_arrow', ArrowDown: 'down_arrow',
  ControlLeft: 'left_ctrl', ControlRight: 'right_ctrl', ShiftLeft: 'left_shift', ShiftRight: 'right_shift', AltLeft: 'left_alt', AltRight: 'right_alt', MetaLeft: 'oskey', MetaRight: 'oskey',
};

// The Blender event type of a keyboard event's physical key.
export function keyType(e) {
  const code = e.code;
  return CODES[code] ?? code.match(/^Key([A-Z])$/)?.[1].toLowerCase() ?? (code.match(/^Digit(\d)$/) ? DIGITS[code.at(-1)] : null)
    ?? code.match(/^Numpad(\d)$/)?.[1].replace(/^/, 'numpad_') ?? code.toLowerCase();
}

const modifierKeys = (event) => [event.shift && 'shift', event.ctrl && 'ctrl', event.alt && 'alt'].filter(Boolean);

// Every keymap made, as Blender's key configuration, for the shortcuts menus show.
const keyconfig = [];

// The keys bound to an operator with these properties (WM_key_event_operator_string): a binding with the same
// properties, else one with none. `blender` may name `idname:VALUE` for an enum value.
export function operatorKeys(idname, props = {}, keymaps = keyconfig) {
  const values = Object.values(props).filter((value) => typeof value === 'string');
  const bindings = keymaps.flatMap((map) => map.items)
    .filter((item) => [item.blender].flat().some((id) => id === idname || values.some((value) => id === `${idname}:${value}`)));
  const exact = bindings.find((item) => item.props && Object.entries(item.props).every(([key, value]) => props[key] === value));
  return (exact ?? bindings.find((item) => !item.props))?.keys;
}

// Runs the first binding whose keys match the event and whose poll passes. Returns whether one ran. A binding without
// `run` runs its operator (`blender`) with its `props`.
// `keymaps` names the Blender keymaps the bindings mirror; scripts/blender-coverage.mjs reads it.
export function createKeymap(items, keymaps = []) {
  const bound = items.map((item) => ({ run: () => runOperator(item.blender, item.props ?? {}), ...item, parsed: [item.keys].flat().map(parseKeys) }));
  const matches = (p, event) => {
    if (p.key !== event.type) return false;
    if (p.value !== 'ANY' && p.value !== event.value) return false;
    if (p.any) return true;
    const shown = event.value === 'CLICK_DRAG' ? ['drag'] : event.value === 'DOUBLE_CLICK' ? ['double'] : [];
    return p.combo === [...modifierKeys(event), ...shown, event.type].join(' ');
  };
  const keymap = (event) => {
    const item = bound.find((b) => b.parsed.some((p) => matches(p, event)) && (b.poll?.(event) ?? true));
    if (!item) return false;
    event.native?.preventDefault();
    item.run(event);
    return true;
  };
  keymap.items = bound;
  keyconfig.push(keymap);
  return keymap;
}
