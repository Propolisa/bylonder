// The camera's frame: the Play Area (a box empty in the .blend, around the counter, the barista's reach and the rock's
// spot) fills the view at any shape of the Game area or page, the camera keeping its place and direction as authored.
import { Camera, Vector3 } from '@babylonjs/core';
import { defineSystem } from 'bylonder';

const CORNERS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x, y, z))));

export default defineSystem({
  name: 'Framing',
  create({ babylon }) {
    const scene = babylon.scene;
    return {
      update() {
        const camera = scene.activeCamera, area = scene.getTransformNodeByName('Play Area');
        if (!camera || !area) return;
        const view = camera.getViewMatrix(true), world = area.computeWorldMatrix(true), aspect = scene.getEngine().getAspectRatio(camera);
        // How wide the area's corners are seen, from the view's axis, across and up.
        let across = 0, up = 0;
        for (const corner of CORNERS) {
          const at = Vector3.TransformCoordinates(Vector3.TransformCoordinates(corner, world), view);
          across = Math.max(across, Math.abs(at.x) / at.z);
          up = Math.max(up, Math.abs(at.y) / at.z);
        }
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
