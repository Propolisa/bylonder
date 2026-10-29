// The 3D View's Edit Mode tools that run Blender's modal operators on Main in WebAssembly, used as in Blender 5.2: each
// fixture (tools/blender-reference/tool-fixtures.py) gives Blender's startup cube, the view and the input, the tool's
// keymap gives the operator, its modal keymap the modal events, and the edit mesh must end as Blender's did.
// ONLY=prefix runs the fixtures whose tools start with it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { meshFromFaces, OPERATOR_RUNNING_MODAL, OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { editOnMain } from './edit-main.js';
import '../src/python/bpy_interface.js';
import { defaultKeymaps, modalItem } from '../src/windowmanager/keyconfig.js';
import { dragDirection, WM_DRAG_THRESHOLD_MOUSE } from '../src/windowmanager/wm-event-system.js';
import { SCE_SELECT_VERTEX } from '../src/bmesh/intern/bmesh-marking.js';

// Poly Build acts on the element its preselect gizmo has under the mouse, which Main's gizmo map does not have yet.
const LACKING = ['builtin.poly_build'];
const fixtures = JSON.parse(await readFile(new URL('./fixtures/tools/edit-mesh.json', import.meta.url), 'utf8'))
  .filter(({ tool }) => tool.startsWith(process.env.ONLY ?? '') && !LACKING.includes(tool));
const keymaps = new Map(defaultKeymaps().map(([name, , { items }]) => [name, items]));
// The tools' keymaps, as their definitions in Blender's toolbar name them.
const TOOL_KEYMAPS = {
  'builtin.shrink_fatten': 'Shrink/Fatten', 'builtin.push_pull': 'Push/Pull', 'builtin.to_sphere': 'To Sphere',
  'builtin.smooth': 'Smooth', 'builtin.randomize': 'Randomize', 'builtin.vertex_slide': 'Vertex Slide',
  'builtin.spin': 'Spin', 'builtin.rip_region': 'Rip Region', 'builtin.knife': 'Knife', 'builtin.extrude_to_cursor': 'Extrude to Cursor',
  'builtin.extrude_region': 'Extrude Region', 'builtin.extrude_manifold': 'Extrude Manifold', 'builtin.inset_faces': 'Inset Faces',
  'builtin.bevel': 'Bevel', 'builtin.edge_slide': 'Edge Slide', 'builtin.loop_cut': 'Loop Cut', 'builtin.bisect': 'Bisect',
  'builtin.poly_build': 'Poly Build',
};
const keymapOf = (tool) => (tool === 'builtin.shear' ? '3D View Tool: Shear' : `3D View Tool: Edit Mesh, ${TOOL_KEYMAPS[tool]}`);

// Blender's window manager for one tool over the fixture's events: a press that moves past the drag threshold
// becomes CLICK_DRAG where it passes it; an event the tool's keymap takes invokes its operator (a macro's in turn), a
// running operator gets the events after (its modal keymap's items as items), and a mouse move once it starts
// (WM_event_add_mousemove). Events carry the previous button or key event (wm_event_prev_values_set). The tools'
// gizmos stand in as Bylonder's do: Loop Cut's gives the edge Blender's had
// under it (`gizmo.edge`), and a click on a Spin button spins about its axis (`gizmo.spinAxis`). Returns the last
// operator's status.
function replay(edit, tool, events, gizmo) {
  let press = null, op = null, keymap = '', status = 0, prev = { prevType: 'NONE', prevValue: 'NOTHING' };
  const wmEvent = (type, value, x, y) => ({ type, value, x, y, ...prev });
  const modal = (event) => {
    const item = keymap && modalItem(keymap, { type: event.type.toLowerCase(), value: event.value }, (id) => edit.modalItem(op, id) >= 0);
    // A modal keymap item's event carries the event it came from as its previous one (wm_event_modalkeymap_begin).
    status = edit.modal(op, item ? { ...event, prevType: event.type, prevValue: event.value, modal: edit.modalItem(op, item) } : event);
    if (!(status & OPERATOR_RUNNING_MODAL)) op = null;
  };
  const invoke = (event) => {
    const direction = event.value === 'CLICK_DRAG' ? dragDirection(event.x - press.x, press.y - event.y) : undefined;
    const found = keymaps.get(keymapOf(tool)).find(([, kmi]) => kmi.type === event.type && kmi.value === event.value &&
      (!kmi.direction || kmi.direction === 'ANY' || kmi.direction === direction));
    if (!found) return;
    const [idname, , data] = found, props = Object.fromEntries(data?.properties ?? []);
    run(idname === 'mesh.loopcut_slide' ? loopcutSteps(props) : [[idname, props]], event);
  };
  // Operators in turn as a macro runs them, each invoked with the event (or run by its exec), until one runs modally.
  const run = (steps, event) => {
    for (const [idname, props, { exec = false } = {}] of steps) {
      ({ status, op, keymap } = exec ? edit.run(idname, props) : edit.invoke(idname, props, event));
      if (op) { modal(wmEvent('MOUSEMOVE', 'NOTHING', event.x, event.y)); return; }
      if (!(status & OPERATOR_FINISHED)) return;
    }
  };
  // ringcut_invoke from the tool: the cut at the preselected edge, then Edge Slide.
  const loopcutSteps = (props) => [
    ['mesh.loopcut', { ...Object.fromEntries(props.MESH_OT_loopcut ?? []), object_index: 0, edge_index: gizmo.edge }, { exec: true }],
    ['transform.edge_slide', Object.fromEntries(props.TRANSFORM_OT_edge_slide ?? [])],
  ];
  for (const [type, value, x, y] of events) {
    const event = wmEvent(type, value, x, y);
    if (type === 'LEFTMOUSE' && value === 'PRESS') press = { x, y, dragged: false };
    if (!op && gizmo.spinAxis && type === 'LEFTMOUSE' && value === 'PRESS') run([['mesh.spin', { axis: gizmo.spinAxis }]], event);
    else if (op) modal(event);
    else if (type === 'MOUSEMOVE' && press && !press.dragged && Math.hypot(x - press.x, y - press.y) >= WM_DRAG_THRESHOLD_MOUSE) {
      press.dragged = true;
      invoke({ ...wmEvent('LEFTMOUSE', 'CLICK_DRAG', x, y), press: [press.x, press.y] });
    } else invoke(event);
    if (type === 'LEFTMOUSE' && value === 'RELEASE') press = null;
    if (type !== 'MOUSEMOVE') prev = { prevType: type, prevValue: value };
  }
  return status;
}

// How far each of Blender's vertices is from the nearest of ours. Within single-precision rounding across compilers,
// except where a tool projects the mouse through the inverse of a perspective matrix with a 0.01 clip start (Extrude
// to Cursor, the knife's cut points, Bisect's plane): its rounding differs between Blender's x86 build (Eigen's SSE 4x4
// inverse) and WebAssembly's scalar one by about a tenth of a pixel. Bisect's plane (within 5e-4 of Blender's) meets
// the cube's edges at a shallow angle, which moves the cut points further.
const TOLERANCE = { 'builtin.extrude_to_cursor': 2e-3, 'builtin.knife': 2e-3, 'builtin.bisect': 2e-2 };
const vertices = (p) => Array.from({ length: p.length / 3 }, (_, v) => p.slice(v * 3, v * 3 + 3));
const distance = (ours, theirs) => Math.max(...vertices(theirs).map((b) => Math.min(...vertices(ours).map((a) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])))));
const topology = (m) => [m.edges.length / 2, m.face_offsets.length - 1, m.corner_verts.length];

// What the fixture's gizmo had: the edge Loop Cut's had under the mouse (by its vertices, as the edit mesh orders its
// edges anew; Blender's macro does not keep it), the axis of the Spin button clicked.
function gizmoOf({ tool, gizmo, edge, operator }, edit) {
  if (tool === 'builtin.loop_cut') {
    const pair = [...edge].sort().join(), edges = edit.toMesh().edges;
    return { edge: Array.from({ length: edges.length / 2 }, (_, e) => e).find((e) => [edges[e * 2], edges[e * 2 + 1]].sort().join() === pair) };
  }
  return gizmo === 'spin' ? { spinAxis: operator.properties.axis } : {};
}

const failures = [];
for (const fixture of fixtures) {
  const { vert_positions, face_offsets, corner_verts } = fixture.start;
  const edit = editOnMain(meshFromFaces(vert_positions, face_offsets, corner_verts), SCE_SELECT_VERTEX);
  try {
    edit.view = fixture.view;
    edit.run('mesh.select_all', { action: fixture.select ? 'DESELECT' : 'SELECT' });
    for (const co of fixture.select ?? []) edit.select(1, Array.from({ length: vert_positions.length / 3 }, (_, v) => v).find((v) => co.every((x, a) => vert_positions[v * 3 + a] === x)));
    edit.selectFlush();
    const status = replay(edit, fixture.tool, fixture.events, gizmoOf(fixture, edit));
    if (process.env.DEBUG) console.log(fixture.tool, JSON.stringify(edit.lastValues), JSON.stringify(fixture.operator.properties));
    const mesh = edit.toMesh(), expected = fixture.mesh, found = [];
    if (!(status & OPERATOR_FINISHED)) found.push(`ended with status ${status}`);
    if (topology(mesh).join() !== topology(expected).join()) found.push(`topology ${topology(mesh)} is Blender's ${topology(expected)}`);
    else if (distance(mesh.vert_positions, expected.vert_positions) > (TOLERANCE[fixture.tool] ?? 1e-4)) {
      found.push(`vertex positions differ by up to ${distance(mesh.vert_positions, expected.vert_positions).toFixed(5)}`);
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
