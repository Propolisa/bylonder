// The Scripting workspace's editors without a browser: the Python Console's lines and history through its keymap and
// bpy.ops, operator reports, and Blender's header and menus of the Console drawn over its context (the Text Editor and
// Info are Blender's own: tests/text-wasm.test.js). CPython (Pyodide) runs in the browser only (tests/e2e/smoke.mjs).
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { ConsoleSpace, registerConsoleOperators } from '../src/editors/space_console/console-ops.js';
import { operatorPystring, subscribeReports } from '../src/windowmanager/wm-reports.js';
import { keymapHandler } from '../src/windowmanager/keyconfig.js';
import { inArea, runOperator, registerOperator } from '../src/windowmanager/wm-operators.js';
import { createRNA, propBinding } from '../src/makesrna/rna-bylonder.js';
import { createContext } from '../src/blenkernel/context.js';
import { createSelection } from '../src/editors/object/selection.js';
import { headerLayout } from '../src/editors/interface/panels.js';
import { drawMenu } from '../src/editors/interface/ui-layout.js';
import { menuUI } from '../src/windowmanager/wm-operators.js';
import { menus, headers, panels, module } from '../src/python/bpy_interface.js';
import { api } from '../src/python/pyodide.js';

// ---- The Python Console's keymap and the operators bpy.ops reaches.
const engine = new NullEngine(), scene = new Scene(engine);
const objects = [MeshBuilder.CreateBox('Cube', { size: 2 }, scene)];
const world = { scene, objects };
const host = { world, selection: createSelection(scene, objects), update: () => {}, undoPush: () => {} };
const r = createRNA(host);
registerConsoleOperators();
const key = (keys, area, type, mods = {}, text = '') => inArea(area, () => keys({ type, value: 'PRESS', shift: false, ctrl: false, alt: false, oskey: false, text, ...mods }));
const type = (area, keys, string) => { for (const ch of string) assert.ok(key(keys, area, ch === ' ' ? 'SPACE' : ch.toUpperCase(), {}, ch), `typed ${ch}`); };
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
  const reported = [];
  subscribeReports((r) => reported.push(r));
  registerOperator('mesh.primitive_cube_add', { run: () => {} });
  runOperator('mesh.primitive_cube_add', { size: 2 });
  assert.deepEqual(reported, [{ type: 'OPERATOR', message: 'bpy.ops.mesh.primitive_cube_add(size=2)' }]);
}

// ---- Blender's header and menus of the Console draw over its context.
{
  for (const [space, data, header] of [['CONSOLE', sc, 'CONSOLE_HT_header']]) {
    const context = () => createContext(r, { area: space, space: data });
    const layout = headerLayout(context(), (l) => Object.assign(headers[header](), { layout: l }).draw(context()));
    assert.ok(layout.children.length, `${header} draws`);
    const ui = { ...menuUI({ menus, context, prop: propBinding(host) }), supported: () => true, poll: () => true };
    const walk = (node) => (node.children ?? []).flatMap((child) => (child.kind === 'menu' ? [child.menu] : walk(child)));
    for (const name of walk(layout)) assert.ok(drawMenu(name, ui).length, `${name} has entries`);
  }
}

// ---- The JS side of CPython's bridge: Python's names over the tree's, and bulk copies of mesh geometry from and to
// the object's Mesh.
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
  assert.equal(vertices.length, 8, "Blender's vertices, not Babylon's split ones");
  assert.deepEqual([ob.data.edges.length, ob.data.polygons.length], [18, 12], "a Babylon box's triangles");
  assert.ok(Math.abs(ob.data.vertices[0].co[2] - before[2] - 1) < 1e-6, 'foreach_set writes the Mesh');
  assert.ok(objects[0].getVerticesData('position').some((y, i) => i % 3 === 1 && Math.abs(y - before[2] - 1) < 1e-6), 'and the Babylon buffer, Blender Z as Babylon y');
}

console.log('scripting: ok');
