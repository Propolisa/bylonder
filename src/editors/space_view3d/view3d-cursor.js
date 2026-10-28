// Set 3D Cursor (view3d_edit.cc: VIEW3D_OT_cursor3d): the cursor goes under the mouse on the surface there, or at its
// own depth, and turns to the view, the transform orientation or the surface; and the cursor as transform data
// (transform_convert_cursor.cc), which the Cursor tool and Shift right drag move. Rotations are matrices of three
// columns; Blender's quaternions here give the same rotations.
import { add_v3, sub_v3, dot_v3, normalize_v3, negate_v3, angle_normalized_v3v3, project_plane_v3_v3v3, axis_dominant_v3_ortho_single } from '../../blenlib/math-geom.js';
import { mul_m3_m3m3, unit_m3 } from '../../blenlib/math-matrix.js';
import { rotation_between_vecs_to_mat3 } from '../../blenlib/math-rotation.js';
import { cursorRotationMatrix, cursorRotationSet } from '../../blenkernel/scene/cursor.js';

// The depth margin of ED_view3d_autodist, in pixels: the nearest surface within it gives the depth.
const AUTODIST_MARGIN = 4;

// ED_view3d_cursor3d_position: the point under the mouse on the nearest surface around it (use_depth), else on the view
// plane through the cursor, or through the view's center when the cursor is behind the view.
export function cursor3d_position(region, mval, use_depth, location) {
  const depth_pt = region.behind(location) ? region.center : location;
  if (use_depth) {
    const depth = (co) => -dot_v3(sub_v3(co, region.viewinv.position), region.viewinv.back);
    const hits = [-AUTODIST_MARGIN, 0, AUTODIST_MARGIN].flatMap((dy) => [-AUTODIST_MARGIN, 0, AUTODIST_MARGIN]
      .map((dx) => region.surface([mval[0] + dx, mval[1] + dy]))).filter(Boolean);
    const nearest = hits.reduce((best, hit) => (!best || depth(hit.co) < depth(best.co) ? hit : best), null);
    if (nearest) return region.win_to_3d(nearest.co, mval);
  }
  return region.win_to_3d(depth_pt, mval);
}

// ED_view3d_cursor3d_position_rotation: location and rotation for `orientation` NONE, VIEW (rv3d->viewquat inverted: X
// right, Y up, Z toward the viewer), XFORM (`xform()`, the transform orientation) or GEOM (Z along the surface's
// normal, rolled the shortest way to its object's axis least aligned with it).
export function cursor3d_position_rotation(region, mval, { use_depth, orientation, cursor, xform = unit_m3 }) {
  let location = cursor3d_position(region, mval, use_depth, cursor.location), mat = cursorRotationMatrix(cursor);
  const view = [region.viewinv.right, region.viewinv.up, region.viewinv.back];
  if (orientation === 'VIEW') mat = view;
  else if (orientation === 'XFORM') mat = xform();
  else if (orientation === 'GEOM') {
    mat = view;
    const hit = region.surface(mval);
    if (hit) {
      if (use_depth) location = hit.co;
      const ray_no = normalize_v3(hit.no);
      mat = mul_m3_m3m3(rotation_between_vecs_to_mat3(mat[2], ray_no), mat);
      const obmat = hit.axes, ortho_axis = axis_dominant_v3_ortho_single(obmat.map((axis) => dot_v3(ray_no, axis)));
      const tan_dst = normalize_v3(project_plane_v3_v3v3(obmat[ortho_axis], ray_no));
      let best = null, angle_best = -1;
      for (let axis = 0; axis < 2; axis++) {
        for (const tan_src of [mat[axis], negate_v3(mat[axis])]) {
          const angle = angle_normalized_v3v3(tan_src, tan_dst);
          if (angle < angle_best || angle_best === -1) { angle_best = angle; best = rotation_between_vecs_to_mat3(tan_src, tan_dst); }
        }
      }
      mat = mul_m3_m3m3(best, mat);
    }
  }
  return { location, mat };
}

// ED_view3d_cursor3d_update: the scene cursor moved there, its rotation kept in its rotation mode.
export function cursor3d_update(region, mval, props, settings, xform) {
  const cursor = settings.state.cursor;
  const { location, mat } = cursor3d_position_rotation(region, mval, { ...props, cursor, xform });
  const changed = props.orientation !== 'NONE' && mat.flat().some((x, i) => x !== cursorRotationMatrix(cursor).flat()[i]);
  settings.setCursor({ location, ...(changed ? cursorRotationSet(cursor, mat) : {}) });
}

// The cursor as transform data: its location moves.
export function createTransCursor(settings) {
  const iloc = [...settings.state.cursor.location];
  const set = (location) => settings.setCursor({ location });
  return { center: iloc, local: unit_m3(), apply: (mat, center, translation) => set(add_v3(iloc, translation)), restore: () => set(iloc) };
}
