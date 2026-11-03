// The keys the touch bar, its shortcut bubbles, pie and keyboard sheet press (src/editors/interface/touch.js): each
// Blender event type becomes the keyboard event the window manager reads back as that type (keymap.js keyOf, keyType).
import assert from 'node:assert/strict';
import { keyOf, keyType } from '../src/windowmanager/input/keymap.js';
import { loadKeyconfig } from '../src/windowmanager/wm-window.js';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import { modalBubbles, pieSlots } from '../src/editors/interface/touch-keys.js';

const TYPES = ['ESC', 'TAB', 'RET', 'SPACE', 'DEL', 'BACK_SPACE', 'HOME', 'END', 'PAGE_UP', 'PAGE_DOWN', 'LEFT_ARROW', 'UP_ARROW', 'ACCENT_GRAVE',
  'MINUS', 'EQUAL', 'PERIOD', 'COMMA', 'SLASH', 'SEMI_COLON', 'QUOTE', 'LEFT_BRACKET', 'RIGHT_BRACKET', 'NUMPAD_0', 'NUMPAD_7', 'NUMPAD_PERIOD',
  'NUMPAD_PLUS', 'NUMPAD_ASTERIX', 'NUMPAD_ENTER', 'F1', 'F12', 'ZERO', 'TWO', 'NINE', 'A', 'G', 'X', 'Z'];
for (const type of TYPES) assert.equal(keyType(keyOf(type)).toUpperCase(), type === 'SPACE' ? 'SPACEBAR' : type, type);
assert.deepEqual(keyOf('X'), { code: 'KeyX', key: 'x' });
assert.deepEqual(keyOf('TWO'), { code: 'Digit2', key: '2' });
assert.deepEqual(keyOf('PERIOD'), { code: 'Period', key: '.' });

// Blender's key configuration, as the app loads it: a transform's bubbles from Transform Modal Map, each item once by
// its key, none for the mouse or a modifier key, and only the items the operator takes now.
loadKeyconfig(blenderMain().C);
const bubbles = Object.fromEntries(modalBubbles('Transform Modal Map', () => true).map((b) => [b.id, b.keys]));
assert.equal(bubbles.CONFIRM, 'Return');
assert.equal(bubbles.CANCEL, 'Esc');
assert.equal(bubbles.AXIS_X, 'X');
assert.equal(bubbles.PLANE_Z, 'Shift Z');
assert.ok(!Object.values(bubbles).some((keys) => /Mouse|Ctrl$|Shift$/.test(keys)), 'no mouse or modifier keys');
assert.deepEqual(modalBubbles('Transform Modal Map', (id) => id === 'AXIS_Y').map((b) => b.id), ['AXIS_Y']);
// The pie's slots, labelled by what their keys run in the mode.
const slots = (mode) => Object.fromEntries(pieSlots(mode).map((slot) => [slot.keys, slot.label]));
assert.equal(slots('OBJECT').G, 'Move');
assert.equal(slots('EDIT').E, 'Extrude and Move on Normals');
assert.equal(pieSlots('OBJECT').length, 8);
console.log(`Touch keys: ${TYPES.length} Blender keys round-trip through the keyboard events the touch bar sends`);
