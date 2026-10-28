// The Edit Mode tools' own gizmos, drawn by Bylonder: the generic handles (view3d_gizmo_tool_generic.cc), a circle at
// the selection's center that runs the tool's keymap when dragged (the Free one) or a small button along its normal
// (the Normal one), and Extrude Region's (transform_gizmo_extrude_3d.cc), a button along the normal that extrudes
// along it and a ring that extrudes freely. Off them, drags fall back to the fallback tool (wm-toolsystem.js).
import { add_v3, mul_v3_fl } from '../../blenlib/math-geom.js';
import { registerGizmoGroupType } from '../../windowmanager/wm-gizmo-map.js';
import { css, THEME } from '../../draw/overlay-tool.js';

// U.gizmo_size, and the handles' default radii and fill (handle_free_radius_default, handle_normal_radius_default).
const GIZMO_SIZE = 75, FREE_RADIUS = 36, NORMAL_RADIUS = 100, NORMAL_OFFSET = 12, FREE_FILL_ALPHA = 0.125;
// transform_gizmo_extrude_3d.cc's scales, of the gizmo size.
const BUTTON_SCALE = 0.15, BUTTON_OFFSET = (0.6666 * 1.5) / 0.15, OUTER_SCALE = 1.2;
const PLUS = [[0x73, 0x73], [0x73, 0x36], [0x8c, 0x36], [0x8c, 0x73], [0xc9, 0x73], [0xc9, 0x8c], [0x8c, 0x8c], [0x8c, 0xc9], [0x73, 0xc9], [0x73, 0x8c],
  [0x36, 0x8c], [0x36, 0x73]];

// `stats()` gives the selection's center and normal (calc_gizmo_stats), or null; `toolKeymap(event)` runs the active
// tool's keymap; `extrude(event, { normal })` runs the Extrude Region tool's operator constrained to the normal or not;
// `properties(group)` gives the active tool's settings of a gizmo group (its widget_properties: radius, fill).
export function registerToolGizmos({ region, stats, active, toolKeymap, extrude, properties }) {
  // A gizmo's parts on screen: { part, at: [x, y] client, radius, fill, from }.
  const handle = (r, kind) => {
    const s = stats(), c = s && r.project(s.center);
    if (!c) return [];
    const props = properties(`VIEW3D_GGT_tool_generic_handle_${kind}`);
    if (kind === 'free') return [{ part: 'free', at: c, radius: props.radius ?? FREE_RADIUS, fill: props.backdrop_fill_alpha ?? FREE_FILL_ALPHA }];
    const radius = (props.radius ?? NORMAL_RADIUS) / 12;
    const tip = r.project(add_v3(s.center, mul_v3_fl(s.normal, NORMAL_OFFSET * radius * r.pixel_size(s.center))));
    return tip ? [{ part: 'normal', at: tip, radius, from: c }] : [];
  };
  const extrudeParts = (r) => {
    const s = stats(), c = s && r.project(s.center);
    if (!c) return [];
    const tip = r.project(add_v3(s.center, mul_v3_fl(s.normal, BUTTON_OFFSET * BUTTON_SCALE * GIZMO_SIZE * r.pixel_size(s.center))));
    return [...(tip ? [{ part: 'normal', at: tip, radius: BUTTON_SCALE * GIZMO_SIZE, from: c, plus: true }] : []),
      { part: 'view', at: c, radius: OUTER_SCALE * GIZMO_SIZE, ring: true }];
  };
  const hit = (parts, event) => parts.find(({ at, radius }) => Math.hypot(event.x - at[0], event.y - at[1]) <= radius)?.part ?? null;
  const group = (idname, parts, run) => registerGizmoGroupType(idname, {
    poll: () => active(idname) && !!stats(),
    test_select: (event) => { const r = region(event.view); return r ? hit(parts(r), event) : null; },
    handle: run,
    draw: (ctx, r, highlight) => parts(r).forEach((part) => drawButton(ctx, r, part, part.part === highlight)),
  });
  group('VIEW3D_GGT_tool_generic_handle_free', (r) => handle(r, 'free'), (event) => toolKeymap(event));
  group('VIEW3D_GGT_tool_generic_handle_normal', (r) => handle(r, 'normal'), (event) => toolKeymap(event));
  // Generic Gizmo Maybe Drag: a drag on a part runs its operator.
  group('VIEW3D_GGT_xform_extrude', extrudeParts, (event, part) => event.type === 'leftmouse' && event.value === 'CLICK_DRAG' && extrude(event, { normal: part === 'normal' }));
}

// GIZMO_GT_button_2d and GIZMO_GT_dial_3d as the tools draw them: the gizmo color, white when highlighted; a free
// handle a thin circle with a faint fill, a normal handle a filled button with a line from the center.
function drawButton(ctx, r, { at, radius, fill, from, plus, ring, part }, highlight) {
  const color = highlight ? THEME.gizmo_hi : THEME.gizmo_primary;
  const [x, y] = r.toRegion(at);
  if (from) {
    const [fx, fy] = r.toRegion(from);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(x, y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = css(color);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  if (ring) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = css(color, 0.5);
    ctx.stroke();
    return;
  }
  if (part === 'free') {
    ctx.fillStyle = css(color, fill);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = css(color);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(color);
  ctx.stroke();
  if (plus) {
    // The plus shape (shape_plus, 0..255 across the button's diameter) in a contrasting color.
    ctx.beginPath();
    PLUS.forEach(([px, py], i) => {
      const sx = x + ((px / 255) * 2 - 1) * radius, sy = y - ((py / 255) * 2 - 1) * radius;
      i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgb(0 0 0)';
    ctx.fill();
  }
}
