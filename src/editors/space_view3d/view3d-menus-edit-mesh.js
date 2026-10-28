// The 3D View's Edit Mode menus: Blender's own (space_view3d.py, in Blender's Python tree) drawn
// with Bylonder's UILayout, holding the operators Bylonder runs. `api` is Edit Mode's:
//   context(): bpy.context (blenkernel/context.js), edit(): the EditMesh, exec(idname, props): runs an operator as an undo step, keys(idname, props): its shortcut,
//   macro(idname, props, transform, transformProps, event): an operator and then a transform, as Blender's macros run
//   them, module(idname, props, event): one of Blender's modal operators, start(type, options): a transform, and the
//   modal tools extrudeMove, inset, bevel(affect), loopcut, selectBox.
import { menus as MENUS } from '../../python/bpy_interface.js';
import { drawMenu, runs } from '../interface/ui-layout.js';
import { rna } from '../../makesrna/rna.js';
import { blenderKeys } from '../../windowmanager/keyconfig.js';
import { runsMeshOperator } from '../mesh/editmesh-tools.js';
import { EditMesh } from '../../bmesh/bmesh-wasm.js';
import { primitive_add } from '../mesh/editmesh-add.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../../bmesh/intern/bmesh-marking.js';

// The keymaps an Edit Mode 3D View's handlers run, in order.
const KEYMAPS = ['Mesh', 'Object Non-modal', '3D View', '3D View Generic', 'Frames', 'Screen', 'Window'];

// A macro's properties of one of its operators (TRANSFORM_OT_translate in mesh.extrude_context_move's).
const macroProps = (props, name) => Object.fromEntries(props[name] ?? []);
// Blender's macros (mesh_ops.cc): an operator, then a transform of its result.
const MACROS = {
  'mesh.duplicate_move': ['mesh.duplicate', 'transform.translate'],
  'mesh.extrude_context_move': ['mesh.extrude_context', 'transform.translate'],
  'mesh.extrude_region_move': ['mesh.extrude_region', 'transform.translate'],
  'mesh.extrude_region_shrink_fatten': ['mesh.extrude_region', 'transform.shrink_fatten'],
  'mesh.extrude_vertices_move': ['mesh.extrude_verts_indiv', 'transform.translate'],
  'mesh.extrude_edges_move': ['mesh.extrude_edges_indiv', 'transform.translate'],
  'mesh.extrude_faces_move': ['mesh.extrude_faces_indiv', 'transform.shrink_fatten'],
  'mesh.extrude_manifold': ['mesh.extrude_region', 'transform.translate'],
  'mesh.rip_move': ['mesh.rip', 'transform.translate'],
  'mesh.rip_edge_move': ['mesh.rip_edge', 'transform.translate'],
  'mesh.offset_edge_loops_slide': ['mesh.offset_edge_loops', 'transform.edge_slide'],
};
// The operator RNA struct names a macro's properties are kept under.
const struct = (idname) => idname.split('.')[0].toUpperCase() + '_OT_' + idname.split('.')[1];
// Transforms Blender's own code runs in the module's 3D View.
const MODULE_TRANSFORMS = ['transform.shrink_fatten', 'transform.push_pull', 'transform.tosphere', 'transform.shear', 'transform.vert_slide'];

// What Edit Mode runs itself rather than as an operator's exec, by Blender idname: transforms, Blender's macros and modal
// tools, run with the operator's properties and the event that ran them (a tool's drag starts where it was pressed).
export const editMeshActions = (api) => ({
  'transform.translate': () => api.start('move'),
  'transform.rotate': () => api.start('rotate'),
  'transform.resize': () => api.start('scale'),
  'transform.edge_slide': (props = {}, event) => api.start('edge_slide', { point: event, view: event?.view, releaseConfirm: !!props.release_confirm }),
  ...Object.fromEntries(MODULE_TRANSFORMS.map((idname) => [idname, (props, event) => api.module(idname, props, event)])),
  'view3d.edit_mesh_extrude_move_normal': () => api.extrudeMove(),
  'view3d.select_box': () => api.selectBox(),
  ...Object.fromEntries(Object.entries(MACROS).map(([idname, [first, transform]]) => [idname, (props = {}, event) =>
    api.macro(first, macroProps(props, struct(first)), transform, macroProps(props, struct(transform)), event)])),
  'mesh.loopcut_slide': (props = {}, event) => api.loopcut(event, macroProps(props, 'TRANSFORM_OT_edge_slide')),
  'mesh.bevel': (props = {}, event) => api.bevel(props.affect ?? 'EDGES', event, props),
  'mesh.inset': (props = {}, event) => api.inset(event, props),
});

export function editMeshMenus(api) {
  const actions = editMeshActions(api);
  const ui = {
    menus: MENUS,
    context: api.context,
    run: (idname, props) => (actions[idname] ? actions[idname](props) : api.exec(idname, props)),
    supported: (idname) => !!actions[idname] || runsMeshOperator(idname),
    poll: (idname) => !!actions[idname] || api.edit().poll(idname),
    keys: (idname, props) => api.keys(idname, props) ?? blenderKeys(KEYMAPS, idname, props, true),
    enumItems: (idname, prop) => api.edit().enumItems(idname, prop),
  };
  const draw = (idname) => () => drawMenu(idname, ui);
  return {
    menu: (idname) => drawMenu(idname, ui),
    select: draw('VIEW3D_MT_select_edit_mesh'),
    mesh: draw('VIEW3D_MT_edit_mesh'),
    vertex: draw('VIEW3D_MT_edit_mesh_vertices'),
    edge: draw('VIEW3D_MT_edit_mesh_edges'),
    face: draw('VIEW3D_MT_edit_mesh_faces'),
    extrude: draw('VIEW3D_MT_edit_mesh_extrude'),
    similar: draw('VIEW3D_MT_edit_mesh_select_similar'),
    split: draw('VIEW3D_MT_edit_mesh_split'),
    merge: draw('VIEW3D_MT_edit_mesh_merge'),
    delete: draw('VIEW3D_MT_edit_mesh_delete'),
    normals: draw('VIEW3D_MT_edit_mesh_normals'),
    context: draw('VIEW3D_MT_edit_mesh_context_menu'),
  };
}

const DRAWN = ['select', 'mesh', 'vertex', 'edge', 'face', 'context'];

// Visits every entry and submenu Bylonder runs that the menus show for a cube with everything selected, in each select mode, as
// visit(item, selectmode); `api` is what the entries run. For the Coverage view and tests.
export function visitEditMeshMenus(api, visit) {
  let edit;
  const menus = editMeshMenus(Object.assign(api, { edit: () => edit }));
  const walk = (items, mode) => (typeof items === 'function' ? items() : items).filter(runs).forEach((item) => {
    visit(item, mode);
    if (item.items) walk(item.items, mode);
  });
  for (const mode of [SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE]) {
    edit = EditMesh.fromMesh(primitive_add('mesh.primitive_cube_add'), mode);
    edit.run('mesh.select_all', { action: 'SELECT' });
    for (const name of DRAWN) walk(menus[name], mode);
    edit.free();
  }
}

// The Blender identifiers of what the menus show (menus, operators, enum items), for the Coverage view.
export function editMeshMenuCoverage() {
  const ids = new Set(['VIEW3D_MT_select_edit_mesh', 'VIEW3D_MT_edit_mesh', 'VIEW3D_MT_edit_mesh_vertices', 'VIEW3D_MT_edit_mesh_edges',
    'VIEW3D_MT_edit_mesh_faces', 'VIEW3D_MT_edit_mesh_context_menu']);
  visitEditMeshMenus(idleApi(), (item) => ids.add(item.blender));
  return [...ids];
}

// An api whose entries do nothing, with `record` for what an operator entry runs, and a context of one mesh object
// in Edit Mode (what is not bound reads as Blender's default).
export function idleApi(record = () => {}) {
  const none = () => {};
  let api;
  const context = () => {
    const edit = api.edit(), mode = edit.selectmode, { totvertsel, totedgesel, totfacesel } = edit.totals;
    const data = rna('Mesh', { total_vert_sel: totvertsel, total_edge_sel: totedgesel, total_face_sel: totfacesel, count_selected_items: () => [totvertsel, totedgesel, totfacesel] });
    const object = rna('Object', { mode: 'EDIT', type: 'MESH', data });
    return rna('Context', {
      mode: 'EDIT_MESH', object, active_object: object, edit_object: object, objects_in_mode_unique_data: [object],
      tool_settings: rna('ToolSettings', { mesh_select_mode: [SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE].map((bit) => !!(mode & bit)) }),
    });
  };
  return api = { context, exec: record, macro: record, module: record, keys: none, start: none, extrudeMove: none, inset: none, bevel: none, loopcut: none, selectBox: none };
}
