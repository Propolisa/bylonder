// The Measure tool (view3d_gizmo_ruler.cc): VIEW3D_GGT_ruler's ruler items, each a line between two points or an angle
// at a third; view3d.ruler_add drags out a new one and view3d.ruler_remove deletes the active one. Dragging an end
// moves it (Ctrl snaps to geometry, Shift measures the thickness under it, X, Y and Z constrain), dragging the line
// adds the angle's vertex. Rulers are kept as strokes of the annotations' ruler layer (view3d_ruler_to_gpencil).
import { add_v3, sub_v3, mul_v3_fl, len_v3, normalize_v3, cross_v3, angle_normalized_v3v3, angle_v3v3v3, line_point_factor_v2, dist_squared_to_line_segment_v2, interp_v3 } from '../../blenlib/math-geom.js';
import { mul_m3_v3, transpose_m3 } from '../../blenlib/math-matrix.js';
import { axis_angle_normalized_to_mat3 } from '../../blenlib/math-rotation.js';
import { modalItem } from '../../windowmanager/keyconfig.js';
import { registerGizmoGroupType } from '../../windowmanager/wm-gizmo-map.js';
import { dragStart } from '../../windowmanager/wm-event-system.js';
import { snap_object_project_view3d, SCE_SNAP_TO_FACE } from '../transform/transform-snap-object.js';
import { formatLength, formatAngle } from '../../blenkernel/unit.js';
import { css, THEME } from '../../draw/overlay-tool.js';

const RULERITEM_USE_ANGLE = 1 << 0, RULERITEM_USE_ANGLE_ACTIVE = 1 << 1;
const RULER_PICK_DIST_SQ = 12 * 12;
const PART_LINE = 0xff;
const CONSTRAIN_MODE_OFF = 0, CONSTRAIN_MODE_2 = 2;
const EPS_BIAS = 0.0002;
const CAP_SIZE = 4, BG_MARGIN = 4, ARC_SIZE = 64, ARC_STEPS = 24;
const MONO = '14px "DejaVu Sans Mono", ui-monospace, monospace';

// `world` gives the annotations, `view(event)` the 3D View projection of an event's view, `sources()` the geometry to
// snap to, `wm` the window manager for the modal tweak, `commit()` an undo step, `orientation(mode)` the constraint
// orientation (1: the scene's, 2: the other of Global and Local).
export function createRuler({ world, region, sources, wm, commit, orientation, active: toolActive }) {
  let items = null, item_active = null;
  const annotations = () => world.annotations;
  // view3d_ruler_from_gpencil: the items of the ruler layer's frame.
  const loaded = () => {
    if (items) return items;
    const layer = annotations().rulerLayer(), frame = layer && annotations().frameGet(layer);
    items = (frame?.strokes ?? []).map(({ points }) => (points.length === 3
      ? { co: points.map((p) => [...p]), flag: RULERITEM_USE_ANGLE }
      : { co: [[...points[0]], interp_v3(points[0], points[1], 0.5), [...points[1]]], flag: 0 }));
    return items;
  };
  annotations().subscribe(() => { items = null; item_active = null; });
  // view3d_ruler_to_gpencil, as an undo step.
  const store = () => {
    const layer = annotations().rulerLayer(true), frame = annotations().frameGet(layer, undefined, 'ADD_NEW');
    frame.strokes = loaded().map(({ co, flag }) => ({ points: (flag & RULERITEM_USE_ANGLE ? co : [co[0], co[2]]).map((p) => [...p]), thickness: 3 }));
    const kept = items;
    annotations().changed();
    items = kept;
    commit();
  };

  // view3d_ruler_pick: the part of an item under the mouse, an end or the angle vertex (0 to 2), or its line.
  function pick(r, item, mval) {
    const co_ss = item.co.map((co) => r.project(co) ?? [Infinity, Infinity]);
    const angle = item.flag & RULERITEM_USE_ANGLE;
    const dist = angle ? Math.min(dist_squared_to_line_segment_v2(mval, co_ss[0], co_ss[1]), dist_squared_to_line_segment_v2(mval, co_ss[1], co_ss[2]))
      : dist_squared_to_line_segment_v2(mval, co_ss[0], co_ss[2]);
    if (!(dist < RULER_PICK_DIST_SQ)) return null;
    const near = (angle ? [0, 1, 2] : [0, 2]).map((j) => [j, (co_ss[j][0] - mval[0]) ** 2 + (co_ss[j][1] - mval[1]) ** 2]);
    const [j, d] = near.reduce((a, b) => (b[1] < a[1] ? b : a));
    if (d < RULER_PICK_DIST_SQ) return j;
    return angle ? null : PART_LINE;
  }

  // view3d_ruler_item_mousemove: the dragged point under the mouse at its starting depth, on the geometry when
  // snapping, or (do_thickness) on the surface under it with the other end through the geometry behind.
  function mousemove(r, item, inter, mval, { do_thickness, do_snap, constrain }) {
    const index = inter.co_index;
    let co = r.win_to_3d(inter.drag_start_co, mval);
    if (do_thickness && index !== 1) {
      const hit = snap_object_project_view3d(r, mval, sources, { elements: SCE_SNAP_TO_FACE });
      if (hit) {
        co = hit.co;
        const other = r.ray_cast(add_v3(co, mul_v3_fl(hit.no, -EPS_BIAS)), mul_v3_fl(hit.no, -1));
        if (other) item.co[index === 0 ? 2 : 0] = other;
      }
    } else {
      if (do_snap) co = snap_object_project_view3d(r, mval, sources)?.co ?? co;
      if (!(item.flag & RULERITEM_USE_ANGLE) && constrain.mode !== CONSTRAIN_MODE_OFF) {
        const mat = orientation(constrain.mode), inv = transpose_m3(mat), other = mul_m3_v3(inv, item.co[index === 0 ? 2 : 0]);
        const local = mul_m3_v3(inv, co).map((x, i) => (i === constrain.axis ? x : other[i]));
        co = mul_m3_v3(mat, local);
      }
    }
    item.co[index] = co;
  }

  // The gizmo tweak (gizmogroup.gizmo_tweak with the ruler item's invoke, modal and exit): runs until the button
  // that began it is released.
  function tweak(event, item, inter) {
    const constrain = { axis: -1, mode: CONSTRAIN_MODE_OFF };
    let precise = false, snap = !!event.ctrl;
    item_active = item;
    const update = (e) => {
      const r = region(e.view ?? event.view);
      if (r) mousemove(r, item, inter, [e.x, e.y], { do_thickness: precise, do_snap: snap, constrain });
      region.tag();
    };
    const remove = wm.addModal({
      keymap(e) {
        if (e.type === event.type && e.value === 'RELEASE') { end(true); return true; }
        if (e.value === 'PRESS' && ['x', 'y', 'z'].includes(e.type)) {
          const axis = 'xyz'.indexOf(e.type);
          if (constrain.axis !== axis) Object.assign(constrain, { axis, mode: 1 });
          else if (constrain.mode !== CONSTRAIN_MODE_2) constrain.mode++;
          else Object.assign(constrain, { axis: -1, mode: CONSTRAIN_MODE_OFF });
          update(e);
          return true;
        }
        const item_ = modalItem('Generic Gizmo Tweak Modal Map', e);
        if (item_ === 'CANCEL') { end(false); return true; }
        if (item_ === 'CONFIRM') { end(true); return true; }
        if (item_ === 'PRECISION_ON' || item_ === 'PRECISION_OFF') { precise = item_ === 'PRECISION_ON'; update(e); return true; }
        if (item_ === 'SNAP_ON' || item_ === 'SNAP_OFF') { snap = item_ === 'SNAP_ON'; update(e); return true; }
        return false;
      },
      mousemove: update,
      // As gizmo_tweak_modal passes every event through, the view still navigates.
      passthrough: (e) => e.type === 'middlemouse' || e.type.startsWith('wheel'),
      cancel: () => end(false),
    });
    // gizmo_ruler_exit: a confirmed drag stores the rulers.
    const end = (confirm) => { remove(); if (confirm) store(); region.tag(); };
    return true;
  }

  // view3d.ruler_add: a new item from the drag's start, its first point snapped with Ctrl, then its end dragged.
  function add(drag) {
    const event = dragStart(drag), r = region(event.view);
    if (!r) return false;
    const item = { co: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], flag: 0 };
    loaded().push(item);
    const inter = { co_index: 0, drag_start_co: [0, 0, 0] };
    mousemove(r, item, inter, [event.x, event.y], { do_thickness: false, do_snap: !!event.ctrl, constrain: { mode: CONSTRAIN_MODE_OFF } });
    inter.drag_start_co = [...item.co[0]];
    item.co[2] = [...item.co[0]];
    item.co[1] = [...item.co[0]];
    inter.co_index = 2;
    return tweak(event, item, inter);
  }

  // gizmo_ruler_invoke on a picked part.
  function invoke(drag, { item, part }) {
    const event = dragStart(drag), r = region(event.view);
    const inter = { co_index: part, drag_start_co: [0, 0, 0] };
    if (part === PART_LINE) {
      item.flag |= RULERITEM_USE_ANGLE;
      inter.co_index = 1;
      const co_ss = [item.co[0], item.co[2]].map((co) => r.project(co) ?? [0, 0]);
      const fac = Math.min(1, Math.max(0, line_point_factor_v2([event.x, event.y], co_ss[0], co_ss[1])));
      item.co[1] = interp_v3(item.co[0], item.co[2], fac);
      inter.drag_start_co = [...item.co[1]];
      mousemove(r, item, inter, [event.x, event.y], { do_thickness: false, do_snap: false, constrain: { mode: CONSTRAIN_MODE_OFF } });
    } else inter.drag_start_co = [...item.co[part]];
    if (inter.co_index === 1) item.flag |= RULERITEM_USE_ANGLE_ACTIVE;
    else item.flag &= ~RULERITEM_USE_ANGLE_ACTIVE;
    return tweak(event, item, inter);
  }

  // view3d.ruler_remove: the active item's angle when its vertex is active, else the item.
  function remove() {
    if (!item_active || !loaded().includes(item_active)) return false;
    if (item_active.flag & RULERITEM_USE_ANGLE && item_active.flag & RULERITEM_USE_ANGLE_ACTIVE) item_active.flag &= ~(RULERITEM_USE_ANGLE | RULERITEM_USE_ANGLE_ACTIVE);
    else { items.splice(items.indexOf(item_active), 1); item_active = null; }
    store();
    return true;
  }

  registerGizmoGroupType('VIEW3D_GGT_ruler', {
    poll: toolActive,
    test_select(event) {
      const r = region(event.view);
      for (const item of r ? loaded() : []) {
        const part = pick(r, item, [event.x, event.y]);
        if (part !== null && !(part === PART_LINE && item.flag & RULERITEM_USE_ANGLE)) return { item, part };
      }
      return null;
    },
    // Generic Gizmo Maybe Drag: a drag on an item tweaks it.
    handle: (event, part) => event.type === 'leftmouse' && event.value === 'CLICK_DRAG' && invoke(event, part),
    draw: (ctx, r) => loaded().forEach((item) => drawItem(ctx, r, item, item === item_active)),
  });

  return { add, remove };
}

// gizmo_ruler_draw, in Blender's region pixels (y up): a dashed line (gray and the item's color, white when active),
// caps across its ends, the angle's arc and vertex cross, and the length or angle on a dark backdrop.
function drawItem(ctx, r, item, is_act) {
  const height = r.rect.height, down = ([x, y]) => [x, height - y];
  const co_ss = item.co.map((co) => { const p = r.project(co); return p && down(r.toRegion(p)); }), ok = co_ss.map(Boolean);
  const angle = item.flag & RULERITEM_USE_ANGLE, wire = css(THEME.wire);
  const path = (points) => { ctx.beginPath(); points.map(down).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
  const dashed = (points) => {
    if (points.some((p) => !p)) return;
    path(points);
    ctx.lineWidth = 1;
    ctx.strokeStyle = is_act ? 'rgb(255 255 255)' : 'rgb(0 0 0)';
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgb(171 171 171)';
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const lines = (pairs, color = wire, width = 1) => {
    ctx.beginPath();
    for (const pair of pairs) { const [a, b] = pair.map(down); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  const rot90 = (a, b) => { const d = [-(a[1] - b[1]), a[0] - b[0]], l = Math.hypot(...d) || 1; return [d[0] / l, d[1] / l]; };
  const cap = (p, n) => [[p[0] + n[0] * CAP_SIZE, p[1] + n[1] * CAP_SIZE], [p[0] - n[0] * CAP_SIZE, p[1] - n[1] * CAP_SIZE]];
  const cross = (p) => [[[p[0] - CAP_SIZE, p[1] - CAP_SIZE], [p[0] + CAP_SIZE, p[1] + CAP_SIZE]], [[p[0] - CAP_SIZE, p[1] + CAP_SIZE], [p[0] + CAP_SIZE, p[1] - CAP_SIZE]]];
  ctx.font = MONO;
  const size = (text) => { const m = ctx.measureText(text); return [m.width, m.actualBoundingBoxAscent]; };
  // The text with its lower left corner at `posit`, over its backdrop.
  const label = (text, posit) => {
    const [w, h] = size(text), [x, y] = down(posit);
    ctx.fillStyle = 'rgb(0 0 0 / 0.5)';
    ctx.fillRect(x - BG_MARGIN, y - h - BG_MARGIN, w + 2 * BG_MARGIN, h + 2 * BG_MARGIN);
    ctx.fillStyle = css(THEME.text);
    ctx.fillText(text, x, y);
  };
  if (angle) {
    dashed([co_ss[0], co_ss[1], co_ss[2]]);
    if (ok.every(Boolean)) {
      const px_scale = r.pixel_size(item.co[1]) * Math.min(ARC_SIZE, dist2(co_ss[0], co_ss[1]) / 2, dist2(co_ss[2], co_ss[1]) / 2);
      const dir_a = normalize_v3(sub_v3(item.co[0], item.co[1])), dir_b = normalize_v3(sub_v3(item.co[2], item.co[1]));
      const step = axis_angle_normalized_to_mat3(normalize_v3(cross_v3(dir_a, dir_b)), angle_normalized_v3v3(dir_a, dir_b) / ARC_STEPS);
      const arc = [];
      for (let j = 0, dir = dir_a; j <= ARC_STEPS; j++, dir = mul_m3_v3(step, dir)) {
        const p = r.project(add_v3(item.co[1], mul_v3_fl(dir, px_scale)));
        if (p) arc.push(down(r.toRegion(p)));
      }
      path(arc);
      ctx.lineWidth = 1;
      ctx.strokeStyle = wire;
      ctx.stroke();
    }
    if (ok[1] && is_act && item.flag & RULERITEM_USE_ANGLE_ACTIVE) lines(cross(co_ss[1]), 'rgb(255 255 255)', 3);
    lines([...(ok[0] && ok[1] ? [cap(co_ss[0], rot90(co_ss[0], co_ss[1]))] : []), ...(ok[2] && ok[1] ? [cap(co_ss[2], rot90(co_ss[1], co_ss[2]))] : []),
      ...(ok[1] ? cross(co_ss[1]) : [])]);
    if (ok[1] && ok[0]) {
      const text = formatAngle(angle_v3v3v3(item.co[0], item.co[1], item.co[2])), [w, h] = size(text), v = rot90(co_ss[0], co_ss[1]);
      label(text, [co_ss[1][0] - w / 2 + (v[1] < 0 ? w : -w), co_ss[1][1] - h / 2 + v[0] * h]);
    }
  } else {
    dashed([co_ss[0], co_ss[2]]);
    const v = ok[0] && ok[2] ? rot90(co_ss[0], co_ss[2]) : [0, 1];
    lines([...(ok[0] ? [cap(co_ss[0], v)] : []), ...(ok[2] ? [cap(co_ss[2], v)] : [])]);
    if (ok[0] && ok[2]) {
      const text = formatLength(len_v3(sub_v3(item.co[0], item.co[2])), 6), [w, h] = size(text), len = dist2(co_ss[0], co_ss[2]);
      const posit = [(co_ss[0][0] + co_ss[2][0]) / 2 - w / 2, (co_ss[0][1] + co_ss[2][1]) / 2 - h / 2];
      if (len < h * 2.5 || (len < w + 2 * BG_MARGIN && Math.abs(v[0]) < 0.5)) posit[1] = Math.min(co_ss[0][1], co_ss[2][1]) - h - 2 * BG_MARGIN;
      else if (Math.abs(v[0]) < 0.2) posit[1] -= h;
      label(text, posit);
    }
  }
}

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
