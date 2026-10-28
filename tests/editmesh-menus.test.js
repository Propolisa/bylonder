// Every operator the 3D View's Edit Mode menus (Blender's own, view3d-menus-edit-mesh.js) run runs Blender's code:
// each is called with its menu's properties on a cube and a grid in each select mode its menu offers it in, with
// everything selected, and must finish or cancel as Blender's operator decides, never reach code the module lacks.
import assert from 'node:assert/strict';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { EditMesh, OPERATOR_FINISHED, OPERATOR_CANCELLED } from '../src/bmesh/bmesh-wasm.js';
import { idleApi, visitEditMeshMenus } from '../src/editors/space_view3d/view3d-menus-edit-mesh.js';
import { hasMeshOperator } from '../src/editors/mesh/editmesh-tools.js';

// What the menus call, as [idname, props, the select modes the menus offer it in]; transforms and modal tools are the
// editor's own.
const calls = new Map();
let selectmode;
const record = (idname, props = {}) => {
  const key = idname + JSON.stringify(props);
  calls.set(key, [idname, props, [...(calls.get(key)?.[2] ?? []), selectmode]]);
};
visitEditMeshMenus(idleApi(record), (item, mode) => {
  selectmode = mode;
  if (!item.items && item.enabled()) item.run();
});

// The 3D View the menus run in: looking down the Y axis from 10 units, a 800 x 600 region.
const VIEW = {
  viewmat: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, -10, 1],
  winmat: [2.4, 0, 0, 0, 0, 3.2, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0],
  winx: 800, winy: 600, persp: true,
};
// Operators with only an invoke (mesh.rip reads the mouse) run from a mouse move at the view's center; one that goes on
// modally is cancelled.
const invokeOnly = (idname) => ['mesh.rip', 'mesh.rip_edge'].includes(idname);
function invoke(edit, idname, props) {
  const event = { type: 'MOUSEMOVE', value: 'NOTHING', x: VIEW.winx / 2, y: VIEW.winy / 2 };
  const { status, op } = edit.invoke(idname, props, event);
  return { status: op ? edit.modal(op, { ...event, type: 'ESC', value: 'PRESS' }) : status };
}
const MESHES = [['mesh.primitive_cube_add', {}], ['mesh.primitive_grid_add', { x_subdivisions: 4, y_subdivisions: 4 }]];
const failures = [], finished = new Set();
for (const [idname, props, modes] of calls.values()) {
  if (!hasMeshOperator(idname)) { failures.push(`${idname}: not in the module`); continue; }
  for (const [primitive, primitiveProps] of MESHES) for (const mode of modes) {
    const edit = EditMesh.fromMesh(primitive_add(primitive, primitiveProps), mode);
    edit.view = VIEW;
    try {
      edit.run('mesh.select_all', { action: 'SELECT' });
      const { status } = invokeOnly(idname) ? invoke(edit, idname, props) : edit.run(idname, props);
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
