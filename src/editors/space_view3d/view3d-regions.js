// The 3D View's regions besides the toolbar: the header (VIEW3D_HT_header), the tool settings row
// (RGN_TYPE_TOOL_HEADER, VIEW3D_HT_tool_header), the sidebar (RGN_TYPE_UI) with its tabs and the asset shelf
// (RGN_TYPE_ASSET_SHELF and its header), laid out by Blender in the view's area of its window (ui-tree.js) and drawn by
// block-view.js. In Bylonder's own mesh Edit Mode, which Main
// does not know, the header and sidebar still draw Blender's scripts through the JS layout (layout-view.js).
import { createApp, h, reactive, markRaw } from 'vue';
import { BlockView, sidebarView } from '../interface/block-view.js';
import { regionHeader, regionLayout, panelClosedSet, viewItemDrag } from '../interface/ui-tree.js';
import { contextStruct } from '../../python/bpy_rna.js';
import { panels, headers, menus } from '../../python/bpy_interface.js';
import { loadRNAUI } from '../../makesrna/rna.js';
import { ticking } from '../../windowmanager/wm-areas.js';
import { panelTypes, drawPanels, headerLayout, idname, drawType } from '../interface/panels.js';
import { LayoutView, RegionView, panelState } from '../interface/layout-view.js';
import { drawMenu } from '../interface/ui-layout.js';
import { VIEW3D_PT_transform } from './view3d-buttons.js';
import './view3d-regions.css';

// Panel types in the order Blender registers them: C panels (view3d_buttons_register), then the scripts' modules.
const MODULES = [{ classes: [VIEW3D_PT_transform] }, { classes: Object.values(panels) }];
// view3d_buttons_region_layout: the context string of each mode.
const MODE_CONTEXTS = { OBJECT: '.objectmode', EDIT_MESH: '.mesh_edit' };
const RGN_TYPE_WINDOW = 0, RGN_TYPE_HEADER = 1, RGN_TYPE_UI = 4, RGN_TYPE_TOOLS = 5, RGN_TYPE_TOOL_HEADER = 12, RGN_TYPE_ASSET_SHELF = 14, RGN_TYPE_ASSET_SHELF_HEADER = 15;
const SHELF = [RGN_TYPE_ASSET_SHELF, RGN_TYPE_ASSET_SHELF_HEADER];
// The view's state Bylonder draws with (view3d.js) as the area's SpaceView3D has it, by RNA path.
const SHADING = { wire: 'WIREFRAME', solid: 'SOLID', material: 'MATERIAL', rendered: 'RENDERED' };
const SPACE_STATE = [
  ['show_gizmo', ['show_gizmo']],
  ['overlays', ['overlay', 'show_overlays']],
  ['xray', ['shading', 'show_xray'], (value) => !!value],
  ['color_type', ['shading', 'color_type']],
  ['shading', ['shading', 'type'], (value) => SHADING[value], (type) => Object.keys(SHADING).find((id) => SHADING[id] === type)],
  ['weight_paint_mode_opacity', ['overlay', 'weight_paint_mode_opacity']],
  ['show_wpaint_contours', ['overlay', 'show_wpaint_contours']],
];
// Region flags follow the page's regions (rects()): only Blender's changes to them come back.
const REGION_STATE = ['show_region_toolbar', 'show_region_ui', 'show_region_tool_header'];
const polls = (type, context) => { try { return !type.poll || !!type.poll(context); } catch { return false; } };

// `area()` is the view's area in Blender's window, `scene` the scene's Main (main-sync.js), `legacy()` whether the
// JS layout draws (mesh Edit Mode). `context(region)` gives bpy.context for a region of the view there, `ui` runs
// operators and draws menus (menuUI), `menu(idname)` draws a menu of the header's (the mode's own), `templates` are
// the header's C templates, `changed()` redraws after an edit, which `undoPush(name)` records.
export function createRegions({ view, area, scene, legacy, context, ui, menu, templates, changed, undoPush }) {
  const headerRegion = Object.assign(document.createElement('div'), { className: 'bl-ui bl-view3d-header' });
  const toolHeader = Object.assign(document.createElement('div'), { className: 'bl-ui bl-tool-header' });
  const sidebar = Object.assign(document.createElement('div'), { className: 'bl-ui bl-sidebar' });
  sidebar.setAttribute('aria-label', 'Sidebar');
  const shelf = Object.assign(document.createElement('div'), { className: 'bl-ui bl-asset-shelf', hidden: true });
  const shelfHeader = Object.assign(document.createElement('div'), { className: 'bl-asset-shelf-header' });
  const shelfMain = Object.assign(document.createElement('div'), { className: 'bl-asset-shelf-main' });
  shelf.setAttribute('aria-label', 'Asset Shelf');
  shelf.append(shelfHeader, shelfMain);
  // Shown as the view's state says from the first draw (draw() keeps them so).
  toolHeader.hidden = !view.state.show_region_tool_header;
  sidebar.hidden = !view.state.show_region_ui;
  const state = reactive({ category: null, open: {}, revision: 0, ready: false });
  const panels = panelState(state);
  const regionTypes = {};
  const types = (region) => (regionTypes[region] ??= panelTypes(MODULES, { space: 'VIEW_3D', region }));
  const allTypes = () => ['UI', 'HEADER', 'TOOL_HEADER', 'WINDOW'].flatMap((region) => [...types(region).byId.values()].map((entry) => entry.type));

  // What the renderer needs; popovers draw a panel of any of the view's regions over the region's context.
  const layoutUI = (region) => markRaw({
    get revision() { return state.revision; },
    undoPush: (name) => { undoPush(name); changed(); state.revision++; },
    report: (error) => console.warn(error),
    run: (idname, props, event) => ui.run(idname, props, event),
    supported: (idname, props) => ui.supported(idname, props),
    poll: (idname, props) => ui.poll(idname, props),
    isOpen: panels.isOpen,
    toggle: (id, event, closed) => { panels.toggle(id, event, closed); state.revision++; },
    ids: () => [],
    drawMenu: menu,
    menuLabel: (idname) => menus[idname]?.bl_label,
    menuContents: (idname) => {
      const ctx = context(region);
      return menus[idname] && markRaw(headerLayout(ctx, (layout) => drawHeaderType(menus[idname])(layout, ctx)));
    },
    enumItems: (idname, prop) => ui.enumItems(idname, prop),
    templates,
    popover: (id) => {
      const type = allTypes().find((t) => idname(t) === id);
      if (!type) return null;
      const [drawn] = drawPanels({ roots: [{ type, children: [] }] }, context(region), { contexts: [type.bl_context].filter(Boolean) });
      return drawn?.body && { label: drawn.label, layout: drawn.body, units: type.bl_ui_units_x };
    },
    panelsOf: ({ space_type, region_type, context: contextString, category }) => [...types(region_type).byId.values()]
      .map((entry) => entry.type).filter((type) => type.bl_space_type === space_type && type.bl_context === contextString && type.bl_category === category && !type.bl_parent_id)
      .map(idname),
  });

  // The view's state into the area's space before Blender reads it, and back after Blender changed it.
  const space = (layout) => area(layout).inContext(RGN_TYPE_WINDOW, () => contextStruct().space_data);
  let laidOut = {};
  const toSpace = () => {
    const data = space();
    laidOut = Object.fromEntries(REGION_STATE.map((key) => [key, data[key]]));
    for (const [key, path, out = (v) => v] of SPACE_STATE) {
      const owner = path.slice(0, -1).reduce((o, name) => o[name], data), value = out(view.state[key]);
      if (owner[path.at(-1)] !== value) owner[path.at(-1)] = value;
    }
  };
  const fromSpace = () => {
    const data = space(false);
    for (const [key, path, , back = (v) => v] of SPACE_STATE) {
      const value = back(path.reduce((o, name) => o[name], data));
      if (value !== view.state[key]) (key === 'shading' ? view.setShading(value) : (view.state[key] = value));
    }
    for (const key of REGION_STATE) if (data[key] !== laidOut[key]) view.state[key] = data[key];
    view.sync?.();
  };

  // What block-view.js needs to draw a region of the view's area: Main and the view made current before Blender reads
  // them, the scene and the view after a button changed them.
  const after = () => { scene.view(); fromSpace(); changed(); state.revision++; };
  const blenderUI = (type) => markRaw({
    inContext: (fn) => { scene.flush(); toSpace(); return area().inContext(type, fn); },
    refresh: after,
    undoPush: (name) => { after(); undoPush(name); },
    report: (error) => console.warn(error),
    run: (idname, props, event) => { ui.run(idname, props, event); fromSpace(); state.revision++; },
    keys: (idname, props) => ui.keys(idname, props),
    panelClosed: (id, closed) => area().inContext(type, (C) => panelClosedSet(C, id, closed)),
  });
  const blenderUIs = Object.fromEntries([RGN_TYPE_HEADER, RGN_TYPE_TOOL_HEADER, RGN_TYPE_UI, ...SHELF].map((type) => [type, blenderUI(type)]));
  // An asset's drag invokes the shelf's drag operator (Blend Pose Asset) from where it leaves the press, as a press does.
  blenderUIs[RGN_TYPE_ASSET_SHELF].dragged = (b, e) => {
    const call = blenderUIs[RGN_TYPE_ASSET_SHELF].inContext((C) => viewItemDrag(C, b));
    const properties = call && Object.fromEntries(Object.entries(call.properties).filter(([, value]) => value !== null));
    if (call) ui.run(call.operator, properties, { type: 'leftmouse', value: 'PRESS', x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY, view, invoke: true });
  };
  const blenderHeader = (type) => (blenderUIs[type].inContext((C) => regionHeader(C)) ?? []).map((tree) => h(BlockView, { tree, ui: blenderUIs[type], header: true }));

  // The asset shelf shows as Blender shows it (its shelf types' polls, the pose library's in Pose Mode, and View > Asset
  // Shelf), at Blender's heights, once per redraw.
  let shelfRevision = -1, shelfHeights = {};
  const shelfShown = (type) => {
    if (shelfRevision !== state.revision) {
      shelfRevision = state.revision;
      shelfHeights = legacy() || !view.canvas.clientWidth ? {} : area(false).regionsShown(SHELF);
      shelf.hidden = !(RGN_TYPE_ASSET_SHELF in shelfHeights);
      shelfHeader.style.height = `${shelfHeights[RGN_TYPE_ASSET_SHELF_HEADER] ?? 0}px`;
      shelfMain.style.height = `${shelfHeights[RGN_TYPE_ASSET_SHELF] ?? 0}px`;
    }
    return type in shelfHeights;
  };
  // Its layout may start reading an asset library, a job of the window's.
  const shelfRegion = (type, layout) => {
    if (!shelfShown(type)) return null;
    const trees = blenderUIs[type].inContext(layout) ?? [];
    ticking();
    return trees.map((tree) => h(BlockView, { tree, ui: blenderUIs[type], header: type === RGN_TYPE_ASSET_SHELF_HEADER }));
  };

  const mount = (el, render, blender) => {
    const app = createApp({ render: () => { void state.revision; return blender && !legacy() ? blender() : state.ready ? render() : null; } });
    app.mount(el);
    return app;
  };
  const header = (region, draw) => {
    const ctx = context(region);
    return h(LayoutView, { layout: headerLayout(ctx, (layout) => draw(layout, ctx)), ui: layoutUI(region) });
  };
  const drawHeaderType = (type) => (layout, ctx) => drawType(type, layout, ctx);

  const sidebarRegion = () => {
    const ctx = context('UI'), contexts = [MODE_CONTEXTS[ctx.mode]];
    const roots = types('UI').roots.filter(({ type }) => (!type.bl_context || contexts.includes(type.bl_context)) && polls(type, ctx));
    const categories = [...new Set(roots.map(({ type }) => type.bl_category))];
    const category = categories.includes(state.category) ? state.category : categories[0];
    const drawn = drawPanels({ roots: roots.filter(({ type }) => type.bl_category === category) }, ctx, { contexts, open: panels.isOpen });
    return [
      h(RegionView, { panels: drawn, ui: layoutUI('UI') }),
      h('nav', { class: 'bl-region-tabs', role: 'tablist' }, categories.map((name) => h('button', {
        type: 'button', class: 'bl-region-tab', role: 'tab', 'aria-selected': String(name === category), onClick: () => { state.category = name; },
      }, name))),
    ];
  };

  // Blender lays the tool settings out in the tool header region once the view's area has it (a split's new view has
  // none on its first draw).
  const toolSettings = () => (view.canvas.clientWidth && toolHeader.isConnected && !toolHeader.hidden ? blenderHeader(RGN_TYPE_TOOL_HEADER) : []);
  const apps = [
    mount(headerRegion, () => header('HEADER', drawHeaderType(headers.VIEW3D_HT_header)), () => blenderHeader(RGN_TYPE_HEADER)),
    // The tool settings are the workspace's tools' (WorkSpace.tools) in every mode.
    mount(toolHeader, () => toolSettings(), () => toolSettings()),
    mount(sidebar, sidebarRegion, () => (sidebar.hidden ? null : sidebarView(blenderUIs[RGN_TYPE_UI]))),
    mount(shelfHeader, () => null, () => shelfRegion(RGN_TYPE_ASSET_SHELF_HEADER, (C) => regionHeader(C))),
    mount(shelfMain, () => null, () => shelfRegion(RGN_TYPE_ASSET_SHELF, (C) => regionLayout(C))),
  ];

  loadRNAUI(() => import('../../makesrna/rna-ui.json')).then(() => { state.ready = true; draw(); });
  function draw() {
    const { state: regions } = view;
    toolHeader.hidden = !regions.show_region_tool_header;
    sidebar.hidden = !regions.show_region_ui;
    state.revision++;
  }
  // The regions' rectangles in the page, for the view's area (the regions not shown are hidden there).
  const rects = () => Object.fromEntries([[RGN_TYPE_HEADER, headerRegion], [RGN_TYPE_TOOL_HEADER, toolHeader], [RGN_TYPE_UI, sidebar], [RGN_TYPE_TOOLS, view.toolbar?.el],
    [RGN_TYPE_ASSET_SHELF, shelfMain], [RGN_TYPE_ASSET_SHELF_HEADER, shelfHeader]]
    .filter(([, el]) => el)
    .filter(([, el]) => !el.hidden && !el.parentElement?.hidden && el.isConnected).map(([type, el]) => [type, el.getBoundingClientRect()])
    .filter(([, r]) => r.width && r.height).map(([type, r]) => [type, { x: r.left, y: r.top, width: r.width, height: r.height }]));
  return { header: headerRegion, toolHeader, sidebar, shelf, draw, rects, blenderUI: blenderUI(RGN_TYPE_WINDOW), dispose: () => { apps.forEach((app) => app.unmount()); [headerRegion, toolHeader, sidebar, shelf].forEach((el) => el.remove()); } };
}
