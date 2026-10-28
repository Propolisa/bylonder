// Blender's interface for a recorded layout (layout.js): its layouts as Blender lays them out (interface_layout.cc:
// rows, columns, splits, boxes, grid and column flows, alignment, property split and decorators) and its items as
// Blender's widgets (interface_widgets.cc), bound to RNA (makesrna/rna.js). Panels (panels.js) draw with their headers,
// sub-panels and open state as interface_panel.cc does.
//
// API, for any editor that draws Blender's layouts:
//   h(LayoutView, { layout, ui })           a recorded layout tree (a UILayout, or a C++ panel's tree, modifier-panel.js)
//   h(PanelView, { panel, ui })            a panel drawPanels() drew, with its sub-panels
//   h(RegionView, { panels, ui })          a region's panels, in order
// `ui` is what the widgets need from the editor:
//   { undoPush(name), report(error), run(idname, props), supported(idname, props), poll(idname, props),
//     ids(struct): the data-blocks a pointer of that struct can point to, isOpen(id, closedByDefault), toggle(id, event),
//     animation: { state(refs), insert(refs), remove(refs) }, drawMenu(idname), revision,
//     popover(idname): a panel drawn for a popover, { label, layout, units } (null without one),
//     panelsOf({ space_type, region_type, context, category }): the panels' idnames, for popover_group }
import { defineComponent, h, ref, Teleport, onBeforeUnmount } from 'vue';
import { NumberField } from './components/ui/number-field/index.js';
import { openMenu } from './menu.js';
import { iconUrl, toolIconUrl } from './icon.js';
import { rnaProperty, INFO } from '../../makesrna/rna.js';
import { operatorValues, isLayout } from './layout.js';
import { formatLength, formatAngle, parse as parseUnit, editText as unitText } from '../../blenkernel/unit.js';
import operators from '../../makesrna/rna-operators.json' with { type: 'json' };
import themes from './icon-themes.json' with { type: 'json' };

// An icon in its theme color, as Blender draws its monochrome icons.
export const icon = (name, className = '') => (name && name !== 'NONE'
  ? h('span', { class: ['bl-icon', themes[name] && 'bl-icon-' + themes[name], className], style: { maskImage: `url(${iconUrl(name.toLowerCase())})` }, 'aria-hidden': 'true' }) : null);

// ---- Values as Blender shows and parses them (ui_but_string_get, ui_but_string_eval_number).
const SUFFIX = { CAMERA: ' mm', POWER: ' W', COLOR_TEMPERATURE: ' K', MASS: ' kg', TIME_ABSOLUTE: ' s', VELOCITY: ' m/s', ACCELERATION: ' m/s²', TEMPERATURE: ' K',
  WAVELENGTH: ' nm', FREQUENCY: ' Hz', AREA: ' m²', VOLUME: ' m³' };
const trimmed = (value, precision = 3) => String(Number(value.toFixed(Math.min(6, precision))));
export function displayValue(meta, value) {
  if (meta.type === 'I') return meta.subtype === 'PERCENTAGE' ? `${value}%` : String(value);
  if (meta.unit === 'LENGTH') return formatLength(value);
  if (meta.unit === 'ROTATION') return formatAngle(value);
  if (SUFFIX[meta.unit]) return trimmed(value, meta.precision) + SUFFIX[meta.unit];
  if (meta.subtype === 'PERCENTAGE') return trimmed(value, 0) + '%';
  return value.toFixed(Math.min(6, meta.precision ?? 3));
}
const unitOf = (meta) => (meta.unit === 'LENGTH' ? 'length' : meta.unit === 'ROTATION' ? 'angle' : null);
const parseValue = (meta) => (text) => parseUnit(String(text).replace(/\s*(mm|W|kg|s|K|nm|Hz|%)\s*$/, ''), unitOf(meta));
const editValue = (meta) => (value) => (unitOf(meta) ? unitText(value, unitOf(meta)) : meta.type === 'I' ? String(value) : String(Number(value.toFixed(6))));

// RNA_property_array_item_char: the letter of an array element.
function itemChar(meta, i) {
  if (['QUATERNION', 'AXISANGLE'].includes(meta.subtype)) return 'WXYZ'[i];
  if (['COLOR', 'COLOR_GAMMA'].includes(meta.subtype)) return 'RGBA'[i];
  if (['TRANSLATION', 'DIRECTION', 'XYZ', 'XYZ_LENGTH', 'EULER', 'VELOCITY', 'ACCELERATION', 'COORDINATES'].includes(meta.subtype)) return 'XYZW'[i];
  return '';
}

// ---- Widgets. A widget's class carries its Blender widget type; aligned layouts square the corners where widgets meet.
const W = 'bl-widget';
// A tool's icon, which bpy.app.icons names (icon_value), as an image.
const toolIcon = (name) => (typeof name === 'string' ? h('img', { class: 'bl-tool-icon', src: toolIconUrl(name), alt: '' }) : null);
const label = (text, { iconName, iconValue, className = '', align = 'left' } = {}) => h('div', {
  class: ['bl-label flex h-unit min-w-0 items-center gap-1 text-xs', align === 'right' ? 'justify-end text-right' : '', !text && iconName && 'bl-icon-only', className],
}, [toolIcon(iconValue), icon(iconName), text ? h('span', { class: 'truncate' }, text) : null]);

function button({ text, iconName, kind = 'tool', pressed = false, disabled = false, inactive = false, onClick, title, className = '', iconOnly = false, emboss = true }) {
  return h('button', {
    type: 'button', title, disabled, 'aria-pressed': pressed, 'aria-label': text || title,
    class: [W, `bl-${kind} flex h-unit min-w-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs`, emboss ? '' : 'bl-flat',
      pressed && 'is-pressed', inactive && 'opacity-50', iconOnly && 'bl-icon-only px-0', className],
    onClick,
  }, [icon(iconName), text && !iconOnly ? h('span', { class: 'truncate' }, text) : null]);
}

const checkbox = ({ checked, text, disabled, inactive, onChange, title }) => h('label', {
  class: ['bl-option flex h-unit min-w-0 items-center gap-1.5 text-xs', inactive && 'opacity-50', disabled && 'pointer-events-none'], title,
}, [
  h('input', { type: 'checkbox', class: [W, 'bl-check'], checked, disabled, 'aria-label': text || title, onChange: (e) => onChange(e.target.checked) }),
  text ? h('span', { class: 'truncate' }, text) : null,
]);

function textField({ value, iconName, disabled, inactive, onChange, title, placeholder }) {
  return h('label', { class: [W, 'bl-text flex h-unit min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-xs', inactive && 'opacity-50'], title }, [
    icon(iconName),
    h('input', { class: 'min-w-0 flex-1 bg-transparent outline-none', value, disabled, placeholder, 'aria-label': title,
      onChange: (e) => onChange(e.target.value), onKeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); } }),
  ]);
}

const menuButton = ({ text, iconName, items, disabled, inactive, title, iconOnly, onClick = (e) => openMenu(items, e.currentTarget) }) => h('button', {
  type: 'button', title, disabled, 'aria-label': text || title, 'aria-haspopup': 'menu',
  class: [W, 'bl-menu-button flex h-unit min-w-0 flex-1 items-center gap-1 rounded-md pl-1.5 pr-5 text-xs', inactive && 'opacity-50', iconOnly && 'pr-4'],
  onClick,
}, [icon(iconName), text && !iconOnly ? h('span', { class: 'min-w-0 flex-1 truncate text-left' }, text) : null]);

// A popover (UI_popover_panel): a menu button that opens its panels below it, each drawn as in a region, under its
// label when there are several; a press outside closes it.
const Popover = defineComponent({
  name: 'Popover',
  props: { panels: Array, text: String, iconName: String, iconOnly: Boolean, disabled: Boolean, env: Object },
  setup(props) {
    const at = ref(null);
    let owner = null;
    const outside = (e) => { if (!e.target.closest?.('.bl-popover-block,.bl-menu') && !owner?.contains(e.target)) hide(); };
    const hide = () => { at.value = null; removeEventListener('pointerdown', outside, true); };
    const toggle = (e) => {
      if (at.value) return hide();
      owner = e.currentTarget;
      const r = owner.getBoundingClientRect();
      at.value = { left: `${r.left}px`, top: `${r.bottom + 2}px` };
      addEventListener('pointerdown', outside, true);
    };
    onBeforeUnmount(hide);
    return () => {
      const { ui } = props.env, drawn = props.panels.map((id) => ui.popover?.(id)).filter(Boolean);
      return [
        menuButton({ text: props.text ?? drawn[0]?.label, iconName: props.iconName, iconOnly: props.iconOnly, disabled: props.disabled, onClick: toggle }),
        at.value && drawn.length ? h(Teleport, { to: 'body' }, h('div', {
          class: 'bl-ui bl-popover-block flex flex-col', style: { ...at.value, width: `calc(var(--bl-row) * ${Math.max(...drawn.map((p) => p.units || 10))})` },
        }, drawn.flatMap((p) => [drawn.length > 1 ? label(p.label, { className: 'bl-popover-title' }) : null, layout(p.layout, rootEnv(ui))]))) : null,
      ];
    };
  },
});
const popover = (panels, node, env, iconOnly = !node.text && !!node.icon) => h(Popover, {
  panels, text: node.text, iconName: node.icon, iconOnly, disabled: !env.enabled, env,
});

function colorSwatch({ value, disabled, inactive, onChange, title }) {
  const hex = '#' + [...value].slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, c)) ** (1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
  return h('label', { class: [W, 'bl-color relative flex h-unit min-w-0 flex-1 overflow-hidden rounded-md', inactive && 'opacity-50'], title, style: { background: hex } }, [
    h('input', { type: 'color', class: 'absolute inset-0 size-full cursor-pointer opacity-0', value: hex, disabled, 'aria-label': title,
      onInput: (e) => onChange(e.target.value.slice(1).match(/../g).map((c) => (parseInt(c, 16) / 255) ** 2.2).concat(value.length > 3 ? [value[3]] : []), false),
      onChange: (e) => onChange(e.target.value.slice(1).match(/../g).map((c) => (parseInt(c, 16) / 255) ** 2.2).concat(value.length > 3 ? [value[3]] : []), true) }),
  ]);
}

// ---- Properties.
// A property of RNA data as its layout.prop() call asks: { meta, get, set(value, finish), items, bound, channel }.
function resolve(node, ui) {
  const data = node.data, info = data?.[INFO], meta = info && rnaProperty(info.struct, node.property);
  if (!meta) return null;
  const set = (value, finish = true) => {
    try {
      data[node.property] = value;
      if (finish) ui.undoPush(meta.name);
    } catch (error) {
      ui.report(error);
    }
  };
  const items = () => (info.items[node.property]?.() ?? meta.items ?? []);
  return { meta, data, get: () => data[node.property], set, items, bound: info.bound.has(node.property), channel: info.channels?.[node.property] };
}

const enumItem = (items, value) => items.find((item) => item?.[0] === value);

function enumMenu(prop, title) {
  return () => [{ heading: title }, ...prop.items().map((item) => (item === null ? '-'
    : { label: item[1], icon: item[3] !== 'NONE' ? item[3] : undefined, title: item[2], checked: () => prop.get() === item[0], run: () => prop.set(item[0]) }))];
}

// Booleans whose RNA icons are consecutive (PROP_ICONS_CONSECUTIVE): the icon after the property's while true.
const ICON_ON = { SNAP_OFF: 'SNAP_ON', PROP_OFF: 'PROP_ON', UNLOCKED: 'LOCKED', DECORATE_UNLOCKED: 'DECORATE_LOCKED', RESTRICT_VIEW_ON: 'RESTRICT_VIEW_OFF',
  RESTRICT_SELECT_ON: 'RESTRICT_SELECT_OFF', HIDE_ON: 'HIDE_OFF', CHECKBOX_DEHLT: 'CHECKBOX_HLT', AUTOMERGE_OFF: 'AUTOMERGE_ON' };

// The widget for one value (an array's element when index >= 0), without its label column.
function widget(prop, node, { text, index = -1, disabled, inactive, ui }) {
  const { meta } = prop, value = prop.get();
  const element = index >= 0 ? value[index] : value;
  const setElement = (v, finish) => {
    if (index < 0) return prop.set(v, finish);
    const next = [...prop.get()];
    next[index] = v;
    prop.set(next, finish);
  };
  const iconName = [node.icon, meta.type === 'B' ? meta.icon : null].find((name) => name && name !== 'NONE') ?? null;
  switch (meta.type) {
    case 'B': {
      const checked = node.invert_checkbox ? !element : !!element;
      if (node.toggle || node.icon_only || node.emboss === false || (iconName && !text)) {
        const shown = checked ? ICON_ON[iconName] ?? iconName : iconName;
        return button({ text: node.icon_only ? '' : text, iconName: shown, kind: 'toggle', pressed: checked, disabled, inactive, iconOnly: !text, emboss: node.emboss !== false,
          title: meta.description || meta.name, onClick: () => setElement(node.invert_checkbox ? checked : !checked) });
      }
      return checkbox({ checked, text, disabled, inactive, title: meta.description, onChange: (v) => setElement(node.invert_checkbox ? !v : v) });
    }
    case 'I': case 'F':
      if (index < 0 && meta.array && ['COLOR', 'COLOR_GAMMA'].includes(meta.subtype)) {
        return colorSwatch({ value: value ?? [], disabled, inactive, title: meta.description || meta.name, onChange: (v, finish) => prop.set(v, finish) });
      }
      return h(NumberField, {
        modelValue: element ?? 0, label: text ?? '', meta, disabled, inactive, class: W,
        slider: !!node.slider || ['FACTOR', 'PERCENTAGE'].includes(meta.subtype),
        display: (v) => displayValue(meta, v), editText: editValue(meta), parse: parseValue(meta),
        'onUpdate:modelValue': (v) => setElement(v, false), onCommit: () => ui.undoPush(meta.name),
      });
    case 'E': {
      const current = enumItem(prop.items(), value);
      return menuButton({ text: current?.[1] ?? '', iconName: iconName ?? (current?.[3] !== 'NONE' ? current?.[3] : null), items: enumMenu(prop, meta.name),
        disabled, inactive, title: meta.description, iconOnly: node.icon_only });
    }
    case 'S':
      return textField({ value: value ?? '', iconName, disabled, inactive, title: meta.description || meta.name, placeholder: node.placeholder,
        onChange: (v) => prop.set(v) });
    case 'P': {
      const candidates = () => [{ heading: meta.name }, ...ui.ids(meta.struct).map((id) => ({ label: id.name, checked: () => prop.get() === id, run: () => prop.set(id) }))];
      return menuButton({ text: value?.name ?? '', iconName: iconName ?? ui.structIcon?.(value), items: candidates, disabled, inactive, title: meta.description });
    }
    default:
      return null;
  }
}

// An expanded enum: aligned toggles (radio buttons), or icons, in the direction of the layout they are in
// (ui_item_local_sublayout); a flag enum toggles each.
function expanded(prop, node, { disabled, inactive, vertical }) {
  const value = prop.get(), flag = prop.meta.flag;
  return h('div', { class: vertical ? 'bl-align-col flex min-w-0 flex-1 flex-col' : 'bl-align-row flex min-w-0 flex-1' }, prop.items().filter(Boolean).map(([id, name, description, iconName]) => {
    const on = flag ? [...(value ?? [])].includes(id) : value === id;
    return button({ text: node.icon_only ? '' : name, iconName: iconName !== 'NONE' ? iconName : null, kind: 'radio', pressed: on, disabled, inactive,
      title: description || name, iconOnly: node.icon_only, className: ['flex-1 gap-0.5 px-0.5', vertical && 'justify-start!'],
      onClick: () => prop.set(flag ? (on ? [...value].filter((v) => v !== id) : [...(value ?? []), id]) : id) });
  }));
}

// The decorator of a property (layout.prop's decorator column): its animation state, inserting or removing a keyframe.
function decorator(prop, index, ui) {
  const refs = prop?.channel ? (index >= 0 ? [prop.channel(index)] : Array.from({ length: prop.meta.array || 1 }, (_, i) => prop.channel(i))) : [];
  const state = refs.length ? ui.animation?.state(refs) ?? 'none' : 'none';
  const iconName = { keyed: 'DECORATE_KEYFRAME', animated: 'DECORATE_ANIMATE', changed: 'DECORATE_OVERRIDE' }[state] ?? 'DECORATE';
  return h('button', {
    type: 'button', class: ['bl-decorator flex h-unit w-unit shrink-0 items-center justify-center', state !== 'none' && 'is-' + state],
    'aria-label': `${state === 'keyed' ? 'Delete' : 'Insert'} Keyframe`, disabled: !refs.length,
    onClick: () => (state === 'keyed' ? ui.animation.remove(refs) : ui.animation.insert(refs)),
  }, icon(iconName));
}

// layout.prop as uiItemFullR lays it out: with use_property_split, a split of a label column (0.4 of the row) and the
// value, then the decorator column when use_property_decorate. A checkbox keeps its name and takes the layout's heading
// as its label; an empty name has no label column; an array is a column of its elements, labelled "Name X", "Y", "Z".
function propItem(node, env) {
  const { ui } = env, prop = resolve(node, ui);
  if (!node.data) return null;
  if (!prop) return label(`property not found: ${node.data?.[INFO]?.struct ?? '?'}.${node.property}`, { className: 'text-[#ff8080]' });
  const { meta } = prop;
  const disabled = !env.enabled || !!meta.readonly, inactive = !env.active || !prop.bound;
  // A property's own icon (RNA_property_ui_icon) where the call gives none.
  const name = node.text ?? meta.name, index = node.index ?? -1, iconName = [node.icon, meta.icon].find((name) => name && name !== 'NONE') ?? null;
  const options = { disabled, inactive, ui };
  const isArray = meta.array && index < 0 && meta.type !== 'E' && !(['COLOR', 'COLOR_GAMMA'].includes(meta.subtype) && meta.type === 'F');
  const useSplit = node.split && !env.noSplit;
  // UI_PROP_SEP_ICON_WIDTH_EXCEPTION: a checkbox keeps its name, in the value column.
  const isCheck = meta.type === 'B' && !iconName && !node.icon_only && !node.toggle;
  const splitLabel = useSplit && !isCheck, splitEmptyName = isCheck || node.split_empty_name;
  const heading = () => { const text = env.heading?.text ?? ''; if (env.heading) env.heading.text = ''; return text; };
  const elementText = (i, chars) => (isCheck ? chars[i] : '');

  let value;
  if (meta.type === 'E' && node.expand) value = expanded(prop, node, { ...options, vertical: !useSplit && !env.horizontal });
  else if (isArray) {
    const chars = Array.from({ length: meta.array }, (_, i) => itemChar(meta, i)), iconOnly = meta.type === 'B' && !isCheck;
    value = h('div', { class: [node.expand ? 'bl-align-row flex' : 'bl-align-col flex flex-col', iconOnly ? 'bl-icon-only' : 'min-w-0 flex-1'] },
      chars.map((char, i) => widget(prop, node, { ...options, index: i, text: useSplit ? elementText(i, chars) : (name && char ? char : '') })));
    // ui_item_array: without the split, the name (with a colon, ui_item_name_add_colon) above the elements.
    if (!useSplit && name && !iconOnly) value = h('div', { class: 'flex min-w-0 flex-1 flex-col' }, [label(name + ':'), value]);
  } else value = widget(prop, node, { ...options, text: useSplit && splitLabel ? '' : meta.type === 'E' || meta.type === 'S' || meta.type === 'P' ? '' : name });

  if (!useSplit || (name === '' && !splitEmptyName)) {
    if (!useSplit && meta.type === 'E' && !node.expand && name && !node.icon_only) return h('div', { class: 'flex min-w-0 flex-1 gap-[var(--bl-row-gap)]' }, [label(name), value]);
    if (!useSplit && (meta.type === 'S' || meta.type === 'P') && name) return h('div', { class: 'flex min-w-0 flex-1 gap-[var(--bl-row-gap)]' }, [label(name), value]);
    return value;
  }
  let left;
  if (splitLabel && isArray) {
    const chars = Array.from({ length: meta.array }, (_, i) => itemChar(meta, i));
    left = h('div', { class: 'flex flex-col' }, chars.map((char, i) => label(i === 0 ? `${name} ${char}`.trim() : char, { align: 'right', className: 'bl-split-label' })));
  } else left = label(splitLabel ? name : heading(), { align: 'right', className: 'bl-split-label' });
  const decorators = node.decorate
    ? (isArray ? h('div', { class: 'flex flex-col' }, Array.from({ length: meta.array }, (_, i) => decorator(prop, i, ui))) : decorator(prop, index, ui)) : null;
  return splitRow(left, value, decorators);
}

// The split of a property's label and value; items added after it to the same row go into its value part, as
// item_prop_split_layout_hack does (a transform's lock beside its value), not split again.
function splitRow(left, right, deco) {
  const value = [right];
  const vnode = h('div', { class: 'bl-prop-split flex min-w-0 flex-1' }, [
    h('div', { class: 'flex min-w-0 flex-1' }, [h('div', { class: 'bl-split-left shrink-0' }, left), h('div', { class: 'bl-split-value bl-align-row flex min-w-0 flex-1' }, value)]),
    deco,
  ]);
  vnode.valueSlot = value;
  return vnode;
}

function propEnum(node, env) {
  const prop = resolve(node, env.ui);
  if (!prop) return null;
  const item = enumItem(prop.items(), node.value);
  return button({ text: node.text ?? item?.[1] ?? node.value, iconName: node.icon ?? item?.[3], kind: 'radio', pressed: prop.get() === node.value,
    disabled: !env.enabled, inactive: !env.active || !prop.bound, onClick: () => prop.set(node.value), className: 'flex-1' });
}

// The Properties editor's tabs (prop_tabs_enum): icons in a column, gaps between groups.
function tabs(node, env) {
  const prop = resolve(node, env.ui);
  if (!prop) return null;
  return h('nav', { class: 'bl-tabs flex flex-col', role: 'tablist' }, prop.items().map((item, i) => (item === null
    ? h('div', { key: 'gap' + i, class: 'bl-tab-gap' })
    : h('button', { key: item[0], type: 'button', role: 'tab', class: 'bl-tab', 'aria-selected': prop.get() === item[0], 'aria-label': item[1], title: `${item[1]}\n${item[2]}`,
      onClick: () => prop.set(item[0], false) }, icon(item[3])))));
}

function operatorButton(node, env) {
  const { ui } = env, values = operatorValues(node.props ?? {}), idname = node.operator;
  const runs = ui.supported(idname, values), text = node.text ?? operators[idname]?.name ?? idname;
  return button({ text, iconName: node.icon, kind: 'tool', disabled: !env.enabled || !runs || !ui.poll(idname, values), inactive: !env.active,
    title: operators[idname]?.description ?? text, emboss: node.emboss !== false, pressed: !!node.depress, iconOnly: !text, className: 'flex-1',
    onClick: (event) => ui.run(idname, operatorValues(node.props ?? {}), event) });
}

// ---- Templates.
const NO_FAKE_USER = new Set(['Object', 'Scene', 'Collection', 'WorkSpace', 'Screen']);
// template_ID: the data-block's browse menu, its name, and New or unlink.
function templateID(node, env) {
  const { ui } = env, prop = resolve(node, ui);
  if (!prop) return null;
  const id = prop.get(), struct = prop.meta.struct, iconName = ui.structIcon?.(id) ?? 'DOT';
  const browse = () => [{ heading: `Browse ${prop.meta.name}` }, ...ui.ids(struct).map((other) => ({ label: other.name, checked: () => prop.get() === other, run: () => prop.set(other) }))];
  return h('div', { class: 'bl-align-row flex min-w-0 flex-1' }, [
    h('button', { type: 'button', class: [W, 'bl-menu-button bl-browse flex h-unit w-[calc(var(--bl-row)*1.6)] shrink-0 items-center rounded-md pl-1'],
      title: `Browse ${prop.meta.name}`, 'aria-label': `Browse ${prop.meta.name}`, disabled: !env.enabled, onClick: (e) => openMenu(browse, e.currentTarget) }, icon(iconName)),
    id
      ? textField({ value: id.name, disabled: !env.enabled, title: `${prop.meta.name} name`, onChange: (name) => { id.name = name; ui.undoPush('Rename'); } })
      : node.new ? button({ text: 'New', iconName: 'ADD', kind: 'tool', className: 'flex-1', disabled: !ui.supported(node.new, {}), onClick: () => ui.run(node.new, {}) }) : null,
    // Data-blocks other than objects, scenes, collections and workspaces can keep a fake user (template_id_cb).
    id && !NO_FAKE_USER.has(struct) ? propItem({ kind: 'prop', data: id, property: 'use_fake_user', text: '', icon: 'FAKE_USER_OFF', toggle: true }, env) : null,
    id && node.unlink && node.data[INFO].bound.has(node.property)
      ? button({ iconName: 'X', kind: 'tool', title: 'Unlink', onClick: () => prop.set(null) }) : null,
  ]);
}

// template_list: the rows of a collection, the active one highlighted; the buttons beside it are the script's own.
function templateList(node, env) {
  const items = [...(node.dataptr?.[node.propname] ?? [])], active = node.active_dataptr?.[node.active_propname];
  const rows = Math.max(node.rows || 5, items.length > 5 ? Math.min(items.length, node.maxrows || 5) : 1);
  return h('div', { class: 'bl-list flex min-w-0 flex-1 flex-col rounded-md', role: 'listbox', style: { minHeight: `calc(var(--bl-row) * ${rows} + 8px)` } },
    items.map((item, i) => h('button', { type: 'button', role: 'option', 'aria-selected': i === active, class: ['bl-list-item flex h-unit items-center gap-1 px-1 text-xs', i === active && 'is-active'],
      onClick: () => { try { node.active_dataptr[node.active_propname] = i; env.ui.undoPush('Select'); } catch (error) { env.ui.report(error); } } },
    [icon(env.ui.structIcon?.(item)), h('span', { class: 'truncate' }, item.name ?? '')])));
}

// template_node_view: a node tree's inputs from a socket: the linked node's name, then its inputs, unlinked ones as values.
function templateNodeView(node, env) {
  const rows = [], visit = (socket, depth) => {
    const linked = socket.links?.[0]?.from_node;
    if (linked) {
      rows.push(splitRow(label(socket.name, { align: 'right', className: 'bl-split-label' }), button({ text: linked.name, kind: 'popover', className: 'bl-node-link flex-1', disabled: true }), null));
      for (const input of linked.inputs) visit(input, depth + 1);
    } else if ('default_value' in socket && socket[INFO].bound.has('default_value')) {
      rows.push(h('div', { class: 'bl-node-input', style: { paddingLeft: `calc(var(--bl-row) * ${Math.max(0, depth - 1) * 0.5})` } },
        propItem({ kind: 'prop', data: socket, property: 'default_value', text: socket.name, split: true, decorate: false }, env)));
    } else if (depth === 0) {
      rows.push(splitRow(label(socket.name, { align: 'right', className: 'bl-split-label' }), button({ text: 'None', kind: 'popover', className: 'flex-1', disabled: true }), null));
    }
  };
  visit(node.socket, 0);
  return h('div', { class: 'flex flex-col gap-[var(--bl-button-gap)]' }, rows);
}

// template_image_settings: an image format's file format, color and quality.
function templateImageSettings(node, env) {
  const [settings] = node.args ?? [], prop = (property, extra = {}) => ({ kind: 'prop', data: settings, property, split: true, decorate: false, ...extra });
  const quality = ['JPEG', 'WEBP'].includes(settings?.file_format) ? [prop('quality', { slider: true })] : [];
  return settings ? layout({ kind: 'column', children: [prop('file_format'), prop('color_mode', { expand: true }), ...quality] }, env) : null;
}

const TEMPLATES = { template_icon: (node) => toolIcon(node.icon_value), template_image_settings: templateImageSettings, template_ID: templateID, template_list: templateList, template_node_view: templateNodeView,
  template_ID_preview: templateID, template_search: templateID };

// ---- Layouts.
const EMBOSS_NONE = new Set(['NONE', 'NONE_OR_STATUS']);
function item(node, env) {
  switch (node.kind) {
    case 'prop': return propItem(node, env);
    case 'prop_enum': return propEnum(node, env);
    case 'prop_tabs_enum': return tabs(node, env);
    case 'prop_search': return propItem({ ...node, kind: 'prop' }, env);
    case 'prop_menu_enum': {
      const prop = resolve(node, env.ui);
      return prop && menuButton({ text: node.text ?? prop.meta.name, iconName: node.icon, items: enumMenu(prop, prop.meta.name), disabled: !env.enabled });
    }
    case 'prop_decorator': return decorator(resolve(node, env.ui), node.index ?? -1, env.ui);
    case 'operator': return operatorButton(node, env);
    case 'operator_menu_enum': case 'menu': case 'prop_with_menu': {
      const items = node.kind === 'menu' ? () => env.ui.drawMenu?.(node.menu) ?? [] : () => [];
      return menuButton({ text: node.text ?? (node.kind === 'menu' ? env.ui.menuLabel?.(node.menu) : null) ?? '', iconName: node.icon, items, disabled: !env.enabled });
    }
    case 'popover': return popover([node.panel], node, env);
    // A menu's entries in place (a header's editor menus, Menu.draw_collapsible), drawn as the layout it makes.
    case 'menu_contents': {
      const contents = env.ui.menuContents?.(node.menu);
      return contents ? layout(contents, env) : null;
    }
    // An enum's menu button that opens the panel (uiItemPopoverPanel over the property's current item).
    case 'prop_with_popover': {
      const prop = resolve(node, env.ui), current = prop && enumItem(prop.items(), prop.get());
      return prop && popover([node.panel], { text: node.icon_only ? '' : current?.[1], icon: node.icon ?? current?.[3] }, env, !!node.icon_only);
    }
    // uiItemPopoverPanelFromGroup: a popover for each panel of the region, context and category.
    case 'popover_group': return h('div', { class: 'bl-row flex items-center gap-[var(--bl-row-gap)]' }, (env.ui.panelsOf?.(node) ?? []).map((id) => popover([id], {}, env)));
    case 'label': return label(node.text ?? '', { iconName: node.icon, iconValue: node.icon_value, className: !env.active ? 'opacity-50' : '' });
    case 'separator': return h('div', { class: 'bl-separator shrink-0', style: { '--factor': node.factor ?? 1 }, 'data-type': node.type ?? 'AUTO' });
    case 'separator_spacer': return h('div', { class: 'flex-1' });
    case 'template': return (TEMPLATES[node.name] ?? env.ui.templates?.[node.name])?.(node, env) ?? null;
    default: return null;
  }
}

function layoutClass(node) {
  const align = node.align ? (node.kind === 'row' ? 'bl-align-row' : 'bl-align-col') : '';
  const justify = { LEFT: 'justify-start', RIGHT: 'justify-end', CENTER: 'justify-center' }[node.alignment] ?? '';
  switch (node.kind) {
    case 'row': return ['bl-row flex min-w-0 items-center', node.align ? '' : 'gap-[var(--bl-row-gap)]', align, justify, node.alignment !== 'EXPAND' && node.alignment && 'bl-fit'];
    case 'split': return ['bl-split flex min-w-0', node.align ? 'bl-align-row' : 'gap-[var(--bl-row-gap)]'];
    case 'box': return ['bl-box flex flex-col gap-[var(--bl-button-gap)] rounded-md p-1.5'];
    case 'grid_flow': case 'column_flow': return ['bl-grid grid min-w-0 gap-x-[var(--bl-row-gap)] gap-y-[var(--bl-button-gap)]', align];
    case 'root': return ['bl-col bl-root flex min-w-0 flex-col', align];
    default: return ['bl-col flex min-w-0 flex-col', node.align ? '' : 'gap-[var(--bl-button-gap)]', align];
  }
}

// A layout's children: with its heading for the first property, its active and enabled state for all it holds.
function layout(node, env) {
  const inner = { ...env, horizontal: node.kind === 'row' || node.kind === 'split', active: env.active && node.active !== false, enabled: env.enabled && node.enabled !== false,
    heading: node.heading ? { text: node.heading } : env.heading };
  if (node.kind === 'panel') return layoutPanel(node, inner);
  const children = [];
  let slot = null;
  for (const child of node.children) {
    const env = slot ? { ...inner, noSplit: true } : inner;
    const drawn = isLayout(child) ? layout(child, env) : item(child, env);
    if (!drawn) continue;
    (slot ?? children).push(drawn);
    if (node.kind === 'row' && drawn.valueSlot) slot = drawn.valueSlot;
  }
  if (node.heading && inner.heading.text && !node.use_property_split) children.unshift(label(inner.heading.text));
  const style = {};
  if (node.kind === 'split') {
    const first = node.factor || 1 / Math.max(1, children.length);
    children.forEach((child, i) => { child.props = { ...child.props, style: { flex: `0 0 calc(${(i === 0 ? first : (1 - first) / Math.max(1, children.length - 1)) * 100}% - var(--bl-row-gap))` } }; });
  }
  if (node.kind === 'grid_flow' || node.kind === 'column_flow') style.gridTemplateColumns = node.columns > 0 ? `repeat(${node.columns}, minmax(0, 1fr))` : 'repeat(auto-fill, minmax(calc(var(--bl-row) * 7), 1fr))';
  if (node.ui_units_x) style.width = `calc(var(--bl-row) * ${node.ui_units_x})`;
  // A layout of icon buttons only keeps their size in a row, as their estimated widths would.
  const fit = children.length && children.every((child) => JSON.stringify(child.props?.class ?? '').includes('bl-icon-only'));
  return h('div', { class: [layoutClass(node), EMBOSS_NONE.has(node.emboss) && 'bl-emboss-none', node.alert && 'bl-alert', fit && 'bl-fit bl-icon-only-group'], style }, children);
}

// A layout panel (UILayout.panel): a header with a disclosure triangle, then the body when open.
function layoutPanel(node, env) {
  const [header, body] = node.children, id = node.idname, open = env.ui.isOpen(`layout:${id}`, node.default_closed);
  return h('div', { class: 'bl-layout-panel flex flex-col' }, [
    h('div', { class: 'bl-subpanel-header flex h-unit items-center gap-1', onClick: (e) => { if (!e.target.closest('input,button')) env.ui.toggle(`layout:${id}`, e, node.default_closed); } },
      [icon(open ? 'DOWNARROW_HLT' : 'RIGHTARROW', 'bl-disclosure'), layout(header, env)]),
    open && body.children.length ? h('div', { class: 'bl-panel-body' }, layout(body, env)) : null,
  ]);
}

const rootEnv = (ui) => ({ ui, active: true, enabled: true, heading: null });

export const LayoutView = defineComponent({
  name: 'LayoutView',
  props: { layout: Object, ui: Object },
  setup: (props) => () => layout(props.layout, rootEnv(props.ui)),
});

// A panel as interface_panel.cc draws it: a header (disclosure triangle, draw_header's layout, label, the preset
// layout and the drag grip) over its body and sub-panels; a panel without a header draws its body alone.
function panel(drawn, ui, sub = false) {
  const env = rootEnv(ui);
  if (drawn.hideHeader) return h('div', { key: drawn.id, class: 'bl-panel-plain', 'data-blender': drawn.id }, drawn.body ? layout(drawn.body, env) : null);
  const toggle = (e) => { if (!e.target.closest('input,button,[role=spinbutton]')) ui.toggle(drawn.id, e, drawn.closedByDefault); };
  return h('section', { key: drawn.id, class: ['bl-panel', sub ? 'bl-subpanel' : 'bl-panel-root', drawn.open && 'is-open'], 'data-blender': drawn.id }, [
    h('header', { class: 'bl-panel-header flex items-center', onClick: toggle }, [
      icon(drawn.open ? 'DOWNARROW_HLT' : 'RIGHTARROW', 'bl-disclosure'),
      drawn.header ? h('div', { class: 'bl-panel-header-layout flex items-center' }, layout(drawn.header, env)) : null,
      drawn.label ? h('span', { class: 'bl-panel-label truncate' }, drawn.label) : null,
      h('div', { class: 'flex-1' }),
      drawn.preset ? h('div', { class: 'flex items-center' }, layout(drawn.preset, env)) : null,
      sub ? null : icon('GRIP', 'bl-grip'),
    ]),
    drawn.open ? h('div', { class: 'bl-panel-body' }, [
      drawn.body ? layout(drawn.body, env) : null,
      drawn.error ? label(String(drawn.error.message), { className: 'text-[#ff8080]' }) : null,
      ...drawn.children.map((child) => panel(child, ui, true)),
    ]) : null,
  ]);
}

export const PanelView = defineComponent({
  name: 'PanelView',
  props: { panel: Object, ui: Object },
  setup: (props) => () => panel(props.panel, props.ui),
});

export const RegionView = defineComponent({
  name: 'RegionView',
  props: { panels: Array, ui: Object },
  // The default slot: an editor's own panels after these, as add-ons' panels go after Blender's.
  setup: (props, { slots }) => () => h('div', { class: 'bl-ui bl-region-panels flex flex-col' }, [...props.panels.map((p) => panel(p, props.ui)), slots.default?.()]),
});

// Blender's panel state, kept by the editor in `state.open` (id: open, where it differs from the panel's default): a
// click toggles a panel; Ctrl click opens it and closes the region's others (ui_handle_panel_header). `ids()` gives the
// region's panels as [id, closed by default].
export function panelState(state, ids = () => []) {
  const isOpen = (id, closedByDefault = false) => state.open[id] ?? !closedByDefault;
  return {
    isOpen,
    toggle(id, event, closedByDefault = false) {
      if (event?.ctrlKey) state.open = Object.fromEntries(ids().map(([other]) => [other, other === id]));
      else state.open = { ...state.open, [id]: !isOpen(id, closedByDefault) };
    },
  };
}
