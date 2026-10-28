import { animate, animation, renderSettings } from '@workbench/sdk';
import { createTerrain, createSea, coastline, BAY, HEADLAND } from './terrain.js';
import { createSky, skyEnvironment } from './sky.js';
import { createLighthouse, createVillage } from './structures.js';
import { createGulls } from './gulls.js';

// Dusk on a chalk coast: a slow flight north along the cliffs, past a fishing village in its bay, toward a lighthouse
// that has just been lit. The sun is setting over the sea; haze, god rays and the sea's mirror carry its light.
export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.05, 0.04, 0.08, 1);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.contrast = 1.1;
  renderSettings({ eevee: { taaRenderSamples: 24 }, render: { useMotionBlur: true, motionBlurShutter: 0.5 } });

  const sky = createSky(scene, { sunAzimuth: -0.72, sunElevation: 0.05, horizon: new BABYLON.Color3(1, 0.5, 0.28), dusk: new BABYLON.Color3(0.42, 0.3, 0.46), zenith: new BABYLON.Color3(0.04, 0.06, 0.2) });
  const terrain = createTerrain(scene);
  const lighthouse = createLighthouse(scene, [coastline(HEADLAND) - 16, HEADLAND]);
  const cottages = [[-60, 0.3], [-75, 0.1], [-95, -0.2], [-110, 0.25], [-122, 0.05], [-140, -0.15], [-158, 0.4], [-170, 0.1], [-185, -0.3]]
    .map(([z, turn], i) => [coastline(z) - 45 - (i % 3) * 14, z, turn]);
  const village = createVillage(scene, cottages);
  createGulls(scene, lighthouse.lantern.subtract(new BABYLON.Vector3(-20, 30, 10)));
  const tower = lighthouse.root.getChildMeshes();
  const { sea, ripples } = createSea(scene, [sky.dome, terrain, ...tower, ...village]);
  skyEnvironment(scene, sky.dome);

  // The lighthouse and cottages cast long shadows over the ground; the ground does not shadow itself, which a sun this
  // low would only draw as stair steps at shadow map resolution.
  const shadows = new BABYLON.ShadowGenerator(2048, sky.sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = 0.002;
  [...tower, ...village].forEach((mesh) => shadows.addShadowCaster(mesh));
  village.forEach((mesh) => { mesh.receiveShadows = true; });

  const camera = new BABYLON.TargetCamera('Camera', new BABYLON.Vector3(coastline(-280) + 60, 12, -280), scene);
  camera.fov = 0.72;
  camera.minZ = 0.5;
  camera.maxZ = 3000;
  camera.lockedTarget = new BABYLON.Vector3(lighthouse.lantern.x + 60, 14, HEADLAND);
  const rays = new BABYLON.VolumetricLightScatteringPostProcess('God Rays', 0.5, camera, sky.disc, 60, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false, scene);
  Object.assign(rays, { exposure: 0.22, decay: 0.97, weight: 0.5, density: 0.9 });
  const lens = new BABYLON.DefaultRenderingPipeline('Lens', true, scene, [camera]);
  lens.bloomEnabled = true;
  Object.assign(lens, { bloomThreshold: 0.8, bloomWeight: 0.4, bloomKernel: 64 });
  lens.imageProcessing.vignetteEnabled = true;
  lens.imageProcessing.vignetteWeight = 1.5;

  // Waves and the beam move with the frame, so renders and playback agree.
  scene.onBeforeRenderObservable.add(() => {
    const t = animation.time.frame / 24;
    ripples.uOffset = t * 0.004;
    ripples.vOffset = t * 0.0025;
    sky.material.setFloat('cloudShift', t * 0.01);
  });

  const shot = animate(camera, { id: 'camera', title: 'Camera', properties: { position: { label: 'Location' }, lockedTarget: { label: 'Look At' } } });
  const beam = animate(lighthouse.beam, { id: 'beam', title: 'Lighthouse Beam', properties: { rotation: { label: 'Rotation' } } });
  if (!animation.action.tracks.length) {
    const keys = (track, path, frames, interpolation) => {
      frames.forEach(([frame, value]) => animation.insert([track.ref(path)], frame, value));
      if (interpolation) animation.editKeys(frames.map(([frame]) => ({ ref: track.ref(path), frame })), { interpolation });
    };
    keys(shot, 'position.x', [[1, coastline(-210) + 70], [150, coastline(-30) + 60], [300, coastline(70) + 80]]);
    keys(shot, 'position.y', [[1, 12], [150, 22], [300, 38]]);
    keys(shot, 'position.z', [[1, -215], [150, -20], [300, 70]]);
    keys(shot, 'lockedTarget.x', [[1, coastline(BAY) - 55], [150, lighthouse.lantern.x + 20], [300, lighthouse.lantern.x]]);
    keys(shot, 'lockedTarget.y', [[1, 5], [150, 16], [300, lighthouse.lantern.y - 4]]);
    keys(shot, 'lockedTarget.z', [[1, BAY + 10], [150, HEADLAND - 30], [300, HEADLAND]]);
    keys(beam, 'rotation.y', [[1, 0], [300, Math.PI * 2.5]], 'LINEAR');
    animation.time.configure({ frameStart: 1, frameEnd: 300, fps: 24 });
  }
  animation.seek(animation.time.state.frameStart);
  return scene;
};
