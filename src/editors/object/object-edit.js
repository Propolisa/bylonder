// Entering and leaving Edit Mode (object_edit.cc) and what Edit Mode does with the mouse and keys. While editing,
// Blender's edit mesh (an EditMesh, in WebAssembly) is the truth: every change extracts its Mesh arrays, for drawing
// and picking, and an undo step stores them as Mesh data.
import { Matrix, Ray, Vector3 } from '@babylonjs/core';
import rnaOperators from '../../makesrna/rna-operators.json' with { type: 'json' };
import { BM_VERT, BM_EDGE, BM_FACE } from '../../bmesh/intern/bmesh-class.js';
import { SCE_SELECT_VERTEX } from '../../bmesh/intern/bmesh-marking.js';
import { EditMesh, EXTRACT_ALL, EXTRACT_TOPOLOGY, EXTRACT_POSITIONS, EXTRACT_FLAGS, OPERATOR_FINISHED } from '../../bmesh/bmesh-wasm.js';
import { EDBM_select_pick, EDBM_edge_find_nearest, EDBM_unified_findnearest, EDBM_elem_to_index_any } from '../mesh/editmesh-select.js';
import { startGestureBox } from '../../windowmanager/wm-gesture-box.js';
import { dragStart } from '../../windowmanager/wm-event-system.js';
import { do_mesh_region_select, boxRegion, SEL_OPS } from '../space_view3d/view3d-select.js';
import { regionView3D, viewProjection, toBlender, toBlenderMatrix } from '../space_view3d/view3d-project.js';
import { runModal, modifierFlags } from '../space_view3d/view3d-modal.js';
import { meshOperator, editBMesh, runsMeshOperator } from '../mesh/editmesh-tools.js';
import { loopcut_modal } from '../mesh/editmesh-loopcut.js';
import { redoProperties } from '../interface/hud.js';
import { mesh_serialize, mesh_deserialize } from '../../blenkernel/mesh/mesh.js';
import { objectMesh } from './object-mesh.js';
import { mesh_batch_cache_apply } from '../../draw/mesh-batch-cache.js';
import { createEditMeshOverlay } from '../../draw/overlay-edit-mesh.js';
import { createKeymap } from '../../windowmanager/input/keymap.js';
import { editMeshMenus, editMeshActions } from '../space_view3d/view3d-menus-edit-mesh.js';
import { registerOperator, registerOperators } from '../../windowmanager/wm-operators.js';
import { drawCallbackAdd, css, THEME } from '../../draw/overlay-tool.js';

const ACTIVE_TYPE = { [BM_VERT]: 'vert', [BM_EDGE]: 'edge', [BM_FACE]: 'face' };
// Operators a macro invokes with its event, since they act where the mouse is.
// Operators whose invoke reads the mouse or the view, run with their event as Blender's window manager runs them.
const MOUSE_OPERATORS = new Set(['mesh.knife_tool', 'mesh.dupli_extrude_cursor', 'mesh.polybuild_delete_at_cursor', 'mesh.spin', 'mesh.bisect']);

const MESH_MODES = ['OBJECT', 'EDIT', 'SCULPT', 'VERTEX_PAINT', 'WEIGHT_PAINT', 'TEXTURE_PAINT'];

// A dashed line in the view's overlay color (ED_region_draw_mouse_line_cb, wm_gesture_draw_line).
function drawDashedLine(ctx, [[x0, y0], [x1, y1]]) {
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(THEME.view_overlay);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export function createEditMode({ world, editor, views, history, notify, changed }) {
  const { scene } = world;
  let em = null;
  const redo = world.hud;
  // scene.tool_settings.mesh_select_mode, kept across Edit Mode sessions as in Blender.
  let selectmode = SCE_SELECT_VERTEX;

  const editable = (node) => node?.getTotalVertices && !node.metadata?.wbCreation?.curve && !node.metadata?.group;

  // Extracts what changed of the edit mesh (`extract`, EXTRACT_*), redraws and, for an operator, records an undo step
  // (or, with `amend`, replaces the last one).
  function sync({ commit = true, amend = false, extract = EXTRACT_ALL } = {}) {
    const { edit, object } = em;
    const mesh = edit.extract(extract);
    em.mesh = mesh;
    draw(mesh, edit.history.at(-1), extract);
    if (commit || amend) object.metadata = { ...object.metadata, wbCreation: { mesh: mesh_serialize(mesh) } };
    if (amend) history.amend();
    else if (commit) {
      redo.hide();
      adjustLast.apply = null;
      history.commit();
    }
    changed();
    world.onModeChange?.();
  }

  // Draws shaded the final Mesh of the object's modifiers, or without them the edit mesh's Mesh.
  function shade(final, mesh, topology) {
    em.final = final;
    mesh_batch_cache_apply(final ?? mesh, em.object, { topology: topology || !!final });
  }

  // Draws a Mesh of an edit mesh (the edit mesh, or a preview's copy of it), its active element given as
  // { htype, index }, redrawing what changed (EXTRACT_*). With modifiers the shaded mesh is their result and the
  // overlay the edit mesh, as Blender draws without On Cage. Their result can come later, off the main thread; until
  // then the last one stays drawn.
  function draw(mesh, active, extract = EXTRACT_ALL, edit = em.edit) {
    const [topology, positions, flags] = [EXTRACT_TOPOLOGY, EXTRACT_POSITIONS, EXTRACT_FLAGS].map((what) => !!(extract & what));
    if (topology || positions) {
      const { object } = em, final = world.modifiers?.editFinal(object, mesh, edit.selectmode) ?? null;
      if (!(final instanceof Promise)) shade(final, mesh, topology);
      else final.then((result) => { if (result !== undefined && em?.object === object) shade(result, em.mesh, true); });
    }
    em.overlay.update(mesh, { selectmode: em.edit.selectmode, active: active && { type: ACTIVE_TYPE[active.htype], index: active.index }, topology, positions, flags });
  }

  // EDBM_mesh_make: the edit mesh of a Mesh, its selection flushed by the select mode.
  function load(mesh) {
    const edit = EditMesh.fromMesh(mesh, selectmode);
    edit.selectFlush();
    return edit;
  }

  const activeObject = () => editor.selection.nodes.at(-1);
  function freeEditMesh() {
    em.before?.free();
    em.edit.free();
  }

  function enter(object = activeObject()) {
    if (em || !editable(object)) return false;
    editor.setMode('select');
    em = { object, edit: load(objectMesh(object)), overlay: createEditMeshOverlay(object) };
    object.metadata = { ...object.metadata, editing: true };
    sync();
    editor.reconcile();
    return true;
  }

  function exit() {
    if (!em) return;
    endTool();
    redo.hide();
    em.overlay.dispose();
    freeEditMesh();
    em.object.metadata = { ...em.object.metadata, editing: false };
    em = null;
    world.modifiers?.refresh();
    editor.reconcile();
    history.commit();
    changed();
    world.onModeChange?.();
  }

  // The view as editmesh-select needs it: Blender-axis local coordinates to client pixels, occlusion, face picking.
  function viewAdapter(view) {
    const { object } = em, camera = view.camera;
    const world_m = object.computeWorldMatrix(true);
    const rect = view.canvas.getBoundingClientRect(), width = view.canvas.width, height = view.canvas.height;
    const transform = camera.getTransformationMatrix(), viewport = { x: 0, y: 0, width, height };
    const toWorld = (co) => Vector3.TransformCoordinates(new Vector3(co[0], co[2], co[1]), world_m);
    const eye = camera.globalPosition;
    return {
      xray: !!view.state.xray,
      project(co) {
        const p = Vector3.Project(toWorld(co), Matrix.Identity(), transform, viewport);
        return p.z < 0 || p.z > 1 ? null : [rect.left + (p.x * rect.width) / width, rect.top + (p.y * rect.height) / height, p.z];
      },
      occluded(co) {
        const target = toWorld(co), direction = target.subtract(eye), distance = direction.length();
        const hit = scene.pickWithRay(new Ray(eye, direction.normalize(), distance), (m) => m === object);
        return !!hit?.hit && hit.distance < distance * (1 - 1e-4) - 1e-4;
      },
      faceAt(x, y) {
        const p = views.pickPoint(view, x, y);
        const hit = scene.pick(p.x, p.y, (m) => m === object, false, camera);
        if (!hit?.hit) return -1;
        const face = (em.final ?? em.mesh).corner_tri_faces()[hit.faceId];
        // A final Mesh drawn while a newer one evaluates can name faces the edit mesh no longer has.
        const original = em.final ? (em.final.orig_index('FACE')?.[face] ?? -1) : face;
        return original < em.mesh.faces_num ? original : -1;
      },
    };
  }

  // Runs a select operator, recorded as an undo step through sync.
  const run = (idname, props) => () => { place(); meshOperator(em.edit, idname, props); selectmode = em.edit.selectmode; sync({ extract: EXTRACT_FLAGS }); };
  // Places the object for what operators do in world space.
  const place = () => {
    em.edit.objectToWorld = toBlenderMatrix(em.object.computeWorldMatrix(true));
    if (views.input?.camera) em.edit.view = regionView3D(views.input);
  };
  // Preselection geometry in the edit object's space, in Blender world space.
  const inWorld = (geometry) => {
    const world_m = em.object.computeWorldMatrix(true);
    const point = (co) => toBlender(Vector3.TransformCoordinates(new Vector3(co[0], co[2], co[1]), world_m));
    return Object.fromEntries(Object.entries(geometry).map(([key, points]) => [key, points.map(point)]));
  };
  // One of Blender's operators run in the module's 3D View as its window manager runs it: invoked with the event
  // (or the pointer), then given the following events while it runs modally, its modal keymap's items as items. The
  // edit mesh redraws as it changes and the view's header shows its text. A finished run is one undo step, as is a
  // cancelled one after an operator that ran first (`keep`); `then(status)` follows it, as a macro's next step.
  function moduleOperator(idname, props, event, { keep = false, commit = true, then = () => {} } = {}) {
    place();
    const before = commit && em.edit.copy();
    const view = event?.view ?? views.input, r = viewProjection(view);
    // What the operator draws while it runs: its gesture's line (Bisect's), or the line from its center to the mouse
    // (Inset's and Bevel's, ED_region_draw_mouse_line_cb).
    let running = null;
    const removeDraw = drawCallbackAdd((ctx, region) => {
      if (!running || region.view !== view) return;
      const gesture = em.edit.gesture(running), from = em.edit.mouseLine, mouse = r.toRegion([editor.pointer.x, editor.pointer.y]);
      const toCanvas = ([x, y]) => [x, r.rect.height - y];
      const line = gesture?.active ? [toCanvas(gesture.start), toCanvas(gesture.end)] : from && [toCanvas(from), mouse];
      if (line) drawDashedLine(ctx, line);
    });
    endTool();
    const run = runModal({
      wm: wm(), view, pointer: editor.pointer, target: em.edit, idname, props, event, notify,
      start: (op) => { running = op; },
      step: () => sync({ commit: false }),
      end: (status) => {
        running = null;
        endTool = () => {};
        selectmode = em.edit.selectmode;
        notify('');
        removeDraw();
        if (commit && (status & OPERATOR_FINISHED || keep)) sync();
        else sync({ commit: false });
        if (commit && status & OPERATOR_FINISHED) {
          adjustLast(idname, before, em.edit.lastValues);
          if (adjustLast.apply) adjustLast.apply.gizmos = em.edit.gizmoRequested();
        } else if (before) before.free();
        then(status);
      },
    });
    if (running) endTool = run.cancel;
    return run.status;
  }

  // A macro (wmOperatorTypeMacro): its operators in turn, each invoked with the event as Blender's macro invokes
  // them (`exec` runs one by its exec, as Loop Cut runs from the tool's preselected edge), the last one modal; one
  // undo step, kept when that one is cancelled.
  function macro(steps, event) {
    const run = (i) => {
      const [idname, props, { exec: byExec = false } = {}] = steps[i], last = i === steps.length - 1;
      if (byExec) {
        place();
        const report = meshOperator(em.edit, idname, props);
        if (report) { notify(report); return; }
        sync({ commit: false });
        run(i + 1);
        return;
      }
      moduleOperator(idname, props, event, last ? { keep: true } : { commit: false, then: (status) => { if (status & OPERATOR_FINISHED) run(i + 1); } });
    };
    run(0);
  }
  // Runs an operator as one undo step; one with visible properties opens Adjust Last Operation, which re-runs it
  // from a copy of the edit mesh as it was before.
  function exec(idname, props = {}) {
    place();
    const before = em.edit.copy();
    runExec(idname, props);
    selectmode = em.edit.selectmode;
    sync();
    adjustLast(idname, before, props);
  }
  const runExec = (idname, values) => { const report = meshOperator(em.edit, idname, values); if (report) notify(report); };
  // Adjust Last Operation for an operator that ran from `before` with `props`: its panel re-runs it by its exec, as
  // Blender's redo does; `adjustLast.apply` is that re-run, for a redo gizmo (Spin's).
  function adjustLast(idname, before, props) {
    em.before?.free();
    em.before = null;
    const names = redoProperties(idname);
    if (!names.length) { before.free(); adjustLast.apply = null; return; }
    em.before = before;
    const values = { ...Object.fromEntries(names.map((name) => [name, rnaOperators[idname].properties[name].default])), ...props };
    const apply = (next) => {
      em.edit.replace(before);
      runExec(idname, next);
      sync({ amend: true });
    };
    const show = () => redo.show({ idname, values, apply: (next) => { Object.assign(values, next); apply({ ...values }); show(); } });
    adjustLast.apply = { idname, values, apply: (next) => { Object.assign(values, next); apply({ ...values }); show(); } };
    show();
  }
  const wm = () => world.wm;
  // Starts a modal tool as a window manager modal handler; `create(end)` builds it.
  let endTool = () => {};
  function startTool(create) {
    endTool();
    let remove = null;
    const end = () => { remove?.(); remove = null; endTool = () => {}; };
    const handler = create(end);
    remove = wm().addModal(handler);
    endTool = () => handler.cancel();
    handler.mousemove?.({ x: editor.pointer.x, y: editor.pointer.y, view: views.input, shift: false, ctrl: false, alt: false });
  }
  // mesh.loopcut_slide: from a tool's press the cut at the edge ring under it at once, then Edge Slide from there;
  // otherwise the ring under the mouse previewed until a click.
  const loopcut = (event, slideProps = {}, cutProps = {}) => {
    if (event?.view) {
      const edge_index = EDBM_edge_find_nearest(em.mesh, viewAdapter(event.view), [event.x, event.y]);
      if (edge_index >= 0) macro([['mesh.loopcut', { ...cutProps, object_index: 0, edge_index }, { exec: true }], ['transform.edge_slide', slideProps]], event);
      return;
    }
    loopcutModal();
  };
  const loopcutModal = () => startTool((end) => loopcut_modal({
    mesh: em.mesh,
    bm: editBMesh(em.edit, em.mesh),
    owner: em.object,
    adapter: viewAdapter,
    notify,
    end,
    // mesh.loopcut_slide: the cut, then Edge Slide.
    confirm: (edge_index, number_cuts) => macro([['mesh.loopcut', { object_index: 0, edge_index, number_cuts }, { exec: true }], ['transform.edge_slide', {}]]),
  }));
  const inset = (event, props = {}) => moduleOperator('mesh.inset', props, event);
  const bevel = (affect, event, props = {}) => moduleOperator('mesh.bevel', { ...props, affect }, event);
  // Box, lasso and circle select: the elements in a region of the view, by eSelectOp.
  const selectRegion = (view, region, mode) => { if (em && do_mesh_region_select(em.edit, em.mesh, viewAdapter(view ?? views.input), region, SEL_OPS[mode] ?? SEL_OPS.SET)) sync({ extract: EXTRACT_FLAGS }); };
  // view3d.select_box: a box gesture, begun at the drag's press or (from B) at the next press.
  const selectBox = (event, mode, begun = true) => startGestureBox(wm(), {
    begin: begun ? dragStart(event) : null,
    mode,
    select: (rect, m) => selectRegion(event.view, boxRegion(rect), m),
  });
  const selectPick = (event, toggle) => { if (EDBM_select_pick(em.edit, em.mesh, viewAdapter(event.view), [event.x, event.y], { toggle })) sync({ extract: EXTRACT_FLAGS }); };
  // mesh.loop_select and mesh.edgering_select pick the nearest edge, whatever the select mode.
  const loopPick = (event, idname, props) => {
    const edge_index = EDBM_edge_find_nearest(em.mesh, viewAdapter(event.view), [event.x, event.y]);
    if (edge_index >= 0) run(idname, { object_index: 0, edge_index, ...props })();
  };
  const linkedPick = (event, deselect) => {
    const hit = EDBM_unified_findnearest(em.mesh, viewAdapter(event.view), [event.x, event.y], em.edit.selectmode);
    if (hit) run('mesh.select_linked_pick', { object_index: 0, index: EDBM_elem_to_index_any(em.mesh, hit), deselect })();
  };
  const menuApi = {
    context: () => world.blenderContext(views.input), edit: () => em.edit, exec, module: moduleOperator,
    inset, bevel, loopcut, selectBox: () => selectBox(editor.pointer, 'SET', false),
  };
  const menus = editMeshMenus(menuApi);
  // Blender's mesh operators the module runs, and Edit Mode's macros, modal tools and picks, by idname, for Blender's
  // Mesh keymap and menus. Transforms and box select stay the Object Mode operators, which start the same tools; adding
  // primitives stays the Add menu's.
  const inEdit = () => !!em;
  const meshOperators = Object.keys(rnaOperators).filter((id) => id.startsWith('mesh.') && !id.startsWith('mesh.primitive_') && runsMeshOperator(id));
  for (const idname of meshOperators) {
    const run = (props, event) => (MOUSE_OPERATORS.has(idname) && event?.view ? moduleOperator(idname, props, event) : exec(idname, props));
    registerOperator(idname, { poll: () => !!em && em.edit.poll(idname), run, enumItems: (prop) => em?.edit.enumItems(idname, prop) });
  }
  const pick = (select) => ({ poll: (props, event) => !!em && !!event?.view, run: (props, event) => select(event, props) });
  registerOperators({
    ...Object.fromEntries(Object.entries(editMeshActions(menuApi))
      .filter(([idname]) => idname !== 'view3d.select_box').map(([idname, run]) => [idname, { poll: inEdit, run }])),
    // A tool's drag adjusts the operator's value as it moves (WM_operator_type_modal_from_exec_for_object_edit_coords).
    ...Object.fromEntries(['mesh.vertices_smooth', 'transform.vertex_random'].map((idname) => [idname, {
      poll: () => !!em && em.edit.poll(idname),
      run: (props, event) => (props.wait_for_input === false && event?.view ? moduleOperator(idname, props, event) : exec(idname, props)),
    }])),
    'mesh.select_linked_pick': pick((event, { deselect }) => linkedPick(event, deselect)),
    'mesh.loop_select': pick((event, props) => loopPick(event, 'mesh.loop_select', props)),
    'mesh.edgering_select': pick((event, props) => loopPick(event, 'mesh.edgering_select', props)),
    // Object and Edit Mode; a mesh's other modes (object_mode_set_itemf) show greyed.
    'object.mode_set': {
      supports: ({ mode }) => mode === 'OBJECT' || mode === 'EDIT',
      poll: ({ mode }) => mode === 'OBJECT' || !!em || editable(activeObject()),
      run: ({ mode }) => (mode === 'EDIT' ? em || enter() : em && exit()),
      enumItems: (prop) => (prop === 'mode' ? rnaOperators['object.mode_set'].properties.mode.items.filter(([id]) => MESH_MODES.includes(id)) : []),
    },
  });
  const modeKeys = createKeymap([
    { blender: 'object.mode_set', keys: 'Tab', poll: () => !!em || editable(activeObject()), run: () => (em ? exit() : enter()) },
  ], ['Object Non-modal']);

  // calc_gizmo_stats for the tools' gizmos: the selected vertices' median point and the Normal orientation's Z (the
  // selected faces' normals, else the selected vertices'), in Blender world space; null without a selection.
  let stats = null;
  function gizmoStats() {
    const { mesh, object } = em, m = object.computeWorldMatrix(true), key = [mesh, ...m.m].join();
    if (stats?.key === key) return stats.value;
    const verts = mesh.attribute('.select_vert'), faces = mesh.attribute('.select_poly'), co = mesh.vert_positions, sum = [0, 0, 0], no = [0, 0, 0];
    let count = 0;
    for (let v = 0; v < mesh.verts_num; v++) if (verts[v]) { count++; for (let a = 0; a < 3; a++) sum[a] += co[v * 3 + a]; }
    const add = (normals, selected, n) => { for (let i = 0; i < n; i++) if (selected[i]) for (let a = 0; a < 3; a++) no[a] += normals[i * 3 + a]; };
    add(mesh.face_normals(), faces, mesh.faces_num);
    if (!no.some(Boolean)) add(mesh.vert_normals(), verts, mesh.verts_num);
    const center = count && toBlender(Vector3.TransformCoordinates(new Vector3(sum[0] / count, sum[2] / count, sum[1] / count), m));
    const normal = toBlender(Vector3.TransformNormal(new Vector3(no[0], no[2], no[1]), m).normalize());
    stats = { key, value: count ? { center, normal: normal.some(Boolean) ? normal : [0, 0, 1] } : null };
    return stats.value;
  }

  return {
    get active() { return !!em; },
    // One of Blender's operators run modally in the module's 3D View, as its window manager runs it (moduleOperator).
    module: (idname, props, event) => moduleOperator(idname, props, event),
    gizmoStats: () => (em ? gizmoStats() : null),
    // The Loop Cut tool's edge ring under the mouse with `cuts` cuts (VIEW3D_GGT_mesh_preselect_edgering), and the
    // Poly Build tool's element under it, which its operators then act on, with its preview
    // (VIEW3D_GGT_mesh_preselect_elem); both in Blender world space, or null.
    preselectEdgeRing(event, cuts) {
      if (!em) return null;
      const edge = EDBM_edge_find_nearest(em.mesh, viewAdapter(event.view), [event.x, event.y]);
      return edge < 0 ? null : inWorld(em.edit.preselectEdgeRing(edge, cuts));
    },
    preselectElem(event) {
      if (!em) return null;
      place();
      const [x, y] = viewProjection(event.view).toBlenderRegion([event.x, event.y]);
      const found = inWorld(em.edit.preselectElem(x, y, modifierFlags(event)));
      return found.edges.length || found.verts.length ? { ...found, remove: !!event.shift && !event.ctrl } : null;
    },
    // The active tool's gizmo group, as the module's operators see the gizmo map.
    set toolGizmoGroup(idname) { if (em) em.edit.gizmoGroup = idname; },
    // The last operator's Adjust Last Operation ({ idname, values, apply(next), gizmos }: the redo gizmos it asked
    // for), while it can be adjusted.
    get lastOperation() { return adjustLast.apply ?? null; },
    // A primitive added to the edit mesh by its operator (mesh.primitive_cube_add), as the Add Primitive tools add it.
    addPrimitive: (idname, props) => exec(idname, props),
    // Redraws the modifier result after the stack changed.
    modifiersChanged() { if (em) draw(em.mesh, em.edit.history.at(-1), EXTRACT_POSITIONS); },
    get object() { return em?.object ?? null; },
    // The edit mesh's Mesh, as drawn.
    get mesh() { return em?.mesh ?? null; },
    get selectmode() { return em?.edit.selectmode ?? selectmode; },
    // rna_Scene_editmesh_select_mode_set: the select mode, set on the edit mesh as the header buttons set it.
    set selectmode(mode) {
      if (!em) { selectmode = mode; return; }
      ['VERT', 'EDGE', 'FACE'].filter((type, i) => mode & (1 << i)).forEach((type, i) => run('mesh.select_mode', { type, use_extend: i > 0 })());
    },
    // stats_object_edit: selected and total elements, and the triangle count.
    get stats() {
      if (!em) return null;
      const t = em.edit.totals;
      return { verts: [t.totvertsel, t.totvert], edges: [t.totedgesel, t.totedge], faces: [t.totfacesel, t.totface], tris: t.totloop - 2 * t.totface };
    },
    enter,
    exit,
    toggle: () => (em ? exit() : enter()),
    // The Mesh of the object in Edit Mode, extracted from its edit mesh, which owns it while editing; null for another.
    meshOf: (node) => (em?.object === node ? em.mesh : null),
    setSelectMode(type, extend = false) { if (em) run('mesh.select_mode', { type, use_extend: extend })(); },
    // The 3D View's Edit Mode menus (view3d-menus-edit-mesh.js).
    menus,
    // Tab in both modes; picking and the Select Box tool in Edit Mode (Blender's Mesh keymap runs the rest).
    keymap: (event) => modeKeys(event),
    // view3d.select and view3d.select_box in Edit Mode, run with the event; a box begins at a drag's press, or from a
    // key at the next press.
    selectOperator(event, { toggle, select_passthrough }) {
      selectPick(event, !!toggle);
      return select_passthrough ? 'PASS_THROUGH' : 'FINISHED';
    },
    selectBox: (event, { mode = 'SET' }) => selectBox(event, mode, /mouse$/.test(event.type)),
    selectRegion,
    // After undo or redo: the object's restored Mesh becomes the edit mesh again.
    reload() {
      if (!em) return;
      if (!em.object.metadata?.wbCreation?.mesh || em.object.metadata?.wbDeleted) { exit(); return; }
      em.edit.replace(mesh_deserialize(em.object.metadata.wbCreation.mesh));
      em.edit.selectFlush();
      sync({ commit: false });
    },
    dispose() {
      endTool();
      if (em) { em.overlay.dispose(); freeEditMesh(); }
      em = null;
    },
  };
}
