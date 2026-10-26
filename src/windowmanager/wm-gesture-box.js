// Box gestures (WM_gesture_box_* in wm_gesture_ops.cc) as a modal handler with Blender's Gesture Box modal map.
// From a drag the box has begun at the press; from B it begins on the next press. `select(rect, mode)` gets the
// box in client pixels { xmin, xmax, ymin, ymax } and 'SET', 'ADD' or 'SUB'.
import { createKeymap } from './input/keymap.js';

export function startGestureBox(wm, { begin = null, mode = 'SET', select }) {
  let start = begin, current = begin, removed = false;
  const box = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'bl-select-box', hidden: !begin }));
  const rect = () => ({ xmin: Math.min(start.x, current.x), xmax: Math.max(start.x, current.x), ymin: Math.min(start.y, current.y), ymax: Math.max(start.y, current.y) });
  const draw = () => {
    if (!start) return;
    const r = rect();
    Object.assign(box.style, { left: r.xmin + 'px', top: r.ymin + 'px', width: r.xmax - r.xmin + 'px', height: r.ymax - r.ymin + 'px' });
    box.hidden = false;
  };
  const end = () => { if (removed) return; removed = true; remove(); box.remove(); };
  const finish = (m) => { if (!start) return; end(); select(rect(), m); };
  const beginAt = (event) => { start = current = { x: event.x, y: event.y }; draw(); };
  const begun = () => !!start;
  const keymap = createKeymap([
    { blender: 'CANCEL', keys: ['Any ESC', 'Any RIGHTMOUSE'], run: end },
    { blender: 'BEGIN', keys: 'Shift LEFTMOUSE', poll: () => !begun(), run: (event) => { mode = 'ADD'; beginAt(event); } },
    { blender: 'DESELECT', keys: 'Shift LEFTMOUSE RELEASE', poll: () => mode !== 'SET', run: () => finish(mode === 'ADD' ? 'ADD' : 'SUB') },
    { blender: 'BEGIN', keys: 'LEFTMOUSE', poll: () => !begun(), run: beginAt },
    { blender: 'SELECT', keys: 'Any LEFTMOUSE RELEASE', run: () => finish(mode) },
    { blender: 'BEGIN', keys: 'MIDDLEMOUSE', poll: () => !begun(), run: (event) => { mode = 'SUB'; beginAt(event); } },
    { blender: 'DESELECT', keys: 'MIDDLEMOUSE RELEASE', run: () => finish('SUB') },
  ], ['Gesture Box']);
  const remove = wm.addModal({ keymap, mousemove: (event) => { if (start) { current = { x: event.x, y: event.y }; draw(); } } });
  draw();
  return end;
}
