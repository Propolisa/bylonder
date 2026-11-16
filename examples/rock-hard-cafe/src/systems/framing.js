// The camera's frame: the Play Area (a box empty in the .blend, around the counter, the barista's reach and the rock's
// spot), widened to the barista's lane along it, fills the view at any shape of the Game area or page, the camera
// keeping its direction as authored and moving sideways from its place to centre the frame.
// On a screen taller than wide (a phone upright) the camera rolls a quarter turn, so the counter runs along the long
// side and shows twice as large.
import { Axis, Camera, Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { defineSystem } from 'bylonder';

/** Room around the barista's body, in metres. */
const BODY = 0.4;
const inScene = new Vector3(), at = new Vector3(), side = new Vector3(), rise = new Vector3();
const QUARTER = Quaternion.RotationAxis(Axis.Z, Math.PI / 2), BACK = Quaternion.RotationAxis(Axis.Z, -Math.PI / 2);

/** `camera` rolled a quarter turn about its view (`on`) or back. */
function roll(camera, on) {
  if (camera.rotationQuaternion) camera.rotationQuaternion.multiplyInPlace(on ? QUARTER : BACK);
  else camera.rotation.z += on ? Math.PI / 2 : -Math.PI / 2;
}

export default defineSystem({
  name: 'Framing',
  create({ babylon }) {
    const scene = babylon.scene;
    let rolled = false, corners = null, authored = null;
    /** The Play Area's corners in its own space, its box grown to take in the barista's lane (where he stands at the start). */
    const lane = (area) => {
      const min = new Vector3(-1, -1, -1), max = new Vector3(1, 1, 1), barista = scene.getNodeByName('Barista');
      if (barista) {
        const world = area.computeWorldMatrix(true), local = Vector3.TransformCoordinates(barista.getAbsolutePosition(), Matrix.Invert(world));
        const room = new Vector3(BODY / world.getRow(0).toVector3().length(), 0, BODY / world.getRow(2).toVector3().length());
        min.minimizeInPlace(local.subtract(room));
        max.maximizeInPlace(local.add(room));
      }
      return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => new Vector3(x, y, z))));
    };
    return {
      update() {
        const camera = scene.activeCamera, area = scene.getTransformNodeByName('Play Area');
        if (!camera || !area) return;
        const aspect = scene.getEngine().getAspectRatio(camera);
        if (aspect < 1 !== rolled) roll(camera, (rolled = aspect < 1));
        authored ??= camera.position.clone();
        camera.position.copyFrom(authored);
        const view = camera.getViewMatrix(true), world = area.computeWorldMatrix(true);
        // Where the area's corners are seen from the authored place, across and up the view, and how far.
        let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity, depth = 0;
        corners ??= lane(area);
        for (const corner of corners) {
          Vector3.TransformCoordinatesToRef(Vector3.TransformCoordinatesToRef(corner, world, inScene), view, at);
          left = Math.min(left, at.x / at.z); right = Math.max(right, at.x / at.z);
          bottom = Math.min(bottom, at.y / at.z); top = Math.max(top, at.y / at.z);
          depth += at.z / corners.length;
        }
        // The camera moved sideways to their middle, so the frame needs only their half extents.
        camera.getDirectionToRef(Axis.X, side);
        camera.getDirectionToRef(Axis.Y, rise);
        camera.position.addInPlace(side.scaleInPlace(((left + right) / 2) * depth)).addInPlace(rise.scaleInPlace(((bottom + top) / 2) * depth));
        const across = (right - left) / 2, up = (top - bottom) / 2;
        // The field of view along the side the camera holds now, which a page may keep along its render's frame: set,
        // then corrected by how the camera reads it back along that side.
        const vertical = camera.fovMode === Camera.FOVMODE_VERTICAL_FIXED;
        const want = 2 * Math.atan(1.03 * (vertical ? Math.max(up, across / aspect) : Math.max(across, up * aspect)));
        camera.fov = want;
        const got = camera.fov;
        if (Math.abs(got - want) > 1e-6) camera.fov = 2 * Math.atan(Math.tan(want / 2) ** 2 / Math.tan(got / 2));
      },
    };
  },
});
