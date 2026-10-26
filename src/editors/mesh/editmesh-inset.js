// The modal part of mesh.inset (editmesh_inset.cc): the mouse's distance to the selection's median point sets
// Thickness (Depth while Ctrl is held, finer with Shift); O toggles Outset, B Boundary.
const MODAL_PROPS = { thickness: 0, depth: 0, use_outset: false, use_boundary: true };

// `preview(props)` re-runs the inset from the original mesh; `confirm(props)` records it; `center` is the median
// point on screen and `pixel_size` the world size of a pixel there, divided by the object's largest scale.
export function inset_modal({ center, mouse, pixel_size, preview, confirm, cancel, notify }) {
  const props = { ...MODAL_PROPS };
  const dist = (m) => Math.hypot(center.x - m[0], center.y - m[1]);
  let initial_length = dist(mouse), old = { thickness: 0, depth: 0 }, modify_depth = false, shift = false, shift_amount = 0;
  const header = () => notify(`Thickness: ${props.thickness.toFixed(4)}, Depth (Ctrl to tweak): ${props.depth.toFixed(4)}, Outset (O): ${props.use_outset ? 'On' : 'Off'}, Boundary (B): ${props.use_boundary ? 'On' : 'Off'}`);
  const run = () => { preview({ ...props }); header(); };
  run();
  return {
    move(view, m, e) {
      if (e.ctrlKey !== modify_depth) {
        modify_depth = e.ctrlKey;
        old = { thickness: props.thickness, depth: props.depth };
        if (shift) shift_amount = modify_depth ? props.depth : props.thickness;
        initial_length = dist(m);
      }
      if (e.shiftKey !== shift) { shift = e.shiftKey; shift_amount = shift ? (modify_depth ? props.depth : props.thickness) : 0; }
      const delta = (dist(m) - initial_length) * pixel_size;
      let amount = modify_depth ? old.depth + delta : old.thickness - delta;
      if (shift) amount = (amount - shift_amount) * 0.1 + shift_amount;
      if (modify_depth) props.depth = amount;
      else props.thickness = Math.max(amount, 0);
      run();
    },
    wheel() {},
    key(e) {
      const k = e.key.toLowerCase();
      if (k === 'o') props.use_outset = !props.use_outset;
      else if (k === 'b') props.use_boundary = !props.use_boundary;
      else if (k === 'enter') return this.finish();
      else if (k === 'escape') { cancel(); return 'cancelled'; }
      else return null;
      run();
      return 'running';
    },
    finish() { confirm({ ...props }); return 'finished'; },
    cancel,
    dispose() {},
  };
}
