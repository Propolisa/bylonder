import { animate, animation, renderSettings, createPrimitive } from '@workbench/sdk';
import { createMaterials } from './materials.js';
import { createOrrery } from './mechanism.js';

const FRAMES = 360;

// A clockwork orrery in brass, steel and polished stone, turning in a dark studio. Its sun lights the planets; its
// gears mesh as they drive them. Every motion is a keyframe on the timeline, choreographed with the camera over
// fifteen seconds: a close look at the gear train, a rise to reveal the whole machine, and a slow circle around it.
export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.006, 0.008, 0.016, 1);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.2;
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
  scene.fogStart = 2.5;
  scene.fogEnd = 7;
  scene.fogColor = new BABYLON.Color3(0.006, 0.008, 0.016);
  renderSettings({ eevee: { taaRenderSamples: 32, useRaytracing: true, screenTraceQuality: 0.5, fastGiDistance: 0.3 }, render: { useMotionBlur: true, motionBlurShutter: 0.5 } });

  const m = createMaterials(scene);
  const orrery = createOrrery(scene, m);
  const floor = createPrimitive('Floor', 'mesh.primitive_circle_add', { vertices: 64, radius: 12, fill_type: 'NGON' }, scene);
  floor.material = m.lacquer;
  const meshes = scene.meshes.filter((mesh) => mesh !== floor);

  const { shadows } = studioLights(scene, orrery.sun);
  meshes.forEach((mesh) => { shadows.addShadowCaster(mesh); mesh.receiveShadows = true; });
  floor.receiveShadows = true;
  studioEnvironment(scene, m);

  const camera = new BABYLON.TargetCamera('Camera', new BABYLON.Vector3(0.45, 0.24, -0.35), scene);
  camera.fov = 2 * Math.atan(12 / 50);
  camera.minZ = 0.02;
  camera.lockedTarget = new BABYLON.Vector3(0.08, 0.2, 0);
  const lens = new BABYLON.DefaultRenderingPipeline('Lens', true, scene, [camera]);
  lens.depthOfFieldEnabled = true;
  Object.assign(lens.depthOfField, { focalLength: 50, fStop: 2.8, lensSize: 50 });
  lens.bloomEnabled = true;
  Object.assign(lens, { bloomThreshold: 0.9, bloomWeight: 0.3, bloomKernel: 64 });
  lens.imageProcessing.vignetteEnabled = true;
  lens.imageProcessing.vignetteWeight = 1.6;
  // Autofocus on what the camera looks at.
  scene.onBeforeRenderObservable.add(() => { lens.depthOfField.focusDistance = BABYLON.Vector3.Distance(camera.position, camera.lockedTarget) * 1000; });

  choreograph(camera, orrery);
  return scene;
};

// A warm light from inside the sun, a key light with soft shadows and cool rims that draw the brass out of the dark.
function studioLights(scene, sun) {
  const glow = new BABYLON.PointLight('Sun Light', sun.position.clone(), scene);
  glow.diffuse = new BABYLON.Color3(1, 0.62, 0.3);
  glow.intensity = 0.25;
  const glowLayer = new BABYLON.GlowLayer('Sun Glow', scene, { blurKernelSize: 64 });
  glowLayer.intensity = 0.9;
  glowLayer.addIncludedOnlyMesh(sun);

  const key = new BABYLON.SpotLight('Key', new BABYLON.Vector3(1.2, 2.4, -1.4), new BABYLON.Vector3(-1.2, -2.2, 1.4), 0.7, 2, scene);
  key.diffuse = new BABYLON.Color3(1, 0.93, 0.85);
  key.intensity = 18;
  const shadows = new BABYLON.ShadowGenerator(2048, key);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = 0.0005;
  for (const [x, z] of [[-1.6, 1.2], [1.4, 1.6]]) {
    const rim = new BABYLON.SpotLight('Rim', new BABYLON.Vector3(x, 1.2, z), new BABYLON.Vector3(-x, -0.9, -z), 0.6, 2, scene);
    rim.diffuse = new BABYLON.Color3(0.45, 0.75, 1);
    rim.intensity = 12;
  }
  return { shadows };
}

// Softboxes that only reflections see: they light the scene's environment, baked once into a cube map.
function studioEnvironment(scene, m) {
  const hidden = 0x10000000;
  const box = (name, material, size, position) => {
    const panel = BABYLON.MeshBuilder.CreatePlane(name, size, scene);
    panel.position = position;
    panel.lookAt(BABYLON.Vector3.Zero());
    panel.material = material;
    panel.layerMask = hidden;
    panel.metadata = { editable: false };
    return panel;
  };
  const panels = [
    box('Top Softbox', m.warmBox, { width: 2.4, height: 1.4 }, new BABYLON.Vector3(0.4, 2.2, -0.8)),
    box('Left Strip', m.coolBox, { width: 0.35, height: 2.4 }, new BABYLON.Vector3(-2, 0.8, 0.6)),
    box('Right Strip', m.coolBox, { width: 0.35, height: 2.4 }, new BABYLON.Vector3(2, 0.8, 1)),
  ];
  const probe = new BABYLON.ReflectionProbe('Studio Probe', 256, scene, true, true);
  probe.position = new BABYLON.Vector3(0, 0.4, 0);
  probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  probe.renderList.push(...panels);
  scene.environmentTexture = probe.cubeTexture;
}

// Keyframes for every motion: the orbits and gears turn on linear curves, the camera moves on smooth ones.
function choreograph(camera, orrery) {
  const turn = (node, id, title) => animate(node, { id, title, properties: { 'rotation.y': { label: 'Turn' } } });
  const shot = animate(camera, { id: 'camera', title: 'Camera', properties: { position: { label: 'Location' }, lockedTarget: { label: 'Look At' } } });
  const orbits = orrery.planets.map((p) => ({ p, track: turn(p.orbit, 'orbit-' + p.name.toLowerCase(), p.name + ' Orbit') }));
  const gears = orrery.gears.map((g, i) => ({ g, track: turn(g.node, 'gear-' + i, g.node.name) }));
  const rings = orrery.armillary.map((node, i) => ({ node, track: turn(node, 'armillary-' + i, node.name) }));
  const moon = orrery.planets.find((p) => p.moon);
  const moonTrack = turn(moon.moon, 'moon', 'Moon Orbit');
  if (animation.action.tracks.length) return animation.seek(animation.time.state.frameStart);

  const keys = (track, path, frames, interpolation = 'BEZIER') => {
    frames.forEach(([frame, value]) => animation.insert([track.ref(path)], frame, value));
    animation.editKeys(frames.map(([frame]) => ({ ref: track.ref(path), frame })), { interpolation });
  };
  const earth = -Math.PI * 2 * 0.6;
  for (const { p, track } of orbits) keys(track, 'rotation.y', [[1, p.phase], [FRAMES, p.phase + earth * p.turns]], 'LINEAR');
  for (const { g, track } of gears) keys(track, 'rotation.y', [[1, g.phase], [FRAMES, g.phase + earth * g.ratio]], 'LINEAR');
  rings.forEach(({ track }, i) => keys(track, 'rotation.y', [[1, i], [FRAMES, i + (i % 2 ? -1 : 1) * Math.PI * 0.8]], 'LINEAR'));
  keys(moonTrack, 'rotation.y', [[1, 0], [FRAMES, earth * 8]], 'LINEAR');

  const path = [
    [1, [0.42, 0.25, -0.34], [0.06, 0.2, 0.02]],
    [110, [0.75, 0.48, -0.95], [0, 0.32, 0]],
    [230, [-0.35, 0.72, -1.35], [0, 0.36, 0]],
    [FRAMES, [-1.25, 0.9, -0.55], [0, 0.36, 0]],
  ];
  ['x', 'y', 'z'].forEach((axis, i) => {
    keys(shot, 'position.' + axis, path.map(([frame, at]) => [frame, at[i]]));
    keys(shot, 'lockedTarget.' + axis, path.map(([frame, , look]) => [frame, look[i]]));
  });
  animation.time.configure({ frameStart: 1, frameEnd: FRAMES, fps: 24 });
  animation.seek(1);
}
