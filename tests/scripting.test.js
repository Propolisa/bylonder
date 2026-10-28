// The Scripting workspace's editors without a browser: texts (blenkernel/texts.js) edited by Blender's Text keymap
// through the text operators, Python syntax formats (text_format_py.cc), the Python Console's lines and history
// through its keymap and bpy.ops, the Info editor's operator reports, and Blender's headers, menus and sidebar panels
// of all three drawn over their contexts. CPython (Pyodide) runs in the browser only (tests/e2e/smoke.mjs).
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { Text, createTexts, jumpDelim } from '../src/blenkernel/texts.js';
import { formatPythonLine, isSyntaxHighlightSupported } from '../src/editors/space_text/text-format.js';
import { registerTextOperators } from '../src/editors/space_text/text-ops.js';
import { ConsoleSpace, registerConsoleOperators } from '../src/editors/space_console/console-ops.js';
import { operatorPystring, reports } from '../src/windowmanager/wm-reports.js';
import { keymapHandler, blenderKeys } from '../src/windowmanager/keyconfig.js';
import { inArea, runOperator, registerOperator, pollOperator } from '../src/windowmanager/wm-operators.js';
import { createRNA, propBinding } from '../src/makesrna/rna-bylonder.js';
import { createContext } from '../src/blenkernel/context.js';
import { createSelection } from '../src/editors/object/selection.js';
import { headerLayout, panelTypes, drawPanels } from '../src/editors/interface/panels.js';
import { drawMenu } from '../src/editors/interface/ui-layout.js';
import { menuUI } from '../src/windowmanager/wm-operators.js';
import { menus, headers, panels, module } from '../src/python/bpy_interface.js';
import { api } from '../src/python/pyodide.js';

// ---- Text editing as text.cc does it.
{
  const text = new Text('Text', 'def f():');
  text.moveEol(false);
  const indent = text.currentIndent(4);
  text.splitCurline();
  text.insert(' '.repeat(indent));
  text.insert('return 1');
  assert.deepEqual(text.lines, ['def f():', '    return 1'], 'a line break after a colon indents');
  text.moveBol(false);
  text.moveRight(false);
  assert.equal(text.curc, 4, 'Right over indentation spaces steps a tab');
  text.backspaceChar();
  assert.equal(text.curLine, '   return 1');
  text.insert(' ');
  assert.equal(jumpDelim('foo.bar baz', 0, true), 3, 'word jumps stop at delimiters');
  assert.equal(jumpDelim('foo.bar baz', 11, false), 8);
  text.selAll();
  text.comment('#');
  assert.deepEqual(text.lines, ['#def f():', '#    return 1']);
  assert.equal(text.uncomment('#'), true);
  assert.deepEqual(text.lines, ['def f():', '    return 1']);
  text.moveTo(1, 0, false);
  text.unindent();
  assert.equal(text.lines[1], 'return 1');
  text.moveTo(0, 0, false);
  text.moveTo(0, 3, true);
  assert.equal(text.selText(), 'def');
  text.insert('async def');
  assert.equal(text.lines[0], 'async def f():');
  assert.equal(text.find('return', true, true) && text.selText(), 'return');
}

// ---- Syntax formats (text_format_py.cc).
{
  const { format } = formatPythonLine('def f(x): return 0x1F  # done');
  assert.equal(format, 'vvv_q!q!!_bbbbbb_nnnn__######', 'special, keyword, numeral and comment formats');
  const open = formatPythonLine('s = """abc');
  assert.ok(open.cont, 'a triple-quoted string continues on the next line');
  assert.equal(formatPythonLine('end"""', open.cont).format, 'llllll');
  assert.equal(isSyntaxHighlightSupported({ name: 'Text.001' }), true);
  assert.equal(isSyntaxHighlightSupported({ name: 'index.js' }), false);
}

// ---- Texts saved with the project.
const saved = [];
const texts = createTexts({ files: { 'index.js': 'export {}' }, save: (name, content) => saved.push([name, content]), delay: 0 });
{
  const text = texts.new('Text');
  assert.equal(texts.new('Text').name, 'Text.001', 'new texts take unique names');
  assert.deepEqual(saved.slice(0, 2), [['Text', ''], ['Text.001', '']]);
  texts.remove(texts.get('Text.001'));
  assert.deepEqual(saved.at(-1), ['Text.001', null]);
  text.insert('x = 1');
  texts.edited(text);
  texts.flush();
  assert.deepEqual(saved.at(-1), ['Text', 'x = 1']);
  texts.load('Text', 'y = 2');
  assert.equal(text.content, 'y = 2', 'a file changed elsewhere reloads');
}

// ---- The Text Editor's keymaps run its operators on the context area's text.
const engine = new NullEngine(), scene = new Scene(engine);
const objects = [MeshBuilder.CreateBox('Cube', { size: 2 }, scene)];
const world = { scene, objects, texts };
const host = { world, selection: createSelection(scene, objects), update: () => {}, undoPush: () => {} };
const r = createRNA(host);
registerTextOperators(texts);
registerConsoleOperators();
const st = { settings: { show_line_numbers: true, show_word_wrap: false, show_syntax_highlight: true, tab_width: 4, overwrite: false, font_size: 12 }, text: null, top: 0,
  changed() {}, setText(t) { st.text = t; }, scrollTo() {}, visibleLines: () => 20 };
const textEditor = { space: st, lineNumber: () => 'PASS_THROUGH', edited: (text, { save = true } = {}) => save && texts.edited(text), visibleLines: () => 20, lineEdge: (t, sel, end) => (end ? t.moveEol(sel) : t.moveBol(sel)),
  moveLines: (t, sel, n) => { for (let i = 0; i < Math.abs(n); i++) (n < 0 ? t.moveUp(sel) : t.moveDown(sel)); } };
const textArea = { space: 'TEXT_EDITOR', textEditor, menu: () => null, context: () => createContext(r, { area: 'TEXT_EDITOR', space: st }) };
const textKeys = keymapHandler(['Text Generic', 'Text', 'Screen', 'Window']);
const key = (keys, area, type, mods = {}, text = '') => inArea(area, () => keys({ type, value: 'PRESS', shift: false, ctrl: false, alt: false, oskey: false, text, ...mods }));
const type = (area, keys, string) => { for (const ch of string) assert.ok(key(keys, area, ch === ' ' ? 'SPACE' : ch.toUpperCase(), {}, ch), `typed ${ch}`); };
{
  assert.equal(key(textKeys, textArea, 'N', { alt: true }), true, 'Alt N is text.new');
  const text = st.text;
  assert.equal(text.name, 'Text.001');
  type(textArea, textKeys, 'if x:');
  key(textKeys, textArea, 'RET');
  type(textArea, textKeys, 'pass');
  assert.deepEqual(text.lines, ['if x:', '    pass'], 'typing and Return through the Text keymap');
  key(textKeys, textArea, 'LEFT_ARROW', { shift: true, ctrl: true });
  assert.equal(text.selText(), 'pass', 'Shift Ctrl Left selects a word');
  key(textKeys, textArea, 'SLASH', { ctrl: true });
  assert.equal(text.lines[1], '#    pass', 'Ctrl / toggles comments');
  key(textKeys, textArea, 'Z', { ctrl: true });
  assert.equal(text.lines[1], '    pass', 'Ctrl Z undoes the text edit');
  key(textKeys, textArea, 'A', { ctrl: true });
  key(textKeys, textArea, 'BACK_SPACE');
  assert.equal(text.content, '', 'Ctrl A then Backspace clears');
  assert.equal(blenderKeys(['Text Generic', 'Text'], 'text.run_script'), 'Alt P');
  assert.equal(inArea(textArea, () => pollOperator('text.run_script')), true);
  // bpy.data.texts and the space's text through RNA, as scripts see them.
  const context = textArea.context();
  assert.equal(context.space_data.text.name, 'Text.001');
  assert.ok([...context.blend_data.texts].some((t) => t.name === 'index.js'));
  context.space_data.text.from_string('a = 1\nb = 2');
  assert.equal(context.space_data.text.lines[1].body, 'b = 2');
  context.space_data.text.lines[1].body = 'b = 3';
  assert.equal(text.content, 'a = 1\nb = 3', 'TextLine.body writes the text');
  context.space_data.show_line_numbers = false;
  assert.equal(st.settings.show_line_numbers, false);
}

// ---- The Python Console's keymap and the operators bpy.ops reaches.
const sc = new ConsoleSpace();
const consoleArea = { space: 'CONSOLE', console: { space: sc, changed() {}, run: (fn) => inArea(consoleArea, fn) }, menu: () => null, context: () => createContext(r, { area: 'CONSOLE', space: sc }) };
const consoleKeys = keymapHandler(['Console', 'Screen', 'Window']);
{
  type(consoleArea, consoleKeys, 'C.object');
  assert.equal(sc.line.body, 'C.object');
  key(consoleKeys, consoleArea, 'LEFT_ARROW', { ctrl: true });
  assert.equal(sc.line.current_character, 2, 'Ctrl Left jumps a word');
  key(consoleKeys, consoleArea, 'BACK_SPACE', { ctrl: true });
  assert.equal(sc.line.body, 'object');
  // What _console_python.execute calls, through the tree's bpy.ops as CPython's bpy reaches it.
  const ops = module('bpy').ops;
  inArea(consoleArea, () => {
    ops.console.scrollback_append({ text: '>>> object', py_metatype: 'INPUT', __kwargtrans__: null });
    ops.console.history_append({ text: '', current_character: 0, remove_duplicates: true, __kwargtrans__: null });
  });
  assert.deepEqual(sc.scrollback, [{ body: '>>> object', type: 'INPUT' }]);
  assert.deepEqual(sc.history.map((line) => line.body), ['object', '']);
  key(consoleKeys, consoleArea, 'UP_ARROW');
  assert.equal(sc.line.body, 'object', 'Up recalls the history');
  key(consoleKeys, consoleArea, 'DOWN_ARROW');
  assert.equal(sc.line.body, '', 'Down returns to the new line');
  key(consoleKeys, consoleArea, 'TAB');
  assert.equal(sc.line.body, '    ', 'Tab on a blank line indents');
  const context = consoleArea.context();
  assert.equal(context.space_data.history.at(-1).body, '    ');
  context.space_data.prompt = '>>> ';
  assert.equal(sc.settings.prompt, '>>> ');
}

// ---- Operator reports, as the Info editor lists them.
{
  assert.equal(operatorPystring('mesh.primitive_cube_add', { size: 2, align: 'WORLD', location: [0, 0, 0.5] }),
    "bpy.ops.mesh.primitive_cube_add(size=2, align='WORLD', location=(0, 0, 0.5))");
  registerOperator('mesh.primitive_cube_add', { run: () => {} });
  runOperator('mesh.primitive_cube_add', { size: 2 });
  assert.equal(reports.at(-1).type, 'OPERATOR');
  assert.equal(reports.at(-1).message, 'bpy.ops.mesh.primitive_cube_add(size=2)');
}

// ---- Blender's headers, menus and sidebar panels of the three editors draw over their contexts.
{
  const info = { settings: {}, changed() {} };
  for (const [space, data, header] of [['TEXT_EDITOR', st, 'TEXT_HT_header'], ['TEXT_EDITOR', st, 'TEXT_HT_footer'], ['CONSOLE', sc, 'CONSOLE_HT_header'], ['INFO', info, 'INFO_HT_header']]) {
    const context = () => createContext(r, { area: space, space: data });
    const layout = headerLayout(context(), (l) => Object.assign(headers[header](), { layout: l }).draw(context()));
    assert.ok(layout.children.length, `${header} draws`);
    const ui = { ...menuUI({ menus, context, prop: propBinding(host) }), supported: () => true, poll: () => true };
    const walk = (node) => (node.children ?? []).flatMap((child) => (child.kind === 'menu' ? [child.menu] : walk(child)));
    for (const name of walk(layout)) assert.ok(drawMenu(name, ui).length, `${name} has entries`);
  }
  const context = createContext(r, { area: 'TEXT_EDITOR', space: st });
  const drawn = drawPanels(panelTypes([{ classes: Object.values(panels) }], { space: 'TEXT_EDITOR', region: 'UI' }), context, { contexts: [] });
  assert.deepEqual(drawn.map((p) => p.id), ['TEXT_PT_find', 'TEXT_PT_properties'], 'in registration order');
  assert.ok(drawn.every((p) => !p.error), drawn.map((p) => p.error).filter(Boolean).join('\n'));
}

// ---- The JS side of CPython's bridge: Python's names over the tree's, and bulk copies of mesh geometry from and to
// the Babylon buffer that owns it.
{
  const ops = module('bpy').ops;
  const mesh = api.getattr(ops, 'mesh');
  assert.equal(typeof api.getattr(mesh, 'primitive_cube_add'), 'function', 'bpy.ops.mesh through the PEP 562 __getattr__');
  assert.equal(api.getattr(module('bpy'), 'ops').then, undefined, 'module views have no then (Pyodide would await them)');
  const ob = r.pointer('Object', objects[0]);
  assert.equal(api.getattr(ob, 'name'), 'Cube');
  assert.throws(() => api.getattr(ob, 'no_such'), /AttributeError/);
  const vertices = ob.data.vertices, before = api.foreachGet(vertices, 'co');
  assert.equal(before.length, vertices.length * 3);
  assert.deepEqual([...vertices[0].co], [...before.slice(0, 3)], 'foreach_get matches each vertex in Blender axes');
  api.foreachSet(vertices, 'co', before.map((v, i) => (i % 3 === 2 ? v + 1 : v)));
  assert.ok(Math.abs(vertices[0].co[2] - before[2] - 1) < 1e-6, 'foreach_set writes the Babylon buffer (Blender Z is Babylon y)');
  assert.ok(Math.abs(objects[0].getVerticesData('position')[1] - before[2] - 1) < 1e-6);
}

console.log('scripting: ok');
