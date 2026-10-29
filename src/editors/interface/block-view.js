// Blender's layout trees (ui-tree.js: what Blender's uiLayout laid out in the module) drawn by the browser: a layout
// is a row, column, split, box or flow of what it holds, sized in proportion to the widths Blender gave them; a button
// is one widget per Blender button type, showing what Blender's button shows (its text, the value it displays, its
// icon, pressed or not). Pressing one applies it as Blender applies it (ui_button_press), an operator button runs its
// operator, a property's value is set through RNA (bpy_rna.js) and then the button's functions run; a button that
// opens something (a menu, an enum's items, a popover) has the module lay that out too.
//
// API, for any editor that draws Blender's trees:
//   h(BlockView, { tree, ui })          a layout tree
//   h(PanelsView, { panels, ui })       a region's panels (ui-tree.js regionPanels)
//   treeMenu(tree, ui)                  a menu tree as menu.js entries
// `ui`: { inContext(fn(C)): runs fn with the region's context, refresh(), undoPush(name), run(idname, props, event),
//   keys(idname, props): a shortcut, panelClosed(id, closed), report(error), button(b): a property button as the
//   active button its keymap and context menu act on (keyframing-button.js blenderButton) }
import { cloneVNode, defineComponent, h } from 'vue';
import { NumberField } from './components/ui/number-field/index.js';
import { openMenu } from './menu.js';
import { icon, label, button, checkbox, textField, menuButton, pulldown, colorSwatch, displayValue } from './layout-view.js';
import { rnaProperty } from '../../makesrna/rna.js';
import { pointerStruct } from '../../python/bpy_rna.js';
import { buttonMenu, buttonPress, buttonApplied, buttonValueSet, buttonTextSet } from './ui-tree.js';
import { parse as parseUnit, editText as unitText } from '../../blenkernel/unit.js';
import { hoverButton, leaveButton } from '../animation/keyframing-button.js';

const W = 'bl-widget';
const struct = ({ pointer }) => pointerStruct(...pointer);

// The corners a button squares where it is aligned with its neighbours (ui_block_align_calc).
function corners(aligned = '') {
  const square = (a, b) => (aligned.includes(a) || aligned.includes(b) ? '0' : null);
  const radius = [square('T', 'L'), square('T', 'R'), square('B', 'R'), square('B', 'L')];
  return radius.some((r) => r === '0') ? { borderRadius: radius.map((r) => r ?? 'var(--bl-radius, 4px)').join(' ') } : {};
}

// A property button's value and its setting through RNA, then the button's functions (ui_apply_but_funcs_after).
function rnaValue(b) {
  const value = struct(b.rna)[b.rna.prop];
  return b.rna.index >= 0 && value?.__getitem__ ? value.__getitem__(b.rna.index) : value;
}
function setRna(b, value, ui, finish = true) {
  try {
    const data = struct(b.rna);
    if (b.rna.index >= 0) data[b.rna.prop][b.rna.index] = value;
    else data[b.rna.prop] = value;
    ui.inContext((C) => buttonApplied(C, b));
    if (finish) ui.undoPush(b.tip || b.rna.prop);
    ui.refresh();
  } catch (error) {
    ui.report?.(error);
  }
}
const press = (b, ui, value = -1) => {
  ui.inContext((C) => buttonPress(C, b, value));
  ui.undoPush(b.text || b.tip || b.type);
  ui.refresh();
};

// What a button opens, laid out by the module: a popover's panel below the button, else a menu.
function open(b, ui, event) {
  const tree = ui.inContext((C) => buttonMenu(C, b));
  if (!tree) return;
  if (b.popover || b.type === 'POPOVER') return openPopover(tree, ui, event.currentTarget);
  openMenu(treeMenu(tree, ui), event.currentTarget, b.type === 'MENU' ? b.text : undefined);
}

// A menu tree's items as menu.js entries: operators, toggles and enum items, labels as headings, separators and
// sub-menus, opened when shown.
export function treeMenu(tree, ui) {
  const items = [];
  const visit = (node) => {
    if (node.kind !== 'button') return node.children?.forEach(visit);
    const text = node.text || node.display || '';
    const iconName = node.icon && node.icon !== 'NONE' ? node.icon : undefined;
    switch (node.type) {
      case 'SEPR': case 'SEPR_LINE': items.push('-'); break;
      case 'SEPR_SPACER': break;
      case 'LABEL': if (text) items.push({ heading: text }); break;
      case 'PULLDOWN': case 'MENU': case 'POPOVER': case 'BLOCK':
        items.push({ label: text, icon: iconName, blender: node.menu, items: () => treeMenu(ui.inContext((C) => buttonMenu(C, node)) ?? { children: [] }, ui) });
        break;
      default:
        items.push({
          label: text, icon: iconName, title: node.tip, blender: node.operator,
          enabled: () => !node.disabled,
          ...(['TOGGLE', 'TOGGLE_N', 'ICON_TOGGLE', 'ICON_TOGGLE_N', 'CHECKBOX', 'CHECKBOX_N', 'ROW'].includes(node.type) && { checked: () => !!node.selected }),
          ...(node.operator && { keys: ui.keys?.(node.operator, node.properties ?? {}) }),
          run: (event) => (node.operator ? ui.run(node.operator, node.properties ?? {}, event) : press(node, ui)),
        });
    }
  };
  visit(tree);
  return items.filter((item, i, all) => item !== '-' || (i > 0 && all[i - 1] !== '-' && i < all.length - 1));
}

// A popover's panel, below the button that opened it; a press outside closes it.
function openPopover(tree, ui, owner) {
  const r = owner.getBoundingClientRect(), host = document.createElement('div');
  host.className = 'bl-ui bl-popover-block flex flex-col';
  Object.assign(host.style, { left: `${r.left}px`, top: `${r.bottom + 2}px`, width: `calc(var(--bl-row) * ${Math.max(10, tree.children?.[0]?.w ?? 10)})` });
  document.body.append(host);
  const close = (e) => { if (!host.contains(e.target)) { host.remove(); removeEventListener('pointerdown', close, true); } };
  addEventListener('pointerdown', close, true);
  import('vue').then(({ createApp }) => createApp({ render: () => h(BlockView, { tree, ui }) }).mount(host));
}

// The RNA property a number button edits, as the interface shows it (its unit, range and precision).
const meta = (b) => (b.rna ? rnaProperty(b.rna.owner, b.rna.prop) : null) ?? { type: 'F', min: b.min, max: b.max, soft_min: b.soft_min, soft_max: b.soft_max };
const unitOf = (m) => (m.unit === 'LENGTH' ? 'length' : m.unit === 'ROTATION' ? 'angle' : null);

function number(b, env) {
  const { ui } = env, m = { ...meta(b), min: b.min, max: b.max, soft_min: b.soft_min, soft_max: b.soft_max };
  const value = b.rna ? Number(rnaValue(b)) : b.value ?? 0;
  const set = (v, finish) => (b.rna ? setRna(b, v, ui, finish) : (ui.inContext((C) => buttonValueSet(C, b, v)), ui.refresh()));
  return h(NumberField, {
    modelValue: value, label: b.text ?? '', meta: m, disabled: b.disabled, inactive: b.inactive, class: W, style: corners(b.aligned),
    slider: b.type === 'NUMSLIDER', display: (v) => displayValue(m, v), editText: (v) => (unitOf(m) ? unitText(v, unitOf(m)) : String(Number(v.toFixed(6)))),
    parse: (text) => parseUnit(String(text).replace(/\s*(mm|W|kg|s|K|nm|Hz|px|%)\s*$/, ''), unitOf(m)),
    'onUpdate:modelValue': (v) => set(v, false), onCommit: () => ui.undoPush(b.tip || b.rna?.prop || 'Value'),
  });
}

const TOGGLES = new Set(['TOGGLE', 'TOGGLE_N', 'ICON_TOGGLE', 'ICON_TOGGLE_N', 'BUT_TOGGLE']);

// A property button is the region's active button while the pointer is over it, and its right click opens Blender's
// context menu of it.
function buttonNode(b, env) {
  const vnode = widgetNode(b, env);
  if (!vnode || !b.rna || !env.ui.button) return vnode;
  const button = env.ui.button(b);
  return cloneVNode(vnode, { onPointerenter: () => hoverButton(button), onPointerleave: () => leaveButton(button),
    onContextmenu: (e) => { e.preventDefault(); button.menu(e); } });
}

function widgetNode(b, env) {
  const { ui } = env, text = b.text ?? '', shown = b.display ?? text, iconName = b.icon, style = corners(b.aligned);
  const common = { disabled: b.disabled || !env.enabled, inactive: b.inactive || !env.active, title: b.tip };
  const flat = b.emboss === 'NONE' || b.emboss === 'NONE_OR_STATUS' || env.emboss === 'NONE';
  const withStyle = (vnode) => { if (vnode) vnode.props = { ...vnode.props, style: { ...vnode.props?.style, ...style }, 'data-blender': b.operator ?? b.rna?.prop }; return vnode; };
  switch (b.type) {
    case 'LABEL': return label(shown, { iconName, align: b.text_right ? 'right' : 'left', className: common.inactive ? 'opacity-50' : '' });
    case 'SEPR': return h('div', { class: 'bl-separator shrink-0' });
    case 'SEPR_LINE': return h('div', { class: 'bl-separator shrink-0', 'data-type': 'LINE' });
    case 'SEPR_SPACER': return h('div', { class: 'flex-1' });
    case 'NUM': case 'NUMSLIDER': return number(b, env);
    case 'CHECKBOX': case 'CHECKBOX_N':
      return checkbox({ checked: !!b.selected, text: shown, ...common, onChange: () => press(b, ui) });
    case 'TEXT':
      return withStyle(textField({ value: b.rna ? String(rnaValue(b) ?? '') : b.value ?? shown, iconName, ...common,
        onChange: (v) => (b.rna ? setRna(b, v, ui) : (ui.inContext((C) => buttonTextSet(C, b, v)), ui.refresh())) }));
    case 'COLOR':
      return withStyle(colorSwatch({ value: b.rna ? [...struct(b.rna)[b.rna.prop]] : [0, 0, 0], ...common, onChange: (v, finish) => setRna({ ...b, rna: { ...b.rna, index: -1 } }, v, ui, finish) }));
    case 'MENU': case 'POPOVER': case 'BLOCK': case 'COLOR_BAND':
      return withStyle(menuButton({ text: shown, iconName, ...common, iconOnly: !shown && !!iconName, onClick: (e) => open(b, ui, e) }));
    case 'PULLDOWN':
      return env.header ? pulldown({ text: shown, iconName, disabled: common.disabled, menu: b.menu, items: () => treeMenu(ui.inContext((C) => buttonMenu(C, b)) ?? { children: [] }, ui) })
        : withStyle(menuButton({ text: shown, iconName, ...common, onClick: (e) => open(b, ui, e) }));
    case 'SEARCH_MENU': {
      if (!b.search) return withStyle(textField({ value: shown, iconName, ...common, onChange: (v) => { ui.inContext((C) => buttonTextSet(C, b, v)); ui.refresh(); } }));
      const items = () => [...struct(b.search)[b.search.prop]].map((item) => ({ label: item.name, run: () => setRna(b, item, ui) }));
      return withStyle(menuButton({ text: shown, iconName, ...common, items }));
    }
    case 'DECORATOR':
      return h('button', { type: 'button', class: 'bl-decorator flex h-unit w-unit shrink-0 items-center justify-center', 'aria-label': b.tip || 'Decorator', title: b.tip,
        disabled: common.disabled, onClick: () => press(b, ui) }, icon(iconName));
    case 'LISTBOX': return null;
    case 'ROW': case 'LISTROW': case 'TAB':
      return withStyle(button({ text: shown, iconName, kind: 'radio', pressed: !!b.selected, ...common, iconOnly: !shown, emboss: !flat, className: 'flex-1', onClick: () => press(b, ui) }));
    default:
      if (TOGGLES.has(b.type)) {
        return withStyle(button({ text: shown, iconName, kind: 'toggle', pressed: !!b.selected, ...common, iconOnly: !shown, emboss: !flat, onClick: () => press(b, ui) }));
      }
      return withStyle(button({ text: shown, iconName, kind: 'tool', ...common, iconOnly: !shown && !!iconName, emboss: !flat, pressed: !!b.selected, className: 'flex-1',
        onClick: (event) => (b.operator ? ui.run(b.operator, b.properties ?? {}, event) : b.opens ? open(b, ui, event) : press(b, ui)) }));
  }
}

const LAYOUT_CLASS = {
  row: 'bl-row flex min-w-0 items-center', split: 'bl-split flex min-w-0', box: 'bl-box flex flex-col rounded-md p-1.5',
  column_flow: 'bl-grid grid min-w-0', grid_flow: 'bl-grid grid min-w-0', row_flow: 'bl-row flex min-w-0 flex-wrap', header: 'bl-row flex min-w-0 items-center',
  menu: 'bl-col flex min-w-0 flex-col', overlap: 'bl-overlap grid min-w-0', radial: 'bl-col flex min-w-0 flex-col', absolute: 'relative min-w-0',
};
const HORIZONTAL = new Set(['row', 'split', 'header', 'row_flow']);

// A child's size in its layout: in a row, its share of the row as Blender divided it, or its own width where Blender
// keeps it (a header, an aligned row, an icon).
function childStyle(child, node, env) {
  const w = child.w ?? 0;
  if (!HORIZONTAL.has(node.kind) || !w) return {};
  const fixed = env.header || (node.alignment && node.alignment !== 'EXPAND') || (child.kind === 'button' && !child.text && !child.display && w <= 1.01);
  return fixed ? { flex: `0 0 calc(var(--bl-row) * ${w})`, width: `calc(var(--bl-row) * ${w})` } : { flex: `${w} ${w} 0`, minWidth: 0 };
}

function layoutNode(node, env) {
  if (node.kind === 'button') return buttonNode(node, env);
  const inner = { ...env, active: env.active && node.active !== false, enabled: env.enabled && node.enabled !== false, emboss: node.emboss ?? env.emboss,
    header: env.header || (node.kind === 'row' && env.root) };
  delete inner.root;
  if (node.kind === 'header' && env.layoutPanels) return layoutPanelHeader(node, inner);
  const children = node.children.map((child) => {
    const drawn = layoutNode(child, inner);
    if (drawn) drawn.props = { ...drawn.props, style: { ...drawn.props?.style, ...childStyle(child, node, inner) } };
    return drawn;
  }).filter(Boolean);
  const horizontal = HORIZONTAL.has(node.kind);
  const align = node.align ? (horizontal ? 'bl-align-row' : 'bl-align-col') : (horizontal ? 'gap-[var(--bl-row-gap)]' : 'gap-[var(--bl-button-gap)]');
  const justify = { LEFT: 'justify-start', RIGHT: 'justify-end', CENTER: 'justify-center' }[node.alignment] ?? '';
  return h('div', {
    class: [LAYOUT_CLASS[node.kind] ?? 'bl-col flex min-w-0 flex-col', align, justify, node.alert && 'bl-alert', !inner.active && 'bl-inactive',
      (node.emboss === 'NONE' || node.emboss === 'NONE_OR_STATUS') && 'bl-emboss-none'],
    style: node.kind.endsWith('_flow') && node.kind !== 'row_flow' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(calc(var(--bl-row) * 6), 1fr))' } : {},
  }, children);
}

// A layout panel's header (UILayout.panel): a click opens or closes it through the property Blender keeps its state in.
function layoutPanelHeader(node, env) {
  const state = env.layoutPanels[env.layoutPanelIndex.value++];
  const toggle = (e) => {
    if (!state || e.target.closest('input,button,[role=spinbutton]')) return;
    pointerStruct(...state.pointer)[state.prop] = !state.open;
    env.ui.refresh();
  };
  return h('div', { class: 'bl-subpanel-header flex h-unit min-w-0 items-center gap-1', onClick: toggle }, [
    icon(state?.open ? 'DOWNARROW_HLT' : 'RIGHTARROW', 'bl-disclosure'),
    ...node.children.map((child) => layoutNode(child, env)).filter(Boolean),
  ]);
}

const rootEnv = (ui, extra = {}) => ({ ui, active: true, enabled: true, root: true, ...extra });

export const BlockView = defineComponent({
  name: 'BlockView',
  props: { tree: Object, ui: Object },
  setup: (props) => () => (props.tree ? layoutNode(props.tree, rootEnv(props.ui)) : null),
});

// A region's panel as interface_panel.cc draws it: its header (disclosure, draw_header's layout, label, preset), then
// its body and open sub-panels; Blender keeps it open or closed.
function panelNode(panel, ui, sub = false) {
  const part = (name) => panel.parts.find((p) => p.part === name)?.layout;
  const layoutIndex = { value: 0 }, env = (extra) => rootEnv(ui, { layoutPanels: panel.layout_panels, layoutPanelIndex: layoutIndex, ...extra });
  const body = part('body') ? layoutNode(part('body'), env()) : null;
  if (panel.hide_header) return h('div', { key: panel.id, class: 'bl-panel-plain', 'data-blender': panel.id }, body);
  const toggle = (e) => { if (!e.target.closest('input,button,[role=spinbutton]')) { ui.panelClosed(panel.id, !panel.closed, e); ui.refresh(); } };
  return h('section', { key: panel.id, class: ['bl-panel', sub ? 'bl-subpanel' : 'bl-panel-root', !panel.closed && 'is-open'], 'data-blender': panel.id }, [
    h('header', { class: 'bl-panel-header flex items-center', onClick: toggle }, [
      icon(panel.closed ? 'RIGHTARROW' : 'DOWNARROW_HLT', 'bl-disclosure'),
      part('header') ? h('div', { class: 'bl-panel-header-layout flex items-center' }, layoutNode(part('header'), env({ header: true }))) : null,
      panel.text ? h('span', { class: 'bl-panel-label truncate' }, panel.text) : null,
      h('div', { class: 'flex-1' }),
      part('preset') ? h('div', { class: 'flex items-center' }, layoutNode(part('preset'), env({ header: true }))) : null,
      sub ? null : icon('GRIP', 'bl-grip'),
    ]),
    panel.closed ? null : h('div', { class: 'bl-panel-body' }, [body, ...panel.children.map((child) => panelNode(child, ui, true))]),
  ]);
}

export const PanelsView = defineComponent({
  name: 'PanelsView',
  props: { panels: Array, ui: Object },
  setup: (props, { slots }) => () => h('div', { class: 'bl-ui bl-region-panels flex flex-col' }, [...props.panels.map((p) => panelNode(p, props.ui)), slots.default?.()]),
});
