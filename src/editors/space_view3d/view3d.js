import { ArcRotateCamera, Color4, Vector3 } from '@babylonjs/core';
import { menuButton } from '../interface/menu.js';
import { iconEl, iconButton, iconUrl } from '../interface/icon.js';
import { createNavigation } from './navigation.js';

const toolIcons = {
  select: 'M5 2v14l3.6-3.4 2.6 5.6 2.2-1-2.6-5.5H16Z',
  move: 'M10 1 7 4h2v5H4V7L1 10l3 3v-2h5v5H7l3 3 3-3h-2v-5h5v2l3-3-3-3v2h-5V4h2Z',
  rotate: 'M10 3a7 7 0 1 0 7 7h-2a5 5 0 1 1-1.5-3.5L11 9h7V2l-2.6 2.6A7 7 0 0 0 10 3Z',
  scale: 'M2 2h7L6.5 4.5 10 8 8 10 4.5 6.5 2 9Zm16 16h-7l2.5-2.5L10 12l2-2 3.5 3.5L18 11ZM2 12h2v4h4v2H2Zm16-4h-2V4h-4V2h6Z',
};
const toolTitles = { select: 'Select (Esc)', move: 'Move (G)', rotate: 'Rotate (R)', scale: 'Scale (S)' };
const axes = [
  { id: 'x', dir: new Vector3(1, 0, 0), color: '#ff3352', dark: '#9a2335', view: ['right', false] },
  { id: 'y', dir: new Vector3(0, 1, 0), color: '#8bdc00', dark: '#557d10', view: ['top', false] },
  { id: 'z', dir: new Vector3(0, 0, 1), color: '#2890ff', dark: '#24548f', view: ['front', true] },
];
const viewNames = { 'right,false': 'Right', 'right,true': 'Left', 'top,false': 'Top', 'top,true': 'Bottom', 'front,false': 'Front', 'front,true': 'Back' };
const theme = new Color4(0.239, 0.239, 0.239, 1);

// One 3D Viewport area: its canvas, editor camera, navigation, header menus, overlays and per-view state
// (shading, overlays, camera view), as in Blender where each 3D Viewport has its own view and shading.
// Rendering goes through the shared view manager (views.js); editing goes through the shared editor.
//   ctx: { world, views, editor, registry, creator, dock, capture, inspector, help, overlays,
//          sceneCamera() -> authored camera, shadingChanged(), name }
export function createView3D(ctx, { section, canvas = null, headerId, cameraName = '__editorCamera:' + headerId, from = null }) {
  const { world, views, editor, registry, creator, dock } = ctx;
  const { scene } = world;
  section.classList.add('viewport-area');
  if (!canvas) { canvas = document.createElement('canvas'); section.prepend(canvas); }
  canvas.classList.add('viewport-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive 3D viewport');
  const editorCamera = new ArcRotateCamera(cameraName, -Math.PI / 2, Math.PI / 3, 12, new Vector3(0, 1, 0), scene);
  Object.assign(editorCamera, { minZ: 0.01, lowerRadiusLimit: 0.1, upperRadiusLimit: 10000, inertia: 0 });
  if (from) { editorCamera.alpha = from.alpha; editorCamera.beta = from.beta; editorCamera.radius = from.radius; editorCamera.target.copyFrom(from.target); editorCamera.mode = from.mode; }
  const state = { shading: 'solid', overlays: true, cameraView: false };
  const view = {
    id: headerId, section, canvas, editorCamera, state, active: true, wantsCompositor: false,
    get camera() { return state.cameraView && ctx.sceneCamera() ? ctx.sceneCamera() : editorCamera; },
    get rendered() { return state.shading === 'rendered' || state.cameraView; },
  };

  // Overlays: view name, tool column, navigation gizmo and buttons.
  const label = Object.assign(document.createElement('div'), { className: 'view-label' });
  const name = Object.assign(document.createElement('span'), { className: 'view-name' });
  const detail = Object.assign(document.createElement('span'), { className: 'view-detail' });
  label.append(name, detail);
  const tools = Object.assign(document.createElement('nav'), { className: 'tools' });
  tools.setAttribute('aria-label', 'Transform tools');
  for (const tool of Object.keys(toolIcons)) {
    const b = Object.assign(document.createElement('button'), { title: toolTitles[tool] });
    b.dataset.tool = tool;
    b.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${toolIcons[tool]}"/></svg>`;
    b.onclick = () => { creator.finish(); editor.finish(false); editor.setMode(tool); };
    tools.append(b);
  }
  const gizmo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gizmo.setAttribute('viewBox', '-50 -50 100 100');
  gizmo.classList.add('nav-gizmo');
  const navButtons = Object.assign(document.createElement('div'), { className: 'nav-buttons' });
  section.append(label, tools, gizmo, navButtons);

  const nav = createNavigation({ camera: editorCamera, engine: world.engine, canvas, capture: ctx.capture, enabled: () => !state.cameraView, onSync: () => sync() });
  view.nav = nav;

  const toggleCameraView = () => {
    creator.finish(); editor.finish(false); ctx.capture.release();
    const camera = ctx.sceneCamera();
    state.cameraView = !state.cameraView;
    if (state.cameraView) camera?.attachControl(canvas, true); else camera?.detachControl();
    views.setInput(view);
    sync(); ctx.shadingChanged();
  };
  view.toggleCameraView = toggleCameraView;
  view.setShading = id => { state.shading = id; sync(); ctx.shadingChanged(); };
  // The scene camera changed while this view looks through it.
  view.sceneCameraChanged = (next, previous) => { if (!state.cameraView) return; previous?.detachControl(); next?.attachControl(canvas, true); ctx.shadingChanged(); };

  // Header: mode, View, Select, Add, Object menus, overlays and shading.
  const action = id => {
    const a = registry.actions.find(x => x.id === id);
    return a && { label: a.label, keys: a.keys[0]?.replace(/\+/g, ' '), enabled: a.enabled, run: () => registry.invoke(id) };
  };
  const header = dock.header(headerId);
  const cameraItem = { label: 'Camera', blender: 'view3d.view_camera', keys: 'Numpad 0', checked: () => state.cameraView, run: toggleCameraView };
  const editMode = () => world.editMode?.active;
  const mode = menuButton('Object Mode', () => [
    { label: 'Object Mode', blender: 'object.mode_set:OBJECT', icon: 'object_datamode', checked: () => !editMode() && !state.cameraView, run: () => { if (editMode()) world.editMode.exit(); if (state.cameraView) toggleCameraView(); } },
    { label: 'Edit Mode', blender: 'object.mode_set:EDIT', icon: 'editmode_hlt', keys: 'Tab', checked: () => !!editMode(), run: () => editMode() || world.editMode.enter() },
    cameraItem,
  ], { icon: 'object_datamode', className: 'bl-dropdown' });
  // Header select mode buttons (Edit Mode): click switches, Shift click adds or removes a mode.
  const selectModes = Object.assign(document.createElement('span'), { className: 'bl-group' });
  const selectModeButtons = [['VERT', 'vertexsel', 'Vertex', 1, '1'], ['EDGE', 'edgesel', 'Edge', 2, '2'], ['FACE', 'facesel', 'Face', 4, '3']].map(([type, icon, title, bit, key]) => {
    const b = iconButton(icon, `${title} select mode (${key})`, (e) => world.editMode.setSelectMode(type, e?.shiftKey));
    b.dataset.selectBit = bit;
    return b;
  });
  selectModes.append(...selectModeButtons);
  const viewpoint = Object.entries(viewNames).map(([key, label]) => {
    const [vname, opposite] = key.split(',');
    return { label, blender: 'view3d.view_axis:' + { right: 'RIGHT', top: 'TOP', front: 'FRONT' }[vname], keys: 'Numpad ' + { right: 3, top: 7, front: 1 }[vname] + (opposite === 'true' ? ' Ctrl' : ''), run: () => nav.view(vname, opposite === 'true') };
  });
  const viewMenu = menuButton('View', () => [
    { label: 'Frame Selected', blender: 'view3d.view_selected', keys: 'Numpad .', enabled: () => editor.selection.size > 0, run: () => nav.frame(editor.selected) },
    '-',
    { label: 'Perspective / Orthographic', blender: 'view3d.view_persportho', keys: 'Numpad 5', run: () => nav.toggle() },
    { label: 'Viewpoint', blender: 'VIEW3D_MT_view_viewpoint', items: viewpoint },
    cameraItem,
    '-',
    { label: 'Area', blender: 'INFO_MT_area', items: [{ label: 'Toggle Maximize Area', blender: 'screen.screen_full_area', keys: 'Ctrl Space', run: () => dock.maximize(headerId) }] },
    { label: 'Babylon Inspector', keys: 'Shift Ctrl I', run: ctx.inspector },
    { label: 'Keyboard Shortcuts', keys: '?', run: () => ctx.help.showModal() },
  ], { blender: 'VIEW3D_MT_view' });
  const select = menuButton('Select', () => (editMode() ? editSelectItems : ['select-all', 'deselect', 'invert'].map(action)), { blender: 'VIEW3D_MT_select_object' });
  const editSelectItems = [
    { label: 'All', blender: 'mesh.select_all:SELECT', keys: 'A', run: () => world.editMode.selectAll('SELECT') },
    { label: 'None', blender: 'mesh.select_all:DESELECT', keys: 'Alt A', run: () => world.editMode.selectAll('DESELECT') },
    { label: 'Invert', blender: 'mesh.select_all:INVERT', keys: 'Ctrl I', run: () => world.editMode.selectAll('INVERT') },
  ];
  const selectMenuIds = { object: 'VIEW3D_MT_select_object', edit: 'VIEW3D_MT_select_edit_mesh' };
  const meshItem = p => ({ label: p.title, icon: p.icon || 'mesh_data', run: () => creator.add(p) });
  const meshes = () => {
    const mesh = creator.catalog.filter(p => p.id !== 'text');
    const babylon = mesh.filter(p => p.group === 'babylon');
    return [...mesh.filter(p => !p.group).map(meshItem), ...(babylon.length ? ['-', { label: 'Babylon', icon: 'mesh_data', items: babylon.map(meshItem) }] : [])];
  };
  const add = menuButton('Add', () => [
    { label: 'Mesh', blender: 'VIEW3D_MT_mesh_add', icon: 'outliner_ob_mesh', items: meshes },
    { label: 'Text', blender: 'object.text_add', icon: 'outliner_ob_empty', run: () => creator.add(creator.catalog.find(p => p.id === 'text')) },
    '-',
    { label: 'Search…', keys: 'Shift A', run: () => creator.show() },
  ], { blender: 'VIEW3D_MT_add' });
  const object = menuButton('Object', () => [
    { label: 'Transform', blender: 'VIEW3D_MT_transform_object', items: ['move', 'rotate', 'scale'].map(action) },
    { label: 'Clear', blender: 'VIEW3D_MT_object_clear', items: ['clear-location', 'clear-rotation', 'clear-scale'].map(action) },
    '-',
    ...['duplicate', 'rename', 'delete'].map(action),
    '-',
    { label: 'Parent', blender: 'VIEW3D_MT_object_parent', items: ['parent', 'unparent', 'group', 'ungroup'].map(action) },
    { label: 'Collection', blender: 'VIEW3D_MT_object_collection', items: ['move-to-collection', 'link-to-collection', 'new-collection', 'remove-from-collection'].map(action) },
    { label: 'Show/Hide', blender: 'VIEW3D_MT_object_showhide', items: ['hide', 'hide-others', 'show-all', 'isolate'].map(action) },
    '-',
    ...['add-array', 'creation', 'edit-text'].map(action),
  ], { blender: 'VIEW3D_MT_object' });
  const meshMenu = menuButton('Mesh', () => [
    { label: 'Transform', blender: 'VIEW3D_MT_transform', items: [['Move', 'transform.translate', 'G', 'move'], ['Rotate', 'transform.rotate', 'R', 'rotate'], ['Scale', 'transform.resize', 'S', 'scale']].map(([label, blender, keys, type]) => ({ label, blender, keys, run: () => editor.start(type) })) },
    '-',
    { label: 'Extrude', blender: 'VIEW3D_MT_edit_mesh_extrude', items: [{ label: 'Extrude Faces', blender: 'view3d.edit_mesh_extrude_move_normal', keys: 'E', run: () => world.editMode.extrudeMove() }] },
    '-',
    { label: 'Show/Hide', blender: 'VIEW3D_MT_edit_mesh_showhide', items: [
      { label: 'Reveal Hidden', blender: 'mesh.reveal', keys: 'Alt H', run: () => world.editMode.exec('mesh.reveal') },
      { label: 'Hide Selected', blender: 'mesh.hide', keys: 'H', run: () => world.editMode.exec('mesh.hide') },
      { label: 'Hide Unselected', blender: 'mesh.hide', keys: 'Shift H', run: () => world.editMode.exec('mesh.hide', { unselected: true }) },
    ] },
    '-',
    { label: 'Delete', blender: 'VIEW3D_MT_edit_mesh_delete', items: world.editMode.deleteMenu },
  ], { blender: 'VIEW3D_MT_edit_mesh' });
  const edgeMenu = menuButton('Edge', () => [
    { label: 'Subdivide', blender: 'mesh.subdivide', run: () => world.editMode.exec('mesh.subdivide') },
    '-',
    { label: 'Loop Cut and Slide', blender: 'mesh.loopcut_slide', keys: 'Ctrl R', run: () => world.editMode.loopcut() },
  ], { blender: 'VIEW3D_MT_edit_mesh_edges' });
  const faceMenu = menuButton('Face', () => [
    { label: 'Extrude Faces', blender: 'view3d.edit_mesh_extrude_move_normal', keys: 'E', run: () => world.editMode.extrudeMove() },
  ], { blender: 'VIEW3D_MT_edit_mesh_faces' });
  const shadingButtons = [['wire', 'shading_wire', 'Wireframe'], ['solid', 'shading_solid', 'Solid'], ['rendered', 'shading_rendered', 'Rendered']].map(([id, icon, title]) => {
    const b = iconButton(icon, 'Viewport Shading: ' + title, () => view.setShading(id));
    b.dataset.shading = id;
    return b;
  });
  const shading = Object.assign(document.createElement('span'), { className: 'bl-group' });
  shading.append(...shadingButtons);
  const overlayButton = iconButton('overlay', 'Show Overlays', () => { state.overlays = !state.overlays; sync(); views.wake(); });
  const spacer = () => Object.assign(document.createElement('span'), { className: 'spacer' });
  header.replaceChildren(mode, selectModes, viewMenu, select, add, object, meshMenu, edgeMenu, faceMenu, spacer(), overlayButton, Object.assign(document.createElement('span'), { className: 'bl-sep' }), shading);

  // Navigation gizmo and buttons, drawn from this view's camera.
  const drag = (el, fn) => {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      views.setInput(view);
      let x = e.clientX, y = e.clientY, moved = false;
      el.setPointerCapture(e.pointerId);
      el.onpointermove = ev => { const dx = ev.clientX - x, dy = ev.clientY - y; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; x = ev.clientX; y = ev.clientY; if (moved) { fn(dx, dy, ev); views.wake(); } };
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
  let drawn = '';
  const drawGizmo = () => {
    const key = [editorCamera.alpha, editorCamera.beta, editorCamera.mode].join();
    if (key === drawn) return;
    drawn = key;
    const m = editorCamera.getViewMatrix(), r = 34;
    const items = axes.flatMap(a => {
      const v = Vector3.TransformNormal(a.dir, m);
      return [{ a, x: v.x * r, y: -v.y * r, z: v.z, pos: true }, { a, x: -v.x * r, y: v.y * r, z: -v.z, pos: false }];
    }).sort((p, q) => q.z - p.z);
    gizmo.innerHTML = '<circle class="nav-gizmo-bg" r="49"/>' + items.map(p =>
      (p.pos ? `<line x1="0" y1="0" x2="${p.x}" y2="${p.y}" stroke="${p.a.color}" stroke-width="2.4"/>` : '') +
      `<g data-axis="${p.a.id}${p.pos ? '' : '-'}" class="nav-axis"><circle cx="${p.x}" cy="${p.y}" r="${p.pos ? 8 : 7}" fill="${p.pos ? p.a.color : p.a.dark}" ${p.pos ? '' : `stroke="${p.a.color}" stroke-width="1" fill-opacity=".55"`}/>` +
      (p.pos ? `<text x="${p.x}" y="${p.y + 3.6}" text-anchor="middle">${p.a.id.toUpperCase()}</text>` : '') + '</g>').join('');
    projection.replaceChildren(iconEl(editorCamera.mode === 0 ? 'view_perspective' : 'view_ortho'));
  };

  const sync = () => {
    const editing = !!editMode();
    mode.querySelector('span:not(.bl-icon)').textContent = editing ? 'Edit Mode' : 'Object Mode';
    mode.querySelector('.bl-icon').style.maskImage = `url(${iconUrl(editing ? 'editmode_hlt' : 'object_datamode')})`;
    selectModes.hidden = !editing;
    selectModeButtons.forEach((b) => b.setAttribute('aria-pressed', String(!!(world.editMode?.selectmode & b.dataset.selectBit))));
    add.hidden = object.hidden = editing;
    meshMenu.hidden = edgeMenu.hidden = faceMenu.hidden = !editing;
    select.dataset.blender = selectMenuIds[editing ? 'edit' : 'object'];
    name.textContent = state.cameraView ? 'Camera Perspective' : nav.viewName + (editorCamera.mode === 0 ? ' Perspective' : ' Orthographic');
    section.classList.toggle('overlays-off', !state.overlays || state.cameraView);
    section.classList.toggle('camera-view', state.cameraView);
    shadingButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shading === state.shading)));
    overlayButton.setAttribute('aria-pressed', String(state.overlays));
    views.wake();
  };

  // Per-view render state, applied by the view manager right before and after this view renders.
  let authored = null;
  view.beforeRender = () => {
    const rendered = view.rendered;
    scene.forceWireframe = state.shading === 'wire';
    authored = null;
    if (!rendered) { authored = scene.clearColor; scene.clearColor = theme; }
    ctx.overlays.setEnabled(state.overlays && !rendered);
    world.beforeViewRender({ rendered, compositor: view.wantsCompositor });
  };
  view.afterRender = () => { if (authored) scene.clearColor = authored; authored = null; };
  view.tick = () => { if (!state.cameraView && state.overlays) drawGizmo(); };
  view.setDetail = text => { if (detail.textContent !== text) detail.textContent = text; };
  view.sync = sync;
  view.dispose = () => {
    views.remove(view);
    if (state.cameraView) ctx.sceneCamera()?.detachControl();
    nav.dispose();
    editorCamera.dispose();
    for (const el of [label, tools, gizmo, navButtons]) el.remove();
    ctx.shadingChanged();
  };
  sync();
  return view;
}
