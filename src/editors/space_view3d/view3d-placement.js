// The Add Primitive tools (view3d_placement.cc: view3d.interactive_add with the VIEW3D_GGT_placement snap cursor of
// view3d_cursor_snap.cc): a grid under the mouse shows the plane a primitive starts on, on the surface there or
// through the 3D cursor; dragging draws its base, releasing then moving sets its depth, and a click adds it with
// Blender's primitive operator. Shift fixes the aspect, Alt centers it, Ctrl snaps.
import { add_v3, sub_v3, mul_v3_fl, dot_v3, cross_v3, normalize_v3, negate_v3, is_zero_v3, len_v3, mid_v3_v3v3v3v3, plane_from_point_normal_v3,
  closest_to_plane_normalized_v3, interp_v3 } from '../../blenlib/math-geom.js';
import { mul_m3_v3, transpose_m3, unit_m3, orthogonalize_m3 } from '../../blenlib/math-matrix.js';
import { mat3_normalized_to_eulO } from '../../blenlib/math-rotation.js';
import { modalItem } from '../../windowmanager/keyconfig.js';
import { registerGizmoGroupType } from '../../windowmanager/wm-gizmo-map.js';
import { dragStart } from '../../windowmanager/wm-event-system.js';
import { snap_object_project_view3d, SCE_SNAP_TO_FACE, SCE_SNAP_TO_GEOM } from '../transform/transform-snap-object.js';
import { css, THEME, tagRedraw, drawCallbackAdd } from '../../draw/overlay-tool.js';

const STEP_BASE = 0, STEP_DEPTH = 1;
const EPS_VIEW_ALIGN = 1e-2;
const PRIMITIVES = {
  'builtin.primitive_cube_add': ['CUBE', 'mesh.primitive_cube_add'], 'builtin.primitive_cylinder_add': ['CYLINDER', 'mesh.primitive_cylinder_add'],
  'builtin.primitive_cone_add': ['CONE', 'mesh.primitive_cone_add'], 'builtin.primitive_uv_sphere_add': ['SPHERE_UV', 'mesh.primitive_uv_sphere_add'],
  'builtin.primitive_ico_sphere_add': ['SPHERE_ICO', 'mesh.primitive_ico_sphere_add'],
};
// The placement settings of ToolSettings (plane_depth, plane_orientation, plane_axis) and their defaults.
const AXES = { X: 0, Y: 1, Z: 2 };

// v3d_cursor_poject_surface_normal: the object's axis nearest the normal replaced by it, as the plane's normal axis.
function surfaceNormalMatrix(normal, obmat) {
  const mat = obmat.map((axis) => normalize_v3(axis));
  let i_best = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(dot_v3(mat[i], normal)) > Math.abs(dot_v3(mat[i_best], normal))) i_best = i;
  if (dot_v3(mat[i_best], normal) < 0) { mat[(i_best + 1) % 3] = negate_v3(mat[(i_best + 1) % 3]); mat[(i_best + 2) % 3] = negate_v3(mat[(i_best + 2) % 3]); }
  mat[i_best] = [...normal];
  const ortho = orthogonalize_m3(mat, i_best).map((axis) => normalize_v3(axis));
  return [ortho[(i_best + 1) % 3], ortho[(i_best + 2) % 3], ortho[i_best]];
}

// v3d_cursor_snap_update: the point under the mouse and the plane's orientation there.
export function cursorSnap(r, mval, { settings, sources, cursor, snap }) {
  const plane_axis = AXES[settings.plane_axis] ?? 2;
  const use_surface_nor = settings.plane_orientation === 'SURFACE', use_surface_co = snap || settings.plane_depth === 'SURFACE';
  let hit = null, omat = unit_m3();
  if (use_surface_nor || use_surface_co) hit = snap_object_project_view3d(r, mval, sources, { elements: snap ? SCE_SNAP_TO_GEOM : SCE_SNAP_TO_FACE });
  const orient_surface = use_surface_nor && hit;
  if (orient_surface) {
    let face_nor = hit.no ? [...hit.no] : [0, 0, 0];
    if (!is_zero_v3(face_nor)) {
      const ray_dir = r.persp ? sub_v3(hit.co, r.viewinv.position) : negate_v3(r.viewinv.back);
      if (dot_v3(ray_dir, face_nor) >= 0) face_nor = negate_v3(face_nor);
    } else face_nor[plane_axis] = 1;
    omat = surfaceNormalMatrix(normalize_v3(face_nor), hit.axes);
  }
  const snapped = hit && (snap ? true : false) && hit.type !== SCE_SNAP_TO_FACE ? hit : snap && hit ? hit : null;
  const co_depth = hit && use_surface_co ? hit.co : cursor;
  let co;
  if (snapped) co = snapped.co;
  else {
    const plane_normal = omat[plane_axis];
    const isect = settings.plane_depth !== 'CURSOR_VIEW' && (r.persp || Math.abs(dot_v3(plane_normal, r.viewinv.back)) > EPS_VIEW_ALIGN);
    co = (isect && r.win_to_3d_on_plane(co_depth, plane_normal, mval)) || r.win_to_3d(co_depth, mval);
  }
  return { co, omat, snapped: !!snapped, type: snapped?.type };
}

// `primitive()` names the active tool's primitive (builtin.primitive_*_add); `settings()` the scene's ToolSettings
// placement values; `add(idname, { location, rotation, scale })` runs the primitive's operator.
export function createPlacement({ region, sources, cursor, settings, wm, toolActive, tool, add, notify }) {
  let preview = null, ipd = null;
  const snapState = (r, mval, snap) => cursorSnap(r, mval, { settings: settings(), sources, cursor: cursor(), snap });

  // The snap cursor's plane under the mouse while no primitive is being placed (VIEW3D_GGT_placement).
  registerGizmoGroupType('VIEW3D_GGT_placement', {
    poll: toolActive,
    test_select(event) {
      if (!ipd && event.view) {
        const r = region(event.view);
        preview = r && { view: event.view, ...snapState(r, [event.x, event.y], !!event.ctrl) };
        tagRedraw();
      }
      return null;
    },
    handle: () => false,
    draw: (ctx, r) => { if (!ipd && preview?.view === r.view) drawPlane(ctx, r, preview, AXES[settings().plane_axis] ?? 2); },
  });
  drawCallbackAdd((ctx, r) => { if (ipd?.view === r.view) drawPrimitive(ctx, r, ipd); });

  // calc_bbox: the base quad from the first step and the secondary quad offset by the second.
  function calc_bbox() {
    if (len_v3(sub_v3(ipd.co_src, ipd.step[0].co_dst)) < 1.1920929e-7) return null;
    const inv = transpose_m3(ipd.matrix_orient), axis = ipd.orient_axis, x_axis = (axis + 1) % 3, y_axis = (axis + 2) % 3;
    const quad_base = [ipd.co_src, null, ipd.step[0].co_dst, null];
    const local = mul_m3_v3(inv, sub_v3(ipd.step[0].co_dst, ipd.co_src));
    const delta_a = [...local], delta_b = [...local];
    delta_a[axis] = delta_b[axis] = 0;
    delta_a[x_axis] = 0;
    delta_b[y_axis] = 0;
    let fixed = Math.max(Math.abs(delta_a[y_axis]), Math.abs(delta_b[x_axis]));
    if (ipd.step[0].is_fixed_aspect) {
      delta_a[y_axis] = Math.sign(delta_a[y_axis] || 1) * fixed;
      delta_b[x_axis] = Math.sign(delta_b[x_axis] || 1) * fixed;
    }
    const wa = mul_m3_v3(ipd.matrix_orient, delta_a), wb = mul_m3_v3(ipd.matrix_orient, delta_b);
    if (ipd.step[0].is_fixed_aspect) quad_base[2] = add_v3(add_v3(ipd.co_src, wa), wb);
    quad_base[1] = add_v3(ipd.co_src, wa);
    quad_base[3] = add_v3(ipd.co_src, wb);
    let base = quad_base;
    if (ipd.step[0].is_centered) {
      const c = quad_base[2];
      base = quad_base.map((v) => add_v3(mul_v3_fl(sub_v3(v, c), 2), c));
      fixed *= 2;
    }
    let delta = ipd.step_index === STEP_DEPTH ? sub_v3(ipd.step[1].co_dst, ipd.step[0].co_dst) : [0, 0, 0];
    if (ipd.step[1].is_fixed_aspect && !is_zero_v3(delta)) delta = mul_v3_fl(normalize_v3(delta), fixed);
    if (ipd.step[1].is_centered) {
      const temp = ipd.step[1].is_fixed_aspect ? mul_v3_fl(delta, 0.5) : delta;
      if (!ipd.step[1].is_fixed_aspect) delta = mul_v3_fl(delta, 2);
      base = base.map((v) => sub_v3(v, temp));
    }
    const moved = ipd.step_index === STEP_DEPTH && len_v3(sub_v3(ipd.step[0].co_dst, ipd.step[1].co_dst)) >= 1.1920929e-7;
    return [...base, ...base.map((v) => (moved ? add_v3(v, delta) : [...v]))];
  }

  // view3d_interactive_add_begin from a drag's start, then the modal until the depth step's click.
  function invoke(drag) {
    const event = dragStart(drag), r = region(event.view);
    if (!r) return false;
    const s = settings(), snap = snapState(r, [event.x, event.y], !!event.ctrl), plane_axis = AXES[s.plane_axis] ?? 2;
    const [primitive_type, idname] = PRIMITIVES[tool()] ?? PRIMITIVES['builtin.primitive_cube_add'];
    ipd = {
      view: event.view, primitive_type, co_src: snap.co, matrix_orient: snap.omat, orient_axis: plane_axis, step_index: STEP_BASE, use_snap: !!event.ctrl,
      step: [0, 1].map((i) => {
        const centered = (s[['plane_origin_base', 'plane_origin_depth'][i]] ?? 'EDGE') === 'CENTER', fixed = (s[['plane_aspect_base', 'plane_aspect_depth'][i]] ?? 'FREE') === 'FIXED';
        return { is_centered: centered, is_centered_init: centered, is_fixed_aspect: fixed, is_fixed_aspect_init: fixed, plane: null, co_dst: [...snap.co] };
      }),
    };
    ipd.step[0].plane = plane_from_point_normal_v3(ipd.co_src, ipd.matrix_orient[plane_axis]);
    const view_axis_dot = Math.abs(dot_v3(r.viewinv.back, ipd.matrix_orient[plane_axis]));
    ipd.step[STEP_BASE].degenerate = view_axis_dot < EPS_VIEW_ALIGN;
    ipd.step[STEP_DEPTH].degenerate = Math.abs(view_axis_dot - 1) < EPS_VIEW_ALIGN;
    ipd.view_plane = plane_from_point_normal_v3(ipd.co_src, normalize_v3(r.viewinv.back));
    const status = () => notify(`${ipd.step_index === STEP_BASE ? 'Define Base' : 'Define Depth'}    Esc Cancel    Shift Fixed Aspect    Alt Center Pivot    Ctrl Snap`);
    // The point under the mouse on the current step's plane (or the view's plane when that one faces the view).
    const update = (e) => {
      const step = ipd.step[ipd.step_index], mval = [e.x, e.y];
      const found = ipd.use_snap ? snapState(r, mval, true) : null;
      if (found?.snapped) step.co_dst = closest_to_plane_normalized_v3(step.plane, found.co);
      else {
        // A plane facing the view takes the point on the view's plane instead (..._on_plane_with_fallback).
        const p = step.degenerate ? onPlane(r, ipd.view_plane, mval) : onPlane(r, step.plane, mval) ?? onPlane(r, ipd.view_plane, mval);
        if (p) step.co_dst = closest_to_plane_normalized_v3(step.plane, p);
      }
      if (ipd.step_index === STEP_DEPTH) {
        const close = closest_to_plane_normalized_v3(ipd.step[STEP_BASE].plane, step.co_dst);
        step.co_dst = sub_v3(step.co_dst, sub_v3(close, ipd.step[STEP_BASE].co_dst));
      }
      ipd.bounds = calc_bbox();
      tagRedraw();
      status();
    };
    const toggle = (key, on) => { const step = ipd.step[ipd.step_index]; step[key] = on !== step[key + '_init']; ipd.bounds = calc_bbox(); tagRedraw(); };
    const exit = () => { remove(); ipd = null; notify(''); tagRedraw(); };
    const remove = wm.addModal({
      keymap(e) {
        const item = modalItem('View3D Placement Modal', e);
        if (item) {
          if (/^FIXED_ASPECT/.test(item)) toggle('is_fixed_aspect', item.endsWith('_ON'));
          if (/^PIVOT_CENTER/.test(item)) toggle('is_centered', item.endsWith('_ON'));
          if (/^SNAP/.test(item)) { ipd.use_snap = item.endsWith('_ON'); update({ x: wm.pointer?.x ?? e.x, y: wm.pointer?.y ?? e.y }); }
          return true;
        }
        if ((e.type === 'esc' || e.type === 'rightmouse') && e.value === 'PRESS') { exit(); return true; }
        if (e.type !== 'leftmouse') return e.type !== 'middlemouse' && !e.type.startsWith('wheel');
        if (ipd.step_index === STEP_BASE && e.value === 'RELEASE') {
          // The depth's plane holds the base's normal and faces the view.
          const base_no = ipd.step[0].plane.slice(0, 3);
          const along = ipd.step[STEP_DEPTH].degenerate ? normalize_v3(add_v3(r.viewinv.right, r.viewinv.up)) : r.viewinv.back;
          const no = normalize_v3(cross_v3(cross_v3(base_no, along), base_no));
          ipd.step[1].plane = plane_from_point_normal_v3(ipd.step[0].co_dst, no);
          ipd.step[1].co_dst = [...ipd.step[0].co_dst];
          ipd.step_index = STEP_DEPTH;
          if (ipd.step[0].is_centered !== ipd.step[0].is_centered_init) ipd.step[1].is_centered = !ipd.step[1].is_centered;
          if (ipd.step[0].is_fixed_aspect !== ipd.step[0].is_fixed_aspect_init) ipd.step[1].is_fixed_aspect = !ipd.step[1].is_fixed_aspect;
          status();
        } else if (ipd.step_index === STEP_DEPTH && e.value === 'PRESS') confirm();
        return true;
      },
      mousemove: (e) => { if (e.view === r.view || !e.view) update(e); },
      passthrough: (e) => e.type === 'middlemouse' || e.type.startsWith('wheel'),
      cancel: exit,
    });
    // The primitive's operator with the box's center, orientation and size (primitives are 2 units across).
    const confirm = () => {
      const bounds = calc_bbox();
      if (bounds) {
        const m = ipd.matrix_orient.map((axis) => [...axis]);
        if (ipd.orient_axis !== 2) { [m[2], m[ipd.orient_axis]] = [m[ipd.orient_axis], m[2]]; [m[0], m[1]] = [m[1], m[0]]; }
        if (dot_v3(ipd.matrix_orient[ipd.orient_axis], sub_v3(bounds[0], bounds[4])) > 0) { m[2] = negate_v3(m[2]); m[1] = negate_v3(m[1]); }
        const scale = [3, 1, 4].map((i) => len_v3(sub_v3(bounds[0], bounds[i])) / 2);
        const matrix = m.map((axis) => normalize_v3(axis));
        add(idname, { location: interp_v3(bounds[0], bounds[6], 0.5), rotation: mat3_normalized_to_eulO(1, matrix), scale, ...SIZES[primitive_type] });
      }
      exit();
    };
    status();
    update(event);
    return true;
  }
  return { invoke };
}

// The primitives' own sizes, reset since the box sets their size (view3d_interactive_add_modal).
const SIZES = { CUBE: { size: 2 }, CYLINDER: { radius: 1, depth: 2 }, CONE: { radius1: 1, radius2: 0, depth: 2 }, SPHERE_UV: { radius: 1 }, SPHERE_ICO: { radius: 1 } };

// ED_view3d_win_to_3d_on_plane for a plane as [nx, ny, nz, d].
function onPlane(r, plane, mval) {
  const no = plane.slice(0, 3), co = mul_v3_fl(no, -plane[3] / dot_v3(no, no));
  return r.win_to_3d_on_plane(co, no, mval);
}

// v3d_cursor_plane_draw: a grid on the plane through the point, fading out from it, about twice the gizmo size.
function drawPlane(ctx, r, { co, omat }, plane_axis) {
  const pixel_size = r.persp ? r.pixel_size(r.center) : r.pixel_size(co);
  const final_scale_fade = 75 * 2 * pixel_size, final_scale = 10 ** Math.ceil(Math.log10(final_scale_fade));
  const fac = final_scale_fade / final_scale;
  const ax = omat[(plane_axis + 1) % 3], ay = omat[(plane_axis + 2) % 3];
  const grid = (lines, scale, alpha) => {
    const resolution = lines, div = 1 / resolution;
    const point = (x, y) => add_v3(co, add_v3(mul_v3_fl(ax, (x * div - 0.5) * scale), mul_v3_fl(ay, (y * div - 0.5) * scale)));
    const fade = (v) => Math.max(0, 1 - ((len_v3(sub_v3(v, co)) / final_scale_fade + div) * 2) ** 2);
    for (let x = 0; x < resolution; x++) {
      for (let y = 0; y < resolution; y++) {
        const v0 = point(x, y);
        for (const v1 of [point(x + 1, y), point(x, y + 1)]) {
          const f = Math.max(fade(v0), fade(v1));
          const a = r.project(v0), b = r.project(v1);
          if (!f || !a || !b) continue;
          const [ax2, ay2] = r.toRegion(a), [bx, by] = r.toRegion(b);
          ctx.beginPath();
          ctx.moveTo(ax2, ay2);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = `rgb(255 255 255 / ${alpha * f})`;
          ctx.stroke();
        }
      }
    }
  };
  ctx.lineWidth = 1;
  ctx.globalCompositeOperation = 'lighter';
  const alpha = 0.75 * Math.max(0.3, 1 - (1 - Math.abs(dot_v3(omat[plane_axis], r.viewinv.back))) ** 4);
  if (alpha * (1 - fac) ** 2 > 0) grid(100, final_scale, alpha * (1 - fac) ** 2);
  grid(fac < 0.2 ? 2 : 10, fac < 0.2 ? final_scale_fade : final_scale, alpha);
  ctx.globalCompositeOperation = 'source-over';
  // cursor_point_draw: a circle at the point, crossed when snapped to a vertex.
  const p = r.project(co);
  if (p) {
    const [x, y] = r.toRegion(p);
    ctx.beginPath();
    ctx.arc(x, y, 7.5, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgb(255 255 255)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// draw_primitive_view: the box's edges, and the primitive's circles in it, in the gizmo color.
function drawPrimitive(ctx, r, { bounds, primitive_type }) {
  if (!bounds) return;
  const segments = [];
  const loop = (points) => points.forEach((p, i) => segments.push([p, points[(i + 1) % points.length]]));
  [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => segments.push([bounds[a], bounds[b]]));
  // draw_circle_in_quad: the circle of the unit square mapped into a quad.
  const circle = (v1, v2, v3, v4) => loop(Array.from({ length: 32 }, (_, i) => {
    const theta = 2 * Math.PI * (i / 32) + 0.01, u = (Math.cos(theta) + 1) / 2, v = (Math.sin(theta) + 1) / 2;
    return add_v3(add_v3(mul_v3_fl(v1, (1 - u) * (1 - v)), mul_v3_fl(v2, u * (1 - v))), add_v3(mul_v3_fl(v3, u * v), mul_v3_fl(v4, (1 - u) * v)));
  }));
  const b = bounds, mid = (a, c) => interp_v3(a, c, 0.5);
  if (primitive_type === 'CYLINDER') { circle(b[0], b[1], b[2], b[3]); circle(b[4], b[5], b[6], b[7]); }
  if (primitive_type === 'CONE') {
    circle(b[0], b[1], b[2], b[3]);
    const center = mid_v3_v3v3v3v3(b[4], b[5], b[6], b[7]);
    for (let i = 0; i < 4; i++) segments.push([center, mid(b[i], b[(i + 1) % 4])]);
  }
  if (primitive_type === 'SPHERE_UV' || primitive_type === 'SPHERE_ICO') {
    circle(mid(b[0], b[1]), mid(b[4], b[5]), mid(b[6], b[7]), mid(b[2], b[3]));
    circle(mid(b[3], b[0]), mid(b[1], b[2]), mid(b[5], b[6]), mid(b[7], b[4]));
    circle(mid(b[0], b[4]), mid(b[1], b[5]), mid(b[2], b[6]), mid(b[3], b[7]));
  }
  ctx.beginPath();
  for (const [p0, p1] of segments) {
    const a = r.project(p0), c = r.project(p1);
    if (!a || !c) continue;
    const [ax, ay] = r.toRegion(a), [cx, cy] = r.toRegion(c);
    ctx.moveTo(ax, ay);
    ctx.lineTo(cx, cy);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(THEME.gizmo_primary);
  ctx.stroke();
}
