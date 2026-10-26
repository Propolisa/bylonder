// Entering and leaving Edit Mode (object_edit.cc) and what Edit Mode does with the mouse and keys. While editing,
// the object's BMesh is the truth: every change converts it back to Mesh data (for drawing, undo and scene edits).
import { Matrix, Ray, Vector3, VertexData } from '@babylonjs/core';
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_SELECT, BM_elem_flag_test } from '../../bmesh/intern/bmesh-class.js';
import { BM_face_normal_update } from '../../bmesh/intern/bmesh-polygon.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { SCE_SELECT_VERTEX, BM_mesh_select_mode_flush, BM_select_history_active_get } from '../../bmesh/intern/bmesh-marking.js';
import { EDBM_select_pick, mesh_select_all, mesh_select_mode } from '../mesh/editmesh-select.js';
import { beginMeshTransform } from '../transform/transform-mesh.js';
import { meshOperators } from '../mesh/editmesh-tools.js';
import { loopcut_modal } from '../mesh/editmesh-loopcut.js';
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
  // The Normal orientation's axis in world space: the summed normals of the selected faces.
  function selectionNormal() {
    const { bm, object } = em, sum = [0, 0, 0];
    BM_ITER_MESH(bm.f, (f) => {
      if (!BM_elem_flag_test(bm.f, f, BM_ELEM_SELECT)) return;
      BM_face_normal_update(bm, f);
      for (let a = 0; a < 3; a++) sum[a] += bm.f.no[f * 3 + a];
    });
    return Vector3.TransformNormal(new Vector3(sum[0], sum[2], sum[1]), object.computeWorldMatrix(true)).normalize();
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
    meshOperators[idname](em.bm, props);
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
        meshOperators[idname](em.bm, next);
        sync({ amend: true });
      },
    });
  }
  // A modal Edit Mode tool (Loop Cut) gets the pointer, wheel and keys until it finishes or is cancelled.
  let tool = null;
  const toolMove = (e) => tool?.move(viewAdapter(views.input), [e.clientX, e.clientY]);
  const toolWheel = (e) => { if (!tool) return; e.preventDefault(); e.stopPropagation(); tool.wheel(e.deltaY < 0); };
  function endTool() {
    tool?.dispose();
    tool = null;
    removeEventListener('pointermove', toolMove, true);
    removeEventListener('wheel', toolWheel, true);
    notify('');
  }
  function startTool(create) {
    endTool();
    tool = create();
    addEventListener('pointermove', toolMove, true);
    addEventListener('wheel', toolWheel, { capture: true, passive: false });
    toolMove(editor.pointer ? { clientX: editor.pointer.x, clientY: editor.pointer.y } : { clientX: 0, clientY: 0 });
  }
  const loopcut = () => startTool(() => loopcut_modal({
    bm: () => em.bm,
    owner: em.object,
    notify,
    confirm: (eed, number_cuts) => exec('mesh.loopcut', { edge_index: em.bm.e.index[eed], number_cuts }),
  }));
  const deleteMenu = () => [
    ...DELETE_ITEMS.map(([type, label]) => ({ label, blender: 'mesh.delete:' + type, run: () => exec('mesh.delete', { type }) })),
    '-',
    { label: 'Dissolve Faces', blender: 'mesh.dissolve_faces', run: () => exec('mesh.dissolve_faces') },
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
    { blender: 'mesh.hide', keys: 'H', run: () => exec('mesh.hide') },
    { blender: 'mesh.hide', keys: 'Shift H', run: () => exec('mesh.hide', { unselected: true }) },
    { blender: 'mesh.reveal', keys: 'Alt H', run: () => exec('mesh.reveal') },
    { blender: 'VIEW3D_MT_edit_mesh_delete', keys: ['X', 'Delete'], run: () => openMenu(deleteMenu(), editor.pointer, 'Delete') },
    { blender: 'view3d.edit_mesh_extrude_move_normal', keys: 'E', run: extrudeMove },
    { blender: 'mesh.loopcut_slide', keys: 'Ctrl R', run: loopcut },
    { blender: 'transform.translate', keys: 'G', run: () => editor.start('move') },
    { blender: 'transform.rotate', keys: 'R', run: () => editor.start('rotate') },
    { blender: 'transform.resize', keys: 'S', run: () => editor.start('scale') },
  ], ['Mesh']);
  const modeKeys = createKeymap([
    { blender: 'object.mode_set', keys: 'Tab', poll: () => !!em || editable(activeObject()), run: () => (em ? exit() : enter()) },
  ], ['Object Non-modal']);

  return {
    get active() { return !!em; },
    get object() { return em?.object ?? null; },
    get selectmode() { return em?.bm.selectmode ?? selectmode; },
    enter,
    exit,
    toggle: () => (em ? exit() : enter()),
    setSelectMode(type, extend = false) { if (em) run((bm) => (selectmode = mesh_select_mode(bm, type, { use_extend: extend })))(); },
    exec(idname, props) { if (em) exec(idname, props); },
    deleteMenu,
    extrudeMove() { if (em) extrudeMove(); },
    selectAll(action) { if (em) run((bm) => mesh_select_all(bm, action))(); },
    loopcut() { if (em) loopcut(); },
    key(e) {
      if (tool) {
        const state = tool.key(e);
        if (state === 'finished' || state === 'cancelled') endTool();
        if (state) e.preventDefault();
        return !!state;
      }
      return modeKeys(e) || (!!em && keymap(e));
    },
    // A modal transform of the selection; Mesh data is rewritten on every move and saved on confirm.
    // `orient: 'NORMAL'` constrains to the selection's normal; `keep` records an undo step even when cancelled, for
    // the operator that ran first (extrude).
    transform(type, view, mouse, { orient, keep } = {}) {
      const session = em && beginMeshTransform(em.bm, em.object, view, type, mouse, { normal: orient === 'NORMAL' ? selectionNormal() : undefined });
      if (!session) return null;
      return Object.assign(Object.create(session), {
        update(dx, dy, event) { session.update(dx, dy, event); sync({ commit: false }); },
        constrain(axis, plane) { session.constrain(axis, plane); sync({ commit: false }); },
        finish(commit) { if (!commit) session.cancel(); sync({ commit: commit || keep }); },
      });
    },
    // A click in a view: the modal tool's confirm or cancel, else view3d.select with Blender's left-click keymap
    // (click selects, Shift click toggles). Returns whether the click was used.
    pointerDown(view, e) {
      if (tool) {
        if (e.button === 0) tool.finish();
        endTool();
        return true;
      }
      if (e.button !== 0) return false;
      if (EDBM_select_pick(em.bm, viewAdapter(view), [e.clientX, e.clientY], { toggle: e.shiftKey })) sync();
      return true;
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
