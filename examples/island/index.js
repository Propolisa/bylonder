import { animate, animation, renderSettings } from '@workbench/sdk';
import { FRAMES, FPS, days, speed, SHOTS } from './story.js';
import { createToon } from './toon.js';
import { createIsland, createSea } from './island.js';
import { createForest } from './forest.js';
import { daylight, createClouds, createSmoke, meteorAt } from './sky.js';
import { createBombs, createSteam, createWhale, createBirds, createFireflies } from './life.js';

// A volcanic island in time-lapse: the volcano pours lava down its slopes, the lava cools to basalt and weathers to
// soil, grass spreads up from the beaches and a forest grows, palms first. Days turn to nights ever faster, the clouds
// racing round the horizon to show it. Lava bombs fly and steam rises where the lava meets the sea; a whale surfaces;
// birds arrive with the forest, fireflies blink in it at night, and a shooting star crosses one night. Low poly and
// toon shaded, the film's look is in toon.js.
export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  // Flat toon shading needs few samples to smooth its edges.
  renderSettings({ eevee: { taaRenderSamples: 16 } });
  const toon = createToon(scene);

  const dome = BABYLON.MeshBuilder.CreateSphere('Sky', { diameter: 400, segments: 24, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  Object.assign(dome, { material: toon.sky, infiniteDistance: true, isPickable: false });
  createIsland(scene).material = toon.terrain();
  createSea(scene).material = toon.sea();
  const forest = createForest(scene, toon);
  const moving = [forest, createClouds(scene, toon), createSmoke(scene, toon), createBombs(scene, toon), createSteam(scene, toon), createWhale(scene, toon),
    createBirds(scene, toon), createFireflies(scene, toon, forest.spots)];

  const camera = new BABYLON.TargetCamera('Camera', new BABYLON.Vector3(14, 6, -10), scene);
  Object.assign(camera, { fov: 0.95, minZ: 0.1, maxZ: 1000, lockedTarget: new BABYLON.Vector3(0, 1.6, 0) });
  // Lava glows past white, which bloom spreads.
  const lens = new BABYLON.DefaultRenderingPipeline('Lens', true, scene, [camera]);
  Object.assign(lens, { bloomEnabled: true, bloomThreshold: 1.6, bloomWeight: 0.8, bloomKernel: 48 });

  // Everything that changes follows the frame, so playback and renders agree.
  // Island time (days) runs ever faster; wind, wings and fireflies keep the film's own time.
  scene.onBeforeRenderObservable.add(() => {
    const frame = animation.time.frame, day = days(frame), time = (frame - 1) / FPS;
    toon.light(daylight(day, speed(frame)), day, time, meteorAt(frame));
    for (const move of moving) move(day, time);
  });

  // The camera's shots (story.js), keyed.
  const shot = animate(camera, { id: 'camera', title: 'Camera', properties: { position: { label: 'Location' }, lockedTarget: { label: 'Look At' } } });
  if (!animation.action.tracks.length) {
    for (const [frame, angle, distance, height, target] of SHOTS) {
      const key = (path, value) => animation.insert([shot.ref(path)], frame, value);
      key('position.x', Math.cos(angle) * distance);
      key('position.y', height);
      key('position.z', Math.sin(angle) * distance);
      key('lockedTarget.y', target);
    }
    animation.time.configure({ frameStart: 1, frameEnd: FRAMES, fps: FPS });
  }
  animation.seek(animation.time.state.frameStart);
  return scene;
};
