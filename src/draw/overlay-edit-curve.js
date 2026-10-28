// Edit Mode overlay of a curve (overlay_edit_curve.cc, draw_cache_impl_curve.cc): Bezier handles colored by their type
// and selection, the lines between the points of other splines, and the points, in the theme's colors. The curve itself
// is the object's evaluated wire. Handles show for selected points (View3DOverlay.display_handle SELECTED) or all.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { view_3d as theme, curves } from '../editors/interface/userdef-default-theme.js';
import { overlayMaterial } from './overlay-edit-mesh.js';

const ACTIVE = [1, 1, 1, 1];
const HANDLE = { FREE: 'free', AUTO: 'auto', VECTOR: 'vect', ALIGNED: 'align' };
const handleColor = (type, selected) => curves[`handle_${selected ? 'sel_' : ''}${HANDLE[type]}`];

export function createEditCurveOverlay(owner) {
  const scene = owner.getScene();
  const part = (name, options) => {
    const mesh = new Mesh(`${owner.name} ${name}`, scene);
    mesh.parent = owner;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh._getRenderingFillMode = (fillMode) => fillMode;
    mesh.material = overlayMaterial(scene, `${owner.name} ${name}`, options);
    return mesh;
  };
  const lines = part('edit curve lines', { fillMode: Material.LineListDrawMode, depthUnits: 4e-5, slopeScale: 4 });
  const points = part('edit curve points', { fillMode: Material.PointListDrawMode, pointSize: theme.vertex_size * 2, depthUnits: 6e-5, slopeScale: 0 });
  const handlePoints = part('edit curve handle points', { fillMode: Material.PointListDrawMode, pointSize: curves.handle_vertex_size, depthUnits: 6e-5, slopeScale: 0, round: 1 });

  const fill = (mesh, vertices) => {
    mesh.geometry?.dispose();
    if (!vertices.length) return mesh.setEnabled(false);
    const data = new VertexData();
    data.positions = vertices.flatMap(([[x, y, z]]) => [x, z, y]);
    data.colors = vertices.flatMap(([, color]) => color);
    data.indices = vertices.map((_, i) => i);
    data.applyToMesh(mesh, true);
    mesh.setEnabled(true);
  };

  return {
    // Redraws from Curve data (blenkernel/curve/curve.js) with its active point, showing handles as `handles` says
    // (SELECTED, ALL or NONE).
    update({ splines, active = [-1, -1] }, { handles = 'SELECTED' } = {}) {
      const line = [], point = [], handle = [];
      splines.forEach((spline, s) => {
        if (spline.hide) return;
        if (spline.bezier_points) {
          spline.bezier_points.forEach((p, i) => {
            if (p.hide) return;
            const any = p.select_left_handle || p.select_control_point || p.select_right_handle;
            const isActive = active[0] === s && active[1] === i;
            point.push([p.co, isActive ? ACTIVE : p.select_control_point ? theme.vertex_select : theme.vertex]);
            if (handles === 'NONE' || (handles === 'SELECTED' && !any)) return;
            for (const [co, type, selected] of [[p.handle_left, p.handle_left_type, p.select_left_handle], [p.handle_right, p.handle_right_type, p.select_right_handle]]) {
              const color = handleColor(type, selected);
              line.push([p.co, color], [co, color]);
              handle.push([co, selected ? curves.handle_vertex_select : curves.handle_vertex]);
            }
          });
          return;
        }
        const u = spline.point_count_u, v = spline.point_count_v, at = (i, j) => spline.points[j * u + i];
        const edge = (a, b) => { if (!a.hide && !b.hide) { const color = a.select && b.select ? theme.nurb_sel_uline : theme.nurb_uline; line.push([a.co, color], [b.co, color]); } };
        for (let j = 0; j < v; j++) {
          for (let i = 0; i + 1 < u; i++) edge(at(i, j), at(i + 1, j));
          if (spline.flagu & 1 && u > 2) edge(at(u - 1, j), at(0, j));
        }
        spline.points.forEach((p, i) => {
          if (!p.hide) point.push([p.co, active[0] === s && active[1] === i ? ACTIVE : p.select ? theme.vertex_select : theme.vertex]);
        });
      });
      fill(lines, line);
      fill(points, point);
      fill(handlePoints, handle);
    },
    dispose() { for (const mesh of [lines, points, handlePoints]) { mesh.material.dispose(); mesh.dispose(); } },
  };
}
