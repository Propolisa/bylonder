// The Scripting workspace's editors without a browser: operator reports, and Blender's header and menus of the Console
// drawn over its context (the Text Editor, the Console and Info are Blender's own: tests/text-wasm.test.js; Python in them:
// tests/python-wasm.test.js).
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { operatorPystring, subscribeReports } from '../src/windowmanager/wm-reports.js';
import { runOperator, registerOperator } from '../src/windowmanager/wm-operators.js';
import { createRNA, propBinding } from '../src/makesrna/rna-bylonder.js';
import { createContext } from '../src/blenkernel/context.js';
import { createSelection } from '../src/editors/object/selection.js';
import { headerLayout } from '../src/editors/interface/panels.js';
import { drawMenu } from '../src/editors/interface/ui-layout.js';
import { menuUI } from '../src/windowmanager/wm-operators.js';
import { menus, headers } from '../src/python/bpy_interface.js';
import { loadKeyconfig } from '../src/windowmanager/wm-window.js';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';

// Blender's key configuration, as the app loads it at startup.
loadKeyconfig(blenderMain().C);

const engine = new NullEngine(), scene = new Scene(engine);
const objects = [MeshBuilder.CreateBox('Cube', { size: 2 }, scene)];
const host = { world: { scene, objects }, selection: createSelection(scene, objects), update: () => {}, undoPush: () => {} };
const r = createRNA(host);

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
  for (const [space, header] of [['CONSOLE', 'CONSOLE_HT_header']]) {
    const context = () => createContext(r, { area: space });
    const layout = headerLayout(context(), (l) => Object.assign(headers[header](), { layout: l }).draw(context()));
    assert.ok(layout.children.length, `${header} draws`);
    const ui = { ...menuUI({ menus, context, prop: propBinding(host) }), supported: () => true, poll: () => true };
    const walk = (node) => (node.children ?? []).flatMap((child) => (child.kind === 'menu' ? [child.menu] : walk(child)));
    for (const name of walk(layout)) assert.ok(drawMenu(name, ui).length, `${name} has entries`);
  }
}

console.log('scripting: ok');
