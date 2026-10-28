import { animation } from '@workbench/sdk';

// Light through a tall window on the left, as in a Dutch interior: a warm pool of light with soft contact-hardening
// shadows that falls off into the dark, a cool bounce from the room, a rim of light from behind that draws the glass,
// and the window itself, which metal and glass reflect.
export function windowLight(scene, materials, casters) {
  const key = new BABYLON.SpotLight('Window Light', new BABYLON.Vector3(-1.3, 0.95, -0.75), new BABYLON.Vector3(1.4, -0.95, 1.05), 1.1, 1.5, scene);
  key.diffuse = new BABYLON.Color3(1, 0.84, 0.64);
  key.intensity = 12;
  key.shadowMinZ = 0.5;
  key.shadowMaxZ = 3.5;
  const shadows = new BABYLON.ShadowGenerator(2048, key);
  shadows.useContactHardeningShadow = true;
  shadows.contactHardeningLightSizeUVRatio = 0.05;
  shadows.bias = 0.0003;
  shadows.normalBias = 0.002;
  shadows.darkness = 0.1;
  casters.forEach((mesh) => shadows.addShadowCaster(mesh, true));

  const rim = new BABYLON.SpotLight('Rim Light', new BABYLON.Vector3(0.45, 0.42, 0.55), new BABYLON.Vector3(-0.6, -0.35, -0.5), 1.2, 2, scene);
  rim.diffuse = new BABYLON.Color3(1, 0.9, 0.75);
  rim.intensity = 1.6;

  const bounce = new BABYLON.HemisphericLight('Room Bounce', new BABYLON.Vector3(0.2, 1, -0.4), scene);
  bounce.diffuse = new BABYLON.Color3(0.45, 0.52, 0.7);
  bounce.groundColor = new BABYLON.Color3(0.2, 0.12, 0.07);
  bounce.intensity = 0.12;

  const window = BABYLON.MeshBuilder.CreatePlane('Window', { width: 0.9, height: 1.5, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
  window.position = new BABYLON.Vector3(-1.6, 0.8, -0.6);
  window.rotation.y = -Math.PI / 2 + 0.5;
  window.material = materials.window;
  window.isPickable = false;
  return { key, window };
}

// A beeswax candle flame that breathes: its light flickers with the scene frame, so renders repeat exactly.
export function candleFlame(scene, top) {
  const flame = BABYLON.MeshBuilder.CreateSphere('Flame', { diameter: 0.009, segments: 12 }, scene);
  flame.scaling.y = 2.4;
  flame.position = top.add(new BABYLON.Vector3(0, 0.016, 0));
  const glow = new BABYLON.StandardMaterial('Flame', scene);
  glow.emissiveColor = new BABYLON.Color3(1, 0.62, 0.22);
  glow.disableLighting = true;
  flame.material = glow;
  flame.isPickable = false;

  const light = new BABYLON.PointLight('Candle Light', flame.position.add(new BABYLON.Vector3(0, 0.05, 0)), scene);
  light.diffuse = new BABYLON.Color3(1, 0.6, 0.28);
  light.range = 1.2;
  scene.onBeforeRenderObservable.add(() => {
    const t = animation.time.frame / 24;
    const flicker = 0.85 + 0.1 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 31.7 + 1.3);
    light.intensity = 0.12 * flicker;
    flame.scaling.y = 2.2 + 0.4 * flicker;
  });

  const layer = new BABYLON.GlowLayer('Flame Glow', scene, { blurKernelSize: 48 });
  layer.intensity = 0.9;
  layer.addIncludedOnlyMesh(flame);
  return flame;
}

// What the glass refracts: the opaque scene behind it, drawn each frame from whichever camera is looking.
export function seenThroughGlass(scene, glasses, opaque) {
  const behind = new BABYLON.RenderTargetTexture('Behind the Glass', 1024, scene, { generateMipMaps: true });
  behind.renderList.push(...opaque);
  scene.customRenderTargets.push(behind);
  for (const material of glasses) material.subSurface.refractionTexture = behind;
  return behind;
}

// What metal and glass reflect: the room (wall, table, window) baked once into a cube map from the middle of the
// table, used as the scene's environment.
export function bakeEnvironment(scene, meshes, position) {
  const probe = new BABYLON.ReflectionProbe('Room Probe', 256, scene, true, true);
  probe.position = position;
  probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  probe.renderList.push(...meshes);
  scene.environmentTexture = probe.cubeTexture;
  // The room is drawn without reflections of itself: a texture cannot be read while it is drawn into.
  probe.cubeTexture.onBeforeRenderObservable.add(() => { scene.environmentTexture = null; });
  probe.cubeTexture.onAfterRenderObservable.add(() => { scene.environmentTexture = probe.cubeTexture; });
  scene.environmentIntensity = 1;
  return probe;
}
