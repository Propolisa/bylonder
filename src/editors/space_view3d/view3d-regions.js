// The 3D View's regions drawn from Blender's scripts besides the toolbar: the header (VIEW3D_HT_header), the tool
// settings row (RGN_TYPE_TOOL_HEADER, VIEW3D_HT_tool_header) and the sidebar
// (RGN_TYPE_UI): its tabs (the panels' bl_category, in the order the panels register) and the panels of the active
// tab whose context (the mode's, '.objectmode') and poll() match, with their sub-panels. All draw through the shared
// layout renderer (interface/layout-view.js).
import { createApp, h, reactive, markRaw } from 'vue';
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
const polls = (type, context) => { try { return !type.poll || !!type.poll(context); } catch { return false; } };

// `context(region)` gives bpy.context for a region of the view, `ui` runs operators and draws menus (menuUI), `menu(idname)`
// draws a menu of the header's (the mode's own), `templates` are the header's C templates, `changed()` redraws after an
// edit, which `undoPush(name)` records.
export function createRegions({ view, context, ui, menu, templates, changed, undoPush }) {
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

  const mount = (el, render) => {
    const app = createApp({ render: () => { void state.revision; return state.ready ? render() : null; } });
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
    mount(headerRegion, () => header('HEADER', drawHeaderType(headers.VIEW3D_HT_header))),
    mount(toolHeader, () => header('TOOL_HEADER', drawHeaderType(headers.VIEW3D_HT_tool_header))),
    mount(sidebar, sidebarRegion),
  ];

  loadRNAUI(() => import('../../makesrna/rna-ui.json')).then(() => { state.ready = true; draw(); });
  function draw() {
    const { state: regions } = view;
    toolHeader.hidden = !regions.show_region_tool_header;
    sidebar.hidden = !regions.show_region_ui;
    state.revision++;
  }
  return { header: headerRegion, toolHeader, sidebar, draw, dispose: () => { apps.forEach((app) => app.unmount()); [headerRegion, toolHeader, sidebar].forEach((el) => el.remove()); } };
}
