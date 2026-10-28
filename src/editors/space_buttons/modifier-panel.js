// The modifier stack (uiTemplateModifiers and modifier_panel_header in MOD_ui_common.cc): one panel per modifier, its
// header Blender's (icon, name, display toggles, extra operations, remove) and its body the layout the modifier's own
// panel_draw records in the module (tools/blender-port/wasm/panel-layout.cc), read as a layout tree and drawn by the
// shared renderer like Blender's Python panels. Bylonder's own modifiers (Array (Nodes), Geometry Nodes) draw their
// inputs as Bylonder's add-on rows.
import { h } from 'vue';
import { LayoutView, icon } from '../interface/layout-view.js';
import { UILayout } from '../interface/layout.js';
import { modifierPanel } from '../../modifiers/blender.js';
import { modifierStack } from '../../modifiers/stack.js';
import { hasMesh } from '../object/identity.js';
import { openMenu } from '../interface/menu.js';
import { kw } from '../../windowmanager/wm-operators.js';
import { operatorIdname } from '../../makesrna/rna.js';
import { nodeModifierRows } from './addon-panels.js';
import { moduleTexture } from '../../blenkernel/texture/texture.js';

// B_UNIT_* (BKE_unit.hh) by value, as RNA names units, and ButtonType's Menu (an enum shows its item) and CheckboxN.
const UNITS = [null, 'LENGTH', 'AREA', 'VOLUME', 'MASS', 'ROTATION', 'TIME', 'TIME_ABSOLUTE', 'VELOCITY', 'ACCELERATION', 'CAMERA', 'POWER',
  'TEMPERATURE', 'WAVELENGTH', 'COLOR_TEMPERATURE', 'FREQUENCY'];
const BUTTON_MENU = 5, BUTTON_CHECKBOX_N = 15;
// eUI_Item_Flag bits a recorded prop carries (UI_interface_layout.hh).
const FLAG = { expand: 1 << 1, slider: 1 << 2, toggle: 1 << 3, icon_only: 1 << 5, invert_checkbox: 1 << 12 };
const LAYOUTS = new Set(['column', 'row', 'box', 'split', 'header', 'body']);

// A recorded C++ layout node (panel-layout.cc's JSON) as a layout node of layout.js: its owner's struct as data (by
// struct name, the recorded pointer and, for a raw property button, the button's index), and a raw button of the
// panel's block pressed through `press` (its index).
export function layoutTree(node, data, id, press = () => {}) {
  const children = () => node.children.map((child) => layoutTree(child, data, id, press)).filter(Boolean);
  const settings = { active: node.active !== false, enabled: node.enabled !== false, alert: !!node.alert, align: !!node.align,
    use_property_split: !!node.split, use_property_decorate: node.decorate !== false, heading: node.heading, alignment: node.alignment, emboss: node.emboss };
  // A panel's header lays its items out in a row, as Blender's header layouts do; its body in a column.
  const kind = { header: 'row', body: 'column' }[node.kind] ?? node.kind;
  if (LAYOUTS.has(node.kind)) return { ...settings, kind, children: children() };
  const owner = data(node.owner, node.pointer), text = node.text;
  switch (node.kind) {
    case 'prop': case 'search':
      return { kind: 'prop', data: owner, property: node.prop, text, index: node.index, split: !!node.split, decorate: node.decorate !== false, icon: node.icon,
        ...Object.fromEntries(Object.entries(FLAG).map(([key, bit]) => [key, !!(node.flag & bit)])) };
    case 'label': return { kind: 'label', text, icon: node.icon };
    case 'separator': return { kind: 'separator' };
    case 'button': {
      const { button } = node;
      if (!button.prop) return { kind: 'button', text: button.text, icon: button.icon, tip: button.tip, press: () => press(button.index) };
      // A property's button (uiDefButR): its property, element and unit (button_unit_type_set), a CheckboxN inverted.
      return { kind: 'prop', data: data(button.owner, button.pointer, button.index), property: button.prop, index: button.element,
        text: button.type === BUTTON_MENU || button.units <= 1 ? '' : button.text, unit: UNITS[button.unit], invert_checkbox: button.type === BUTTON_CHECKBOX_N, split: false, decorate: false };
    }
    case 'split_label': return { kind: 'split_label', text, children: children() };
    case 'operator': return { kind: 'operator', operator: operatorIdname(node.prop), text, icon: node.icon, props: {} };
    case 'operator_menu_enum': return { kind: 'operator_menu_enum', operator: operatorIdname(node.prop), property: node.property, text: text || undefined };
    // template_id is template_ID, as the Python API names it.
    case 'template': return { kind: 'template', name: text === 'template_id' ? 'template_ID' : text, data: owner, property: node.prop, new: node.new, unlink: true };
    case 'panel': {
      // A sub-panel: registered (with its label) or a layout panel (panel_prop, its header drawn into).
      const [header, ...rest] = node.children[0]?.kind === 'header' ? node.children : [null, ...node.children];
      const headerLayout = header ? layoutTree(header, data, id, press) : { kind: 'column', children: [{ kind: 'label', text }] };
      if (text && header) headerLayout.children.push({ kind: 'label', text });
      return { kind: 'panel', idname: `${id}:${node.prop}`, default_closed: true,
        children: [headerLayout, { kind: 'column', use_property_split: false, children: rest.map((child) => layoutTree(child, data, id, press)).filter(Boolean) }] };
    }
    default: return null;
  }
}

// The modifier header's layout (modifier_panel_header): the type's icon, name, toggles, extra operations and remove.
function headerLayout(modifier) {
  const layout = new UILayout('row'), row = layout.row(kw({ align: true }));
  row.row(kw({ align: true })).prop(modifier, 'name', kw({ text: '' }));
  const toggles = row.row(kw({ align: true }));
  for (const property of ['show_in_editmode', 'show_viewport', 'show_render']) toggles.prop(modifier, property, kw({ text: '' }));
  return layout;
}

export function modifierTemplates({ world, editor, rna, history }) {
  return (node, env) => {
    const ob = editor.selection.nodes.at(-1);
    if (!ob || !hasMesh(ob)) return null;
    const stack = modifierStack(ob), structs = rna.pointer('Object', ob).modifiers;
    return h('div', { class: 'flex flex-col gap-[calc(var(--bl-row)*.2)]' }, stack.map((modifier, index) => {
      const struct = structs[index], id = 'modifier:' + modifier.id, open = env.ui.isOpen(id, false), active = structs.active === struct;
      const setActive = () => { if (!active) { ob.metadata = { ...ob.metadata, wbActiveModifier: modifier.id }; env.ui.undoPush('Set Active Modifier'); } };
      const definition = world.modifiers.definitions.get(modifier.type);
      const operations = () => [
        ['Apply', 'CHECKMARK', () => world.modifiers.apply(ob, modifier.id)],
        ['Duplicate', 'DUPLICATE', () => world.modifiers.duplicate(ob, modifier.id)],
        ['Copy to Selected', 'COPYDOWN', () => world.modifiers.copyToSelected(ob, modifier.id, editor.selection.nodes)],
        '-',
        ['Move to First', 'TRIA_UP', () => world.modifiers.move(ob, modifier.id, 0)],
        ['Move to Last', 'TRIA_DOWN', () => world.modifiers.move(ob, modifier.id, stack.length - 1)],
      ].map((entry) => (entry === '-' ? '-' : { label: entry[0], icon: entry[1], run: () => { try { entry[2]()?.catch?.((error) => env.ui.report(error)); } catch (error) { env.ui.report(error); } } }));
      const data = (owner) => (owner === 'Object' ? rna.pointer('Object', ob) : struct);
      const body = () => {
        if (!definition?.mesh) return nodeModifierRows({ world, ob, modifier, definition, history });
        const [root] = modifierPanel(modifier, (id) => (world.textures?.byId(id) ? moduleTexture(world.textures.byId(id).values) : 0)).children;
        return root ? h(LayoutView, { layout: { kind: 'column', children: root.children.map((child) => layoutTree(child, data, id)).filter(Boolean) }, ui: env.ui }) : null;
      };
      return h('section', { key: modifier.id, class: ['bl-panel bl-panel-root', open && 'is-open', active && 'is-active'], 'data-blender': modifier.type, onPointerdown: setActive,
        onPointerenter: () => env.ui.hover?.(modifier.id), onPointerleave: () => env.ui.hover?.(null) }, [
        h('header', { class: 'bl-panel-header flex items-center', onClick: (e) => { if (!e.target.closest('input,button,label')) env.ui.toggle(id, e, false); } }, [
          icon(open ? 'DOWNARROW_HLT' : 'RIGHTARROW', 'bl-disclosure'),
          icon(definition?.icon ?? 'MODIFIER', 'bl-modifier-icon'),
          h('div', { class: 'flex min-w-0 flex-1' }, h(LayoutView, { layout: headerLayout(struct), ui: env.ui })),
          h('button', { type: 'button', class: 'bl-widget bl-flat flex h-unit w-unit items-center justify-center', title: 'Extra Operations', 'aria-label': 'Extra Operations',
            onClick: (e) => openMenu(operations, e.currentTarget) }, icon('DOWNARROW_HLT')),
          h('button', { type: 'button', class: 'bl-widget bl-flat flex h-unit w-unit items-center justify-center', title: 'Remove Modifier', 'aria-label': 'Remove Modifier',
            onClick: () => world.modifiers.remove(ob, modifier.id) }, icon('X')),
          icon('GRIP', 'bl-grip'),
        ]),
        open ? h('div', { class: 'bl-panel-body' }, body()) : null,
      ]);
    }));
  };
}
