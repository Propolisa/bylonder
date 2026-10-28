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

// Blender's Python operators run through Bylonder's registry, with their snippets evaluated as Python (wm.py's
// context operators exec "context.<path> += self.value"), and bpy.ops calls Bylonder's operators.
const { setContext, module } = await import('../src/python/bpy_interface.js');
const { runOperator, registerOperator } = await import('../src/windowmanager/wm-operators.js');
const space = { show_region_ui: false }, scene = { frame_current: 3 };
setContext({ space_data: space, scene });
runOperator('wm.context_toggle', { data_path: 'space_data.show_region_ui' });
assert.equal(space.show_region_ui, true, 'wm.context_toggle toggles the property at its path');
runOperator('wm.context_set_int', { data_path: 'scene.frame_current', value: 10, relative: true });
assert.equal(scene.frame_current, 13, 'wm.context_set_int adds to it when relative');
const ran = [];
registerOperator('object.select_all', { run: (props) => ran.push(props) });
assert.deepEqual([...module('bpy').ops.object.select_all({ action: 'TOGGLE', __kwargtrans__: null })], ['FINISHED']);
assert.deepEqual(ran, [{ action: 'TOGGLE' }], 'bpy.ops runs the operator Bylonder registered');
