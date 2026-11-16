// The camera's frame: the play area (area.js, with the barista's lane, which he never walks out of) fills the view at
// any shape of the Game area or page, never following him. Each frame starts from the camera as authored
// (game.camera.authored, which edits in Blender keep current): it keeps that direction, takes its field of view along
// the view's longer side, and moves across, up and back from that place until the area just fits, so moving the camera
// in the 3D View moves the game's view. An upright view fits the counter's width, a wide one its depth; the camera never
// rolls.
import { Camera, Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { defineSystem, float } from 'bylonder';
import { playArea } from '../area.js';

/** Room around the area, as a share of the view. */
const MARGIN = 1.03;
/** How much of the room to spare up the view goes above the area: 0 halves it, 1 puts it all above. */
const ABOVE = 0.4;
const inScene = new Vector3(), at = new Vector3(), place = new Vector3(), toScene = new Matrix();

/** Sets the field of view along the side the camera holds now, which a page may keep along its render's frame: set,
 * then corrected by how the camera reads it back along that side. */
function setFov(camera, want) {
  camera.fov = want;
  const got = camera.fov;
  if (Math.abs(got - want) > 1e-6) camera.fov = 2 * Math.atan(Math.tan(want / 2) ** 2 / Math.tan(got / 2));
}

/** The place along one side of the view that centres `points` ([across or up, ahead]) in a half field of view of
 * tangent `tan`, and how far back of the authored place they all fit. */
function fit(points, tan) {
  let low = -Infinity, high = Infinity;
  for (const [x, ahead] of points) { low = Math.max(low, x - tan * ahead); high = Math.min(high, x + tan * ahead); }
  return { centre: (low + high) / 2, back: (low - high) / (2 * tan) };
}

export default defineSystem({
  name: 'Framing',
  props: { fov: float(48, { min: 10, max: 120, unit: 'deg', description: "The field of view along the view's longer side" }) },
  create({ game, babylon, props }) {
    const scene = babylon.scene;
    let corners = null;
    return {
      update() {
        const camera = scene.activeCamera, area = playArea(scene);
        if (!camera || !area) return;
        const { position, rotation } = game.camera.authored;
        camera.position.copyFrom(position);
        camera.rotationQuaternion = (camera.rotationQuaternion ?? new Quaternion()).copyFrom(rotation);
        const aspect = scene.getEngine().getAspectRatio(camera), long = Math.tan((props.fov * Math.PI) / 360);
        const [across, up] = aspect >= 1 ? [long, long / aspect] : [long * aspect, long];
        setFov(camera, 2 * Math.atan(camera.fovMode === Camera.FOVMODE_VERTICAL_FIXED ? up : across));
        // The area's corners seen from the authored place: across and up the view, and how far ahead.
        const view = camera.getViewMatrix(true), world = area.node.computeWorldMatrix(true), ahead = scene.useRightHandedSystem ? -1 : 1;
        const { min, max } = area;
        corners ??= [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => new Vector3(x, y, z))));
        const seen = corners.map((corner) => {
          Vector3.TransformCoordinatesToRef(Vector3.TransformCoordinatesToRef(corner, world, inScene), view, at);
          return [at.x, at.y, at.z * ahead];
        });
        const x = fit(seen.map(([x, , z]) => [x, z]), across / MARGIN), y = fit(seen.map(([, y, z]) => [y, z]), up / MARGIN);
        // Room to spare up the view goes mostly above the area: the barista low in the view, the rocks' way in above.
        const back = Math.max(x.back, y.back), rise = y.centre + (back - y.back) * (up / MARGIN) * ABOVE;
        // That place, from the view's space into the camera's parent's, which its position is in.
        view.invertToRef(toScene);
        if (camera.parent) toScene.multiplyToRef(Matrix.Invert(camera.parent.computeWorldMatrix(true)), toScene);
        Vector3.TransformCoordinatesToRef(place.set(x.centre, rise, -back * ahead), toScene, camera.position);
      },
    };
  },
});
