// An animation editor's area in the module (AnimArea in tools/blender-port/wasm/anim-api.cc): Blender's ScrArea with
// the SpaceGraph or SpaceAction its space type creates, and that space's regions, in a BlenderMain's context.
// Operators run in it, in one of its regions, as Blender's handlers run them; drawing reads what it lists.
import { blenderModule, setOperatorProperties } from '../../bmesh/bmesh-wasm.js';
import { FCurve, EVENT_TYPES, EVENT_VALUES } from '../../blenkernel/animation/anim-blender.js';

const { exports: x, withArrays, withString, cString } = blenderModule;
const view = () => new DataView(x.memory.buffer);

// Blender's space and region types (eSpace_Type, eRegion_Type) and View2D view types (V2D_COMMONVIEW_*).
export const SPACE_GRAPH = 2, SPACE_ACTION = 12;
export const RGN_TYPE_WINDOW = 0, RGN_TYPE_HEADER = 1, RGN_TYPE_CHANNELS = 2, RGN_TYPE_UI = 4;
const V2D_COMMONVIEW_CUSTOM = -1, V2D_COMMONVIEW_LIST = 1;
// Area.ui_type within a SpaceAction (its mode, eAnimEdit_Context).
export const ACTION_MODES = { DOPESHEET: 0, ACTION: 1, SHAPEKEY: 2, GPENCIL: 3, MASK: 4, CACHEFILE: 5, TIMELINE: 6 };
// wmEventModifierFlag and wmOperatorStatus.
export const KM_SHIFT = 1, KM_CTRL = 2, KM_ALT = 4, KM_OSKEY = 8;
export const OPERATOR_RUNNING_MODAL = 1, OPERATOR_CANCELLED = 2, OPERATOR_FINISHED = 4, OPERATOR_PASS_THROUGH = 8;
const EVT_MODAL_MAP = 0x5022;
// The gestures an invoke can start (operator_gesture), by number.
const GESTURES = [null, 'BOX', 'CIRCLE', 'LASSO'];
// eAnimChannel_Settings, as bits of a channel's settings and values.
export const ACHANNEL_SETTING = { SELECT: 0, PROTECT: 1, MUTE: 2, EXPAND: 3, VISIBLE: 4, SOLO: 5, PINNED: 6, MOD_OFF: 7, ALWAYS_VISIBLE: 8 };

const rect = (dv, p, get) => ({ xmin: get(dv, p), xmax: get(dv, p + 4), ymin: get(dv, p + 8), ymax: get(dv, p + 12) });
const float = (dv, p) => dv.getFloat32(p, true), int = (dv, p) => dv.getInt32(p, true);
// ChannelInfo in anim-api.cc, and the fields of a key column (anim_channel_keys).
const CHANNEL_NAME = 44;
const COLUMN_FIELDS = ['frame', 'key_type', 'handle_type', 'extreme_type', 'select', 'block_flag', 'block_select', 'blocks'];

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

export class AnimArea {
  constructor(main, spacetype) {
    this.main = main;
    this.spacetype = spacetype;
    this.pointer = x.anim_area_new(main.C, spacetype) >>> 0;
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
    if (region) x.anim_region_layout(region, left, bottom, width, height, type === RGN_TYPE_CHANNELS ? V2D_COMMONVIEW_LIST : V2D_COMMONVIEW_CUSTOM);
  }
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

  // The channels the area lists, as its channel region draws them; keys() gives each one's key columns.
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
  // box, circle or lasso: gesture) waits for the window manager to run it and then gesture.finish(props). Returns its
  // status.
  run(op, regionType, event = null) {
    this.cancelModal();
    const status = this.inContext(regionType, (C) => (event ? x.operator_invoke(C, op, this.#event(C, event)) : x.operator_exec(C, op)));
    const modal = x.operator_modal_added() >>> 0, gesture = GESTURES[x.operator_gesture()];
    if (!(status & OPERATOR_RUNNING_MODAL && modal)) {
      x.operator_free(op);
      return status;
    }
    if (gesture) this.gesture = { type: gesture, op, regionType };
    else {
      this.modal = { op, regionType };
      // The window manager gives a modal operator the pointer's place at once (WM_event_add_mousemove).
      if (event) this.handle({ type: 'MOUSEMOVE', value: 'NOTHING', x: event.x, y: event.y });
    }
    return status;
  }
  // Ends the gesture an operator waits for, as the gesture's modal does: its properties set (a lasso's path in region
  // pixels), its exec run; or cancelled.
  finishGesture(props, path = null) {
    const { op, regionType } = this.gesture;
    this.gesture = null;
    try {
      if (!props) return OPERATOR_CANCELLED;
      setOperatorProperties(op, props);
      if (path) withArrays([Int32Array.from(path.flat())], ([p]) => x.gesture_lasso_path_set(p, path.length));
      return this.inContext(regionType, (C) => x.operator_exec(C, op));
    } finally {
      x.operator_free(op);
    }
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
        this.modal = null;
        x.operator_free(op);
      }
      return status;
    });
  }
  cancelModal() {
    if (this.modal) this.handle({ type: 'ESC' });
    if (this.gesture) this.finishGesture(null);
  }
}
