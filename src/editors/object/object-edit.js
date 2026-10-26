// Entering and leaving Edit Mode (object_edit.cc) and what Edit Mode does with the mouse and keys. While editing,
// the object's BMesh is the truth: every change converts it back to Mesh data (for drawing, undo and scene edits).
import { Matrix, Ray, Vector3, VertexData } from '@babylonjs/core';
import { BM_ITER_MESH, BM_VERT, BM_EDGE, BM_FACE } from '../../bmesh/intern/bmesh-class.js';
import { BM_mesh_bm_from_me, BM_mesh_bm_to_me } from '../../bmesh/intern/bmesh-mesh-convert.js';
import { SCE_SELECT_VERTEX, BM_mesh_select_mode_flush, BM_select_history_active_get } from '../../bmesh/intern/bmesh-marking.js';
import { EDBM_select_pick, mesh_select_all, mesh_select_mode } from '../mesh/editmesh-select.js';
import { EDBM_mesh_hide, EDBM_mesh_reveal } from '../mesh/editmesh-utils.js';
import { beginMeshTransform } from '../transform/transform-mesh.js';
import { primitive_add } from '../mesh/editmesh-add.js';
import { mesh_serialize, mesh_deserialize } from '../../blenkernel/mesh/mesh.js';
import { mesh_from_vertex_data } from '../../blenkernel/mesh/mesh-from-babylon.js';
import { mesh_batch_cache_apply } from '../../draw/mesh-batch-cache.js';
import { createEditMeshOverlay } from '../../draw/overlay-edit-mesh.js';
import { createKeymap } from '../../windowmanager/input/keymap.js';

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
  // scene.tool_settings.mesh_select_mode, kept across Edit Mode sessions as in Blender.
  let selectmode = SCE_SELECT_VERTEX;

  const editable = (node) => node?.getTotalVertices && !node.metadata?.wbCreation?.text && !node.metadata?.group;
  const reason = (node) => (node.metadata?.wbModifiers?.length ? 'Edit Mode on objects with modifiers comes with modifiers on Mesh data.' : null);

  // Converts the BMesh back to Mesh data, redraws and, for an operator, records an undo step.
  function sync({ commit = true } = {}) {
    const { bm, object } = em;
    const mesh = BM_mesh_bm_to_me(bm);
    em.elems = { v: [], e: [], f: [] };
    for (const name of ['v', 'e', 'f']) BM_ITER_MESH(bm[name], (i) => { em.elems[name][bm[name].index[i]] = i; });
    em.mesh = mesh;
    mesh_batch_cache_apply(mesh, object);
    const active = BM_select_history_active_get(bm);
    em.overlay.update(mesh, { selectmode: bm.selectmode, active: active && { type: ACTIVE_TYPE[active.htype], index: bm[{ [BM_VERT]: 'v', [BM_EDGE]: 'e', [BM_FACE]: 'f' }[active.htype]].index[active.ele] } });
    if (commit) {
      object.metadata = { ...object.metadata, wbCreation: { mesh: mesh_serialize(mesh) } };
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
    { blender: 'mesh.hide', keys: 'H', run: run((bm) => EDBM_mesh_hide(bm, bm.selectmode, false)) },
    { blender: 'mesh.hide', keys: 'Shift H', run: run((bm) => EDBM_mesh_hide(bm, bm.selectmode, true)) },
    { blender: 'mesh.reveal', keys: 'Alt H', run: run((bm) => EDBM_mesh_reveal(bm, bm.selectmode)) },
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
    selectAll(action) { if (em) run((bm) => mesh_select_all(bm, action))(); },
    key: (e) => modeKeys(e) || (!!em && keymap(e)),
    // A modal transform of the selection; Mesh data is rewritten on every move and saved on confirm.
    transform(type, view, mouse) {
      const session = em && beginMeshTransform(em.bm, em.object, view, type, mouse);
      if (!session) return null;
      return Object.assign(Object.create(session), {
        update(dx, dy, event) { session.update(dx, dy, event); sync({ commit: false }); },
        constrain(axis, plane) { session.constrain(axis, plane); sync({ commit: false }); },
        finish(commit) { if (!commit) session.cancel(); sync({ commit }); },
      });
    },
    // view3d.select with Blender's left-click keymap: click selects, Shift click toggles.
    pick(view, e) {
      if (EDBM_select_pick(em.bm, viewAdapter(view), [e.clientX, e.clientY], { toggle: e.shiftKey })) sync();
    },
    // After undo or redo: the object's restored Mesh becomes the BMesh again.
    reload() {
      if (!em) return;
      if (!em.object.metadata?.wbCreation?.mesh || em.object.metadata?.wbDeleted) { exit(); return; }
      em.bm = load(mesh_deserialize(em.object.metadata.wbCreation.mesh));
      sync({ commit: false });
    },
    dispose() { em?.overlay.dispose(); em = null; },
  };
}
