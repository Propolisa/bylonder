// Snapping to the scene's geometry under the mouse (transform_snap_object.cc, snap_object_project_view3d): the nearest
// vertex, else the nearest edge, within a distance in pixels, of what the view shows, refined to its middle, the
// point perpendicular to a previous point or an end as snap_edge_points_impl does; else the surface hit. Occlusion is
// "as seen": an element behind the surface under the mouse does not count.
import { Vector3 } from '@babylonjs/core';
import { toBlender, worldAxes } from '../space_view3d/view3d-project.js';
import { sub_v3, dot_v3, add_v3, mul_v3_fl, closest_to_line_segment_v2, line_point_factor_v3, interp_v3 } from '../../blenlib/math-geom.js';

// eSnapMode (DNA_scene_types.h).
export const SCE_SNAP_TO_POINT = 1 << 0, SCE_SNAP_TO_EDGE_MIDPOINT = 1 << 1, SCE_SNAP_TO_EDGE_ENDPOINT = 1 << 2,
  SCE_SNAP_TO_EDGE_PERPENDICULAR = 1 << 3, SCE_SNAP_TO_EDGE = 1 << 4, SCE_SNAP_TO_FACE = 1 << 5;
export const SCE_SNAP_TO_VERTEX = SCE_SNAP_TO_POINT | SCE_SNAP_TO_EDGE_ENDPOINT;
export const SCE_SNAP_TO_GEOM = SCE_SNAP_TO_VERTEX | SCE_SNAP_TO_EDGE | SCE_SNAP_TO_FACE | SCE_SNAP_TO_EDGE_MIDPOINT |
  SCE_SNAP_TO_EDGE_PERPENDICULAR;
// The snap distance (MVAL_MAX_PX_DIST, 12 pixels at UI scale 1).
export const SNAP_DIST_PX = 12;

// `sources()` gives what can be snapped to: [{ node, mesh }] with a node's Babylon world matrix and its Blender Mesh
// (positions in its local Blender axes, and edges); `prev` the point a perpendicular snap is perpendicular from.
export function snap_object_project_view3d(region, mval, sources, { elements = SCE_SNAP_TO_GEOM, dist_px = SNAP_DIST_PX, prev = null } = {}) {
  const surface = region.surface(mval);
  const depth = (co) => -dot_v3(sub_v3(co, region.viewinv.position), region.viewinv.back);
  const visible = (co) => !surface || depth(co) <= depth(surface.co) * (1 + 1e-4) + 1e-4;
  const dist = (p) => Math.hypot(p[0] - mval[0], p[1] - mval[1]);
  let best = null;
  const consider = (type, co, d, node, edge = null) => {
    if (d <= dist_px && visible(co) && (!best || type < best.type || (type === best.type && d < best.d))) best = { type, co, d, node, edge };
  };
  // snap_edge_points_impl: the edge's middle, the point perpendicular to `prev` or an end, when within the distance;
  // the factor along the edge picks which are tried.
  const edgePoints = ({ edge: [a, b, lambda], co }) => {
    const within = (point) => { const s = region.project(point); return s && dist(s) <= dist_px; };
    const modes = [SCE_SNAP_TO_EDGE, SCE_SNAP_TO_EDGE_ENDPOINT, SCE_SNAP_TO_EDGE_MIDPOINT].filter((mode) => elements & mode).length;
    let range = 1 / (2 * modes - 1), result = { co, snap: SCE_SNAP_TO_EDGE };
    if (elements & SCE_SNAP_TO_EDGE_MIDPOINT) {
      range *= modes - 1;
      const mid = interp_v3(a, b, 0.5);
      if (range < lambda && lambda < 1 - range && within(mid)) result = { co: mid, snap: SCE_SNAP_TO_EDGE_MIDPOINT };
    }
    if (elements & SCE_SNAP_TO_EDGE_PERPENDICULAR && prev) {
      const t = line_point_factor_v3(prev, a, b), near = interp_v3(a, b, t);
      if (t >= 0 && t <= 1 && within(near)) result = { co: near, snap: SCE_SNAP_TO_EDGE_PERPENDICULAR };
    }
    if (elements & SCE_SNAP_TO_EDGE_ENDPOINT && (lambda < range || 1 - range < lambda)) {
      const end = lambda < 0.5 ? a : b;
      if (within(end)) result = { co: end, snap: SCE_SNAP_TO_EDGE_ENDPOINT };
    }
    return result;
  };
  for (const { node, mesh } of sources()) {
    const m = node.computeWorldMatrix(true), positions = mesh.vert_positions;
    const world = Array.from({ length: mesh.verts_num }, (_, v) =>
      toBlender(Vector3.TransformCoordinates(new Vector3(positions[v * 3], positions[v * 3 + 2], positions[v * 3 + 1]), m)));
    const screen = world.map((co) => region.project(co));
    if (elements & SCE_SNAP_TO_POINT) world.forEach((co, v) => screen[v] && consider(0, co, dist(screen[v]), node));
    if (elements & (SCE_SNAP_TO_EDGE | SCE_SNAP_TO_EDGE_MIDPOINT | SCE_SNAP_TO_EDGE_PERPENDICULAR)) {
      for (let e = 0; e < mesh.edges_num; e++) {
        const [a, b] = [mesh.edges[e * 2], mesh.edges[e * 2 + 1]];
        if (!screen[a] || !screen[b]) continue;
        const p = closest_to_line_segment_v2(mval, screen[a], screen[b]);
        const along = Math.hypot(screen[b][0] - screen[a][0], screen[b][1] - screen[a][1]);
        const t = along ? Math.hypot(p[0] - screen[a][0], p[1] - screen[a][1]) / along : 0;
        consider(1, edgePoint(region, world[a], world[b], t), dist(p), node, [world[a], world[b], t]);
      }
    }
  }
  if (best?.edge) Object.assign(best, edgePoints(best, elements));
  if (best) return { type: best.type === 0 ? SCE_SNAP_TO_POINT : best.snap, co: best.co, no: null, node: best.node, axes: worldAxes(best.node.computeWorldMatrix(true)) };
  if (surface && elements & SCE_SNAP_TO_FACE) return { type: SCE_SNAP_TO_FACE, co: surface.co, no: surface.no, node: surface.mesh, axes: surface.axes };
  return null;
}

// The point of an edge whose projection lies a factor `t` along its projected segment: perspective undoes the
// screen's linear factor.
function edgePoint(region, a, b, t) {
  if (!region.persp) return add_v3(a, mul_v3_fl(sub_v3(b, a), t));
  const depth = (co) => -dot_v3(sub_v3(co, region.viewinv.position), region.viewinv.back);
  const da = depth(a), db = depth(b), u = (t * da) / (t * da + (1 - t) * db || 1);
  return add_v3(a, mul_v3_fl(sub_v3(b, a), u));
}
