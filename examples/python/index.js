import { createPrimitive, createLight, createWorld } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);

  const cube = createPrimitive('Cube', 'mesh.primitive_cube_add', { size: 2 }, scene);
  // startup.blend's Material: a Principled BSDF at its defaults.
  cube.material = new BABYLON.PBRMaterial('Material', scene);
  cube.material.albedoColor = new BABYLON.Color3(0.8, 0.8, 0.8);
  cube.material.metallic = 0;
  cube.material.roughness = 0.5;

  const camera = new BABYLON.FreeCamera('Camera', new BABYLON.Vector3(7.3589, 4.9583, -6.9258), scene);
  camera.rotation = new BABYLON.Vector3(BABYLON.Tools.ToRadians(90 - 63.559), BABYLON.Tools.ToRadians(-46.692), 0);
  // A 50 mm lens on a 36 mm sensor, fitted horizontally.
  camera.fovMode = BABYLON.Camera.FOVMODE_HORIZONTAL_FIXED;
  camera.fov = 2 * Math.atan(18 / 50);
  camera.minZ = 0.1;
  camera.maxZ = 100;

  // startup.blend's light: Blender's 1000 W point light.
  const light = createLight('Light', 'POINT', { energy: 1000, shadow_soft_size: 0.1 }, scene);
  light.position.set(4.0762, 5.9039, 1.0055);
  light.rotation.set(0.918468, -1.938812, -0.091041);
  createWorld(scene);
  return scene;
};
