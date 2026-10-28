// Lasso gestures (WM_gesture_lasso_* in wm_gesture_ops.cc) as a modal handler with Blender's Gesture Lasso modal map.
// The lasso begins at a drag's press and grows with the mouse; holding Space moves it. Releasing the button gives
// `select(path)` the lasso's points in client pixels; Esc or the right button cancels.
import { createKeymap } from './input/keymap.js';

export function startGestureLasso(wm, { begin, select }) {
  const path = [[begin.x, begin.y]];
  let moving = false, last = begin, removed = false;
  const svg = document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  svg.setAttribute('class', 'bl-select-lasso');
  const line = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'polygon'));
  const draw = () => line.setAttribute('points', path.map((p) => p.join(',')).join(' '));
  const end = () => { if (removed) return; removed = true; remove(); svg.remove(); };
  const modalMap = createKeymap([
    { blender: 'MOVE', keys: 'Any SPACE ANY', run: (event) => { moving = event.value === 'PRESS'; } },
  ], ['Gesture Lasso']);
  // The button release and cancel events wm_gesture_lasso_modal handles itself.
  const keymap = (event) => {
    if (modalMap(event)) return true;
    if (/mouse$/.test(event.type) && event.value === 'RELEASE' && event.type !== 'rightmouse') {
      end();
      if (path.length > 2) select(path);
    } else if (event.type === 'esc' || (event.type === 'rightmouse' && event.value === 'PRESS')) end();
    return true;
  };
  const mousemove = ({ x, y }) => {
    if (moving) path.forEach((p) => { p[0] += x - last.x; p[1] += y - last.y; });
    else path.push([x, y]);
    last = { x, y };
    draw();
  };
  const remove = wm.addModal({ keymap, mousemove });
  draw();
  return end;
}
