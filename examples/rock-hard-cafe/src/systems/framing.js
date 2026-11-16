// The camera's frame: the Play Area (a box empty in the .blend, around the counter, the barista's reach and the rock's
// spot), widened to the barista's lane along it, fills the view at any shape of the Game area or page. Each frame starts
// from the camera as authored (game.camera.authored, which edits in Blender keep current): it keeps that direction and
// moves sideways from that place to centre the frame, so moving the camera in the 3D View moves the game's view.
// In portrait the camera rolls a quarter turn, so the counter runs along the long side of an upright phone and shows
// twice as large. Orientation (the board's button) is Auto, Portrait or Landscape: Auto takes portrait while the game's
// view is taller than wide, decided each frame from the view's own shape.
import { Axis, Camera, Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { defineSystem, enumOf } from 'bylonder';

export const ORIENTATIONS = ['Auto', 'Portrait', 'Landscape'];

/** Room around the barista's body, in metres. */
const BODY = 0.4;
const inScene = new Vector3(), at = new Vector3(), side = new Vector3(), rise = new Vector3();
const QUARTER = Quaternion.RotationAxis(Axis.Z, Math.PI / 2);

export default defineSystem({
  name: 'Framing',
  props: { orientation: enumOf(ORIENTATIONS) },
  create({ game, babylon, props }) {
    const scene = babylon.scene;
    let corners = null, orientation = props.orientation, portrait = false;
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
      /** Auto, Portrait or Landscape. */
      get orientation() { return orientation; },
      set orientation(value) { if (ORIENTATIONS.includes(value)) orientation = value; },
      /** Whether the view is framed for portrait (the camera rolled). */
      get portrait() { return portrait; },
      update() {
        const camera = scene.activeCamera, area = scene.getTransformNodeByName('Play Area');
        if (!camera || !area) return;
        const aspect = scene.getEngine().getAspectRatio(camera);
        const { position, rotation } = game.camera.authored;
        camera.position.copyFrom(position);
        camera.rotationQuaternion = (camera.rotationQuaternion ?? new Quaternion()).copyFrom(rotation);
        portrait = orientation === 'Auto' ? aspect < 1 : orientation === 'Portrait';
        if (portrait) camera.rotationQuaternion.multiplyInPlace(QUARTER);
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
