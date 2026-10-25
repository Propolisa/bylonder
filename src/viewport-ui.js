import { Color3, Color4, MeshBuilder, Vector3 } from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import { menuButton } from './ui/menu.js';
import { iconEl, iconButton } from './ui/icon.js';

const toolIcons = {
  select: 'M5 2v14l3.6-3.4 2.6 5.6 2.2-1-2.6-5.5H16Z',
  move: 'M10 1 7 4h2v5H4V7L1 10l3 3v-2h5v5H7l3 3 3-3h-2v-5h5v2l3-3-3-3v2h-5V4h2Z',
  rotate: 'M10 3a7 7 0 1 0 7 7h-2a5 5 0 1 1-1.5-3.5L11 9h7V2l-2.6 2.6A7 7 0 0 0 10 3Z',
  scale: 'M2 2h7L6.5 4.5 10 8 8 10 4.5 6.5 2 9Zm16 16h-7l2.5-2.5L10 12l2-2 3.5 3.5L18 11ZM2 12h2v4h4v2H2Zm16-4h-2V4h-4V2h6Z',
};
const axes = [
  { id: 'x', dir: new Vector3(1, 0, 0), color: '#ff3352', dark: '#9a2335', view: ['right', false] },
  { id: 'y', dir: new Vector3(0, 1, 0), color: '#8bdc00', dark: '#557d10', view: ['top', false] },
  { id: 'z', dir: new Vector3(0, 0, 1), color: '#2890ff', dark: '#24548f', view: ['front', true] },
];
const viewNames = { 'right,false': 'Right', 'right,true': 'Left', 'top,false': 'Top', 'top,true': 'Bottom', 'front,false': 'Front', 'front,true': 'Back' };

export function mountViewportUI({ world, editor, nav, creator, registry, dock, send, inspector, help, toggleCameraView, isCameraView }) {
  const { scene, camera } = world;
  const section = document.querySelector('#viewport-section');
  const action = id => {
    const a = registry.actions.find(x => x.id === id);
    return a && { label: a.label, keys: a.keys[0]?.replace(/\+/g, ' '), enabled: a.enabled, run: () => registry.invoke(id) };
  };
  const state = { shading: 'solid', overlays: true };

  const theme = new Color4(0.239, 0.239, 0.239, 1);
  let authored;
  scene.onBeforeRenderObservable.add(() => {
    authored = null;
    if (state.shading !== 'rendered' && !isCameraView()) { authored = scene.clearColor; scene.clearColor = theme; }
  });
  scene.onAfterRenderObservable.add(() => { if (authored) scene.clearColor = authored; });

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
  const overlays = [grid, axisLine('__axisX', new Vector3(-200, 0, 0), new Vector3(200, 0, 0), '#ff3352'), axisLine('__axisZ', new Vector3(0, 0, -200), new Vector3(0, 0, 200), '#2890ff')];
  for (const mesh of overlays) { mesh.isPickable = false; mesh.metadata = { editable: false }; mesh.doNotSerialize = true; }

  const header = dock.header('viewport');
  const cameraItem = { label: 'Camera', keys: 'Numpad 0', checked: () => isCameraView(), run: toggleCameraView };
  const mode = menuButton('Object Mode', [{ label: 'Object Mode', icon: 'object_datamode', checked: () => !isCameraView(), run: () => isCameraView() && toggleCameraView() }, cameraItem], { icon: 'object_datamode', className: 'bl-dropdown' });
  const viewpoint = Object.entries(viewNames).map(([key, label]) => {
    const [name, opposite] = key.split(',');
    return { label, keys: 'Numpad ' + { right: 3, top: 7, front: 1 }[name] + (opposite === 'true' ? ' Ctrl' : ''), run: () => nav.view(name, opposite === 'true') };
  });
  const view = menuButton('View', () => [
    { label: 'Frame Selected', keys: 'Numpad .', enabled: () => editor.selection.size > 0, run: () => nav.frame(editor.selected) },
    '-',
    { label: 'Perspective / Orthographic', keys: 'Numpad 5', run: () => nav.toggle() },
    { label: 'Viewpoint', items: viewpoint },
    cameraItem,
    '-',
    { label: 'Toggle Maximize Area', keys: 'Ctrl Space', run: () => dock.maximize('viewport') },
    { label: 'Babylon Inspector', keys: 'Shift Ctrl I', run: inspector },
    { label: 'Keyboard Shortcuts', keys: '?', run: () => help.showModal() },
  ]);
  const select = menuButton('Select', () => ['select-all', 'deselect', 'invert'].map(action));
  const meshes = () => creator.catalog.filter(p => p.id !== 'text').map(p => ({ label: p.title, icon: 'mesh_data', run: () => creator.add(p) }));
  const add = menuButton('Add', () => [
    { label: 'Mesh', icon: 'outliner_ob_mesh', items: meshes },
    { label: 'Text', icon: 'outliner_ob_empty', run: () => creator.add(creator.catalog.find(p => p.id === 'text')) },
    '-',
    { label: 'Search…', keys: 'Shift A', run: () => creator.show() },
  ]);
  const object = menuButton('Object', () => [
    { label: 'Transform', items: ['move', 'rotate', 'scale'].map(action) },
    { label: 'Clear', items: ['clear-location', 'clear-rotation', 'clear-scale'].map(action) },
    '-',
    ...['duplicate', 'rename', 'delete'].map(action),
    '-',
    { label: 'Parent', items: ['parent', 'unparent'].map(action) },
    { label: 'Collection', items: ['group', 'ungroup'].map(action) },
    { label: 'Show/Hide', items: ['hide', 'hide-others', 'show-all', 'isolate'].map(action) },
    '-',
    ...['add-array', 'creation', 'edit-text'].map(action),
  ]);
  const shadingButtons = [['wire', 'shading_wire', 'Wireframe'], ['solid', 'shading_solid', 'Solid'], ['rendered', 'shading_rendered', 'Rendered']].map(([id, icon, title]) => {
    const b = iconButton(icon, 'Viewport Shading: ' + title, () => setShading(id));
    b.dataset.shading = id;
    return b;
  });
  const shading = Object.assign(document.createElement('span'), { className: 'bl-group' });
  shading.append(...shadingButtons);
  const overlayButton = iconButton('overlay', 'Show Overlays', () => { state.overlays = !state.overlays; sync(); });
  const spacer = () => Object.assign(document.createElement('span'), { className: 'spacer' });
  header.append(mode, view, select, add, object, spacer(), overlayButton, Object.assign(document.createElement('span'), { className: 'bl-sep' }), shading);

  const setShading = id => { state.shading = id; sync(); };
  const sync = () => {
    scene.forceWireframe = state.shading === 'wire';
    world.compositor?.setViewportActive(state.shading === 'rendered' || isCameraView());
    const showOverlays = state.overlays && state.shading !== 'rendered' && !isCameraView();
    overlays.forEach(mesh => mesh.setEnabled(showOverlays));
    section.classList.toggle('overlays-off', !state.overlays || isCameraView());
    shadingButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shading === state.shading)));
    overlayButton.setAttribute('aria-pressed', String(state.overlays));
  };
  sync();

  document.querySelectorAll('.tools [data-tool]').forEach(b => {
    b.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${toolIcons[b.dataset.tool]}"/></svg>`;
  });
  document.querySelector('.tools #frame')?.remove();
  document.querySelector('.tools hr')?.remove();

  const detail = Object.assign(document.createElement('span'), { id: 'view-detail' });
  document.querySelector('.view-label').append(detail);

  const gizmo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gizmo.setAttribute('viewBox', '-50 -50 100 100');
  gizmo.classList.add('nav-gizmo');
  const navButtons = Object.assign(document.createElement('div'), { className: 'nav-buttons' });
  const drag = (el, fn) => {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      let x = e.clientX, y = e.clientY, moved = false;
      el.setPointerCapture(e.pointerId);
      el.onpointermove = ev => { const dx = ev.clientX - x, dy = ev.clientY - y; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; x = ev.clientX; y = ev.clientY; if (moved) fn(dx, dy, ev); };
      el.onpointerup = ev => { el.onpointermove = null; el.releasePointerCapture(ev.pointerId); el.dataset.moved = moved ? '1' : ''; };
    });
  };
  const projection = iconButton('view_perspective', 'Switch the current view from perspective/orthographic projection (Numpad 5)', () => nav.toggle());
  const zoom = iconButton('viewzoom', 'Zoom in/out in the view (drag)', () => {});
  const pan = iconButton('view_pan', 'Move the view (drag)', () => {});
  navButtons.append(zoom, pan, iconButton('view_camera', 'Toggle the camera view (Numpad 0)', toggleCameraView), projection);
  drag(zoom, (dx, dy) => nav.zoom(Math.exp(dy * 0.01)));
  drag(pan, (dx, dy) => nav.pan(dx, dy));
  drag(gizmo, (dx, dy) => nav.orbit(dx, dy));
  gizmo.addEventListener('click', e => {
    if (gizmo.dataset.moved) return;
    const target = e.target.closest('[data-axis]');
    if (!target) return;
    const axis = axes.find(a => a.id === target.dataset.axis[0]), negative = target.dataset.axis.length > 1;
    nav.view(axis.view[0], axis.view[1] !== negative);
  });
  section.append(gizmo, navButtons);

  const drawGizmo = () => {
    const m = camera.getViewMatrix(), r = 34;
    const items = axes.flatMap(a => {
      const v = Vector3.TransformNormal(a.dir, m);
      return [{ a, x: v.x * r, y: -v.y * r, z: v.z, pos: true }, { a, x: -v.x * r, y: v.y * r, z: -v.z, pos: false }];
    }).sort((p, q) => q.z - p.z);
    gizmo.innerHTML = '<circle class="nav-gizmo-bg" r="49"/>' + items.map(p =>
      (p.pos ? `<line x1="0" y1="0" x2="${p.x}" y2="${p.y}" stroke="${p.a.color}" stroke-width="2.4"/>` : '') +
      `<g data-axis="${p.a.id}${p.pos ? '' : '-'}" class="nav-axis"><circle cx="${p.x}" cy="${p.y}" r="${p.pos ? 8 : 7}" fill="${p.pos ? p.a.color : p.a.dark}" ${p.pos ? '' : `stroke="${p.a.color}" stroke-width="1" fill-opacity=".55"`}/>` +
      (p.pos ? `<text x="${p.x}" y="${p.y + 3.6}" text-anchor="middle">${p.a.id.toUpperCase()}</text>` : '') + '</g>').join('');
    projection.replaceChildren(iconEl(camera.mode === 0 ? 'view_perspective' : 'view_ortho'));
  };

  let last = '', lastStatus = 0;
  const status = () => {
    const active = editor.selection.nodes.at(-1);
    const visible = world.objects.filter(n => n.isEnabled() && !n.isDisposed() && n.getTotalVertices);
    const verts = visible.reduce((s, n) => s + n.getTotalVertices(), 0);
    const tris = visible.reduce((s, n) => s + (n.getTotalIndices() || n.getTotalVertices()) / 3, 0);
    detail.textContent = `(${Math.round(world.animation.action.frame)}) Scene Collection${active ? ' | ' + active.name : ''}`;
    const hints = editor.modal
      ? [[['mouse_lmb'], 'Confirm'], [['mouse_rmb'], 'Cancel'], [['X', 'Y', 'Z'], 'Axis'], [['Shift'], 'Precision'], [['Ctrl'], 'Snap']]
      : [[['mouse_lmb'], 'Select'], [['mouse_mmb'], 'Rotate View'], [['mouse_rmb'], 'Object Context Menu']];
    const stats = `Scene Collection${active ? ' | ' + active.name : ''} | Verts:${verts.toLocaleString()} | Tris:${Math.round(tris).toLocaleString()} | Objects:${editor.selection.size}/${world.objects.filter(n => n.isEnabled(false)).length} | ${Math.round(world.engine.getFps())} FPS`;
    const next = JSON.stringify([hints, stats]);
    if (next !== last) { last = next; send('status', { hints, stats }); }
  };
  return {
    sync,
    tick() {
      if (!isCameraView() && state.overlays) drawGizmo();
      const now = performance.now();
      if (now - lastStatus > 250) { lastStatus = now; status(); }
    },
    dispose() { overlays.forEach(m => m.dispose()); material.dispose(); },
  };
}
