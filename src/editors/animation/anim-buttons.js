// The Graph Editor's sidebar panels, which Blender draws in C (graph_buttons.cc): graph_buttons_register's panels,
// ported as the layout calls they make so they draw through the same layout renderer as Blender's Python panels. The
// panels read the area (its active F-Curve, graph_panel_context) from the context's space, and edit the module's data
// through RNA (makesrna/rna-bylonder.js: FCurve, Keyframe). The F-Modifier panels are Blender's own (fmodifier_ui.cc in
// the module), recorded and drawn by drawFModifierPanels. Drivers' panels are not ported.
import { kw } from '../../windowmanager/wm-operators.js';
import { INFO } from '../../makesrna/rna.js';
import { moduleStruct } from '../../makesrna/rna-module.js';
import { layoutTree } from '../space_buttons/modifier-panel.js';
import { FCURVE } from '../../blenkernel/animation/anim-blender.js';
import { iconName } from './anim-area.js';

const FCURVE_DISCRETE_VALUES = 1 << 12;
// The editor a context's space is (editors/animation/anim-editor.js): its AnimArea and RNA.
const editorOf = (context) => context.space_data?.[INFO]?.owner;
// graph_panel_context: the active F-Curve with its name and icon, or null.
const activeFCurve = (context) => editorOf(context)?.area.activeFCurve() ?? null;
// A panel type as graph_buttons_register registers it.
const graphPanel = (fields) => {
  const type = Object.assign(function () { return Object.create(type); }, { bl_space_type: 'GRAPH_EDITOR', bl_region_type: 'UI', ...fields });
  return type;
};
const graphPanelPoll = (context) => !!activeFCurve(context);

export const GRAPH_PT_properties = graphPanel({
  bl_idname: 'GRAPH_PT_properties', bl_label: 'Active F-Curve', bl_category: 'F-Curve', poll: graphPanelPoll,
  draw(context) {
    const active = activeFCurve(context), layout = this.layout;
    if (!active) return;
    const fcu = editorOf(context).rna.pointer('FCurve', active.fcurve);
    layout.column().label(kw({ text: active.name, icon: active.icon }));
    layout.use_property_split = true;
    layout.use_property_decorate = false;
    const rnaCol = layout.column();
    rnaCol.enabled = !!(active.fcurve.flag & FCURVE.DISABLED);
    rnaCol.prop(fcu, 'data_path', kw({ text: '', icon: 'RNA' }));
    rnaCol.prop(fcu, 'array_index');
    const colorCol = layout.column(kw({ align: true }));
    colorCol.prop(fcu, 'color_mode', kw({ text: 'Display Color' }));
    if (active.fcurve.color_mode === 'CUSTOM') colorCol.prop(fcu, 'color', kw({ text: 'Color' }));
    layout.column(kw({ align: true })).prop(fcu, 'auto_smoothing', kw({ text: 'Handle Smoothing' }));
  },
});

export const GRAPH_PT_key_properties = graphPanel({
  bl_idname: 'GRAPH_PT_key_properties', bl_label: 'Active Keyframe', bl_category: 'F-Curve', poll: graphPanelPoll,
  draw(context) {
    const active = activeFCurve(context), layout = this.layout;
    if (!active) return;
    const { fcurve } = active, index = fcurve.active_key;
    layout.use_property_split = true;
    layout.use_property_decorate = false;
    if (index < 0) {
      layout.label(kw({ text: fcurve.length ? 'No active keyframe on F-Curve' : 'F-Curve only has F-Modifiers' }));
      return;
    }
    const keys = fcurve.keys, bezt = keys[index], prev = keys[Math.max(index - 1, 0)];
    const key = editorOf(context).rna.pointer('Keyframe', { fcurve, index });
    const interpolationCol = layout.column();
    if (fcurve.flag & FCURVE_DISCRETE_VALUES) {
      const split = interpolationCol.split(kw({ factor: 0.33, align: true }));
      split.label(kw({ text: 'Interpolation:' }));
      split.label(kw({ text: 'None for Enum/Boolean', icon: 'IPO_CONSTANT' }));
    } else {
      interpolationCol.prop(key, 'interpolation');
    }
    if (!['CONSTANT', 'LINEAR', 'BEZIER'].includes(bezt.interpolation)) interpolationCol.prop(key, 'easing');
    if (bezt.interpolation === 'BACK') layout.column(kw({ align: true })).prop(key, 'back');
    if (bezt.interpolation === 'ELASTIC') {
      const col = layout.column(kw({ align: true }));
      col.prop(key, 'amplitude');
      col.prop(key, 'period');
    }
    const coCol = layout.column(kw({ align: true }));
    coCol.prop(key, 'co_ui', kw({ text: 'Key Frame', index: 0 }));
    coCol.prop(key, 'co_ui', kw({ text: 'Value', index: 1 }));
    const handle = (side, title) => {
      const col = layout.column(kw({ align: true }));
      col.prop(key, `handle_${side}_type`, kw({ text: title }));
      col.prop(key, `handle_${side}`, kw({ text: 'Frame', index: 0 }));
      col.prop(key, `handle_${side}`, kw({ text: 'Value', index: 1 }));
    };
    if (prev.interpolation === 'BEZIER') handle('left', 'Left Handle Type');
    if (bezt.interpolation === 'BEZIER') handle('right', 'Right Handle Type');
  },
});

export const GRAPH_PT_modifiers = graphPanel({
  bl_idname: 'GRAPH_PT_modifiers', bl_label: 'Modifiers', bl_category: 'Modifiers', bl_options: ['HIDE_HEADER'], poll: graphPanelPoll,
  draw() {
    const row = this.layout.row();
    row.operator_menu_enum('graph.fmodifier_add', 'type', kw({ text: 'Add Modifier' }));
    const sub = row.row(kw({ align: true }));
    sub.operator('graph.fmodifier_copy', kw({ text: '', icon: 'COPYDOWN' }));
    sub.operator('graph.fmodifier_paste', kw({ text: '', icon: 'PASTEDOWN' }));
  },
});

export const GRAPH_PT_view = graphPanel({
  bl_idname: 'GRAPH_PT_view', bl_label: 'Show Cursor', bl_category: 'View',
  draw_header(context) {
    this.layout.column().prop(context.space_data, 'show_cursor', kw({ text: '' }));
  },
  draw(context) {
    const layout = this.layout, space = context.space_data;
    layout.use_property_split = true;
    layout.use_property_decorate = false;
    const col = layout.column();
    col.active = space.show_cursor;
    const pos = col.column(kw({ align: true }));
    if (space.mode === 'DRIVERS') pos.prop(space, 'cursor_position_x', kw({ text: 'Cursor X' }));
    else pos.prop(context.scene, 'frame_current', kw({ text: 'Cursor X' }));
    pos.prop(space, 'cursor_position_y', kw({ text: 'Y' }));
    const sub = col.column(kw({ align: true }));
    sub.operator('graph.frame_jump', kw({ text: 'Cursor to Selection' }));
    sub.operator('graph.snap_cursor_value', kw({ text: 'Cursor Value to Selection' }));
  },
});

// A recorded node with its icons by name.
const named = (node) => ({
  ...node, ...(node.icon ? { icon: iconName(node.icon) } : {}),
  ...(node.button ? { button: { ...node.button, icon: node.button.icon ? iconName(node.button.icon) : undefined } } : {}),
  children: (node.children ?? []).map(named),
});

// The active F-Curve's F-Modifier panels after graph_panel_modifiers' row (ANIM_fmodifier_panels), as drawPanels gives
// panels: each modifier's panel (its header the buttons fmodifier_panel_header makes) and sub-panels, their properties
// read and written through the module's RNA, `changed()` after an edit.
export function drawFModifierPanels(area, { isOpen, changed }) {
  const structs = new Map();
  const data = (struct, pointer) => {
    if (!pointer) return null;
    const key = struct + pointer.join(':');
    if (!structs.has(key)) structs.set(key, moduleStruct(struct, pointer, { C: area.main.C, changed }));
    return structs.get(key);
  };
  const press = (index) => { area.pressPanelButton(index); changed(); };
  const drawn = (node, key, sub) => {
    const part = (kind) => node.children.find((child) => child.kind === kind);
    const tree = (kind) => part(kind) && layoutTree(part(kind), data, key, press);
    const id = `${key}:${node.prop}`;
    return { id, label: node.text, header: tree('header'), headerExpand: !sub, body: tree('body'), open: isOpen(id, sub), closedByDefault: sub,
      children: node.children.filter((child) => child.kind === 'panel').map((child) => drawn(child, key, true)) };
  };
  return area.fmodifierPanels().map(({ modifier, panel }) => drawn(named(panel.children[0]), modifier, false));
}

// In graph_buttons_register's order.
export const GRAPH_PANELS = [GRAPH_PT_properties, GRAPH_PT_key_properties, GRAPH_PT_modifiers, GRAPH_PT_view];
