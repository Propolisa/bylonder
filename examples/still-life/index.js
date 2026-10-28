import { animate, animation, renderSettings } from '@workbench/sdk';
import { createMaterials } from './materials.js';
import * as make from './objects.js';
import { windowLight, candleFlame, bakeEnvironment, seenThroughGlass } from './lighting.js';

// Still life with lemons, after the Dutch masters: glass, glaze, brass and fruit on a walnut table, lit by a window and
// a candle. Sizes are in meters. The camera dollies slowly along the table while the focus moves from the fruit to the
// glass, over ten seconds.
export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.012, 0.01, 0.008, 1);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.contrast = 1.1;
  scene.imageProcessingConfiguration.exposure = 1.4;
  renderSettings({ eevee: { taaRenderSamples: 48 }, render: { useMotionBlur: true, motionBlurShutter: 0.5 } });

  const m = createMaterials(scene);
  const place = (mesh, material, [x, y, z], turn = 0) => {
    mesh.material = material;
    mesh.position.set(x, y, z);
    mesh.rotation.y += turn;
    return mesh;
  };

  const table = place(make.table(scene), m.walnut, [0, -0.04, 0.05]);
  const wall = place(make.wall(scene), m.plaster, [0, -0.3, 0.62]);
  const cloth = place(make.cloth(scene), m.linen, [-0.12, 0.001, -0.1], 0.5);
  const carafe = place(make.carafe(scene), m.glass, [-0.1, 0, 0.2]);
  const wine = place(make.wine(scene), m.wine, [-0.1, 0, 0.2]);
  const glass = place(make.wineGlass(scene), m.crystal, [0.06, 0, 0.04]);
  const bowl = place(make.bowl(scene), m.celadon, [0.27, 0, 0.26]);
  const candlestick = place(make.candlestick(scene), m.brass, [-0.34, 0, 0.36]);
  const candle = place(make.candle(scene), m.beeswax, [-0.34, 0, 0.36]);
  const grapes = place(make.grapes(scene, m.grape), m.grape, [0.24, 0.06, 0.24], 0.9);
  const lemons = [[-0.2, -0.08, 0.4], [-0.11, -0.15, -0.6], [0.16, -0.17, 1.9]].map(([x, z, turn], i) => place(make.lemonShape(scene, 'Lemon ' + (i + 1)), m.lemon, [x, 0.0272, z], turn));
  const pear = place(make.pearShape(scene, 'Pear'), m.pear, [0.25, 0.002, 0.04]);
  pear.rotation.z = -0.12;
  pear.getChildMeshes().forEach((stalk) => { stalk.material = m.stem; });

  const props = [carafe, wine, glass, bowl, candlestick, candle, grapes, pear, ...lemons];
  [table, wall, cloth].forEach((mesh) => { mesh.receiveShadows = true; });
  props.forEach((mesh) => { mesh.receiveShadows = true; });
  const { window } = windowLight(scene, m, props);
  candleFlame(scene, new BABYLON.Vector3(-0.34, 0.296, 0.36));
  bakeEnvironment(scene, [table, wall, cloth, window], new BABYLON.Vector3(0, 0.12, 0.05));
  seenThroughGlass(scene, [m.glass], [table, wall, cloth, wine, bowl, candlestick, candle, grapes, pear, ...lemons]);

  // A 60 mm lens, low over the table.
  const camera = new BABYLON.TargetCamera('Camera', new BABYLON.Vector3(-0.3, 0.24, -1.1), scene);
  camera.fov = 2 * Math.atan(12 / 60);
  camera.minZ = 0.05;
  camera.lockedTarget = new BABYLON.Vector3(0, 0.1, 0.06);
  const lens = new BABYLON.DefaultRenderingPipeline('Lens', true, scene, [camera]);
  lens.depthOfFieldEnabled = true;
  lens.depthOfFieldBlurLevel = BABYLON.DepthOfFieldEffectBlurLevel.Medium;
  Object.assign(lens.depthOfField, { focalLength: 60, fStop: 2.8, lensSize: 50, focusDistance: 960 });
  lens.bloomEnabled = true;
  Object.assign(lens, { bloomThreshold: 0.85, bloomWeight: 0.35, bloomKernel: 64, bloomScale: 0.5 });
  lens.imageProcessing.vignetteEnabled = true;
  lens.imageProcessing.vignetteWeight = 2.2;
  lens.imageProcessing.vignetteColor = new BABYLON.Color4(0.05, 0.02, 0, 0);

  // Keyframes on the timeline: the dolly, where the camera looks, and the focus pull.
  const shot = animate(camera, { id: 'camera', title: 'Camera', properties: { position: { label: 'Location' }, lockedTarget: { label: 'Look At' } } });
  const focus = animate(lens.depthOfField, { id: 'lens', title: 'Lens', properties: { focusDistance: { label: 'Focus Distance (mm)', min: 100, max: 5000 }, fStop: { label: 'F-Stop', min: 1, max: 22 } } });
  if (!animation.action.tracks.length) {
    const keys = (track, path, frames) => frames.forEach(([frame, value]) => animation.insert([track.ref(path)], frame, value));
    keys(shot, 'position.x', [[1, -0.32], [240, 0.26]]);
    keys(shot, 'position.y', [[1, 0.2], [240, 0.27]]);
    keys(shot, 'position.z', [[1, -1.1], [240, -1.04]]);
    keys(shot, 'lockedTarget.x', [[1, -0.05], [240, 0.03]]);
    keys(shot, 'lockedTarget.y', [[1, 0.11], [240, 0.12]]);
    keys(focus, 'focusDistance', [[1, 960], [90, 970], [170, 1180], [240, 1190]]);
    keys(focus, 'fStop', [[1, 2.2], [240, 2.8]]);
    animation.time.configure({ frameStart: 1, frameEnd: 240, fps: 24 });
  }
  animation.seek(animation.time.state.frameStart);
  return scene;
};
