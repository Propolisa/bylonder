import vertex from './shaders/sky.vert.glsl?raw';
import fragment from './shaders/sky.frag.glsl?raw';

const direction = (azimuth, elevation) => new BABYLON.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));

// The sky dome, the sun low over the sea and the light it gives: a warm key with long shadows, a violet sky fill, and
// haze that thickens toward the horizon.
export function createSky(scene, { sunAzimuth, sunElevation, horizon, dusk, zenith }) {
  const sunDirection = direction(sunAzimuth, sunElevation);
  const dome = BABYLON.MeshBuilder.CreateSphere('Sky', { diameter: 2000, segments: 32, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  dome.infiniteDistance = true;
  dome.isPickable = false;
  const material = new BABYLON.ShaderMaterial('Sky', scene, { vertexSource: vertex, fragmentSource: fragment }, {
    attributes: ['position'], uniforms: ['worldViewProjection', 'sunDirection', 'moonDirection', 'horizon', 'dusk', 'zenith', 'glow', 'cloudShift'],
  });
  material.setVector3('sunDirection', sunDirection);
  material.setVector3('moonDirection', direction(sunAzimuth + 1.2, 0.4));
  material.setColor3('horizon', horizon);
  material.setColor3('dusk', dusk);
  material.setColor3('zenith', zenith);
  material.setColor3('glow', new BABYLON.Color3(1, 0.5, 0.22));
  material.setFloat('cloudShift', 0);
  material.backFaceCulling = false;
  dome.material = material;
  dome.applyFog = false;

  const sun = new BABYLON.DirectionalLight('Sun', sunDirection.negate(), scene);
  sun.diffuse = new BABYLON.Color3(1, 0.56, 0.3);
  sun.intensity = 2.6;
  sun.position = sunDirection.scale(400);
  const sky = new BABYLON.HemisphericLight('Sky Light', BABYLON.Vector3.Up(), scene);
  sky.diffuse = new BABYLON.Color3(0.45, 0.4, 0.7);
  sky.groundColor = new BABYLON.Color3(0.12, 0.08, 0.08);
  sky.intensity = 0.55;

  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0011;
  scene.fogColor = new BABYLON.Color3(0.3, 0.25, 0.38);

  // The sun's disc, which god rays stream from.
  const disc = BABYLON.MeshBuilder.CreatePlane('Sun Disc', { size: 60 }, scene);
  disc.position = sunDirection.scale(900);
  disc.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  disc.infiniteDistance = true;
  disc.applyFog = false;
  disc.isPickable = false;
  const discMaterial = new BABYLON.StandardMaterial('Sun Disc', scene);
  Object.assign(discMaterial, { emissiveColor: new BABYLON.Color3(1, 0.6, 0.3), disableLighting: true, opacityTexture: radialFade(scene) });
  disc.material = discMaterial;
  return { dome, material, sun, sunDirection, disc };
}

// A soft round spot, for the sun's disc.
function radialFade(scene) {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x / size - 0.5, y / size - 0.5) * 2, a = Math.max(0, 1 - r) ** 2 * 255, i = (y * size + x) * 4;
    data.set([a, a, a, a], i);
  }
  return BABYLON.RawTexture.CreateRGBATexture(data, size, size, scene, true);
}

// The sky, baked once into a cube map, lights every PBR surface.
export function skyEnvironment(scene, dome) {
  const probe = new BABYLON.ReflectionProbe('Sky Probe', 128, scene, true, true);
  probe.position = new BABYLON.Vector3(0, 50, 0);
  probe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  probe.renderList.push(dome);
  scene.environmentTexture = probe.cubeTexture;
  scene.environmentIntensity = 0.7;
  return probe;
}
