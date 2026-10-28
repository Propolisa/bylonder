// Entering and leaving Edit Mode (object_edit.cc) and what Edit Mode does with the mouse and keys. While editing,
// Blender's edit mesh (an EditMesh, in WebAssembly) is the truth: every change extracts its Mesh arrays, for drawing
// and picking, and an undo step stores them as Mesh data.
import { Matrix, Ray, Vector3 } from '@babylonjs/core';
import { BM_VERT, BM_EDGE, BM_FACE } from '../../bmesh/intern/bmesh-class.js';
import { SCE_SELECT_VERTEX } from '../../bmesh/intern/bmesh-marking.js';
import { EditMesh, EXTRACT_ALL, EXTRACT_TOPOLOGY, EXTRACT_POSITIONS, EXTRACT_FLAGS } from '../../bmesh/bmesh-wasm.js';
import { EDBM_select_pick, EDBM_edge_find_nearest, EDBM_unified_findnearest, EDBM_elem_to_index_any } from '../mesh/editmesh-select.js';
import { startGestureBox } from '../../windowmanager/wm-gesture-box.js';
import { do_mesh_box_select, SEL_OP_ADD, SEL_OP_SUB, SEL_OP_SET } from '../space_view3d/view3d-select.js';
import { initTransform, createSpaceNormal, toBlender, toBlenderMatrix, toBlenderView, view3d_pixel_size } from '../transform/transform.js';
import { createTransMesh } from '../transform/transform-mesh.js';
import { beginEdgeSlide } from '../transform/transform-mesh-edge-slide.js';
import { meshOperator, operatorPreview, editBMesh } from '../mesh/editmesh-tools.js';
import { loopcut_modal } from '../mesh/editmesh-loopcut.js';
import { inset_modal } from '../mesh/editmesh-inset.js';
import { bevel_modal } from '../mesh/editmesh-bevel.js';
import { openMenu } from '../interface/menu.js';
import { createRedoPanel } from '../interface/redo-panel.js';
import { operatorSchema } from './mesh-catalog.js';
import rna from '../../makesrna/rna-operators.json' with { type: 'json' };
import { mesh_serialize, mesh_deserialize } from '../../blenkernel/mesh/mesh.js';
import { objectMesh } from './object-mesh.js';
import { mesh_batch_cache_apply } from '../../draw/mesh-batch-cache.js';
import { createEditMeshOverlay } from '../../draw/overlay-edit-mesh.js';
import { createKeymap, operatorKeys } from '../../windowmanager/input/keymap.js';
import { editMeshMenus } from '../space_view3d/view3d-menus-edit-mesh.js';

const ACTIVE_TYPE = { [BM_VERT]: 'vert', [BM_EDGE]: 'edge', [BM_FACE]: 'face' };

export function createEditMode({ world, editor, views, history, notify, changed }) {
  const { scene } = world;
  let em = null;
  const redo = createRedoPanel(document.querySelector('#redo-panel'));
  // scene.tool_settings.mesh_select_mode, kept across Edit Mode sessions as in Blender.
  let selectmode = SCE_SELECT_VERTEX;

  const editable = (node) => node?.getTotalVertices && !node.metadata?.wbCreation?.text && !node.metadata?.group;

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
    editor.finish(false);
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
  // The Normal orientation, Z along the summed normals of the selected faces, for a move constrained to it.
  function normalOrientation() {
    const { mesh, object } = em, normals = mesh.face_normals(), selected = mesh.attribute('.select_poly'), sum = [0, 0, 0];
    for (let f = 0; f < mesh.faces_num; f++) if (selected[f]) for (let a = 0; a < 3; a++) sum[a] += normals[f * 3 + a];
    const normal = Vector3.TransformNormal(new Vector3(sum[0], sum[2], sum[1]), object.computeWorldMatrix(true));
    return { type: 'NORMAL', matrix: createSpaceNormal(toBlender(normal)), axis: 'Z' };
  }
  // Places the object for what operators do in world space.
  const place = () => {
    em.edit.objectToWorld = toBlenderMatrix(em.object.computeWorldMatrix(true));
    if (views.input?.camera) em.edit.view = toBlenderView(views.input.camera.getViewMatrix());
  };
  // An operator and then a transform of its result, as Blender's macros run (*_move, loopcut_slide): one undo step,
  // kept when the transform is cancelled.
  function operatorThen(transform, idname, props = {}, options = {}) {
    place();
    const report = meshOperator(em.edit, idname, props);
    if (report) { notify(report); return; }
    sync({ commit: false });
    editor.start(transform, { ...options, keep: true });
    if (!editor.modal) sync();
  }
  // An operator and then a move of its result (`normal` moves along the selection's normal).
  const operatorMove = (idname, props = {}, { normal = false } = {}) =>
    operatorThen('move', idname, props, { orient: normal ? 'NORMAL' : undefined });
  // view3d.edit_mesh_extrude_move_normal: extrude, then move along the normal when faces were selected.
  const extrudeMove = () => operatorMove('mesh.extrude_region', {}, { normal: em.edit.totals.totfacesel > 0 });
  // An operator and then Edge Slide (mesh.offset_edge_loops_slide).
  const operatorSlide = (idname, props) => operatorThen('edge_slide', idname, props);
  // Runs an operator as one undo step; one with visible properties opens Adjust Last Operation, which re-runs it
  // from a copy of the edit mesh as it was before.
  function exec(idname, props = {}) {
    place();
    const before = em.edit.copy();
    const run = (values) => { const report = meshOperator(em.edit, idname, values); if (report) notify(report); };
    run(props);
    selectmode = em.edit.selectmode;
    sync();
    em.before?.free();
    em.before = null;
    const schema = operatorSchema(idname);
    if (!Object.keys(schema).length) { before.free(); return; }
    em.before = before;
    const values = { ...Object.fromEntries(Object.entries(schema).map(([key, def]) => [key, def.default])), ...props };
    redo.show({
      title: rna[idname].name,
      schema,
      values,
      apply(next) {
        em.edit.replace(before);
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
    mesh: em.mesh,
    bm: editBMesh(em.edit, em.mesh),
    owner: em.object,
    adapter: viewAdapter,
    notify,
    end,
    // mesh.loopcut_slide: the cut, then Edge Slide.
    confirm: (edge_index, number_cuts) => operatorThen('edge_slide', 'mesh.loopcut', { object_index: 0, edge_index, number_cuts }),
  }));
  // A modal mesh tool (mesh.inset, mesh.bevel): the median point of the selection on screen, previews of the edit
  // mesh as it is, then one undo step with its redo panel.
  function meshModal(operator, modal, extra = {}) {
    const view = views.input, world_m = em.object.computeWorldMatrix(true);
    const { vert_positions, verts_num } = em.mesh, selected = em.mesh.attribute('.select_vert'), median = [0, 0, 0];
    let count = 0;
    for (let v = 0; v < verts_num; v++) if (selected[v]) { for (let a = 0; a < 3; a++) median[a] += vert_positions[v * 3 + a]; count++; }
    if (!count) return;
    const center = Vector3.TransformCoordinates(new Vector3(median[0] / count, median[2] / count, median[1] / count), world_m);
    const screen = viewAdapter(view).project([median[0] / count, median[1] / count, median[2] / count]) ?? [0, 0];
    const scale = new Vector3();
    world_m.decompose(scale);
    place();
    const run = operatorPreview(em.edit, operator);
    startTool((end) => modal({
      ...extra,
      center: { x: screen[0], y: screen[1] },
      mouse: [editor.pointer.x, editor.pointer.y],
      pixel_size: view3d_pixel_size(view, center) / Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)),
      preview(props) { run(props, (copy) => draw(copy.toMesh(), copy.history.at(-1), EXTRACT_ALL, copy)); changed(); },
      confirm(props) { exec(operator, props); },
      // The previews drew other meshes, so the edit mesh is drawn anew.
      cancel() { draw(em.mesh, em.edit.history.at(-1)); changed(); },
      notify,
      end,
    }));
  }
  const inset = () => em.edit.totals.totfacesel && meshModal('mesh.inset', inset_modal);
  const bevel = (affect) => meshModal('mesh.bevel', bevel_modal, { props: { affect } });
  // view3d.select_box: a box gesture, begun at the drag's press or (from B) at the next press.
  const MODES = { SET: SEL_OP_SET, ADD: SEL_OP_ADD, SUB: SEL_OP_SUB };
  const selectBox = (event, mode, begun = true) => startGestureBox(wm(), {
    begin: begun ? { x: event.x, y: event.y } : null,
    mode,
    select: (rect, m) => { if (em && do_mesh_box_select(em.edit, em.mesh, viewAdapter(event.view ?? views.input), rect, MODES[m])) sync({ extract: EXTRACT_FLAGS }); },
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
  const inView = (event) => !!event.view;
  // An operator's shortcut in Edit Mode's keymaps: the binding with its properties, else its plain one.
  const keysOf = (idname, props) => operatorKeys(idname, props, [keymap, viewKeymap, toolKeymap]);
  const menus = editMeshMenus({
    context: () => world.blenderContext(views.input), edit: () => em.edit, exec, keys: keysOf, move: operatorMove, slide: operatorSlide, start: (type) => editor.start(type),
    extrudeMove, inset, bevel, loopcut, selectBox: () => selectBox(editor.pointer, 'SET', false),
  });
  const keymap = createKeymap([
    { blender: 'mesh.select_mode', keys: '1', run: run('mesh.select_mode', { type: 'VERT' }) },
    { blender: 'mesh.select_mode', keys: '2', run: run('mesh.select_mode', { type: 'EDGE' }) },
    { blender: 'mesh.select_mode', keys: '3', run: run('mesh.select_mode', { type: 'FACE' }) },
    { blender: 'mesh.select_mode', keys: 'Shift 1', run: run('mesh.select_mode', { type: 'VERT', use_extend: true }) },
    { blender: 'mesh.select_mode', keys: 'Shift 2', run: run('mesh.select_mode', { type: 'EDGE', use_extend: true }) },
    { blender: 'mesh.select_mode', keys: 'Shift 3', run: run('mesh.select_mode', { type: 'FACE', use_extend: true }) },
    { blender: ['mesh.select_all', 'mesh.select_all:SELECT'], keys: 'A', run: run('mesh.select_all', { action: 'SELECT' }) },
    { blender: ['mesh.select_all', 'mesh.select_all:DESELECT'], keys: 'Alt A', run: run('mesh.select_all', { action: 'DESELECT' }) },
    { blender: ['mesh.select_all', 'mesh.select_all:INVERT'], keys: 'Ctrl I', run: run('mesh.select_all', { action: 'INVERT' }) },
    { blender: 'mesh.select_more', keys: 'Ctrl NUMPAD_PLUS', run: () => exec('mesh.select_more') },
    { blender: 'mesh.select_less', keys: 'Ctrl NUMPAD_MINUS', run: () => exec('mesh.select_less') },
    { blender: 'mesh.select_linked', keys: 'Ctrl L', run: () => exec('mesh.select_linked') },
    { blender: 'mesh.select_linked_pick', keys: 'L', poll: inView, run: (event) => linkedPick(event, false) },
    { blender: 'mesh.select_linked_pick', keys: 'Shift L', poll: inView, run: (event) => linkedPick(event, true) },
    { blender: 'mesh.dissolve_mode', keys: 'Ctrl X', run: () => exec('mesh.dissolve_mode') },
    { blender: 'mesh.edge_face_add', keys: 'F', run: () => exec('mesh.edge_face_add') },
    { blender: 'VIEW3D_MT_edit_mesh_merge', keys: 'M', run: () => openMenu(menus.merge(), editor.pointer, 'Merge') },
    { blender: 'mesh.hide', keys: 'H', run: () => exec('mesh.hide') },
    { blender: 'mesh.hide', keys: 'Shift H', props: { unselected: true }, run: () => exec('mesh.hide', { unselected: true }) },
    { blender: 'mesh.reveal', keys: 'Alt H', run: () => exec('mesh.reveal') },
    { blender: 'VIEW3D_MT_edit_mesh_delete', keys: ['X', 'Delete'], run: () => openMenu(menus.delete(), editor.pointer, 'Delete') },
    { blender: 'view3d.edit_mesh_extrude_move_normal', keys: 'E', run: extrudeMove },
    { blender: 'mesh.duplicate_move', keys: 'Shift D', run: () => operatorMove('mesh.duplicate') },
    { blender: 'VIEW3D_MT_edit_mesh_extrude', keys: 'Alt E', run: () => openMenu(menus.extrude(), editor.pointer, 'Extrude') },
    { blender: 'VIEW3D_MT_edit_mesh_select_similar', keys: 'Shift G', run: () => openMenu(menus.similar(), editor.pointer, 'Select Similar') },
    { blender: 'VIEW3D_MT_edit_mesh_split', keys: 'Alt M', run: () => openMenu(menus.split(), editor.pointer, 'Split') },
    { blender: 'VIEW3D_MT_edit_mesh_vertices', keys: 'Ctrl V', run: () => openMenu(menus.vertex(), editor.pointer, 'Vertex') },
    { blender: 'VIEW3D_MT_edit_mesh_edges', keys: 'Ctrl E', run: () => openMenu(menus.edge(), editor.pointer, 'Edge') },
    { blender: 'VIEW3D_MT_edit_mesh_faces', keys: 'Ctrl F', run: () => openMenu(menus.face(), editor.pointer, 'Face') },
    { blender: 'mesh.vert_connect_path', keys: 'J', run: () => exec('mesh.vert_connect_path') },
    { blender: 'mesh.split', keys: 'Y', run: () => exec('mesh.split') },
    { blender: 'mesh.fill', keys: 'Alt F', run: () => exec('mesh.fill') },
    { blender: 'mesh.beautify_fill', keys: 'Shift Alt F', run: () => exec('mesh.beautify_fill') },
    { blender: 'mesh.loopcut_slide', keys: 'Ctrl R', run: loopcut },
    { blender: 'mesh.inset', keys: 'I', run: inset },
    { blender: 'mesh.bevel', keys: 'Ctrl B', props: { affect: 'EDGES' }, run: () => bevel('EDGES') },
    { blender: 'mesh.quads_convert_to_tris', keys: 'Ctrl T', run: () => exec('mesh.quads_convert_to_tris', { quad_method: 'BEAUTY', ngon_method: 'BEAUTY' }) },
    { blender: 'mesh.quads_convert_to_tris', keys: 'Shift Ctrl T', run: () => exec('mesh.quads_convert_to_tris', { quad_method: 'FIXED', ngon_method: 'CLIP' }) },
    { blender: 'mesh.tris_convert_to_quads', keys: 'Alt J', run: () => exec('mesh.tris_convert_to_quads') },
    { blender: 'mesh.normals_make_consistent', keys: 'Shift N', props: { inside: false }, run: () => exec('mesh.normals_make_consistent', { inside: false }) },
    { blender: 'mesh.normals_make_consistent', keys: 'Shift Ctrl N', props: { inside: true }, run: () => exec('mesh.normals_make_consistent', { inside: true }) },
    { blender: 'VIEW3D_MT_edit_mesh_normals', keys: 'Alt N', run: () => openMenu(menus.normals(), editor.pointer, 'Normals') },
    { blender: 'mesh.bevel', keys: 'Shift Ctrl B', props: { affect: 'VERTICES' }, run: () => bevel('VERTICES') },
    { blender: 'mesh.loop_select', keys: 'Alt LEFTMOUSE CLICK', poll: inView, run: (event) => loopPick(event, 'mesh.loop_select', {}) },
    { blender: 'mesh.loop_select', keys: 'Shift Alt LEFTMOUSE CLICK', poll: inView, run: (event) => loopPick(event, 'mesh.loop_select', { toggle: true }) },
    { blender: 'mesh.edgering_select', keys: 'Ctrl Alt LEFTMOUSE CLICK', poll: inView, run: (event) => loopPick(event, 'mesh.edgering_select', {}) },
    { blender: 'mesh.edgering_select', keys: 'Shift Ctrl Alt LEFTMOUSE CLICK', poll: inView, run: (event) => loopPick(event, 'mesh.edgering_select', { toggle: true }) },
    { blender: 'transform.translate', keys: 'G', run: () => editor.start('move') },
    { blender: 'transform.rotate', keys: 'R', run: () => editor.start('rotate') },
    { blender: 'transform.resize', keys: 'S', run: () => editor.start('scale') },
  ], ['Mesh']);
  const viewKeymap = createKeymap([
    { blender: 'VIEW3D_MT_edit_mesh_context_menu', keys: 'RIGHTMOUSE', poll: inView, run: (event) => openMenu(menus.context(), { x: event.x, y: event.y }, '') },
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
    // Redraws the modifier result after the stack changed.
    modifiersChanged() { if (em) draw(em.mesh, em.edit.history.at(-1), EXTRACT_POSITIONS); },
    get object() { return em?.object ?? null; },
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
    setSelectMode(type, extend = false) { if (em) run('mesh.select_mode', { type, use_extend: extend })(); },
    // The 3D View's Edit Mode menus (view3d-menus-edit-mesh.js).
    menus,
    // Tab in both modes; the Mesh, 3D View and Select Box tool keymaps in Edit Mode.
    keymap: (event) => modeKeys(event) || (!!em && (keymap(event) || viewKeymap(event) || toolKeymap(event))),
    // A modal transform of the selection; Mesh data is rewritten on every move and saved on confirm.
    // `orient: 'NORMAL'` constrains to the selection's normal; `keep` records an undo step even when cancelled, for
    // the operator that ran first (extrude).
    transform(type, view, mouse, { orient, keep } = {}) {
      if (!em) return null;
      const changed = (fn) => (...args) => { const result = fn(...args); sync({ commit: false, extract: EXTRACT_POSITIONS }); return result; };
      let session;
      if (type === 'edge_slide') {
        // Edge Slide's JS port slides a BMesh of the edit mesh's arrays; its coordinates go to the edit mesh.
        const bm = editBMesh(em.edit, em.mesh), slide = beginEdgeSlide(bm, em.object, view, mouse);
        if (!slide) { notify('Invalid Edge Selection'); return null; }
        const verts = Array.from({ length: em.mesh.verts_num }, (_, v) => v);
        const push = () => { em.edit.setCoords(verts, bm.v.co.subarray(0, verts.length * 3)); sync({ commit: false, extract: EXTRACT_POSITIONS }); };
        const slid = (fn) => (...args) => { const result = fn(...args); push(); return result; };
        const handled = (fn) => (...args) => fn(...args) && (push(), true);
        session = Object.assign(Object.create(slide), { update: slid(slide.update), keymap: handled(slide.keymap), numinput: handled(slide.numinput), cancel: slid(slide.cancel) });
      } else {
        const data = createTransMesh(em.edit, em.mesh, em.object);
        if (!data) return null;
        session = initTransform(type, { ...data, apply: changed(data.apply), restore: changed(data.restore) }, view, mouse, { orient: orient === 'NORMAL' ? normalOrientation() : undefined });
      }
      return Object.assign(Object.create(session), { keep, finish(commit) { if (!commit) session.cancel(); sync({ commit: commit || keep, extract: EXTRACT_POSITIONS }); } });
    },
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
      redo.dispose();
    },
  };
}
