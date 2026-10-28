// The 3D View's Edit Mode tools that run Blender's modal operators in WebAssembly, used as in Blender 5.2: each
// fixture (tools/blender-reference/tool-fixtures.py) gives Blender's startup cube, the view and the input, the tool's
// keymap gives the operator, its modal keymap the modal events, and the edit mesh must end as Blender's did.
// ONLY=prefix runs the fixtures whose tools start with it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EditMesh, meshFromFaces, OPERATOR_RUNNING_MODAL, OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { defaultKeymaps, modalItem } from '../src/windowmanager/keyconfig.js';
import { dragDirection, WM_DRAG_THRESHOLD_MOUSE } from '../src/windowmanager/wm-event-system.js';
import { SCE_SELECT_VERTEX } from '../src/bmesh/intern/bmesh-marking.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/tools/edit-mesh.json', import.meta.url), 'utf8'))
  .filter(({ tool }) => tool.startsWith(process.env.ONLY ?? ''));
const keymaps = new Map(defaultKeymaps().map(([name, , { items }]) => [name, items]));
// The tools' keymaps, as their definitions in Blender's toolbar name them.
const TOOL_KEYMAPS = {
  'builtin.shrink_fatten': 'Shrink/Fatten', 'builtin.push_pull': 'Push/Pull', 'builtin.to_sphere': 'To Sphere',
  'builtin.smooth': 'Smooth', 'builtin.randomize': 'Randomize', 'builtin.vertex_slide': 'Vertex Slide',
  'builtin.spin': 'Spin', 'builtin.rip_region': 'Rip Region', 'builtin.knife': 'Knife', 'builtin.extrude_to_cursor': 'Extrude to Cursor',
};
const keymapOf = (tool) => (tool === 'builtin.shear' ? '3D View Tool: Shear' : `3D View Tool: Edit Mesh, ${TOOL_KEYMAPS[tool]}`);
// A macro's operators (wmOperatorTypeMacro), each with its own properties.
const MACROS = { 'mesh.rip_move': ['mesh.rip', 'transform.translate'] };
const macroProperty = (idname) => { const [group, name] = idname.split('.'); return `${group.toUpperCase()}_OT_${name}`; };

// Blender's window manager for one tool over the fixture's events: a press that moves past the drag threshold
// becomes CLICK_DRAG where it passes it; an event the tool's keymap takes invokes its operator (a macro's in turn), a
// running operator gets the events after (its modal keymap's items as items), and a mouse move once it starts
// (WM_event_add_mousemove). Returns the last operator's status.
function replay(edit, tool, events) {
  let press = null, op = null, keymap = '', status = 0;
  const wmEvent = (type, value, x, y) => ({ type, value, x, y, prevType: 'LEFTMOUSE', prevValue: 'PRESS' });
  const modal = (event) => {
    const item = keymap && modalItem(keymap, { type: event.type.toLowerCase(), value: event.value }, (id) => edit.modalItem(op, id) >= 0);
    status = edit.modal(op, item ? { ...event, modal: edit.modalItem(op, item) } : event);
    if (!(status & OPERATOR_RUNNING_MODAL)) op = null;
  };
  const invoke = (event) => {
    const direction = event.value === 'CLICK_DRAG' ? dragDirection(event.x - press.x, press.y - event.y) : undefined;
    const found = keymaps.get(keymapOf(tool)).find(([, kmi]) => kmi.type === event.type && kmi.value === event.value &&
      (!kmi.direction || kmi.direction === 'ANY' || kmi.direction === direction));
    if (!found) return;
    const [idname, , data] = found, props = Object.fromEntries(data?.properties ?? []);
    for (const step of MACROS[idname] ?? [idname]) {
      ({ status, op, keymap } = edit.invoke(step, MACROS[idname] ? Object.fromEntries(props[macroProperty(step)] ?? []) : props, event));
      if (op) { modal(wmEvent('MOUSEMOVE', 'NOTHING', event.x, event.y)); return; }
      if (!(status & OPERATOR_FINISHED)) return;
    }
  };
  for (const [type, value, x, y] of events) {
    const event = wmEvent(type, value, x, y);
    if (type === 'LEFTMOUSE' && value === 'PRESS') press = { x, y, dragged: false };
    if (op) modal(event);
    else if (type === 'MOUSEMOVE' && press && !press.dragged && Math.hypot(x - press.x, y - press.y) >= WM_DRAG_THRESHOLD_MOUSE) {
      press.dragged = true;
      invoke(wmEvent('LEFTMOUSE', 'CLICK_DRAG', x, y));
    } else invoke(event);
    if (type === 'LEFTMOUSE' && value === 'RELEASE') press = null;
  }
  return status;
}

// Order-free positions, rounded as far as single-precision float math across compilers agrees. Extrude to Cursor
// projects the mouse through the inverse of a perspective matrix with a 0.01 clip start, whose rounding differs between
// Blender's x86 build (Eigen's SSE 4x4 inverse) and WebAssembly's scalar one by a tenth of a pixel.
const PRECISION = { 'builtin.extrude_to_cursor': 1e3 };
const positions = (p, scale) => Array.from({ length: p.length / 3 }, (_, v) => Array.from(p.slice(v * 3, v * 3 + 3), (x) => Math.round(x * scale) / scale + 0).join(',')).sort();
const topology = (m) => [m.edges.length / 2, m.face_offsets.length - 1, m.corner_verts.length];

const failures = [];
for (const fixture of fixtures) {
  const { vert_positions, face_offsets, corner_verts } = fixture.start;
  const edit = EditMesh.fromMesh(meshFromFaces(vert_positions, face_offsets, corner_verts), SCE_SELECT_VERTEX);
  try {
    edit.view = fixture.view;
    edit.run('mesh.select_all', { action: fixture.select ? 'DESELECT' : 'SELECT' });
    for (const co of fixture.select ?? []) edit.select(1, Array.from({ length: vert_positions.length / 3 }, (_, v) => v).find((v) => co.every((x, a) => vert_positions[v * 3 + a] === x)));
    edit.selectFlush();
    const status = replay(edit, fixture.tool, fixture.events);
    const mesh = edit.toMesh(), expected = fixture.mesh, found = [];
    if (!(status & OPERATOR_FINISHED)) found.push(`ended with status ${status}`);
    if (topology(mesh).join() !== topology(expected).join()) found.push(`topology ${topology(mesh)} is Blender's ${topology(expected)}`);
    else {
      const scale = PRECISION[fixture.tool] ?? 1e4;
      if (positions(mesh.vert_positions, scale).join(' ') !== positions(expected.vert_positions, scale).join(' ')) found.push('vertex positions differ');
    }
    if (found.length) failures.push(`${fixture.tool} (${fixture.operator.idname}): ${found.join('; ')}`);
  } catch (error) {
    failures.push(`${fixture.tool}: ${error.message.split('\n')[0]}`);
  } finally {
    edit.free();
  }
}
assert.deepEqual(failures, [], `Tools whose result differs from Blender's:\n${failures.join('\n')}`);
console.log(`Edit Mode tools: ${fixtures.length} tools used as in Blender 5.2 leave Blender's mesh`);
