import { createGridOverlay } from '../../draw/overlay-grid.js';
import { createExtrasOverlay } from '../../draw/overlay-extra.js';
import { createCursorOverlay } from '../../draw/overlay-cursor.js';
import { createOriginOverlay } from '../../draw/overlay-origin.js';
import { createOutlineOverlay } from '../../draw/overlay-outline.js';
import { createOverlayPass } from '../../draw/overlay-pass.js';
import { createArmatureOverlay } from '../../draw/overlay-armature.js';
import { createRelationsOverlay } from '../../draw/overlay-relations.js';
import { paintWeightView } from '../../draw/overlay-paint-weight.js';

// Overlays shared by every 3D Viewport (shown per view by view3d.js): the floor grid and axes, the 3D cursor, selected objects' origins
// and outlines, the extras of cameras, lights and empties, armatures' bones and relationship lines. Each view's header, gizmo and
// shading live in view3d.js.
//   extras: options of createExtrasOverlay (draw/overlay-extra.js); origins: of createOriginOverlay (overlay-origin.js);
//   outlines: of createOutlineOverlay (overlay-outline.js); armatures: of createArmatureOverlay (overlay-armature.js);
//   relations: of createRelationsOverlay (overlay-relations.js);
//   view3dCursor(): the scene's 3D cursor
export function createViewportOverlays(scene, { extras, origins, outlines, armatures, relations: relationsOptions, view3dCursor }) {
  const grid = createGridOverlay(scene), cursor = createCursorOverlay(scene, view3dCursor), origin = createOriginOverlay(scene, origins);
  const pass = createOverlayPass(scene), outline = createOutlineOverlay(scene, outlines, pass);
  const extra = createExtrasOverlay(scene, extras), armature = createArmatureOverlay(scene, armatures), meshes = [...grid.meshes, ...cursor.meshes];
  const relations = createRelationsOverlay(scene, relationsOptions);
  let shown = true;
  return {
    extras: extra,
    // Called per view right before it renders, with its state (view3d.js).
    setEnabled(value, state = {}) {
      const { shading, xray, overlays = true } = state;
      // Edit Mode's overlay follows the view's Overlays toggle only: Blender shows it in Rendered shading too, as it does
      // Weight Paint's weights.
      for (const mesh of scene.meshes) {
        if (mesh.metadata?.editMode) mesh.isVisible = overlays;
        if (mesh.metadata?.paintWeight) paintWeightView(mesh, state);
      }
      extra.setEnabled(value);
      armature.setEnabled(value, { shading, xray });
      relations.setEnabled(value);
      origin.update(value);
      // Wireframe draws selected objects' edges in the selection colors instead (workbench.js).
      outline.update(value && shading !== 'wire', { xray: !!xray });
      if (shown !== value) { shown = value; meshes.forEach((mesh) => mesh.setEnabled(value)); }
    },
    // Per view, after setEnabled: where its overlays draw (draw/overlay-pass.js); returns what to call once it rendered.
    use: (camera, film) => pass.use(camera, film),
    dispose() { pass.dispose(); relations.dispose(); grid.dispose(); cursor.dispose(); origin.dispose(); outline.dispose(); extra.dispose(); armature.dispose(); },
  };
}

// Status bar (sent to the workspace) and each view's "(frame) Collection | Object" detail line.
export function createViewportStatus({ world, editor, views, send }) {
  let last = '', lastStatus = 0;
  const status = () => {
    const active = editor.selection.active;
    // The 3D View and the status bar name the active collection (view3d_draw.cc draw_selected_name: CTX_data_collection).
    const cols = world.collections, name = (id) => (!cols || !id || id === cols.MASTER ? 'Scene Collection' : cols.byId(id).name);
    const collection = name(cols?.active);
    // In a mode other than Object Mode it names the object and its data instead (draw_selected_name).
    const mode = active?.metadata?.wbMode, dataName = mode && mode !== 'OBJECT' ? world.mainSync?.dataName(active) : null;
    const detail = `(${Math.round(world.animation.time.frame)}) ${dataName ? `${active.name} | ${dataName}` : `${collection}${active ? ' | ' + active.name : ''}`}`;
    for (const view of views.all) view.setDetail?.(detail);
    const hints = world.wm?.modal
      ? [[['mouse_lmb'], 'Confirm'], [['mouse_rmb'], 'Cancel'], [['X', 'Y', 'Z'], 'Axis'], [['Shift'], 'Precision'], [['Ctrl'], 'Snap']]
      : [[['mouse_lmb'], 'Select'], [['mouse_mmb'], 'Rotate View'], [['mouse_rmb'], 'Object Context Menu']];
    const fps = views.idle ? 'Idle' : Math.round(world.engine.getFps()) + ' FPS';
    const edit = world.editMode?.stats, count = (n) => n.toLocaleString(), ratio = ([sel, total]) => `${count(sel)}/${count(total)}`;
    // An armature's Edit and Pose Modes count its joints and bones, as Blender's status bar does (info_stats.cc).
    const armatureMode = active?.metadata?.wbCreation?.armature && ['EDIT', 'POSE'].includes(active.metadata.wbMode);
    // stats_object_edit: a curve counts its control points only.
    const editGeometry = () => (edit.edges
      ? `Verts:${ratio(edit.verts)} | Edges:${ratio(edit.edges)} | Faces:${ratio(edit.faces)} | Tris:${count(edit.tris)}`
      : `Verts:${ratio(edit.verts)}`);
    // Outside an edit mesh or curve, Blender's own statistics: the evaluated scene with its instances (info_stats.cc).
    const stats = edit && !armatureMode
      ? `${collection}${active ? ' | ' + active.name : ''} | ${editGeometry()} | Objects:${editor.selection.size}/${world.objects.filter(n => n.isEnabled(false)).length} | ${fps}`
      : `${world.mainSync.blender.statistics()} | ${fps}`;
    const viewLayers = cols && { list: cols.viewLayers().map(({ id, name }) => [id, name]), active: cols.layer().id };
    const next = JSON.stringify([hints, stats, viewLayers]);
    if (next !== last) { last = next; send('status', { hints, stats, viewLayers }); }
  };
  return {
    tick() {
      for (const view of views.all) view.tick?.();
      const now = performance.now();
      if (now - lastStatus > 250) { lastStatus = now; status(); }
    },
  };
}
