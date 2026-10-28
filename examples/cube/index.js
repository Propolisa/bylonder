import { createPrimitive } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);

  createPrimitive('Cube', 'mesh.primitive_cube_add', { size: 2 }, scene);

  const camera = new BABYLON.FreeCamera('Camera', new BABYLON.Vector3(7.3589, 4.9583, -6.9258), scene);
  camera.rotation = new BABYLON.Vector3(BABYLON.Tools.ToRadians(90 - 63.559), BABYLON.Tools.ToRadians(-46.692), 0);
  // A 50 mm lens on a 36 mm sensor, fitted horizontally.
  camera.fovMode = BABYLON.Camera.FOVMODE_HORIZONTAL_FIXED;
  camera.fov = 2 * Math.atan(18 / 50);
  camera.minZ = 0.1;
  camera.maxZ = 100;

  const light = new BABYLON.PointLight('Light', new BABYLON.Vector3(4.0762, 5.9039, 1.0055), scene);
  light.radius = 0.1;
  return scene;
};
