import { nodeId } from '../object/identity.js';
import { createGridOverlay } from '../../draw/overlay-grid.js';
import { createExtrasOverlay } from '../../draw/overlay-extra.js';
import { createCursorOverlay } from '../../draw/overlay-cursor.js';
import { createOriginOverlay } from '../../draw/overlay-origin.js';
import { createOutlineOverlay } from '../../draw/overlay-outline.js';

// Overlays shared by every 3D Viewport (shown per view by view3d.js): the floor grid and axes, the 3D cursor, selected objects' origins
// and outlines, and the extras of cameras, lights and empties. Each view's header, gizmo and shading live in view3d.js.
//   extras: options of createExtrasOverlay (draw/overlay-extra.js); origins: of createOriginOverlay (overlay-origin.js);
//   outlines: of createOutlineOverlay (overlay-outline.js); view3dCursor(): the scene's 3D cursor
export function createViewportOverlays(scene, { extras, origins, outlines, view3dCursor }) {
  const grid = createGridOverlay(scene), cursor = createCursorOverlay(scene, view3dCursor), origin = createOriginOverlay(scene, origins);
  const outline = createOutlineOverlay(scene, outlines);
  const extra = createExtrasOverlay(scene, extras), meshes = [...grid.meshes, ...cursor.meshes];
  let shown = true;
  return {
    extras: extra,
    // Called per view right before it renders, with its state (view3d.js).
    setEnabled(value, { shading, xray } = {}) {
      extra.setEnabled(value);
      origin.update(value);
      // Wireframe draws selected objects' edges in the selection colors instead (workbench.js).
      outline.update(value && shading !== 'wire', { xray: !!xray });
      if (shown !== value) { shown = value; meshes.forEach((mesh) => mesh.setEnabled(value)); }
    },
    dispose() { grid.dispose(); cursor.dispose(); origin.dispose(); outline.dispose(); extra.dispose(); },
  };
}

// Status bar (sent to the workspace) and each view's "(frame) Collection | Object" detail line.
export function createViewportStatus({ world, editor, views, send }) {
  let last = '', lastStatus = 0;
  const status = () => {
    const active = editor.selection.nodes.at(-1);
    // Blender shows the active object's collection (or the active collection) before the object name.
    // The 3D View names the active object's collection, the status bar the active collection.
    const cols = world.collections, name = (id) => (!cols || !id || id === cols.MASTER ? 'Scene Collection' : cols.byId(id).name);
    const collection = name(cols?.active), home = name(active && world.objects.includes(active) ? cols?.memberships(nodeId(active))[0] : cols?.active);
    const visible = world.objects.filter(n => n.isEnabled() && n.isVisible !== false && !n.isDisposed() && n.getTotalVertices);
    const verts = visible.reduce((s, n) => s + n.getTotalVertices(), 0);
    const tris = visible.reduce((s, n) => s + (n.getTotalIndices() || n.getTotalVertices()) / 3, 0);
    const detail = `(${Math.round(world.animation.time.frame)}) ${home}${active ? ' | ' + active.name : ''}`;
    for (const view of views.all) view.setDetail?.(detail);
    const hints = editor.modal
      ? [[['mouse_lmb'], 'Confirm'], [['mouse_rmb'], 'Cancel'], [['X', 'Y', 'Z'], 'Axis'], [['Shift'], 'Precision'], [['Ctrl'], 'Snap']]
      : [[['mouse_lmb'], 'Select'], [['mouse_mmb'], 'Rotate View'], [['mouse_rmb'], 'Object Context Menu']];
    const fps = views.idle ? 'Idle' : Math.round(world.engine.getFps()) + ' FPS';
    const edit = world.editMode?.stats, count = (n) => n.toLocaleString(), ratio = ([sel, total]) => `${count(sel)}/${count(total)}`;
    // stats_object_edit: a curve counts its control points only.
    const geometry = edit?.edges
      ? `Verts:${ratio(edit.verts)} | Edges:${ratio(edit.edges)} | Faces:${ratio(edit.faces)} | Tris:${count(edit.tris)}`
      : edit ? `Verts:${ratio(edit.verts)}`
      : `Verts:${count(verts)} | Tris:${count(Math.round(tris))}`;
    const stats = `${collection}${active ? ' | ' + active.name : ''} | ${geometry} | Objects:${editor.selection.size}/${world.objects.filter(n => n.isEnabled(false)).length} | ${fps}`;
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
