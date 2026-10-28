// A 3D View's projection in Blender's terms (view3d_project.cc, view3d_utils.cc) over its Babylon camera: Blender world
// points (Z up) to client pixels and back, and the view's axes (RegionView3D.viewinv).
import { Matrix, Ray, Vector3 } from '@babylonjs/core';
import { toBabylon, toBlender, toBlenderView } from '../transform/transform.js';
import { worldAxes } from '../transform/transform-mesh.js';
import { add_v3, mul_v3_fl, sub_v3, dot_v3, normalize_v3, isect_ray_plane_v3_factor } from '../../blenlib/math-geom.js';

export function viewProjection(view) {
  const { camera, canvas } = view;
  const rect = canvas.getBoundingClientRect(), width = canvas.width, height = canvas.height;
  const transform = camera.getTransformationMatrix(), viewport = { x: 0, y: 0, width, height };
  const toCanvas = (x, y) => [((x - rect.left) * width) / rect.width, ((y - rect.top) * height) / rect.height];
  const persp = camera.mode === 0;
  const viewinv = {
    right: toBlender(camera.getDirection(Vector3.Right())), up: toBlender(camera.getDirection(Vector3.Up())),
    back: toBlender(camera.getDirection(Vector3.Forward()).negate()), position: toBlender(camera.globalPosition),
  };
  const unproject = (x, y, z) => toBlender(Vector3.Unproject(new Vector3(...toCanvas(x, y), z), width, height, Matrix.Identity(), camera.getViewMatrix(), camera.getProjectionMatrix()));
  const api = {
    view, rect, persp, viewinv,
    // A client point in the region's pixels as Blender's events have it (y up), and back.
    toBlenderRegion: ([x, y]) => [x - rect.left, rect.height - (y - rect.top)],
    // A client point relative to the region's top left, as the tool overlay draws.
    toRegion: ([x, y]) => [x - rect.left, y - rect.top],
    // RegionView3D.ofs negated: the point the view orbits.
    center: camera.target ? toBlender(camera.target) : add_v3(viewinv.position, mul_v3_fl(viewinv.back, -10)),
    // ED_view3d_project_float_global with V3D_PROJ_TEST_CLIP_NEAR: client pixels, or null behind the near plane.
    project(co) {
      const p = Vector3.Project(toBabylon(co), Matrix.Identity(), transform, viewport);
      return p.z < 0 || p.z > 1 ? null : [rect.left + (p.x * rect.width) / width, rect.top + (p.y * rect.height) / height];
    },
    // ED_view3d_win_to_ray: the ray from the view through a client point, origin and normalized direction.
    ray([x, y]) {
      const near = unproject(x, y, 0), far = unproject(x, y, 1);
      return { origin: near, direction: normalize_v3(sub_v3(far, near)) };
    },
    // ED_view3d_win_to_3d: the point under a client point on the view plane through `depth`.
    win_to_3d(depth, mval) {
      const { origin, direction } = api.ray(mval);
      const factor = isect_ray_plane_v3_factor(origin, direction, depth, viewinv.back);
      return factor === null ? depth : add_v3(origin, mul_v3_fl(direction, factor));
    },
    // ED_view3d_win_to_3d_on_plane: the point under a client point on a plane, or null when the ray misses it.
    win_to_3d_on_plane(plane_co, plane_no, mval) {
      const { origin, direction } = api.ray(mval);
      const factor = isect_ray_plane_v3_factor(origin, direction, plane_co, plane_no);
      return factor === null || factor < 0 ? null : add_v3(origin, mul_v3_fl(direction, factor));
    },
    // ED_view3d_calc_zfac_ex's flip: whether a point is behind the view.
    behind: (co) => persp && dot_v3(sub_v3(co, viewinv.position), viewinv.back) > 0,
    // ED_view3d_pixel_size: the world size of a pixel at a point.
    pixel_size(co) {
      const depth = persp ? Math.max(1e-6, -dot_v3(sub_v3(co, viewinv.position), viewinv.back)) : (camera.orthoTop - camera.orthoBottom) / 2;
      return (2 * depth * (persp ? Math.tan(camera.fov / 2) : 1)) / rect.height;
    },
    // The scene's geometry under a client point, as a depth read of the view finds it (ED_view3d_autodist): its point,
    // face normal and object's axes (Blender world), or null. `accept(mesh)` limits what counts.
    surface([x, y], accept = drawn) {
      const scene = camera.getScene(), k = view.scale ?? 1;
      const hit = scene.pick((x - rect.left) * k, (y - rect.top) * k, accept, false, camera);
      if (!hit?.hit) return null;
      const mesh = hit.pickedMesh;
      return { co: toBlender(hit.pickedPoint), no: toBlender(hit.getNormal(true, true)), mesh, axes: worldAxes(mesh.computeWorldMatrix(true)) };
    },
    // The first drawn geometry along a ray (Blender world), or null.
    ray_cast(origin, direction, accept = drawn) {
      const hit = camera.getScene().pickWithRay(new Ray(toBabylon(origin), toBabylon(normalize_v3(direction)), 1e6), accept);
      return hit?.hit ? toBlender(hit.pickedPoint) : null;
    },
  };
  return api;
}

// What a depth read of the 3D View sees: drawn scene geometry, not overlays or helpers.
export const drawn = (mesh) => mesh.isEnabled() && mesh.isVisible && mesh.isPickable !== false && !mesh.metadata?.overlay &&
  !mesh.name.startsWith('__') && mesh.getTotalVertices() > 0;

// The view as Blender's RegionView3D has it: its view and window matrices (Blender's axes, column-major, the window
// matrix Babylon's projection of a view looking down -Z), its size in pixels and whether it is a perspective view.
export function regionView3D({ camera, canvas }) {
  const winmat = Array.from(camera.getProjectionMatrix().m, (v, i) => (i >= 8 && i < 12 ? -v : v));
  return { viewmat: toBlenderView(camera.getViewMatrix()), winmat, winx: canvas.clientWidth, winy: canvas.clientHeight, persp: camera.mode === 0 };
}
