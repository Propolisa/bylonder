// The 3D View's toolbar region (RGN_TYPE_TOOLS): Blender's own VIEW3D_PT_tools_active.draw_cls (transpiled) lays out
// the active mode's tools, which are drawn as Blender draws them: one icon column (two, or icons with their labels,
// as the region widens), groups whose button shows its last used tool and a corner triangle, opening the group's
// tools (WM_MT_toolsystem_submenu) on press and hold or drag, the active tool depressed, and tooltips with the tool's
// description and shortcuts. Buttons run wm.tool_set_by_id.
import { pyArgs } from '../../makesrna/rna.js';
import { useContext, drawMenu } from '../interface/ui-layout.js';
import { openMenu, closeMenus } from '../interface/menu.js';
import { WM_MT_toolsystem_submenu } from '../../bl_ui/space_toolsystem_common.js';
import rnaOperators from '../../makesrna/rna-operators.json' with { type: 'json' };
import { WM_DRAG_THRESHOLD_MOUSE } from '../../windowmanager/wm-event-system.js';
import { toolIconUrl } from '../interface/icon.js';
// interface_handlers.cc: BUTTON_AUTO_OPEN_THRESH, and the tooltip delay (UI_TOOLTIP_DELAY).
const HOLD_DELAY = 200, TOOLTIP_DELAY = 500;
// ED_region_generic_tools_region_snap_size: one column, two columns, and labels (UI_TOOLBAR_COLUMN and _MARGIN).
const COLUMN = 40, MARGIN = 16;
export const TOOLBAR_SNAP = [COLUMN + MARGIN, 2 * COLUMN + MARGIN, 2.7 * COLUMN + MARGIN];

// The layout calls draw_cls makes: columns and rows of tool buttons (operator, operator_menu_hold) and blank labels.
class ToolbarLayout {
  constructor(kind) {
    this.kind = kind;
    this.children = [];
    this.scale_x = this.scale_y = 1;
  }

  #add(child) { this.children.push(child); return child; }
  column() { return this.#add(new ToolbarLayout('column')); }
  row() { return this.#add(new ToolbarLayout('row')); }
  label() { this.#add({ kind: 'label' }); }
  operator(...list) {
    const { operator, text, depress, icon_value } = pyArgs(list, ['operator', 'text', 'text_ctxt', 'translate', 'icon', 'emboss', 'depress', 'icon_value']);
    // The operator's properties the script sets: name, which Transcrypt calls py_name.
    return this.#add({ kind: 'button', operator, text, depress: !!depress, icon: icon_value, props: { get name() { return this.py_name; } } }).props;
  }

  operator_menu_hold(...list) {
    const props = this.operator(...list);
    this.children.at(-1).menu = pyArgs(list, ['operator', 'text', 'text_ctxt', 'translate', 'icon', 'emboss', 'menu']).menu;
    return props;
  }
}

// `context(width)` gives bpy.context for the toolbar at a width, `ui` what drawMenu needs for the flyouts (menuUI),
// `run(idname, props)` runs an operator, `keys(idname, props, strict)` its shortcut in Blender's keymaps.
export function createToolbar({ panel, context, ui, run, keys, width = TOOLBAR_SNAP[0], resized = () => {} }) {
  const el = Object.assign(document.createElement('nav'), { className: 'bl-toolbar' });
  el.setAttribute('aria-label', 'Toolbar');
  const tooltip = Object.assign(document.createElement('div'), { className: 'bl-tooltip', hidden: true });
  const edge = Object.assign(document.createElement('div'), { className: 'bl-region-edge' });
  let tooltipTimer = 0;

  const draw = () => {
    const ctx = context(width), layout = new ToolbarLayout('column');
    useContext(ctx);
    panel.draw_cls(layout, ctx);
    el.style.width = width + 'px';
    el.classList.toggle('bl-toolbar-text', layout.children.some((c) => c.children?.some((b) => b.text)));
    el.replaceChildren(...layout.children.map((node) => element(node, ctx)), edge);
  };

  const element = (node, ctx) => {
    if (node.kind === 'label') return Object.assign(document.createElement('span'), { className: 'bl-tool-blank' });
    if (node.kind === 'button') return button(node, ctx);
    const box = Object.assign(document.createElement('div'), { className: `bl-toolbar-${node.kind}` });
    box.append(...node.children.map((child) => element(child, ctx)));
    return box;
  };

  const button = (node, ctx) => {
    const { name } = node.props, item = panel._tool_get_by_id(ctx, name)[0];
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'bl-tool' });
    b.dataset.tool = name;
    b.dataset.blender = 'wm.tool_set_by_id:' + name;
    b.setAttribute('aria-pressed', String(node.depress));
    b.setAttribute('aria-label', item?.label ?? name);
    if (node.icon) b.append(Object.assign(document.createElement('img'), { src: toolIconUrl(node.icon), alt: '', draggable: false }));
    if (node.text) b.append(Object.assign(document.createElement('span'), { className: 'bl-tool-label', textContent: node.text }));
    if (node.menu) b.append(Object.assign(document.createElement('span'), { className: 'bl-tool-hold' }));
    pressable(b, node, ctx);
    b.onpointerenter = () => { clearTimeout(tooltipTimer); tooltipTimer = setTimeout(() => showTooltip(b, item, ctx), TOOLTIP_DELAY); };
    b.onpointerleave = () => { clearTimeout(tooltipTimer); tooltip.hidden = true; };
    return b;
  };

  // A click sets the tool; a group's button opens its tools after a hold or once dragged (ui_handle_button_event's
  // hold_action_timer), and a release over one of them sets it.
  const pressable = (b, node, ctx) => {
    let press = null;
    const open = () => {
      press.opened = true;
      clearTimeout(press.timer);
      tooltip.hidden = true;
      const items = drawMenu('WM_MT_toolsystem_submenu', { ...ui, menus: { WM_MT_toolsystem_submenu }, context: () => ({ ...ctx, button_operator: node.props }) });
      openMenu(items, b, '', { side: true, scale: 2, hold: true });
    };
    b.onpointerdown = (e) => {
      if (e.button) return;
      e.stopPropagation();
      press = { x: e.clientX, y: e.clientY, timer: node.menu && setTimeout(open, HOLD_DELAY) };
      b.setPointerCapture(e.pointerId);
    };
    b.onpointermove = (e) => {
      if (press && node.menu && !press.opened && Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > WM_DRAG_THRESHOLD_MOUSE) open();
    };
    b.onpointerup = (e) => {
      if (!press) return;
      clearTimeout(press.timer);
      b.releasePointerCapture(e.pointerId);
      const clicked = !press.opened && b.contains(document.elementFromPoint(e.clientX, e.clientY));
      press = null;
      if (clicked) { closeMenus(); run('wm.tool_set_by_id', { name: node.props.name }); }
    };
    b.onclick = (e) => { if (!e.detail) run('wm.tool_set_by_id', { name: node.props.name }); };
  };

  // tooltip_data_from_tool: the label (icon-only buttons), the description (description_from_id: the tool's own, else
  // its operator's or its keymap's first operator's), the shortcut setting the tool and the one cycling its group.
  const showTooltip = (b, item, ctx) => {
    if (!item || !b.isConnected) return;
    const operator = item.operator || null;
    const description = typeof item.description === 'function' ? item.description(ctx, item, null) : item.description ??
      rnaOperators[operator]?.description ?? '';
    const group = panel._tool_get_group_by_id(ctx, item.idname, { coerce: true, __kwargtrans__: null }) ?? [item];
    const shortcut = keys('wm.tool_set_by_id', { name: item.idname }, true);
    const cycle = [...group].map((tool) => tool && keys('wm.tool_set_by_id', { name: tool.idname, cycle: true }, true)).find(Boolean);
    const line = (text, className = '') => Object.assign(document.createElement('div'), { className, textContent: text });
    tooltip.replaceChildren(...[
      !b.querySelector('.bl-tool-label') && line(item.label, 'bl-tooltip-title'),
      description && line(description.endsWith('.') ? description : description + '.'),
      shortcut && line('Shortcut: ' + shortcut, 'bl-tooltip-value'),
      cycle && line('Shortcut Cycle: ' + cycle, 'bl-tooltip-value'),
    ].filter(Boolean));
    const r = b.getBoundingClientRect();
    Object.assign(tooltip.style, { left: r.right + 6 + 'px', top: r.top + 'px' });
    tooltip.hidden = false;
  };

  // Dragging the region's edge resizes it, snapping to one column, two, and labels (region_scale_modal).
  edge.onpointerdown = (e) => {
    if (e.button) return;
    e.stopPropagation();
    edge.setPointerCapture(e.pointerId);
    const start = e.clientX, from = width;
    edge.onpointermove = (ev) => {
      const size = from + ev.clientX - start;
      const snapped = size <= TOOLBAR_SNAP.at(-1) ? TOOLBAR_SNAP.reduce((best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best)) : Math.min(size, 400);
      if (snapped !== width) { width = snapped; draw(); resized(width); }
    };
    edge.onpointerup = () => { edge.onpointermove = edge.onpointerup = null; };
  };

  // wm.toolbar: the tools with their labels in a popup at the mouse (draw_cls without layout detection).
  const popup = (at) => {
    const ctx = context(width), layout = new ToolbarLayout('column');
    useContext(ctx);
    panel.draw_cls(layout, ctx, { detect_layout: false, scale_y: 1, __kwargtrans__: null });
    const items = layout.children.flatMap((column) => ['-', ...column.children.filter((b) => b.kind === 'button').map((b) => ({
      label: b.text, image: toolIconUrl(b.icon), checked: undefined, blender: 'wm.tool_set_by_id:' + b.props.name,
      run: () => run('wm.tool_set_by_id', { name: b.props.name }),
    }))]).slice(1);
    openMenu(items, at, '');
  };

  draw();
  document.body.append(tooltip);
  return { el, draw, popup, get width() { return width; }, dispose: () => { el.remove(); tooltip.remove(); } };
}
