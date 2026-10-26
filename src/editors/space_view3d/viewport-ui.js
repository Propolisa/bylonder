import { Color3, MeshBuilder, Vector3 } from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import { nodeId } from '../object/identity.js';

// Parts shared by every 3D Viewport: the floor grid and axis overlays (shown per view by view3d.js) and the
// status bar text. Each view's header, gizmo and shading live in view3d.js.
export function createViewportOverlays(scene) {
  const grid = MeshBuilder.CreateGround('__grid', { width: 400, height: 400 }, scene);
  const material = new GridMaterial('__gridMaterial', scene);
  Object.assign(material, { mainColor: new Color3(0.239, 0.239, 0.239), lineColor: new Color3(0.36, 0.36, 0.36), opacity: 0.99, gridRatio: 1, majorUnitFrequency: 10, minorUnitVisibility: 0.35, backFaceCulling: false, zOffset: 2 });
  grid.material = material;
  const axisLine = (name, a, b, color) => {
    const line = MeshBuilder.CreateLines(name, { points: [a, b] }, scene);
    line.color = Color3.FromHexString(color);
    line.alpha = 0.8;
    return line;
  };
  const meshes = [grid, axisLine('__axisX', new Vector3(-200, 0, 0), new Vector3(200, 0, 0), '#ff3352'), axisLine('__axisZ', new Vector3(0, 0, -200), new Vector3(0, 0, 200), '#2890ff')];
  for (const mesh of meshes) { mesh.isPickable = false; mesh.metadata = { editable: false }; mesh.doNotSerialize = true; }
  let shown = true;
  return {
    // Called per view right before it renders.
    setEnabled(value) { if (shown !== value) { shown = value; meshes.forEach(mesh => mesh.setEnabled(value)); } },
    dispose() { meshes.forEach(m => m.dispose()); material.dispose(); },
  };
}

// Status bar (sent to the workspace) and each view's "(frame) Collection | Object" detail line.
export function createViewportStatus({ world, editor, views, send }) {
  let last = '', lastStatus = 0;
  const status = () => {
    const active = editor.selection.nodes.at(-1);
    // Blender shows the active object's collection (or the active collection) before the object name.
    const cols = world.collections, home = active && world.objects.includes(active) ? cols?.memberships(nodeId(active))[0] : cols?.active;
    const collection = !cols || !home || home === cols.MASTER ? 'Scene Collection' : cols.byId(home).name;
    const visible = world.objects.filter(n => n.isEnabled() && n.isVisible !== false && !n.isDisposed() && n.getTotalVertices);
    const verts = visible.reduce((s, n) => s + n.getTotalVertices(), 0);
    const tris = visible.reduce((s, n) => s + (n.getTotalIndices() || n.getTotalVertices()) / 3, 0);
    const detail = `(${Math.round(world.animation.time.frame)}) ${collection}${active ? ' | ' + active.name : ''}`;
    for (const view of views.all) view.setDetail?.(detail);
    const hints = editor.modal
      ? [[['mouse_lmb'], 'Confirm'], [['mouse_rmb'], 'Cancel'], [['X', 'Y', 'Z'], 'Axis'], [['Shift'], 'Precision'], [['Ctrl'], 'Snap']]
      : [[['mouse_lmb'], 'Select'], [['mouse_mmb'], 'Rotate View'], [['mouse_rmb'], 'Object Context Menu']];
    const fps = views.idle ? 'Idle' : Math.round(world.engine.getFps()) + ' FPS';
    const stats = `${collection}${active ? ' | ' + active.name : ''} | Verts:${verts.toLocaleString()} | Tris:${Math.round(tris).toLocaleString()} | Objects:${editor.selection.size}/${world.objects.filter(n => n.isEnabled(false)).length} | ${fps}`;
    const next = JSON.stringify([hints, stats]);
    if (next !== last) { last = next; send('status', { hints, stats }); }
  };
  return {
    tick() {
      for (const view of views.all) view.tick?.();
      const now = performance.now();
      if (now - lastStatus > 250) { lastStatus = now; status(); }
    },
  };
}
