// Annotations in the 3D View: gpencil.annotate (annotate_paint.cc), which draws freehand, straight lines and polylines
// or erases, and their drawing (annotate_draw.cc). A stroke is drawn in screen space while it is made and becomes
// points in the scene by the annotation placement (Scene.tool_settings.annotation_stroke_placement_view3d): on the
// view plane through the 3D cursor (CURSOR), on the surface under each point (SURFACE, the cursor's plane where
// there is none) or fixed to the view (VIEW, in percent of the region). Ctrl or Alt keeps a freehand stroke
// horizontal or vertical; the right button erases within a radius the wheel changes.
import { tagRedraw, drawCallbackAdd, css } from '../../draw/overlay-tool.js';

// MIN_MANHATTAN_PX and MIN_EUCLIDEAN_PX (U.gp_manhattandist, U.gp_euclideandist).
const MIN_MANHATTAN_PX = 1, MIN_EUCLIDEAN_PX = 2;
// U.gp_eraser.
let eraserRadius = 25;

// annotation_smooth_buffer: point idx - 2 moves toward the average of up to four points before idx.
function smoothBuffer(points, inf, idx) {
  if (points.length < 3 || idx < 3 || inf === 0) return;
  const steps = idx < 4 ? 3 : 4, used = [idx - 4, idx - 3, idx - 2, idx - 1].filter((i) => i >= 0);
  const sco = [0, 0];
  for (const i of used) for (let a = 0; a < 2; a++) sco[a] += points[i][a] / steps;
  const c = points[idx - 2];
  points[idx - 2] = [c[0] + (sco[0] - c[0]) * inf, c[1] + (sco[1] - c[1]) * inf];
}

// gpencil_stroke_inside_circle: a segment's ends within the radius, or the segment passing through the circle.
function insideCircle(mval, radius, a, b) {
  const len = (p) => Math.hypot(p[0] - mval[0], p[1] - mval[1]);
  if (len(a) <= radius || len(b) <= radius) return true;
  const d = [b[0] - a[0], b[1] - a[1]], l2 = d[0] ** 2 + d[1] ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((mval[0] - a[0]) * d[0] + (mval[1] - a[1]) * d[1]) / l2)) : 0;
  return len([a[0] + d[0] * t, a[1] + d[1] * t]) <= radius;
}

// The point in the scene (or in percent of the region for VIEW) of a client point.
function convertCoords(r, placement, cursor, mval) {
  if (placement === 'VIEW') {
    const [x, y] = r.toRegion(mval);
    return [(x / r.rect.width) * 100, (1 - y / r.rect.height) * 100, 0];
  }
  if (placement === 'SURFACE') {
    const hit = r.surface(mval);
    if (hit) return hit.co;
  }
  return r.win_to_3d(cursor, mval);
}

// A stroke's client points as drawn in a region.
const strokePoints = (r, stroke) => (stroke.space === 'VIEW'
  ? stroke.points.map(([x, y]) => [r.rect.left + (x / 100) * r.rect.width, r.rect.top + (1 - y / 100) * r.rect.height])
  : stroke.points.map((co) => r.project(co)));

// gpencil.annotate: `annotations` the scene's (blenkernel/gpencil/annotations.js), `region(view)` a view's projection,
// `cursor()` the 3D cursor's location, `placement()` the placement setting, `commit()` an undo step.
export function createAnnotate({ annotations, region, cursor, placement, wm, commit, notify }) {
  // The stroke being made, drawn in screen space by the active layer's settings (annotation_draw_stroke_buffer).
  let buffer = null, eraser = null, stabilizer = null;
  drawCallbackAdd((ctx, r) => {
    for (const { layer, frame } of annotations().visible()) for (const stroke of frame.strokes) drawStroke(ctx, r, layer, strokePoints(r, stroke));
    if (buffer?.view === r.view && buffer.points.length) drawStroke(ctx, r, annotations().activeEnsure(), buffer.points);
    if (eraser?.view === r.view) {
      const [x, y] = r.toRegion(eraser.at);
      ctx.beginPath();
      ctx.arc(x, y, eraserRadius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgb(255 100 100 / 0.08)';
      ctx.fill();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgb(255 99 99 / 0.78)';
      ctx.stroke();
    }
    // annotation_draw_stabilizer: rings at the mouse and the rope from the stroke's last point.
    if (stabilizer?.view === r.view && stabilizer.from && buffer?.points.length > 1) {
      const [x, y] = r.toRegion(stabilizer.at), [fx, fy] = r.toRegion(stabilizer.from);
      ctx.setLineDash([]);
      ctx.lineWidth = 1.25;
      for (const [radius, color] of [[4, 'rgb(255 99 99 / 0.8)'], [5, 'rgb(102 40 40 / 0.8)']]) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgb(255 99 99 / 0.8)';
      ctx.stroke();
    }
  });

  // annotation_stroke_doeraser on the active layer's frame: points within the radius go, splitting their strokes.
  function erase(r, mval, frame) {
    const strokes = [];
    for (const stroke of frame.strokes) {
      const screen = strokePoints(r, stroke);
      if (screen.length === 1) {
        if (!screen[0] || Math.hypot(screen[0][0] - mval[0], screen[0][1] - mval[1]) > eraserRadius) strokes.push(stroke);
        continue;
      }
      const tagged = screen.map(() => false);
      for (let i = 0; i + 1 < screen.length; i++) {
        if (!screen[i] || !screen[i + 1] || !insideCircle(mval, eraserRadius, screen[i], screen[i + 1])) continue;
        for (const j of [i, i + 1]) if (Math.hypot(screen[j][0] - mval[0], screen[j][1] - mval[1]) <= eraserRadius) tagged[j] = true;
      }
      // BKE_gpencil_stroke_delete_tagged_points: the runs between tagged points stay as strokes.
      let run = [];
      stroke.points.forEach((p, i) => {
        if (!tagged[i]) run.push(p);
        if ((tagged[i] || i === stroke.points.length - 1) && run.length) { strokes.push({ ...stroke, points: run }); run = []; }
      });
    }
    const changed = strokes.length !== frame.strokes.length || strokes.some((s, i) => s !== frame.strokes[i]);
    if (changed) frame.strokes = strokes;
    return changed;
  }

  // The operator's invoke and modal: painting begins at the event, `mode` DRAW, DRAW_STRAIGHT, DRAW_POLY or ERASER.
  // Freehand strokes stabilize (lazy mouse) with use_stabilizer, or while Shift is held, which toggles it.
  function invoke(event, { mode = 'DRAW', use_stabilizer = false, stabilizer_factor = 0.75, stabilizer_radius = 35 }) {
    const r = region(event.view);
    if (!r) return false;
    const layer = annotations().activeEnsure();
    let paintmode = mode, painting = false, straight = null, changed = false, poly = null, mvalo = null;
    // GP_PAINTFLAG_USE_STABILIZER_TEMP: whether the stroke stabilizes now.
    let stabilize = false;
    const space = placement() === 'VIEW' ? 'VIEW' : '3D';
    const convert = (m) => convertCoords(r, placement(), cursor(), m);
    // annotation_paint_initstroke and the stroke's first point.
    const begin = (e) => {
      painting = true;
      paintmode = e.type === 'rightmouse' ? 'ERASER' : mode;
      if (paintmode === 'ERASER') {
        const frame = annotations().frameGet(layer);
        if (!frame?.strokes.length) { notify('Nothing to erase'); painting = false; return; }
        eraser = { view: e.view, at: [e.x, e.y] };
      } else {
        buffer = { view: e.view, points: [] };
        // A polyline's next vertex (annotation_stroke_addpoint after its stroke was added).
        if (paintmode === 'DRAW_POLY' && poly) { poly.points.push(convert([e.x, e.y])); changed = true; }
      }
      mvalo = null;
      straight = null;
      stabilize = paintmode === 'DRAW' && (use_stabilizer || !!e.shift);
      apply(e);
    };
    // annotation_draw_apply_event.
    const apply = (e) => {
      let mval = [e.x, e.y];
      if (paintmode === 'ERASER') {
        eraser.at = mval;
        const frame = annotations().frameGet(layer);
        if (frame && erase(r, mval, frame)) changed = true;
        tagRedraw();
        return;
      }
      if (e.shift && paintmode === 'DRAW') stabilize = !use_stabilizer;
      else if (paintmode === 'DRAW' && (e.ctrl || e.alt) && mvalo) {
        if (!straight) {
          const dx = Math.abs(Math.trunc(mval[0] - mvalo[0])), dy = Math.abs(Math.trunc(mval[1] - mvalo[1]));
          if (dx || dy) straight = dx >= dy ? { axis: 1, value: mval[1] } : { axis: 0, value: mval[0] };
        }
      } else {
        straight = null;
        stabilize = paintmode === 'DRAW' && use_stabilizer;
      }
      stabilizer = stabilize && { view: r.view, at: [e.x, e.y], from: buffer?.points.at(-1) };
      if (straight) mval[straight.axis] = straight.value;
      const points = buffer.points;
      if (paintmode === 'DRAW_STRAIGHT') points.splice(Math.min(points.length, 1), 1, mval);
      else if (paintmode === 'DRAW_POLY') {
        points.splice(0, 1, mval);
        if (poly) poly.points[poly.points.length - 1] = convert(mval);
      } else if (!points.length) points.push(mval);
      else if (filter(mval, mvalo)) {
        // The lazy mouse trails the pointer by the stabilizer factor, unsmoothed.
        if (stabilize) {
          const t = Math.min(stabilizer_factor, 0.995);
          mval = [mval[0] + (mvalo[0] - mval[0]) * t, mval[1] + (mvalo[1] - mval[1]) * t];
          points.push(mval);
        } else {
          points.push(mval);
          for (let s = 0; s < 3; s++) smoothBuffer(points, 0.5 * ((3 - s) / 3), points.length - s);
        }
      } else { tagRedraw(); return; }
      mvalo = mval;
      tagRedraw();
    };
    // annotation_stroke_filtermval: far enough from the last point to add one; a stabilized stroke waits outside its
    // radius.
    const filter = (mval, prev) => {
      const dx = Math.trunc(Math.abs(mval[0] - prev[0])), dy = Math.trunc(Math.abs(mval[1] - prev[1]));
      if (stabilize) return dx * dx + dy * dy > stabilizer_radius * stabilizer_radius;
      return (dx > MIN_MANHATTAN_PX && dy > MIN_MANHATTAN_PX) || dx * dx + dy * dy > MIN_EUCLIDEAN_PX * MIN_EUCLIDEAN_PX;
    };
    // annotation_paint_strokeend: the buffer becomes a stroke of the layer's frame at the current frame.
    const strokeEnd = () => {
      if (paintmode !== 'ERASER' && buffer?.points.length) {
        const frame = annotations().frameGet(layer, undefined, 'ADD_NEW');
        if (paintmode !== 'DRAW_POLY') frame.strokes = [...frame.strokes, { points: buffer.points.map(convert), thickness: layer.thickness, space }];
        else if (!poly) frame.strokes = [...frame.strokes, poly = { points: [convert(buffer.points[0])], thickness: layer.thickness, space }];
        changed = true;
      }
      buffer = eraser = stabilizer = null;
      painting = false;
      tagRedraw();
    };
    const exit = () => {
      if (painting) strokeEnd();
      buffer = eraser = null;
      remove();
      notify('');
      if (changed) { annotations().changed(); commit(); }
      tagRedraw();
    };
    const keymap = (e) => {
      if (e.value === 'PRESS' && ['ret', 'numpad_enter', 'esc', 'spacebar', 'e'].includes(e.type)) { exit(); return true; }
      if (e.type === 'middlemouse') return false;
      if (/mouse$/.test(e.type) && !e.type.startsWith('wheel')) {
        if (painting && (e.value === 'PRESS' || e.value === 'RELEASE')) {
          if (paintmode === 'DRAW_POLY') strokeEnd();
          else if (e.value === 'RELEASE') { strokeEnd(); exit(); }
          return true;
        }
        if (e.value === 'PRESS') {
          if (!e.view) { exit(); return true; }
          begin(e);
          return true;
        }
        return true;
      }
      if (painting && paintmode === 'ERASER' && ['wheeldownmouse', 'wheelupmouse', 'numpad_plus', 'numpad_minus'].includes(e.type)) {
        eraserRadius = Math.max(1, eraserRadius + (e.type === 'wheeldownmouse' || e.type === 'numpad_plus' ? 5 : -5));
        tagRedraw();
        return true;
      }
      return e.type.length === 1 || e.type.startsWith('left_') || e.type.startsWith('right_');
    };
    const remove = wm.addModal({
      keymap,
      mousemove: (e) => { if (painting && e.view === r.view) apply(e); else if (eraser) { eraser.at = [e.x, e.y]; tagRedraw(); } },
      passthrough: (e) => e.type === 'middlemouse' || e.type.startsWith('wheel') || e.type.startsWith('numpad_'),
      cancel: exit,
    });
    notify(paintmode === 'DRAW_POLY' ? 'Esc End  Place Next Stroke Vertex' : paintmode === 'ERASER' ? 'Esc End  Erase' : 'Esc End  Draw');
    // Hotkey invoked (wait_for_input off): drawing begins at the event.
    begin({ ...event, type: event.type === 'rightmouse' ? 'rightmouse' : 'leftmouse' });
    if (!painting) exit();
    return true;
  }

  return { invoke };
}

// annotation_draw_stroke_3d, _2d and _point and the buffer: the layer's color at its opacity, `thickness` pixels wide;
// a single point is a dot two pixels wider. Annotations draw in front of the scene.
function drawStroke(ctx, r, layer, points) {
  const visible = points.filter(Boolean).map((p) => r.toRegion(p));
  if (!visible.length) return;
  const color = css([...layer.color.slice(0, 3), layer.opacity ?? 1]);
  if (visible.length === 1) {
    ctx.beginPath();
    ctx.arc(visible[0][0], visible[0][1], (layer.thickness + 2) / 2, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }
  ctx.beginPath();
  visible.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineWidth = Math.max(layer.thickness, 1);
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}
