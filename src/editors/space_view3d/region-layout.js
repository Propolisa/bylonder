// Interim: Blender's UILayout recorded and drawn for the 3D View's header rows and sidebar panels, until the shared
// layout renderer of Blender's panels (the Properties editor's layout.js, panels.js and layout-view.js) replaces this
// module: the recorder's tree follows the same node shapes ({ kind, children, ...settings }), and drawLayout is the one
// call to swap. It draws what the 3D View's scripts use: rows, columns, splits and boxes; props of every RNA type as
// checkboxes, toggles, number fields (drag, or click to type), enum rows and dropdowns, text and pointer fields;
// operators, menus, popovers (a panel drawn in a popup), labels, separators and the spacer. Property names, ranges,
// units and enum items are Blender's RNA (rna-ui.json, rna-operators.json).
import { pyArgs as args } from '../../makesrna/rna.js';
import { operatorIdname } from '../../makesrna/rna-bylonder.js';
import rnaOperators from '../../makesrna/rna-operators.json' with { type: 'json' };
import { useContext } from '../interface/ui-layout.js';
import { iconEl, toolIconUrl } from '../interface/icon.js';
import { openMenu } from '../interface/menu.js';
import { format, parse, editText } from '../../blenkernel/unit.js';
import './region-layout.css';

// Blender's RNA as the interface shows it, loaded before the first draw (2 MB).
let rnaUI = null;
export const loadRegionRNA = async () => { rnaUI ??= (await import('../../makesrna/rna-ui.json')).default; };

// A property's RNA: { name, description, icon, items, unit, subtype, min, max, step, precision } of its struct or the
// operator whose properties the struct holds.
function meta(data, name) {
  const struct = data?.bl_rna?.identifier;
  if (/_OT_/.test(struct ?? '')) {
    const p = rnaOperators[operatorIdname(struct)]?.properties[name];
    return p ? { ...p, items: p.items } : { name };
  }
  for (let s = struct; s; s = rnaUI?.[s]?.base ?? null) if (rnaUI?.[s]?.props[name]) return { ...rnaUI[s].props[name], items: [...(data.enum_items_of?.(name) ?? []), ...(rnaUI[s].props[name].items ?? [])] };
  return { name: name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') };
}

const LAYOUT_ARGS = {
  prop: ['data', 'property', 'text', 'text_ctxt', 'translate', 'icon', 'placeholder', 'expand', 'slider', 'toggle', 'icon_only', 'event', 'full_event', 'emboss', 'index', 'icon_value', 'invert_checkbox'],
  prop_enum: ['data', 'property', 'value', 'text', 'text_ctxt', 'translate', 'icon'],
  prop_with_popover: ['data', 'property', 'text', 'text_ctxt', 'translate', 'icon', 'icon_only', 'panel'],
  operator: ['operator', 'text', 'text_ctxt', 'translate', 'icon', 'emboss', 'depress', 'icon_value'],
  menu: ['menu', 'text', 'text_ctxt', 'translate', 'icon', 'icon_value'],
  popover: ['panel', 'text', 'text_ctxt', 'translate', 'icon', 'icon_value'],
  popover_group: ['space_type', 'region_type', 'context', 'category'],
  label: ['text', 'text_ctxt', 'translate', 'icon', 'icon_value'],
  template_icon: ['icon_value', 'scale'],
  separator: ['factor', 'type'],
};

// Python names Transcrypt renames (type, name and the like become py_*), for the values a script sets on operators.
const pythonName = (key) => (key === 'py_metatype' ? 'type' : key.replace(/^py_/, ''));

export class RegionLayout {
  constructor(kind = 'root', parent = null, settings = {}) {
    Object.assign(this, {
      kind, children: [], active: true, enabled: true, alert: false, alignment: 'EXPAND', scale_x: 1, scale_y: 1,
      use_property_split: parent?.use_property_split ?? false, use_property_decorate: parent?.use_property_decorate ?? true,
      emboss: parent?.emboss ?? 'NORMAL', operator_context: 'INVOKE_REGION_WIN', ...settings,
    });
  }

  #layout(kind, settings) { const child = new RegionLayout(kind, this, settings); this.children.push(child); return child; }
  #item(kind, list) {
    const item = { kind, ...args(list, LAYOUT_ARGS[kind] ?? []), split: this.use_property_split, emboss: this.emboss };
    this.children.push(item);
    return item;
  }

  row(...list) { return this.#layout('row', args(list, ['align', 'heading'])); }
  column(...list) { return this.#layout('column', args(list, ['align', 'heading'])); }
  column_flow(...list) { return this.#layout('column', args(list, ['columns', 'align'])); }
  grid_flow() { return this.#layout('column', {}); }
  box() { return this.#layout('box', {}); }
  split(...list) { return this.#layout('split', args(list, ['factor', 'align'])); }
  prop(...list) { this.#item('prop', list); }
  prop_enum(...list) { this.#item('prop_enum', list); }
  prop_with_popover(...list) { this.#item('prop_with_popover', list); }
  label(...list) { this.#item('label', list); }
  separator(...list) { this.#item('separator', list); }
  separator_spacer() { this.#item('separator_spacer', []); }
  popover(...list) { this.#item('popover', list); }
  popover_group(...list) { this.#item('popover_group', list); }
  menu(...list) { this.#item('menu', list); }
  template_icon(...list) { this.#item('template_icon', list); }
  operator(...list) {
    const props = {};
    this.#item('operator', list).props = props;
    return props;
  }
  context_pointer_set() {}
  emboss_set(emboss) { this.emboss = emboss; }
}

// What drawLayout needs: run(idname, props) runs an operator, supported(idname) whether Bylonder runs it,
// menu(idname) a menu's items, popover(idname, context) a panel's layout, changed(name) after an edit (undo push and
// redraw), context the context the layout was drawn with.
export function drawLayout(root, ui, { horizontal = false } = {}) {
  const el = document.createElement('div');
  el.className = 'bl-rl' + (horizontal ? ' bl-rl-row' : '');
  el.append(...root.children.map((node) => element(node, ui, horizontal, root)));
  return el;
}

const make = (tag, className, text) => Object.assign(document.createElement(tag), { className }, text === undefined ? {} : { textContent: text });

function element(node, ui, horizontal, parent) {
  if (node instanceof RegionLayout) {
    const box = make('div', `bl-rl-${node.kind}${node.align ? ' bl-align' : ''}${node.active === false ? ' bl-inactive' : ''}${node.enabled === false ? ' bl-disabled' : ''}`);
    if (node.kind === 'split' && node.factor) box.style.setProperty('--split', node.factor);
    // Under a heading in a split layout everything is in the right column.
    const unsplit = (n) => { if (n instanceof RegionLayout) n.children.forEach(unsplit); else n.split = false; };
    if (node.heading && node.use_property_split) node.children.forEach(unsplit);
    box.append(...node.children.map((child) => element(child, ui, horizontal || node.kind === 'row', node)));
    if (!node.heading) return box;
    // A heading: with property split in the left column, beside what the layout holds; else before it.
    const headed = make('div', node.use_property_split ? 'bl-split-row' : 'bl-rl-row');
    headed.append(make('span', node.use_property_split ? 'bl-split-label' : 'bl-rl-heading', node.heading), box);
    return headed;
  }
  const build = WIDGETS[node.kind];
  return build ? build(node, ui, parent) : make('span', 'bl-unknown');
}

const icon = (name) => (name && name !== 'NONE' ? iconEl(name) : null);
const button = (className, children, onclick, title = '') => {
  const b = make('button', 'bl-widget ' + className);
  b.type = 'button';
  b.append(...children.filter(Boolean));
  if (title) b.title = title;
  b.onclick = onclick;
  return b;
};
const label = (text) => (text ? make('span', 'bl-widget-text', text) : null);

// A dropdown of choices: [identifier, name, description, icon], the current one shown.
const dropdown = (current, items, choose, { iconOnly = false, text } = {}) => {
  const item = items.find(([id]) => id === current) ?? ['', String(current ?? '')];
  const b = button('bl-dropdown', [icon(item[3]), iconOnly ? null : label(text ?? item[1])], () =>
    openMenu(items.map(([id, name, description, itemIcon]) => (id ? { label: name, icon: itemIcon !== 'NONE' ? itemIcon : undefined, title: description, run: () => choose(id) } : '-')), b), item[2]);
  return b;
};

// Toggled icons: a property's icon for its true state (SNAP_OFF shows SNAP_ON).
const ICON_ON = { SNAP_OFF: 'SNAP_ON', UNLOCKED: 'LOCKED', DECORATE_UNLOCKED: 'DECORATE_LOCKED', PROP_OFF: 'PROP_ON', RESTRICT_VIEW_ON: 'RESTRICT_VIEW_OFF' };

function numberField(get, set, info, text) {
  const unit = info.unit === 'LENGTH' ? 'length' : info.unit === 'ROTATION' ? 'angle' : null;
  const show = (v) => (unit ? format(v, unit) : Number.isInteger(v) && !info.precision ? String(v) : v.toFixed(Math.min(info.precision ?? 3, 3)));
  const field = make('div', 'bl-widget bl-number');
  const name = label(text), value = make('span', 'bl-number-value', show(get()));
  field.append(...[name, value].filter(Boolean));
  field.tabIndex = 0;
  field.title = info.description ?? '';
  const step = (unit === 'angle' ? Math.PI / 180 : 0.01) * ((info.step ?? 1) > 10 ? 1 : (info.step ?? 1));
  field.onpointerdown = (e) => {
    if (e.button) return;
    field.setPointerCapture(e.pointerId);
    const start = e.clientX, from = get();
    let dragged = false;
    field.onpointermove = (ev) => {
      dragged ||= Math.abs(ev.clientX - start) > 3;
      if (dragged) { set(from + (ev.clientX - start) * step * (ev.shiftKey ? 0.1 : 1), false); value.textContent = show(get()); }
    };
    field.onpointerup = () => {
      field.onpointermove = field.onpointerup = null;
      if (dragged) return set(get(), true);
      const input = make('input', 'bl-number-input');
      input.value = unit ? editText(get(), unit) : String(get());
      field.replaceChildren(input);
      input.focus();
      input.select();
      const done = (apply) => { if (apply) { try { set(unit ? parse(input.value, unit) : Number(input.value), true); } catch { /* not a number: unchanged */ } } field.replaceChildren(...[name, value].filter(Boolean)); value.textContent = show(get()); };
      input.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      input.onblur = () => done(true);
    };
  };
  return field;
}

const AXES = 'XYZW';
const WIDGETS = {
  label: (node) => {
    const el = make('span', 'bl-rl-label');
    if (node.icon_value) el.append(Object.assign(make('img', 'bl-icon-image'), { src: toolIconUrl(node.icon_value), alt: '' }));
    el.append(...[icon(node.icon), label(node.text)].filter(Boolean));
    return el;
  },
  separator: () => make('span', 'bl-separator'),
  separator_spacer: () => make('span', 'bl-spacer'),
  template_icon: (node) => Object.assign(make('img', 'bl-template-icon'), { src: toolIconUrl(node.icon_value), alt: '' }),
  operator: (node, ui) => {
    const idname = node.operator, props = () => Object.fromEntries(Object.entries(node.props).map(([k, v]) => [pythonName(k), v]));
    const b = button('bl-operator' + (node.depress ? ' bl-depressed' : ''), [icon(node.icon), label(node.text ?? rnaOperators[idname]?.name ?? idname)],
      () => ui.run(idname, props()), rnaOperators[idname]?.description);
    b.disabled = !ui.supported(idname, props());
    return b;
  },
  menu: (node, ui) => {
    const b = button('bl-menu-button', [icon(node.icon), label(node.text ?? node.menu)], () => openMenu(ui.menu(node.menu), b));
    return b;
  },
  popover: (node, ui) => popoverButton(node.panel, ui, [icon(node.icon), label(node.text ?? ui.panelLabel(node.panel))]),
  popover_group: (node, ui) => {
    const panels = ui.panelsOf(node.context, node.category);
    return panels.length ? popoverButton(panels, ui, [label('Options')], true) : make('span');
  },
  prop_enum: (node, ui) => {
    const info = meta(node.data, node.property), item = info.items?.find(([id]) => id === node.value) ?? [node.value, node.value];
    const on = node.data?.[node.property] === node.value;
    return button('bl-toggle' + (on ? ' bl-depressed' : ''), [icon(node.icon ?? item[3]), label(node.text ?? item[1])], () => {
      node.data[node.property] = node.value;
      ui.changed(info.name);
    }, item[2]);
  },
  prop_with_popover: (node, ui) => {
    const el = make('span', 'bl-prop-popover');
    el.append(WIDGETS.prop(node, ui), popoverButton(node.panel, ui, [], false, 'bl-popover-arrow'));
    return el;
  },
  prop: (node, ui, parent) => {
    const { data, property } = node;
    if (data === null || data === undefined) return make('span');
    const info = meta(data, property), value = data[property], text = node.text ?? info.name;
    const write = (v, done = true) => { data[property] = v; if (done) ui.changed(info.name); };
    // use_property_split: the name in the left column, the widget in the right.
    const splitRow = (name, widget) => {
      const row = make('div', 'bl-split-row');
      row.append(make('span', 'bl-split-label', name ?? ''), widget);
      return row;
    };
    const labeled = (widget) => (node.split ? splitRow(text, widget) : widget);
    if (typeof value === 'boolean') {
      const iconName = node.icon && node.icon !== 'NONE' ? node.icon : info.icon;
      if (node.icon_only || node.toggle || (iconName && !text) || node.emboss === 'NONE_OR_STATUS') {
        return button('bl-toggle' + (value ? ' bl-depressed' : ''), [icon(value ? ICON_ON[iconName] ?? iconName : iconName), node.icon_only ? null : label(text)], () => write(!value), info.description);
      }
      const checkbox = make('label', 'bl-checkbox');
      const box = Object.assign(make('input'), { type: 'checkbox', checked: value });
      box.onchange = () => write(box.checked);
      checkbox.append(...[box, label(text)].filter(Boolean));
      return node.split ? splitRow('', checkbox) : checkbox;
    }
    if (info.items && (typeof value === 'string' || value instanceof Set || Array.isArray(value) && info.flag)) {
      const items = info.items.filter(Boolean);
      if (node.expand) {
        const row = make('span', 'bl-enum-row bl-align');
        row.append(...items.filter(([id]) => id).map(([id, name, description, itemIcon]) => {
          const on = value instanceof Set || Array.isArray(value) ? [...value].includes(id) : value === id;
          return button('bl-toggle' + (on ? ' bl-depressed' : ''), [icon(itemIcon), node.icon_only ? null : label(name)], () => write(id), name + (description ? '\n' + description : ''));
        }));
        return node.split && text ? splitRow(text, row) : row;
      }
      const menu = dropdown(value, items, write, { iconOnly: node.icon_only });
      if (node.split) return splitRow(text, menu);
      if (!text || node.icon_only) return menu;
      // ui_item_with_label: the name, then the menu.
      const row = make('span', 'bl-rl-row');
      row.append(make('span', 'bl-rl-label', text + ':'), menu);
      return row;
    }
    if (typeof value === 'number') {
      const field = numberField(() => data[property], (v, done) => write(Math.max(info.min ?? -Infinity, Math.min(info.max ?? Infinity, v)), done), info, node.split ? '' : text);
      return labeled(field);
    }
    if (Array.isArray(value) || typeof value?.length === 'number' && typeof value !== 'string') {
      const values = [...value], element = (v, i, name) => (typeof v === 'boolean'
        ? button('bl-toggle bl-lock' + (v ? ' bl-depressed' : ''), [icon(v ? ICON_ON[node.icon] ?? node.icon : node.icon)], () => { data[property][i] = !v; ui.changed(info.name); })
        : numberField(() => data[property][i], (nv, done) => { data[property][i] = nv; if (done) ui.changed(info.name); }, info, name));
      const fields = make('div', 'bl-align bl-rl-column');
      // Split: "Location X", "Y", "Z" in the left column; else the name above the fields labeled X, Y, Z.
      if (node.split) fields.append(...values.map((v, i) => splitRow(i ? AXES[i] : `${text} ${AXES[i]}`, element(v, i, ''))));
      else {
        if (text && parent?.kind !== 'row') fields.append(make('span', 'bl-rl-label', text + ':'));
        fields.append(...values.map((v, i) => element(v, i, typeof v === 'boolean' ? '' : AXES[i])));
      }
      return fields;
    }
    if (typeof value === 'string') {
      const field = Object.assign(make('input', 'bl-widget bl-text-field'), { value, title: info.description ?? '' });
      field.onchange = () => write(field.value);
      return labeled(field);
    }
    return labeled(make('span', 'bl-widget bl-pointer', value?.name ?? ''));
  },
};

// A button opening a panel (or panels) drawn in a popup below it (UI_popover_panel).
function popoverButton(panels, ui, children, group = false, className = 'bl-dropdown') {
  const b = button(className, children, () => {
    const host = make('div', 'bl-popover');
    for (const idname of [panels].flat()) {
      if (group) host.append(make('div', 'bl-popover-title', ui.panelLabel(idname)));
      host.append(drawLayout(ui.popover(idname), ui));
    }
    const r = b.getBoundingClientRect();
    Object.assign(host.style, { left: r.left + 'px', top: r.bottom + 2 + 'px' });
    document.body.append(host);
    const close = (e) => { if (!host.contains(e.target)) { host.remove(); removeEventListener('pointerdown', close, true); } };
    addEventListener('pointerdown', close, true);
  });
  return b;
}

// A panel class's layout: its draw (and its header's) over the context, as the region draws it.
export function panelLayout(cls, context) {
  useContext(context);
  const panel = cls(), layout = new RegionLayout();
  panel.layout = layout;
  panel.draw?.(context);
  return layout;
}

