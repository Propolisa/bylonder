// Every operator the 3D View's Edit Mode menus run (view3d-menus-edit-mesh.js) runs Blender's own code to the end:
// each is called with its menu's properties on a cube and a grid in each select mode its menu offers it in, with
// everything selected, and must finish or cancel as Blender's operator decides, never reach code the module lacks.
import assert from 'node:assert/strict';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { EditMesh, OPERATOR_FINISHED, OPERATOR_CANCELLED } from '../src/bmesh/bmesh-wasm.js';
import { editMeshMenus } from '../src/editors/space_view3d/view3d-menus-edit-mesh.js';
import { hasMeshOperator } from '../src/editors/mesh/editmesh-tools.js';

// What the menus call, as [idname, props, the select modes the menus offer it in]; transforms and modal tools are the
// editor's own.
const calls = new Map();
const record = (idname, props = {}) => {
  const key = idname + JSON.stringify(props);
  calls.set(key, [idname, props, [...(calls.get(key)?.[2] ?? []), selectmode]]);
};
let selectmode = 1;
const menus = editMeshMenus({
  exec: record, move: record, slide: record, start() {}, extrudeMove() {}, inset() {}, bevel() {}, loopcut() {}, selectBox() {},
  mergeMenu: () => [], selectmode: () => selectmode, totals: () => ({ totvertsel: 1, totedgesel: 1, totfacesel: 1 }),
});
const visit = (items) => (typeof items === 'function' ? items() : items).forEach((item) => {
  if (item === '-') return;
  if (item.items) visit(item.items);
  else item.run();
});
for (selectmode of [1, 2, 4]) for (const name of ['select', 'mesh', 'vertex', 'edge', 'face']) visit(menus[name]);

const MESHES = [['mesh.primitive_cube_add', {}], ['mesh.primitive_grid_add', { x_subdivisions: 4, y_subdivisions: 4 }]];
const failures = [], finished = new Set();
for (const [idname, props, modes] of calls.values()) {
  if (!hasMeshOperator(idname)) { failures.push(`${idname}: not in the module`); continue; }
  for (const [primitive, primitiveProps] of MESHES) for (const mode of modes) {
    const edit = EditMesh.fromMesh(primitive_add(primitive, primitiveProps), mode);
    try {
      edit.run('mesh.select_all', { action: 'SELECT' });
      const { status } = edit.run(idname, props);
      if (status & OPERATOR_FINISHED) finished.add(idname);
      else if (!(status & OPERATOR_CANCELLED)) failures.push(`${idname} ${JSON.stringify(props)}: does not poll`);
      edit.toMesh();
    } catch (error) {
      failures.push(`${idname} ${JSON.stringify(props)} on ${primitive} in mode ${mode}: ${error.message.split('\n')[0]}`);
    } finally {
      edit.free();
    }
  }
}
const operators = new Set([...calls.values()].map(([idname]) => idname));
assert.deepEqual(failures, [], `Edit Mode menu operators that fail:\n${failures.join('\n')}`);
assert.ok(operators.size >= 80);
console.log(`Edit Mode menus: ${operators.size} operators (${calls.size} menu entries) run Blender's code on a cube and a grid in the select modes they are offered in; ${finished.size} of them finish there`);
