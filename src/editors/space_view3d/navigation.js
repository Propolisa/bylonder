import { Camera, Quaternion, Vector3 } from "@babylonjs/core";
import { toBabylon } from "./view3d-project.js";
// The 3D View's lens: View3D.lens 50 mm on the 36 mm viewport sensor at the viewport's zoom of 2
// (CAMERA_PARAM_ZOOM_INIT_PERSP), as the tangent of half its angle, fitted to the longer side.
export const LENS_HALF_TAN = (36 / 2 / 50) * 2;
// RegionView3D.persp and RegionView3D.view (DNA_view3d_types.h, RV3D_VIEW_*).
export const RV3D_ORTHO = 0, RV3D_PERSP = 1, RV3D_CAMOB = 2;
const VIEW_NAMES = ["User", "Front", "Back", "Left", "Right", "Top", "Bottom"];
// An orthographic camera's bounds for a view of the given aspect, halfHeight up from its center.
export const fitOrtho = (camera, halfHeight, aspect) =>
  Object.assign(camera, { orthoTop: halfHeight, orthoBottom: -halfHeight, orthoLeft: -halfHeight * aspect, orthoRight: halfHeight * aspect });
// A scene camera, while orthographic, takes its bounds from Blender's Orthographic Scale (6 unless set), which spans the
// longer side of each view it renders (sensor fit Auto). Getters, as Babylon computes a projection before its camera
// render observers run; the scale is Main's, so Babylon's own writes are ignored.
const ORTHO_SIDES = { orthoTop: [1, 0], orthoBottom: [-1, 0], orthoLeft: [0, -1], orthoRight: [0, 1] };
const fitted = new WeakSet();
// A camera view's half width and height in scene units, where it shows more than the scale spans (camera view).
const orthoViews = new WeakMap();
export const setOrthoView = (camera, halfExtents) => (halfExtents ? orthoViews.set(camera, halfExtents) : orthoViews.delete(camera));
export function fitsOrthoScale(camera) {
  if (fitted.has(camera)) return camera;
  fitted.add(camera);
  const aspect = () => camera.getEngine().getAspectRatio(camera);
  const half = () => (camera.metadata?.orthoScale ?? 6) / 2 / Math.max(aspect(), 1);
  for (const [side, [up, right]] of Object.entries(ORTHO_SIDES)) {
    const get = () => { const view = orthoViews.get(camera); return view ? up * view[1] + right * view[0] : half() * (up || right * aspect()); };
    Object.defineProperty(camera, side, { configurable: true, get, set() {} });
  }
  return camera;
}

// The editor camera of one 3D Viewport, placed where the view's RegionView3D says. Blender's navigation operators
// (view3d.rotate, move, zoom, dolly, view_axis, view_all, view_selected, view_persportho, and the trackpad's) change
// the RegionView3D in the module, with the Preferences' navigation settings; the camera follows it (`follow`).
// onSync(): the view's label needs updating.
export function createNavigation({ camera, engine, onSync = () => {} }) {
  let viewName = "User", last = null;
  const updateBounds = () => {
    if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA) fitOrtho(camera, camera.radius * Math.tan(camera.fov / 2), engine.getAspectRatio(camera));
  };
  const sync = () => {
    updateBounds();
    onSync();
  };
  return {
    sync,
    updateBounds,
    get viewName() { return viewName; },
    // The camera at view3d_viewmatrix_set's view of the RegionView3D (ofs, viewquat, dist, persp, view in Blender's
    // axes): looking at -ofs from dist away, along and up the inverse view rotation.
    follow(rv3d) {
      const values = [...rv3d.ofs, ...rv3d.viewquat, rv3d.dist, rv3d.persp, rv3d.view];
      if (last && values.every((v, i) => Math.abs(v - last[i]) < 1e-6)) return;
      last = values;
      const [w, x, y, z] = rv3d.viewquat, inverse = new Quaternion(-x, -y, -z, w);
      const target = new Vector3(-rv3d.ofs[0], -rv3d.ofs[1], -rv3d.ofs[2]);
      const back = new Vector3(0, 0, 1).applyRotationQuaternion(inverse), up = new Vector3(0, 1, 0).applyRotationQuaternion(inverse);
      camera.upVector = toBabylon(up.asArray());
      camera.setTarget(toBabylon(target.asArray()));
      camera.setPosition(toBabylon(target.add(back.scale(rv3d.dist)).asArray()));
      if (rv3d.persp !== RV3D_CAMOB) camera.mode = rv3d.persp === RV3D_ORTHO ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
      viewName = VIEW_NAMES[rv3d.view] ?? "User";
      sync();
    },
  };
}
