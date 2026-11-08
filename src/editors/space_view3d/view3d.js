import { ArcRotateCamera, Color4, Vector3 } from '@babylonjs/core';
import { iconEl, iconButton } from '../interface/icon.js';
import { UILayout } from '../interface/layout.js';
import { createNavigation, LENS_HALF_TAN } from './navigation.js';
import { drawMenu } from '../interface/ui-layout.js';
import { menuUI } from '../../windowmanager/wm-operators.js';
import { propBinding } from '../../makesrna/rna-bylonder.js';
import { menus } from '../../python/bpy_interface.js';
import { view_3d, user_interface, cssColor } from '../interface/userdef-default-theme.js';
import { createToolbar } from './view3d-toolbar.js';
import { createRegions } from './view3d-regions.js';
import { treeMenu } from '../interface/tree-menu.js';
import { menuTree, menuLabel } from '../interface/ui-tree.js';
import { rnaProperty } from '../../makesrna/rna.js';
import { blenderKeys } from '../../windowmanager/keyconfig.js';
import { createToolOverlay } from '../../draw/overlay-tool.js';
import { outputSize } from '../../blenkernel/scene/render.js';
// Blender's axes as Babylon directions (Babylon's (x, y, z) is Blender's (x, z, y)) and the view each axis's ball
// aligns to (the opposite view for its negative ball).
const axes = [
  { id: 'x', dir: new Vector3(1, 0, 0), color: user_interface.axis_x },
  { id: 'y', dir: new Vector3(0, 0, 1), color: user_interface.axis_y },
  { id: 'z', dir: new Vector3(0, 1, 0), color: user_interface.axis_z },
];
// The view each of the gizmo's axis handles aligns to (view3d_gizmo_navigate.cc), by handle ('-' for the negative).
const AXIS_TYPES = { x: 'RIGHT', 'x-': 'LEFT', y: 'BACK', 'y-': 'FRONT', z: 'TOP', 'z-': 'BOTTOM' };
// The navigation gizmo (view3d_gizmo_navigate_type.cc) at its default size, in pixels.
const WIDGET_RADIUS = 40, AXIS_HANDLE_SIZE = 0.2, AXIS_LINE_WIDTH = 2, AXIS_RING_WIDTH = 80 / 60;
const mixColor = (a, b, t) => cssColor([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t).concat(1));
// uiTemplateEditModeSelection: Edit Mode's select mode buttons, each mesh.select_mode pressed while its mode is on.
function selectModeLayout(selectmode) {
  const row = new UILayout('row', null, { align: true });
  [['VERT', 'VERTEXSEL'], ['EDGE', 'EDGESEL'], ['FACE', 'FACESEL']].forEach(([type, icon], i) =>
    row.children.push({ kind: 'operator', operator: 'mesh.select_mode', text: '', icon, depress: !!(selectmode & (1 << i)), props: { type } }));
  return row;
}
// The keymaps an Object Mode 3D View's handlers run, in order.
const KEYMAPS = ['Object Mode', 'Object Non-modal', '3D View', '3D View Generic', 'Frames', 'Screen', 'Window'];

const background = new Color4(...view_3d.background);
// Blender's startup 3D View (startup.blend: region_3d view_rotation, view_distance and view_location) as an orbit
// around its location, and its lens (LENS_HALF_TAN).
const STARTUP_VIEW = { alpha: -0.415918, beta: 1.108752, radius: 18.388048, target: new Vector3(-0.020693, 0.000669, -0.046025) };
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
//   ctx: { world, views, editor, creator, dock, capture, overlays, rna (createRNA),
//          sceneCamera() -> authored camera, shadingChanged(), name }
export function createView3D(ctx, { section, canvas = null, headerId, cameraName = '__editorCamera:' + headerId, from = null }) {
  const { world, views, creator, dock } = ctx;
  const { scene } = world;
  section.classList.add('viewport-area');
  if (!canvas) { canvas = document.createElement('canvas'); section.prepend(canvas); }
  canvas.classList.add('viewport-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive 3D viewport');
  const editorCamera = new ArcRotateCamera(cameraName, STARTUP_VIEW.alpha, STARTUP_VIEW.beta, STARTUP_VIEW.radius, STARTUP_VIEW.target.clone(), scene);
  Object.assign(editorCamera, { minZ: 0.01, maxZ: 1000, lowerRadiusLimit: 0.1, upperRadiusLimit: 10000, inertia: 0 });
  if (from) { editorCamera.upVector = from.upVector.clone(); editorCamera.setTarget(from.target.clone()); editorCamera.setPosition(from.position.clone()); editorCamera.mode = from.mode; }
  // The view's own state, and its regions' as SpaceView3D's show_region_* (Blender's startup: no sidebar), and the
  // overlay's Weight Paint settings (View3DOverlay's defaults).
  const state = { shading: 'solid', color_type: 'MATERIAL', use_compositor: 'DISABLED', use_world_space_lighting: false, studiolight_rotate_z: 0, overlays: true, show_gizmo: true, cameraView: false, show_region_header: true, show_region_tool_header: true, show_region_toolbar: true,
    show_region_ui: false, weight_paint_mode_opacity: 1, show_wpaint_contours: false };
  const view = {
    id: headerId, section, canvas, editorCamera, state, active: true, wantsCompositor: false,
    get camera() { return state.cameraView && ctx.sceneCamera() ? ctx.sceneCamera() : editorCamera; },
    // Camera view looks through the scene camera in the view's own shading and overlays, as Blender's does.
    get rendered() { return state.shading === 'rendered'; },
    // Material Preview: the scene's materials in studio lighting.
    get preview() { return state.shading === 'material'; },
    // Viewport Shading > Compositor (View3DShading.use_compositor): whether Rendered shading shows the composite.
    get composites() { return state.use_compositor === 'ALWAYS' || (state.use_compositor === 'CAMERA' && state.cameraView); },
  };

  // Overlays: view name, navigation gizmo and buttons.
  const label = Object.assign(document.createElement('div'), { className: 'view-label' });
  const name = Object.assign(document.createElement('span'), { className: 'view-name' });
  const detail = Object.assign(document.createElement('span'), { className: 'view-detail' });
  // The render engine's info (EEVEE's info_append: shaders left to compile).
  const info = Object.assign(document.createElement('span'), { className: 'view-info', hidden: true });
  label.append(name, detail, info);
  const gizmo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gizmo.setAttribute('viewBox', '-48 -48 96 96');
  gizmo.classList.add('nav-gizmo');
  const navButtons = Object.assign(document.createElement('div'), { className: 'nav-buttons' });
  // The camera view's border (drawviewborder in view3d_draw.cc).
  const cameraBorder = Object.assign(document.createElement('div'), { className: 'camera-border', hidden: true });
  section.append(cameraBorder, label, gizmo, navButtons);

  const toolOverlay = createToolOverlay(view);
  const nav = createNavigation({ camera: editorCamera, engine: world.engine, onSync: () => sync() });
  view.nav = nav;

  // Looking through a camera hands it the view's input, as a project's Babylon camera takes it; a Blender camera (a
  // .blend's) moves only as Blender moves it, so a drag in the view paints or selects instead of turning it.
  const takesInput = (camera) => camera && camera.metadata?.wbHome !== 'BLENDER';
  const toggleCameraView = () => {
    creator.finish(); ctx.capture.release();
    const camera = ctx.sceneCamera();
    // Without a scene camera there is nothing to look through (view3d.view_camera cancels).
    if (!camera && !state.cameraView) return;
    state.cameraView = !state.cameraView;
    if (state.cameraView && takesInput(camera)) camera.attachControl(canvas, true); else camera?.detachControl();
    views.setInput(view);
    sync(); ctx.shadingChanged();
  };
  view.toggleCameraView = toggleCameraView;
  // Blender's operators that leave the view looking through the camera (Align Active Camera to View).
  view.enterCameraView = () => { if (!state.cameraView) toggleCameraView(); };
  view.leaveCameraView = () => { if (state.cameraView) toggleCameraView(); };
  view.setShading = id => { state.shading = id; sync(); ctx.shadingChanged(); };
  view.setCompositor = (value) => { state.use_compositor = value; ctx.shadingChanged(); };
  // The scene camera changed while this view looks through it.
  view.sceneCameraChanged = (next, previous) => { if (!state.cameraView) return; previous?.detachControl(); if (takesInput(next)) next.attachControl(canvas, true); sync(); ctx.shadingChanged(); };

  const header = dock.header(headerId);
  const editMode = () => world.editMode?.active;
  // Blender's Object Mode menus, from its own scripts over this view's context.
  // Its operators act on this view, as Blender runs a menu's operators in the menu's area.
  const blender = menuUI({ menus, context: () => world.blenderContext(view), prop: namedBinding(propBinding(ctx.rna.host)), keymaps: () => KEYMAPS });
  const run = blender.run;
  blender.run = (idname, props, event) => { views.setInput(view); run(idname, props, event); };
  // The toolbar region, Blender's tool system's.
  const toolbar = createToolbar({
    panel: world.toolsystem.panel, run: blender.run, python: (fn) => world.toolsystem.python(fn, view),
    keys: (idname, props, strict) => blenderKeys(['Object Mode', 'Mesh', ...KEYMAPS], idname, props, strict),
  });
  section.append(toolbar.el);
  view.toolbar = toolbar;
  // The header, the tool settings and the sidebar, Blender's, in every mode.
  const editMesh = () => editMode() && (world.editMode.kind ?? 'MESH') === 'MESH';
  const menuItems = (idname) => drawMenu(idname, blender);
  // A Blender menu for wm.call_menu in this view: its items and title, or null without one. Blender lays it out in the
  // view's area.
  view.menu = (idname) => {
    const ui = regions.blenderUI, tree = ui.inContext((C) => menuTree(C, idname));
    return tree ? { items: () => treeMenu(tree, ui), title: menuLabel(idname) } : null;
  };
  const headerUI = {
    ...blender,
    run: (idname, props, event) => (idname === 'mesh.select_mode' ? world.editMode.setSelectMode(props.type, !!event?.shiftKey) : blender.run(idname, props, event)),
    supported: (idname, props) => idname === 'mesh.select_mode' || blender.supported(idname, props),
  };
  const regions = createRegions({
    view, area: (layout) => world.view3dArea(view, layout), scene: world.mainSync, legacy: () => false, context: (region) => world.blenderContext(view, region), changed: () => sync(), undoPush: (name) => ctx.rna.host.undoPush?.(name),
    ui: headerUI,
    menu: menuItems,
    templates: { template_header_3D_mode: () => (editMesh() ? selectModeLayout(world.editMode.selectmode) : null) },
  });
  header.replaceChildren(regions.header);
  section.append(regions.toolHeader, regions.sidebar, regions.shelf);
  view.regions = regions;
  // The navigation gizmo and buttons (VIEW3D_GGT_navigate), drawn from this view's camera: a left press invokes
  // Blender's operator as the gizmo does, a drag running it modally (view3d.zoom, move, rotate) and a click on an axis
  // aligning the view (view3d.view_axis, the opposite side once aligned).
  const operate = (idname, props = {}, native = null) => { views.setInput(view); world.view3dInvoke(view, idname, props, native); views.wake(); };
  const dragOperator = (el, idname) => el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    operate(idname, {}, e);
  });
  const projection = iconButton('view_perspective', 'Switch the current view from perspective/orthographic projection (Numpad 5)', () => operate('view3d.view_persportho'));
  const zoom = iconButton('viewzoom', 'Zoom in/out in the view (drag)', () => {});
  const pan = iconButton('view_pan', 'Move the view (drag)', () => {});
  navButtons.append(zoom, pan, iconButton('view_camera', 'Toggle the camera view (Numpad 0)', toggleCameraView), projection);
  dragOperator(zoom, 'view3d.zoom');
  dragOperator(pan, 'view3d.move');
  gizmo.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target.closest('[data-axis]');
    if (!target) return operate('view3d.rotate', {}, e);
    const axis = target.dataset.axis;
    operate('view3d.view_axis', { type: AXIS_TYPES[axis], align_active: false, relative: false }, e);
  });
  let drawn = '';
  const drawGizmo = () => {
    const key = [...editorCamera.getViewMatrix().m, editorCamera.mode].join();
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

  // The camera whose workbench shading this view set: the editor camera's, or the scene camera's in camera view.
  let shadedCamera = editorCamera;
  const sync = () => {
    name.textContent = state.cameraView ? (view.camera.mode === 1 ? 'Camera Orthographic' : 'Camera Perspective') : nav.viewName + (editorCamera.mode === 0 ? ' Perspective' : ' Orthographic');
    section.classList.toggle('overlays-off', !state.overlays);
    section.classList.toggle('gizmos-off', !state.show_gizmo);
    section.classList.toggle('camera-view', state.cameraView);
    if (shadedCamera !== view.camera) { world.workbench.setShading(shadedCamera, null); shadedCamera = view.camera; }
    world.workbench.setShading(shadedCamera, view.rendered || view.preview ? null : state.shading === 'solid' && state.xray ? 'xray' : state.shading, state.color_type);
    toolbar.el.hidden = !state.show_region_toolbar;
    if (state.show_region_toolbar) toolbar.draw();
    section.classList.toggle('toolbar-shown', state.show_region_toolbar);
    section.classList.toggle('tool-header-shown', state.show_region_tool_header);
    section.classList.toggle('sidebar-shown', state.show_region_ui);
    regions.draw();
    views.wake();
  };

  // Per-view render state, applied by the view manager right before and after this view renders.
  let authored = null, overlaysDrawn = null, materialsDrawn = null;
  view.beforeRender = () => {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    editorCamera.fov = 2 * Math.atan(LENS_HALF_TAN / Math.max(1, aspect));
    if (editorCamera.mode) nav.updateBounds();
    const rendered = view.rendered;
    authored = null;
    if (!rendered) { authored = scene.clearColor; scene.clearColor = background; }
    // Camera view shows the scene's output framed in the region, the passepartout darkening around it.
    const area = state.cameraView && world.renderSettings && world.view3dArea?.(view);
    const frame = area ? world.mainSync?.viewCamera(view.camera, outputSize(world.renderSettings.state.render), area.camera(), { width: canvas.clientWidth, height: canvas.clientHeight }) : null;
    // view3d_draw.cc drawviewborder: the passepartout and its outline always, the dashed guide with the overlays.
    cameraBorder.hidden = !frame;
    if (frame) {
      cameraBorder.style.cssText = `--x:${frame.x};--y:${frame.y};--width:${frame.width};--height:${frame.height};--passepartout:${frame.passepartout}`;
      cameraBorder.classList.toggle('passepartout', frame.passepartout > 0);
      cameraBorder.classList.toggle('guides', !!state.overlays);
    }
    world.beforeViewRender({ rendered, compositor: view.wantsCompositor, studio: { worldSpace: state.use_world_space_lighting, rotateZ: state.studiolight_rotate_z } });
    // Rendered draws the overlays after its film, as Blender does; the compositor's graph has no pass for them.
    const film = rendered && !scene.frameGraph ? world.renderSettings.film(view.camera) : null;
    ctx.overlays.setEnabled(state.overlays && (!rendered || !!film), state);
    overlaysDrawn = ctx.overlays.use(view.camera, film);
    if (rendered || view.preview) materialsDrawn = ctx.shaderCompile.use(view.camera);
  };
  view.afterRender = () => {
    if (authored) scene.clearColor = authored;
    authored = null;
    overlaysDrawn?.(); materialsDrawn?.();
    overlaysDrawn = materialsDrawn = null;
  };
  view.tick = () => {
    if (!state.cameraView && state.overlays) drawGizmo();
    toolOverlay.tick();
    const queued = view.rendered || view.preview ? ctx.shaderCompile.queued : 0, text = queued ? `Compiling shaders (${queued} remaining)` : '';
    if (info.textContent !== text) Object.assign(info, { textContent: text, hidden: !text });
  };
  view.setDetail = text => { if (detail.textContent !== text) detail.textContent = text; };
  view.sync = sync;
  view.dispose = () => {
    views.remove(view);
    if (state.cameraView) ctx.sceneCamera()?.detachControl();
    world.workbench.setShading(editorCamera, null);
    editorCamera.dispose();
    toolbar.dispose();
    regions.dispose();
    for (const el of [label, gizmo, navButtons]) el.remove();
    toolOverlay.dispose();
    ctx.shadingChanged();
  };
  sync();
  return view;
}
