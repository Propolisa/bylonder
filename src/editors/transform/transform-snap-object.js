// Snapping to the scene's geometry under the mouse (transform_snap_object.cc, snap_object_project_view3d): the nearest
// vertex, else the nearest point of an edge, within a distance in pixels, of what the view shows, else the surface
// hit. Occlusion is "as seen": an element behind the surface under the mouse does not count.
import { Vector3 } from '@babylonjs/core';
import { toBlender } from './transform.js';
import { sub_v3, dot_v3, add_v3, mul_v3_fl, closest_to_line_segment_v2 } from '../../blenlib/math-geom.js';
import { worldAxes } from './transform-mesh.js';

export const SCE_SNAP_TO_VERTEX = 1 << 0, SCE_SNAP_TO_EDGE = 1 << 1, SCE_SNAP_TO_FACE = 1 << 2;
export const SCE_SNAP_TO_GEOM = SCE_SNAP_TO_VERTEX | SCE_SNAP_TO_EDGE | SCE_SNAP_TO_FACE;
// The snap distance (MVAL_MAX_PX_DIST, 12 pixels at UI scale 1).
export const SNAP_DIST_PX = 12;

// `sources()` gives what can be snapped to: [{ node, mesh }] with a node's Babylon world matrix and its Blender Mesh
// (positions in its local Blender axes, and edges).
export function snap_object_project_view3d(region, mval, sources, { elements = SCE_SNAP_TO_GEOM, dist_px = SNAP_DIST_PX } = {}) {
  const surface = region.surface(mval);
  const depth = (co) => -dot_v3(sub_v3(co, region.viewinv.position), region.viewinv.back);
  const visible = (co) => !surface || depth(co) <= depth(surface.co) * (1 + 1e-4) + 1e-4;
  const dist = (p) => Math.hypot(p[0] - mval[0], p[1] - mval[1]);
  let best = null;
  const consider = (type, co, d, node) => {
    if (d <= dist_px && visible(co) && (!best || type < best.type || (type === best.type && d < best.d))) best = { type, co, d, node };
  };
  for (const { node, mesh } of sources()) {
    const m = node.computeWorldMatrix(true), positions = mesh.vert_positions;
    const world = Array.from({ length: mesh.verts_num }, (_, v) =>
      toBlender(Vector3.TransformCoordinates(new Vector3(positions[v * 3], positions[v * 3 + 2], positions[v * 3 + 1]), m)));
    const screen = world.map((co) => region.project(co));
    if (elements & SCE_SNAP_TO_VERTEX) world.forEach((co, v) => screen[v] && consider(0, co, dist(screen[v]), node));
    if (elements & SCE_SNAP_TO_EDGE) {
      for (let e = 0; e < mesh.edges_num; e++) {
        const [a, b] = [mesh.edges[e * 2], mesh.edges[e * 2 + 1]];
        if (!screen[a] || !screen[b]) continue;
        const p = closest_to_line_segment_v2(mval, screen[a], screen[b]);
        const along = Math.hypot(screen[b][0] - screen[a][0], screen[b][1] - screen[a][1]);
        const t = along ? Math.hypot(p[0] - screen[a][0], p[1] - screen[a][1]) / along : 0;
        consider(1, edgePoint(region, world[a], world[b], t), dist(p), node);
      }
    }
  }
  if (best) return { type: best.type === 0 ? SCE_SNAP_TO_VERTEX : SCE_SNAP_TO_EDGE, co: best.co, no: null, node: best.node, axes: worldAxes(best.node.computeWorldMatrix(true)) };
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
