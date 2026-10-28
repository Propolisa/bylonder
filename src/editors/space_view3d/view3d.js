import { ArcRotateCamera, Color4, Vector3 } from '@babylonjs/core';
import { menuButton } from '../interface/menu.js';
import { iconEl, iconButton, iconUrl } from '../interface/icon.js';
import { createNavigation } from './navigation.js';
import { drawMenu } from '../interface/ui-layout.js';
import { menuUI, menuClasses, kw } from '../../windowmanager/wm-operators.js';
import { propBinding } from '../../makesrna/rna-bylonder.js';
import * as spaceView3d from '../../bl_ui/space_view3d.js';
import { view_3d, user_interface, cssColor } from '../interface/userdef-default-theme.js';
import { createToolbar } from './view3d-toolbar.js';
import { createRegions } from './view3d-regions.js';
import { rnaProperty } from '../../makesrna/rna.js';
import { blenderKeys } from '../../windowmanager/keyconfig.js';
// Blender's axes as Babylon directions (Babylon's (x, y, z) is Blender's (x, z, y)) and the view each axis's ball
// aligns to (the opposite view for its negative ball).
const axes = [
  { id: 'x', dir: new Vector3(1, 0, 0), color: user_interface.axis_x, view: ['right', false] },
  { id: 'y', dir: new Vector3(0, 0, 1), color: user_interface.axis_y, view: ['front', true] },
  { id: 'z', dir: new Vector3(0, 1, 0), color: user_interface.axis_z, view: ['top', false] },
];
// The navigation gizmo (view3d_gizmo_navigate_type.cc) at its default size, in pixels.
const WIDGET_RADIUS = 40, AXIS_HANDLE_SIZE = 0.2, AXIS_LINE_WIDTH = 2, AXIS_RING_WIDTH = 80 / 60;
const mixColor = (a, b, t) => cssColor([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t).concat(1));
// The keymaps an Object Mode 3D View's handlers run, in order.
const KEYMAPS = ['Object Mode', 'Object Non-modal', '3D View', '3D View Generic', 'Frames', 'Screen', 'Window'];

// The Area menu, which Blender defines in C (screen_ops.cc).
const INFO_MT_area = Object.assign(() => ({
  draw() {
    const { layout } = this;
    layout.operator('screen.area_split', kw({ text: 'Horizontal Split' })).direction = 'HORIZONTAL';
    layout.operator('screen.area_split', kw({ text: 'Vertical Split' })).direction = 'VERTICAL';
    layout.separator();
    layout.operator('screen.screen_full_area', kw({ text: 'Toggle Maximize Area' }));
    layout.operator('screen.screen_full_area', kw({ text: 'Toggle Fullscreen Area' })).use_hide_panels = true;
    layout.separator();
    layout.operator('screen.area_close', kw({ text: 'Close Area' }));
  },
}), { bl_label: 'Area' });
const background = new Color4(...view_3d.background);
// Blender's startup 3D View (startup.blend: region_3d view_rotation, view_distance and view_location) as an orbit
// around its location, and its lens: View3D.lens 50 mm on the 36 mm viewport sensor at the viewport's zoom of 2
// (CAMERA_PARAM_ZOOM_INIT_PERSP), fitted to the longer side.
const STARTUP_VIEW = { alpha: -0.415918, beta: 1.108752, radius: 18.388048, target: new Vector3(-0.020693, 0.000669, -0.046025) };
const LENS_HALF_TAN = (36 / 2 / 50) * 2;
// A bound property's check item, named as Blender's RNA names it (Toolbar for show_region_toolbar) once loaded.
const namedBinding = (binding) => (data, name) => {
  const bound = binding(data, name);
  return bound && { ...bound, label: rnaProperty(data.bl_rna?.identifier, name)?.name ?? bound.label, keys: blenderKeys(KEYMAPS, 'wm.context_toggle', { data_path: dataPath(data, name) }) };
};
// A property's path from the context, for the keymap items toggling it (wm.context_toggle's data_path).
const dataPath = (data, name) => ({ SpaceView3D: 'space_data.', ToolSettings: 'tool_settings.', View3DOverlay: 'space_data.overlay.' })[data.bl_rna?.identifier] + name;

// One 3D Viewport area: its canvas, editor camera, navigation, header menus, overlays and per-view state
// (shading, overlays, camera view), as in Blender where each 3D Viewport has its own view and shading.
// Rendering goes through the shared view manager (views.js); editing goes through the shared editor.
//   ctx: { world, views, editor, creator, dock, capture, inspector, help, overlays, rna (createRNA),
//          sceneCamera() -> authored camera, shadingChanged(), name }
export function createView3D(ctx, { section, canvas = null, headerId, cameraName = '__editorCamera:' + headerId, from = null }) {
  const { world, views, editor, creator, dock } = ctx;
  const { scene } = world;
  section.classList.add('viewport-area');
  if (!canvas) { canvas = document.createElement('canvas'); section.prepend(canvas); }
  canvas.classList.add('viewport-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive 3D viewport');
  const editorCamera = new ArcRotateCamera(cameraName, STARTUP_VIEW.alpha, STARTUP_VIEW.beta, STARTUP_VIEW.radius, STARTUP_VIEW.target.clone(), scene);
  Object.assign(editorCamera, { minZ: 0.01, maxZ: 1000, lowerRadiusLimit: 0.1, upperRadiusLimit: 10000, inertia: 0 });
  if (from) { editorCamera.alpha = from.alpha; editorCamera.beta = from.beta; editorCamera.radius = from.radius; editorCamera.target.copyFrom(from.target); editorCamera.mode = from.mode; }
  // The view's own state, and its regions' as SpaceView3D's show_region_* (Blender's startup: no sidebar).
  const state = { shading: 'solid', overlays: true, cameraView: false, show_region_header: true, show_region_tool_header: true, show_region_toolbar: true,
    show_region_ui: false };
  const view = {
    id: headerId, section, canvas, editorCamera, state, active: true, wantsCompositor: false,
    get camera() { return state.cameraView && ctx.sceneCamera() ? ctx.sceneCamera() : editorCamera; },
    get rendered() { return state.shading === 'rendered' || state.cameraView; },
  };

  // Overlays: view name, navigation gizmo and buttons.
  const label = Object.assign(document.createElement('div'), { className: 'view-label' });
  const name = Object.assign(document.createElement('span'), { className: 'view-name' });
  const detail = Object.assign(document.createElement('span'), { className: 'view-detail' });
  label.append(name, detail);
  const gizmo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gizmo.setAttribute('viewBox', '-48 -48 96 96');
  gizmo.classList.add('nav-gizmo');
  const navButtons = Object.assign(document.createElement('div'), { className: 'nav-buttons' });
  section.append(label, gizmo, navButtons);

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
  const header = dock.header(headerId);
  const editMode = () => world.editMode?.active;
  const mode = menuButton('Object Mode', () => [
    { label: 'Object Mode', blender: 'object.mode_set:OBJECT', icon: 'object_datamode', checked: () => !editMode() && !state.cameraView, run: () => { if (editMode()) world.editMode.exit(); if (state.cameraView) toggleCameraView(); } },
    { label: 'Edit Mode', blender: 'object.mode_set:EDIT', icon: 'editmode_hlt', keys: 'Tab', checked: () => !!editMode(), run: () => editMode() || world.editMode.enter() },
    { label: 'Camera', blender: 'view3d.view_camera', keys: 'Numpad 0', checked: () => state.cameraView, run: toggleCameraView },
  ], { icon: 'object_datamode', className: 'bl-dropdown' });
  // Header select mode buttons (Edit Mode): click switches, Shift click adds or removes a mode.
  const selectModes = Object.assign(document.createElement('span'), { className: 'bl-group' });
  const selectModeButtons = [['VERT', 'vertexsel', 'Vertex', 1, '1'], ['EDGE', 'edgesel', 'Edge', 2, '2'], ['FACE', 'facesel', 'Face', 4, '3']].map(([type, icon, title, bit, key]) => {
    const b = iconButton(icon, `${title} select mode (${key})`, (e) => world.editMode.setSelectMode(type, e?.shiftKey));
    b.dataset.selectBit = bit;
    return b;
  });
  selectModes.append(...selectModeButtons);
  // Blender's Object Mode menus, from its own scripts over this view's context.
  // Its operators act on this view, as Blender runs a menu's operators in the menu's area.
  const blender = menuUI({ menus: { ...menuClasses(spaceView3d), INFO_MT_area }, context: () => world.blenderContext(view), prop: namedBinding(propBinding(ctx.rna.host)), keymaps: () => KEYMAPS });
  const run = blender.run;
  blender.run = (idname, props) => { views.setInput(view); run(idname, props); };
  const blenderMenu = (idname) => () => drawMenu(idname, blender);
  // A Blender menu for wm.call_menu in this view (its items, or null without one) and its title.
  view.menu = (idname) => (blender.menus[idname] ? drawMenu(idname, blender) : null);
  view.menuTitle = (idname) => blender.menus[idname]?.bl_label ?? '';
  // The toolbar region, Blender's tool system's.
  const toolbar = createToolbar({
    panel: world.toolsystem.panel, ui: blender, run: blender.run,
    context: (width) => world.blenderContext(view, { type: 'TOOLS', width }),
    keys: (idname, props, strict) => blenderKeys(['Object Mode', 'Mesh', ...KEYMAPS], idname, props, strict),
  });
  section.append(toolbar.el);
  view.toolbar = toolbar;
  // The tool settings, the header's transform settings and the sidebar, Blender's.
  const regions = createRegions({
    view, context: (region) => world.blenderContext(view, region), changed: () => sync(), undoPush: (name) => ctx.rna.host.undoPush?.(name),
    ui: blender,
  });
  section.append(regions.toolHeader, regions.sidebar);
  view.regions = regions;
  const viewMenu = menuButton('View', blenderMenu('VIEW3D_MT_view'), { blender: 'VIEW3D_MT_view' });
  const select = menuButton('Select', () => (editMode() ? world.editMode.menus.select() : blenderMenu('VIEW3D_MT_select_object')()), { blender: 'VIEW3D_MT_select_object' });
  const selectMenuIds = { object: 'VIEW3D_MT_select_object', edit: 'VIEW3D_MT_select_edit_mesh' };
  const meshItem = p => ({ label: p.title, icon: p.icon || 'mesh_data', run: () => creator.add(p) });
  const meshes = () => {
    const mesh = creator.catalog.filter(p => p.id !== 'text');
    const babylon = mesh.filter(p => p.group === 'babylon');
    return [...mesh.filter(p => !p.group).map(meshItem), ...(babylon.length ? ['-', { label: 'Babylon', icon: 'mesh_data', items: babylon.map(meshItem) }] : [])];
  };
  const add = menuButton('Add', () => (editMode() ? meshes() : blenderMenu('VIEW3D_MT_add')()), { blender: 'VIEW3D_MT_add' });
  const object = menuButton('Object', blenderMenu('VIEW3D_MT_object'), { blender: 'VIEW3D_MT_object' });
  const meshMenu = menuButton('Mesh', () => world.editMode.menus.mesh(), { blender: 'VIEW3D_MT_edit_mesh' });
  const vertexMenu = menuButton('Vertex', () => world.editMode.menus.vertex(), { blender: 'VIEW3D_MT_edit_mesh_vertices' });
  const edgeMenu = menuButton('Edge', () => world.editMode.menus.edge(), { blender: 'VIEW3D_MT_edit_mesh_edges' });
  const faceMenu = menuButton('Face', () => world.editMode.menus.face(), { blender: 'VIEW3D_MT_edit_mesh_faces' });
  const shadingButtons = [['wire', 'shading_wire', 'Wireframe'], ['solid', 'shading_solid', 'Solid'], ['rendered', 'shading_rendered', 'Rendered']].map(([id, icon, title]) => {
    const b = iconButton(icon, 'Viewport Shading: ' + title, () => view.setShading(id));
    b.dataset.shading = id;
    return b;
  });
  const shading = Object.assign(document.createElement('span'), { className: 'bl-group' });
  shading.append(...shadingButtons);
  const overlayButton = iconButton('overlay', 'Show Overlays', () => { state.overlays = !state.overlays; sync(); views.wake(); });
  const spacer = () => Object.assign(document.createElement('span'), { className: 'spacer' });
  header.replaceChildren(mode, selectModes, viewMenu, select, add, object, meshMenu, vertexMenu, edgeMenu, faceMenu, spacer(), regions.xform, spacer(), overlayButton, Object.assign(document.createElement('span'), { className: 'bl-sep' }), shading);

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
    const m = editorCamera.getViewMatrix(), r = WIDGET_RADIUS * (1 - AXIS_HANDLE_SIZE), view = view_3d.background;
    // Back to front; depth is toward the viewer.
    const items = axes.flatMap(a => {
      const v = Vector3.TransformNormal(a.dir, m);
      return [{ a, x: v.x * r, y: -v.y * r, depth: -v.z, pos: true }, { a, x: -v.x * r, y: v.y * r, depth: v.z, pos: false }];
    }).sort((p, q) => p.depth - q.depth);
    gizmo.innerHTML = `<circle class="nav-gizmo-bg" r="${WIDGET_RADIUS}"/>` + items.map(({ a, x, y, depth, pos }) => {
      const fading = mixColor(view, a.color, (depth + 1) * 0.25 + 0.5), middle = mixColor(view, a.color, 0.75);
      const rad = WIDGET_RADIUS * AXIS_HANDLE_SIZE * ((depth + 1) * 0.08 + 0.92), k = AXIS_LINE_WIDTH / WIDGET_RADIUS * 0.66 / (1 - AXIS_HANDLE_SIZE);
      const id = `${headerId}-nav-${a.id}`;
      const line = pos ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${-x * k}" y1="${-y * k}" x2="${x}" y2="${y}"><stop offset="0" stop-color="${middle}"/><stop offset="1" stop-color="${fading}"/></linearGradient>` +
        `<line x1="${-x * k}" y1="${-y * k}" x2="${x}" y2="${y}" stroke="url(#${id})" stroke-width="${AXIS_LINE_WIDTH}" stroke-linecap="round"/>` : '';
      const inner = pos ? fading : mixColor(view, a.color, 0.25), opacity = pos ? 1 : Math.min(depth + 1, 1);
      return line + `<g data-axis="${a.id}${pos ? '' : '-'}" class="nav-axis"><circle cx="${x}" cy="${y}" r="${rad - AXIS_RING_WIDTH / 2}" fill="${inner}" fill-opacity="${opacity}" stroke="${fading}" stroke-width="${AXIS_RING_WIDTH}"/>` +
        (pos ? `<text x="${x}" y="${y + 3.6}" text-anchor="middle">${a.id.toUpperCase()}</text>` : '') + '</g>';
    }).join('');
    projection.replaceChildren(iconEl(editorCamera.mode === 0 ? 'view_perspective' : 'view_ortho'));
  };

  const sync = () => {
    const editing = !!editMode();
    mode.querySelector('span:not(.bl-icon)').textContent = editing ? 'Edit Mode' : 'Object Mode';
    mode.querySelector('.bl-icon').style.maskImage = `url(${iconUrl(editing ? 'editmode_hlt' : 'object_datamode')})`;
    selectModes.hidden = !editing;
    selectModeButtons.forEach((b) => b.setAttribute('aria-pressed', String(!!(world.editMode?.selectmode & b.dataset.selectBit))));
    add.hidden = object.hidden = editing;
    meshMenu.hidden = vertexMenu.hidden = edgeMenu.hidden = faceMenu.hidden = !editing;
    select.dataset.blender = selectMenuIds[editing ? 'edit' : 'object'];
    name.textContent = state.cameraView ? 'Camera Perspective' : nav.viewName + (editorCamera.mode === 0 ? ' Perspective' : ' Orthographic');
    section.classList.toggle('overlays-off', !state.overlays || state.cameraView);
    section.classList.toggle('camera-view', state.cameraView);
    shadingButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shading === state.shading)));
    overlayButton.setAttribute('aria-pressed', String(state.overlays));
    world.workbench.setShading(editorCamera, view.rendered ? null : state.shading);
    toolbar.el.hidden = !state.show_region_toolbar;
    if (state.show_region_toolbar) toolbar.draw();
    section.classList.toggle('toolbar-shown', state.show_region_toolbar);
    section.classList.toggle('tool-header-shown', state.show_region_tool_header);
    section.classList.toggle('sidebar-shown', state.show_region_ui);
    regions.draw();
    views.wake();
  };

  // Per-view render state, applied by the view manager right before and after this view renders.
  let authored = null;
  view.beforeRender = () => {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    editorCamera.fov = 2 * Math.atan(LENS_HALF_TAN / Math.max(1, aspect));
    if (editorCamera.mode) nav.updateBounds();
    const rendered = view.rendered;
    authored = null;
    if (!rendered) { authored = scene.clearColor; scene.clearColor = background; }
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
    world.workbench.setShading(editorCamera, null);
    editorCamera.dispose();
    toolbar.dispose();
    regions.dispose();
    for (const el of [label, gizmo, navButtons]) el.remove();
    ctx.shadingChanged();
  };
  sync();
  return view;
}
