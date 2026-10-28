// An animation editor's area in the module (AnimArea in tools/blender-port/wasm/anim-api.cc): Blender's ScrArea with
// the SpaceGraph or SpaceAction its space type creates, and that space's regions, in a BlenderMain's context.
// Operators run in it, in one of its regions, as Blender's handlers run them; drawing reads what it lists.
import { blenderModule, setOperatorProperties, pollOperator } from '../../bmesh/bmesh-wasm.js';
import { FCurve, Action, EVENT_TYPES, EVENT_VALUES } from '../../blenkernel/animation/anim-blender.js';
import '../interface/region-draw.js';

const { exports: x, withArrays, withString, cString } = blenderModule;
const view = () => new DataView(x.memory.buffer);

// Blender's space and region types (eSpace_Type, eRegion_Type).
export const SPACE_GRAPH = 2, SPACE_ACTION = 12;
export const RGN_TYPE_WINDOW = 0, RGN_TYPE_HEADER = 1, RGN_TYPE_CHANNELS = 2, RGN_TYPE_UI = 4;
const RGN_FLAG_HIDDEN = 1 << 0;
// Area.ui_type within a SpaceAction (its mode, eAnimEdit_Context).
export const ACTION_MODES = { DOPESHEET: 0, ACTION: 1, SHAPEKEY: 2, GPENCIL: 3, MASK: 4, CACHEFILE: 5, TIMELINE: 6 };
// wmEventModifierFlag and wmOperatorStatus.
export const KM_SHIFT = 1, KM_CTRL = 2, KM_ALT = 4, KM_OSKEY = 8;
export const OPERATOR_RUNNING_MODAL = 1, OPERATOR_CANCELLED = 2, OPERATOR_FINISHED = 4, OPERATOR_PASS_THROUGH = 8;
const OPTYPE_UNDO = 1 << 1;
const EVT_MODAL_MAP = 0x5022;
// The popups an invoke can open (operator_popup), by number.
const POPUPS = [null, 'CONFIRM', 'ENUM_MENU', 'PROPS'];
// The gestures an invoke can start (operator_gesture), by number.
const GESTURES = [null, 'BOX', 'CIRCLE', 'LASSO'];
// eAnimChannel_Settings, as bits of a channel's settings and values.
export const ACHANNEL_SETTING = { SELECT: 0, PROTECT: 1, MUTE: 2, EXPAND: 3, VISIBLE: 4, SOLO: 5, PINNED: 6, MOD_OFF: 7, ALWAYS_VISIBLE: 8 };

const rect = (dv, p, get) => ({ xmin: get(dv, p), xmax: get(dv, p + 4), ymin: get(dv, p + 8), ymax: get(dv, p + 12) });
const float = (dv, p) => dv.getFloat32(p, true), int = (dv, p) => dv.getInt32(p, true);
// ChannelInfo in anim-api.cc, and the fields of a key column (anim_channel_keys).
const CHANNEL_NAME = 44;
const COLUMN_FIELDS = ['frame', 'key_type', 'handle_type', 'extreme_type', 'select', 'block_flag', 'block_select', 'hold'];

// A region's View2D: tot and cur in view space, mask in region pixels (inclusive).
export class View2D {
  constructor(pointer) { this.pointer = pointer; }
  get tot() { return rect(view(), this.pointer, float); }
  get cur() { return rect(view(), this.pointer + 16, float); }
  set cur(value) { ['xmin', 'xmax', 'ymin', 'ymax'].forEach((k, i) => view().setFloat32(this.pointer + 16 + i * 4, value[k], true)); }
  get mask() { return rect(view(), this.pointer + 64, int); }
  // UI_view2d_view_to_region_fl and UI_view2d_region_to_view.
  toRegion(vx, vy) {
    const { cur, mask } = this;
    return [mask.xmin + (vx - cur.xmin) * (mask.xmax - mask.xmin) / (cur.xmax - cur.xmin), mask.ymin + (vy - cur.ymin) * (mask.ymax - mask.ymin) / (cur.ymax - cur.ymin)];
  }
  toView(rx, ry) {
    const { cur, mask } = this;
    return [cur.xmin + (rx - mask.xmin) * (cur.xmax - cur.xmin) / (mask.xmax - mask.xmin), cur.ymin + (ry - mask.ymin) * (cur.ymax - cur.ymin) / (mask.ymax - mask.ymin)];
  }
}

// An icon's name by its id (UI_icons.hh), as region-draw.cc names them.
export const iconName = (icon) => cString(x.ui_icon_name(icon));

export class AnimArea {
  // A space made for a sub-type (a SpaceAction's mode), as an area asks for one; -1 for its default.
  constructor(main, spacetype, subtype = -1) {
    this.main = main;
    this.spacetype = spacetype;
    this.pointer = x.anim_area_new(main.C, spacetype, subtype) >>> 0;
    this.modal = null;
  }
  dispose() {
    this.cancelModal();
    x.anim_area_free(this.pointer);
  }
  region(type) { return x.anim_area_region(this.pointer, type) >>> 0; }
  v2d(type = RGN_TYPE_WINDOW) { return new View2D(x.anim_region_v2d(this.region(type)) >>> 0); }
  // Sizes a region (pixels, from the area's bottom left, y up); its view keeps its zoom as Blender's does.
  layout(type, left, bottom, width, height) {
    const region = this.region(type);
    if (region) x.anim_region_layout(this.main.C, region, left, bottom, width, height);
  }
  sync() { x.anim_area_sync(this.pointer); }
  // A region drawn by its own draw callback, or its overlay's, as region-draw.cc records it ({ draw, buttons }).
  draw(type, overlay = false) { return JSON.parse(cString(x.anim_region_draw(this.main.C, this.pointer, type, overlay))); }
  // A button of a region's last draw pressed as Blender's handlers apply it (a toggle flipped), with the keys held.
  press(type, index, modifier = 0) { return this.inContext(type, (C) => x.region_button_press(C, index, -1, modifier)); }
  // The space's dope sheet: its filter text (DopeSheet.filter_text) and flag (ADS_FLAG_*).
  get filterText() { return cString(x.anim_dopesheet_search(this.pointer)); }
  set filterText(text) {
    const bytes = new TextEncoder().encode(text).slice(0, 63), p = x.anim_dopesheet_search(this.pointer) >>> 0;
    new Uint8Array(x.memory.buffer, p, 64).fill(0).set(bytes);
  }
  get dopesheetFlag() { return x.anim_dopesheet_flag(this.pointer); }
  set dopesheetFlag(flag) { x.anim_dopesheet_flag_set(this.pointer, flag); }
  // Whether a region shows (RGN_FLAG_HIDDEN clear).
  shown(type) { const region = this.region(type); return !!region && !(x.anim_region_flag(region) & RGN_FLAG_HIDDEN); }
  show(type, value) {
    const region = this.region(type), flag = x.anim_region_flag(region);
    x.anim_region_flag_set(region, value ? flag & ~RGN_FLAG_HIDDEN : flag | RGN_FLAG_HIDDEN);
  }
  get cursorValue() { return x.anim_graph_cursor(this.pointer); }
  set cursorValue(value) { x.anim_graph_cursor_set(this.pointer, value); }
  get subtype() { return x.anim_area_subtype(this.pointer); }
  set subtype(value) { x.anim_area_subtype_set(this.pointer, value); }
  // The header text the running operator shows (ED_area_status_text).
  get status() { const text = x.anim_area_status(this.pointer); return text ? cString(text) : ''; }
  // Runs fn with the context in this area and one of its regions.
  inContext(regionType, fn) {
    x.anim_context_set(this.main.C, this.pointer, this.region(regionType));
    try {
      return fn(this.main.C);
    } finally {
      x.anim_context_set(this.main.C, 0, 0);
    }
  }
  // What the space's refresh does before drawing (the Graph Editor's curve colors).
  refresh() { this.inContext(RGN_TYPE_WINDOW, (C) => x.anim_area_refresh(C, this.pointer)); }
  // The space's flag (eGraphEdit_Flag or eSAction_Flag), mode, dope sheet filter flags and pivot point.
  get settings() {
    const [flag, mode, filterflag, around] = new Int32Array(x.memory.buffer, x.anim_area_settings(this.pointer) >>> 0, 4);
    return { flag, mode, filterflag, around };
  }
  set settings({ flag, filterflag, around }) {
    const now = this.settings;
    x.anim_area_settings_set(this.pointer, flag ?? now.flag, filterflag ?? now.filterflag, around ?? now.around);
  }
  // The sizes the region's drawing and layout use (anim_ui_metrics), in pixels or its view's units.
  metrics(type = RGN_TYPE_WINDOW) {
    const m = new Float32Array(x.memory.buffer, x.anim_ui_metrics(x.anim_region_v2d(this.region(type))) >>> 0, 8);
    return { channelHeight: m[0], channelSkip: m[1], channelStep: m[2], firstChannelTop: m[3], scrubHeight: m[4], markerHeight: m[5], scrollWidth: m[6], keyframeScale: m[7] };
  }
  // Whether an operator polls in a region of this area.
  poll(idname, regionType = RGN_TYPE_WINDOW) { return this.inContext(regionType, (C) => pollOperator(C, idname)); }

  // The channels the area lists, as its channel region draws them; keys() gives each one's key columns.
  // The active F-Curve the sidebar's panels edit, with the name and icon they show, or null (graph_panel_context).
  activeFCurve() {
    return this.inContext(RGN_TYPE_UI, (C) => withArrays([new Uint8Array(256), new Int32Array(1)], ([name, icon]) => {
      const fcurve = x.anim_active_fcurve(C, name, icon) >>> 0;
      return fcurve ? { fcurve: new FCurve(fcurve), name: cString(name), icon: cString(x.anim_icon_name(new Int32Array(x.memory.buffer, icon, 1)[0])) } : null;
    }));
  }
  // The active F-Curve's F-Modifier panels, drawn by fmodifier_ui.cc and recorded by panel-layout.cc:
  // [{ modifier (its address), panel (the recorded panel tree) }]. pressPanelButton presses one of their raw buttons.
  fmodifierPanels() { return this.inContext(RGN_TYPE_UI, (C) => JSON.parse(cString(x.anim_fmodifier_panels(C)))); }
  pressPanelButton(index) { this.inContext(RGN_TYPE_UI, (C) => x.panel_button_press(C, index, -1, 0)); }
  // The context's active Action (context.active_action), or null.
  activeAction() {
    const action = this.inContext(RGN_TYPE_UI, (C) => x.anim_active_action(C) >>> 0);
    return action ? new Action(action) : null;
  }
  channels() {
    return this.inContext(RGN_TYPE_CHANNELS, (C) => Array.from({ length: x.anim_channels(C) }, (_, index) => {
      const p = x.anim_channel_info(index) >>> 0, dv = view();
      return {
        index, type: int(dv, p), data: dv.getUint32(p + 4, true), id: dv.getUint32(p + 8, true), offset: int(dv, p + 12),
        icon: cString(x.anim_icon_name(int(dv, p + 16))), settings: int(dv, p + 20), values: int(dv, p + 24),
        color: [0, 1, 2].map((i) => float(dv, p + 28 + i * 4)), datatype: int(dv, p + 40), name: cString(p + CHANNEL_NAME),
      };
    }));
  }
  // Sets a listed channel's setting (ACHANNEL_SETTING) as its toggle does: 0 off, 1 on, 2 invert (after channels()).
  channelSetting(index, setting, mode = 2) { this.inContext(RGN_TYPE_CHANNELS, () => x.anim_channel_setting_set(index, setting, mode)); }
  // A listed channel's key columns in a frame range (valid after channels()).
  keys(index, xmin, xmax, max = 4096) {
    return withArrays([new Float32Array(max * 8)], ([p]) => {
      const count = x.anim_channel_keys(index, xmin, xmax, p, max), values = new Float32Array(x.memory.buffer, p, count * 8);
      return Array.from({ length: count }, (_, i) => Object.fromEntries(COLUMN_FIELDS.map((name, j) => [name, values[i * 8 + j]])));
    });
  }
  // The F-Curves the Graph Editor draws, with the unit mapping their values are drawn with.
  curves(max = 1024) {
    return this.inContext(RGN_TYPE_WINDOW, (C) => withArrays([new Float32Array(max * 3)], ([p]) => {
      const count = x.anim_graph_curves(C, p, max), words = new Uint32Array(x.memory.buffer, p, count * 3), floats = new Float32Array(x.memory.buffer, p, count * 3);
      return Array.from({ length: count }, (_, i) => ({ fcurve: new FCurve(words[i * 3]), factor: floats[i * 3 + 1], offset: floats[i * 3 + 2] }));
    }));
  }

  // Blender's event: type and value by identifier ('G', 'PRESS') or number, where it is in the region (pixels, y up),
  // modifiers (KM_*), text, and the previous event's type and value.
  #event(C, { type, value = 'PRESS', x: mx = 0, y: my = 0, modifier = 0, text = '', prevType = type, prevValue = value }) {
    const code = (table, v) => (typeof v === 'number' ? v : table.get(v) ?? 0);
    return withString(text, (t) => x.wm_event_set(C, code(EVENT_TYPES, type), code(EVENT_VALUES, value), Math.round(mx), Math.round(my), modifier, t,
      code(EVENT_TYPES, prevType), code(EVENT_VALUES, prevValue))) >>> 0;
  }
  // Runs an operator (from newOperator) in a region: invoked with an event, else its exec. One that goes modal keeps
  // running: handle() gives it the next events, and it is freed when it ends. One whose invoke started a gesture (a
  // box, circle or lasso: gesture) waits for the window manager to run it and then gesture.finish(props); one whose
  // invoke opened a popup (a confirmation or an enum's menu: popup) waits for finishPopup(props). Returns its status.
  run(op, regionType, event = null) {
    this.cancelModal();
    const status = this.inContext(regionType, (C) => (event ? x.operator_invoke(C, op, this.#event(C, event)) : x.operator_exec(C, op)));
    const modal = x.operator_modal_added() >>> 0, gesture = GESTURES[x.operator_gesture()], undo = !!(x.operator_type_flag(op) & OPTYPE_UNDO);
    const popup = POPUPS[x.operator_popup()];
    this.undo = undo;
    if (popup) {
      this.popup = { type: popup, title: cString(x.operator_popup_title()), text: cString(x.operator_popup_text()), op, regionType, undo };
      return status;
    }
    if (!(status & OPERATOR_RUNNING_MODAL && modal)) {
      x.operator_free(op);
      return status;
    }
    if (gesture) this.gesture = { type: gesture, op, regionType, undo };
    else {
      this.modal = { op, regionType, undo, keymap: cString(x.operator_modal_keymap(op)) };
      // The window manager gives a modal operator the pointer's place at once (WM_event_add_mousemove).
      if (event) this.handle({ type: 'MOUSEMOVE', value: 'NOTHING', x: event.x, y: event.y });
    }
    return status;
  }
  // Ends the gesture an operator waits for, as the gesture's modal does: its properties set (a lasso's path in region
  // pixels), its exec run; or cancelled.
  finishGesture(props, path = null) {
    const { op } = this.gesture;
    try {
      return props ? this.applyGesture(props, path) : OPERATOR_CANCELLED;
    } finally {
      this.gesture = null;
      x.operator_free(op);
    }
  }
  // Ends the popup an operator waits for: its exec run with the properties chosen, or cancelled (null).
  finishPopup(props) {
    const { op, regionType, undo } = this.popup;
    this.popup = null;
    try {
      if (!props) return OPERATOR_CANCELLED;
      setOperatorProperties(op, props);
      this.undo = undo;
      return this.inContext(regionType, (C) => x.operator_exec(C, op));
    } finally {
      x.operator_free(op);
    }
  }
  // Runs the gesture's operator with properties without ending the gesture, as a circle's does as it moves.
  applyGesture(props, path = null) {
    const { op, regionType, undo } = this.gesture;
    setOperatorProperties(op, props);
    if (path) withArrays([Int32Array.from(path.flat())], ([p]) => x.gesture_lasso_path_set(p, path.length));
    this.undo = undo;
    return this.inContext(regionType, (C) => x.operator_exec(C, op));
  }
  // The running operator's modal map value for an item identifier when its modal keymap lets it through now, else -1.
  modalItem(identifier) { return this.modal ? withString(identifier, (p) => x.operator_modal_item(this.modal.op, p)) : -1; }
  // Gives the running modal operator an event; a modal map item goes as { modal: value } (EVT_MODAL_MAP).
  handle(event) {
    const { op, regionType } = this.modal;
    return this.inContext(regionType, (C) => {
      const e = event.modal === undefined ? event : { ...event, type: EVT_MODAL_MAP, value: event.modal };
      const status = x.operator_modal(C, op, this.#event(C, e));
      if (!(status & OPERATOR_RUNNING_MODAL)) {
        this.undo = this.modal.undo;
        this.modal = null;
        x.operator_free(op);
      }
      return status;
    });
  }
  cancelModal() {
    if (this.modal) this.handle({ type: 'ESC' });
    if (this.gesture) this.finishGesture(null);
    if (this.popup) this.finishPopup(null);
  }
}
