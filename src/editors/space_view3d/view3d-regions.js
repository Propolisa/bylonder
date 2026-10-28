// The 3D View's regions drawn from Blender's scripts besides the toolbar: the tool settings row (RGN_TYPE_TOOL_HEADER,
// VIEW3D_HT_tool_header), the header's transform settings (VIEW3D_HT_header.draw_xform_template) and the sidebar
// (RGN_TYPE_UI): its tabs (the panels' bl_category, in the order the panels register) and the panels of the active
// tab whose context (the mode's, '.objectmode') and poll() match, with their sub-panels. Panels and headers draw
// through the interim region-layout.js.
import * as spaceView3d from '../../bl_ui/space_view3d.js';
import * as spaceView3dToolbar from '../../bl_ui/space_view3d_toolbar.js';
import * as spaceView3dSidebar from '../../bl_ui/space_view3d_sidebar.js';
import * as spaceTopbar from '../../bl_ui/space_topbar.js';
import { __in__ } from '../../bl_ui/org.transcrypt.__runtime__.js';
import { useContext } from '../interface/layout.js';
import { iconEl } from '../interface/icon.js';
import { RegionLayout, drawLayout, panelLayout, loadRegionRNA } from './region-layout.js';
import { VIEW3D_PT_transform } from './view3d-buttons.js';

// Panel types in the order Blender registers them: C panels (view3d_buttons_register), then the scripts' modules.
const PANELS = [VIEW3D_PT_transform, ...[spaceView3d, spaceView3dSidebar, spaceView3dToolbar, spaceTopbar]
  .flatMap((module) => module._classes_in_order.filter((name) => /_PT_/.test(name)).map((name) => module[name]))];
const panelType = (idname) => PANELS.find((cls) => (cls.bl_idname || cls.__name__) === idname);
const hasOption = (cls, option) => !!cls.bl_options && __in__(option, cls.bl_options);
// view3d_buttons_region_layout: the context string of each mode.
const MODE_CONTEXTS = { OBJECT: '.objectmode', EDIT_MESH: '.mesh_edit' };

// `context(region)` gives bpy.context for a region of the view, `ui` runs operators and draws menus (menuUI),
// `changed()` redraws after an edit, which `undoPush(name)` records.
export function createRegions({ view, context, ui, changed, undoPush }) {
  const toolHeader = Object.assign(document.createElement('div'), { className: 'bl-tool-header' });
  const xform = Object.assign(document.createElement('div'), { className: 'bl-header-xform' });
  const sidebar = Object.assign(document.createElement('div'), { className: 'bl-sidebar' });
  sidebar.setAttribute('aria-label', 'Sidebar');
  const state = { category: null, closed: new Set(), opened: new Set() };
  let ready = false;

  const layoutUI = (ctx) => ({
    run: ui.run,
    supported: (idname, props) => ui.supported(idname, props),
    menu: (idname) => ui.menuItems(idname),
    popover: (idname) => panelLayout(panelType(idname), ctx),
    panelLabel: (idname) => panelType(idname)?.bl_label ?? idname,
    // popover_group: the sidebar's panels of a context and category, as popovers in the header.
    panelsOf: (contextString, category) => PANELS.filter((cls) => cls.bl_region_type === 'UI' && cls.bl_context === contextString &&
      cls.bl_category === category && !cls.bl_parent_id).map((cls) => cls.bl_idname || cls.__name__),
    changed: (name) => { undoPush(name); changed(); },
  });

  const header = (cls, ctx, method) => {
    useContext(ctx);
    const instance = cls(), layout = new RegionLayout();
    instance.layout = layout;
    method(instance, ctx);
    return layout;
  };

  const drawToolHeader = () => {
    const ctx = context('TOOL_HEADER');
    toolHeader.replaceChildren(drawLayout(header(spaceView3d.VIEW3D_HT_tool_header, ctx, (h, c) => h.draw(c)), layoutUI(ctx), { horizontal: true }));
  };
  const drawXform = () => {
    const ctx = context('HEADER'), layout = new RegionLayout();
    useContext(ctx);
    spaceView3d.VIEW3D_HT_header.draw_xform_template(layout, ctx);
    xform.replaceChildren(drawLayout(layout, layoutUI(ctx), { horizontal: true }));
  };

  // The panels of the sidebar for the context, each { cls, children }.
  const visible = (ctx) => {
    const contextString = MODE_CONTEXTS[ctx.mode];
    const polls = (cls) => { try { return !cls.poll || !!cls.poll(ctx); } catch { return false; } };
    const tree = (parent) => PANELS.filter((cls) => cls.bl_space_type === 'VIEW_3D' && cls.bl_region_type === 'UI' && (cls.bl_parent_id ?? null) === parent &&
      (!cls.bl_context || cls.bl_context === contextString) && polls(cls)).map((cls) => ({ cls, children: tree(cls.bl_idname || cls.__name__) }));
    return tree(null);
  };

  const drawPanel = ({ cls, children }, ctx, sub = false) => {
    const id = cls.bl_idname || cls.__name__, hideHeader = hasOption(cls, 'HIDE_HEADER');
    const open = hideHeader || (hasOption(cls, 'DEFAULT_CLOSED') ? state.opened.has(id) : !state.closed.has(id));
    const el = Object.assign(document.createElement('section'), { className: 'bl-region-panel' + (sub ? ' bl-region-subpanel' : '') });
    el.dataset.blender = id;
    if (!hideHeader) {
      const head = Object.assign(document.createElement('button'), { type: 'button', className: 'bl-region-panel-header' });
      head.append(iconEl(open ? 'disclosure_tri_down' : 'disclosure_tri_right'), Object.assign(document.createElement('span'), { textContent: cls.bl_label }));
      if (cls.draw_header) head.append(drawLayout(header(cls, ctx, (p, c) => p.draw_header(c)), layoutUI(ctx), { horizontal: true }));
      head.onclick = (e) => {
        if (e.target.closest('.bl-rl')) return;
        const set = hasOption(cls, 'DEFAULT_CLOSED') ? state.opened : state.closed;
        set.has(id) ? set.delete(id) : set.add(id);
        drawSidebar();
      };
      el.append(head);
    }
    if (open) {
      let body;
      try {
        body = drawLayout(panelLayout(cls, ctx), layoutUI(ctx));
      } catch (error) {
        body = Object.assign(document.createElement('p'), { className: 'bl-region-error', textContent: String(error.message ?? error) });
      }
      el.append(body, ...children.map((child) => drawPanel(child, ctx, true)));
    }
    return el;
  };

  const drawSidebar = () => {
    const ctx = context('UI'), panels = visible(ctx);
    const categories = [...new Set(panels.map(({ cls }) => cls.bl_category))];
    if (!categories.includes(state.category)) state.category = categories[0];
    const tabs = Object.assign(document.createElement('nav'), { className: 'bl-region-tabs' });
    tabs.setAttribute('role', 'tablist');
    tabs.append(...categories.map((category) => {
      const tab = Object.assign(document.createElement('button'), { type: 'button', className: 'bl-region-tab', textContent: category });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(category === state.category));
      tab.onclick = () => { state.category = category; drawSidebar(); };
      return tab;
    }));
    const body = Object.assign(document.createElement('div'), { className: 'bl-region-panels' });
    body.append(...panels.filter(({ cls }) => cls.bl_category === state.category).map((panel) => drawPanel(panel, ctx)));
    sidebar.replaceChildren(body, tabs);
  };

  loadRegionRNA().then(() => { ready = true; draw(); });
  function draw() {
    const { state: regions } = view;
    toolHeader.hidden = !regions.show_region_tool_header;
    sidebar.hidden = !regions.show_region_ui;
    if (!ready) return;
    if (regions.show_region_tool_header) drawToolHeader();
    drawXform();
    if (regions.show_region_ui) drawSidebar();
  }
  return { toolHeader, xform, sidebar, draw, dispose: () => [toolHeader, xform, sidebar].forEach((el) => el.remove()) };
}
