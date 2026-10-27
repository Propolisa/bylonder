// mesh.bevel (editmesh_bevel.cc): its modal part, which previews through Blender's own exec (editmesh-tools.js).
import { createKeymap } from '../../windowmanager/input/keymap.js';

// The modal part of mesh.bevel (edbm_bevel_modal): the mouse's distance to the selection's median point sets the value
// being edited (A offset, P profile, S segments), finer with Shift; the wheel steps segments.
const MVAL_PIXEL_MARGIN = 5;
const PIXELS_PER_INCH = 72;
const VALUES = {
  offset: { start: 0, min: 0, max: 1e6 },
  offset_pct: { start: 0, min: 0, max: 100, per_inch: 100 },
  profile: { start: 0.5, min: 0, max: 1, per_inch: 1 },
  segments: { start: 1, min: 1, max: 1000, per_inch: 4 },
};
const OFFSET_TYPES = ['OFFSET', 'WIDTH', 'DEPTH', 'PERCENT'];
const MITERS = ['SHARP', 'PATCH', 'ARC'];
const next = (list, value) => list[(list.indexOf(value) + 1) % list.length];

// `preview(props)` re-runs the bevel from the original mesh; `confirm(props)` records it; `center` is the median point
// on screen and `pixel_size` the world size of a pixel there, divided by the object's largest scale.
export function bevel_modal({ props: initial, center, mouse, pixel_size, preview, confirm, cancel, notify, end }) {
  const props = { offset_type: 'OFFSET', offset: 0, offset_pct: 0, segments: 1, profile: 0.5, affect: 'EDGES', clamp_overlap: false,
    harden_normals: false, mark_seam: false, mark_sharp: false, miter_outer: 'SHARP', miter_inner: 'SHARP', profile_type: 'SUPERELLIPSE',
    vmesh_method: 'ADJ', ...initial };
  const scale = (mode) => (mode === 'offset' ? pixel_size : VALUES[mode].per_inch / PIXELS_PER_INCH);
  const dist = (x, y) => Math.hypot(center.x - x, center.y - y);
  let mode = 'offset', segments = props.segments, precision = false, shift_value = -1, last = mouse;
  const initial_length = {};
  // edbm_bevel_calc_initial_length: a value already away from its start keeps its place under the mouse.
  const calc_initial_length = (changed) => {
    let len = dist(last[0], last[1]);
    const value = mode === 'segments' ? segments : props[mode];
    if ((changed || initial_length[mode] === undefined) && value !== VALUES[mode].start) {
      len = (VALUES[mode].start + scale(mode) * (len - MVAL_PIXEL_MARGIN) - value) / scale(mode);
    }
    initial_length[mode] = len;
  };
  const header = () => notify(`${props.offset_type === 'PERCENT' ? 'Percent' : props.offset_type[0] + props.offset_type.slice(1).toLowerCase()}: ${props.offset_type === 'PERCENT' ? props.offset_pct.toFixed(1) + '%' : props.offset.toFixed(4)}, Segments: ${props.segments}, Profile Shape: ${props.profile.toFixed(3)}`);
  const run = () => { preview({ ...props }); header(); };
  const finish = (ok) => { end(); notify(''); (ok ? confirm : cancel)({ ...props }); };
  const setMode = (m) => { mode = m; calc_initial_length(true); };
  const toggle = (key) => { props[key] = !props[key]; run(); };
  const step = (d) => { segments = Math.max(segments + d, 1); props.segments = segments; run(); };
  calc_initial_length(false);
  run();
  return {
    // edbm_bevel_mouse_set_value
    mousemove(event) {
      last = [event.x, event.y];
      const { start, min, max } = VALUES[mode];
      let value = start + (dist(event.x, event.y) - MVAL_PIXEL_MARGIN - initial_length[mode]) * scale(mode);
      if (precision) {
        if (shift_value < 0) shift_value = mode === 'segments' ? segments : props[mode];
        value = (value - shift_value) * 0.1 + shift_value;
      } else shift_value = -1;
      value = Math.min(Math.max(value, min), max);
      if (mode === 'segments') { segments = value; props.segments = Math.trunc(value + 0.5); }
      else props[mode] = value;
      run();
    },
    keymap: createKeymap([
      { blender: 'CONFIRM', keys: ['Any LEFTMOUSE', 'Any RET', 'Any NUMPAD_ENTER'], run: () => finish(true) },
      { blender: 'CANCEL', keys: ['Any RIGHTMOUSE', 'Any ESC'], run: () => finish(false) },
      { blender: 'VALUE_OFFSET', keys: 'Any A', run: () => setMode(props.offset_type === 'PERCENT' ? 'offset_pct' : 'offset') },
      { blender: 'VALUE_PROFILE', keys: 'Any P', run: () => setMode('profile') },
      { blender: 'VALUE_SEGMENTS', keys: 'Any S', run: () => setMode('segments') },
      { blender: 'SEGMENTS_UP', keys: ['Any WHEELUPMOUSE', 'Any NUMPAD_PLUS'], run: () => step(1) },
      { blender: 'SEGMENTS_DOWN', keys: ['Any WHEELDOWNMOUSE', 'Any NUMPAD_MINUS'], run: () => step(-1) },
      { blender: 'OFFSET_MODE_CHANGE', keys: 'Any M', run: () => {
        props.offset_type = next(OFFSET_TYPES, props.offset_type);
        if (mode === 'offset' && props.offset_type === 'PERCENT') setMode('offset_pct');
        else if (mode === 'offset_pct' && props.offset_type !== 'PERCENT') setMode('offset');
        run();
      } },
      { blender: 'CLAMP_OVERLAP_TOGGLE', keys: 'Any C', run: () => toggle('clamp_overlap') },
      { blender: 'AFFECT_CHANGE', keys: 'Any V', run: () => { props.affect = props.affect === 'EDGES' ? 'VERTICES' : 'EDGES'; run(); } },
      { blender: 'HARDEN_NORMALS_TOGGLE', keys: 'Any H', run: () => toggle('harden_normals') },
      { blender: 'MARK_SEAM_TOGGLE', keys: 'Any U', run: () => toggle('mark_seam') },
      { blender: 'MARK_SHARP_TOGGLE', keys: 'Any K', run: () => toggle('mark_sharp') },
      { blender: 'OUTER_MITER_CHANGE', keys: 'Any O', run: () => { props.miter_outer = next(MITERS, props.miter_outer); run(); } },
      { blender: 'INNER_MITER_CHANGE', keys: 'Any I', run: () => { props.miter_inner = next(['SHARP', 'ARC'], props.miter_inner); run(); } },
      { blender: 'VERTEX_MESH_CHANGE', keys: 'Any N', run: () => { props.vmesh_method = props.vmesh_method === 'ADJ' ? 'CUTOFF' : 'ADJ'; run(); } },
      { blender: 'PRECISION_ON', keys: ['Any LEFT_SHIFT', 'Any RIGHT_SHIFT'], run: () => { precision = true; } },
      { blender: 'PRECISION_OFF', keys: ['Any LEFT_SHIFT RELEASE', 'Any RIGHT_SHIFT RELEASE'], run: () => { precision = false; } },
    ], ['Bevel Modal Map']),
    passthrough: (event) => event.type === 'middlemouse',
    cancel: () => finish(false),
  };
}
