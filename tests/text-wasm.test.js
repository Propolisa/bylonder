// Blender's Text Editor and Python Console in the module: a Text in Main shown in a real SPACE_TEXT area, edited by
// Blender's text operators through Blender's own window manager and Text keymaps, and the Console's input line edited
// by its operators, as in Blender.
import assert from 'node:assert/strict';
import { blenderMain, operatorNames } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { defaultKeymaps } from '../src/windowmanager/keyconfig.js';
import { Window, loadKeyconfig, RGN_TYPE_WINDOW, RGN_TYPE_HEADER } from '../src/windowmanager/wm-window.js';
import { regionHeader } from '../src/editors/interface/ui-tree.js';
import { createTextFiles } from '../src/blenkernel/text-files.js';
import { clipboardText, setClipboardText } from '../src/windowmanager/wm-clipboard.js';
import { report } from '../src/windowmanager/wm-reports.js';
import { blendData, pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';

const SPACE_TEXT = 9, SPACE_CONSOLE = 18;
const main = blenderMain();
setContextPointer(main.C);
const window = new Window(main);
window.size = { width: 1200, height: 800 };
loadKeyconfig(main.C, defaultKeymaps());
window.allow(operatorNames().filter((idname) => /^(text|console)\./.test(idname)));
const rect = { x: 0, y: 0, width: 1200, height: 800 };
const regions = { [RGN_TYPE_HEADER]: { x: 0, y: 0, width: 1200, height: 26 }, [RGN_TYPE_WINDOW]: { x: 0, y: 26, width: 1200, height: 774 } };

const typed = (text) => {
  for (const c of text) {
    const code = c === '\n' ? 'Enter' : c === ' ' ? 'Space' : /[a-z]/i.test(c) ? `Key${c.toUpperCase()}` : /\d/.test(c) ? `Digit${c}` : '';
    const key = c === '\n' ? 'Enter' : c;
    window.event('keydown', [0], { code, key, text: c === '\n' ? '' : c });
    window.event('keyup', [0], { code, key });
  }
};
const MODIFIER_KEYS = { shift: ['ShiftLeft', 'Shift'], ctrl: ['ControlLeft', 'Control'], alt: ['AltLeft', 'Alt'] };
const key = (code, k = code, held = []) => {
  for (const m of held) window.event('keydown', [0], { code: MODIFIER_KEYS[m][0], key: MODIFIER_KEYS[m][1] });
  window.event('keydown', [0], { code, key: k });
  window.event('keyup', [0], { code, key: k });
  for (const m of held.toReversed()) window.event('keyup', [0], { code: MODIFIER_KEYS[m][0], key: MODIFIER_KEYS[m][1] });
};

// The Text Editor: a new Text, typed into, a word deleted backwards.
const area = window.area(SPACE_TEXT);
area.layout(rect, regions);
const text = blendData().texts.new('Text');
pointerStruct(structFind('Area'), 0, area.pointer).spaces.active.text = text;
window.event('pointermove', [600, 400]);
typed('import bpy\nprint(1)');
assert.equal(text.as_string(), 'import bpy\nprint(1)', 'typing inserts through text.insert and text.line_break');
key('Backspace');
assert.equal(text.as_string(), 'import bpy\nprint(1', 'Backspace deletes the previous character');
key('Home');
typed('x = ');
assert.equal(text.as_string(), 'import bpy\nx = print(1', 'Home moves to the line start');
const drawn = JSON.stringify(area.draw(RGN_TYPE_WINDOW));
assert.ok(drawn.includes('"mono"') && drawn.includes('"text":"p"'), "the text is drawn monospaced by Blender's draw_text_main");
const header = JSON.stringify(area.inContext(RGN_TYPE_HEADER, (C) => regionHeader(C)));
assert.ok(header.includes('TEXT_MT_editor_menus') || header.includes('"Text"'), "the header is Blender's TEXT_HT_header, laid out by uiLayout");

// Blender's Text keymap: a word selected, commented, copied and pasted, everything selected and deleted; Alt N a new text.
key('ArrowLeft', 'ArrowLeft', ['shift', 'ctrl']);
key('Slash', '/', ['ctrl']);
assert.equal(text.as_string(), 'import bpy\n#x = print(1', 'Ctrl / comments the line');
key('KeyA', 'a', ['ctrl']);
key('KeyC', 'c', ['ctrl']);
assert.equal(clipboardText(), 'import bpy\n#x = print(1', "Ctrl C copies to the browser's clipboard");
key('Backspace');
assert.equal(text.as_string(), '', 'Ctrl A then Backspace clears');
setClipboardText('pasted');
key('KeyV', 'v', ['ctrl']);
assert.equal(text.as_string(), 'pasted', 'Ctrl V pastes the clipboard');
key('KeyN', 'n', ['alt']);
const space = () => pointerStruct(structFind('Area'), 0, area.pointer).spaces.active;
assert.equal(space().text.name, 'Text.001', 'Alt N is text.new');
area.free();

// The project's text files as Main's Texts: loaded, then written back where they changed.
const saved = [];
const files = createTextFiles({ files: { 'index.js': 'export {}' }, save: (name, content) => saved.push([name, content]) });
blendData().texts.get('index.js').from_string('export const x = 1;');
blendData().texts.remove(blendData().texts.get('Text.001'));
files.flush();
assert.deepEqual(saved, [['Text.001', null], ['index.js', 'export const x = 1;']], 'a removed text removes its file, an edited one writes it');
files.load('index.js', 'export {}');
assert.equal(blendData().texts.get('index.js').as_string(), 'export {}', 'a file changed elsewhere reloads');

// The Python Console: the input line, edited by console.insert and console.delete.
const console_ = window.area(SPACE_CONSOLE);
console_.layout(rect, { [RGN_TYPE_WINDOW]: rect });
window.event('pointermove', [600, 400]);
typed('1 + 2');
const consoleSpace = pointerStruct(structFind('Area'), 0, console_.pointer).spaces.active;
assert.equal(consoleSpace.history[consoleSpace.history.length - 1].body, '1 + 2', "the console's input line holds what was typed");
console_.free();

// Info: the window manager's reports, the page's among them, drawn by Blender's info_draw.cc.
report('WARNING', 'a warning from the page');
const info = window.area(7);
info.layout(rect, { [RGN_TYPE_WINDOW]: rect });
assert.ok(JSON.stringify(info.draw(RGN_TYPE_WINDOW)).includes('a warning from the page'), "the page's report is in Blender's Info");
info.free();

console.log("text editor: Blender's Text Editor and Python Console edit Main's data through Blender's own operators and keymaps; Info lists Blender's reports");
