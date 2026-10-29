// The 3D View's regions besides the toolbar: the header (VIEW3D_HT_header) and the sidebar (RGN_TYPE_UI) with its
// tabs, laid out by Blender in the view's area of its window (ui-tree.js) and drawn by block-view.js. The tool
// settings row (RGN_TYPE_TOOL_HEADER, VIEW3D_HT_tool_header), which needs the workspace's tools, and Bylonder's own
// mesh Edit Mode, which Main does not know, still draw Blender's scripts through the JS layout (layout-view.js).
import { createApp, h, reactive, markRaw } from 'vue';
import { BlockView, PanelsView } from '../interface/block-view.js';
import { regionHeader, regionPanels, categorySet, panelClosedSet } from '../interface/ui-tree.js';
import { contextStruct } from '../../python/bpy_rna.js';
import { panels, headers, menus } from '../../python/bpy_interface.js';
import { loadRNAUI } from '../../makesrna/rna.js';
import { panelTypes, drawPanels, headerLayout, idname, drawType } from '../interface/panels.js';
import { LayoutView, RegionView, panelState } from '../interface/layout-view.js';
import { drawMenu } from '../interface/ui-layout.js';
import { VIEW3D_PT_transform } from './view3d-buttons.js';
import './view3d-regions.css';

// Panel types in the order Blender registers them: C panels (view3d_buttons_register), then the scripts' modules.
const MODULES = [{ classes: [VIEW3D_PT_transform] }, { classes: Object.values(panels) }];
// view3d_buttons_region_layout: the context string of each mode.
const MODE_CONTEXTS = { OBJECT: '.objectmode', EDIT_MESH: '.mesh_edit' };
const RGN_TYPE_WINDOW = 0, RGN_TYPE_HEADER = 1, RGN_TYPE_UI = 4, RGN_TYPE_TOOLS = 5, RGN_TYPE_TOOL_HEADER = 12;
// The view's state Bylonder draws with (view3d.js) as the area's SpaceView3D has it, by RNA path.
const SHADING = { wire: 'WIREFRAME', solid: 'SOLID', material: 'MATERIAL', rendered: 'RENDERED' };
const SPACE_STATE = [
  ['show_gizmo', ['show_gizmo']],
  ['overlays', ['overlay', 'show_overlays']],
  ['xray', ['shading', 'show_xray'], (value) => !!value],
  ['shading', ['shading', 'type'], (value) => SHADING[value], (type) => Object.keys(SHADING).find((id) => SHADING[id] === type)],
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
  const blenderUIs = { [RGN_TYPE_HEADER]: blenderUI(RGN_TYPE_HEADER), [RGN_TYPE_UI]: blenderUI(RGN_TYPE_UI) };
  const blenderHeader = (type) => (blenderUIs[type].inContext((C) => regionHeader(C)) ?? []).map((tree) => h(BlockView, { tree, ui: blenderUIs[type], header: true }));
  const blenderSidebar = () => {
    const sidebarUI = blenderUIs[RGN_TYPE_UI], { category, categories, panels: drawn } = sidebarUI.inContext((C) => regionPanels(C));
    return [
      h(PanelsView, { panels: drawn, ui: sidebarUI }),
      h('nav', { class: 'bl-region-tabs', role: 'tablist' }, categories.map((name) => h('button', {
        type: 'button', class: 'bl-region-tab', role: 'tab', 'aria-selected': String(name === category),
        onClick: () => { area().inContext(RGN_TYPE_UI, (C) => categorySet(C, name)); state.revision++; },
      }, name))),
    ];
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

  const apps = [
    mount(headerRegion, () => header('HEADER', drawHeaderType(headers.VIEW3D_HT_header)), () => blenderHeader(RGN_TYPE_HEADER)),
    // The tool settings stay the JS layout's until the window's workspace has Blender's tools (WorkSpace.tools).
    mount(toolHeader, () => header('TOOL_HEADER', drawHeaderType(headers.VIEW3D_HT_tool_header))),
    mount(sidebar, sidebarRegion, () => (sidebar.hidden ? null : blenderSidebar())),
  ];

  loadRNAUI(() => import('../../makesrna/rna-ui.json')).then(() => { state.ready = true; draw(); });
  function draw() {
    const { state: regions } = view;
    toolHeader.hidden = !regions.show_region_tool_header;
    sidebar.hidden = !regions.show_region_ui;
    state.revision++;
  }
  // The regions' rectangles in the page, for the view's area (the regions not shown are hidden there).
  const rects = () => Object.fromEntries([[RGN_TYPE_HEADER, headerRegion], [RGN_TYPE_TOOL_HEADER, toolHeader], [RGN_TYPE_UI, sidebar], [RGN_TYPE_TOOLS, view.toolbar?.el]]
    .filter(([, el]) => el)
    .filter(([, el]) => !el.hidden && el.isConnected).map(([type, el]) => [type, el.getBoundingClientRect()])
    .filter(([, r]) => r.width && r.height).map(([type, r]) => [type, { x: r.left, y: r.top, width: r.width, height: r.height }]));
  return { header: headerRegion, toolHeader, sidebar, draw, rects, blenderUI: blenderUI(RGN_TYPE_WINDOW), dispose: () => { apps.forEach((app) => app.unmount()); [headerRegion, toolHeader, sidebar].forEach((el) => el.remove()); } };
}
