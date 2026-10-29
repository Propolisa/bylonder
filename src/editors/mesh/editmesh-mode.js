// A mesh's Edit Mode, Blender's on Main's object (docs/model.md): object.mode_set enters and leaves it (the Mesh's
// BMEditMesh), Blender's mesh operators edit it on Main's context, run by Blender's window from the Mesh keymap or by
// idname from menus and tools (runBlenderOperator, modally from an event), and the view draws it (main-view.js). A
// click and the region selections are Blender's view3d operators, picking as in X-ray (view-api.cc's seam). Undo is
// Blender's edit-mode undo.
import { Vector3 } from '@babylonjs/core';
import { runBlenderOperator } from '../object/object-operators.js';
import { toBlender } from '../space_view3d/view3d-project.js';
import { SCE_SELECT_VERTEX } from '../../bmesh/intern/bmesh-marking.js';

const SELECT_MODES = ['VERT', 'EDGE', 'FACE'];

//   world (its mainSync once it exists); selection; host(): runBlenderOperator's options (transaction, notify, keying,
//   commit, wm, pointer, view).
export function createMeshEditMode({ world, selection, host }) {
  const sync = () => world.mainSync, blender = () => world.mainSync.blender;
  const isMesh = (node) => !!node?.getTotalVertices && !node.metadata?.wbCreation?.curve && !node.metadata?.wbCreation?.armature && !node.metadata?.group;
  const activeNode = () => selection.nodes.at(-1);
  // The object Main holds in Edit Mode, as the view keeps its mode.
  const object = () => { const node = activeNode(); return isMesh(node) && node.metadata?.wbMode === 'EDIT' ? node : null; };
  const edit = () => { const node = object(); return node && blender().editMesh(sync().objectOf(node)); };
  // X-ray picking in the view the operator runs in (view-api.cc), for the operators that pick or select regions.
  const picking = () => ({ ...host(), inView: () => blender().xrayPicking() });
  const run = (idname, props = {}, event = null, options = host()) => runBlenderOperator(sync(), idname, props, { ...options, event });
  const modeSet = (mode) => { run('object.mode_set', { mode }); return mode === 'EDIT' ? !!object() : !object(); };
  let selectmode = SCE_SELECT_VERTEX;

  // calc_gizmo_stats for the tools' gizmos: the selected vertices' median point and the normal of the selected faces
  // (else vertices), in Blender world space; null without a selection.
  function gizmoStats() {
    const node = object(), mesh = edit()?.mesh;
    if (!mesh) return null;
    const m = node.computeWorldMatrix(true), verts = mesh.attribute('.select_vert'), faces = mesh.attribute('.select_poly'), co = mesh.vert_positions;
    const sum = [0, 0, 0], no = [0, 0, 0];
    let count = 0;
    for (let v = 0; v < mesh.verts_num; v++) if (verts[v]) { count++; for (let a = 0; a < 3; a++) sum[a] += co[v * 3 + a]; }
    const add = (normals, selected, n) => { for (let i = 0; i < n; i++) if (selected[i]) for (let a = 0; a < 3; a++) no[a] += normals[i * 3 + a]; };
    add(mesh.face_normals(), faces, mesh.faces_num);
    if (!no.some(Boolean)) add(mesh.vert_normals(), verts, mesh.verts_num);
    if (!count) return null;
    const center = toBlender(Vector3.TransformCoordinates(new Vector3(sum[0] / count, sum[2] / count, sum[1] / count), m));
    const normal = toBlender(Vector3.TransformNormal(new Vector3(no[0], no[2], no[1]), m).normalize());
    return { center, normal: normal.some(Boolean) ? normal : [0, 0, 1] };
  }
  const count = (flags, n) => { let selected = 0; for (let i = 0; i < n; i++) selected += flags[i] ? 1 : 0; return selected; };

  return {
    get active() { return !!object(); },
    get object() { return object(); },
    get mesh() { return edit()?.mesh ?? null; },
    editable: () => isMesh(activeNode()) && !!sync()?.objectOf(activeNode()),
    enter: () => modeSet('EDIT'),
    exit: () => modeSet('OBJECT'),
    toggle() { return object() ? modeSet('OBJECT') : modeSet('EDIT'); },
    // One of Blender's operators run in the 3D View from an event, as its window manager runs it.
    module: (idname, props, event) => run(idname, props, event),
    addPrimitive: (idname, props) => run(idname, props),
    // The select mode (SCE_SELECT_*): the edit mesh's, kept for the next Edit Mode as the scene's tool settings keep it.
    get selectmode() { const current = edit(); if (current) selectmode = current.selectmode; return selectmode; },
    set selectmode(mode) {
      selectmode = mode;
      if (object()) SELECT_MODES.filter((type, i) => mode & (1 << i)).forEach((type, i) => run('mesh.select_mode', { type, use_extend: i > 0 }));
    },
    setSelectMode: (type, extend = false) => run('mesh.select_mode', { type, use_extend: extend }),
    // stats_object_edit: selected and total elements, and the triangle count.
    get stats() {
      const mesh = edit()?.mesh;
      if (!mesh) return null;
      return { verts: [count(mesh.attribute('.select_vert'), mesh.verts_num), mesh.verts_num], edges: [count(mesh.attribute('.select_edge'), mesh.edges_num), mesh.edges_num],
        faces: [count(mesh.attribute('.select_poly'), mesh.faces_num), mesh.faces_num], tris: mesh.corners_num - 2 * mesh.faces_num };
    },
    gizmoStats: () => (object() ? gizmoStats() : null),
    // view3d.select and the region selections in Edit Mode: Blender's, picking as in X-ray.
    selectOperator(event, props) { run('view3d.select', props, event, picking()); return 'FINISHED'; },
    selectBox: (event, props) => run('view3d.select_box', props, event, picking()),
    // view3d.select_lasso and view3d.select_circle, Blender's gestures.
    selectGesture: (idname, props, event) => run(idname, props, event, picking()),
    // Blender's window runs the Mesh keymap; the page's has nothing of Edit Mode's.
    keymap: () => false,
    // Blender's menus run Blender's operators on Main; the tools' previews of a loop or element are not drawn yet.
    menus: null,
    preselectEdgeRing: () => null,
    preselectElem: () => null,
    set toolGizmoGroup(idname) {},
    lastOperation: null,
    modifiersChanged() {},
    reload() {},
    dispose() {},
  };
}
