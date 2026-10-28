// The Edit Mesh tools' preselection and spin gizmos, drawn by Bylonder over Blender's module:
// - VIEW3D_GGT_mesh_preselect_edgering (Loop Cut): the edge ring under the mouse with the tool's cuts, its geometry from
//   EDBM_preselect_edgering_update_from_edge.
// - VIEW3D_GGT_mesh_preselect_elem (Poly Build): the element under the mouse and what Ctrl or Shift would make of it,
//   from the module's mirror of gizmo_preselect_elem_test_select, which the tool's operators then act on.
// - MESH_GGT_spin (editmesh_extrude_spin_gizmo.cc): two buttons per enabled axis around the 3D cursor that spin about
//   it, and the axis' dial; MESH_GGT_spin_redo: after a spin, a dial at its center that drags its angle (Adjust Last
//   Operation, re-run as Blender's redo does).
import { add_v3, sub_v3, mul_v3_fl, normalize_v3, cross_v3, dot_v3 } from '../../blenlib/math-geom.js';
import { axis_angle_normalized_to_mat3 } from '../../blenlib/math-rotation.js';
import { mul_m3_v3 } from '../../blenlib/math-matrix.js';
import { registerGizmoGroupType } from '../../windowmanager/wm-gizmo-map.js';
import { css, THEME, tagRedraw } from '../../draw/overlay-tool.js';
import theme from '../interface/theme-default.json' with { type: 'json' };

// editmesh_preselect_elem.cc's colors (edbm_preselect_imm_color), 0..255 with alpha.
const PRESELECT = { polygons: [141, 171, 186, 100], lines: [3, 161, 252, 200], remove: [252, 49, 10, 200] };
const rgba = ([r, g, b, a]) => `rgb(${r} ${g} ${b} / ${a / 255})`;
// U.gizmo_size and editmesh_extrude_spin_gizmo.cc's scales and angles.
const GIZMO_SIZE = 75, INIT_SCALE_BASE = 2.3, INIT_SCALE_BUTTON = 0.15, ORTHO_AXIS_OFFSET = 2;
const DIAL_ANGLE_PARTIAL = Math.PI / 2, DIAL_ANGLE_PARTIAL_MARGIN = 0.92;
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const AXIS_COLORS = [theme.user_interface.axis_x, theme.user_interface.axis_y, theme.user_interface.axis_z];

// `region(view)` is the view's projection; `active(group)` whether the active tool shows the group; `preselect` the
// edit mode's preselection (edgeRing(event, cuts), elem(event)); `cuts()` the Loop Cut tool's cuts; `toolKeymap`
// runs the active tool's keymap; `spinAxes()` the Spin tool's enabled axes (its gizmo's `axis`), `cursor()` the 3D
// cursor, `spin(event, axis)` runs mesh.spin about an axis; `lastOperation()` the editable last operator; `wm` the
// window manager its drags run modally in.
export function registerMeshGizmos({ region, wm, active, preselect, cuts, toolKeymap, spinAxes, cursor, spin, lastOperation }) {
  // A world point in region pixels of the canvas, or null behind the view.
  const at = (r, co) => { const p = r.project(co); return p && r.toRegion(p); };
  const line = (ctx, r, a, b) => {
    const [p, q] = [at(r, a), at(r, b)];
    if (!p || !q) return;
    ctx.beginPath();
    ctx.moveTo(...p);
    ctx.lineTo(...q);
    ctx.stroke();
  };
  const point = (ctx, r, co, size) => {
    const p = at(r, co);
    if (!p) return;
    ctx.beginPath();
    ctx.arc(p[0], p[1], size / 2, 0, 2 * Math.PI);
    ctx.fill();
  };
  const pairs = (points) => Array.from({ length: points.length / 2 }, (_, i) => [points[i * 2], points[i * 2 + 1]]);

  // Preselection: test_select finds the element (it is the gizmo's part, so the tool's keymap runs over it).
  let ring = null, elem = null;
  registerGizmoGroupType('VIEW3D_GGT_mesh_preselect_edgering', {
    poll: () => active('VIEW3D_GGT_mesh_preselect_edgering'),
    test_select(event) {
      const next = event.view ? preselect.edgeRing(event, cuts()) : null;
      if (JSON.stringify(next) !== JSON.stringify(ring)) { ring = next; tagRedraw(); }
      return ring && 'ring';
    },
    handle: (event) => toolKeymap(event),
    draw(ctx, r) {
      if (!ring) return;
      ctx.strokeStyle = ctx.fillStyle = css(THEME.gizmo_primary);
      ctx.lineWidth = 1;
      for (const [a, b] of pairs(ring.edges)) line(ctx, r, a, b);
      for (const co of ring.verts) point(ctx, r, co, 2 * Math.max(1, theme.view_3d.vertex_size * Math.SQRT2 / 2));
    },
  });
  registerGizmoGroupType('VIEW3D_GGT_mesh_preselect_elem', {
    poll: () => active('VIEW3D_GGT_mesh_preselect_elem'),
    test_select(event) {
      const next = event.view ? preselect.elem(event) : null;
      if (JSON.stringify(next) !== JSON.stringify(elem)) { elem = next; tagRedraw(); }
      return elem && 'elem';
    },
    handle: (event) => toolKeymap(event),
    draw(ctx, r) {
      if (!elem) return;
      const color = rgba(elem.remove ? PRESELECT.remove : PRESELECT.lines);
      ctx.fillStyle = rgba(PRESELECT.polygons);
      for (let i = 0; i + 2 < elem.tris.length; i += 3) {
        const tri = elem.tris.slice(i, i + 3).map((co) => at(r, co));
        if (tri.some((p) => !p)) continue;
        ctx.beginPath();
        ctx.moveTo(...tri[0]);
        ctx.lineTo(...tri[1]);
        ctx.lineTo(...tri[2]);
        ctx.fill();
      }
      ctx.strokeStyle = rgba(PRESELECT.lines);
      ctx.lineWidth = 2;
      for (const [a, b] of pairs(elem.lines)) line(ctx, r, a, b);
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth = 3;
      for (const [a, b] of pairs(elem.edges)) line(ctx, r, a, b);
      for (const co of elem.verts) point(ctx, r, co, 4);
    },
  });

  // Spin: per enabled axis, buttons at the gizmo's radius, 45 degrees either side of the axis' ortho axis.
  const radius = (r, co) => INIT_SCALE_BASE * GIZMO_SIZE * r.pixel_size(co);
  const spinButtons = (r) => {
    const center = cursor();
    return spinAxes().flatMap((i) => {
      const ortho = mul_v3_fl(AXES[(i + ORTHO_AXIS_OFFSET) % 3], radius(r, center));
      return [0, 1].map((j) => {
        const offset = mul_m3_v3(axis_angle_normalized_to_mat3(AXES[i], DIAL_ANGLE_PARTIAL * (j ? -0.5 : 0.5)), ortho);
        const p = at(r, add_v3(center, offset));
        return p && { axis: i, flip: j === 0, at: p };
      }).filter(Boolean);
    });
  };
  // A dial: the circle about an axis through a center at a radius, or an arc of it centered on `from`.
  const dial = (ctx, r, center, axis, rad, arc = null) => {
    const u = normalize_v3(cross_v3(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), v = cross_v3(axis, u);
    const start = arc ? Math.atan2(dot_v3(arc.from, v), dot_v3(arc.from, u)) - arc.angle / 2 : 0, span = arc ? arc.angle : 2 * Math.PI;
    ctx.beginPath();
    for (let k = 0; k <= 64; k++) {
      const t = start + (span * k) / 64;
      const p = at(r, add_v3(center, add_v3(mul_v3_fl(u, Math.cos(t) * rad), mul_v3_fl(v, Math.sin(t) * rad))));
      if (!p) return;
      if (k) ctx.lineTo(...p);
      else ctx.moveTo(...p);
    }
    ctx.stroke();
  };
  const buttonRadius = INIT_SCALE_BUTTON * GIZMO_SIZE;
  registerGizmoGroupType('MESH_GGT_spin', {
    poll: () => active('MESH_GGT_spin'),
    test_select(event) {
      const r = region(event.view);
      const [x, y] = r ? r.toRegion([event.x, event.y]) : [];
      return (r && spinButtons(r).find((b) => Math.hypot(x - b.at[0], y - b.at[1]) <= buttonRadius)) || null;
    },
    // A click on a button spins about its axis (the gizmo's operator, WM_GIZMO_OPERATOR_TOOL_INIT).
    handle: (event, button) => event.type === 'leftmouse' && event.value === 'PRESS' &&
      !!spin(event, button.flip ? mul_v3_fl(AXES[button.axis], -1) : AXES[button.axis]),
    draw(ctx, r, highlight) {
      const center = cursor(), rad = radius(r, center);
      ctx.lineWidth = 2;
      for (const i of spinAxes()) {
        ctx.strokeStyle = css(AXIS_COLORS[i], highlight?.axis === i ? 1 : 0.6);
        dial(ctx, r, center, AXES[i], rad, highlight?.axis === i ? null : { from: AXES[(i + ORTHO_AXIS_OFFSET) % 3], angle: DIAL_ANGLE_PARTIAL * DIAL_ANGLE_PARTIAL_MARGIN });
      }
      for (const b of spinButtons(r)) {
        const hot = highlight?.axis === b.axis && highlight.flip === b.flip;
        ctx.fillStyle = css(AXIS_COLORS[b.axis], hot ? 1 : 0.6);
        ctx.beginPath();
        ctx.arc(b.at[0], b.at[1], buttonRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = css([1, 1, 1]);
        const s = buttonRadius * 0.55, w = s * 0.3;
        ctx.fillRect(b.at[0] - s, b.at[1] - w, 2 * s, 2 * w);
        ctx.fillRect(b.at[0] - w, b.at[1] - s, 2 * w, 2 * s);
      }
    },
  });

  // Spin's redo: a dial about the spin's axis at its center; dragging it sets the angle the spin re-runs with.
  const redo = () => {
    const last = lastOperation();
    return last?.idname === 'mesh.spin' && last.gizmos?.includes('MESH_GGT_spin_redo') ? last : null;
  };
  const redoDial = (r, last) => {
    const center = last.values.center, axis = normalize_v3(last.values.axis);
    return { center, axis, rad: GIZMO_SIZE * r.pixel_size(center), c: at(r, center) };
  };
  registerGizmoGroupType('MESH_GGT_spin_redo', {
    poll: () => !!redo(),
    test_select(event) {
      const r = region(event.view), last = redo();
      if (!r || !last) return null;
      const d = redoDial(r, last), [x, y] = r.toRegion([event.x, event.y]);
      if (!d.c) return null;
      const rim = at(r, add_v3(d.center, mul_v3_fl(normalize_v3(cross_v3(d.axis, Math.abs(d.axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), d.rad)));
      const rpx = rim ? Math.hypot(rim[0] - d.c[0], rim[1] - d.c[1]) : GIZMO_SIZE;
      return Math.abs(Math.hypot(x - d.c[0], y - d.c[1]) - rpx) <= 8 ? 'angle' : null;
    },
    // gizmo_dial_modal: the angle follows the mouse's turn about the dial's center on screen.
    handle(event) {
      if (event.type !== 'leftmouse' || event.value !== 'CLICK_DRAG') return false;
      const last = redo(), r = region(event.view), d = redoDial(r, last);
      const turn = (e) => Math.atan2(-(e.y - r.rect.top - d.c[1]), e.x - r.rect.left - d.c[0]);
      const facing = dot_v3(d.axis, sub_v3(r.viewinv.position, d.center)) > 0 ? 1 : -1;
      const start = last.values.angle, from = turn(event.press ?? event);
      let previous = from, total = 0;
      const remove = wm.addModal({
        mousemove(e) {
          const now = turn(e);
          total += Math.atan2(Math.sin(now - previous), Math.cos(now - previous));
          previous = now;
          last.apply({ angle: start + facing * total });
          tagRedraw();
        },
        keymap(e) {
          if (e.type === 'leftmouse' && e.value === 'RELEASE') { remove(); return true; }
          if (e.type === 'rightmouse' || e.type === 'esc') { last.apply({ angle: start }); remove(); return true; }
          return true;
        },
        cancel() { last.apply({ angle: start }); remove(); },
      });
      return true;
    },
    draw(ctx, r, highlight) {
      const last = redo();
      if (!last) return;
      const d = redoDial(r, last);
      ctx.lineWidth = 2;
      ctx.strokeStyle = css(highlight ? THEME.gizmo_hi : THEME.gizmo_primary);
      dial(ctx, r, d.center, d.axis, d.rad);
    },
  });
}
