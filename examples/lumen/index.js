import { animate, animation, controls, renderSettings } from '@workbench/sdk';
import { neon, geodesic, helix, halo, colonnade, mirrorFloor, chrome } from './installation.js';

const FPS = 24, BEAT = 12, SHOT = 72, SHOTS = 4;

// Lumen: a light installation in a dark hall, cut like a music video at 120 beats per minute. A lattice of light
// turns above a black mirror, in a halo of light spokes between colonnades; four shots of three seconds, each with its
// own move.
export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.004, 0.003, 0.01, 1);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.contrast = 1.1;
  scene.imageProcessingConfiguration.exposure = 1.4;
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.02;
  scene.fogColor = new BABYLON.Color3(0.02, 0.01, 0.04);
  renderSettings({ eevee: { taaRenderSamples: 16 }, render: { useMotionBlur: true, motionBlurShutter: 0.8 } });

  const colors = {
    cyan: neon(scene, 'Cyan Neon', new BABYLON.Color3(0.1, 0.75, 1)),
    magenta: neon(scene, 'Magenta Neon', new BABYLON.Color3(1, 0.08, 0.55)),
    amber: neon(scene, 'Amber Neon', new BABYLON.Color3(1, 0.5, 0.08)),
    white: neon(scene, 'White Neon', new BABYLON.Color3(0.85, 0.85, 1)),
  };
  const lattice = geodesic(scene, colors.cyan);
  lattice.position.y = 2.2;
  const heart = chrome(scene);
  heart.position.y = 2.2;
  const ribbon = helix(scene, colors.magenta);
  ribbon.position.y = 0.4;
  const spokes = halo(scene, colors.white);
  const blades = colonnade(scene, colors.amber);
  const lights = [lattice, ribbon, spokes, blades];
  mirrorFloor(scene, [...lights, heart]);
  hallEnvironment(scene, lights);

  const glow = new BABYLON.GlowLayer('Glow', scene, { blurKernelSize: 32 });
  glow.intensity = 0.45;
  glow.addExcludedMesh(heart);

  const camera = new BABYLON.TargetCamera('Camera', new BABYLON.Vector3(0, 0.4, -9), scene);
  camera.fov = 0.9;
  camera.minZ = 0.05;
  camera.lockedTarget = new BABYLON.Vector3(0, 2.2, 0);
  const lens = new BABYLON.DefaultRenderingPipeline('Lens', true, scene, [camera]);
  lens.bloomEnabled = true;
  Object.assign(lens, { bloomThreshold: 0.9, bloomWeight: 0.25, bloomKernel: 64, bloomScale: 0.5 });
  lens.chromaticAberrationEnabled = true;
  lens.chromaticAberration.aberrationAmount = 8;
  lens.imageProcessing.vignetteEnabled = true;
  lens.imageProcessing.vignetteWeight = 2.5;

  // The music: Energy (keyframed) scales every light, and each beat flashes and decays.
  const mix = controls({
    id: 'mix', title: 'Mix',
    schema: { energy: { default: 0.6, min: 0, max: 1.5, step: 0.01, label: 'Energy' }, swap: { default: 0, min: 0, max: 1, step: 0.01, label: 'Color Swap' } },
  });
  scene.onBeforeRenderObservable.add(() => {
    const frame = animation.time.frame, beat = (frame - 1) % BEAT, bar = Math.floor((frame - 1) / BEAT) % 4;
    const flash = Math.exp(-beat / 3), { energy, swap } = mix.values;
    const level = (offset) => energy * (0.6 + 1.0 * Math.exp(-(((frame - 1 + offset) % BEAT) / 3)));
    BABYLON.Color3.LerpToRef(colors.cyan.metadata.base, colors.magenta.metadata.base, swap, colors.cyan.emissiveColor);
    BABYLON.Color3.LerpToRef(colors.magenta.metadata.base, colors.cyan.metadata.base, swap, colors.magenta.emissiveColor);
    colors.cyan.emissiveColor.scaleToRef(level(0) * 0.9, colors.cyan.emissiveColor);
    colors.magenta.emissiveColor.scaleToRef(level(6), colors.magenta.emissiveColor);
    colors.white.metadata.base.scaleToRef(energy * (bar === 3 ? 1.6 * flash + 0.3 : 0.55 + 0.45 * flash), colors.white.emissiveColor);
    colors.amber.metadata.base.scaleToRef(level(3) * 0.9, colors.amber.emissiveColor);
    lattice.rotation.y = frame * 0.012;
    lattice.rotation.x = Math.sin(frame * 0.01) * 0.3;
    ribbon.rotation.y = -frame * 0.02;
  });

  cut(camera, mix);
  return scene;
};

// The hall's lights, baked once into a cube map for the chrome to reflect.
function hallEnvironment(scene, lights) {
  const probe = new BABYLON.ReflectionProbe('Hall Probe', 256, scene, true, true);
  probe.position = new BABYLON.Vector3(0, 2.2, 0);
  probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  probe.renderList.push(...lights);
  scene.environmentTexture = probe.cubeTexture;
}

// Four shots, cut on the bar: within a shot the camera moves on a smooth curve; the last key of each shot holds
// (Constant interpolation), so the next shot's first key is a cut. Energy and color swap are keyframed with them.
function cut(camera, mix) {
  const shot = animate(camera, { id: 'camera', title: 'Camera', properties: { position: { label: 'Location' }, lockedTarget: { label: 'Look At' }, fov: { label: 'Field of View', min: 0.2, max: 1.6 } } });
  if (animation.action.tracks.length) return animation.seek(animation.time.state.frameStart);
  const shots = [
    { from: [[0, 0.25, -13], [0, 1.6, 0], 0.8], to: [[0, 0.35, -7.5], [0, 2.4, 0], 0.95] },
    { from: [[0.4, 9, -0.6], [0, 2, 0], 0.9], to: [[-0.6, 7.5, 0.5], [0, 2, 0], 0.75] },
    { from: [[3.2, 2.6, -2.2], [0, 2.2, 0], 0.7], to: [[-1.2, 1.8, -3.6], [0, 2.4, 0], 0.65] },
    { from: [[0, 1.4, -6], [0, 2.2, 0], 0.85], to: [[0, 3.2, -18], [0, 2.4, 0], 0.7] },
  ];
  const key = (path, frame, value, interpolation) => {
    animation.insert([shot.ref(path)], frame, value);
    animation.editKeys([{ ref: shot.ref(path), frame }], { interpolation });
  };
  shots.forEach(({ from, to }, i) => {
    const start = 1 + i * SHOT, end = start + SHOT - 1;
    for (const [frame, [position, look, fov], interpolation] of [[start, from, 'BEZIER'], [end, to, 'CONSTANT']]) {
      ['x', 'y', 'z'].forEach((axis, a) => { key('position.' + axis, frame, position[a], interpolation); key('lockedTarget.' + axis, frame, look[a], interpolation); });
      key('fov', frame, fov, interpolation);
    }
  });
  const levels = (name, frames) => frames.forEach(([frame, value]) => animation.insert([mix.ref(name)], frame, value));
  levels('energy', [[1, 0.45], [60, 0.85], [73, 0.9], [144, 1], [145, 0.8], [216, 1.1], [217, 1.2], [288, 0.3]]);
  levels('swap', [[1, 0], [144, 0], [145, 1], [216, 1], [217, 0]]);
  animation.time.configure({ frameStart: 1, frameEnd: SHOT * SHOTS, fps: FPS });
  animation.seek(1);
}
