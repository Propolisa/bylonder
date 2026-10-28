// Circle gestures (WM_gesture_circle_* in wm_gesture_ops.cc) as a modal handler with Blender's View3D Gesture Circle
// modal map. The circle follows the mouse and selects while a button is held: `select(center, radius, mode, first)`
// with 'SET', 'ADD' or 'SUB', `first` for the gesture's first application. Without wait_for_input (a tool's press) it
// selects at once and ends on release; otherwise (C) it waits for presses until Esc, the right button or Return.
import { createKeymap } from './input/keymap.js';

export function startGestureCircle(wm, { at, radius = 25, waitForInput = true, mode = 'SET', select, done = () => {} }) {
  let center = [at.x, at.y], state = waitForInput ? null : mode === 'SUB' ? 'SUB' : mode, first = true, removed = false;
  const circle = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'bl-select-circle' }));
  const draw = () => Object.assign(circle.style, { left: center[0] - radius + 'px', top: center[1] - radius + 'px', width: 2 * radius + 'px', height: 2 * radius + 'px' });
  const apply = () => {
    if (!state) return;
    select(center, radius, first ? state : state === 'SET' ? 'ADD' : state, first);
    first = false;
  };
  const end = () => { if (removed) return; removed = true; remove(); circle.remove(); done(radius); };
  // Waiting for input, a press selects or deselects (gesture_circle_apply sets ADD or SUB).
  const begin = (selecting) => () => { state = selecting ? 'ADD' : 'SUB'; apply(); };
  // gesture_circle_modal's radius steps.
  const resize = (sign) => () => { radius = Math.max(1, radius + sign * (2 + radius / 10)); draw(); apply(); };
  const keymap = createKeymap([
    { blender: 'CANCEL', keys: ['Any ESC', 'Any RIGHTMOUSE ANY'], run: end },
    { blender: 'CONFIRM', keys: ['Any RET', 'Any NUMPAD_ENTER'], run: end },
    { blender: 'DESELECT', keys: ['Shift LEFTMOUSE', 'MIDDLEMOUSE'], run: begin(false) },
    { blender: 'SELECT', keys: 'LEFTMOUSE', run: begin(true) },
    { blender: 'NOP', keys: ['Any LEFTMOUSE RELEASE', 'Any MIDDLEMOUSE RELEASE'], run: () => { state = null; if (!waitForInput) end(); } },
    { blender: 'SUBTRACT', keys: ['WHEELUPMOUSE', 'NUMPAD_MINUS'], run: resize(-1) },
    { blender: 'ADD', keys: ['WHEELDOWNMOUSE', 'NUMPAD_PLUS'], run: resize(1) },
  ], ['View3D Gesture Circle']);
  const remove = wm.addModal({ keymap, mousemove: ({ x, y }) => { center = [x, y]; draw(); apply(); } });
  draw();
  apply();
  return end;
}
