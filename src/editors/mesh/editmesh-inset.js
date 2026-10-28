import { createKeymap } from '../../windowmanager/input/keymap.js';

// The modal part of mesh.inset (editmesh_inset.cc): the mouse's distance to the selection's median point sets
// Thickness (Depth while Ctrl is held, finer with Shift); O toggles Outset, B Boundary.
const MODAL_PROPS = { thickness: 0, depth: 0, use_outset: false, use_boundary: true };

// `preview(props)` re-runs the inset from the original mesh; `confirm(props)` records it; `center` is the median
// point on screen and `pixel_size` the world size of a pixel there, divided by the object's largest scale. Blender
// hard-codes the keys in edbm_inset_modal, so they have no modal keymap names. `end()` removes the handler.
export function inset_modal({ props: initial, center, mouse, pixel_size, preview, confirm, cancel, notify, end, release_confirm = false }) {
  const props = { ...MODAL_PROPS, ...initial };
  const dist = (x, y) => Math.hypot(center.x - x, center.y - y);
  let initial_length = dist(mouse[0], mouse[1]), old = { thickness: 0, depth: 0 }, modify_depth = false, shift = false, shift_amount = 0;
  const header = () => notify(`Thickness: ${props.thickness.toFixed(4)}, Depth (Ctrl to tweak): ${props.depth.toFixed(4)}, Outset (O): ${props.use_outset ? 'On' : 'Off'}, Boundary (B): ${props.use_boundary ? 'On' : 'Off'}`);
  const run = () => { preview({ ...props }); header(); };
  const finish = (ok) => { end(); notify(''); (ok ? confirm : cancel)({ ...props }); };
  const toggle = (key) => { props[key] = !props[key]; run(); };
  run();
  return {
    mousemove(event) {
      if (event.ctrl !== modify_depth) {
        modify_depth = event.ctrl;
        old = { thickness: props.thickness, depth: props.depth };
        if (shift) shift_amount = modify_depth ? props.depth : props.thickness;
        initial_length = dist(event.x, event.y);
      }
      if (event.shift !== shift) { shift = event.shift; shift_amount = shift ? (modify_depth ? props.depth : props.thickness) : 0; }
      const delta = (dist(event.x, event.y) - initial_length) * pixel_size;
      let amount = modify_depth ? old.depth + delta : old.thickness - delta;
      if (shift) amount = (amount - shift_amount) * 0.1 + shift_amount;
      if (modify_depth) props.depth = amount;
      else props.thickness = Math.max(amount, 0);
      run();
    },
    keymap: createKeymap([
      // A tool's drag confirms on release (release_confirm).
      { keys: 'Any LEFTMOUSE RELEASE', poll: () => release_confirm, run: () => finish(true) },
      { keys: ['Any LEFTMOUSE', 'Any RET', 'Any NUMPAD_ENTER'], run: () => finish(true) },
      { keys: ['Any RIGHTMOUSE', 'Any ESC'], run: () => finish(false) },
      { keys: 'O', run: () => toggle('use_outset') },
      { keys: 'B', run: () => toggle('use_boundary') },
    ]),
    passthrough: (event) => event.type === 'middlemouse',
    cancel: () => finish(false),
  };
}
