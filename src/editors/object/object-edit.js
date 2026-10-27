// Entering and leaving Edit Mode (object_edit.cc) and what Edit Mode does with the mouse and keys. While editing,
// the object's BMesh is the truth: every change converts it back to Mesh data (for drawing, undo and scene edits).
import { Matrix, Ray, Vector3, VertexData } from '@babylonjs/core';
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT, BM_elem_flag_test } from '../../bmesh/intern/bmesh-class.js';
import { BM_face_normal_update } from '../../bmesh/intern/bmesh-polygon.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { SCE_SELECT_VERTEX, BM_mesh_select_mode_flush, BM_select_history_active_get } from '../../bmesh/intern/bmesh-marking.js';
import { EDBM_select_pick, EDBM_edge_find_nearest, edbm_select_loop, mesh_select_all, mesh_select_mode, edbm_select_linked_pick } from '../mesh/editmesh-select.js';
import { startGestureBox } from '../../windowmanager/wm-gesture-box.js';
import { do_mesh_box_select, SEL_OP_ADD, SEL_OP_SUB, SEL_OP_SET } from '../space_view3d/view3d-select.js';
import { initTransform, createSpaceNormal, toBlender, view3d_pixel_size } from '../transform/transform.js';
import { createTransMesh } from '../transform/transform-mesh.js';
import { beginEdgeSlide } from '../transform/transform-mesh-edge-slide.js';
import { meshOperators } from '../mesh/editmesh-tools.js';
import { loopcut_modal } from '../mesh/editmesh-loopcut.js';
import { inset_modal } from '../mesh/editmesh-inset.js';
import { bevel_modal } from '../mesh/editmesh-bevel.js';
import { openMenu } from '../interface/menu.js';
import { createRedoPanel } from '../interface/redo-panel.js';
import { operatorSchema } from './mesh-catalog.js';
import rna from '../../makesrna/rna-operators.json' with { type: 'json' };
import { primitive_add } from '../mesh/editmesh-add.js';
import { mesh_serialize, mesh_deserialize } from '../../blenkernel/mesh/mesh.js';
import { mesh_from_vertex_data } from '../../blenkernel/mesh/mesh-from-babylon.js';
import { mesh_batch_cache_apply } from '../../draw/mesh-batch-cache.js';
import { createEditMeshOverlay } from '../../draw/overlay-edit-mesh.js';
import { createKeymap } from '../../windowmanager/input/keymap.js';

// VIEW3D_MT_edit_mesh_delete, as far as its operators are ported.
const DELETE_ITEMS = [['VERT', 'Vertices'], ['EDGE', 'Edges'], ['FACE', 'Faces'], ['EDGE_FACE', 'Only Edges & Faces'], ['ONLY_FACE', 'Only Faces']];
const MERGE_ITEMS = [['CENTER', 'At Center'], ['CURSOR', 'At Cursor'], ['COLLAPSE', 'Collapse'], ['FIRST', 'At First'], ['LAST', 'At Last']];
const ACTIVE_TYPE = { [BM_VERT]: 'vert', [BM_EDGE]: 'edge', [BM_FACE]: 'face' };

// The Mesh an object's geometry comes from: its saved Mesh, its Blender primitive, or its Babylon geometry welded.
export function objectMesh(node) {
  const creation = node.metadata?.wbCreation;
  if (creation?.mesh) return mesh_deserialize(creation.mesh);
  if (creation?.operator) return primitive_add(creation.operator, creation.options);
  return mesh_from_vertex_data(VertexData.ExtractFromMesh(node));
}

export function createEditMode({ world, editor, views, history, notify, changed }) {
  const { scene } = world;
  let em = null;
  const redo = createRedoPanel(document.querySelector('#redo-panel'));
  // scene.tool_settings.mesh_select_mode, kept across Edit Mode sessions as in Blender.
  let selectmode = SCE_SELECT_VERTEX;

  const editable = (node) => node?.getTotalVertices && !node.metadata?.wbCreation?.text && !node.metadata?.group;
  const reason = (node) => (node.metadata?.wbModifiers?.length ? 'Edit Mode on objects with modifiers comes with modifiers on Mesh data.' : null);

  // Converts the BMesh back to Mesh data, redraws and, for an operator, records an undo step (or, with `amend`,
  // replaces the last one).
  function sync({ commit = true, amend = false } = {}) {
    const { bm, object } = em;
    const mesh = BM_mesh_bm_to_me(bm);
    em.elems = { v: [], e: [], f: [] };
    for (const name of ['v', 'e', 'f']) BM_ITER_MESH(bm[name], (i) => { em.elems[name][bm[name].index[i]] = i; });
    em.mesh = mesh;
    mesh_batch_cache_apply(mesh, object);
    const active = BM_select_history_active_get(bm);
    em.overlay.update(mesh, { selectmode: bm.selectmode, active: active && { type: ACTIVE_TYPE[active.htype], index: bm[{ [BM_VERT]: 'v', [BM_EDGE]: 'e', [BM_FACE]: 'f' }[active.htype]].index[active.ele] } });
    if (commit || amend) object.metadata = { ...object.metadata, wbCreation: { mesh: mesh_serialize(mesh) } };
    if (amend) history.amend();
    else if (commit) {
      redo.hide();
      history.commit();
    }
    changed();
    world.onModeChange?.();
  }

  function load(mesh) {
    const bm = BM_mesh_bm_from_me(mesh);
    bm.selectmode = selectmode;
    BM_mesh_select_mode_flush(bm);
    return bm;
  }

  const activeObject = () => editor.selection.nodes.at(-1);

  function enter(object = activeObject()) {
    if (em || !editable(object)) return false;
    const why = reason(object);
    if (why) { notify(why); return false; }
    editor.finish(false);
    editor.setMode('select');
    em = { object, bm: load(objectMesh(object)), overlay: createEditMeshOverlay(object) };
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
    em.object.metadata = { ...em.object.metadata, editing: false };
    em = null;
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
        return hit?.hit ? em.elems.f[em.mesh.corner_tri_faces()[hit.faceId]] ?? -1 : -1;
      },
    };
  }

  const run = (fn) => () => { fn(em.bm); sync(); };
  // The Normal orientation, Z along the summed normals of the selected faces, for a move constrained to it.
  function normalOrientation() {
    const { bm, object } = em, sum = [0, 0, 0];
    BM_ITER_MESH(bm.f, (f) => {
      if (!BM_elem_flag_test(bm.f, f, BM_ELEM_SELECT)) return;
      BM_face_normal_update(bm, f);
      for (let a = 0; a < 3; a++) sum[a] += bm.f.no[f * 3 + a];
    });
    const normal = Vector3.TransformNormal(new Vector3(sum[0], sum[2], sum[1]), object.computeWorldMatrix(true));
    return { type: 'NORMAL', matrix: createSpaceNormal(toBlender(normal)), axis: 'Z' };
  }
  // view3d.edit_mesh_extrude_move_normal: extrude, then move along the normal when faces were selected.
  function extrudeMove() {
    const faces = em.bm.totfacesel > 0;
    if (!meshOperators['mesh.extrude_region'](em.bm, {})) { notify('Not a valid selection for extrude'); return; }
    sync({ commit: false });
    editor.start('move', { orient: faces ? 'NORMAL' : undefined, keep: true });
    if (!editor.modal) sync();
  }
  // Runs an operator as one undo step; one with visible properties opens Adjust Last Operation, which re-runs it
  // from the Mesh as it was before.
  function exec(idname, props = {}) {
    const before = BM_mesh_bm_to_me(em.bm);
    // An operator may return its report.
    const run = (values) => { const report = meshOperators[idname](em.bm, values); if (typeof report === 'string') notify(report); };
    run(props);
    selectmode = em.bm.selectmode;
    sync();
    const schema = operatorSchema(idname);
    if (!Object.keys(schema).length) return;
    const values = { ...Object.fromEntries(Object.entries(schema).map(([key, def]) => [key, def.default])), ...props };
    redo.show({
      title: rna[idname].name,
      schema,
      values,
      apply(next) {
        em.bm = load(before);
        run(next);
        sync({ amend: true });
      },
    });
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
  const loopcut = () => startTool((end) => loopcut_modal({
    bm: () => em.bm,
    owner: em.object,
    adapter: viewAdapter,
    notify,
    end,
    // mesh.loopcut_slide: the cut, then Edge Slide.
    confirm: (eed, number_cuts) => {
      exec('mesh.loopcut', { edge_index: em.bm.e.index[eed], number_cuts });
      editor.start('edge_slide');
    },
  }));
  // A modal mesh tool (mesh.inset, mesh.bevel): the median point of the selection on screen, previews from the Mesh as
  // it was, then one undo step with its redo panel.
  function meshModal(operator, modal, extra = {}) {
    const view = views.input, before = BM_mesh_bm_to_me(em.bm), world_m = em.object.computeWorldMatrix(true);
    const median = [0, 0, 0];
    let count = 0;
    BM_ITER_MESH(em.bm.v, (v) => { if (BM_elem_flag_test(em.bm.v, v, BM_ELEM_SELECT)) { for (let a = 0; a < 3; a++) median[a] += em.bm.v.co[v * 3 + a]; count++; } });
    if (!count) return;
    const center = Vector3.TransformCoordinates(new Vector3(median[0] / count, median[2] / count, median[1] / count), world_m);
    const screen = viewAdapter(view).project([median[0] / count, median[1] / count, median[2] / count]) ?? [0, 0];
    const scale = new Vector3();
    world_m.decompose(scale);
    const restore = () => { em.bm = load(before); };
    startTool((end) => modal({
      ...extra,
      center: { x: screen[0], y: screen[1] },
      mouse: [editor.pointer.x, editor.pointer.y],
      pixel_size: view3d_pixel_size(view, center) / Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)),
      preview(props) { restore(); meshOperators[operator](em.bm, props); sync({ commit: false }); },
      confirm(props) { restore(); exec(operator, props); },
      cancel() { restore(); sync({ commit: false }); },
      notify,
      end,
    }));
  }
  const inset = () => em.bm.totfacesel && meshModal('mesh.inset', inset_modal);
  const bevel = (affect) => meshModal('mesh.bevel', bevel_modal, { props: { affect } });
  // view3d.select_box: a box gesture, begun at the drag's press or (from B) at the next press.
  const MODES = { SET: SEL_OP_SET, ADD: SEL_OP_ADD, SUB: SEL_OP_SUB };
  const selectBox = (event, mode, begun = true) => startGestureBox(wm(), {
    begin: begun ? { x: event.x, y: event.y } : null,
    mode,
    select: (rect, m) => { if (em && do_mesh_box_select(em.bm, viewAdapter(event.view ?? views.input), rect, MODES[m])) sync(); },
  });
  const selectPick = (event, toggle) => { if (EDBM_select_pick(em.bm, viewAdapter(event.view), [event.x, event.y], { toggle })) sync(); };
  // mesh.loop_select and mesh.edgering_select pick the nearest edge, whatever the select mode.
  const loopPick = (event, props) => {
    const eed = EDBM_edge_find_nearest(em.bm, viewAdapter(event.view), [event.x, event.y]);
    if (eed < 0) return;
    edbm_select_loop(em.bm, eed, props);
    sync();
  };
  // VIEW3D_MT_edit_mesh_normals (the part that is ported).
  const normalsMenu = () => [
    { label: 'Flip', blender: 'mesh.flip_normals', run: () => exec('mesh.flip_normals') },
    { label: 'Recalculate Outside', blender: 'mesh.normals_make_consistent', keys: 'Shift N', run: () => exec('mesh.normals_make_consistent', { inside: false }) },
    { label: 'Recalculate Inside', blender: 'mesh.normals_make_consistent', keys: 'Shift Ctrl N', run: () => exec('mesh.normals_make_consistent', { inside: true }) },
  ];
  // VIEW3D_MT_edit_mesh_merge: At First and At Last only when the selection history starts or ends with a vert.
  const mergeMenu = () => {
    const history = em.bm.selected, vert = (ese) => ese?.htype === BM_VERT && em.bm.selectmode & SCE_SELECT_VERTEX;
    const cursor = toBlender(Vector3.TransformCoordinates(Vector3.Zero(), Matrix.Invert(em.object.computeWorldMatrix(true))));
    return [
      ...MERGE_ITEMS.filter(([type]) => (type !== 'FIRST' || vert(history[0])) && (type !== 'LAST' || vert(history.at(-1))))
        .map(([type, label]) => ({ label, blender: 'mesh.merge:' + type, run: () => exec('mesh.merge', { type, cursor }) })),
      '-',
      { label: 'By Distance', blender: 'mesh.remove_doubles', run: () => exec('mesh.remove_doubles') },
    ];
  };
  const linkedPick = (event, deselect) => { if (edbm_select_linked_pick(em.bm, viewAdapter(event.view), [event.x, event.y], { deselect })) sync(); };
  const inView = (event) => !!event.view;
  const deleteMenu = () => [
    ...DELETE_ITEMS.map(([type, label]) => ({ label, blender: 'mesh.delete:' + type, run: () => exec('mesh.delete', { type }) })),
    '-',
    { label: 'Dissolve Vertices', blender: 'mesh.dissolve_verts', run: () => exec('mesh.dissolve_verts') },
    { label: 'Dissolve Edges', blender: 'mesh.dissolve_edges', run: () => exec('mesh.dissolve_edges') },
    { label: 'Dissolve Faces', blender: 'mesh.dissolve_faces', run: () => exec('mesh.dissolve_faces') },
    '-',
    { label: 'Edge Collapse', blender: 'mesh.edge_collapse', run: () => exec('mesh.edge_collapse') },
  ];
  const keymap = createKeymap([
    { blender: 'mesh.select_mode', keys: '1', run: run((bm) => (selectmode = mesh_select_mode(bm, 'VERT'))) },
    { blender: 'mesh.select_mode', keys: '2', run: run((bm) => (selectmode = mesh_select_mode(bm, 'EDGE'))) },
    { blender: 'mesh.select_mode', keys: '3', run: run((bm) => (selectmode = mesh_select_mode(bm, 'FACE'))) },
    { blender: 'mesh.select_mode', keys: 'Shift 1', run: run((bm) => (selectmode = mesh_select_mode(bm, 'VERT', { use_extend: true }))) },
    { blender: 'mesh.select_mode', keys: 'Shift 2', run: run((bm) => (selectmode = mesh_select_mode(bm, 'EDGE', { use_extend: true }))) },
    { blender: 'mesh.select_mode', keys: 'Shift 3', run: run((bm) => (selectmode = mesh_select_mode(bm, 'FACE', { use_extend: true }))) },
    { blender: ['mesh.select_all', 'mesh.select_all:SELECT'], keys: 'A', run: run((bm) => mesh_select_all(bm, 'SELECT')) },
    { blender: ['mesh.select_all', 'mesh.select_all:DESELECT'], keys: 'Alt A', run: run((bm) => mesh_select_all(bm, 'DESELECT')) },
    { blender: ['mesh.select_all', 'mesh.select_all:INVERT'], keys: 'Ctrl I', run: run((bm) => mesh_select_all(bm, 'INVERT')) },
    { blender: 'mesh.select_more', keys: 'Ctrl NUMPAD_PLUS', run: () => exec('mesh.select_more') },
    { blender: 'mesh.select_less', keys: 'Ctrl NUMPAD_MINUS', run: () => exec('mesh.select_less') },
    { blender: 'mesh.select_linked', keys: 'Ctrl L', run: () => exec('mesh.select_linked') },
    { blender: 'mesh.select_linked_pick', keys: 'L', poll: inView, run: (event) => linkedPick(event, false) },
    { blender: 'mesh.select_linked_pick', keys: 'Shift L', poll: inView, run: (event) => linkedPick(event, true) },
    { blender: 'mesh.dissolve_mode', keys: 'Ctrl X', run: () => exec('mesh.dissolve_mode') },
    { blender: 'mesh.edge_face_add', keys: 'F', run: () => exec('mesh.edge_face_add') },
    { blender: 'VIEW3D_MT_edit_mesh_merge', keys: 'M', run: () => openMenu(mergeMenu(), editor.pointer, 'Merge') },
    { blender: 'mesh.hide', keys: 'H', run: () => exec('mesh.hide') },
    { blender: 'mesh.hide', keys: 'Shift H', run: () => exec('mesh.hide', { unselected: true }) },
    { blender: 'mesh.reveal', keys: 'Alt H', run: () => exec('mesh.reveal') },
    { blender: 'VIEW3D_MT_edit_mesh_delete', keys: ['X', 'Delete'], run: () => openMenu(deleteMenu(), editor.pointer, 'Delete') },
    { blender: 'view3d.edit_mesh_extrude_move_normal', keys: 'E', run: extrudeMove },
    { blender: 'mesh.loopcut_slide', keys: 'Ctrl R', run: loopcut },
    { blender: 'mesh.inset', keys: 'I', run: inset },
    { blender: 'mesh.bevel', keys: 'Ctrl B', run: () => bevel('EDGES') },
    { blender: 'mesh.quads_convert_to_tris', keys: 'Ctrl T', run: () => exec('mesh.quads_convert_to_tris', { quad_method: 'BEAUTY', ngon_method: 'BEAUTY' }) },
    { blender: 'mesh.quads_convert_to_tris', keys: 'Shift Ctrl T', run: () => exec('mesh.quads_convert_to_tris', { quad_method: 'FIXED', ngon_method: 'CLIP' }) },
    { blender: 'mesh.tris_convert_to_quads', keys: 'Alt J', run: () => exec('mesh.tris_convert_to_quads') },
    { blender: 'mesh.normals_make_consistent', keys: 'Shift N', run: () => exec('mesh.normals_make_consistent', { inside: false }) },
    { blender: 'mesh.normals_make_consistent', keys: 'Shift Ctrl N', run: () => exec('mesh.normals_make_consistent', { inside: true }) },
    { blender: 'VIEW3D_MT_edit_mesh_normals', keys: 'Alt N', run: () => openMenu(normalsMenu(), editor.pointer, 'Normals') },
    { blender: 'mesh.bevel', keys: 'Shift Ctrl B', run: () => bevel('VERTICES') },
    { blender: 'mesh.loop_select', keys: 'Alt LEFTMOUSE CLICK', poll: inView, run: (event) => loopPick(event, {}) },
    { blender: 'mesh.loop_select', keys: 'Shift Alt LEFTMOUSE CLICK', poll: inView, run: (event) => loopPick(event, { toggle: true }) },
    { blender: 'mesh.edgering_select', keys: 'Ctrl Alt LEFTMOUSE CLICK', poll: inView, run: (event) => loopPick(event, { ring: true }) },
    { blender: 'mesh.edgering_select', keys: 'Shift Ctrl Alt LEFTMOUSE CLICK', poll: inView, run: (event) => loopPick(event, { ring: true, toggle: true }) },
    { blender: 'transform.translate', keys: 'G', run: () => editor.start('move') },
    { blender: 'transform.rotate', keys: 'R', run: () => editor.start('rotate') },
    { blender: 'transform.resize', keys: 'S', run: () => editor.start('scale') },
  ], ['Mesh']);
  const viewKeymap = createKeymap([
    { blender: 'view3d.select', keys: 'LEFTMOUSE CLICK', poll: inView, run: (event) => selectPick(event, false) },
    { blender: 'view3d.select', keys: 'Shift LEFTMOUSE CLICK', poll: inView, run: (event) => selectPick(event, true) },
    { blender: 'view3d.select_box', keys: 'B', run: (event) => selectBox(event, 'SET', false) },
  ], ['3D View']);
  const toolKeymap = createKeymap([
    { blender: 'view3d.select_box', keys: 'LEFTMOUSE CLICK_DRAG', poll: inView, run: (event) => selectBox(event, 'SET') },
    { blender: 'view3d.select_box', keys: 'Shift LEFTMOUSE CLICK_DRAG', poll: inView, run: (event) => selectBox(event, 'ADD') },
    { blender: 'view3d.select_box', keys: 'Ctrl LEFTMOUSE CLICK_DRAG', poll: inView, run: (event) => selectBox(event, 'SUB') },
  ], ['3D View Tool: Select Box']);
  const modeKeys = createKeymap([
    { blender: 'object.mode_set', keys: 'Tab', poll: () => !!em || editable(activeObject()), run: () => (em ? exit() : enter()) },
  ], ['Object Non-modal']);

  return {
    get active() { return !!em; },
    get object() { return em?.object ?? null; },
    get selectmode() { return em?.bm.selectmode ?? selectmode; },
    // stats_object_edit: selected and total elements, and the triangle count.
    get stats() {
      if (!em) return null;
      const { bm } = em;
      return { verts: [bm.totvertsel ?? 0, bm.totvert], edges: [bm.totedgesel ?? 0, bm.totedge], faces: [bm.totfacesel ?? 0, bm.totface], tris: bm.totloop - 2 * bm.totface };
    },
    enter,
    exit,
    toggle: () => (em ? exit() : enter()),
    setSelectMode(type, extend = false) { if (em) run((bm) => (selectmode = mesh_select_mode(bm, type, { use_extend: extend })))(); },
    exec(idname, props) { if (em) exec(idname, props); },
    deleteMenu,
    mergeMenu: () => (em ? mergeMenu() : []),
    normalsMenu: () => (em ? normalsMenu() : []),
    extrudeMove() { if (em) extrudeMove(); },
    selectAll(action) { if (em) run((bm) => mesh_select_all(bm, action))(); },
    loopcut() { if (em) loopcut(); },
    inset() { if (em) inset(); },
    bevel(affect = 'EDGES') { if (em) bevel(affect); },
    // Tab in both modes; the Mesh, 3D View and Select Box tool keymaps in Edit Mode.
    keymap: (event) => modeKeys(event) || (!!em && (keymap(event) || viewKeymap(event) || toolKeymap(event))),
    // A modal transform of the selection; Mesh data is rewritten on every move and saved on confirm.
    // `orient: 'NORMAL'` constrains to the selection's normal; `keep` records an undo step even when cancelled, for
    // the operator that ran first (extrude).
    transform(type, view, mouse, { orient, keep } = {}) {
      if (!em) return null;
      const changed = (fn) => (...args) => { const result = fn(...args); sync({ commit: false }); return result; };
      let session;
      if (type === 'edge_slide') {
        const slide = beginEdgeSlide(em.bm, em.object, view, mouse);
        if (!slide) { notify('Invalid Edge Selection'); return null; }
        const handled = (fn) => (...args) => fn(...args) && (sync({ commit: false }), true);
        session = Object.assign(Object.create(slide), { update: changed(slide.update), keymap: handled(slide.keymap), numinput: handled(slide.numinput), cancel: changed(slide.cancel) });
      } else {
        const data = createTransMesh(em.bm, em.object);
        if (!data) return null;
        session = initTransform(type, { ...data, apply: changed(data.apply), restore: changed(data.restore) }, view, mouse, { orient: orient === 'NORMAL' ? normalOrientation() : undefined });
      }
      return Object.assign(Object.create(session), { keep, finish(commit) { if (!commit) session.cancel(); sync({ commit: commit || keep }); } });
    },
    // After undo or redo: the object's restored Mesh becomes the BMesh again.
    reload() {
      if (!em) return;
      if (!em.object.metadata?.wbCreation?.mesh || em.object.metadata?.wbDeleted) { exit(); return; }
      em.bm = load(mesh_deserialize(em.object.metadata.wbCreation.mesh));
      sync({ commit: false });
    },
    dispose() { endTool(); em?.overlay.dispose(); em = null; redo.dispose(); },
  };
}
