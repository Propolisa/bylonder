// The keys the touch layer offers as taps (docs/mobile.md Shortcuts made tappable), all read from Blender's keymaps:
// the running modal operator's bubbles from its modal keymap, and the quick keys pie's slots, a fixed set of keys per
// mode labelled with what they run where the last finger was.
import { binding, modalKeymapItems } from '../../windowmanager/keyconfig.js';
import { keysLabel } from '../../windowmanager/input/keymap.js';
import rnaOperators from '../../makesrna/rna-operators.json' with { type: 'json' };

const MODIFIER_KEYS = /^(LEFT|RIGHT)_(CTRL|SHIFT|ALT)$|^OSKEY$/;
const label = (identifier) => identifier.split('_').map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const keyText = (kmi) => [kmi.shift === true || kmi.shift === 1 ? 'Shift' : '', kmi.ctrl === true || kmi.ctrl === 1 ? 'Ctrl' : '', kmi.alt === true || kmi.alt === 1 ? 'Alt' : '',
  keysLabel(kmi.type)].filter(Boolean).join(' ');

// The bubbles of a modal keymap: each item it takes now (`takes(identifier)`) once, by its first key press. Modifier
// keys are the touch bar's sticky ones; mouse buttons and the wheel are the finger's and the touch bar's.
export function modalBubbles(name, takes) {
  const seen = new Set(), bubbles = [];
  for (const [identifier, kmi] of modalKeymapItems(name)) {
    if (seen.has(identifier) || kmi.value === 'RELEASE' || /MOUSE$/.test(kmi.type) || MODIFIER_KEYS.test(kmi.type) || !takes(identifier)) continue;
    seen.add(identifier);
    bubbles.push({ id: identifier, label: label(identifier), keys: keyText(kmi), type: kmi.type, shift: !!kmi.shift, ctrl: !!kmi.ctrl, alt: !!kmi.alt });
  }
  return bubbles;
}

// The quick keys pie per mode, in Blender's pie order: west, east, south, north, north west, north east, south west,
// south east. Keys are Blender's event types with their modifiers; where Blender has a pie for a key it is that key.
const PIE = {
  OBJECT: ['G', 'S', 'X', 'TAB', 'R', 'Shift A', 'Z', 'ACCENT_GRAVE'],
  EDIT: ['G', 'S', 'E', 'TAB', 'R', 'Ctrl R', 'Z', 'ACCENT_GRAVE'],
  SCULPT: ['F', 'Shift F', 'Ctrl Z', 'Ctrl TAB', 'X', 'Shift Ctrl Z', 'Z', 'ACCENT_GRAVE'],
  POSE: ['G', 'S', 'I', 'Ctrl TAB', 'R', 'Alt I', 'Z', 'ACCENT_GRAVE'],
};
// The keymaps of a 3D Viewport in a mode, as its handlers run them.
const KEYMAPS = {
  OBJECT: ['Object Mode', 'Object Non-modal', '3D View Generic', '3D View', 'Screen', 'Window'],
  EDIT: ['Mesh', 'Object Non-modal', '3D View Generic', '3D View', 'Screen', 'Window'],
  SCULPT: ['Sculpt', 'Object Non-modal', '3D View Generic', '3D View', 'Screen', 'Window'],
  POSE: ['Pose', 'Object Non-modal', '3D View Generic', '3D View', 'Screen', 'Window'],
};
const parse = (keys) => {
  const words = keys.split(' ');
  return { type: words.at(-1), shift: words.includes('Shift'), ctrl: words.includes('Ctrl'), alt: words.includes('Alt') };
};
// What a binding runs, by name: an operator's, or a menu's or pie's.
const runs = ([idname, props]) => (props.name ? label(props.name.replace(/^[A-Z0-9]+_MT_/, '')) : rnaOperators[idname]?.name ?? idname);

// The pie's slots for a mode (`OBJECT`, `EDIT`, `SCULPT`, `POSE`; others are Object Mode's).
export function pieSlots(mode) {
  const keys = PIE[mode] ? mode : 'OBJECT';
  return PIE[keys].map((preset) => {
    const key = parse(preset), bound = binding(KEYMAPS[keys], { ...key, type: key.type.toLowerCase(), value: 'PRESS' });
    return { ...key, keys: [key.shift && 'Shift', key.ctrl && 'Ctrl', key.alt && 'Alt', keysLabel(key.type)].filter(Boolean).join(' '), label: bound ? runs(bound) : '', disabled: !bound };
  });
}
