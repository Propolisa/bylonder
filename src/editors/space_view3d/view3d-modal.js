// One of Blender's operators run in the module's 3D View as Blender's window manager runs it: invoked with the event
// that ran it (or one at the pointer), then given the following events while it runs modally, its modal keymap's items
// as items, until it ends. The module side (`target`: Edit Mode's EditMesh, Object Mode's BlenderMain) has
// invoke(idname, props, event) -> { status, op, keymap, report }, modal(op, event) -> status, modalItem(op, identifier)
// -> its value or -1, and status (the header's text).
import { OPERATOR_RUNNING_MODAL, OPERATOR_PASS_THROUGH } from '../../bmesh/bmesh-wasm.js';
import { viewProjection } from './view3d-project.js';
import { modalItem } from '../../windowmanager/keyconfig.js';
import { tagRedraw } from '../../draw/overlay-tool.js';

// Blender's event types where they differ from the window manager's (wm-event-system.js).
const EVENT_TYPES = { SPACEBAR: 'SPACE' };
// wmEventModifierFlag of a window manager event.
export const modifierFlags = (e) => (e.shift ? 1 : 0) | (e.ctrl ? 2 : 0) | (e.alt ? 4 : 0) | (e.oskey ? 8 : 0);

// Blender's event for one of the window manager's in a view: its type and value, where it is in the region (y up),
// its modifiers, text, and a drag's press.
export function blenderEvent(view, e) {
  const r = viewProjection(view), [x, y] = r.toBlenderRegion([e.x, e.y]), type = e.type.toUpperCase();
  const press = e.value === 'CLICK_DRAG' && e.press ? r.toBlenderRegion([e.press.x, e.press.y]) : undefined;
  return { type: EVENT_TYPES[type] ?? type, value: e.value, x, y, modifier: modifierFlags(e), text: e.native?.key?.length === 1 ? e.native.key : '', press };
}

//   wm: the window manager (addModal); pointer: the last pointer event; notify(text): the header; start(op) once it
//   runs modally; step() after each event it handles while it runs; end(status) once it ends.
// Returns the invoke's status, and cancel() for a run still going.
export function runModal({ wm, view, pointer, target, idname, props, event, notify, start = () => {}, step = () => {}, end = () => {} }) {
  const toBlender = (e) => blenderEvent(view, e);
  const { status, op, keymap, report } = target.invoke(idname, props, toBlender(event ?? { ...pointer, type: 'mousemove', value: 'NOTHING' }));
  if (report) notify(report);
  if (!op) { end(status); return { status, cancel: () => {} }; }
  start(op);
  step();
  let remove = () => {}, running = true;
  const handle = (e) => {
    if (!running) return false;
    const item = keymap && modalItem(keymap, e, (id) => target.modalItem(op, id) >= 0);
    const result = target.modal(op, item ? { ...toBlender(e), modal: target.modalItem(op, item) } : toBlender(e));
    if (result & OPERATOR_RUNNING_MODAL) {
      step();
      notify(target.status);
    } else {
      running = false;
      remove();
      notify('');
      end(result);
    }
    tagRedraw();
    return !(result & OPERATOR_PASS_THROUGH);
  };
  const cancel = () => handle({ ...pointer, type: 'esc', value: 'PRESS' });
  remove = wm.addModal({ keymap: handle, mousemove: handle, passthrough: (e) => e.type === 'middlemouse' || e.type.startsWith('wheel'), cancel });
  // The window manager gives a modal operator the pointer's place at once (WM_event_add_mousemove).
  handle({ ...(event ?? pointer), type: 'mousemove', value: 'NOTHING' });
  return { status, cancel };
}
