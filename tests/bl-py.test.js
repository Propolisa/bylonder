// Blender's Python tree (src/bl_py, tools/blender-ui/tree.py) loads whole and Blender's startup registers its classes:
// menus, panels, headers and operators, by Blender's names.
import assert from 'node:assert/strict';

const started = performance.now();
const { registered } = await import('../src/python/bpy_interface.js');
const count = (pattern) => Object.keys(registered).filter((name) => pattern.test(name)).length;
assert.ok(Object.keys(registered).length >= 2000, 'Blender\'s startup registers its classes');
assert.equal(count(/_HT_/), 26, 'every header Blender registers');
for (const name of ['VIEW3D_MT_object', 'VIEW3D_MT_add', 'TOPBAR_MT_file', 'OUTLINER_HT_header', 'PROPERTIES_PT_navigation_bar', 'NODE_MT_add'])
  assert.ok(name in registered, `${name} is registered`);
assert.equal(registered.VIEW3D_MT_object.bl_label, 'Object');
console.log(`Blender's Python: ${Object.keys(registered).length} classes registered in ${Math.round(performance.now() - started)} ms`);

// Blender's Python operators are Blender's operator types, run by Blender on Main through Bylonder's registry, with
// their snippets evaluated as Python (wm.py's context operators exec "context.<path> += self.value"), and bpy.ops calls
// Bylonder's operators.
const { module, registerPythonOperators } = await import('../src/python/bpy_interface.js');
const { runOperator, registerOperator } = await import('../src/windowmanager/wm-operators.js');
const { BlenderMain } = await import('../src/bmesh/bmesh-wasm.js');
const { setContextPointer, contextStruct } = await import('../src/python/bpy_rna.js');
const blender = new BlenderMain();
setContextPointer(blender.C);
registerPythonOperators((idname, props) => (blender.run(idname, props).status & 4 ? 'FINISHED' : 'CANCELLED'), () => {});
const scene = contextStruct().scene, gravity = scene.use_gravity;
runOperator('wm.context_toggle', { data_path: 'scene.use_gravity' });
assert.equal(scene.use_gravity, !gravity, 'wm.context_toggle toggles the property at its path');
scene.frame_current = 3;
runOperator('wm.context_set_int', { data_path: 'scene.frame_current', value: 10, relative: true });
assert.equal(scene.frame_current, 13, 'wm.context_set_int adds to it when relative');
const ran = [];
registerOperator('object.select_all', { run: (props) => ran.push(props) });
assert.deepEqual([...module('bpy').ops.object.select_all({ action: 'TOGGLE', __kwargtrans__: null })], ['FINISHED']);
assert.deepEqual(ran, [{ action: 'TOGGLE' }], 'bpy.ops runs the operator Bylonder registered');
assert.equal(module('bpy').path.display_name('2D_Animation'), '2D Animation', 'bpy.path.display_name, which File > New draws templates with');

// Every menu and header draws in Blender's default context except those that read an editor's data (a space, a node
// tree, an image): a gap in the runtime or the boundary fails many draws at once.
const { menus, headers, setContext } = await import('../src/python/bpy_interface.js');
const { UILayout } = await import('../src/editors/interface/layout.js');
const types = [...Object.values(menus), ...Object.values(headers)];
const drawn = types.filter((type) => {
  try {
    setContext({});
    Object.assign(type(), { layout: new UILayout() }).draw(module('_bpy').context);
    return true;
  } catch {
    return false;
  }
}).length;
assert.ok(drawn >= 517, `${drawn} of ${types.length} menus and headers draw without an editor's data`);

// Blender's Python operators' polls run in Blender's default context except those that read an editor's data.
const operators = Object.entries(registered).filter(([idname, cls]) => idname.includes('.') && cls.poll);
const polled = operators.filter(([, cls]) => {
  try {
    setContext({});
    cls.poll(module('_bpy').context);
    return true;
  } catch {
    return false;
  }
}).length;
assert.ok(polled >= 109, `${polled} of ${operators.length} Python operator polls run without an editor's data`);
setContext({ mode: 'OBJECT', active_object: null });
assert.equal(registered['object.quick_fur'].poll(module('_bpy').context), false, 'Add > Curve > Fur: no active mesh, with its poll message set');
