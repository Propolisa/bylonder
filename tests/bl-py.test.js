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
