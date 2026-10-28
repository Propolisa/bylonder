import { createOrbits } from './systems/orbits.js';
import { starfield } from './systems/stars.js';

export const createScene = async function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.05, 1);

  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.1, 30, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);

  const sun = BABYLON.MeshBuilder.CreateSphere('Sun', { diameter: 3, segments: 48 }, scene);
  const glow = new BABYLON.StandardMaterial('sunMaterial', scene);
  glow.emissiveColor = new BABYLON.Color3(1, 0.7, 0.25);
  glow.disableLighting = true;
  sun.material = glow;
  new BABYLON.GlowLayer('glow', scene).intensity = 0.8;

  const light = new BABYLON.PointLight('Sunlight', BABYLON.Vector3.Zero(), scene);
  light.intensity = 1.6;
  new BABYLON.HemisphericLight('Fill', new BABYLON.Vector3(0, 1, 0), scene).intensity = 0.08;

  starfield(scene, 1200);
  createOrbits(scene);
  return scene;
};
