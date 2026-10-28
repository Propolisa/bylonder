// The Outliner's area in the module (tools/blender-port/wasm/outliner-api.cc): Blender's ScrArea with the
// SpaceOutliner its space type creates and its regions, in a BlenderMain's context. Its main region draws through
// region-draw; operators run in it as Blender's handlers run them: invoked with an event in region pixels (y up), modal
// ones kept until they end, a box gesture run by the window manager and then exec'd.
import { blenderModule, newOperator, setOperatorProperties } from '../../bmesh/bmesh-wasm.js';
import { dnaStruct } from '../../makesrna/dna-struct.js';
import '../interface/region-draw.js';

const { exports: x, withString, cString } = blenderModule;

// wmEventModifierFlag, wmOperatorStatus and wmOperatorTypeFlag.
export const KM_SHIFT = 1, KM_CTRL = 2, KM_ALT = 4, KM_OSKEY = 8;
export const OPERATOR_RUNNING_MODAL = 1, OPERATOR_CANCELLED = 2, OPERATOR_FINISHED = 4, OPERATOR_PASS_THROUGH = 8;
const OPTYPE_UNDO = 1 << 1;
const GESTURES = [null, 'BOX', 'CIRCLE', 'LASSO'];

// Blender's event types and values by identifier (rna_enum_event_type_items, rna_enum_event_value_items).
const enumTable = (which) => new Map(cString(x.rna_enum_text(which)).split('\n').filter(Boolean).map((line) => {
  const [id, value] = line.split('\t');
  return [id, Number(value)];
}));
const EVENT_TYPES = enumTable(0), EVENT_VALUES = enumTable(1);

export const modifierOf = (event) => (event.shift ? KM_SHIFT : 0) | (event.ctrl ? KM_CTRL : 0) | (event.alt ? KM_ALT : 0) | (event.oskey ? KM_OSKEY : 0);

export class OutlinerArea {
  constructor(main) {
    this.main = main;
    this.pointer = x.outliner_new(main.C) >>> 0;
    this.space = dnaStruct('SpaceOutliner', x.outliner_space(this.pointer) >>> 0);
    this.size = [0, 0];
    this.modal = null;
    this.gesture = null;
  }
  resize(width, height) {
    this.size = [width, height];
    x.outliner_region_size(this.pointer, 0, 0, width, height);
  }
  // The main region's draw (region-draw.cc's recording).
  draw() { return JSON.parse(cString(x.outliner_draw(this.main.C, this.pointer))); }
  // The selection changed elsewhere: the Outliner syncs its own from the view layer's when it next draws.
  selectionChanged() { x.outliner_select_sync_from_objects(this.pointer); }

  inContext(fn) {
    x.outliner_context_set(this.main.C, this.pointer);
    try {
      return fn(this.main.C);
    } finally {
      x.outliner_context_set(this.main.C, 0);
      // The module's scene is not in Main's scenes, which BKE_main_collection_sync resyncs after IDs change.
      this.main.syncCollections();
    }
  }
  #event(C, { type, value = 'PRESS', region: [rx, ry] = [0, 0], modifier = 0, text = '' }) {
    return withString(text, (t) => x.wm_event_set(C, EVENT_TYPES.get(type) ?? 0, EVENT_VALUES.get(value) ?? 0, Math.round(rx), Math.round(ry),
      modifier, t, EVENT_TYPES.get(type) ?? 0, EVENT_VALUES.get(value) ?? 0)) >>> 0;
  }
  // Runs an operator by idname: invoked with an event ({ type, value, region, modifier } in Blender's identifiers),
  // else its exec. Returns { status, undo }: an operator that goes modal keeps running (handle()), one that started a
  // box gesture waits for finishGesture().
  run(idname, props = {}, event = null) {
    this.cancel();
    const op = newOperator(idname, props);
    const status = this.inContext((C) => (event ? x.operator_invoke(C, op, this.#event(C, event)) : x.operator_exec(C, op)));
    const modal = x.operator_modal_added() >>> 0, gesture = GESTURES[x.operator_gesture()], undo = !!(x.operator_type_flag(op) & OPTYPE_UNDO);
    if (status & OPERATOR_RUNNING_MODAL && modal && gesture) this.gesture = { type: gesture, op, undo };
    else if (status & OPERATOR_RUNNING_MODAL && modal) this.modal = { op, undo };
    else x.operator_free(op);
    return { status, undo };
  }
  // Gives the running modal operator an event; returns its status, and frees it once it ends.
  handle(event) {
    const { op, undo } = this.modal;
    const status = this.inContext((C) => x.operator_modal(C, op, this.#event(C, event)));
    if (!(status & OPERATOR_RUNNING_MODAL)) {
      this.modal = null;
      x.operator_free(op);
    }
    return { status, undo };
  }
  // Ends the box gesture an operator waits for: its exec run with the gesture's properties, or cancelled (null).
  finishGesture(props) {
    if (!this.gesture) return { status: OPERATOR_CANCELLED, undo: false };
    const { op, undo } = this.gesture;
    this.gesture = null;
    try {
      if (!props) return { status: OPERATOR_CANCELLED, undo };
      setOperatorProperties(op, props);
      return { status: this.inContext((C) => x.operator_exec(C, op)), undo };
    } finally {
      x.operator_free(op);
    }
  }
  cancel() {
    if (this.dragging) this.dragCancel();
    if (this.modal) this.handle({ type: 'ESC' });
    if (this.gesture) this.finishGesture(null);
  }

  // A drag an operator started (WM_event_start_prepared_drag), moved over the main region: the tooltip of the drop it
  // would make there; dropped there (the drop operator's status, 0 when none); or cancelled.
  get dragging() { return !!x.drag_running(this.main.C); }
  dragUpdate(event) { return this.inContext((C) => cString(x.drag_update(C, this.#event(C, event)))); }
  drop(event) { return { status: this.inContext((C) => x.drag_drop(C, this.#event(C, event))), undo: true }; }
  dragCancel() { x.drag_cancel(this.main.C); }

  // A button of the last draw pressed as Blender's handlers apply it: a toggle set to `value` (or flipped when not
  // given), with the keys held (KM_*). Returns the toggle's state after.
  press(index, { value = -1, modifier = 0 } = {}) { return !!this.inContext((C) => x.region_button_press(C, index, value, modifier)); }
  // A text button's edit applied, or cancelled (null).
  editText(index, text) {
    this.inContext((C) => (text === null ? x.region_button_text(C, index, 0) : withString(text, (p) => x.region_button_text(C, index, p))));
  }
}
