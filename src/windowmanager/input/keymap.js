// Key bindings in Blender's terms: `keys` as Blender shows them ("Shift D", "Ctrl Numpad 1"), `blender` the
// operator or menu they run, so scripts/blender-coverage.mjs can count them.
const MODIFIERS = ['shift', 'ctrl', 'alt', 'oskey'];
const ALIASES = { enter: 'ret', return: 'ret', delete: 'del', escape: 'esc', backspace: 'back_space', space: 'spacebar', cmd: 'oskey', meta: 'oskey', control: 'ctrl', option: 'alt', '.': 'period', '/': 'slash', ',': 'comma', '-': 'minus', '=': 'equal' };
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const NUMPAD = { '.': 'period', '+': 'plus', '-': 'minus', '/': 'slash', '*': 'asterix' };

export function normalizeKeys(keys) {
  const tokens = keys.toLowerCase().split(/\s+|(?<=\S)\+(?=\S)/).filter(Boolean).map((t) => (MODIFIERS.includes(ALIASES[t]) ? ALIASES[t] : t));
  const rest = tokens.filter((t) => !MODIFIERS.includes(t));
  const key = rest[0] === 'numpad' ? 'numpad_' + (NUMPAD[rest[1]] ?? rest[1])
    : rest.length === 1 ? ALIASES[rest[0]] ?? (/^\d$/.test(rest[0]) ? DIGITS[rest[0]] : rest[0])
    : rest.join('_');
  return [...MODIFIERS.filter((m) => tokens.includes(m)), key].join(' ');
}

const CODES = { NumpadDecimal: 'numpad_period', NumpadAdd: 'numpad_plus', NumpadSubtract: 'numpad_minus', NumpadDivide: 'numpad_slash', NumpadMultiply: 'numpad_asterix', NumpadEnter: 'numpad_enter', Space: 'spacebar', Enter: 'ret', Escape: 'esc', Delete: 'del', Backspace: 'back_space' };

export function eventKeys(e) {
  const code = e.code;
  const key = CODES[code] ?? code.match(/^Key([A-Z])$/)?.[1].toLowerCase() ?? (code.match(/^Digit(\d)$/) ? DIGITS[code.at(-1)] : null)
    ?? code.match(/^Numpad(\d)$/)?.[1].replace(/^/, 'numpad_') ?? code.toLowerCase();
  return [e.shiftKey && 'shift', (e.ctrlKey || e.metaKey) && 'ctrl', e.altKey && 'alt', key].filter(Boolean).join(' ');
}

// Runs the first binding whose keys match the event and whose poll passes. Returns whether one ran.
// `keymaps` names the Blender keymaps the bindings mirror; scripts/blender-coverage.mjs reads it.
export function createKeymap(items, keymaps = []) {
  const bound = items.map((item) => ({ ...item, combos: [item.keys].flat().map(normalizeKeys) }));
  return (e) => {
    const combo = eventKeys(e);
    const item = bound.find((b) => b.combos.includes(combo) && (b.poll?.() ?? true));
    if (!item) return false;
    e.preventDefault();
    item.run(e);
    return true;
  };
}
