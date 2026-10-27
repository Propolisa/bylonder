// The modal transform (transform.cc, transform_constraints.cc, transform_mode_translate.cc, transform_mode_rotate.cc,
// transform_mode_resize.cc) in Blender world space (Z up). X, Y and Z constrain to an axis and pressed again cycle the
// orientation (Global, then Local, then off), typed values replace the mouse (numinput.cc), Ctrl snaps to
// increments, Shift snaps finer, and the header reads as Blender's.
import { Vector3 } from '@babylonjs/core';
import { add_v3, sub_v3, mul_v3_fl, dot_v3, cross_v3, len_v3, normalize_v3, is_zero_v3, project_v3_v3v3, angle_v3v3, isect_ray_plane_v3_factor, isect_ray_ray_v3 } from '../../blenlib/math-geom.js';
import { unit_m3, mul_m3_v3, mul_m3_m3m3, transpose_m3, size_to_mat3 } from '../../blenlib/math-matrix.js';
import { axis_angle_normalized_to_mat3 } from '../../blenlib/math-rotation.js';
import { initNumInput, hasNumInput, applyNumInput, outputNumInput, handleNumInput, NUM_AFFECT_ALL, NUM_NULL_ONE } from '../util/numinput.js';
import { formatLength } from '../../blenkernel/unit.js';

// Babylon's world is Y up; Blender's is Z up.
export const toBlender = (v) => [v.x, v.z, v.y];
// A Babylon matrix in Blender's axes, column-major as Blender stores it (Babylon's row vectors give the same layout).
export const toBlenderMatrix = (m) => Array.from({ length: 16 }, (_, i) => m.m[[0, 2, 1, 3][i >> 2] * 4 + [0, 2, 1, 3][i & 3]]);
export const toBabylon = ([x, y, z]) => new Vector3(x, z, y);
// A Babylon camera's view matrix as Blender's RegionView3D.viewmat: Blender's axes in, and a right-handed view that
// looks along -Z out.
export const toBlenderView = (m) => Array.from({ length: 16 }, (_, i) => ((i & 3) === 2 ? -1 : 1) * m.m[[0, 2, 1, 3][i >> 2] * 4 + (i & 3)]);

const CON_AXIS0 = 1, CON_AXIS1 = 2, CON_AXIS2 = 4;
const O_DEFAULT = 0, O_SCENE = 1, O_SET = 2;
const DEG = Math.PI / 180;
// Per mode: the modal default orientation (transform_mode_default_modal_orientation_set), numinput units, and the
// increment with its precision factor (snap_spatial for a perspective view, snap_angle_increment_3d, 0.1 for scale).
const MODES = {
  translate: { label: 'Move', orient: 'GLOBAL', idx_max: 2, unit_type: 'LENGTH', increment: 1, precision: 0.1 },
  rotate: { label: 'Rotate', orient: 'VIEW', idx_max: 0, unit_type: 'ROTATION', increment: 5 * DEG, precision: 0.2 },
  resize: { label: 'Scale', orient: 'GLOBAL', idx_max: 2, unit_type: 'NONE', increment: 0.1, precision: 0.1 },
};
const CONSTRAINTS = {
  AXIS_X: [CON_AXIS0, 'along %s X'], AXIS_Y: [CON_AXIS1, 'along %s Y'], AXIS_Z: [CON_AXIS2, 'along %s Z'],
  PLANE_X: [CON_AXIS1 | CON_AXIS2, 'locking %s X'], PLANE_Y: [CON_AXIS0 | CON_AXIS2, 'locking %s Y'], PLANE_Z: [CON_AXIS0 | CON_AXIS1, 'locking %s Z'],
};
const AXES = [CON_AXIS0, CON_AXIS1, CON_AXIS2];
const dims = (mode) => AXES.filter((a) => mode & a).length;
// roundf: halves away from zero.
const roundf = (v) => Math.sign(v) * Math.round(Math.abs(v));
// BLI_string_pad_number_sign: a figure space where a minus would go.
const padSign = (s) => (s.startsWith('-') ? s : ' ' + s);

// ED_view3d_pixel_size: the world size of one screen pixel at a Babylon world `point`.
export function view3d_pixel_size({ camera, canvas }, point) {
  const forward = camera.getDirection(Vector3.Forward());
  const depth = camera.mode === 1 ? (camera.orthoTop - camera.orthoBottom) / 2 : Math.max(0.1, Vector3.Dot(point.subtract(camera.globalPosition), forward));
  return (2 * depth * (camera.mode === 1 ? 1 : Math.tan(camera.fov / 2))) / canvas.clientHeight;
}

// createSpaceNormal: Z along the normal, X level with the ground where it can be.
export function createSpaceNormal(normal) {
  const z = normalize_v3(normal);
  let x = cross_v3(z, [0, 0, 1]);
  if (is_zero_v3(x)) x = cross_v3([1, 0, 0], z);
  x = normalize_v3(x);
  return [x, normalize_v3(cross_v3(z, x)), z];
}

// `data` is what moves, in Blender world space: { center, local (the active object's axes), apply(mat, center,
// translation) setting each point to center + mat (point - center) + translation, restore() }. `view` is
// { camera, canvas, project(babylon world) -> client pixels }; `mouse` the client point it starts from. `orient`
// { type, matrix, axis } starts constrained to an axis of a set orientation, as extrude does along the normal.
export function initTransform(mode, data, view, mouse, { orient } = {}) {
  const { camera } = view, center = data.center;
  const viewinv = {
    right: toBlender(camera.getDirection(Vector3.Right())), up: toBlender(camera.getDirection(Vector3.Up())),
    back: toBlender(camera.getDirection(Vector3.Forward()).negate()), position: toBlender(camera.globalPosition), ortho: camera.mode === 1,
  };
  const orientations = { GLOBAL: unit_m3(), LOCAL: data.local, VIEW: [viewinv.right, viewinv.up, viewinv.back], NORMAL: orient?.matrix };
  const slots = [MODES[mode].orient, 'GLOBAL', orient?.type ?? 'LOCAL'];
  const center2d = view.project(toBabylon(center));
  const pixelSize = view3d_pixel_size(view, toBabylon(center));
  const near = Math.hypot(mouse.x - center2d.x, mouse.y - center2d.y) < 12;
  // Starting away from the center keeps rotate and scale well defined.
  const imval = near ? { x: center2d.x + 60, y: center2d.y } : { ...mouse };
  const t = { mode, mval: { ...imval }, mval_prev: { ...imval }, angle: 0, orient_curr: O_DEFAULT, con: { mode: 0, text: '' }, num: initNumInput(), snap: false, precision: false, header: '' };
  const spacemtx = () => orientations[slots[t.orient_curr]];
  const idx_max = () => MODES[t.mode].idx_max;

  function initMode(newMode) {
    t.mode = newMode;
    const { idx_max, unit_type } = MODES[newMode];
    t.num.idx_max = idx_max;
    t.num.unit_type = [unit_type, unit_type, unit_type];
    if (newMode === 'translate') t.num.flag = 0;
    if (newMode === 'resize') {
      t.num.flag |= NUM_AFFECT_ALL;
      for (let i = 0; i < 3; i++) t.num.val_flag[i] |= NUM_NULL_ONE;
    }
    if (t.con.mode) startConstraint();
    t.mval_prev = { ...imval };
    t.angle = 0;
  }

  const view_vector_calc = (focus) => normalize_v3(viewinv.ortho ? viewinv.back : sub_v3(viewinv.position, focus));

  // Projects the mouse vector onto a constraint axis through the center, as seen from the view (axisProjection).
  function axisProjection(axis, input) {
    let c = center;
    const toCenter = sub_v3(c, viewinv.position);
    const depth = project_v3_v3v3(dot_v3(toCenter, viewinv.back) < 0 ? mul_v3_fl(toCenter, -1) : toCenter, viewinv.back);
    if (len_v3(depth) < 1) c = sub_v3(c, mul_v3_fl(viewinv.back, 1 - len_v3(depth)));
    let angle = Math.abs(angle_v3v3(axis, viewinv.back));
    if (angle > Math.PI / 2) angle = Math.PI - angle;
    // An axis pointing at the view takes the vertical mouse motion.
    if (angle < 5 * DEG) {
      let factor = dot_v3(viewinv.up, project_v3_v3v3(input, viewinv.up)) * 2;
      factor *= factor < 0 ? -factor : factor;
      return mul_v3_fl(normalize_v3(axis), -factor);
    }
    const plane = cross_v3(view_vector_calc(c), axis);
    const v = add_v3(sub_v3(input, project_v3_v3v3(input, plane)), c);
    const norm = view_vector_calc(v), factor = dot_v3(axis, norm);
    if (1 - Math.abs(factor) < 0.0002) return mul_v3_fl(axis, factor > 0 ? 1e9 : -1e9);
    const out = mul_v3_fl(axis, isect_ray_ray_v3(c, axis, v, norm) ?? 0);
    return out.map((x) => (Number.isFinite(x) ? x : 0));
  }

  // transform_constraint_get_nearest: the mouse vector on the constraint axis or plane.
  function constraintNearest(vec) {
    const s = spacemtx(), local = mul_m3_v3(transpose_m3(s), vec);
    let out = mul_m3_v3(s, local.map((x, i) => (t.con.mode & AXES[i] ? x : 0)));
    if (dims(t.con.mode) === 2) {
      if (is_zero_v3(out)) return out;
      const plane_no = s[AXES.findIndex((a) => !(t.con.mode & a))];
      if (Math.abs(dot_v3(plane_no, view_vector_calc(center))) < 0.001) return out;
      const pos = add_v3(vec, center), view_vec = view_vector_calc(pos);
      const factor = isect_ray_plane_v3_factor(pos, view_vec, center, plane_no);
      return factor === null ? out : add_v3(vec, mul_v3_fl(view_vec, factor));
    }
    return is_zero_v3(vec) ? out : axisProjection(s[AXES.findIndex((a) => t.con.mode & a)], vec);
  }

  // constraintNumInput: typed values go to the constrained axes in order.
  function constraintNumInput(vec) {
    if (!t.con.mode) return vec;
    const nval = t.mode === 'resize' ? 1 : 0, axes = AXES.filter((a) => t.con.mode & a);
    const typed = vec.slice(0, axes.length);
    return AXES.map((a) => (axes.includes(a) ? typed[axes.indexOf(a)] : nval));
  }

  const snapIncrement = (values) => {
    const { increment, precision } = MODES[t.mode], step = t.precision ? increment * precision : increment;
    return values.map((v) => step * roundf(v / step));
  };
  const lengthText = (value) => formatLength(value, t.precision ? 6 : 4);

  function applyTranslation() {
    const typed = [0, 0, 0];
    let dir;
    // Blender 5.2 moves a constrained typed value along the first constrained axis only.
    if (applyNumInput(t.num, typed)) dir = t.con.mode ? mul_v3_fl(spacemtx()[AXES.findIndex((a) => t.con.mode & a)], typed[0]) : mul_m3_v3(spacemtx(), typed);
    else {
      const d = { x: t.mval.x - imval.x, y: imval.y - t.mval.y };
      dir = add_v3(mul_v3_fl(viewinv.right, d.x * pixelSize), mul_v3_fl(viewinv.up, d.y * pixelSize));
      if (t.con.mode) dir = constraintNearest(dir);
      if (t.snap) dir = t.con.mode ? mul_m3_v3(spacemtx(), snapIncrement(mul_m3_v3(transpose_m3(spacemtx()), dir))) : snapIncrement(dir);
    }
    const values_final = mul_m3_v3(transpose_m3(spacemtx()), dir);
    data.apply(unit_m3(), center, dir, t.mode);
    return headerTranslation(t.con.mode ? values_final : dir);
  }

  function headerTranslation(vec) {
    let text, dist;
    if (hasNumInput(t.num)) {
      text = outputNumInput(t.num);
      dist = len_v3(t.num.val);
    } else {
      const dvec = t.con.mode ? [...AXES.filter((a) => t.con.mode & a).map((a) => vec[AXES.indexOf(a)]), 0, 0, 0].slice(0, 3) : vec;
      dist = len_v3(dvec);
      text = dvec.map((v) => padSign(lengthText(v)));
    }
    const tail = ` (${lengthText(dist)})${t.con.text}`;
    if (!t.con.mode) return `Dx: ${text[0]}   Dy: ${text[1]}   Dz: ${text[2]}${tail}`;
    return text.slice(0, t.num.idx_max + 1).map((s) => `D: ${s}`).join('   ') + tail;
  }

  function applyRotation() {
    const s = spacemtx();
    const axis = t.con.mode ? s[[CON_AXIS0, CON_AXIS1 | CON_AXIS2].includes(t.con.mode) ? 0 : [CON_AXIS1, CON_AXIS0 | CON_AXIS2].includes(t.con.mode) ? 1 : 2] : mul_v3_fl(s[2], -1);
    const typed = [0];
    let final;
    if (applyNumInput(t.num, typed)) final = typed[0];
    else {
      final = dot_v3(axis, view_vector_calc(center)) > 0 ? -t.angle : t.angle;
      if (t.snap) [final] = snapIncrement([final]);
    }
    data.apply(axis_angle_normalized_to_mat3(normalize_v3(axis), final), center, [0, 0, 0], t.mode);
    return hasNumInput(t.num) ? `Rotation: ${outputNumInput(t.num)[0]} ${t.con.text} ` : `Rotation: ${(final / DEG).toFixed(2)}${t.con.text} `;
  }

  function applyResize() {
    // INPUT_SPRING_FLIP: the distance to the center against the starting one, negative past the center.
    const dx = center2d.x - t.mval.x, dy = center2d.y - t.mval.y, ix = center2d.x - imval.x, iy = center2d.y - imval.y;
    const ratio = (Math.hypot(dx, dy) / Math.hypot(ix, iy)) * (dx * ix + dy * iy < 0 ? -1 : 1);
    let values = [ratio, ratio, ratio];
    if (t.snap) values = snapIncrement(values);
    if (applyNumInput(t.num, values)) values = constraintNumInput(values);
    let mat = size_to_mat3(values), shown = values;
    if (t.con.mode) {
      shown = AXES.filter((a) => t.con.mode & a).map((a) => values[AXES.indexOf(a)]);
      mat = size_to_mat3(values.map((v, i) => (t.con.mode & AXES[i] ? v : 1)));
      mat = mul_m3_m3m3(spacemtx(), mul_m3_m3m3(mat, transpose_m3(spacemtx())));
    }
    data.apply(mat, center, [0, 0, 0], t.mode);
    const text = hasNumInput(t.num) ? outputNumInput(t.num) : shown.map((v) => v.toFixed(4));
    if (t.con.mode) return `Scale: ${text.slice(0, t.num.idx_max + 1).join(' : ')}${t.con.text} `;
    return `Scale X: ${text[0]}   Y: ${text[1]}  Z: ${text[2]}${t.con.text} `;
  }

  function recalc() {
    t.header = { translate: applyTranslation, rotate: applyRotation, resize: applyResize }[t.mode]();
  }

  function startConstraint() {
    t.num.idx_max = Math.min(dims(t.con.mode) - 1, idx_max());
  }
  function stopConstraint() {
    t.orient_curr = O_DEFAULT;
    t.con = { mode: 0, text: '' };
    t.num.idx_max = idx_max();
  }
  function setUserConstraint(mode, message) {
    t.con = { mode, text: ' ' + message.replace('%s', slots[t.orient_curr].toLowerCase()) };
    startConstraint();
  }

  // transform_event_modal_constraint: the same axis again moves to the next orientation, then turns it off.
  function constrain(item) {
    const [constraint_new, message] = CONSTRAINTS[item];
    const constraint_curr = t.con.mode || -1;
    const orient_index = t.orient_curr === O_DEFAULT || constraint_curr === -1 || constraint_curr === constraint_new ? (t.orient_curr + 1) % 3 : O_SCENE;
    t.orient_curr = orient_index;
    if (orient_index === O_DEFAULT) stopConstraint();
    else setUserConstraint(constraint_new, message);
    recalc();
  }

  initMode(mode);
  if (orient) {
    t.orient_curr = O_SET;
    setUserConstraint(CONSTRAINTS['AXIS_' + orient.axis][0], '%s');
  }

  return {
    get label() { return MODES[t.mode].label; },
    get mode() { return t.mode; },
    get header() { return t.header; },
    get constrained() { return !!t.con.mode; },
    start: imval,
    center: center2d,
    // The mouse moved by dx, dy client pixels (already scaled for precision).
    update(dx, dy, event) {
      t.mval_prev = { ...t.mval };
      t.mval.x += dx;
      t.mval.y += dy;
      t.angle += angleDelta(t.mval_prev, t.mval, center2d);
      t.snap = !!event.ctrlKey;
      t.precision = !!event.shiftKey;
      recalc();
    },
    constrain,
    // CONS_OFF.
    unconstrain() { stopConstraint(); recalc(); },
    // SNAP_INV_ON and SNAP_INV_OFF.
    setSnap(snap) { t.snap = snap; recalc(); },
    // TRANSLATE, ROTATE and RESIZE: start over in another mode, keeping the constraint and typed values.
    setMode(newMode) {
      data.restore();
      if (newMode === 'resize' && t.con.mode && slots[t.orient_curr] === 'NORMAL') stopConstraint();
      initMode(newMode);
      t.angle = angleDelta(imval, t.mval, center2d);
      recalc();
    },
    // handleNumInput, for key presses only. `active`: only while values are typed, as transformEvent asks first.
    numinput(event, active = false) {
      if (event.value !== 'PRESS' || (active && !hasNumInput(t.num))) return false;
      if (!handleNumInput(t.num, event)) return false;
      recalc();
      return true;
    },
    cancel() { data.restore(); },
  };
}

// The signed angle in screen pixels from `previous` to `current` about `center`; clockwise is positive (InputAngle).
function angleDelta(previous, current, center) {
  const a = { x: previous.x - center.x, y: previous.y - center.y }, b = { x: current.x - center.x, y: current.y - center.y };
  if (!Math.hypot(a.x, a.y) || !Math.hypot(b.x, b.y)) return 0;
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}
